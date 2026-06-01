export const CHUNK_SIZE = 256 * 1024;

export function getTotalChunks(fileSize, chunkSize = CHUNK_SIZE) {
  return Math.max(1, Math.ceil(fileSize / chunkSize));
}

export async function readFileChunk(file, chunkIndex, chunkSize = CHUNK_SIZE) {
  const start = chunkIndex * chunkSize;
  const end = Math.min(start + chunkSize, file.size);
  return file.slice(start, end).arrayBuffer();
}

export function formatBytes(bytes = 0) {
  if (bytes === 0) return '0 B';

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const unitIndex = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  const value = bytes / 1024 ** unitIndex;
  const precision = value >= 10 || unitIndex === 0 ? 0 : 1;

  return `${value.toFixed(precision)} ${units[unitIndex]}`;
}

export function formatSpeed(bytesPerSecond = 0) {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) {
    return '0 MB/s';
  }

  return `${(bytesPerSecond / 1024 / 1024).toFixed(2)} MB/s`;
}

export function formatEta(seconds = 0) {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return '0s';
  }

  if (seconds < 60) {
    return `${Math.ceil(seconds)}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.ceil(seconds % 60);
  return `${minutes}m ${remainingSeconds}s`;
}
