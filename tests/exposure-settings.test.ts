// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_EXPOSURE_RANGE,
  EXPOSURE_RANGE_STORAGE_KEY,
  normalizeExposureRange,
  readStoredExposureRange,
  saveStoredExposureRange
} from '../src/exposure-settings';

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe('EV range settings', () => {
  it.each([
    null, {}, { minEv: -1, maxEv: Infinity }, { minEv: NaN, maxEv: 1 },
    { minEv: 0, maxEv: 0 }, { minEv: 1, maxEv: 2 }, { minEv: -2, maxEv: -1 },
    { minEv: 4, maxEv: -4 }, { minEv: -0.01, maxEv: 0.01 }
  ])('falls back for an invalid range: %j', (range) => {
    expect(normalizeExposureRange(range)).toEqual(DEFAULT_EXPOSURE_RANGE);
  });

  it('restores saved settings and ignores malformed storage', () => {
    saveStoredExposureRange({ minEv: -20.24, maxEv: 24.26 });
    expect(readStoredExposureRange()).toEqual({ minEv: -20.2, maxEv: 24.3 });
    window.localStorage.setItem(EXPOSURE_RANGE_STORAGE_KEY, '{bad');
    expect(readStoredExposureRange()).toEqual(DEFAULT_EXPOSURE_RANGE);
    saveStoredExposureRange(DEFAULT_EXPOSURE_RANGE);
    expect(window.localStorage.getItem(EXPOSURE_RANGE_STORAGE_KEY)).toBeNull();
  });

  it('handles unavailable storage', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('unavailable'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('unavailable'); });
    expect(readStoredExposureRange()).toEqual(DEFAULT_EXPOSURE_RANGE);
    expect(() => saveStoredExposureRange({ minEv: -20, maxEv: 20 })).not.toThrow();
  });
});
