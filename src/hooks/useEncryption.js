import { useCallback, useMemo, useState } from 'react';
import {
  decryptBuffer,
  decryptText,
  encryptBuffer,
  encryptText,
  exportAesKey,
  generateAesKey,
  importAesKey,
} from '../lib/crypto';

export function useEncryption() {
  const [key, setKey] = useState(null);
  const [serializedKey, setSerializedKey] = useState('');
  const [error, setError] = useState('');

  const createKey = useCallback(async () => {
    try {
      const nextKey = await generateAesKey();
      const exported = await exportAesKey(nextKey);
      setKey(nextKey);
      setSerializedKey(exported);
      setError('');
      return exported;
    } catch (nextError) {
      setError(nextError.message);
      throw nextError;
    }
  }, []);

  const importKey = useCallback(async (value) => {
    try {
      const nextKey = await importAesKey(value);
      setKey(nextKey);
      setSerializedKey(value);
      setError('');
      return nextKey;
    } catch (nextError) {
      setError('The secure link key is invalid.');
      throw nextError;
    }
  }, []);

  const requireKey = useCallback(() => {
    if (!key) {
      throw new Error('Encryption key is not ready.');
    }

    return key;
  }, [key]);

  return useMemo(
    () => ({
      ready: Boolean(key),
      key,
      serializedKey,
      error,
      createKey,
      importKey,
      encryptBuffer: (buffer) => encryptBuffer(requireKey(), buffer),
      decryptBuffer: (buffer, iv) => decryptBuffer(requireKey(), buffer, iv),
      encryptText: (text) => encryptText(requireKey(), text),
      decryptText: (buffer, iv) => decryptText(requireKey(), buffer, iv),
    }),
    [createKey, error, importKey, key, requireKey, serializedKey],
  );
}
