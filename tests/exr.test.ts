import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { getChannelReadView, readChannelValue } from '../src/channel-storage';
import { loadExr, readLayerInterleavedPixels } from '../src/exr';
import {
  CompressionMethod,
  ExrEncoder,
  SamplePrecision
} from './helpers/exr-fixture-encoder';

describe('exr decode', () => {
  it('decodes cbox_rgb.exr with RGB channels', async () => {
    const testDir = path.dirname(fileURLToPath(import.meta.url));
    const exrPath = path.resolve(testDir, '../public/cbox_rgb.exr');
    const bytes = new Uint8Array(readFileSync(exrPath));

    const image = await loadExr(bytes);

    expect(image.width).toBe(256);
    expect(image.height).toBe(256);

    const first = image.layers[0];
    expect(first.channelNames).toContain('R');
    expect(first.channelNames).toContain('G');
    expect(first.channelNames).toContain('B');
    expect(first.channelStorage.kind).toBe('planar-f32');
    expect(first.channelStorage.channelCount).toBe(first.channelNames.length);
    expect(first.channelStorage.kind === 'planar-f32' && first.channelStorage.pixelsByChannel.R?.length)
      .toBe(image.width * image.height);
    expect(first.analysis.displayLuminanceRangeBySelectionKey).toEqual({});
    expect(first.analysis.finiteRangeByChannel.R).toEqual(expect.objectContaining({
      min: expect.any(Number),
      max: expect.any(Number)
    }));
    const red = getChannelReadView(first, 'R');
    expect(readChannelValue(red, 0)).toBeTypeOf('number');
    expect(first.metadata?.some((entry) => entry.key === 'compression' && entry.value === 'PIZ')).toBe(true);
    expect(first.metadata?.some((entry) => entry.key === 'channels' && entry.value === '3 (R, G, B)')).toBe(true);
  }, 60000);

  it('keeps arbitrary channel names associated with their exact pixels', async () => {
    const encoder = new ExrEncoder(2, 1);
    encoder.addLayer(
      null,
      ['Z', 'R', 'odd.channel', 'B'],
      new Float32Array([
        10, 1, 100, 3,
        20, 2, 200, 4
      ]),
      SamplePrecision.F32,
      CompressionMethod.None
    );

    const image = await loadExr(encoder.encode());
    const layer = image.layers[0];
    expect(layer.channelNames).toEqual(['B', 'R', 'Z', 'odd.channel']);
    expect(Array.from(layer.channelStorage.kind === 'planar-f32'
      ? layer.channelStorage.pixelsByChannel.B ?? []
      : [])).toEqual([3, 4]);
    expect(Array.from(layer.channelStorage.kind === 'planar-f32'
      ? layer.channelStorage.pixelsByChannel.R ?? []
      : [])).toEqual([1, 2]);
    expect(Array.from(layer.channelStorage.kind === 'planar-f32'
      ? layer.channelStorage.pixelsByChannel.Z ?? []
      : [])).toEqual([10, 20]);
    expect(Array.from(layer.channelStorage.kind === 'planar-f32'
      ? layer.channelStorage.pixelsByChannel['odd.channel'] ?? []
      : [])).toEqual([100, 200]);
  });

  it('decodes multipart layers in header order', async () => {
    const encoder = new ExrEncoder(2, 1);
    encoder.addLayer(
      'beauty',
      ['R', 'G', 'B'],
      new Float32Array([1, 2, 3, 4, 5, 6]),
      SamplePrecision.F32,
      CompressionMethod.None
    );
    encoder.addLayer(
      'depth',
      ['Z'],
      new Float32Array([7, 8]),
      SamplePrecision.F32,
      CompressionMethod.None
    );

    const image = await loadExr(encoder.encode());
    expect(image.layers.map((layer) => layer.name)).toEqual(['beauty', 'depth']);
    expect(image.layers.map((layer) => layer.channelNames)).toEqual([
      ['B', 'G', 'R'],
      ['Z']
    ]);
    expect(Array.from(image.layers[1]?.channelStorage.kind === 'planar-f32'
      ? image.layers[1].channelStorage.pixelsByChannel.Z ?? []
      : [])).toEqual([7, 8]);
  });

  it('pads cropped data-window channels into the full display window', () => {
    const calls: string[][] = [];
    const reader = {
      getLayerPixels: (_layerIndex: number, channelNames: string[]) => {
        calls.push(channelNames);
        if (channelNames.length !== 1) {
          return undefined;
        }

        return channelNames[0] === 'R'
          ? new Float32Array([1, 2, 3, 4])
          : new Float32Array([10, 20, 30, 40]);
      }
    };

    const interleaved = readLayerInterleavedPixels(
      reader,
      0,
      ['R', 'G'],
      4,
      4,
      [
        { key: 'dataWindow', label: 'dataWindow', value: '[1,1]-[2,2]' },
        { key: 'displayWindow', label: 'displayWin', value: '[0,0]-[3,3]' }
      ]
    );

    expect(calls).toEqual([['R'], ['G']]);
    expect(interleaved).toHaveLength(4 * 4 * 2);
    expect(Array.from(interleaved.slice(0, 2))).toEqual([0, 0]);
    expect(Array.from(interleaved.slice((1 * 4 + 1) * 2, (1 * 4 + 3) * 2))).toEqual([1, 10, 2, 20]);
    expect(Array.from(interleaved.slice((2 * 4 + 1) * 2, (2 * 4 + 3) * 2))).toEqual([3, 30, 4, 40]);
  });
});
