import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { arrayBufferSha256, fileSha256 } from '../lib/checksum';
import {
  CHUNK_SIZE,
  formatEta,
  formatSpeed,
  getTotalChunks,
  readFileChunk,
} from '../lib/chunker';
import { generateSessionId } from '../lib/crypto';
import {
  deleteSession,
  getIncompleteSessions,
  getSession,
  getSessionChunks,
  saveChunk,
  saveSession,
} from '../lib/db';

const BUFFER_HIGH_WATER = 8 * 1024 * 1024;
const BUFFER_LOW_WATER = 4 * 1024 * 1024;
const ACK_TIMEOUT = 5 * 60 * 1000;

function now() {
  return performance.now();
}

function toTransferProgress(bytes, totalBytes, stats) {
  const elapsed = Math.max((now() - stats.startedAt) / 1000, 0.1);
  const transferred = Math.max(bytes - stats.startingBytes, 0);
  const speed = transferred / elapsed;
  const remaining = Math.max(totalBytes - bytes, 0);
  const eta = speed > 0 ? remaining / speed : 0;

  return {
    progress: totalBytes > 0 ? bytes / totalBytes : 0,
    speed,
    speedLabel: formatSpeed(speed),
    eta,
    etaLabel: formatEta(eta),
  };
}

function getDataChannel(connection) {
  return connection?.dataChannel || connection?._dc || null;
}

function triggerAnchorDownload(file, { defer = false } = {}) {
  const download = () => {
    const link = document.createElement('a');
    link.href = file.url;
    link.download = file.filename;
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  if (defer) {
    window.requestAnimationFrame(download);
    return;
  }

  download();
}

function autoDownload(file) {
  triggerAnchorDownload(file, { defer: true });
}

async function saveCompletedFile(file) {
  if (file.blob && typeof window.showSaveFilePicker === 'function') {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: file.filename,
      });
      const writable = await handle.createWritable();
      await writable.write(file.blob);
      await writable.close();
      return;
    } catch (error) {
      if (error.name === 'AbortError') {
        return;
      }
    }
  }

  triggerAnchorDownload(file);
}

export function useTransfer({
  addMessageHandler,
  connected,
  decryptBuffer,
  encryptBuffer,
  getConnection,
  refreshResume,
  sendMessage,
}) {
  const [outgoing, setOutgoing] = useState([]);
  const [incoming, setIncoming] = useState([]);
  const [completed, setCompleted] = useState([]);
  const [errors, setErrors] = useState([]);
  const [pausedByVisibility, setPausedByVisibility] = useState(
    document.visibilityState === 'hidden',
  );
  const [reselectNeeded, setReselectNeeded] = useState([]);

  const outgoingRef = useRef(outgoing);
  const connectedRef = useRef(connected);
  const pausedRef = useRef(pausedByVisibility);
  const activeRef = useRef(false);
  const fileSessionsRef = useRef(new Map());
  const ackResolversRef = useRef(new Map());
  const incomingStatsRef = useRef(new Map());

  useEffect(() => {
    outgoingRef.current = outgoing;
  }, [outgoing]);

  useEffect(() => {
    connectedRef.current = connected;
  }, [connected]);

  useEffect(() => {
    pausedRef.current = pausedByVisibility;
  }, [pausedByVisibility]);

  const addError = useCallback((message) => {
    setErrors((previous) => [
      {
        id: generateSessionId(),
        message,
      },
      ...previous.slice(0, 3),
    ]);
  }, []);

  const patchOutgoing = useCallback((id, patch) => {
    setOutgoing((previous) =>
      previous.map((item) =>
        item.id === id
          ? {
              ...item,
              ...(typeof patch === 'function' ? patch(item) : patch),
            }
          : item,
      ),
    );
  }, []);

  const patchIncoming = useCallback((sessionId, patch) => {
    setIncoming((previous) =>
      previous.map((item) =>
        item.sessionId === sessionId
          ? {
              ...item,
              ...(typeof patch === 'function' ? patch(item) : patch),
            }
          : item,
      ),
    );
  }, []);

  const upsertIncomingSession = useCallback((session) => {
    const receivedBytes = Math.min(
      session.fileSize,
      Math.max(session.lastReceivedChunk + 1, 0) * CHUNK_SIZE,
    );

    incomingStatsRef.current.set(session.sessionId, {
      startedAt: now(),
      startingBytes: receivedBytes,
    });

    setIncoming((previous) => {
      const existing = previous.find((item) => item.sessionId === session.sessionId);
      const progress = toTransferProgress(receivedBytes, session.fileSize, {
        startedAt: now(),
        startingBytes: Math.max(receivedBytes - 1, 0),
      });
      const next = {
        sessionId: session.sessionId,
        filename: session.filename,
        fileSize: session.fileSize,
        mimeType: session.mimeType,
        totalChunks: session.totalChunks,
        receivedBytes,
        status: session.status || 'receiving',
        error: '',
        ...progress,
      };

      if (existing) {
        return previous.map((item) =>
          item.sessionId === session.sessionId ? { ...item, ...next } : item,
        );
      }

      return [next, ...previous];
    });
  }, []);

  const resolveAck = useCallback((sessionId, chunkIndex) => {
    const key = `${sessionId}:${chunkIndex}`;
    const resolver = ackResolversRef.current.get(key);

    if (!resolver) {
      return;
    }

    window.clearTimeout(resolver.timeout);
    ackResolversRef.current.delete(key);
    resolver.resolve();
  }, []);

  const rejectSessionAcks = useCallback((sessionId, error) => {
    ackResolversRef.current.forEach((resolver, key) => {
      if (!key.startsWith(`${sessionId}:`)) {
        return;
      }

      window.clearTimeout(resolver.timeout);
      ackResolversRef.current.delete(key);
      resolver.reject(error);
    });
  }, []);

  const rejectAllAcks = useCallback((error) => {
    ackResolversRef.current.forEach((resolver, key) => {
      window.clearTimeout(resolver.timeout);
      ackResolversRef.current.delete(key);
      resolver.reject(error);
    });
  }, []);

  const waitForAck = useCallback((sessionId, chunkIndex) => {
    const key = `${sessionId}:${chunkIndex}`;

    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        ackResolversRef.current.delete(key);
        reject(new Error('Timed out waiting for receiver ACK.'));
      }, ACK_TIMEOUT);

      ackResolversRef.current.set(key, {
        resolve,
        reject,
        timeout,
      });
    });
  }, []);

  const waitForVisibility = useCallback(async () => {
    while (pausedRef.current) {
      await new Promise((resolve) => window.setTimeout(resolve, 250));
    }
  }, []);

  const waitForBuffer = useCallback(async () => {
    const connection = getConnection();
    const dataChannel = getDataChannel(connection);

    if (!dataChannel || dataChannel.bufferedAmount <= BUFFER_HIGH_WATER) {
      return;
    }

    await new Promise((resolve) => {
      let interval;
      let settled = false;

      const done = () => {
        if (settled) {
          return;
        }

        settled = true;
        window.clearInterval(interval);
        dataChannel.removeEventListener?.('bufferedamountlow', done);
        resolve();
      };

      try {
        dataChannel.bufferedAmountLowThreshold = BUFFER_LOW_WATER;
        dataChannel.addEventListener?.('bufferedamountlow', done, { once: true });
      } catch {
        // Some browser wrappers expose bufferedAmount without the low-threshold event.
      }

      interval = window.setInterval(() => {
        if (!connectedRef.current || dataChannel.bufferedAmount <= BUFFER_LOW_WATER) {
          done();
        }
      }, 100);
    });
  }, [getConnection]);

  const markOutboundComplete = useCallback(
    async (session) => {
      patchOutgoing(session.itemId, {
        status: 'complete',
        progress: 1,
        speedLabel: 'Done',
        etaLabel: '0s',
      });
      await deleteSession(session.sessionId);
      fileSessionsRef.current.delete(session.sessionId);
      await refreshResume();
    },
    [patchOutgoing, refreshResume],
  );

  const sendChunks = useCallback(
    async (sessionId, fromChunk = 0) => {
      const session = fileSessionsRef.current.get(sessionId);

      if (!session?.file) {
        const storedSession = await getSession(sessionId);

        if (storedSession?.direction === 'outbound') {
          setReselectNeeded((previous) => {
            if (previous.some((item) => item.sessionId === sessionId)) {
              return previous;
            }

            return [storedSession, ...previous];
          });
        }

        return false;
      }

      if (activeRef.current && !session.sending) {
        session.pendingFromChunk = fromChunk;
        patchOutgoing(session.itemId, {
          status: 'queued',
          resumeFrom: fromChunk,
        });
        return false;
      }

      if (session.sending) {
        session.restartFrom = fromChunk;
        rejectSessionAcks(sessionId, new Error('Receiver requested a resume point.'));
        return false;
      }

      activeRef.current = true;
      session.sending = true;
      session.restartFrom = null;
      let restartFrom = null;

      try {
        const startChunk = Math.max(0, Math.min(fromChunk, session.meta.totalChunks - 1));
        const stats = {
          startedAt: now(),
          startingBytes: Math.min(session.meta.fileSize, startChunk * CHUNK_SIZE),
        };

        patchOutgoing(session.itemId, {
          status: 'transferring',
          error: '',
        });

        for (let chunkIndex = startChunk; chunkIndex < session.meta.totalChunks; chunkIndex += 1) {
          await waitForVisibility();

          if (!connectedRef.current) {
            throw new Error('Connection lost.');
          }

          await waitForBuffer();

          const chunk = await readFileChunk(session.file, chunkIndex);
          const encrypted = await encryptBuffer(chunk);
          const sent = sendMessage({
            type: 'chunk',
            sessionId,
            chunkIndex,
            iv: encrypted.iv,
            data: encrypted.data,
          });

          if (!sent) {
            throw new Error('Connection lost.');
          }

          await waitForAck(sessionId, chunkIndex);
          session.lastAckedChunk = chunkIndex;

          const bytesSent = Math.min(
            session.meta.fileSize,
            (chunkIndex + 1) * CHUNK_SIZE,
          );
          const progress = toTransferProgress(bytesSent, session.meta.fileSize, stats);

          await saveSession({
            ...session.meta,
            direction: 'outbound',
            status: 'transferring',
            lastAckedChunk: chunkIndex,
            bytesSent,
          });

          patchOutgoing(session.itemId, {
            ...progress,
            bytesSent,
            lastAckedChunk: chunkIndex,
          });
        }

        await markOutboundComplete(session);
        return true;
      } catch (error) {
        if (session.restartFrom !== null && connectedRef.current) {
          restartFrom = session.restartFrom;
        } else {
          patchOutgoing(session.itemId, {
            status: 'interrupted',
            error: error.message,
          });
          throw error;
        }
      } finally {
        session.sending = false;
        session.restartFrom = null;
        activeRef.current = false;
      }

      if (restartFrom !== null) {
        return sendChunks(sessionId, restartFrom);
      }
    },
    [
      encryptBuffer,
      markOutboundComplete,
      patchOutgoing,
      rejectSessionAcks,
      sendMessage,
      waitForAck,
      waitForBuffer,
      waitForVisibility,
    ],
  );

  const startQueuedFile = useCallback(
    async (item) => {
      if (!item?.file || !connectedRef.current || pausedRef.current) {
        return;
      }

      activeRef.current = true;

      try {
        const file = item.file;
        let meta = item.meta;
        let sessionId = item.sessionId;

        if (!meta) {
          patchOutgoing(item.id, {
            status: 'hashing',
            speedLabel: 'Hashing',
            etaLabel: '',
            error: '',
          });

          sessionId = generateSessionId();
          const sha256 = await fileSha256(file);
          meta = {
            sessionId,
            filename: file.name || 'Untitled',
            fileSize: file.size,
            mimeType: file.type || 'application/octet-stream',
            totalChunks: getTotalChunks(file.size),
            sha256,
          };
        }

        fileSessionsRef.current.set(sessionId, {
          file,
          itemId: item.id,
          meta,
          sessionId,
          lastAckedChunk: item.lastAckedChunk ?? -1,
          sending: false,
          restartFrom: null,
        });

        await saveSession({
          ...meta,
          direction: 'outbound',
          status: 'transferring',
          lastAckedChunk: item.lastAckedChunk ?? -1,
          bytesSent: Math.max(0, (item.lastAckedChunk ?? -1) + 1) * CHUNK_SIZE,
        });
        await refreshResume();

        patchOutgoing(item.id, {
          sessionId,
          meta,
          status: 'transferring',
          totalChunks: meta.totalChunks,
          progress: item.resumeFrom ? item.resumeFrom / meta.totalChunks : 0,
          speedLabel: '0 MB/s',
          etaLabel: '',
          error: '',
        });

        const sent = sendMessage({
          type: 'meta',
          ...meta,
        });

        if (!sent) {
          throw new Error('Connection lost.');
        }

        activeRef.current = false;
        await sendChunks(sessionId, item.resumeFrom ?? 0);
      } catch (error) {
        activeRef.current = false;
        patchOutgoing(item.id, {
          status: 'interrupted',
          error: error.message,
        });
        addError(error.message);
      }
    },
    [addError, patchOutgoing, refreshResume, sendChunks, sendMessage],
  );

  const addFiles = useCallback(
    async (fileList) => {
      const files = Array.from(fileList || []);

      if (files.length === 0) {
        return;
      }

      const incompleteOutbound = await getIncompleteSessions('outbound');
      const nextItems = files.map((file) => {
        const match = incompleteOutbound.find(
          (session) =>
            session.filename === file.name &&
            session.fileSize === file.size &&
            session.status !== 'complete',
        );

        if (match) {
          const resumeFrom = Math.max((match.lastAckedChunk ?? -1) + 1, 0);
          const id = `${match.sessionId}:reselected`;
          const item = {
            id,
            file,
            filename: match.filename,
            fileSize: match.fileSize,
            status: 'queued',
            progress: match.totalChunks ? resumeFrom / match.totalChunks : 0,
            speedLabel: 'Ready',
            etaLabel: '',
            sessionId: match.sessionId,
            meta: {
              sessionId: match.sessionId,
              filename: match.filename,
              fileSize: match.fileSize,
              mimeType: match.mimeType,
              totalChunks: match.totalChunks,
              sha256: match.sha256,
            },
            lastAckedChunk: match.lastAckedChunk ?? -1,
            resumeFrom,
            error: '',
          };

          fileSessionsRef.current.set(match.sessionId, {
            file,
            itemId: id,
            meta: item.meta,
            sessionId: match.sessionId,
            lastAckedChunk: match.lastAckedChunk ?? -1,
            sending: false,
            restartFrom: null,
          });
          setReselectNeeded((previous) =>
            previous.filter((session) => session.sessionId !== match.sessionId),
          );

          return item;
        }

        return {
          id: generateSessionId(),
          file,
          filename: file.name || 'Untitled',
          fileSize: file.size,
          status: 'queued',
          progress: 0,
          speedLabel: 'Queued',
          etaLabel: '',
          error: '',
        };
      });

      setOutgoing((previous) => [...previous, ...nextItems]);
    },
    [],
  );

  const completeInbound = useCallback(
    async (sessionId) => {
      const session = await getSession(sessionId);

      if (!session) {
        return;
      }

      patchIncoming(sessionId, {
        status: 'verifying',
        speedLabel: 'Verifying',
        etaLabel: '',
      });

      const chunks = await getSessionChunks(sessionId);

      if (chunks.length < session.totalChunks) {
        throw new Error('Transfer ended before all chunks arrived.');
      }

      const blob = new Blob(
        chunks.map((chunk) => chunk.data),
        { type: session.mimeType || 'application/octet-stream' },
      );
      const checksum = await arrayBufferSha256(await blob.arrayBuffer());

      if (checksum !== session.sha256) {
        await saveSession({
          ...session,
          status: 'failed',
          error: 'Checksum failed',
        });
        patchIncoming(sessionId, {
          status: 'failed',
          error: 'Checksum failed. The file was not downloaded.',
        });
        addError(`Checksum failed for ${session.filename}.`);
        return;
      }

      const file = {
        sessionId,
        filename: session.filename,
        fileSize: session.fileSize,
        mimeType: session.mimeType,
        blob,
        url: URL.createObjectURL(blob),
        completedAt: Date.now(),
      };

      setCompleted((previous) => [file, ...previous]);
      patchIncoming(sessionId, {
        status: 'complete',
        progress: 1,
        speedLabel: 'Done',
        etaLabel: '0s',
      });
      await deleteSession(sessionId);
      await refreshResume();
      autoDownload(file);
    },
    [addError, patchIncoming, refreshResume],
  );

  const handleMeta = useCallback(
    async (message) => {
      const existing = await getSession(message.sessionId);

      if (existing?.direction === 'inbound') {
        upsertIncomingSession(existing);
        sendMessage({
          type: 'resume_request',
          sessionId: existing.sessionId,
          fromChunk: Math.max((existing.lastReceivedChunk ?? -1) + 1, 0),
        });
        return;
      }

      const session = await saveSession({
        sessionId: message.sessionId,
        filename: message.filename,
        fileSize: message.fileSize,
        mimeType: message.mimeType,
        totalChunks: message.totalChunks,
        sha256: message.sha256,
        direction: 'inbound',
        status: 'receiving',
        lastReceivedChunk: -1,
        receivedBytes: 0,
      });

      upsertIncomingSession(session);
      await refreshResume();
    },
    [refreshResume, sendMessage, upsertIncomingSession],
  );

  const handleChunk = useCallback(
    async (message) => {
      const session = await getSession(message.sessionId);

      if (!session || session.direction !== 'inbound') {
        sendMessage({
          type: 'resume_request',
          sessionId: message.sessionId,
          fromChunk: 0,
        });
        return;
      }

      const expectedChunk = Math.max((session.lastReceivedChunk ?? -1) + 1, 0);

      if (message.chunkIndex < expectedChunk) {
        sendMessage({
          type: 'ack',
          sessionId: message.sessionId,
          chunkIndex: message.chunkIndex,
        });
        return;
      }

      if (message.chunkIndex > expectedChunk) {
        sendMessage({
          type: 'resume_request',
          sessionId: message.sessionId,
          fromChunk: expectedChunk,
        });
        return;
      }

      const decrypted = await decryptBuffer(message.data, message.iv);
      await saveChunk(message.sessionId, message.chunkIndex, decrypted);

      const receivedBytes = Math.min(
        session.fileSize,
        (message.chunkIndex + 1) * CHUNK_SIZE,
      );
      const nextSession = await saveSession({
        ...session,
        status: 'receiving',
        lastReceivedChunk: message.chunkIndex,
        receivedBytes,
      });
      const stats =
        incomingStatsRef.current.get(message.sessionId) ||
        {
          startedAt: now(),
          startingBytes: Math.max(receivedBytes - decrypted.byteLength, 0),
        };
      incomingStatsRef.current.set(message.sessionId, stats);

      patchIncoming(message.sessionId, {
        receivedBytes,
        status: 'receiving',
        error: '',
        ...toTransferProgress(receivedBytes, session.fileSize, stats),
      });

      sendMessage({
        type: 'ack',
        sessionId: message.sessionId,
        chunkIndex: message.chunkIndex,
      });

      if (message.chunkIndex + 1 >= nextSession.totalChunks) {
        await completeInbound(message.sessionId);
      }
    },
    [completeInbound, decryptBuffer, patchIncoming, sendMessage],
  );

  const handleResumeRequest = useCallback(
    async (message) => {
      const session = fileSessionsRef.current.get(message.sessionId);

      if (session?.file) {
        await sendChunks(message.sessionId, message.fromChunk);
        return;
      }

      const storedSession = await getSession(message.sessionId);

      if (storedSession?.direction === 'outbound') {
        setReselectNeeded((previous) => {
          if (previous.some((item) => item.sessionId === storedSession.sessionId)) {
            return previous;
          }

          return [storedSession, ...previous];
        });
      }
    },
    [sendChunks],
  );

  useEffect(() => {
    return addMessageHandler((message) => {
      if (!message || typeof message !== 'object') {
        return;
      }

      if (message.type === 'meta') {
        void handleMeta(message).catch((error) => addError(error.message));
        return;
      }

      if (message.type === 'chunk') {
        void handleChunk(message).catch((error) => addError(error.message));
        return;
      }

      if (message.type === 'ack') {
        resolveAck(message.sessionId, message.chunkIndex);
        return;
      }

      if (message.type === 'resume_request') {
        void handleResumeRequest(message).catch((error) => addError(error.message));
      }
    });
  }, [
    addError,
    addMessageHandler,
    handleChunk,
    handleMeta,
    handleResumeRequest,
    resolveAck,
  ]);

  useEffect(() => {
    const updateVisibility = () => {
      setPausedByVisibility(document.visibilityState === 'hidden');
    };

    updateVisibility();
    document.addEventListener('visibilitychange', updateVisibility);

    return () => {
      document.removeEventListener('visibilitychange', updateVisibility);
    };
  }, []);

  useEffect(() => {
    if (connected) {
      return;
    }

    rejectAllAcks(new Error('Connection lost.'));
    activeRef.current = false;
    setOutgoing((previous) =>
      previous.map((item) =>
        item.status === 'transferring' || item.status === 'hashing'
          ? { ...item, status: 'interrupted', error: 'Connection lost.' }
          : item,
      ),
    );
    setIncoming((previous) =>
      previous.map((item) =>
        item.status === 'receiving'
          ? { ...item, status: 'interrupted', error: 'Connection lost.' }
          : item,
      ),
    );
  }, [connected, rejectAllAcks]);

  useEffect(() => {
    if (!connected) {
      return undefined;
    }

    let cancelled = false;

    async function requestResumes() {
      const sessions = await getIncompleteSessions('inbound');

      if (cancelled) {
        return;
      }

      sessions.forEach((session) => {
        upsertIncomingSession(session);
        sendMessage({
          type: 'resume_request',
          sessionId: session.sessionId,
          fromChunk: Math.max((session.lastReceivedChunk ?? -1) + 1, 0),
        });
      });
    }

    void requestResumes().catch((error) => addError(error.message));

    return () => {
      cancelled = true;
    };
  }, [addError, connected, sendMessage, upsertIncomingSession]);

  useEffect(() => {
    if (!connected || pausedByVisibility || activeRef.current) {
      return;
    }

    const next = outgoing.find((item) => item.status === 'queued');

    if (next) {
      void startQueuedFile(next);
    }
  }, [connected, outgoing, pausedByVisibility, startQueuedFile]);

  const retryInterrupted = useCallback(() => {
    setOutgoing((previous) =>
      previous.map((item) =>
        item.status === 'interrupted' && item.file
          ? { ...item, status: 'queued', error: '' }
          : item,
      ),
    );
  }, []);

  const downloadCompleted = useCallback(
    async (file) => {
      try {
        await saveCompletedFile(file);
      } catch (error) {
        addError(`Download failed for ${file.filename}: ${error.message}`);
      }
    },
    [addError],
  );

  const summary = useMemo(() => {
    const incompleteOutgoing = outgoing.filter((item) =>
      ['queued', 'hashing', 'transferring', 'interrupted'].includes(item.status),
    ).length;
    const incompleteIncoming = incoming.filter((item) =>
      ['receiving', 'verifying', 'interrupted', 'failed'].includes(item.status),
    ).length;

    return {
      completed: completed.length,
      incomplete: incompleteIncoming + incompleteOutgoing + reselectNeeded.length,
    };
  }, [completed.length, incoming, outgoing, reselectNeeded.length]);

  return {
    outgoing,
    incoming,
    completed,
    errors,
    addFiles,
    downloadCompleted,
    retryInterrupted,
    pausedByVisibility,
    reselectNeeded,
    isTransferring:
      outgoing.some((item) => ['hashing', 'transferring'].includes(item.status)) ||
      incoming.some((item) => ['receiving', 'verifying'].includes(item.status)),
    summary,
  };
}
