// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest';
import {
  STOKES_INVALID_VECTOR_MASK_STORAGE_KEY,
  normalizeStokesInvalidVectorMaskSetting,
  readStoredStokesInvalidVectorMaskSetting,
  saveStoredStokesInvalidVectorMaskSetting
} from '../src/stokes-invalid-vector-mask-settings';

describe('stokes invalid vector mask settings', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('normalizes only booleans and defaults to enabled', () => {
    expect(normalizeStokesInvalidVectorMaskSetting(false)).toBe(false);
    expect(normalizeStokesInvalidVectorMaskSetting(true)).toBe(true);
    expect(normalizeStokesInvalidVectorMaskSetting('false')).toBe(true);
    expect(normalizeStokesInvalidVectorMaskSetting(null)).toBe(true);
  });

  it('persists disabled and clears storage for the default enabled value', () => {
    saveStoredStokesInvalidVectorMaskSetting(false);

    expect(window.localStorage.getItem(STOKES_INVALID_VECTOR_MASK_STORAGE_KEY)).toBe('false');
    expect(readStoredStokesInvalidVectorMaskSetting()).toBe(false);

    saveStoredStokesInvalidVectorMaskSetting(true);

    expect(window.localStorage.getItem(STOKES_INVALID_VECTOR_MASK_STORAGE_KEY)).toBeNull();
    expect(readStoredStokesInvalidVectorMaskSetting()).toBe(true);
  });
});
