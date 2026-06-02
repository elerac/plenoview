// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getCurrentWebviewMock,
  invokeMock,
  listenMock,
  menuNewMock,
  predefinedMenuItemNewMock,
  setAsAppMenuMock,
  submenuNewMock
} = vi.hoisted(() => ({
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

import { tauriHost } from '../src/platform/tauri-host';
import { normalizeDesktopError, presentDesktopError } from '../src/platform';

type DragDropTestCallback = (event: { payload: { type: string; paths: string[] } }) => void;

beforeEach(() => {
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
  predefinedMenuItemNewMock.mockImplementation(async (options) => ({ kind: 'predefined', ...options }));
  submenuNewMock.mockImplementation(async (options) => ({ kind: 'submenu', ...options }));
  listenMock.mockResolvedValue(vi.fn());
  getCurrentWebviewMock.mockReturnValue({
    onDragDropEvent: vi.fn(async () => vi.fn())
  });
});

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
    window.addEventListener('prismifold:desktop-recent-files-changed', recentChanged);
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
      window.removeEventListener('prismifold:desktop-recent-files-changed', recentChanged);
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

    const fileMenuOptions = submenuNewMock.mock.calls
      .map((call) => call[0])
      .find((options) => options.text === 'File');
    const openItem = fileMenuOptions.items.find((item: { text?: string }) => item.text === 'Open...');
    openItem.action();

    expect(onCommand).toHaveBeenCalledWith('openFile');
    expect(setAsAppMenuMock).toHaveBeenCalledTimes(1);
  });

  it('keeps the native Window menu while hiding pane entries', async () => {
    invokeMock.mockResolvedValueOnce([]);

    await tauriHost.setupDesktopCommands({
      onCommand: vi.fn(),
      onOpenRecent: vi.fn()
    });

    const submenuLabels = submenuNewMock.mock.calls.map((call) => call[0].text);
    const windowMenuOptions = submenuNewMock.mock.calls
      .map((call) => call[0])
      .find((options) => options.text === 'Window');
    const menuOptions = menuNewMock.mock.calls.at(-1)?.[0];
    const nativeMenuLabels = menuOptions.items.map((item: { text?: string }) => item.text);
    const nativeWindowMenuItemLabels = windowMenuOptions.items
      .map((item: { text?: string }) => item.text)
      .filter((text: string | undefined): text is string => text !== undefined);

    expect(nativeMenuLabels).toEqual(['File', 'Edit', 'View', 'Window']);
    expect(submenuLabels).toContain('Window');
    expect(nativeWindowMenuItemLabels).toEqual([
      'Normal Preview',
      'Full Screen Preview',
      'Toggle App Fullscreen'
    ]);
    expect(nativeWindowMenuItemLabels).not.toEqual(expect.arrayContaining([
      'Single Pane',
      'Split Vertically',
      'Split Horizontally'
    ]));
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

    const fileMenuOptions = submenuNewMock.mock.calls
      .map((call) => call[0])
      .find((options) => options.text === 'File');
    expect(fileMenuOptions.items.find((item: { text?: string }) => item.text === 'Export...').enabled).toBe(false);
    expect(fileMenuOptions.items.find((item: { text?: string }) => item.text === 'Reload All').enabled).toBe(false);
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

    window.dispatchEvent(new Event('prismifold:desktop-command-state-changed'));
    window.dispatchEvent(new Event('prismifold:desktop-command-state-changed'));
    await vi.advanceTimersByTimeAsync(100);
    await Promise.resolve();
    expect(setAsAppMenuMock).toHaveBeenCalledTimes(1);

    exportEnabled = true;
    window.dispatchEvent(new Event('prismifold:desktop-command-state-changed'));
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

    const fileMenuOptions = submenuNewMock.mock.calls
      .map((call) => call[0])
      .find((options) => options.text === 'File');
    const recentMenu = fileMenuOptions.items.find((item: { text?: string }) => item.text === 'Open Recent');
    recentMenu.items[0].action();
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
