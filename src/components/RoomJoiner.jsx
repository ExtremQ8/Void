import { useEffect, useState } from 'react';

export default function RoomJoiner({
  autoRoomCode,
  error,
  isConnecting,
  onCreateRoom,
  onJoin,
}) {
  const [value, setValue] = useState(autoRoomCode || '');

  useEffect(() => {
    if (autoRoomCode) {
      setValue(autoRoomCode);
    }
  }, [autoRoomCode]);

  return (
    <section className="fade-panel rounded-[20px] border border-void-border bg-void-surface p-5">
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          onJoin(value);
        }}
      >
        <input
          autoCapitalize="characters"
          autoComplete="off"
          className="w-full rounded-xl border border-white/10 bg-black px-4 py-4 font-mono text-2xl font-semibold tracking-normal text-white outline-none transition placeholder:font-sans placeholder:text-base placeholder:font-normal placeholder:text-void-muted focus:border-[#0071e3] focus:ring-2 focus:ring-[#0071e3]/35"
          onChange={(event) => setValue(event.target.value)}
          placeholder="Room code or secure link"
          value={value}
        />
        <button
          className="w-full rounded-xl bg-[#0071e3] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#147ce5] disabled:cursor-not-allowed disabled:opacity-50"
          disabled={isConnecting}
          type="submit"
        >
          {isConnecting ? 'Connecting' : 'Connect'}
        </button>
      </form>

      {error ? <p className="mt-3 text-sm text-[#ff453a]">{error}</p> : null}

      <button
        className="mt-4 w-full rounded-xl border border-white/18 px-4 py-3 text-sm font-semibold text-white transition hover:border-white/35"
        onClick={onCreateRoom}
        type="button"
      >
        Start new room
      </button>
    </section>
  );
}
