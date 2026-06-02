import { useCallback, useEffect, useRef, useState } from 'react';
import Peer from 'peerjs';
import { getIceDiagnostics, getPeerConfig } from '../lib/ice';

const ROOM_PREFIX = 'void-';
const RECONNECT_LIMIT = 3;
const RECONNECT_DELAY = 10_000;
const RELAY_FALLBACK_DELAY = 12_000;
const peerDiagnostics = getIceDiagnostics();

function getPeerOptions(forceRelay = false) {
  return {
    config: getPeerConfig(
      forceRelay
        ? {
            ...import.meta.env,
            VITE_ICE_TRANSPORT_POLICY: 'relay',
          }
        : import.meta.env,
    ),
    debug: 1,
  };
}

const initialState = {
  status: 'idle',
  roomCode: '',
  peerId: '',
  remotePeerId: '',
  isHost: false,
  reconnectAttempt: 0,
  message: '',
  error: '',
  iceState: '',
  relayMode: 'direct',
};

export function usePeer() {
  const [state, setState] = useState(initialState);
  const peerRef = useRef(null);
  const connectionRef = useRef(null);
  const handlersRef = useRef(new Set());
  const reconnectTimerRef = useRef(null);
  const relayFallbackTimerRef = useRef(null);
  const reconnectAttemptRef = useRef(0);
  const roomCodeRef = useRef('');
  const remotePeerIdRef = useRef('');
  const isHostRef = useRef(false);
  const lockedRef = useRef(false);
  const shouldReconnectRef = useRef(true);
  const forceRelayRef = useRef(false);
  const scheduleReconnectRef = useRef(null);

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  const clearRelayFallbackTimer = useCallback(() => {
    if (relayFallbackTimerRef.current) {
      window.clearTimeout(relayFallbackTimerRef.current);
      relayFallbackTimerRef.current = null;
    }
  }, []);

  const resetConnection = useCallback(() => {
    clearReconnectTimer();
    clearRelayFallbackTimer();

    if (connectionRef.current) {
      connectionRef.current.close();
      connectionRef.current = null;
    }

    if (peerRef.current && !peerRef.current.destroyed) {
      peerRef.current.destroy();
    }

    peerRef.current = null;
  }, [clearReconnectTimer, clearRelayFallbackTimer]);

  const emitMessage = useCallback((message) => {
    handlersRef.current.forEach((handler) => handler(message));
  }, []);

  const attachConnection = useCallback(
    (connection) => {
      const knownRemote = remotePeerIdRef.current;
      const canAccept =
        !lockedRef.current ||
        !knownRemote ||
        knownRemote === connection.peer;

      if (!canAccept) {
        connection.on('open', () => {
          connection.send({
            type: 'room_locked',
            message: 'This room already has two peers.',
          });
          window.setTimeout(() => connection.close(), 100);
        });
        return;
      }

      if (connectionRef.current && connectionRef.current !== connection) {
        connectionRef.current.close();
      }

      connectionRef.current = connection;
      remotePeerIdRef.current = connection.peer;

      connection.on('open', () => {
        clearReconnectTimer();
        clearRelayFallbackTimer();
        reconnectAttemptRef.current = 0;
        lockedRef.current = true;

        setState((previous) => ({
          ...previous,
          status: 'connected',
          remotePeerId: connection.peer,
          reconnectAttempt: 0,
          message: 'Connected',
          error: '',
          iceState: connection.peerConnection?.iceConnectionState || 'connected',
          relayMode: forceRelayRef.current ? 'relay' : previous.relayMode,
        }));
      });

      connection.on('iceStateChanged', (iceState) => {
        setState((previous) => ({
          ...previous,
          iceState,
        }));
      });

      connection.on('data', emitMessage);

      connection.on('close', () => {
        if (connectionRef.current !== connection) {
          return;
        }

        connectionRef.current = null;
        setState((previous) => ({
          ...previous,
          status: 'disconnected',
          message: 'Peer disconnected — attempting to reconnect',
          iceState: connection.peerConnection?.iceConnectionState || previous.iceState,
        }));
        scheduleReconnectRef.current?.();
      });

      connection.on('error', (error) => {
        setState((previous) => ({
          ...previous,
          status: 'disconnected',
          message: 'Connection error — attempting to reconnect',
          error: error.message,
          iceState: connection.peerConnection?.iceConnectionState || previous.iceState,
        }));
        scheduleReconnectRef.current?.();
      });
    },
    [clearReconnectTimer, clearRelayFallbackTimer, emitMessage],
  );

  const connectToHost = useCallback(() => {
    const peer = peerRef.current;
    const roomCode = roomCodeRef.current;

    if (!peer || peer.destroyed || !roomCode) {
      return false;
    }

    if (peer.disconnected) {
      peer.reconnect();
    }

    if (!peer.open) {
      return false;
    }

    const connection = peer.connect(`${ROOM_PREFIX}${roomCode}`, {
      reliable: true,
      serialization: 'binary',
      metadata: { app: 'void' },
    });
    attachConnection(connection);
    return true;
  }, [attachConnection]);

  const scheduleReconnect = useCallback(() => {
    if (!shouldReconnectRef.current) {
      return;
    }

    clearReconnectTimer();

    if (reconnectAttemptRef.current >= RECONNECT_LIMIT) {
      setState((previous) => ({
        ...previous,
        status: 'interrupted',
        reconnectAttempt: RECONNECT_LIMIT,
        message: 'Transfer interrupted',
      }));
      return;
    }

    reconnectAttemptRef.current += 1;
    setState((previous) => ({
        ...previous,
        status: 'disconnected',
        reconnectAttempt: reconnectAttemptRef.current,
        message: 'Peer disconnected — attempting to reconnect',
    }));

    reconnectTimerRef.current = window.setTimeout(() => {
      if (isHostRef.current) {
        scheduleReconnect();
        return;
      }

      const started = connectToHost();

      if (!started) {
        scheduleReconnect();
      }
    }, RECONNECT_DELAY);
  }, [clearReconnectTimer, connectToHost]);

  scheduleReconnectRef.current = scheduleReconnect;

  const startHost = useCallback(
    (roomCode, forceRelay = false) => {
      shouldReconnectRef.current = true;
      forceRelayRef.current = forceRelay;
      resetConnection();
      lockedRef.current = false;
      reconnectAttemptRef.current = 0;
      roomCodeRef.current = roomCode;
      isHostRef.current = true;
      remotePeerIdRef.current = '';

      setState({
        ...initialState,
        status: 'connecting',
        roomCode,
        isHost: true,
        message: forceRelay ? 'Creating relay room' : 'Creating room',
        relayMode: forceRelay ? 'relay' : 'direct',
      });

      const peer = new Peer(`${ROOM_PREFIX}${roomCode}`, getPeerOptions(forceRelay));
      peerRef.current = peer;

      peer.on('open', (id) => {
        setState((previous) => ({
          ...previous,
          status: 'waiting',
          peerId: id,
          message: forceRelay ? 'Waiting through relay' : 'Waiting for peer',
        }));
      });

      peer.on('connection', attachConnection);

      peer.on('disconnected', () => {
        if (!peer.destroyed) {
          peer.reconnect();
        }
      });

      peer.on('error', (error) => {
        setState((previous) => ({
          ...previous,
          status: 'error',
          error: error.message,
          message:
            error.type === 'unavailable-id'
              ? 'Room code is already in use. Try creating a new room.'
              : error.message,
        }));
      });

      if (!forceRelay) {
        relayFallbackTimerRef.current = window.setTimeout(() => {
          if (connectionRef.current?.open || forceRelayRef.current || !roomCodeRef.current) {
            return;
          }

          startHost(roomCodeRef.current, true);
        }, RELAY_FALLBACK_DELAY);
      }
    },
    [attachConnection, resetConnection],
  );

  const joinRoom = useCallback(
    (roomCode, forceRelay = false) => {
      shouldReconnectRef.current = true;
      forceRelayRef.current = forceRelay;
      resetConnection();
      lockedRef.current = false;
      reconnectAttemptRef.current = 0;
      roomCodeRef.current = roomCode;
      isHostRef.current = false;
      remotePeerIdRef.current = `${ROOM_PREFIX}${roomCode}`;

      setState({
        ...initialState,
        status: 'connecting',
        roomCode,
        isHost: false,
        message: forceRelay ? 'Connecting through relay' : 'Connecting',
        relayMode: forceRelay ? 'relay' : 'direct',
      });

      const peer = new Peer(undefined, getPeerOptions(forceRelay));
      peerRef.current = peer;

      peer.on('open', (id) => {
        setState((previous) => ({
          ...previous,
          peerId: id,
          message: forceRelay ? 'Connecting through relay' : 'Connecting',
        }));
        connectToHost();
      });

      peer.on('disconnected', () => {
        if (!peer.destroyed) {
          peer.reconnect();
        }
      });

      peer.on('error', (error) => {
        setState((previous) => ({
          ...previous,
          status: 'error',
          error: error.message,
          message: error.message,
        }));
      });

      if (!forceRelay) {
        relayFallbackTimerRef.current = window.setTimeout(() => {
          if (connectionRef.current?.open || forceRelayRef.current || !roomCodeRef.current) {
            return;
          }

          joinRoom(roomCodeRef.current, true);
        }, RELAY_FALLBACK_DELAY);
      }
    },
    [connectToHost, resetConnection],
  );

  const manualRetry = useCallback(() => {
    reconnectAttemptRef.current = 0;
    clearReconnectTimer();

    if (isHostRef.current) {
      forceRelayRef.current = false;
      setState((previous) => ({
        ...previous,
        status: 'waiting',
        reconnectAttempt: 0,
        message: 'Waiting for peer',
      }));
      scheduleReconnect();
      return;
    }

    forceRelayRef.current = false;
    setState((previous) => ({
      ...previous,
      status: 'connecting',
      reconnectAttempt: 0,
      message: 'Connecting',
    }));
    connectToHost();
  }, [clearReconnectTimer, connectToHost, scheduleReconnect]);

  const addMessageHandler = useCallback((handler) => {
    handlersRef.current.add(handler);
    return () => handlersRef.current.delete(handler);
  }, []);

  const sendMessage = useCallback((message) => {
    const connection = connectionRef.current;

    if (!connection || !connection.open) {
      return false;
    }

    connection.send(message);
    return true;
  }, []);

  const getConnection = useCallback(() => connectionRef.current, []);

  useEffect(
    () => () => {
      shouldReconnectRef.current = false;
      resetConnection();
    },
    [resetConnection],
  );

  return {
    ...state,
    connected: state.status === 'connected',
    startHost,
    joinRoom,
    manualRetry,
    addMessageHandler,
    sendMessage,
    getConnection,
    network: {
      ...peerDiagnostics,
      iceState: state.iceState,
      relayMode: state.relayMode,
    },
  };
}
