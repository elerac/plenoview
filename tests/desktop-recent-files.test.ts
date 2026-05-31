import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DESKTOP_RECENT_FILES_LIMIT,
  DESKTOP_RECENT_FILES_STORAGE_KEY,
  clearDesktopRecentFiles,
  readDesktopRecentFiles,
  rememberDesktopRecentFile,
  removeDesktopRecentFile
} from '../src/platform/desktop-recent-files';
import type { DesktopFileEntry } from '../src/platform';

function createMemoryStorage(): Storage {
  const entries = new Map<string, string>();
  return {
    get length() {
      return entries.size;
    },
    clear: () => entries.clear(),
    getItem: (key) => entries.get(key) ?? null,
    key: (index) => Array.from(entries.keys())[index] ?? null,
    removeItem: (key) => {
      entries.delete(key);
    },
    setItem: (key, value) => {
      entries.set(key, value);
    }
  };
}

function createEntry(index: number): DesktopFileEntry {
  return {
    path: `/renders/shot-${index}.exr`,
    filename: `shot-${index}.exr`,
    displayPath: `/renders/shot-${index}.exr`,
    fileSizeBytes: index + 1
  };
}

describe('desktop recent files', () => {
  let storage: Storage;

  beforeEach(() => {
    storage = createMemoryStorage();
    vi.useRealTimers();
  });

  it('stores recent path files most-recent-first and deduped', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-31T00:00:00Z'));
    rememberDesktopRecentFile(createEntry(1), storage);
    vi.setSystemTime(new Date('2026-05-31T00:01:00Z'));
    rememberDesktopRecentFile(createEntry(2), storage);
    vi.setSystemTime(new Date('2026-05-31T00:02:00Z'));
    rememberDesktopRecentFile(createEntry(1), storage);

    expect(readDesktopRecentFiles(storage)).toEqual([
      {
        path: '/renders/shot-1.exr',
        label: 'shot-1.exr',
        displayPath: '/renders/shot-1.exr',
        openedAt: Date.parse('2026-05-31T00:02:00Z')
      },
      {
        path: '/renders/shot-2.exr',
        label: 'shot-2.exr',
        displayPath: '/renders/shot-2.exr',
        openedAt: Date.parse('2026-05-31T00:01:00Z')
      }
    ]);
  });

  it('limits recent path files and removes stale paths', () => {
    for (let index = 0; index < DESKTOP_RECENT_FILES_LIMIT + 3; index += 1) {
      rememberDesktopRecentFile(createEntry(index), storage);
    }

    const recentFiles = readDesktopRecentFiles(storage);
    expect(recentFiles).toHaveLength(DESKTOP_RECENT_FILES_LIMIT);
    expect(recentFiles[0]?.path).toBe(`/renders/shot-${DESKTOP_RECENT_FILES_LIMIT + 2}.exr`);

    removeDesktopRecentFile(recentFiles[0]!.path, storage);
    expect(readDesktopRecentFiles(storage)).toHaveLength(DESKTOP_RECENT_FILES_LIMIT - 1);
  });

  it('ignores invalid storage and clears recents', () => {
    storage.setItem(DESKTOP_RECENT_FILES_STORAGE_KEY, '{');
    expect(readDesktopRecentFiles(storage)).toEqual([]);

    rememberDesktopRecentFile(createEntry(1), storage);
    clearDesktopRecentFiles(storage);
    expect(storage.getItem(DESKTOP_RECENT_FILES_STORAGE_KEY)).toBeNull();
  });
});
