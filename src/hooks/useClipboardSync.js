import { useCallback, useEffect, useRef, useState } from 'react';

const CLIPBOARD_DEBOUNCE = 120;

export function useClipboardSync({
  addMessageHandler,
  connected,
  decryptText,
  encryptText,
  sendMessage,
}) {
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const debounceRef = useRef(null);
  const connectedRef = useRef(connected);
  const textRef = useRef(text);

  useEffect(() => {
    connectedRef.current = connected;
  }, [connected]);

  useEffect(() => {
    textRef.current = text;
  }, [text]);

  const sendClipboard = useCallback(
    async (value) => {
      if (!connectedRef.current) {
        return;
      }

      try {
        const encrypted = await encryptText(value);
        const sent = sendMessage({
          type: 'clipboard',
          iv: encrypted.iv,
          data: encrypted.data,
        });

        if (sent) {
          setError('');
        }
      } catch (nextError) {
        setError(nextError.message);
      }
    },
    [encryptText, sendMessage],
  );

  const updateText = useCallback(
    (value) => {
      setText(value);
      window.clearTimeout(debounceRef.current);
      debounceRef.current = window.setTimeout(() => {
        sendClipboard(value);
      }, CLIPBOARD_DEBOUNCE);
    },
    [sendClipboard],
  );

  useEffect(() => {
    return addMessageHandler(async (message) => {
      if (message.type !== 'clipboard') {
        return;
      }

      try {
        const nextText = await decryptText(message.data, message.iv);
        setText(nextText);
        setError('');
      } catch (nextError) {
        setError('Clipboard message could not be decrypted.');
      }
    });
  }, [addMessageHandler, decryptText]);

  useEffect(
    () => () => {
      window.clearTimeout(debounceRef.current);
    },
    [],
  );

  return {
    text,
    updateText,
    error,
  };
}
