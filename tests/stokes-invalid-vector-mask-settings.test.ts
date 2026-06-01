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

  it('normalizes only booleans and defaults to disabled', () => {
    expect(normalizeStokesInvalidVectorMaskSetting(false)).toBe(false);
    expect(normalizeStokesInvalidVectorMaskSetting(true)).toBe(true);
    expect(normalizeStokesInvalidVectorMaskSetting('false')).toBe(false);
    expect(normalizeStokesInvalidVectorMaskSetting(null)).toBe(false);
  });

  it('persists enabled and clears storage for the default disabled value', () => {
    saveStoredStokesInvalidVectorMaskSetting(true);

    expect(window.localStorage.getItem(STOKES_INVALID_VECTOR_MASK_STORAGE_KEY)).toBe('true');
    expect(readStoredStokesInvalidVectorMaskSetting()).toBe(true);

    saveStoredStokesInvalidVectorMaskSetting(false);

    expect(window.localStorage.getItem(STOKES_INVALID_VECTOR_MASK_STORAGE_KEY)).toBeNull();
    expect(readStoredStokesInvalidVectorMaskSetting()).toBe(false);
  });
});
