import { describe, expect, it } from 'vitest';
import { collectDecodedImageTransferables } from '../src/decode-transferables';
import { createImage, createInterleavedLayerFromChannels, createLayerFromChannels } from './helpers/state-fixtures';

describe('decode transferables', () => {
  it('collects one transferable buffer per decoded interleaved layer', () => {
    const beauty = createInterleavedLayerFromChannels({
      R: [1, 2],
      G: [3, 4],
      B: [5, 6]
    }, 'beauty');
    const depth = createInterleavedLayerFromChannels({
      Z: [7, 8]
    }, 'depth');
    const image = createImage([beauty, depth]);

    const transferables = collectDecodedImageTransferables(image);

    expect(transferables).toHaveLength(2);
    expect(transferables).toEqual([
      beauty.channelStorage.kind === 'interleaved-f32' ? beauty.channelStorage.pixels.buffer : null,
      depth.channelStorage.kind === 'interleaved-f32' ? depth.channelStorage.pixels.buffer : null
    ]);
  });

  it('collects every planar channel buffer from worker-decoded images', () => {
    const beauty = createLayerFromChannels({
      R: [1, 2],
      G: [3, 4],
      B: [5, 6]
    }, 'beauty');
    const image = createImage([beauty]);

    const transferables = collectDecodedImageTransferables(image);

    if (beauty.channelStorage.kind !== 'planar-f32') {
      throw new Error('Expected test layer to use planar storage.');
    }

    expect(transferables).toEqual([
      beauty.channelStorage.pixelsByChannel.R?.buffer,
      beauty.channelStorage.pixelsByChannel.G?.buffer,
      beauty.channelStorage.pixelsByChannel.B?.buffer
    ]);
  });
});
