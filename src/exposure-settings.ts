export interface ExposureRange {
  minEv: number;
  maxEv: number;
}

export const DEFAULT_EXPOSURE_RANGE: Readonly<ExposureRange> = { minEv: -10, maxEv: 10 };
export const EXPOSURE_RANGE_STORAGE_KEY = 'plenoview:exposure-range:v1';

export function normalizeExposureRange(value: unknown): ExposureRange {
  if (value && typeof value === 'object') {
    const { minEv, maxEv } = value as Partial<ExposureRange>;
    if (typeof minEv === 'number' && Number.isFinite(minEv) &&
        typeof maxEv === 'number' && Number.isFinite(maxEv)) {
      const min = Number(minEv.toFixed(1));
      const max = Number(maxEv.toFixed(1));
      if (min <= 0 && max >= 0 && min < max) {
        return { minEv: min, maxEv: max };
      }
    }
  }
  return { ...DEFAULT_EXPOSURE_RANGE };
}

export function clampExposureEv(value: number, range: ExposureRange): number {
  return Math.min(range.maxEv, Math.max(range.minEv, Number.isFinite(value) ? value : 0));
}

export function readStoredExposureRange(): ExposureRange {
  try {
    return normalizeExposureRange(JSON.parse(window.localStorage.getItem(EXPOSURE_RANGE_STORAGE_KEY) ?? 'null'));
  } catch {
    return { ...DEFAULT_EXPOSURE_RANGE };
  }
}

export function saveStoredExposureRange(range: ExposureRange): void {
  try {
    const normalized = normalizeExposureRange(range);
    if (normalized.minEv === DEFAULT_EXPOSURE_RANGE.minEv && normalized.maxEv === DEFAULT_EXPOSURE_RANGE.maxEv) {
      window.localStorage.removeItem(EXPOSURE_RANGE_STORAGE_KEY);
    } else {
      window.localStorage.setItem(EXPOSURE_RANGE_STORAGE_KEY, JSON.stringify(normalized));
    }
  } catch {
    // Keep the runtime setting when storage is unavailable.
  }
}
