export const VIEWER_BACKGROUND_STORAGE_KEY = 'prismifold:viewer-background:v1';
export const DEFAULT_VIEWER_BACKGROUND_ID = 'checker';

interface ViewerBackgroundDefinitionBase {
  id: string;
  label: string;
  color: readonly [number, number, number] | null;
}

export const VIEWER_BACKGROUNDS = [
  { id: DEFAULT_VIEWER_BACKGROUND_ID, label: 'Checker', color: null },
  { id: 'white', label: 'White', color: [1, 1, 1] },
  { id: 'black', label: 'Black', color: [0, 0, 0] },
  { id: 'gray', label: 'Gray', color: [0.5, 0.5, 0.5] }
] as const satisfies readonly ViewerBackgroundDefinitionBase[];

const FALLBACK_VIEWER_BACKGROUND_COLOR = [0, 0, 0] as const;

export type ViewerBackgroundId = (typeof VIEWER_BACKGROUNDS)[number]['id'];

export interface ViewerBackgroundDefinition {
  id: ViewerBackgroundId;
  label: string;
  color: readonly [number, number, number] | null;
}

export function isViewerBackgroundId(value: string | null): value is ViewerBackgroundId {
  return VIEWER_BACKGROUNDS.some((background) => background.id === value);
}

export function parseStoredViewerBackground(value: string | null): ViewerBackgroundId {
  return isViewerBackgroundId(value) ? value : DEFAULT_VIEWER_BACKGROUND_ID;
}

export function readStoredViewerBackground(): ViewerBackgroundId {
  if (typeof window === 'undefined') {
    return DEFAULT_VIEWER_BACKGROUND_ID;
  }

  try {
    return parseStoredViewerBackground(window.localStorage.getItem(VIEWER_BACKGROUND_STORAGE_KEY));
  } catch {
    return DEFAULT_VIEWER_BACKGROUND_ID;
  }
}

export function saveStoredViewerBackground(background: ViewerBackgroundId): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    if (background === DEFAULT_VIEWER_BACKGROUND_ID) {
      window.localStorage.removeItem(VIEWER_BACKGROUND_STORAGE_KEY);
    } else {
      window.localStorage.setItem(VIEWER_BACKGROUND_STORAGE_KEY, background);
    }
  } catch {
    // Storage can be unavailable in private contexts; keep the runtime setting anyway.
  }
}

export function getViewerBackgroundColor(background: ViewerBackgroundId): readonly [number, number, number] {
  return VIEWER_BACKGROUNDS.find((item) => item.id === background)?.color ?? FALLBACK_VIEWER_BACKGROUND_COLOR;
}

export function isSolidViewerBackground(background: ViewerBackgroundId): boolean {
  return background !== DEFAULT_VIEWER_BACKGROUND_ID;
}
