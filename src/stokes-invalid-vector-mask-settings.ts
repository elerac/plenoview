import { DEFAULT_MASK_INVALID_STOKES_VECTORS } from './stokes';

export const STOKES_INVALID_VECTOR_MASK_STORAGE_KEY = 'openexr-viewer:stokes-invalid-vector-mask:v1';

export function normalizeStokesInvalidVectorMaskSetting(input: unknown): boolean {
  return typeof input === 'boolean' ? input : DEFAULT_MASK_INVALID_STOKES_VECTORS;
}

export function readStoredStokesInvalidVectorMaskSetting(): boolean {
  if (typeof window === 'undefined') {
    return DEFAULT_MASK_INVALID_STOKES_VECTORS;
  }

  try {
    const raw = window.localStorage.getItem(STOKES_INVALID_VECTOR_MASK_STORAGE_KEY);
    if (raw === null) {
      return DEFAULT_MASK_INVALID_STOKES_VECTORS;
    }

    return normalizeStokesInvalidVectorMaskSetting(JSON.parse(raw));
  } catch {
    return DEFAULT_MASK_INVALID_STOKES_VECTORS;
  }
}

export function saveStoredStokesInvalidVectorMaskSetting(enabled: boolean): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    if (enabled === DEFAULT_MASK_INVALID_STOKES_VECTORS) {
      window.localStorage.removeItem(STOKES_INVALID_VECTOR_MASK_STORAGE_KEY);
      return;
    }

    window.localStorage.setItem(STOKES_INVALID_VECTOR_MASK_STORAGE_KEY, JSON.stringify(enabled));
  } catch {
    // Storage can be unavailable in private contexts; keep the runtime setting anyway.
  }
}
