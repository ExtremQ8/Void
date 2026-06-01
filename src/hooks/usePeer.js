import { useCallback, useEffect, useRef, useState } from 'react';
import Peer from 'peerjs';

const ROOM_PREFIX = 'void-';
const RECONNECT_LIMIT = 3;
const RECONNECT_DELAY = 10_000;

const initialState = {
  status: 'idle',
  roomCode: '',
  peerId: '',
  remotePeerId: '',
  isHost: false,
  reconnectAttempt: 0,
  message: '',
  error: '',
};

export function usePeer() {
  const [state, setState] = useState(initialState);
  const peerRef = useRef(null);
  const connectionRef = useRef(null);
  const handlersRef = useRef(new Set());
  const reconnectTimerRef = useRef(null);
  const reconnectAttemptRef = useRef(0);
  const roomCodeRef = useRef('');
  const remotePeerIdRef = useRef('');
  const isHostRef = useRef(false);
  const lockedRef = useRef(false);
  const shouldReconnectRef = useRef(true);
  const scheduleReconnectRef = useRef(null);

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  const resetConnection = useCallback(() => {
    clearReconnectTimer();

    if (connectionRef.current) {
      connectionRef.current.close();
      connectionRef.current = null;
    }

    if (peerRef.current && !peerRef.current.destroyed) {
      peerRef.current.destroy();
    }

    peerRef.current = null;
  }, [clearReconnectTimer]);

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
        reconnectAttemptRef.current = 0;
        lockedRef.current = true;

        setState((previous) => ({
          ...previous,
          status: 'connected',
          remotePeerId: connection.peer,
          reconnectAttempt: 0,
          message: 'Connected',
          error: '',
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
        }));
        scheduleReconnectRef.current?.();
      });

      connection.on('error', (error) => {
        setState((previous) => ({
          ...previous,
          status: 'disconnected',
          message: 'Connection error — attempting to reconnect',
          error: error.message,
        }));
        scheduleReconnectRef.current?.();
      });
    },
    [clearReconnectTimer, emitMessage],
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
    (roomCode) => {
      shouldReconnectRef.current = true;
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
        message: 'Creating room',
      });

      const peer = new Peer(`${ROOM_PREFIX}${roomCode}`, {
        debug: 1,
      });
      peerRef.current = peer;

      peer.on('open', (id) => {
        setState((previous) => ({
          ...previous,
          status: 'waiting',
          peerId: id,
          message: 'Waiting for peer',
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
    },
    [attachConnection, resetConnection],
  );

  const joinRoom = useCallback(
    (roomCode) => {
      shouldReconnectRef.current = true;
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
        message: 'Connecting',
      });

      const peer = new Peer(undefined, {
        debug: 1,
      });
      peerRef.current = peer;

      peer.on('open', (id) => {
        setState((previous) => ({
          ...previous,
          peerId: id,
          message: 'Connecting',
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
    },
    [connectToHost, resetConnection],
  );

  const manualRetry = useCallback(() => {
    reconnectAttemptRef.current = 0;
    clearReconnectTimer();

    if (isHostRef.current) {
      setState((previous) => ({
        ...previous,
        status: 'waiting',
        reconnectAttempt: 0,
        message: 'Waiting for peer',
      }));
      scheduleReconnect();
      return;
    }

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
  };
}
