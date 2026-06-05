import { describe, expect, it } from 'vitest';
import { successResource } from '../src/async-resource';
import {
  createInterleavedChannelStorage,
  createPlanarChannelStorage
} from '../src/channel-storage';
import {
  DEFAULT_DISPLAY_CACHE_BUDGET_MB,
  DISPLAY_CACHE_BUDGET_OPTIONS_MB,
  MAX_DISPLAY_CACHE_BUDGET_MB,
  MIN_DISPLAY_CACHE_BUDGET_MB,
  clampDisplayCacheBudgetMb,
  clearSessionResources,
  createDefaultDisplayCacheBudgetPreference,
  createSessionResourceEntry,
  displayCacheBudgetPreferenceToStorageValue,
  estimateDecodedImageBytes,
  getTrackedResidentBytes,
  getTrackedResidentChannelBytes,
  parseDisplayCacheBudgetStorageValue,
  parseDisplayCacheBudgetPreferenceStorageValue,
  resolveAutomaticDisplayCacheBudgetMb,
  resolveDisplayCacheBudgetMb,
  type ResidentChannelResourceEntry
} from '../src/display-cache';
import type { DecodedExrImage } from '../src/types';

function createResidentChannelEntry(
  textureBytes: number,
  materializedBytes: number,
  lastAccessToken: number
): ResidentChannelResourceEntry {
  return {
    textureBytes,
    materializedBytes,
    resourceKind: 'source-texture',
    bytes: textureBytes,
    lastAccessToken,
    accessCount: 1
  };
}

describe('display cache resource accounting', () => {
  it('tracks decoded baseline and retained CPU/GPU bytes across session layer channels', () => {
    const sessions = [
      createSessionResourceEntry('a'),
      createSessionResourceEntry('b'),
      createSessionResourceEntry('c')
    ];
    sessions[0].decodedBytes = 10;
    sessions[0].residentLayers.set(0, {
      residentChannels: new Map([
        ['R', createResidentChannelEntry(24, 12, 1)]
      ])
    });
    sessions[1].decodedBytes = 5;
    sessions[1].residentLayers.set(0, {
      residentChannels: new Map([
        ['G', createResidentChannelEntry(8, 0, 2)]
      ])
    });
    sessions[1].residentLayers.set(1, {
      residentChannels: new Map([
        ['Z', createResidentChannelEntry(4, 2, 3)]
      ])
    });

    expect(getTrackedResidentBytes(sessions)).toBe(65);
  });

  it('clamps invalid retained channel byte counts', () => {
    expect(getTrackedResidentChannelBytes({
      textureBytes: 10.9,
      materializedBytes: Number.NaN
    })).toBe(10);
  });

  it('estimates decoded pixel bytes from interleaved and planar channel storage', () => {
    const image: DecodedExrImage = {
      width: 2,
      height: 1,
      layers: [
        {
          name: 'beauty',
          channelNames: ['R', 'G', 'B'],
          channelStorage: createInterleavedChannelStorage(new Float32Array(6), ['R', 'G', 'B']),
          analysis: {
            displayLuminanceRangeBySelectionKey: {},
            finiteRangeByChannel: {}
          }
        },
        {
          name: 'depth',
          channelNames: ['Z', 'A'],
          channelStorage: createPlanarChannelStorage({
            Z: new Float32Array(2),
            A: new Float32Array(2)
          }, ['Z', 'A']),
          analysis: {
            displayLuminanceRangeBySelectionKey: {},
            finiteRangeByChannel: {}
          }
        }
      ]
    };

    expect(estimateDecodedImageBytes(image)).toBe(40);
  });

  it('clears pinned state, decoded bytes, resident channels, and cached ranges', () => {
    const session = createSessionResourceEntry('a');
    session.pinned = true;
    session.decodedBytes = 12;
    session.residentLayers.set(0, {
      residentChannels: new Map([
        ['R', createResidentChannelEntry(24, 12, 7)]
      ])
    });
    session.luminanceRangeByRevision.set('rev', successResource('a:rev', { min: 0, max: 1 }));

    clearSessionResources(session);

    expect(session.pinned).toBe(false);
    expect(session.decodedBytes).toBe(0);
    expect(session.residentLayers.size).toBe(0);
    expect(session.luminanceRangeByRevision.size).toBe(0);
  });
});

describe('display cache budget parsing', () => {
  it('falls back to the default budget for corrupt storage values', () => {
    expect(parseDisplayCacheBudgetStorageValue(null)).toBe(DEFAULT_DISPLAY_CACHE_BUDGET_MB);
    expect(parseDisplayCacheBudgetStorageValue('not-a-number')).toBe(DEFAULT_DISPLAY_CACHE_BUDGET_MB);
  });

  it('defaults missing and corrupt preference storage to Automatic', () => {
    expect(parseDisplayCacheBudgetPreferenceStorageValue(null)).toEqual(createDefaultDisplayCacheBudgetPreference());
    expect(parseDisplayCacheBudgetPreferenceStorageValue('not-a-number')).toEqual(
      createDefaultDisplayCacheBudgetPreference()
    );
  });

  it('interprets old numeric storage values as fixed budgets', () => {
    expect(parseDisplayCacheBudgetPreferenceStorageValue('128')).toEqual({
      mode: 'fixed',
      fixedMb: 128
    });
  });

  it('round-trips the new JSON storage shape', () => {
    const preference = { mode: 'automatic' as const, fixedMb: 512 };
    expect(parseDisplayCacheBudgetPreferenceStorageValue(
      displayCacheBudgetPreferenceToStorageValue(preference)
    )).toEqual(preference);
  });

  it('clamps parsed storage values to the allowed min and max', () => {
    expect(parseDisplayCacheBudgetStorageValue('8')).toBe(MIN_DISPLAY_CACHE_BUDGET_MB);
    expect(parseDisplayCacheBudgetStorageValue('9000')).toBe(MAX_DISPLAY_CACHE_BUDGET_MB);
  });

  it('snaps direct budget updates to the nearest allowed preset', () => {
    expect(clampDisplayCacheBudgetMb(NaN)).toBe(DEFAULT_DISPLAY_CACHE_BUDGET_MB);
    expect(clampDisplayCacheBudgetMb(MIN_DISPLAY_CACHE_BUDGET_MB - 1)).toBe(MIN_DISPLAY_CACHE_BUDGET_MB);
    expect(clampDisplayCacheBudgetMb(MAX_DISPLAY_CACHE_BUDGET_MB + 1)).toBe(MAX_DISPLAY_CACHE_BUDGET_MB);
    expect(clampDisplayCacheBudgetMb(200)).toBe(256);
    expect(clampDisplayCacheBudgetMb(300)).toBe(256);
    expect(clampDisplayCacheBudgetMb(400)).toBe(512);
  });

  it('exposes the supported preset options in ascending order', () => {
    expect(DISPLAY_CACHE_BUDGET_OPTIONS_MB).toEqual([64, 128, 256, 512, 1024]);
  });

  it('resolves automatic budgets from conservative environment hints', () => {
    expect(resolveAutomaticDisplayCacheBudgetMb()).toBe(256);
    expect(resolveAutomaticDisplayCacheBudgetMb({ deviceMemoryGb: 2 })).toBe(128);
    expect(resolveAutomaticDisplayCacheBudgetMb({ jsHeapSizeLimitBytes: 512 * 1024 * 1024 })).toBe(128);
    expect(resolveAutomaticDisplayCacheBudgetMb({ deviceMemoryGb: 4 })).toBe(512);
    expect(resolveAutomaticDisplayCacheBudgetMb({ hostKind: 'vscode' })).toBe(512);
    expect(resolveAutomaticDisplayCacheBudgetMb({ deviceMemoryGb: 8 })).toBe(1024);
    expect(resolveAutomaticDisplayCacheBudgetMb({ hostKind: 'tauri' })).toBe(1024);
    expect(resolveAutomaticDisplayCacheBudgetMb({ hostKind: 'tauri', deviceMemoryGb: 2 })).toBe(128);
  });

  it('keeps fixed budgets independent from automatic hints', () => {
    expect(resolveDisplayCacheBudgetMb({ mode: 'fixed', fixedMb: 128 }, { hostKind: 'tauri' })).toBe(128);
  });
});
