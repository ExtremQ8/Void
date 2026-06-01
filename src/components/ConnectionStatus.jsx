const toneClass = {
  Waiting: 'border-white/10 bg-white/5 text-[#8e8e93]',
  Connecting: 'border-[#ffd60a]/20 bg-[#ffd60a]/10 text-[#ffd60a]',
  Connected: 'border-[#34c759]/20 bg-[#34c759]/10 text-[#34c759]',
  Transferring: 'border-[#0071e3]/30 bg-[#0071e3]/15 text-[#58aaff]',
  Done: 'border-[#34c759]/20 bg-[#34c759]/10 text-[#34c759]',
  Disconnected: 'border-[#ff453a]/25 bg-[#ff453a]/10 text-[#ff453a]',
  Paused: 'border-[#ffd60a]/20 bg-[#ffd60a]/10 text-[#ffd60a]',
};

export default function ConnectionStatus({ label }) {
  return (
    <div
      className={`absolute right-0 top-0 rounded-full border px-3 py-1 text-xs font-semibold ${
        toneClass[label] || toneClass.Waiting
      }`}
    >
      {label}
    </div>
  );
}
