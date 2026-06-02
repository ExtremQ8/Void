import { formatBytes } from '../lib/chunker';
import ProgressBar from './ProgressBar';

function TransferRow({ item, title }) {
  const statusText = item.error || item.speedLabel || item.status;
  const eta = item.etaLabel ? ` - ${item.etaLabel}` : '';

  return (
    <article className="rounded-[20px] border border-void-border bg-void-surface p-4">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-white">{item.filename}</p>
          <p className="mt-1 text-xs text-void-muted">
            {title} - {formatBytes(item.fileSize)}
          </p>
        </div>
        <p className="shrink-0 text-right text-xs text-void-muted">
          {Math.round((item.progress || 0) * 100)}%
        </p>
      </div>
      <div className="mt-3">
        <ProgressBar value={item.progress || 0} />
      </div>
      <p
        className={`mt-2 truncate text-xs ${
          item.error || item.status === 'failed' ? 'text-[#ff453a]' : 'text-void-muted'
        }`}
      >
        {statusText}
        {eta}
      </p>
    </article>
  );
}

function CompletedRow({ item, onDownload }) {
  return (
    <article className="rounded-[20px] border border-void-border bg-void-surface p-4">
      <div className="flex min-w-0 items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-white">{item.filename}</p>
          <p className="mt-1 text-xs text-void-muted">{formatBytes(item.fileSize)} - verified</p>
        </div>
        <button
          className="shrink-0 rounded-xl border border-white/18 px-3 py-2 text-xs font-semibold text-white transition hover:border-white/35"
          onClick={() => {
            void onDownload(item);
          }}
          type="button"
        >
          Download
        </button>
      </div>
    </article>
  );
}

export default function FileQueue({ completed, incoming, onDownload, outgoing, reselectNeeded }) {
  const hasRows =
    outgoing.length > 0 ||
    incoming.length > 0 ||
    completed.length > 0 ||
    reselectNeeded.length > 0;

  if (!hasRows) {
    return null;
  }

  return (
    <section className="fade-panel space-y-3">
      {reselectNeeded.map((session) => (
        <article
          className="rounded-[20px] border border-[#ffd60a]/20 bg-[#ffd60a]/10 p-4"
          key={session.sessionId}
        >
          <p className="text-sm font-semibold text-white">
            Re-select {session.filename} to resume transfer
          </p>
          <p className="mt-1 text-xs text-[#ffd60a]">
            Waiting at chunk {(session.lastAckedChunk ?? -1) + 2} of {session.totalChunks}
          </p>
        </article>
      ))}

      {outgoing.map((item) => (
        <TransferRow item={item} key={item.id} title="Sending" />
      ))}

      {incoming.map((item) => (
        <TransferRow item={item} key={item.sessionId} title="Receiving" />
      ))}

      {completed.map((item) => (
        <CompletedRow item={item} key={item.sessionId} onDownload={onDownload} />
      ))}
    </section>
  );
}
