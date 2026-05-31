import type { Disposable } from '../lifecycle';

export interface DesktopFileEntry {
  path: string;
  filename: string;
  displayPath?: string;
  relativePath?: string;
  fileSizeBytes: number;
}

export interface DesktopFileBytes extends DesktopFileEntry {
  bytes: Uint8Array;
}

export interface PathFileProvider {
  readExrFile(path: string, signal?: AbortSignal): Promise<DesktopFileBytes>;
  listExrFolder(path: string, signal?: AbortSignal): Promise<DesktopFileEntry[]>;
  resolveExrPaths(paths: string[], signal?: AbortSignal): Promise<DesktopFileEntry[]>;
}

export interface ExportFileSaveOptions {
  filename: string;
  title?: string;
  extensions: string[];
}

export interface ExportSink {
  saveBlob(blob: Blob, options: ExportFileSaveOptions): Promise<boolean>;
  validateCopyPngBlob?(): void;
  copyPngBlob(blob: Blob): Promise<void>;
}

export interface HostOpenFileOptions {
  fallback: () => void;
  onPaths: (paths: string[]) => void;
}

export interface HostOpenFolderOptions {
  fallback: () => void;
  onFolderPath: (path: string) => void;
}

export interface DesktopEventCallbacks {
  onPaths: (paths: string[]) => void;
}

export interface RecentFileCallbacks {
  onOpenPath: (path: string) => void;
}

export interface ViewerHost extends ExportSink {
  kind: 'web' | 'tauri';
  pathFileProvider: PathFileProvider | null;
  openFiles(options: HostOpenFileOptions): void;
  openFolder(options: HostOpenFolderOptions): void;
  setupDesktopEvents(callbacks: DesktopEventCallbacks): Promise<Disposable>;
  installRecentFilesMenu(callbacks: RecentFileCallbacks): Disposable;
  recordRecentFile(entry: DesktopFileEntry): void;
  recordPathLoadFailure(entry: DesktopFileEntry, error: unknown): void;
}
