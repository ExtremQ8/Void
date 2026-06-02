const encoder = new TextEncoder();
const decoder = new TextDecoder();
const DEFAULT_PUBLIC_APP_URL = 'https://extremq8.github.io/Void/';

export function bytesToBase64Url(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = '';

  for (let index = 0; index < bytes.byteLength; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }

  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '');
}

export function base64UrlToBytes(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(
    normalized.length + ((4 - (normalized.length % 4)) % 4),
    '=',
  );
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

export async function generateAesKey() {
  return globalThis.crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt'],
  );
}

export async function exportAesKey(key) {
  const raw = await globalThis.crypto.subtle.exportKey('raw', key);
  return bytesToBase64Url(raw);
}

export async function importAesKey(serializedKey) {
  const raw = base64UrlToBytes(serializedKey);

  return globalThis.crypto.subtle.importKey(
    'raw',
    raw,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function encryptBuffer(key, buffer) {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const data = await globalThis.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    buffer,
  );

  return {
    iv: bytesToBase64Url(iv),
    data,
  };
}

export async function decryptBuffer(key, encryptedBuffer, iv) {
  return globalThis.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64UrlToBytes(iv) },
    key,
    encryptedBuffer,
  );
}

export async function encryptText(key, text) {
  return encryptBuffer(key, encoder.encode(text));
}

export async function decryptText(key, encryptedBuffer, iv) {
  const decrypted = await decryptBuffer(key, encryptedBuffer, iv);
  return decoder.decode(decrypted);
}

export function generateRoomCode(length = 6) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(length));

  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('');
}

export function generateSessionId() {
  if (globalThis.crypto.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0'));

  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex
    .slice(6, 8)
    .join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10).join('')}`;
}

export function parseKeyFromHash(hash = window.location.hash) {
  const value = hash.startsWith('#') ? hash.slice(1) : hash;
  const params = new URLSearchParams(value);
  return params.get('key') || '';
}

export function parseRoomInput(input) {
  const trimmed = input.trim();

  if (!trimmed) {
    return { roomCode: '', key: '' };
  }

  try {
    const url = new URL(trimmed);
    return {
      roomCode: (url.searchParams.get('room') || '').toUpperCase(),
      key: parseKeyFromHash(url.hash),
    };
  } catch {
    return {
      roomCode: trimmed.replace(/[^a-z0-9]/giu, '').toUpperCase(),
      key: '',
    };
  }
}

export function isPrivateShareHost(hostname = window.location.hostname) {
  const host = hostname.replace(/^\[|\]$/gu, '').toLowerCase();
  const secondOctet = Number(host.match(/^172\.(\d+)\./u)?.[1]);

  return (
    host === 'localhost' ||
    host === '0.0.0.0' ||
    host === '::1' ||
    host.endsWith('.local') ||
    /^127\./u.test(host) ||
    /^10\./u.test(host) ||
    /^192\.168\./u.test(host) ||
    (secondOctet >= 16 && secondOctet <= 31) ||
    /^f[cd][0-9a-f]{2}:/u.test(host) ||
    /^fe80:/u.test(host)
  );
}

export function getPublicAppUrl(env = import.meta.env) {
  return (env?.VITE_PUBLIC_APP_URL || env?.VITE_SHARE_BASE_URL || DEFAULT_PUBLIC_APP_URL).trim();
}

export function getShareUrlWarning(env = import.meta.env, location = window.location) {
  if (getPublicAppUrl(env) || !isPrivateShareHost(location.hostname)) {
    return '';
  }

  return 'This secure link uses a local address. A phone on cellular cannot open it.';
}

export function buildRoomUrl(roomCode, key, baseHref = getPublicAppUrl() || window.location.href) {
  const url = new URL(baseHref, window.location.href);
  url.search = '';
  url.hash = '';
  url.searchParams.set('room', roomCode);
  url.hash = `key=${key}`;
  return url.toString();
}
