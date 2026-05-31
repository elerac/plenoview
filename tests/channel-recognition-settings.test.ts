// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest';
import {
  CHANNEL_RECOGNITION_SETTINGS_STORAGE_KEY,
  createChannelRecognitionSettingsFromLegacySpectralGrouping,
  createDefaultChannelRecognitionSettings,
  normalizeChannelRecognitionSettings,
  readStoredChannelRecognitionSettings,
  saveStoredChannelRecognitionSettings,
  serializeChannelRecognitionSettingsKey
} from '../src/channel-recognition-settings';

describe('channel recognition settings', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('defaults every recognition rule on and forces single-channel fallback on', () => {
    expect(createDefaultChannelRecognitionSettings()).toEqual({
      'component.rgb': true,
      'component.xyz': true,
      'component.uv': true,
      'normal.map': true,
      'depth.map': true,
      'spectral.series': true,
      'stokes.scalar': true,
      'stokes.rgb': true,
      'stokes.spectral': true,
      'mueller.scalar': true,
      'mueller.rgb': true,
      'fallback.alphaCompanions': true,
      'fallback.singleChannel': true
    });

    expect(normalizeChannelRecognitionSettings({
      'component.rgb': false,
      'fallback.singleChannel': false,
      unknown: false
    })).toEqual({
      ...createDefaultChannelRecognitionSettings(),
      'component.rgb': false,
      'normal.map': true,
      'depth.map': true,
      'fallback.singleChannel': true
    });
  });

  it('migrates legacy spectral grouping off to spectral and spectral Stokes rules', () => {
    expect(createChannelRecognitionSettingsFromLegacySpectralGrouping(false)).toEqual({
      ...createDefaultChannelRecognitionSettings(),
      'spectral.series': false,
      'stokes.spectral': false
    });

    expect(readStoredChannelRecognitionSettings({ legacySpectralRgbGroupingEnabled: false })).toEqual({
      ...createDefaultChannelRecognitionSettings(),
      'spectral.series': false,
      'stokes.spectral': false
    });
  });

  it('persists non-default settings and removes the storage key for defaults', () => {
    const settings = {
      ...createDefaultChannelRecognitionSettings(),
      'normal.map': false,
      'component.xyz': false,
      'mueller.rgb': false
    };

    saveStoredChannelRecognitionSettings(settings);

    expect(readStoredChannelRecognitionSettings()).toEqual(settings);
    expect(window.localStorage.getItem(CHANNEL_RECOGNITION_SETTINGS_STORAGE_KEY)).toContain('component.xyz');

    saveStoredChannelRecognitionSettings(createDefaultChannelRecognitionSettings());

    expect(window.localStorage.getItem(CHANNEL_RECOGNITION_SETTINGS_STORAGE_KEY)).toBeNull();
  });

  it('falls back to defaults for invalid stored data and serializes settings stably', () => {
    window.localStorage.setItem(CHANNEL_RECOGNITION_SETTINGS_STORAGE_KEY, '{');

    expect(readStoredChannelRecognitionSettings()).toEqual(createDefaultChannelRecognitionSettings());
    expect(serializeChannelRecognitionSettingsKey({
      ...createDefaultChannelRecognitionSettings(),
      'stokes.rgb': false
    })).toContain('stokes.rgb:0');
    expect(serializeChannelRecognitionSettingsKey({
      ...createDefaultChannelRecognitionSettings(),
      'normal.map': false
    })).toContain('normal.map:0');
  });
});
