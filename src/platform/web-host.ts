import type {
  DesktopEventCallbacks,
  DesktopFileEntry,
  ExportFileSaveOptions,
  HostOpenFileOptions,
  HostOpenFolderOptions,
  RecentFileCallbacks,
  ViewerHost
} from './types';

export const webHost: ViewerHost = {
  kind: 'web',
  pathFileProvider: null,
  openFiles({ fallback }: HostOpenFileOptions): void {
    fallback();
  },
  openFolder({ fallback }: HostOpenFolderOptions): void {
    fallback();
  },
  async saveBlob(blob: Blob, options: ExportFileSaveOptions): Promise<boolean> {
    triggerBrowserDownload(blob, options.filename);
    return true;
  },
  validateCopyPngBlob(): void {
    if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
      throw new Error('Copying images to the clipboard is not supported by this browser.');
    }
    if (typeof ClipboardItem.supports === 'function' && !ClipboardItem.supports('image/png')) {
      throw new Error('Copying PNG images to the clipboard is not supported by this browser.');
    }
  },
  async copyPngBlob(blob: Blob): Promise<void> {
    this.validateCopyPngBlob?.();

    await navigator.clipboard.write([
      new ClipboardItem({
        'image/png': blob
      })
    ]);
  },
  async setupDesktopEvents(_callbacks: DesktopEventCallbacks) {
    return { dispose: () => {} };
  },
  installRecentFilesMenu(_callbacks: RecentFileCallbacks) {
    return { dispose: () => {} };
  },
  recordRecentFile(_entry: DesktopFileEntry): void {},
  recordPathLoadFailure(_entry: DesktopFileEntry, _error: unknown): void {}
};

export function triggerBrowserDownload(blob: Blob, filename: string): void {
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = filename;
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => {
    URL.revokeObjectURL(objectUrl);
  }, 1000);
}
