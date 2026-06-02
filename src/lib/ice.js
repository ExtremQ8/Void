import * as peerjs from 'peerjs';

const VALID_TRANSPORT_POLICIES = new Set(['all', 'relay']);
const DEFAULT_ICE_CANDIDATE_POOL_SIZE = 4;

function splitList(value = '') {
  return value
    .split(/[\s,]+/u)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeIceServer(server) {
  if (!server?.urls) {
    return null;
  }

  const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
  const normalizedUrls = urls.map((url) => String(url).trim()).filter(Boolean);

  if (normalizedUrls.length === 0) {
    return null;
  }

  return {
    ...server,
    urls: normalizedUrls,
  };
}

function parseJsonIceServers(value) {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    const servers = Array.isArray(parsed) ? parsed : [parsed];
    return servers.map(normalizeIceServer).filter(Boolean);
  } catch (error) {
    console.warn('Ignoring invalid VITE_ICE_SERVERS JSON.', error);
    return [];
  }
}

function buildEnvIceServers(env = import.meta.env) {
  const servers = parseJsonIceServers(env?.VITE_ICE_SERVERS);
  const stunUrls = splitList(env?.VITE_STUN_URLS);
  const turnUrls = splitList(env?.VITE_TURN_URLS);

  if (stunUrls.length > 0) {
    servers.push({ urls: stunUrls });
  }

  if (turnUrls.length > 0) {
    servers.push({
      urls: turnUrls,
      username: env?.VITE_TURN_USERNAME || undefined,
      credential: env?.VITE_TURN_CREDENTIAL || undefined,
    });
  }

  return servers;
}

function dedupeIceServers(servers) {
  const seen = new Set();

  return servers
    .map(normalizeIceServer)
    .filter(Boolean)
    .filter((server) => {
      const key = JSON.stringify({
        credential: server.credential || '',
        urls: server.urls,
        username: server.username || '',
      });

      if (seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    });
}

function getServerUrls(server) {
  if (!server?.urls) {
    return [];
  }

  return Array.isArray(server.urls) ? server.urls : [server.urls];
}

export function getIceDiagnostics(env = import.meta.env) {
  const config = getPeerConfig(env);
  const urls = config.iceServers.flatMap(getServerUrls);
  const customUrls = buildEnvIceServers(env).flatMap(getServerUrls);

  return {
    hasCustomTurnServer: customUrls.some((url) => /^turns?:/u.test(String(url))),
    hasStunServer: urls.some((url) => String(url).startsWith('stun:')),
    hasTurnServer: urls.some((url) => /^turns?:/u.test(String(url))),
    iceServerCount: config.iceServers.length,
    iceTransportPolicy: config.iceTransportPolicy || 'all',
  };
}

export function getPeerConfig(env = import.meta.env) {
  const peerUtil = peerjs.util || peerjs.default?.util || {};
  const defaultConfig = peerUtil.defaultConfig || {};
  const transportPolicy = env?.VITE_ICE_TRANSPORT_POLICY;
  const poolSize = Number(env?.VITE_ICE_CANDIDATE_POOL_SIZE);
  const config = {
    ...defaultConfig,
    iceServers: dedupeIceServers([
      ...(defaultConfig.iceServers || []),
      ...buildEnvIceServers(env),
    ]),
    iceCandidatePoolSize: Number.isFinite(poolSize)
      ? poolSize
      : DEFAULT_ICE_CANDIDATE_POOL_SIZE,
  };

  if (VALID_TRANSPORT_POLICIES.has(transportPolicy)) {
    config.iceTransportPolicy = transportPolicy;
  }

  return config;
}
