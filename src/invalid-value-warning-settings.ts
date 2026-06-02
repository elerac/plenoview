export const INVALID_VALUE_WARNING_STORAGE_KEY = 'prismifold:invalid-value-warning:v1';
export const DEFAULT_INVALID_VALUE_WARNING_ENABLED = true;

export function normalizeInvalidValueWarningSetting(input: unknown): boolean {
  return typeof input === 'boolean' ? input : DEFAULT_INVALID_VALUE_WARNING_ENABLED;
}

export function readStoredInvalidValueWarningSetting(): boolean {
  if (typeof window === 'undefined') {
    return DEFAULT_INVALID_VALUE_WARNING_ENABLED;
  }

  try {
    const raw = window.localStorage.getItem(INVALID_VALUE_WARNING_STORAGE_KEY);
    if (raw === null) {
      return DEFAULT_INVALID_VALUE_WARNING_ENABLED;
    }

    return normalizeInvalidValueWarningSetting(JSON.parse(raw));
  } catch {
    return DEFAULT_INVALID_VALUE_WARNING_ENABLED;
  }
}

export function saveStoredInvalidValueWarningSetting(enabled: boolean): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    if (enabled === DEFAULT_INVALID_VALUE_WARNING_ENABLED) {
      window.localStorage.removeItem(INVALID_VALUE_WARNING_STORAGE_KEY);
      return;
    }

    window.localStorage.setItem(INVALID_VALUE_WARNING_STORAGE_KEY, JSON.stringify(enabled));
  } catch {
    // Storage can be unavailable in private contexts; keep the runtime setting anyway.
  }
}
