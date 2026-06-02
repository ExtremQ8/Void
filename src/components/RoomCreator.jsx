import QRCode from './QRCode';

export default function RoomCreator({
  copied,
  onCopyCode,
  onCopyLink,
  roomCode,
  shareWarning,
  shareUrl,
}) {
  return (
    <section className="fade-panel rounded-[20px] border border-void-border bg-void-surface p-5 text-center">
      <p className="text-sm font-medium text-void-muted">Room code</p>
      <button
        className="mt-3 w-full rounded-xl border border-white/10 bg-black px-4 py-4 font-mono text-4xl font-bold tracking-normal text-white transition hover:border-[#0071e3]/60 focus:outline-none focus:ring-2 focus:ring-[#0071e3]"
        onClick={onCopyCode}
        type="button"
      >
        {roomCode}
      </button>

      <div className="mt-5">
        <QRCode value={shareUrl} />
      </div>

      {shareWarning ? (
        <p className="mt-4 rounded-xl border border-[#ffd60a]/20 bg-[#ffd60a]/10 px-3 py-2 text-left text-xs leading-5 text-[#ffd60a]">
          {shareWarning}
        </p>
      ) : null}

      <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <button
          className="rounded-xl bg-[#0071e3] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#147ce5] focus:outline-none focus:ring-2 focus:ring-[#58aaff]"
          onClick={onCopyLink}
          type="button"
        >
          {copied === 'link' ? 'Copied' : 'Copy secure link'}
        </button>
        <button
          className="rounded-xl border border-white/18 px-4 py-3 text-sm font-semibold text-white transition hover:border-white/35 focus:outline-none focus:ring-2 focus:ring-white/25"
          onClick={onCopyCode}
          type="button"
        >
          {copied === 'code' ? 'Copied' : 'Copy code'}
        </button>
      </div>

      <p className="mt-5 text-sm text-void-muted">Waiting for peer</p>
    </section>
  );
}
