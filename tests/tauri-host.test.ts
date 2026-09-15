// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const {
  checkMenuItemNewMock,
  getCurrentWindowMock,
  getCurrentWebviewMock,
  invokeMock,
  listenMock,
  menuNewMock,
  predefinedMenuItemNewMock,
  setAsAppMenuMock,
  submenuNewMock
} = vi.hoisted(() => ({
  checkMenuItemNewMock: vi.fn(),
  getCurrentWindowMock: vi.fn(),
  getCurrentWebviewMock: vi.fn(),
  invokeMock: vi.fn(),
  listenMock: vi.fn(),
  menuNewMock: vi.fn(),
  predefinedMenuItemNewMock: vi.fn(),
  setAsAppMenuMock: vi.fn(),
  submenuNewMock: vi.fn()
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: listenMock
}));

vi.mock('@tauri-apps/api/menu', () => ({
  CheckMenuItem: {
    new: checkMenuItemNewMock
  },
  Menu: {
    new: menuNewMock
  },
  PredefinedMenuItem: {
    new: predefinedMenuItemNewMock
  },
  Submenu: {
    new: submenuNewMock
  }
}));

vi.mock('@tauri-apps/api/webview', () => ({
  getCurrentWebview: getCurrentWebviewMock
}));

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: getCurrentWindowMock
}));

import { tauriHost } from '../src/platform/tauri-host';
import { normalizeDesktopError, presentDesktopError } from '../src/platform';

type DragDropTestCallback = (event: { payload: { type: string; paths: string[] } }) => void;

interface MockMenuItem {
  text?: string;
  enabled?: boolean;
  checked?: boolean;
  action?: () => void;
  items?: MockMenuItem[];
}

const appHtml = readFileSync(resolve(process.cwd(), 'app/index.html'), 'utf8');

beforeEach(() => {
  installAppMenuFixture();
  checkMenuItemNewMock.mockReset();
  getCurrentWindowMock.mockReset();
  invokeMock.mockReset();
  listenMock.mockReset();
  getCurrentWebviewMock.mockReset();
  menuNewMock.mockReset();
  predefinedMenuItemNewMock.mockReset();
  setAsAppMenuMock.mockReset();
  submenuNewMock.mockReset();

  menuNewMock.mockImplementation(async (options) => ({
    ...options,
    setAsAppMenu: setAsAppMenuMock
  }));
  checkMenuItemNewMock.mockImplementation(async (options) => ({ kind: 'check', ...options }));
  predefinedMenuItemNewMock.mockImplementation(async (options) => ({ kind: 'predefined', ...options }));
  submenuNewMock.mockImplementation(async (options) => ({ kind: 'submenu', ...options }));
  listenMock.mockResolvedValue(vi.fn());
  getCurrentWebviewMock.mockReturnValue({
    onDragDropEvent: vi.fn(async () => vi.fn())
  });
  getCurrentWindowMock.mockReturnValue({
    close: vi.fn(async () => undefined),
    isFullscreen: vi.fn(async () => false),
    isMaximized: vi.fn(async () => false),
    minimize: vi.fn(async () => undefined),
    onFocusChanged: vi.fn(async () => vi.fn()),
    onResized: vi.fn(async () => vi.fn()),
    setFullscreen: vi.fn(async () => undefined),
    startDragging: vi.fn(async () => undefined),
    toggleMaximize: vi.fn(async () => undefined)
  });
});

function installAppMenuFixture(): void {
  const bodyHtml = appHtml.match(/<body[^>]*>([\s\S]*)<\/body>/)?.[1] ?? appHtml;
  document.body.innerHTML = bodyHtml;
}

function findCreatedSubmenuOptions(text: string): MockMenuItem {
  const options = submenuNewMock.mock.calls
    .map((call) => call[0] as MockMenuItem)
    .filter((item) => item.text === text)
    .at(-1);
  if (!options) {
    throw new Error(`Expected native submenu "${text}" to be created.`);
  }
  return options;
}

function findMenuItem(menu: MockMenuItem, text: string): MockMenuItem {
  const item = getMenuItems(menu).find((candidate) => candidate.text === text);
  if (!item) {
    throw new Error(`Expected native menu item "${text}" to exist.`);
  }
  return item;
}

function readMenuItemLabels(menu: MockMenuItem): string[] {
  return getMenuItems(menu)
    .map((item) => item.text)
    .filter((text): text is string => typeof text === 'string');
}

function getMenuItems(menu: MockMenuItem): MockMenuItem[] {
  if (!menu.items) {
    throw new Error(`Expected native menu "${menu.text ?? '<unknown>'}" to have items.`);
  }
  return menu.items;
}

function runMenuAction(item: MockMenuItem): void {
  if (!item.action) {
    throw new Error(`Expected native menu item "${item.text ?? '<unknown>'}" to have an action.`);
  }
  item.action();
}

function setMenuCheckedState(id: string, checked: boolean): void {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Expected menu item "${id}" to exist.`);
  }
  element.setAttribute('aria-checked', checked ? 'true' : 'false');
}

function findCheckItem(items: MockMenuItem[], text: string): MockMenuItem {
  const item = items.find((candidate) => candidate.text === text);
  if (!item) {
    throw new Error(`Expected check menu item "${text}" to be created.`);
  }
  return item;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('tauri host', () => {
  it('returns typed save cancellation and sends raw bytes', async () => {
    invokeMock.mockResolvedValueOnce({ status: 'cancelled' });

    const result = await tauriHost.saveBlob(new Blob([new Uint8Array([1, 2, 3])]), {
      filename: 'beauty.png',
      title: 'Export Image',
      extensions: ['png']
    });

    expect(result).toEqual({ status: 'cancelled' });
    expect(invokeMock).toHaveBeenCalledWith('save_export_file', {
      filename: 'beauty.png',
      title: 'Export Image',
      extensions: ['png'],
      bytes: expect.any(Uint8Array)
    });
  });

  it('normalizes grant-backed path entries and reads by grant id', async () => {
    invokeMock
      .mockResolvedValueOnce([
        {
          grantId: 'grant-1',
          path: '/renders/beauty.exr',
          filename: 'beauty.exr',
          displayPath: '/renders/beauty.exr',
          fileSizeBytes: 3
        }
      ])
      .mockResolvedValueOnce(new Uint8Array([4, 5, 6]));

    const entries = await tauriHost.pathFileProvider!.resolveExrPaths(['/renders/beauty.exr']);
    const bytes = await tauriHost.pathFileProvider!.readExrFile(entries[0]!.grantId);

    expect(entries).toEqual([
      {
        grantId: 'grant-1',
        path: '/renders/beauty.exr',
        filename: 'beauty.exr',
        displayPath: '/renders/beauty.exr',
        fileSizeBytes: 3
      }
    ]);
    expect(bytes.bytes).toEqual(new Uint8Array([4, 5, 6]));
    expect(bytes).toEqual({
      grantId: 'grant-1',
      bytes: new Uint8Array([4, 5, 6])
    });
    expect(invokeMock).toHaveBeenNthCalledWith(1, 'resolve_exr_paths', { paths: ['/renders/beauty.exr'] });
    expect(invokeMock).toHaveBeenNthCalledWith(2, 'read_exr_file', { grantId: 'grant-1' });
  });

  it('detects the desktop platform through the Rust command', async () => {
    invokeMock.mockResolvedValueOnce('macos');

    await expect(tauriHost.desktopWindowChrome!.getPlatform()).resolves.toBe('macos');

    expect(invokeMock).toHaveBeenCalledWith('desktop_platform', undefined);
  });

  it('normalizes unknown desktop platforms', async () => {
    invokeMock.mockResolvedValueOnce('freebsd');

    await expect(tauriHost.desktopWindowChrome!.getPlatform()).resolves.toBe('unknown');
  });

  it('routes desktop window chrome controls through the Tauri window API', async () => {
    const windowApi = {
      close: vi.fn(async () => undefined),
      isMaximized: vi.fn(async () => true),
      minimize: vi.fn(async () => undefined),
      onFocusChanged: vi.fn(async () => vi.fn()),
      onResized: vi.fn(async () => vi.fn()),
      startDragging: vi.fn(async () => undefined),
      toggleMaximize: vi.fn(async () => undefined)
    };
    getCurrentWindowMock.mockReturnValue(windowApi);

    await tauriHost.desktopWindowChrome!.startDragging();
    await tauriHost.desktopWindowChrome!.minimize();
    await tauriHost.desktopWindowChrome!.toggleMaximize();
    await tauriHost.desktopWindowChrome!.close();
    await expect(tauriHost.desktopWindowChrome!.isMaximized()).resolves.toBe(true);

    expect(windowApi.startDragging).toHaveBeenCalledTimes(1);
    expect(windowApi.minimize).toHaveBeenCalledTimes(1);
    expect(windowApi.toggleMaximize).toHaveBeenCalledTimes(1);
    expect(windowApi.close).toHaveBeenCalledTimes(1);
    expect(windowApi.isMaximized).toHaveBeenCalledTimes(1);
  });

  it('subscribes desktop window chrome maximized state changes', async () => {
    const resizeCallbacks: Array<() => void> = [];
    const resizeDispose = vi.fn();
    const focusDispose = vi.fn();
    const onMaximizedChange = vi.fn();
    const windowApi = {
      isMaximized: vi.fn(async () => true),
      onFocusChanged: vi.fn(async () => focusDispose),
      onResized: vi.fn(async (callback: () => void) => {
        resizeCallbacks.push(callback);
        return resizeDispose;
      })
    };
    getCurrentWindowMock.mockReturnValue(windowApi);

    const subscription = await tauriHost.desktopWindowChrome!.onMaximizedChange(onMaximizedChange);
    expect(resizeCallbacks).toHaveLength(1);
    resizeCallbacks[0]!();
    await Promise.resolve();

    expect(onMaximizedChange).toHaveBeenCalledWith(true);

    subscription.dispose();
    expect(resizeDispose).toHaveBeenCalledTimes(1);
    expect(focusDispose).toHaveBeenCalledTimes(1);
  });

  it('normalizes structured desktop command errors', () => {
    const error = normalizeDesktopError({ code: 'notFound', message: 'File does not exist.' });

    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe('notFound');
    expect(error.message).toBe('File does not exist.');
  });

  it('reports desktop dialog errors without falling back to browser inputs', async () => {
    const fallback = vi.fn();
    const onError = vi.fn();
    invokeMock.mockRejectedValueOnce({ code: 'permissionDenied', message: 'No access.' });

    tauriHost.openFiles({
      fallback,
      onEntries: vi.fn(),
      onError
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fallback).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({
      code: 'permissionDenied',
      message: 'No access.'
    }));
  });

  it('uses Rust-owned recent files and records successful grant loads', async () => {
    const recentChanged = vi.fn();
    window.addEventListener('plenoview:desktop-recent-files-changed', recentChanged);
    invokeMock
      .mockResolvedValueOnce([
        {
          path: '/renders/beauty.exr',
          label: 'beauty.exr',
          displayPath: '/renders/beauty.exr',
          openedAt: 123
        }
      ])
      .mockResolvedValueOnce([]);

    try {
      await expect(tauriHost.refreshRecentFiles()).resolves.toEqual([
        {
          path: '/renders/beauty.exr',
          label: 'beauty.exr',
          displayPath: '/renders/beauty.exr',
          openedAt: 123
        }
      ]);

      tauriHost.recordRecentFile({
        grantId: 'grant-1',
        path: '/renders/beauty.exr',
        filename: 'beauty.exr',
        displayPath: '/renders/beauty.exr',
        fileSizeBytes: 3
      });
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(invokeMock).toHaveBeenNthCalledWith(2, 'record_recent_file', { grantId: 'grant-1' });
      expect(recentChanged).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener('plenoview:desktop-recent-files-changed', recentChanged);
    }
  });

  it('adds parent folder suffixes to duplicate recent labels', async () => {
    invokeMock.mockResolvedValueOnce([
      {
        path: '/renders/shot-a/beauty.exr',
        label: 'beauty.exr',
        displayPath: '/renders/shot-a/beauty.exr',
        openedAt: 124
      },
      {
        path: '/renders/shot-b/beauty.exr',
        label: 'beauty.exr',
        displayPath: '/renders/shot-b/beauty.exr',
        openedAt: 123
      }
    ]);

    await expect(tauriHost.refreshRecentFiles()).resolves.toEqual([
      {
        path: '/renders/shot-a/beauty.exr',
        label: 'beauty.exr - shot-a',
        displayPath: '/renders/shot-a/beauty.exr',
        openedAt: 124
      },
      {
        path: '/renders/shot-b/beauty.exr',
        label: 'beauty.exr - shot-b',
        displayPath: '/renders/shot-b/beauty.exr',
        openedAt: 123
      }
    ]);
  });

  it('routes native menu commands through desktop command callbacks', async () => {
    invokeMock.mockResolvedValueOnce([]);
    const onCommand = vi.fn();

    await tauriHost.setupDesktopCommands({
      onCommand,
      onOpenRecent: vi.fn()
    });

    const fileMenuOptions = findCreatedSubmenuOptions('File');
    const openItem = findMenuItem(fileMenuOptions, 'Open...');
    runMenuAction(openItem);

    expect(onCommand).toHaveBeenCalledWith('openFile');
    const panoramaMenu = findMenuItem(findCreatedSubmenuOptions('View'), 'Panorama viewer');
    runMenuAction(findMenuItem(panoramaMenu, 'Maximum SPP…'));
    expect(onCommand).toHaveBeenCalledWith('pathTracingMaxSamples');
    expect(setAsAppMenuMock).toHaveBeenCalledTimes(1);
  });

  it('mirrors the visible app, file, view, window, and gallery menu labels', async () => {
    invokeMock.mockResolvedValueOnce([]);

    await tauriHost.setupDesktopCommands({
      onCommand: vi.fn(),
      onOpenRecent: vi.fn()
    });

    const menuOptions = menuNewMock.mock.calls.at(-1)?.[0];
    const nativeMenuLabels = menuOptions.items.map((item: { text?: string }) => item.text);
    const fileMenuOptions = findCreatedSubmenuOptions('File');
    const viewMenuOptions = findCreatedSubmenuOptions('View');
    const windowMenuOptions = findCreatedSubmenuOptions('Window');
    const galleryMenuOptions = findCreatedSubmenuOptions('Gallery');
    const nativeFileMenuItemLabels = readMenuItemLabels(fileMenuOptions);
    const nativeViewMenuItemLabels = readMenuItemLabels(viewMenuOptions);
    const nativeWindowMenuItemLabels = readMenuItemLabels(windowMenuOptions);
    const nativeGalleryMenuItemLabels = readMenuItemLabels(galleryMenuOptions);

    expect(nativeMenuLabels).toEqual(['Plenoview', 'File', 'View', 'Window', 'Gallery']);
    expect(nativeMenuLabels).not.toContain('Edit');
    expect(nativeFileMenuItemLabels).toEqual([
      'Open...',
      'Open Folder...',
      'Export...',
      'Export Screenshot...',
      'Export Batch...',
      'Export Colormap...',
      'Reload All',
      'Close All'
    ]);
    expect(nativeViewMenuItemLabels).toEqual([
      'Image viewer',
      'Panorama viewer',
      '3D viewer',
      'Rulers'
    ]);
    expect(readMenuItemLabels(findMenuItem(viewMenuOptions, 'Panorama viewer'))).toEqual([
      'Panorama image',
      'Environment lighting (SH)',
      'Environment lighting (path tracing)',
      'Maximum SPP…'
    ]);
    expect(nativeWindowMenuItemLabels).toEqual(['Normal', 'Full Screen Preview']);
    expect(nativeWindowMenuItemLabels).not.toEqual(expect.arrayContaining([
      'Single Pane',
      'Split Vertically',
      'Split Horizontally',
      'Toggle App Fullscreen',
      'Minimize'
    ]));
    expect(nativeGalleryMenuItemLabels).toEqual([
      'cbox_rgb.exr',
      'Beachball',
      'Middlebury Stereo',
      'Poly Haven',
      'KAIST Hyperspectral',
      'Polanalyser'
    ]);
  });

  it('routes native Gallery items through the gallery callback', async () => {
    invokeMock.mockResolvedValueOnce([]);
    const onGalleryImageSelected = vi.fn();

    await tauriHost.setupDesktopCommands({
      onCommand: vi.fn(),
      onOpenRecent: vi.fn(),
      onGalleryImageSelected
    });

    const galleryMenuOptions = findCreatedSubmenuOptions('Gallery');
    const cboxItem = findMenuItem(galleryMenuOptions, 'cbox_rgb.exr');
    const polyHavenMenu = findMenuItem(galleryMenuOptions, 'Poly Haven');
    const kaistMenu = findMenuItem(galleryMenuOptions, 'KAIST Hyperspectral');
    const polanalyserMenu = findMenuItem(galleryMenuOptions, 'Polanalyser');

    expect(readMenuItemLabels(polyHavenMenu)).toEqual([
      'artist_workshop_1k.exr',
      'brown_photostudio_02_1k.exr',
      'symmetrical_garden_02_1k.exr'
    ]);
    expect(readMenuItemLabels(kaistMenu).at(0)).toBe('scene01_reflectance.exr');
    expect(readMenuItemLabels(kaistMenu).at(-1)).toBe('scene30_reflectance.exr');
    expect(readMenuItemLabels(polanalyserMenu).at(0)).toBe('avocado.exr');
    expect(readMenuItemLabels(polanalyserMenu).at(-1)).toBe('spoons.exr');

    runMenuAction(cboxItem);
    runMenuAction(findMenuItem(polyHavenMenu, 'brown_photostudio_02_1k.exr'));

    expect(onGalleryImageSelected).toHaveBeenCalledTimes(2);
    expect(onGalleryImageSelected).toHaveBeenNthCalledWith(1, 'cbox-rgb');
    expect(onGalleryImageSelected).toHaveBeenNthCalledWith(2, 'brown-photostudio-02-1k');
  });

  it('creates checked native menu items from DOM aria-checked state', async () => {
    invokeMock.mockResolvedValueOnce([]);
    setMenuCheckedState('image-viewer-menu-item', false);
    setMenuCheckedState('panorama-image-menu-item', false);
    setMenuCheckedState('environment-lighting-menu-item', true);
    setMenuCheckedState('environment-path-tracing-menu-item', false);
    setMenuCheckedState('rulers-menu-item', true);
    setMenuCheckedState('window-normal-menu-item', false);
    setMenuCheckedState('window-full-screen-preview-menu-item', true);

    await tauriHost.setupDesktopCommands({
      onCommand: vi.fn(),
      onOpenRecent: vi.fn()
    });

    const checkItems = checkMenuItemNewMock.mock.calls.map((call) => call[0]);

    expect(findCheckItem(checkItems, 'Image viewer').checked).toBe(false);
    expect(findCheckItem(checkItems, 'Panorama image').checked).toBe(false);
    expect(findCheckItem(checkItems, 'Environment lighting (SH)').checked).toBe(true);
    expect(findCheckItem(checkItems, 'Environment lighting (path tracing)').checked).toBe(false);
    expect(findCheckItem(checkItems, 'Rulers').checked).toBe(true);
    expect(findCheckItem(checkItems, 'Normal').checked).toBe(false);
    expect(findCheckItem(checkItems, 'Full Screen Preview').checked).toBe(true);
  });

  it('includes native Open Recent only when recent files exist', async () => {
    invokeMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          path: '/renders/beauty.exr',
          label: 'beauty.exr',
          displayPath: '/renders/beauty.exr',
          openedAt: 123
        }
      ]);

    await tauriHost.setupDesktopCommands({
      onCommand: vi.fn(),
      onOpenRecent: vi.fn()
    });
    expect(readMenuItemLabels(findCreatedSubmenuOptions('File'))).not.toContain('Open Recent');

    await tauriHost.setupDesktopCommands({
      onCommand: vi.fn(),
      onOpenRecent: vi.fn()
    });

    const fileMenuOptions = findCreatedSubmenuOptions('File');
    const recentMenu = findMenuItem(fileMenuOptions, 'Open Recent');
    expect(readMenuItemLabels(fileMenuOptions)).toContain('Open Recent');
    expect(readMenuItemLabels(recentMenu)).toEqual([
      'beauty.exr',
      'Clear Recent'
    ]);
  });

  it('applies native menu command enabled state', async () => {
    invokeMock.mockResolvedValueOnce([]);

    await tauriHost.setupDesktopCommands({
      onCommand: vi.fn(),
      onOpenRecent: vi.fn(),
      getCommandState: () => ({
        exportImage: false,
        reloadAll: false
      })
    });

    const fileMenuOptions = findCreatedSubmenuOptions('File');
    expect(findMenuItem(fileMenuOptions, 'Export...').enabled).toBe(false);
    expect(findMenuItem(fileMenuOptions, 'Reload All').enabled).toBe(false);
  });

  it('debounces native menu refreshes and skips unchanged menu state', async () => {
    vi.useFakeTimers();
    let exportEnabled = false;
    invokeMock.mockResolvedValue([]);

    await tauriHost.setupDesktopCommands({
      onCommand: vi.fn(),
      onOpenRecent: vi.fn(),
      getCommandState: () => ({
        exportImage: exportEnabled
      })
    });
    expect(setAsAppMenuMock).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new Event('plenoview:desktop-command-state-changed'));
    window.dispatchEvent(new Event('plenoview:desktop-command-state-changed'));
    await vi.advanceTimersByTimeAsync(100);
    await Promise.resolve();
    expect(setAsAppMenuMock).toHaveBeenCalledTimes(1);

    exportEnabled = true;
    window.dispatchEvent(new Event('plenoview:desktop-command-state-changed'));
    await vi.advanceTimersByTimeAsync(100);
    await Promise.resolve();
    expect(setAsAppMenuMock).toHaveBeenCalledTimes(2);
  });

  it('presents concise desktop error messages by code', () => {
    expect(presentDesktopError({ code: 'permissionDenied', message: 'os detail' })).toEqual({
      code: 'permissionDenied',
      message: 'Permission denied while accessing the file.',
      detail: 'os detail'
    });
  });

  it('reports stale native recent opens and refreshes recent menus', async () => {
    const onError = vi.fn();
    invokeMock
      .mockResolvedValueOnce([
        {
          path: '/renders/missing.exr',
          label: 'missing.exr',
          displayPath: '/renders/missing.exr',
          openedAt: 123
        }
      ])
      .mockRejectedValueOnce({ code: 'notFound', message: 'File does not exist.' })
      .mockResolvedValueOnce([]);

    await tauriHost.setupDesktopCommands({
      onCommand: vi.fn(),
      onOpenRecent: vi.fn(),
      onError
    });

    const fileMenuOptions = findCreatedSubmenuOptions('File');
    const recentMenu = findMenuItem(fileMenuOptions, 'Open Recent');
    runMenuAction(getMenuItems(recentMenu)[0]!);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(onError).toHaveBeenCalledWith(expect.objectContaining({
      code: 'notFound',
      message: 'File does not exist.'
    }));
    expect(invokeMock).toHaveBeenNthCalledWith(3, 'get_recent_files', undefined);
  });

  it('reports native drag-drop resolution failures and clears overlay state', async () => {
    let dragDropCallback: DragDropTestCallback | null = null;
    const onError = vi.fn();
    const onDragStateChange = vi.fn();
    const onDragDropEvent = vi.fn(async (callback) => {
      dragDropCallback = callback;
      return vi.fn();
    });
    getCurrentWebviewMock.mockReturnValue({
      onDragDropEvent
    });
    invokeMock
      .mockResolvedValueOnce([]);

    await tauriHost.setupDesktopEvents({
      onEntries: vi.fn(),
      onDragStateChange,
      onError
    });
    invokeMock.mockRejectedValueOnce({ code: 'notExr', message: 'File is not an OpenEXR .exr file.' });

    expect(dragDropCallback).not.toBeNull();
    (dragDropCallback as unknown as DragDropTestCallback)({
      payload: { type: 'drop', paths: ['/renders/readme.txt'] }
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(onDragStateChange).toHaveBeenCalledWith(false);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({
      code: 'notExr',
      message: 'File is not an OpenEXR .exr file.'
    }));
  });
});
