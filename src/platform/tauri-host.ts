import type { Disposable } from '../lifecycle';
import { isStaleDesktopPathError, normalizeDesktopError } from './desktop-errors';
import type {
  AppFullscreenHost,
  DesktopCommandCallbacks,
  DesktopCommandId,
  DesktopEventCallbacks,
  DesktopFileBytes,
  DesktopFileEntry,
  DesktopPlatform,
  DesktopRecentFile,
  DesktopWindowChromeHost,
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
type TauriSubmenu = typeof import('@tauri-apps/api/menu').Submenu;
type TauriSubmenuOptions = Parameters<TauriSubmenu['new']>[0];
type TauriSubmenuItem = NonNullable<TauriSubmenuOptions['items']>[number];

interface NativeMenuItemState {
  id: string;
  text: string;
  enabled: boolean;
  checked?: boolean;
  galleryId?: string;
  children?: NativeMenuItemState[];
}

interface NativeMenuState {
  appTitle: string;
  fileLabel: string;
  viewLabel: string;
  windowLabel: string;
  galleryLabel: string;
  file: {
    openFile: NativeMenuItemState;
    openFolder: NativeMenuItemState;
    exportImage: NativeMenuItemState;
    exportScreenshot: NativeMenuItemState;
    exportBatch: NativeMenuItemState;
    exportColormap: NativeMenuItemState;
    reloadAll: NativeMenuItemState;
    closeAll: NativeMenuItemState;
  };
  view: {
    image: NativeMenuItemState;
    panorama: {
      trigger: NativeMenuItemState;
      image: NativeMenuItemState;
      environmentPathTracing: NativeMenuItemState;
      maxSamples: NativeMenuItemState;
    };
    threeD: NativeMenuItemState;
    rulers: NativeMenuItemState;
  };
  window: {
    normal: NativeMenuItemState;
    fullscreenPreview: NativeMenuItemState;
  };
  gallery: NativeMenuItemState[];
}

let nativeMenuCallbacks: DesktopCommandCallbacks | null = null;
let nativeMenuRefreshSerial = 0;
let nativeMenuRefreshTimer: number | null = null;
let nativeMenuObserver: MutationObserver | null = null;
let lastNativeMenuSignature: string | null = null;

async function importTauriCore() {
  return await import('@tauri-apps/api/core');
}

async function getCurrentTauriWindow() {
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  return getCurrentWindow();
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

function normalizeDesktopPlatform(value: unknown): DesktopPlatform {
  return value === 'macos' || value === 'windows' || value === 'linux'
    ? value
    : 'unknown';
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
    return await (await getCurrentTauriWindow()).isFullscreen();
  },
  async setActive(active: boolean): Promise<void> {
    await (await getCurrentTauriWindow()).setFullscreen(active);
  },
  async onChange(callback: () => void): Promise<Disposable> {
    const window = await getCurrentTauriWindow();
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

const tauriDesktopWindowChromeHost: DesktopWindowChromeHost = {
  async getPlatform(): Promise<DesktopPlatform> {
    return normalizeDesktopPlatform(await invokeDesktop<unknown>('desktop_platform'));
  },
  async startDragging(): Promise<void> {
    await (await getCurrentTauriWindow()).startDragging();
  },
  async minimize(): Promise<void> {
    await (await getCurrentTauriWindow()).minimize();
  },
  async toggleMaximize(): Promise<void> {
    await (await getCurrentTauriWindow()).toggleMaximize();
  },
  async close(): Promise<void> {
    await (await getCurrentTauriWindow()).close();
  },
  async isMaximized(): Promise<boolean> {
    return await (await getCurrentTauriWindow()).isMaximized();
  },
  async onMaximizedChange(callback: (maximized: boolean) => void): Promise<Disposable> {
    const window = await getCurrentTauriWindow();
    const notify = () => {
      void window.isMaximized()
        .then(callback)
        .catch(() => {});
    };
    const disposers = await Promise.all([
      window.onResized(notify),
      window.onFocusChanged(notify)
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
  desktopWindowChrome: tauriDesktopWindowChromeHost,
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
    nativeMenuObserver?.disconnect();
    nativeMenuObserver = null;
    lastNativeMenuSignature = null;
    await installNativeMenu(callbacks, { force: true });
    const observer = observeNativeMenuState();
    nativeMenuObserver = observer;
    const onCommandStateChanged = () => {
      refreshNativeMenu();
    };
    window.addEventListener('plenoview:desktop-command-state-changed', onCommandStateChanged);
    return {
      dispose: () => {
        window.removeEventListener('plenoview:desktop-command-state-changed', onCommandStateChanged);
        if (nativeMenuCallbacks === callbacks) {
          nativeMenuCallbacks = null;
        }
        if (nativeMenuObserver === observer) {
          nativeMenuObserver = null;
        }
        observer?.disconnect();
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
  window.dispatchEvent(new Event('plenoview:desktop-recent-files-changed'));
  refreshNativeMenu();
}

async function installNativeMenu(callbacks: DesktopCommandCallbacks, options: { force?: boolean } = {}): Promise<void> {
  const { CheckMenuItem, Menu, Submenu, PredefinedMenuItem } = await import('@tauri-apps/api/menu');
  const recents = await tauriHost.refreshRecentFiles();
  const commandState = callbacks.getCommandState?.() ?? {};
  const menuState = readNativeMenuState();
  const signature = buildNativeMenuSignature(commandState, recents, menuState);
  if (!options.force && signature === lastNativeMenuSignature) {
    return;
  }
  lastNativeMenuSignature = signature;
  const isEnabled = (id: DesktopCommandId) => commandState[id] ?? true;
  const command = (id: DesktopCommandId) => () => {
    callbacks.onCommand(id);
  };
  const separator = () => PredefinedMenuItem.new({ item: 'Separator' as const });
  const commandItem = (
    id: DesktopCommandId,
    item: NativeMenuItemState,
    accelerator?: string
  ) => ({
    text: item.text,
    ...(accelerator ? { accelerator } : {}),
    enabled: item.enabled && isEnabled(id),
    action: command(id)
  });
  const checkedCommandItem = async (
    id: DesktopCommandId,
    item: NativeMenuItemState,
    accelerator?: string
  ) => await CheckMenuItem.new({
    text: item.text,
    checked: item.checked === true,
    ...(accelerator ? { accelerator } : {}),
    enabled: item.enabled && isEnabled(id),
    action: command(id)
  });

  const appMenu = await Submenu.new({
    text: menuState.appTitle,
    items: [
      await PredefinedMenuItem.new({ item: { About: { name: menuState.appTitle } } }),
      await separator(),
      await PredefinedMenuItem.new({ item: 'Hide' }),
      await PredefinedMenuItem.new({ item: 'HideOthers' }),
      await PredefinedMenuItem.new({ item: 'ShowAll' }),
      await separator(),
      await PredefinedMenuItem.new({ item: 'Quit' })
    ]
  });
  const openRecentMenu = recents.length > 0
    ? await Submenu.new({
        text: 'Open Recent',
        items: [
          ...recents.map((recent) => ({
            text: recent.label,
            enabled: true,
            action: () => {
              void openRecentFromMenu(recent.path, callbacks);
            }
          })),
          await separator(),
          { text: 'Clear Recent', enabled: true, action: command('clearRecentFiles') }
        ]
      })
    : null;
  const fileMenu = await Submenu.new({
    text: menuState.fileLabel,
    items: [
      commandItem('openFile', menuState.file.openFile, 'CmdOrCtrl+O'),
      commandItem('openFolder', menuState.file.openFolder, 'CmdOrCtrl+Shift+O'),
      ...(openRecentMenu ? [openRecentMenu] : []),
      await separator(),
      commandItem('exportImage', menuState.file.exportImage, 'CmdOrCtrl+E'),
      commandItem('exportScreenshot', menuState.file.exportScreenshot, 'CmdOrCtrl+Shift+E'),
      commandItem('exportBatch', menuState.file.exportBatch),
      commandItem('exportColormap', menuState.file.exportColormap),
      await separator(),
      commandItem('reloadAll', menuState.file.reloadAll, 'CmdOrCtrl+R'),
      commandItem('closeAll', menuState.file.closeAll, 'CmdOrCtrl+W')
    ]
  });
  const viewMenu = await Submenu.new({
    text: menuState.viewLabel,
    items: [
      await checkedCommandItem('viewerModeImage', menuState.view.image),
      await Submenu.new({
        text: menuState.view.panorama.trigger.text,
        enabled: menuState.view.panorama.trigger.enabled && isEnabled('viewerModePanorama'),
        items: [
          await checkedCommandItem('viewerModePanorama', menuState.view.panorama.image),
          await checkedCommandItem(
            'viewerModeEnvironmentPathTracing',
            menuState.view.panorama.environmentPathTracing
          ),
          await separator(),
          commandItem('pathTracingMaxSamples', menuState.view.panorama.maxSamples)
        ]
      }),
      await checkedCommandItem('viewerMode3d', menuState.view.threeD),
      await separator(),
      await checkedCommandItem('toggleRulers', menuState.view.rulers)
    ]
  });
  const windowMenu = await Submenu.new({
    text: menuState.windowLabel,
    items: [
      await checkedCommandItem('windowPreviewNormal', menuState.window.normal),
      await checkedCommandItem('windowPreviewFullscreen', menuState.window.fullscreenPreview)
    ]
  });
  const galleryMenu = await Submenu.new({
    text: menuState.galleryLabel,
    items: await buildNativeGalleryMenuItems(menuState.gallery, callbacks, Submenu)
  });
  const menu = await Menu.new({
    items: [appMenu, fileMenu, viewMenu, windowMenu, galleryMenu]
  });
  await menu.setAsAppMenu();
}

async function buildNativeGalleryMenuItems(
  items: NativeMenuItemState[],
  callbacks: DesktopCommandCallbacks,
  Submenu: TauriSubmenu
): Promise<TauriSubmenuItem[]> {
  const nativeItems: TauriSubmenuItem[] = [];
  for (const item of items) {
    if (item.children) {
      nativeItems.push(await Submenu.new({
        text: item.text,
        enabled: item.enabled,
        items: await buildNativeGalleryMenuItems(item.children, callbacks, Submenu)
      }));
      continue;
    }

    const galleryId = item.galleryId;
    nativeItems.push({
      text: item.text,
      enabled: item.enabled && Boolean(galleryId),
      action: () => {
        if (galleryId) {
          callbacks.onGalleryImageSelected?.(galleryId);
        }
      }
    });
  }
  return nativeItems;
}

function observeNativeMenuState(): MutationObserver | null {
  if (typeof MutationObserver !== 'function') {
    return null;
  }

  const root = document.getElementById('app-menu-bar');
  if (!root) {
    return null;
  }

  const observer = new MutationObserver(() => {
    refreshNativeMenu();
  });
  observer.observe(root, {
    subtree: true,
    attributes: true,
    attributeFilter: ['aria-checked', 'class', 'disabled', 'hidden']
  });
  return observer;
}

function readNativeMenuState(): NativeMenuState {
  return {
    appTitle: readText(document.querySelector('.app-menu-title'), 'Plenoview'),
    fileLabel: readButtonText('file-menu-button', 'File'),
    viewLabel: readButtonText('view-menu-button', 'View'),
    windowLabel: readButtonText('window-menu-button', 'Window'),
    galleryLabel: readButtonText('gallery-menu-button', 'Gallery'),
    file: {
      openFile: readButtonState('open-file-button', 'Open...'),
      openFolder: readButtonState('open-folder-button', 'Open Folder...'),
      exportImage: readButtonState('export-image-button', 'Export...'),
      exportScreenshot: readButtonState('export-screenshot-button', 'Export Screenshot...'),
      exportBatch: readButtonState('export-image-batch-button', 'Export Batch...'),
      exportColormap: readButtonState('export-colormap-button', 'Export Colormap...'),
      reloadAll: readButtonState('reload-all-opened-images-button', 'Reload All'),
      closeAll: readButtonState('close-all-opened-images-button', 'Close All')
    },
    view: {
      image: readButtonState('image-viewer-menu-item', 'Image viewer'),
      panorama: {
        trigger: readButtonState('panorama-viewer-menu-item', 'Panorama viewer'),
        image: readButtonState('panorama-image-menu-item', 'Panorama image'),
        environmentPathTracing: readButtonState(
          'environment-path-tracing-menu-item',
          'Environment lighting (path tracing)'
        ),
        maxSamples: readButtonState(
          'path-tracing-max-samples-menu-item',
          'Maximum SPP…'
        )
      },
      threeD: readButtonState('three-d-viewer-menu-item', '3D viewer'),
      rulers: readButtonState('rulers-menu-item', 'Rulers')
    },
    window: {
      normal: readButtonState('window-normal-menu-item', 'Normal'),
      fullscreenPreview: readButtonState('window-full-screen-preview-menu-item', 'Full Screen Preview')
    },
    gallery: readGalleryMenuState(document.getElementById('gallery-menu'))
  };
}

function readGalleryMenuState(root: HTMLElement | null): NativeMenuItemState[] {
  if (!root) {
    return [];
  }

  return Array.from(root.children)
    .map((child, index): NativeMenuItemState | null => {
      if (!(child instanceof HTMLElement) || child.classList.contains('hidden')) {
        return null;
      }

      if (child.classList.contains('app-menu-submenu')) {
        const trigger = child.querySelector<HTMLButtonElement>('.app-menu-submenu-trigger');
        const submenuId = trigger?.getAttribute('aria-controls');
        const submenu = submenuId ? document.getElementById(submenuId) : null;
        return {
          id: trigger?.id || `gallery-submenu-${index}`,
          text: readText(trigger, `Gallery ${index + 1}`),
          enabled: trigger ? !trigger.disabled : true,
          children: readGalleryMenuState(submenu instanceof HTMLElement ? submenu : null)
        };
      }

      if (child instanceof HTMLButtonElement && child.dataset.galleryId) {
        return {
          id: child.id || child.dataset.galleryId,
          text: readText(child, child.dataset.galleryId),
          enabled: !child.disabled,
          galleryId: child.dataset.galleryId
        };
      }

      return null;
    })
    .filter((item): item is NativeMenuItemState => item !== null);
}

function readButtonState(id: string, fallbackText: string): NativeMenuItemState {
  const element = document.getElementById(id);
  const button = element instanceof HTMLButtonElement ? element : null;
  return {
    id,
    text: readText(button, fallbackText),
    enabled: button ? !button.disabled && !button.classList.contains('hidden') : true,
    checked: button?.getAttribute('aria-checked') === 'true'
  };
}

function readButtonText(id: string, fallbackText: string): string {
  return readText(document.getElementById(id), fallbackText);
}

function readText(element: Element | null | undefined, fallbackText: string): string {
  const text = element?.textContent?.replace(/\s+/g, ' ').trim();
  return text || fallbackText;
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
  recents: DesktopRecentFile[],
  menuState: NativeMenuState
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
    recents: recentState,
    menu: menuState
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

  window.addEventListener('plenoview:desktop-recent-files-changed', render);
  clearButton.addEventListener('click', onClear);
  render();

  return {
    dispose: () => {
      window.removeEventListener('plenoview:desktop-recent-files-changed', render);
      clearButton.removeEventListener('click', onClear);
      section.remove();
    }
  };
}
