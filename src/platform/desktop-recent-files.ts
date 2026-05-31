import type { Disposable } from '../lifecycle';
import type { DesktopFileEntry, RecentFileCallbacks } from './types';

export const DESKTOP_RECENT_FILES_STORAGE_KEY = 'openexr-viewer:desktop-recent-files:v1';
export const DESKTOP_RECENT_FILES_LIMIT = 12;
const DESKTOP_RECENT_FILES_CHANGED_EVENT = 'openexr-viewer:desktop-recent-files-changed';

export interface DesktopRecentFile {
  path: string;
  label: string;
  displayPath: string;
  openedAt: number;
}

export function readDesktopRecentFiles(storage: Storage = window.localStorage): DesktopRecentFile[] {
  try {
    const raw = storage.getItem(DESKTOP_RECENT_FILES_STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .map(parseRecentFile)
      .filter((item): item is DesktopRecentFile => item !== null)
      .slice(0, DESKTOP_RECENT_FILES_LIMIT);
  } catch {
    return [];
  }
}

export function rememberDesktopRecentFile(
  entry: DesktopFileEntry,
  storage: Storage = window.localStorage
): DesktopRecentFile[] {
  const nextItem: DesktopRecentFile = {
    path: entry.path,
    label: entry.filename,
    displayPath: entry.displayPath ?? entry.path,
    openedAt: Date.now()
  };
  const existing = readDesktopRecentFiles(storage).filter((item) => item.path !== entry.path);
  const next = [nextItem, ...existing].slice(0, DESKTOP_RECENT_FILES_LIMIT);
  writeDesktopRecentFiles(next, storage);
  dispatchRecentFilesChanged(storage);
  return next;
}

export function removeDesktopRecentFile(path: string, storage: Storage = window.localStorage): DesktopRecentFile[] {
  const next = readDesktopRecentFiles(storage).filter((item) => item.path !== path);
  writeDesktopRecentFiles(next, storage);
  dispatchRecentFilesChanged(storage);
  return next;
}

export function clearDesktopRecentFiles(storage: Storage = window.localStorage): void {
  try {
    storage.removeItem(DESKTOP_RECENT_FILES_STORAGE_KEY);
  } catch {
    // Storage can be unavailable in private modes or constrained webviews.
  }
  dispatchRecentFilesChanged(storage);
}

export function installDesktopRecentFilesMenu(callbacks: RecentFileCallbacks): Disposable {
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
    const recentFiles = readDesktopRecentFiles();
    section.hidden = recentFiles.length === 0;
    itemsContainer.replaceChildren();
    for (const item of recentFiles) {
      const button = document.createElement('button');
      button.className = 'app-menu-item';
      button.type = 'button';
      button.setAttribute('role', 'menuitem');
      button.textContent = `Open Recent: ${item.label}`;
      button.title = item.displayPath;
      button.addEventListener('click', () => {
        callbacks.onOpenPath(item.path);
      });
      itemsContainer.append(button);
    }
  };

  const onStorage = (event: StorageEvent) => {
    if (event.key === DESKTOP_RECENT_FILES_STORAGE_KEY) {
      render();
    }
  };
  const onClear = () => {
    clearDesktopRecentFiles();
    render();
  };

  window.addEventListener('storage', onStorage);
  window.addEventListener(DESKTOP_RECENT_FILES_CHANGED_EVENT, render);
  clearButton.addEventListener('click', onClear);
  render();

  return {
    dispose: () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(DESKTOP_RECENT_FILES_CHANGED_EVENT, render);
      clearButton.removeEventListener('click', onClear);
      section.remove();
    }
  };
}

function parseRecentFile(value: unknown): DesktopRecentFile | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const candidate = value as Partial<DesktopRecentFile>;
  if (
    typeof candidate.path !== 'string' ||
    typeof candidate.label !== 'string' ||
    typeof candidate.displayPath !== 'string' ||
    typeof candidate.openedAt !== 'number'
  ) {
    return null;
  }
  return {
    path: candidate.path,
    label: candidate.label,
    displayPath: candidate.displayPath,
    openedAt: candidate.openedAt
  };
}

function writeDesktopRecentFiles(files: DesktopRecentFile[], storage: Storage): void {
  try {
    storage.setItem(DESKTOP_RECENT_FILES_STORAGE_KEY, JSON.stringify(files));
  } catch {
    // Recents are a convenience feature; loading/exporting should not depend on storage.
  }
}

function dispatchRecentFilesChanged(storage: Storage): void {
  if (typeof window === 'undefined' || storage !== window.localStorage) {
    return;
  }
  window.dispatchEvent(new Event(DESKTOP_RECENT_FILES_CHANGED_EVENT));
}
