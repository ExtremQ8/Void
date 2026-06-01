export default function ClipboardSync({ error, onChange, value }) {
  return (
    <section className="fade-panel">
      <textarea
        className="min-h-32 w-full resize-y rounded-xl border border-white/10 bg-void-surface px-4 py-4 text-base text-white outline-none transition placeholder:text-void-muted focus:border-[#0071e3] focus:ring-2 focus:ring-[#0071e3]/35"
        onChange={(event) => onChange(event.target.value)}
        placeholder="Paste anything — syncs instantly"
        spellCheck="false"
        value={value}
      />
      {error ? <p className="mt-2 text-sm text-[#ff453a]">{error}</p> : null}
    </section>
  );
}
