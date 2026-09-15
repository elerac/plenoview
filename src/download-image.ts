import { throwIfAborted } from './lifecycle';

export interface DownloadByteProgress {
  downloadedBytes: number;
  totalBytes: number | null;
}

export interface ImageDownloadProgress extends DownloadByteProgress {
  filename: string;
  activeDownloads: number;
}

export async function downloadImageBytes(
  url: string,
  signal: AbortSignal,
  onProgress: (progress: DownloadByteProgress) => void
): Promise<Uint8Array> {
  throwIfAborted(signal);
  onProgress({ downloadedBytes: 0, totalBytes: null });
  const response = await fetch(url, { signal });
  throwIfAborted(signal);
  if (!response.ok) {
    throw new Error(`Failed to load ${url} (${response.status})`);
  }

  const length = Number(response.headers.get('content-length'));
  const encoding = response.headers.get('content-encoding');
  // Fetch exposes decompressed bytes; an encoded Content-Length is not comparable.
  let totalBytes = Number.isSafeInteger(length) && length > 0 && (!encoding || encoding === 'identity')
    ? length
    : null;
  onProgress({ downloadedBytes: 0, totalBytes });

  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    throwIfAborted(signal);
    onProgress({ downloadedBytes: bytes.byteLength, totalBytes: bytes.byteLength });
    return bytes;
  }

  const reader = response.body.getReader();
  const cancel = () => { void reader.cancel(signal.reason).catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  const chunks: Uint8Array[] = [];
  let downloadedBytes = 0;
  let lastReportTime = -Infinity;
  let progressTimer: ReturnType<typeof setTimeout> | null = null;
  const clearProgressTimer = () => {
    if (progressTimer !== null) {
      clearTimeout(progressTimer);
      progressTimer = null;
    }
  };
  const reportProgress = () => {
    clearProgressTimer();
    if (!signal.aborted) {
      onProgress({ downloadedBytes, totalBytes });
      lastReportTime = performance.now();
    }
  };
  try {
    while (true) {
      throwIfAborted(signal);
      const { done, value } = await reader.read();
      throwIfAborted(signal);
      if (done) {
        break;
      }
      chunks.push(value);
      downloadedBytes += value.byteLength;
      if (totalBytes !== null && downloadedBytes > totalBytes) {
        totalBytes = null;
      }
      // Avoid rerendering the application for every network chunk.
      const now = performance.now();
      if (now - lastReportTime >= 100) {
        reportProgress();
      } else if (progressTimer === null) {
        progressTimer = setTimeout(reportProgress, 100 - (now - lastReportTime));
      }
    }
    onProgress({ downloadedBytes, totalBytes: downloadedBytes });
    const bytes = new Uint8Array(downloadedBytes);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes;
  } catch (error) {
    void reader.cancel(error).catch(() => {});
    throw error;
  } finally {
    clearProgressTimer();
    signal.removeEventListener('abort', cancel);
    reader.releaseLock();
  }
}
