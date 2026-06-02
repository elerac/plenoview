export const DEFAULT_SPECTRAL_RGB_GROUPING_ENABLED = true;
export const SPECTRAL_RGB_GROUPING_STORAGE_KEY = 'prismifold:spectral-rgb-grouping:v1';

export function normalizeSpectralRgbGroupingSetting(input: unknown): boolean {
  return typeof input === 'boolean' ? input : DEFAULT_SPECTRAL_RGB_GROUPING_ENABLED;
}

export function readStoredSpectralRgbGroupingSetting(): boolean {
  if (typeof window === 'undefined') {
    return DEFAULT_SPECTRAL_RGB_GROUPING_ENABLED;
  }

  try {
    const raw = window.localStorage.getItem(SPECTRAL_RGB_GROUPING_STORAGE_KEY);
    if (raw === null) {
      return DEFAULT_SPECTRAL_RGB_GROUPING_ENABLED;
    }

    return normalizeSpectralRgbGroupingSetting(JSON.parse(raw));
  } catch {
    return DEFAULT_SPECTRAL_RGB_GROUPING_ENABLED;
  }
}

export function saveStoredSpectralRgbGroupingSetting(enabled: boolean): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    if (enabled === DEFAULT_SPECTRAL_RGB_GROUPING_ENABLED) {
      window.localStorage.removeItem(SPECTRAL_RGB_GROUPING_STORAGE_KEY);
      return;
    }

    window.localStorage.setItem(SPECTRAL_RGB_GROUPING_STORAGE_KEY, JSON.stringify(enabled));
  } catch {
    // Storage can be unavailable in private contexts; keep the runtime setting anyway.
  }
}
