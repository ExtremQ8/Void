import { useCallback, useEffect, useState } from 'react';
import { getIncompleteSessions } from '../lib/db';

export function useResume() {
  const [inboundSessions, setInboundSessions] = useState([]);
  const [outboundSessions, setOutboundSessions] = useState([]);

  const refresh = useCallback(async () => {
    const [inbound, outbound] = await Promise.all([
      getIncompleteSessions('inbound'),
      getIncompleteSessions('outbound'),
    ]);

    setInboundSessions(inbound);
    setOutboundSessions(outbound);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return {
    inboundSessions,
    outboundSessions,
    hasIncomplete: inboundSessions.length > 0 || outboundSessions.length > 0,
    refresh,
  };
}
