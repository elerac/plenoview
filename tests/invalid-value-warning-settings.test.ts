// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest';
import {
  INVALID_VALUE_WARNING_STORAGE_KEY,
  normalizeInvalidValueWarningSetting,
  readStoredInvalidValueWarningSetting,
  saveStoredInvalidValueWarningSetting
} from '../src/invalid-value-warning-settings';

describe('invalid value warning settings', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('normalizes only booleans and defaults to enabled', () => {
    expect(normalizeInvalidValueWarningSetting(false)).toBe(false);
    expect(normalizeInvalidValueWarningSetting(true)).toBe(true);
    expect(normalizeInvalidValueWarningSetting('false')).toBe(true);
    expect(normalizeInvalidValueWarningSetting(null)).toBe(true);
  });

  it('persists disabled and clears storage for the default enabled value', () => {
    saveStoredInvalidValueWarningSetting(false);

    expect(window.localStorage.getItem(INVALID_VALUE_WARNING_STORAGE_KEY)).toBe('false');
    expect(readStoredInvalidValueWarningSetting()).toBe(false);

    saveStoredInvalidValueWarningSetting(true);

    expect(window.localStorage.getItem(INVALID_VALUE_WARNING_STORAGE_KEY)).toBeNull();
    expect(readStoredInvalidValueWarningSetting()).toBe(true);
  });
});
