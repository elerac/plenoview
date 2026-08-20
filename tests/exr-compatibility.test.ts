import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadExr } from '../src/exr';
import { decodeRawExr } from '../src/exr-runtime';

const fixtureRoot = new URL('./fixtures/openexr-images/', import.meta.url);

describe('TinyEXR compatibility corpus', () => {
  it('decodes the official ten-part Beachball image in header order', async () => {
    const decoded = await decodeRawExr(readFixture('Beachball/multipart.0001.exr'));

    expect(decoded.width).toBe(2048);
    expect(decoded.height).toBe(1556);
    expect(decoded.layers).toHaveLength(10);
    expect(decoded.layers.map((layer) => layer.name)).toEqual([
      'rgba_right',
      'depth_left',
      'forward_left',
      'whitebarmask_left',
      'rgba_left',
      'depth_right',
      'forward_right',
      'disparityL',
      'disparityR',
      'whitebarmask_right'
    ]);
    expect(decoded.layers.every((layer) => layer.channelNames.length > 0)).toBe(true);
    expect(decoded.layers.reduce((total, layer) => total + layer.channelNames.length, 0)).toBe(20);
  }, 60_000);

  it('pads the official cropped data window into its display window', async () => {
    const image = await loadExr(readFixture('DisplayWindow/t07.exr'));
    const layer = image.layers[0];

    expect(image.width).toBe(481);
    expect(image.height).toBe(371);
    expect(layer.channelStorage.kind).toBe('planar-f32');
    const red = layer.channelStorage.kind === 'planar-f32'
      ? layer.channelStorage.pixelsByChannel.R
      : undefined;
    expect(red).toHaveLength(image.width * image.height);
    expect(red?.[0]).toBe(0);
    expect(red?.some((value) => value !== 0)).toBe(true);
  }, 60_000);

  it('expands subsampled luminance/chroma channels to full data resolution', async () => {
    const decoded = await decodeRawExr(readFixture('LuminanceChroma/CrissyField.exr'));
    const layer = decoded.layers[0];

    expect([decoded.width, decoded.height]).toEqual([1218, 810]);
    expect(layer.channelNames).toEqual(['BY', 'RY', 'Y']);
    for (const channelName of layer.channelNames) {
      expect(layer.pixelsByChannel[channelName]).toHaveLength(1218 * 810);
    }
  }, 60_000);

  it('decodes level-zero pixels from tiled PXR24 images with the production stack size', async () => {
    const decoded = await decodeRawExr(readFixture('MultiResolution/ColorCodedLevels.exr'));
    const layer = decoded.layers[0];

    expect([decoded.width, decoded.height]).toEqual([512, 512]);
    expect(layer.channelNames).toEqual(['A', 'B', 'G', 'R']);
    expect(layer.pixelsByChannel.R).toHaveLength(512 * 512);
  }, 60_000);

  it('recovers after malformed input in the same initialized runtime', async () => {
    await expect(decodeRawExr(new Uint8Array([0x76, 0x2f, 0x31, 0x01])))
      .rejects.toThrow(/TinyEXR decode failed/u);

    const decoded = await decodeRawExr(readFixture('MultiResolution/ColorCodedLevels.exr'));
    expect(decoded.layers).toHaveLength(1);
    expect(decoded.layers[0]?.channelNames).toContain('R');
  }, 60_000);
});

function readFixture(path: string): Uint8Array {
  return new Uint8Array(readFileSync(new URL(path, fixtureRoot)));
}
