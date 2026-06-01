export default function ProgressBar({ value = 0 }) {
  const width = `${Math.max(0, Math.min(1, value)) * 100}%`;

  return (
    <div className="h-1 w-full overflow-hidden rounded-full bg-white/10">
      <div
        className="h-full rounded-full bg-[#0071e3] transition-all duration-200 ease-void"
        style={{ width }}
      />
    </div>
  );
}
