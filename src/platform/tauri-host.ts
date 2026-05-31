import type { Disposable } from '../lifecycle';
import {
  installDesktopRecentFilesMenu,
  rememberDesktopRecentFile,
  removeDesktopRecentFile
} from './desktop-recent-files';
import type {
  DesktopEventCallbacks,
  DesktopFileBytes,
  DesktopFileEntry,
  ExportFileSaveOptions,
  HostOpenFileOptions,
  HostOpenFolderOptions,
  PathFileProvider,
  RecentFileCallbacks,
  ViewerHost
} from './types';

interface DesktopFileEntryWire {
  path: string;
  filename: string;
  display_path?: string;
  relative_path?: string;
  file_size_bytes: number;
}

interface DesktopFileBytesWire extends DesktopFileEntryWire {
  bytes: number[] | Uint8Array | ArrayBuffer;
}

async function importTauriCore() {
  return await import('@tauri-apps/api/core');
}

function normalizeSelectedPaths(selected: string | string[] | null): string[] {
  if (selected === null) {
    return [];
  }
  return (Array.isArray(selected) ? selected : [selected]).filter((path) => path.trim().length > 0);
}

function normalizeEntry(entry: DesktopFileEntryWire): DesktopFileEntry {
  return {
    path: entry.path,
    filename: entry.filename,
    ...(entry.display_path ? { displayPath: entry.display_path } : {}),
    ...(entry.relative_path ? { relativePath: entry.relative_path } : {}),
    fileSizeBytes: entry.file_size_bytes
  };
}

function normalizeBytes(value: number[] | Uint8Array | ArrayBuffer): Uint8Array {
  if (value instanceof Uint8Array) {
    return value;
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  return new Uint8Array(value);
}

const tauriPathFileProvider: PathFileProvider = {
  async readExrFile(path: string): Promise<DesktopFileBytes> {
    const { invoke } = await importTauriCore();
    const result = await invoke<DesktopFileBytesWire>('read_exr_file', { path });
    return {
      ...normalizeEntry(result),
      bytes: normalizeBytes(result.bytes)
    };
  },
  async listExrFolder(path: string): Promise<DesktopFileEntry[]> {
    const { invoke } = await importTauriCore();
    const entries = await invoke<DesktopFileEntryWire[]>('list_exr_folder', { path });
    return entries.map(normalizeEntry);
  },
  async resolveExrPaths(paths: string[]): Promise<DesktopFileEntry[]> {
    if (paths.length === 0) {
      return [];
    }
    const { invoke } = await importTauriCore();
    const entries = await invoke<DesktopFileEntryWire[]>('resolve_exr_paths', { paths });
    return entries.map(normalizeEntry);
  }
};

export const tauriHost: ViewerHost = {
  kind: 'tauri',
  pathFileProvider: tauriPathFileProvider,
  openFiles({ fallback, onPaths }: HostOpenFileOptions): void {
    void (async () => {
      try {
        const { open } = await import('@tauri-apps/plugin-dialog');
        const selected = await open({
          multiple: true,
          directory: false,
          filters: [{ name: 'OpenEXR', extensions: ['exr'] }]
        });
        const paths = normalizeSelectedPaths(selected);
        if (paths.length > 0) {
          onPaths(paths);
        }
      } catch {
        fallback();
      }
    })();
  },
  openFolder({ fallback, onFolderPath }: HostOpenFolderOptions): void {
    void (async () => {
      try {
        const { open } = await import('@tauri-apps/plugin-dialog');
        const selected = await open({
          multiple: false,
          directory: true
        });
        const paths = normalizeSelectedPaths(selected);
        if (paths[0]) {
          onFolderPath(paths[0]);
        }
      } catch {
        fallback();
      }
    })();
  },
  async saveBlob(blob: Blob, options: ExportFileSaveOptions): Promise<boolean> {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const path = await save({
      defaultPath: options.filename,
      title: options.title,
      filters: [{ name: options.extensions.map((item) => item.toUpperCase()).join('/'), extensions: options.extensions }]
    });
    if (!path) {
      return false;
    }

    const bytes = Array.from(new Uint8Array(await blob.arrayBuffer()));
    const { invoke } = await importTauriCore();
    await invoke('write_export_file', { path, bytes });
    return true;
  },
  async copyPngBlob(blob: Blob): Promise<void> {
    const { Image } = await import('@tauri-apps/api/image');
    const { writeImage } = await import('@tauri-apps/plugin-clipboard-manager');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const image = await Image.fromBytes(bytes);
    await writeImage(image);
  },
  async setupDesktopEvents(callbacks: DesktopEventCallbacks): Promise<Disposable> {
    const { listen } = await import('@tauri-apps/api/event');
    const { getCurrentWebview } = await import('@tauri-apps/api/webview');
    const { invoke } = await importTauriCore();
    const disposers: Array<() => void> = [];

    const unlistenOpenPaths = await listen<string[]>('desktop-open-paths', (event) => {
      if (Array.isArray(event.payload) && event.payload.length > 0) {
        callbacks.onPaths(event.payload);
      }
    });
    disposers.push(unlistenOpenPaths);

    const unlistenDragDrop = await getCurrentWebview().onDragDropEvent((event) => {
      if (event.payload.type === 'drop' && event.payload.paths.length > 0) {
        callbacks.onPaths(event.payload.paths);
      }
    });
    disposers.push(unlistenDragDrop);

    const initialPaths = await invoke<string[]>('take_initial_open_paths');
    if (initialPaths.length > 0) {
      callbacks.onPaths(initialPaths);
    }

    return {
      dispose: () => {
        for (const dispose of disposers.splice(0)) {
          dispose();
        }
      }
    };
  },
  installRecentFilesMenu(callbacks: RecentFileCallbacks): Disposable {
    return installDesktopRecentFilesMenu(callbacks);
  },
  recordRecentFile(entry: DesktopFileEntry): void {
    rememberDesktopRecentFile(entry);
  },
  recordPathLoadFailure(entry: DesktopFileEntry, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    if (/does not exist|not a file/i.test(message)) {
      removeDesktopRecentFile(entry.path);
    }
  }
};
