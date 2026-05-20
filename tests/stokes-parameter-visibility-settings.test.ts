// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest';
import {
  STOKES_PARAMETER_VISIBILITY_STORAGE_KEY,
  normalizeStokesParameterVisibilitySettings,
  readStoredStokesParameterVisibilitySettings,
  saveStoredStokesParameterVisibilitySettings
} from '../src/stokes-parameter-visibility-settings';
import { createDefaultStokesParameterVisibilitySettings } from '../src/stokes';

describe('stokes parameter visibility settings', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('normalizes booleans per group and falls back to enabled for invalid values', () => {
    expect(normalizeStokesParameterVisibilitySettings({
      aolp: false,
      degree: true,
      cop: 'false',
      top: false,
      normalized: 0
    })).toEqual({
      ...createDefaultStokesParameterVisibilitySettings(),
      aolp: false,
      top: false
    });
  });

  it('reads and writes visibility settings while clearing storage for defaults', () => {
    const settings = {
      ...createDefaultStokesParameterVisibilitySettings(),
      aolp: false,
      degree: false
    };

    saveStoredStokesParameterVisibilitySettings(settings);

    expect(JSON.parse(window.localStorage.getItem(STOKES_PARAMETER_VISIBILITY_STORAGE_KEY) ?? '{}')).toEqual(settings);
    expect(readStoredStokesParameterVisibilitySettings()).toEqual(settings);

    saveStoredStokesParameterVisibilitySettings(createDefaultStokesParameterVisibilitySettings());

    expect(window.localStorage.getItem(STOKES_PARAMETER_VISIBILITY_STORAGE_KEY)).toBeNull();
    expect(readStoredStokesParameterVisibilitySettings()).toEqual(createDefaultStokesParameterVisibilitySettings());
  });
});
