export function bufferToHex(buffer) {
  return Array.from(new Uint8Array(buffer), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

export async function arrayBufferSha256(buffer) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', buffer);
  return bufferToHex(digest);
}

export async function fileSha256(file) {
  return arrayBufferSha256(await file.arrayBuffer());
}
