import {
  STOKES_COLORMAP_DEFAULT_GROUPS,
  cloneStokesParameterVisibilitySettings,
  createDefaultStokesParameterVisibilitySettings,
  type StokesParameterVisibilitySettings
} from './stokes';

export const STOKES_PARAMETER_VISIBILITY_STORAGE_KEY = 'openexr-viewer:stokes-parameter-visibility:v1';

export function normalizeStokesParameterVisibilitySettings(input: unknown): StokesParameterVisibilitySettings {
  const settings = createDefaultStokesParameterVisibilitySettings();
  const record = isRecord(input) ? input : {};

  for (const group of STOKES_COLORMAP_DEFAULT_GROUPS) {
    if (typeof record[group] === 'boolean') {
      settings[group] = record[group];
    }
  }

  return settings;
}

export function readStoredStokesParameterVisibilitySettings(): StokesParameterVisibilitySettings {
  if (typeof window === 'undefined') {
    return createDefaultStokesParameterVisibilitySettings();
  }

  try {
    const raw = window.localStorage.getItem(STOKES_PARAMETER_VISIBILITY_STORAGE_KEY);
    if (!raw) {
      return createDefaultStokesParameterVisibilitySettings();
    }

    return normalizeStokesParameterVisibilitySettings(JSON.parse(raw));
  } catch {
    return createDefaultStokesParameterVisibilitySettings();
  }
}

export function saveStoredStokesParameterVisibilitySettings(settings: StokesParameterVisibilitySettings): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    if (sameStokesParameterVisibilitySettings(settings, createDefaultStokesParameterVisibilitySettings())) {
      window.localStorage.removeItem(STOKES_PARAMETER_VISIBILITY_STORAGE_KEY);
      return;
    }

    window.localStorage.setItem(
      STOKES_PARAMETER_VISIBILITY_STORAGE_KEY,
      JSON.stringify(cloneStokesParameterVisibilitySettings(settings))
    );
  } catch {
    // Storage can be unavailable in private contexts; keep the runtime setting anyway.
  }
}

export function sameStokesParameterVisibilitySettings(
  a: StokesParameterVisibilitySettings,
  b: StokesParameterVisibilitySettings
): boolean {
  return STOKES_COLORMAP_DEFAULT_GROUPS.every((group) => a[group] === b[group]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
