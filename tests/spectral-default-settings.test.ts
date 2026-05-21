// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest';
import {
  SPECTRAL_RGB_GROUPING_STORAGE_KEY,
  normalizeSpectralRgbGroupingSetting,
  readStoredSpectralRgbGroupingSetting,
  saveStoredSpectralRgbGroupingSetting
} from '../src/spectral-default-settings';

describe('spectral default settings', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('normalizes only booleans and defaults to enabled', () => {
    expect(normalizeSpectralRgbGroupingSetting(false)).toBe(false);
    expect(normalizeSpectralRgbGroupingSetting(true)).toBe(true);
    expect(normalizeSpectralRgbGroupingSetting('false')).toBe(true);
    expect(normalizeSpectralRgbGroupingSetting(null)).toBe(true);
  });

  it('persists disabled and clears storage for the default enabled value', () => {
    saveStoredSpectralRgbGroupingSetting(false);

    expect(window.localStorage.getItem(SPECTRAL_RGB_GROUPING_STORAGE_KEY)).toBe('false');
    expect(readStoredSpectralRgbGroupingSetting()).toBe(false);

    saveStoredSpectralRgbGroupingSetting(true);

    expect(window.localStorage.getItem(SPECTRAL_RGB_GROUPING_STORAGE_KEY)).toBeNull();
    expect(readStoredSpectralRgbGroupingSetting()).toBe(true);
  });
});
