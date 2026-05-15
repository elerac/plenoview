import type { DecodedExrImage } from './types';

export function collectDecodedImageTransferables(image: DecodedExrImage): Transferable[] {
  const transferables: Transferable[] = [];
  const seenBuffers = new Set<ArrayBuffer>();
  for (const layer of image.layers) {
    const channels = layer.channelStorage.kind === 'interleaved-f32'
      ? [layer.channelStorage.pixels]
      : Object.values(layer.channelStorage.pixelsByChannel);
    for (const pixels of channels) {
      if (!(pixels.buffer instanceof ArrayBuffer) || seenBuffers.has(pixels.buffer)) {
        continue;
      }

      seenBuffers.add(pixels.buffer);
      transferables.push(pixels.buffer);
    }
  }
  return transferables;
}
