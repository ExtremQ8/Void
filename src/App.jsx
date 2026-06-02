import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ClipboardSync from './components/ClipboardSync';
import ConnectionStatus from './components/ConnectionStatus';
import FileDropZone from './components/FileDropZone';
import FileQueue from './components/FileQueue';
import RoomCreator from './components/RoomCreator';
import RoomJoiner from './components/RoomJoiner';
import { useClipboardSync } from './hooks/useClipboardSync';
import { useEncryption } from './hooks/useEncryption';
import { usePeer } from './hooks/usePeer';
import { useResume } from './hooks/useResume';
import { useTransfer } from './hooks/useTransfer';
import { buildRoomUrl, generateRoomCode, parseKeyFromHash, parseRoomInput } from './lib/crypto';

async function copyText(value) {
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    const textarea = document.createElement('textarea');
    textarea.value = value;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    textarea.remove();
  }
}

function getInitialRoomCode() {
  return (new URLSearchParams(window.location.search).get('room') || '').toUpperCase();
}

function ResumeBanner({ inboundSessions, outboundSessions }) {
  const inbound = inboundSessions[0];
  const outbound = outboundSessions[0];

  if (!inbound && !outbound) {
    return null;
  }

  if (inbound) {
    const received = Math.max((inbound.lastReceivedChunk ?? -1) + 1, 0);
    const percent = inbound.totalChunks
      ? Math.round((received / inbound.totalChunks) * 100)
      : 0;

    return (
      <div className="fade-panel rounded-[20px] border border-[#ffd60a]/20 bg-[#ffd60a]/10 p-4">
        <p className="text-sm font-semibold text-white">
          Incomplete transfer found: {inbound.filename} — {percent}% received.
        </p>
        <p className="mt-1 text-xs text-[#ffd60a]">Reconnect with the sender to resume.</p>
      </div>
    );
  }

  const sent = Math.max((outbound.lastAckedChunk ?? -1) + 1, 0);
  const percent = outbound.totalChunks ? Math.round((sent / outbound.totalChunks) * 100) : 0;

  return (
    <div className="fade-panel rounded-[20px] border border-[#ffd60a]/20 bg-[#ffd60a]/10 p-4">
      <p className="text-sm font-semibold text-white">
        Incomplete transfer found: {outbound.filename} — {percent}% sent.
      </p>
      <p className="mt-1 text-xs text-[#ffd60a]">Re-select the file after reconnecting.</p>
    </div>
  );
}

export default function App() {
  const initialRoomRef = useRef(getInitialRoomCode());
  const initialKeyRef = useRef(parseKeyFromHash());
  const bootstrappedRef = useRef(false);
  const [mode, setMode] = useState(initialRoomRef.current ? 'join' : 'create');
  const [roomCode, setRoomCode] = useState(initialRoomRef.current || '');
  const [shareUrl, setShareUrl] = useState('');
  const [joinError, setJoinError] = useState('');
  const [copied, setCopied] = useState('');

  const encryption = useEncryption();
  const peer = usePeer();
  const resume = useResume();

  const transfer = useTransfer({
    addMessageHandler: peer.addMessageHandler,
    connected: peer.connected && encryption.ready,
    decryptBuffer: encryption.decryptBuffer,
    encryptBuffer: encryption.encryptBuffer,
    getConnection: peer.getConnection,
    refreshResume: resume.refresh,
    sendMessage: peer.sendMessage,
  });

  const clipboard = useClipboardSync({
    addMessageHandler: peer.addMessageHandler,
    connected: peer.connected && encryption.ready,
    decryptText: encryption.decryptText,
    encryptText: encryption.encryptText,
    sendMessage: peer.sendMessage,
  });

  const createRoom = useCallback(async () => {
    const nextRoomCode = generateRoomCode();
    setMode('create');
    setRoomCode(nextRoomCode);
    setJoinError('');
    const key = await encryption.createKey();
    setShareUrl(buildRoomUrl(nextRoomCode, key));
    peer.startHost(nextRoomCode);
  }, [encryption, peer]);

  const joinRoom = useCallback(
    async (value) => {
      const parsed = parseRoomInput(value);
      const nextRoomCode = parsed.roomCode;
      const nextKey = parsed.key || encryption.serializedKey || parseKeyFromHash();

      if (!nextRoomCode) {
        setJoinError('Enter a room code or secure link.');
        return;
      }

      if (!nextKey) {
        setJoinError('Paste the secure link so Void can import the room key.');
        return;
      }

      try {
        await encryption.importKey(nextKey);
        setMode('join');
        setRoomCode(nextRoomCode);
        setJoinError('');
        peer.joinRoom(nextRoomCode);
      } catch {
        setJoinError('The secure link key is invalid.');
      }
    },
    [encryption, peer],
  );

  useEffect(() => {
    if (bootstrappedRef.current) {
      return;
    }

    bootstrappedRef.current = true;

    if (initialRoomRef.current) {
      if (initialKeyRef.current) {
        void joinRoom(window.location.href);
      } else {
        setJoinError('Secure key missing from the URL.');
      }
      return;
    }

    void createRoom();
  }, [createRoom, joinRoom]);

  const copyCode = useCallback(async () => {
    await copyText(roomCode);
    setCopied('code');
    window.setTimeout(() => setCopied(''), 1200);
  }, [roomCode]);

  const copyLink = useCallback(async () => {
    await copyText(shareUrl);
    setCopied('link');
    window.setTimeout(() => setCopied(''), 1200);
  }, [shareUrl]);

  const statusLabel = useMemo(() => {
    if (transfer.pausedByVisibility && peer.connected) {
      return 'Paused';
    }

    if (transfer.isTransferring) {
      return 'Transferring';
    }

    if (peer.connected && transfer.completed.length > 0 && transfer.summary.incomplete === 0) {
      return 'Done';
    }

    if (peer.connected) {
      return 'Connected';
    }

    if (peer.status === 'waiting') {
      return 'Waiting';
    }

    if (peer.status === 'disconnected' || peer.status === 'interrupted' || peer.status === 'error') {
      return 'Disconnected';
    }

    return 'Connecting';
  }, [
    peer.connected,
    peer.status,
    transfer.completed.length,
    transfer.isTransferring,
    transfer.pausedByVisibility,
    transfer.summary.incomplete,
  ]);

  const connectedReady = peer.connected && encryption.ready;
  const showJoiner = mode === 'join' && !connectedReady;
  const showCreator = mode === 'create' && !connectedReady;

  return (
    <main className="min-h-screen bg-void-bg px-4 py-5 text-white sm:px-6 sm:py-8">
      <div className="relative mx-auto flex min-h-[calc(100vh-40px)] w-full max-w-[480px] flex-col justify-center pt-10">
        <ConnectionStatus label={statusLabel} />

        <div className="space-y-4">
          <header className="fade-panel">
            <h1 className="text-4xl font-bold tracking-normal text-white">Void</h1>
            <p className="mt-2 text-sm leading-6 text-void-muted">
              Encrypted peer-to-peer transfer, directly between browsers.
            </p>
          </header>

          <ResumeBanner
            inboundSessions={resume.inboundSessions}
            outboundSessions={resume.outboundSessions}
          />

          {peer.status === 'disconnected' ? (
            <div className="fade-panel flex items-center gap-3 rounded-[20px] border border-white/10 bg-void-surface p-4">
              <div className="spinner" />
              <div>
                <p className="text-sm font-semibold text-white">
                  Peer disconnected — attempting to reconnect
                </p>
                <p className="mt-1 text-xs text-void-muted">
                  Attempt {peer.reconnectAttempt} of 3
                </p>
              </div>
            </div>
          ) : null}

          {peer.status === 'interrupted' ? (
            <div className="fade-panel rounded-[20px] border border-[#ff453a]/20 bg-[#ff453a]/10 p-4">
              <p className="text-sm font-semibold text-white">Transfer interrupted</p>
              <p className="mt-1 text-xs text-[#ff9f92]">
                {transfer.summary.completed} completed, {transfer.summary.incomplete} incomplete.
              </p>
              <button
                className="mt-3 rounded-xl border border-white/18 px-4 py-2 text-sm font-semibold text-white transition hover:border-white/35"
                onClick={() => {
                  peer.manualRetry();
                  transfer.retryInterrupted();
                }}
                type="button"
              >
                Retry
              </button>
            </div>
          ) : null}

          {peer.status === 'error' && mode === 'create' ? (
            <div className="fade-panel rounded-[20px] border border-[#ff453a]/20 bg-[#ff453a]/10 p-4">
              <p className="text-sm font-semibold text-white">{peer.message || 'Room error'}</p>
              <button
                className="mt-3 rounded-xl border border-white/18 px-4 py-2 text-sm font-semibold text-white transition hover:border-white/35"
                onClick={createRoom}
                type="button"
              >
                New room
              </button>
            </div>
          ) : null}

          {transfer.pausedByVisibility && peer.connected ? (
            <div className="fade-panel rounded-[20px] border border-[#ffd60a]/20 bg-[#ffd60a]/10 p-4">
              <p className="text-sm font-semibold text-white">
                Transfer paused — app is in background
              </p>
            </div>
          ) : null}

          {showCreator ? (
            <RoomCreator
              copied={copied}
              onCopyCode={copyCode}
              onCopyLink={copyLink}
              roomCode={roomCode}
              shareUrl={shareUrl}
            />
          ) : null}

          {showJoiner ? (
            <RoomJoiner
              autoRoomCode={roomCode}
              error={joinError || encryption.error || (peer.status === 'error' ? peer.message : '')}
              isConnecting={peer.status === 'connecting'}
              onCreateRoom={createRoom}
              onJoin={joinRoom}
            />
          ) : null}

          {connectedReady ? (
            <>
              <ClipboardSync
                error={clipboard.error}
                onChange={clipboard.updateText}
                value={clipboard.text}
              />
              <FileDropZone onFiles={transfer.addFiles} />
            </>
          ) : null}

          <FileQueue
            completed={transfer.completed}
            incoming={transfer.incoming}
            onDownload={transfer.downloadCompleted}
            outgoing={transfer.outgoing}
            reselectNeeded={transfer.reselectNeeded}
          />

          {transfer.errors.map((error) => (
            <p className="text-sm text-[#ff453a]" key={error.id}>
              {error.message}
            </p>
          ))}
        </div>
      </div>
    </main>
  );
}
