import { describe, expect, it } from 'vitest';
import { createInterleavedChannelStorage, createPlanarChannelStorage } from '../src/channel-storage';
import { createDisplaySourceBinding } from '../src/display/bindings';
import {
  buildPolarizedEnvironmentImportanceSampling,
  buildPolarizedEnvironmentPixels,
  polarizedEnvironmentSize,
  resolvePolarizedEnvironmentChannels,
  type PolarizedEnvironmentSource
} from '../src/rendering/gl-image-renderer/environment-polarization';
import type { DecodedLayer } from '../src/types';

describe('penvmap environment resources', () => {
  it('selects full Stokes RGB data from an intensity or signed-component selection', () => {
    const source = makeSource(2, 3);
    for (const component of ['S0', 'S1', 'S2', 'S3']) {
      const binding = createDisplaySourceBinding('channelRgb', ['R', 'G', 'B'].map(rgb => `${component}.${rgb}`), false, null);
      expect(resolvePolarizedEnvironmentChannels(source.layer, binding)).toEqual(source.channels);
    }
    const componentBinding = createDisplaySourceBinding('stokesDirect', ['S0.R', 'S1.R', 'S2.R', 'S3.R'], false, 'aolp');
    expect(resolvePolarizedEnvironmentChannels(source.layer, componentBinding)).toEqual(source.channels);
    expect(resolvePolarizedEnvironmentChannels(source.layer,
      createDisplaySourceBinding('channelRgb', ['R', 'G', 'B'], false, null))).toEqual(source.channels);
    expect(resolvePolarizedEnvironmentChannels(source.layer,
      createDisplaySourceBinding('channelMono', ['depth'], false, null))).toBeNull();
  });

  it('requires S0-S2 RGB and permits only a complete or absent S3', () => {
    const binding = createDisplaySourceBinding('channelRgb', ['S0.R', 'S0.G', 'S0.B'], false, null);
    const source = makeSource(2, 3, false);
    expect(resolvePolarizedEnvironmentChannels(source.layer, binding)?.r.s3).toBeNull();
    source.layer.channelNames.push('S3.R');
    expect(resolvePolarizedEnvironmentChannels(source.layer, binding)).toBeNull();
    source.layer.channelNames = source.layer.channelNames.filter(name => name !== 'S2.B');
    expect(resolvePolarizedEnvironmentChannels(source.layer, binding)).toBeNull();
  });

  it('preserves signed values and pads small input dimensions by repeating edges', () => {
    const source = makeSource(1, 1);
    source.layer.channelStorage = createPlanarChannelStorage({
      'S1.R': new Float32Array([-2]), 'S1.G': new Float32Array([0.25]), 'S1.B': new Float32Array([-7])
    }, source.layer.channelNames);
    expect(polarizedEnvironmentSize(source)).toEqual({ width: 2, height: 3 });
    const pixels = buildPolarizedEnvironmentPixels(source, 1);
    expect(pixels).toHaveLength(24);
    for (let index = 0; index < 6; index += 1) {
      expect(Array.from(pixels.subarray(index * 4, index * 4 + 4))).toEqual([-2, 0.25, -7, 1]);
    }
    expect(() => polarizedEnvironmentSize({ width: 0, height: 2 })).toThrow('positive integers');
  });

  it('reads interleaved channels and zero-fills optional circular polarization', () => {
    const source = makeSource(2, 3, false);
    const pixels = new Float32Array(6 * source.layer.channelNames.length);
    for (let index = 0; index < pixels.length; index += 1) {
      pixels[index] = index - 30;
    }
    source.layer.channelStorage = createInterleavedChannelStorage(pixels, source.layer.channelNames);
    const signed = buildPolarizedEnvironmentPixels(source, 2);
    expect(Array.from(signed.subarray(0, 4))).toEqual([-24, -23, -22, 1]);
    expect(Array.from(signed.subarray(20, 24))).toEqual([21, 22, 23, 1]);
    const circular = buildPolarizedEnvironmentPixels(source, 3);
    expect(Array.from(circular)).toEqual(Array.from({ length: 6 }, () => [0, 0, 0, 1]).flat());
  });

  it('uses only S0 with Mitsuba luminance and the pole-aligned sine weighting', () => {
    const source = makeSource(3, 3);
    const channels = source.layer.channelStorage;
    if (channels.kind !== 'planar-f32') throw new Error('planar fixture');
    channels.pixelsByChannel['S0.R'].set([100, 100, 100, 1, 0, 0, 100, 100, 100]);
    channels.pixelsByChannel['S0.G'].set([100, 100, 100, 0, 1, 0, 100, 100, 100]);
    channels.pixelsByChannel['S0.B'].set([100, 100, 100, 0, 0, 1, 100, 100, 100]);
    const table = buildPolarizedEnvironmentImportanceSampling(source);
    expect(table.gridWidth).toBe(3);
    expect(table.gridHeight).toBe(2);
    expect(table.entryCount).toBe(6);
    expect(table.rgba32f).toHaveLength(48);
    // The first row lies at the north pole and has exactly zero PDF. The
    // middle row is R/G/B with normalized density 6 times its luminance.
    expect(Array.from(table.rgba32f.subarray(4, 6))).toEqual([0, 0]);
    expect(table.rgba32f[6]).toBeCloseTo(6 * 0.212671, 6);
    expect(table.rgba32f[7]).toBeCloseTo(6 * 0.715160, 6);
    // Last longitude cell wraps to the first column, including its density.
    expect(table.rgba32f[2 * 8 + 6]).toBeCloseTo(6 * 0.072169, 6);
    expect(table.rgba32f[2 * 8 + 7]).toBeCloseTo(6 * 0.212671, 6);
    const before = table.rgba32f.slice();
    for (const name of source.layer.channelNames.filter(name => !name.startsWith('S0'))) {
      channels.pixelsByChannel[name].fill(-10000);
    }
    expect(buildPolarizedEnvironmentImportanceSampling(source).rgba32f).toEqual(before);
  });

  it('normalizes bilinear densities and alias probabilities against an independent integral', () => {
    const source = makeSource(4, 5);
    const storage = source.layer.channelStorage;
    if (storage.kind !== 'planar-f32') throw new Error('planar fixture');
    for (let y = 0; y < 5; y += 1) {
      for (let x = 0; x < 4; x += 1) {
        storage.pixelsByChannel['S0.R'][y * 4 + x] = (x + 1) * (y + 1);
      }
    }
    const table = buildPolarizedEnvironmentImportanceSampling(source);
    const actualMass = new Float64Array(table.entryCount);
    let integral = 0;
    for (let index = 0; index < table.entryCount; index += 1) {
      const offset = index * 8;
      const acceptance = table.rgba32f[offset];
      const alias = table.rgba32f[offset + 1];
      actualMass[index] += acceptance / table.entryCount;
      actualMass[alias] += (1 - acceptance) / table.entryCount;
      const corners = table.rgba32f.subarray(offset + 4, offset + 8);
      const integratedMass = Array.from(corners).reduce((sum, value) => sum + value, 0) / (4 * table.entryCount);
      expect(table.rgba32f[offset + 2]).toBeCloseTo(integratedMass, 7);
      integral += integratedMass;
    }
    expect(integral).toBeCloseTo(1, 7);
    for (let index = 0; index < table.entryCount; index += 1) {
      expect(actualMass[index]).toBeCloseTo(table.rgba32f[index * 8 + 2], 7);
    }
  });

  it('keeps sampling finite for an all-black environment', () => {
    const source = makeSource(2, 3);
    const table = buildPolarizedEnvironmentImportanceSampling(source);
    expect(Array.from(table.rgba32f).every(Number.isFinite)).toBe(true);
    for (let index = 0; index < table.entryCount; index += 1) {
      expect(table.rgba32f[index * 8 + 2]).toBe(1 / table.entryCount);
      expect(Array.from(table.rgba32f.subarray(index * 8 + 4, index * 8 + 8))).toEqual([1, 1, 1, 1]);
    }
  });
});

function makeSource(width: number, height: number, s3 = true): PolarizedEnvironmentSource {
  const channelNames = ['S0', 'S1', 'S2', ...(s3 ? ['S3'] : [])].flatMap(component => ['R', 'G', 'B'].map(rgb => `${component}.${rgb}`));
  const layer = {
    name: null,
    channelNames,
    channelStorage: createPlanarChannelStorage(Object.fromEntries(channelNames.map(name => [name, new Float32Array(width * height)])), channelNames),
    analysis: {}
  } as DecodedLayer;
  return {
    sourceKey: 'session:0:penvmap', layer, width, height,
    channels: {
      r: { s0: 'S0.R', s1: 'S1.R', s2: 'S2.R', s3: s3 ? 'S3.R' : null },
      g: { s0: 'S0.G', s1: 'S1.G', s2: 'S2.G', s3: s3 ? 'S3.G' : null },
      b: { s0: 'S0.B', s1: 'S1.B', s2: 'S2.B', s3: s3 ? 'S3.B' : null }
    }
  };
}
