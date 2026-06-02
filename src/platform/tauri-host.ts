import type { Disposable } from '../lifecycle';
import { isStaleDesktopPathError, normalizeDesktopError } from './desktop-errors';
import type {
  AppFullscreenHost,
  DesktopCommandCallbacks,
  DesktopCommandId,
  DesktopEventCallbacks,
  DesktopFileBytes,
  DesktopFileEntry,
  DesktopRecentFile,
  ExportFileSaveOptions,
  ExportSaveResult,
  HostOpenFileOptions,
  HostOpenFolderOptions,
  PathFileProvider,
  RecentFileCallbacks,
  ViewerHost
} from './types';

interface DesktopFileEntryWire {
  grantId: string;
  path: string;
  filename: string;
  displayPath?: string;
  relativePath?: string;
  fileSizeBytes: number;
}

interface DesktopRecentFileWire {
  path: string;
  label: string;
  displayPath: string;
  openedAt: number;
}

interface ExportSaveResultWire {
  status: 'saved' | 'cancelled';
}

type RawBytes = number[] | Uint8Array | ArrayBuffer;

let nativeMenuCallbacks: DesktopCommandCallbacks | null = null;
let nativeMenuRefreshSerial = 0;
let nativeMenuRefreshTimer: number | null = null;
let lastNativeMenuSignature: string | null = null;

async function importTauriCore() {
  return await import('@tauri-apps/api/core');
}

function normalizeEntry(entry: DesktopFileEntryWire): DesktopFileEntry {
  return {
    grantId: entry.grantId,
    path: entry.path,
    filename: entry.filename,
    ...(entry.displayPath ? { displayPath: entry.displayPath } : {}),
    ...(entry.relativePath ? { relativePath: entry.relativePath } : {}),
    fileSizeBytes: entry.fileSizeBytes
  };
}

function normalizeRecentFile(entry: DesktopRecentFileWire): DesktopRecentFile {
  return {
    path: entry.path,
    label: entry.label,
    displayPath: entry.displayPath,
    openedAt: entry.openedAt
  };
}

function normalizeRecentFiles(entries: DesktopRecentFileWire[]): DesktopRecentFile[] {
  const recentFiles = entries.map(normalizeRecentFile);
  const labelCounts = new Map<string, number>();
  for (const item of recentFiles) {
    labelCounts.set(item.label, (labelCounts.get(item.label) ?? 0) + 1);
  }
  return recentFiles.map((item) => (
    (labelCounts.get(item.label) ?? 0) > 1
      ? {
          ...item,
          label: `${item.label} - ${shortParentFolder(item.displayPath)}`
        }
      : item
  ));
}

function shortParentFolder(path: string): string {
  const parts = path.split(/[\\/]+/).filter(Boolean);
  return parts.length >= 2 ? parts[parts.length - 2]! : path;
}

function normalizeBytes(value: RawBytes): Uint8Array {
  if (value instanceof Uint8Array) {
    return value;
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  return new Uint8Array(value);
}

async function invokeDesktop<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    const { invoke } = await importTauriCore();
    return await invoke<T>(command, args);
  } catch (error) {
    throw normalizeDesktopError(error);
  }
}

const tauriPathFileProvider: PathFileProvider = {
  async readExrFile(grantId: string): Promise<DesktopFileBytes> {
    const bytes = await invokeDesktop<RawBytes>('read_exr_file', { grantId });
    return {
      grantId,
      bytes: normalizeBytes(bytes)
    };
  },
  async listExrFolder(path: string): Promise<DesktopFileEntry[]> {
    const entries = await invokeDesktop<DesktopFileEntryWire[]>('resolve_exr_paths', { paths: [path] });
    return entries.map(normalizeEntry);
  },
  async resolveExrPaths(paths: string[]): Promise<DesktopFileEntry[]> {
    if (paths.length === 0) {
      return [];
    }
    const entries = await invokeDesktop<DesktopFileEntryWire[]>('resolve_exr_paths', { paths });
    return entries.map(normalizeEntry);
  },
  async openRecentFile(path: string): Promise<DesktopFileEntry> {
    const entry = await invokeDesktop<DesktopFileEntryWire>('open_recent_file', { path });
    return normalizeEntry(entry);
  }
};

const tauriAppFullscreenHost: AppFullscreenHost = {
  isSupported(): boolean {
    return true;
  },
  async isActive(): Promise<boolean> {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    return await getCurrentWindow().isFullscreen();
  },
  async setActive(active: boolean): Promise<void> {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await getCurrentWindow().setFullscreen(active);
  },
  async onChange(callback: () => void): Promise<Disposable> {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    const window = getCurrentWindow();
    const disposers = await Promise.all([
      window.onResized(callback),
      window.onFocusChanged(callback)
    ]);
    return {
      dispose: () => {
        for (const dispose of disposers) {
          dispose();
        }
      }
    };
  }
};

export const tauriHost: ViewerHost = {
  kind: 'tauri',
  pathFileProvider: tauriPathFileProvider,
  appFullscreen: tauriAppFullscreenHost,
  openFiles({ fallback, onEntries, onError }: HostOpenFileOptions): void {
    void (async () => {
      try {
        const { invoke } = await importTauriCore();
        const entries = await invoke<DesktopFileEntryWire[]>('open_exr_files_dialog');
        if (entries.length > 0) {
          onEntries(entries.map(normalizeEntry));
        }
      } catch (error) {
        const desktopError = normalizeDesktopError(error);
        if (isTauriApiUnavailable(desktopError)) {
          fallback();
          return;
        }
        onError?.(desktopError);
      }
    })();
  },
  openFolder({ fallback, onEntries, onError }: HostOpenFolderOptions): void {
    void (async () => {
      try {
        const { invoke } = await importTauriCore();
        const entries = await invoke<DesktopFileEntryWire[]>('open_exr_folder_dialog');
        if (entries.length > 0) {
          onEntries(entries.map(normalizeEntry));
        }
      } catch (error) {
        const desktopError = normalizeDesktopError(error);
        if (isTauriApiUnavailable(desktopError)) {
          fallback();
          return;
        }
        onError?.(desktopError);
      }
    })();
  },
  async saveBlob(blob: Blob, options: ExportFileSaveOptions): Promise<ExportSaveResult> {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const result = await invokeDesktop<ExportSaveResultWire>('save_export_file', {
      filename: options.filename,
      title: options.title,
      extensions: options.extensions,
      bytes
    });
    return result.status === 'saved' ? { status: 'saved' } : { status: 'cancelled' };
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
    const disposers: Array<() => void> = [];

    const suppressHtmlFileDrop = (event: DragEvent) => {
      if (!Array.from(event.dataTransfer?.types ?? []).includes('Files')) {
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    window.addEventListener('dragover', suppressHtmlFileDrop, { capture: true });
    window.addEventListener('drop', suppressHtmlFileDrop, { capture: true });
    disposers.push(() => {
      window.removeEventListener('dragover', suppressHtmlFileDrop, { capture: true });
      window.removeEventListener('drop', suppressHtmlFileDrop, { capture: true });
    });

    const unlistenOpenPaths = await listen<DesktopFileEntryWire[]>('desktop-open-paths', (event) => {
      if (Array.isArray(event.payload) && event.payload.length > 0) {
        callbacks.onEntries(event.payload.map(normalizeEntry));
      }
    });
    disposers.push(unlistenOpenPaths);

    const unlistenDragDrop = await getCurrentWebview().onDragDropEvent((event) => {
      if (event.payload.type === 'enter') {
        callbacks.onDragStateChange?.(true);
        return;
      }
      if (event.payload.type === 'leave') {
        callbacks.onDragStateChange?.(false);
        return;
      }
      if (event.payload.type === 'drop') {
        callbacks.onDragStateChange?.(false);
        if (event.payload.paths.length > 0) {
          void tauriPathFileProvider.resolveExrPaths(event.payload.paths)
            .then((entries) => {
              if (entries.length > 0) {
                callbacks.onEntries(entries);
              }
            })
            .catch((error) => {
              callbacks.onError?.(normalizeDesktopError(error));
            });
        }
      }
    });
    disposers.push(unlistenDragDrop);

    const initialEntries = await invokeDesktop<DesktopFileEntryWire[]>('take_initial_open_entries');
    if (initialEntries.length > 0) {
      callbacks.onEntries(initialEntries.map(normalizeEntry));
    }

    return {
      dispose: () => {
        for (const dispose of disposers.splice(0)) {
          dispose();
        }
      }
    };
  },
  async setupDesktopCommands(callbacks: DesktopCommandCallbacks): Promise<Disposable> {
    nativeMenuCallbacks = callbacks;
    lastNativeMenuSignature = null;
    await installNativeMenu(callbacks, { force: true });
    const onCommandStateChanged = () => {
      refreshNativeMenu();
    };
    window.addEventListener('prismifold:desktop-command-state-changed', onCommandStateChanged);
    return {
      dispose: () => {
        window.removeEventListener('prismifold:desktop-command-state-changed', onCommandStateChanged);
        if (nativeMenuCallbacks === callbacks) {
          nativeMenuCallbacks = null;
        }
        if (nativeMenuRefreshTimer !== null) {
          window.clearTimeout(nativeMenuRefreshTimer);
          nativeMenuRefreshTimer = null;
        }
      }
    };
  },
  installRecentFilesMenu(callbacks: RecentFileCallbacks): Disposable {
    return installRustRecentFilesMenu(callbacks);
  },
  async refreshRecentFiles(): Promise<DesktopRecentFile[]> {
    const entries = await invokeDesktop<DesktopRecentFileWire[]>('get_recent_files');
    return normalizeRecentFiles(entries);
  },
  async clearRecentFiles(): Promise<void> {
    await invokeDesktop<DesktopRecentFileWire[]>('clear_recent_files');
    notifyRecentFilesChanged();
  },
  recordRecentFile(entry: DesktopFileEntry): void {
    void invokeDesktop<DesktopRecentFileWire[]>('record_recent_file', { grantId: entry.grantId })
      .then(() => {
        notifyRecentFilesChanged();
      })
      .catch(() => {});
  },
  recordPathLoadFailure(entry: DesktopFileEntry, error: unknown): void {
    if (isStaleDesktopPathError(error)) {
      void invokeDesktop<DesktopRecentFileWire[]>('remove_recent_file', { path: entry.path })
        .then(() => {
          notifyRecentFilesChanged();
        })
        .catch(() => {});
    }
  }
};

function isTauriApiUnavailable(error: Error): boolean {
  return /failed to resolve module specifier|cannot find package|cannot find module|__tauri/i.test(error.message);
}

function notifyRecentFilesChanged(): void {
  window.dispatchEvent(new Event('prismifold:desktop-recent-files-changed'));
  refreshNativeMenu();
}

async function installNativeMenu(callbacks: DesktopCommandCallbacks, options: { force?: boolean } = {}): Promise<void> {
  const { Menu, Submenu, PredefinedMenuItem } = await import('@tauri-apps/api/menu');
  const recents = await tauriHost.refreshRecentFiles();
  const commandState = callbacks.getCommandState?.() ?? {};
  const signature = buildNativeMenuSignature(commandState, recents);
  if (!options.force && signature === lastNativeMenuSignature) {
    return;
  }
  lastNativeMenuSignature = signature;
  const isEnabled = (id: DesktopCommandId) => commandState[id] ?? true;
  const command = (id: DesktopCommandId) => () => {
    callbacks.onCommand(id);
  };
  const openRecentItems = recents.length === 0
    ? [{ text: 'No Recent Files', enabled: false }]
    : recents.map((recent) => ({
        text: recent.label,
        enabled: true,
        action: () => {
          void openRecentFromMenu(recent.path, callbacks);
        }
      }));

  const fileMenu = await Submenu.new({
    text: 'File',
    items: [
      { text: 'Open...', accelerator: 'CmdOrCtrl+O', enabled: isEnabled('openFile'), action: command('openFile') },
      { text: 'Open Folder...', accelerator: 'CmdOrCtrl+Shift+O', enabled: isEnabled('openFolder'), action: command('openFolder') },
      await Submenu.new({
        text: 'Open Recent',
        items: [
          ...openRecentItems,
          await PredefinedMenuItem.new({ item: 'Separator' }),
          { text: 'Clear Recent', enabled: recents.length > 0, action: command('clearRecentFiles') }
        ]
      }),
      await PredefinedMenuItem.new({ item: 'Separator' }),
      { text: 'Export...', accelerator: 'CmdOrCtrl+E', enabled: isEnabled('exportImage'), action: command('exportImage') },
      { text: 'Export Screenshot...', accelerator: 'CmdOrCtrl+Shift+E', enabled: isEnabled('exportScreenshot'), action: command('exportScreenshot') },
      { text: 'Export Batch...', enabled: isEnabled('exportBatch'), action: command('exportBatch') },
      { text: 'Export Colormap...', enabled: isEnabled('exportColormap'), action: command('exportColormap') },
      await PredefinedMenuItem.new({ item: 'Separator' }),
      { text: 'Reload All', accelerator: 'CmdOrCtrl+R', enabled: isEnabled('reloadAll'), action: command('reloadAll') },
      { text: 'Close All', accelerator: 'CmdOrCtrl+W', enabled: isEnabled('closeAll'), action: command('closeAll') }
    ]
  });
  const editMenu = await Submenu.new({
    text: 'Edit',
    items: [
      await PredefinedMenuItem.new({ item: 'Undo' }),
      await PredefinedMenuItem.new({ item: 'Redo' }),
      await PredefinedMenuItem.new({ item: 'Separator' }),
      await PredefinedMenuItem.new({ item: 'Cut' }),
      await PredefinedMenuItem.new({ item: 'Copy' }),
      await PredefinedMenuItem.new({ item: 'Paste' }),
      await PredefinedMenuItem.new({ item: 'SelectAll' }),
      await PredefinedMenuItem.new({ item: 'Separator' }),
      { text: 'Copy Image', accelerator: 'CmdOrCtrl+Shift+C', enabled: isEnabled('copyImage'), action: command('copyImage') }
    ]
  });
  const viewMenu = await Submenu.new({
    text: 'View',
    items: [
      { text: 'Image Viewer', enabled: isEnabled('viewerModeImage'), action: command('viewerModeImage') },
      { text: 'Panorama Viewer', enabled: isEnabled('viewerModePanorama'), action: command('viewerModePanorama') },
      { text: 'Depth Map Viewer', enabled: isEnabled('viewerModeDepth'), action: command('viewerModeDepth') },
      await PredefinedMenuItem.new({ item: 'Separator' }),
      { text: 'Rulers', enabled: isEnabled('toggleRulers'), action: command('toggleRulers') },
      await PredefinedMenuItem.new({ item: 'Separator' }),
      { text: 'Settings...', accelerator: 'CmdOrCtrl+,', enabled: isEnabled('settings'), action: command('settings') },
      { text: 'Metadata...', enabled: isEnabled('metadata'), action: command('metadata') }
    ]
  });
  const windowMenu = await Submenu.new({
    text: 'Window',
    items: [
      { text: 'Normal Preview', enabled: isEnabled('windowPreviewNormal'), action: command('windowPreviewNormal') },
      { text: 'Full Screen Preview', enabled: isEnabled('windowPreviewFullscreen'), action: command('windowPreviewFullscreen') },
      await PredefinedMenuItem.new({ item: 'Separator' }),
      { text: 'Single Pane', enabled: isEnabled('paneReset'), action: command('paneReset') },
      { text: 'Split Vertically', accelerator: 'CmdOrCtrl+D', enabled: isEnabled('paneSplitVertical'), action: command('paneSplitVertical') },
      { text: 'Split Horizontally', accelerator: 'CmdOrCtrl+Shift+D', enabled: isEnabled('paneSplitHorizontal'), action: command('paneSplitHorizontal') },
      await PredefinedMenuItem.new({ item: 'Separator' }),
      { text: 'Toggle App Fullscreen', accelerator: 'F11', enabled: isEnabled('toggleAppFullscreen'), action: command('toggleAppFullscreen') },
      await PredefinedMenuItem.new({ item: 'Separator' }),
      await PredefinedMenuItem.new({ item: 'Minimize' }),
      await PredefinedMenuItem.new({ item: 'Maximize' }),
      await PredefinedMenuItem.new({ item: 'CloseWindow' })
    ]
  });

  const menu = await Menu.new({
    items: [fileMenu, editMenu, viewMenu, windowMenu]
  });
  await menu.setAsAppMenu();
}

function openRecentFromMenu(path: string, callbacks: DesktopCommandCallbacks | RecentFileCallbacks): void {
  void tauriPathFileProvider.openRecentFile(path)
    .then((entry) => {
      if ('onOpenRecent' in callbacks) {
        callbacks.onOpenRecent(entry);
        return;
      }
      callbacks.onOpenEntry(entry);
    })
    .catch((error) => {
      const desktopError = normalizeDesktopError(error);
      if (isStaleDesktopPathError(desktopError)) {
        notifyRecentFilesChanged();
      }
      callbacks.onError?.(desktopError);
    });
}

function refreshNativeMenu(): void {
  const callbacks = nativeMenuCallbacks;
  if (!callbacks) {
    return;
  }
  const serial = ++nativeMenuRefreshSerial;
  if (nativeMenuRefreshTimer !== null) {
    window.clearTimeout(nativeMenuRefreshTimer);
  }
  nativeMenuRefreshTimer = window.setTimeout(() => {
    nativeMenuRefreshTimer = null;
    void Promise.resolve().then(async () => {
      if (serial !== nativeMenuRefreshSerial || nativeMenuCallbacks !== callbacks) {
        return;
      }
      await installNativeMenu(callbacks);
    }).catch(() => {});
  }, 75);
}

function buildNativeMenuSignature(
  commandState: Partial<Record<DesktopCommandId, boolean>>,
  recents: DesktopRecentFile[]
): string {
  const sortedCommandState = Object.entries(commandState)
    .sort(([left], [right]) => left.localeCompare(right));
  const recentState = recents.map((recent) => [
    recent.path,
    recent.label,
    recent.displayPath,
    recent.openedAt
  ]);
  return JSON.stringify({
    commands: sortedCommandState,
    recents: recentState
  });
}

function installRustRecentFilesMenu(callbacks: RecentFileCallbacks): Disposable {
  const fileMenu = document.getElementById('file-menu');
  const openFolderButton = document.getElementById('open-folder-button');
  if (!fileMenu || !openFolderButton) {
    return { dispose: () => {} };
  }

  const section = document.createElement('div');
  section.id = 'desktop-open-recent-section';
  section.hidden = true;

  const separator = document.createElement('div');
  separator.className = 'app-menu-separator';
  separator.setAttribute('role', 'separator');
  separator.setAttribute('aria-orientation', 'horizontal');
  section.append(separator);

  const heading = document.createElement('div');
  heading.className = 'app-menu-item app-menu-item--heading';
  heading.textContent = 'Open Recent';
  section.append(heading);

  const itemsContainer = document.createElement('div');
  itemsContainer.id = 'desktop-open-recent-items';
  section.append(itemsContainer);

  const clearButton = document.createElement('button');
  clearButton.id = 'desktop-clear-recent-files-button';
  clearButton.className = 'app-menu-item';
  clearButton.type = 'button';
  clearButton.setAttribute('role', 'menuitem');
  clearButton.textContent = 'Clear Recent';
  section.append(clearButton);

  openFolderButton.insertAdjacentElement('afterend', section);

  const render = () => {
    void tauriHost.refreshRecentFiles().then((recentFiles) => {
      section.hidden = recentFiles.length === 0;
      itemsContainer.replaceChildren();
      for (const item of recentFiles) {
        const button = document.createElement('button');
        button.className = 'app-menu-item';
        button.type = 'button';
        button.setAttribute('role', 'menuitem');
        button.textContent = item.label;
        button.title = item.displayPath;
        button.addEventListener('click', () => {
          openRecentFromMenu(item.path, callbacks);
        });
        itemsContainer.append(button);
      }
    }).catch((error) => {
      callbacks.onError?.(normalizeDesktopError(error));
    });
  };
  const onClear = () => {
    void tauriHost.clearRecentFiles().then(render).catch((error) => {
      callbacks.onError?.(normalizeDesktopError(error));
    });
  };

  window.addEventListener('prismifold:desktop-recent-files-changed', render);
  clearButton.addEventListener('click', onClear);
  render();

  return {
    dispose: () => {
      window.removeEventListener('prismifold:desktop-recent-files-changed', render);
      clearButton.removeEventListener('click', onClear);
      section.remove();
    }
  };
}
