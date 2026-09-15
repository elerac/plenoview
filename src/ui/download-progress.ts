import type { ImageDownloadProgress } from '../download-image';
import { formatByteCount } from '../folder-load-limits';
import type { Disposable } from '../lifecycle';

export class DownloadProgressView implements Disposable {
  private readonly root = document.createElement('div');
  private readonly label = document.createElement('div');
  private readonly bar = document.createElement('div');
  private readonly fill = document.createElement('div');
  private readonly detail = document.createElement('div');

  constructor(container: HTMLElement) {
    this.root.className = 'download-progress hidden';
    this.label.className = 'download-progress-label';
    this.label.setAttribute('role', 'status');
    this.bar.className = 'download-progress-bar';
    this.bar.setAttribute('role', 'progressbar');
    this.bar.setAttribute('aria-valuemin', '0');
    this.bar.setAttribute('aria-valuemax', '100');
    this.fill.className = 'download-progress-fill';
    this.detail.className = 'download-progress-detail';
    this.bar.append(this.fill);
    this.root.append(this.label, this.bar, this.detail);
    container.append(this.root);
  }

  setProgress(progress: ImageDownloadProgress | null): void {
    this.root.classList.toggle('hidden', progress === null);
    if (!progress) {
      return;
    }

    const label = progress.activeDownloads > 1
      ? `Downloading ${progress.activeDownloads} images...`
      : `Downloading ${progress.filename}...`;
    if (this.label.textContent !== label) {
      this.label.textContent = label;
      this.label.title = label;
    }
    this.bar.setAttribute('aria-label', label);
    const total = progress.totalBytes;
    const percent = total !== null && total > 0
      ? Math.min(100, Math.floor(progress.downloadedBytes / total * 100))
      : null;
    this.bar.classList.toggle('is-indeterminate', percent === null);
    if (percent === null) {
      this.bar.removeAttribute('aria-valuenow');
      this.fill.style.width = '';
      this.detail.textContent = progress.downloadedBytes > 0
        ? `${formatByteCount(progress.downloadedBytes)} downloaded`
        : 'Waiting for download...';
    } else {
      this.bar.setAttribute('aria-valuenow', String(percent));
      this.fill.style.width = `${percent}%`;
      this.detail.textContent = `${percent}% · ${formatByteCount(progress.downloadedBytes)} / ${formatByteCount(total!)}`;
    }
    this.bar.setAttribute('aria-valuetext', this.detail.textContent);
  }

  dispose(): void {
    this.root.remove();
  }
}
