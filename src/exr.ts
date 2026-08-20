import { decodeRawExr, type RawDecodedExrLayer } from './exr-runtime';
import { parseExrMetadata } from './exr-metadata';
import {
  createPlanarChannelStorage,
  type FiniteValueRange
} from './channel-storage';
import type { DecodedExrImage, DecodedLayer, ExrMetadataEntry } from './types';

interface Box2i {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface LayerWindows {
  dataWindow: Box2i | null;
  displayWindow: Box2i | null;
}

interface LayerPixelReader {
  getLayerPixels(layerIndex: number, channelNames: string[]): Float32Array | undefined;
}

export async function loadExr(bytes: Uint8Array): Promise<DecodedExrImage> {
  const metadataByLayer = parseExrMetadata(bytes);
  const decoded = await decodeRawExr(bytes);

  if (decoded.layers.length === 0) {
    throw new Error('Decoded EXR has no layers.');
  }

  const layers = decoded.layers.map((layer, layerIndex) => createDecodedLayer(
    layer,
    layerIndex,
    decoded.width,
    decoded.height,
    metadataByLayer[layerIndex] ?? []
  ));

  return {
    width: decoded.width,
    height: decoded.height,
    layers
  };
}

function createDecodedLayer(
  rawLayer: RawDecodedExrLayer,
  layerIndex: number,
  width: number,
  height: number,
  metadata: ExrMetadataEntry[]
): DecodedLayer {
  const windows = getLayerWindows(metadata);
  const rawPixelCount = rawLayer.width * rawLayer.height;
  const outputPixelCount = width * height;
  const cropped = hasCroppedDataWindow(windows, width, height) ||
    rawLayer.width !== width || rawLayer.height !== height;
  const pixelsByChannel: Record<string, Float32Array> = {};
  const finiteRangeByChannel: Record<string, FiniteValueRange | null> = {};

  validateLayerLayout(rawLayer, layerIndex, width, height, windows);

  for (const channelName of rawLayer.channelNames) {
    const sourcePixels = rawLayer.pixelsByChannel[channelName];
    if (!sourcePixels || sourcePixels.length !== rawPixelCount) {
      throw new Error(
        `Invalid channel length for layer ${layerIndex} channel ${channelName}: expected ${rawPixelCount}, got ${sourcePixels?.length ?? 0}`
      );
    }

    if (!cropped) {
      if (sourcePixels.length !== outputPixelCount) {
        throw new Error(
          `Invalid channel length for layer ${layerIndex} channel ${channelName}: expected ${outputPixelCount}, got ${sourcePixels.length}`
        );
      }
      pixelsByChannel[channelName] = sourcePixels;
      finiteRangeByChannel[channelName] = rawLayer.finiteRangeByChannel[channelName] ?? null;
      continue;
    }

    const padded = new Float32Array(outputPixelCount);
    copyCroppedPlanarChannel(padded, sourcePixels, width, height, windows);
    pixelsByChannel[channelName] = padded;
    finiteRangeByChannel[channelName] = calculateFiniteRange(padded);
  }

  return {
    name: rawLayer.name,
    channelNames: rawLayer.channelNames,
    channelStorage: createPlanarChannelStorage(pixelsByChannel, rawLayer.channelNames),
    analysis: {
      displayLuminanceRangeBySelectionKey: {},
      finiteRangeByChannel
    },
    metadata
  };
}

function validateLayerLayout(
  rawLayer: RawDecodedExrLayer,
  layerIndex: number,
  width: number,
  height: number,
  windows: LayerWindows
): void {
  const dataWindow = windows.dataWindow;
  if (!dataWindow && (rawLayer.width !== width || rawLayer.height !== height)) {
    throw new Error(`Decoded EXR layer ${layerIndex} has cropped pixels but no dataWindow metadata.`);
  }
  if (dataWindow &&
      (getBoxWidth(dataWindow) !== rawLayer.width || getBoxHeight(dataWindow) !== rawLayer.height)) {
    throw new Error(
      `Decoded EXR layer ${layerIndex} data window does not match its pixel dimensions.`
    );
  }
  const displayWindow = windows.displayWindow;
  if (displayWindow && (getBoxWidth(displayWindow) !== width || getBoxHeight(displayWindow) !== height)) {
    throw new Error(
      `Decoded EXR layer ${layerIndex} uses a different display size; multipart display sizes must match.`
    );
  }
}

function copyCroppedPlanarChannel(
  destination: Float32Array,
  source: Float32Array,
  width: number,
  height: number,
  windows: LayerWindows
): void {
  const dataWindow = windows.dataWindow;
  if (!dataWindow) {
    return;
  }
  const dataWidth = getBoxWidth(dataWindow);
  const dataHeight = getBoxHeight(dataWindow);
  const displayMinX = windows.displayWindow?.minX ?? 0;
  const displayMinY = windows.displayWindow?.minY ?? 0;

  for (let row = 0; row < dataHeight; row += 1) {
    const destinationY = dataWindow.minY - displayMinY + row;
    if (destinationY < 0 || destinationY >= height) {
      continue;
    }
    const sourceStart = row * dataWidth;
    const unclippedDestinationX = dataWindow.minX - displayMinX;
    const sourceOffset = Math.max(0, -unclippedDestinationX);
    const destinationX = Math.max(0, unclippedDestinationX);
    const copyLength = Math.min(
      dataWidth - sourceOffset,
      width - destinationX
    );
    if (copyLength <= 0) {
      continue;
    }
    destination.set(
      source.subarray(sourceStart + sourceOffset, sourceStart + sourceOffset + copyLength),
      destinationY * width + destinationX
    );
  }
}

function calculateFiniteRange(pixels: Float32Array): FiniteValueRange | null {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let finiteCount = 0;
  for (const value of pixels) {
    if (!Number.isFinite(value)) {
      continue;
    }
    finiteCount += 1;
    if (value < min) min = value;
    if (value > max) max = value;
  }
  return finiteCount > 0 ? { min, max } : null;
}

export function readLayerInterleavedPixels(
  reader: LayerPixelReader,
  layerIndex: number,
  channelNames: string[],
  width: number,
  height: number,
  metadata: ExrMetadataEntry[]
): Float32Array {
  const expectedLength = width * height * channelNames.length;
  const windows = getLayerWindows(metadata);

  if (!hasCroppedDataWindow(windows, width, height)) {
    const interleaved = reader.getLayerPixels(layerIndex, channelNames);
    if (!interleaved) {
      throw new Error(`Decoded EXR layer ${layerIndex} is missing pixel data.`);
    }
    if (interleaved.length !== expectedLength) {
      throw new Error(
        `Invalid interleaved channel length for layer ${layerIndex}: expected ${expectedLength}, got ${interleaved.length}`
      );
    }
    return interleaved;
  }

  return readCroppedLayerInterleavedPixels(reader, layerIndex, channelNames, width, height, windows);
}

function readCroppedLayerInterleavedPixels(
  reader: LayerPixelReader,
  layerIndex: number,
  channelNames: string[],
  width: number,
  height: number,
  windows: LayerWindows
): Float32Array {
  const dataWindow = windows.dataWindow;
  if (!dataWindow) {
    throw new Error(`Decoded EXR layer ${layerIndex} has cropped pixels but no dataWindow metadata.`);
  }

  const channelCount = channelNames.length;
  const fullPixelCount = width * height;
  const interleaved = new Float32Array(fullPixelCount * channelCount);
  const dataWidth = getBoxWidth(dataWindow);
  const dataHeight = getBoxHeight(dataWindow);
  const dataPixelCount = dataWidth * dataHeight;
  const displayMinX = windows.displayWindow?.minX ?? 0;
  const displayMinY = windows.displayWindow?.minY ?? 0;

  for (let channelIndex = 0; channelIndex < channelCount; channelIndex += 1) {
    const channelName = channelNames[channelIndex];
    if (!channelName) {
      continue;
    }

    const channelPixels = reader.getLayerPixels(layerIndex, [channelName]);
    if (!channelPixels) {
      throw new Error(`Decoded EXR layer ${layerIndex} is missing pixel data for channel ${channelName}.`);
    }

    if (channelPixels.length === fullPixelCount) {
      copyFullChannel(interleaved, channelPixels, channelIndex, channelCount);
      continue;
    }

    if (channelPixels.length !== dataPixelCount) {
      throw new Error(
        `Invalid channel length for layer ${layerIndex} channel ${channelName}: expected ${dataPixelCount} or ${fullPixelCount}, got ${channelPixels.length}`
      );
    }

    copyCroppedChannel(interleaved, channelPixels, {
      channelIndex,
      channelCount,
      width,
      height,
      dataWindow,
      dataWidth,
      dataHeight,
      displayMinX,
      displayMinY
    });
  }

  return interleaved;
}

function copyFullChannel(
  interleaved: Float32Array,
  channelPixels: Float32Array,
  channelIndex: number,
  channelCount: number
): void {
  for (let pixelIndex = 0; pixelIndex < channelPixels.length; pixelIndex += 1) {
    interleaved[pixelIndex * channelCount + channelIndex] = channelPixels[pixelIndex] ?? 0;
  }
}

function copyCroppedChannel(
  interleaved: Float32Array,
  channelPixels: Float32Array,
  options: {
    channelIndex: number;
    channelCount: number;
    width: number;
    height: number;
    dataWindow: Box2i;
    dataWidth: number;
    dataHeight: number;
    displayMinX: number;
    displayMinY: number;
  }
): void {
  for (let row = 0; row < options.dataHeight; row += 1) {
    const destY = options.dataWindow.minY - options.displayMinY + row;
    if (destY < 0 || destY >= options.height) {
      continue;
    }

    for (let column = 0; column < options.dataWidth; column += 1) {
      const destX = options.dataWindow.minX - options.displayMinX + column;
      if (destX < 0 || destX >= options.width) {
        continue;
      }

      const sourceIndex = row * options.dataWidth + column;
      const destIndex = (destY * options.width + destX) * options.channelCount + options.channelIndex;
      interleaved[destIndex] = channelPixels[sourceIndex] ?? 0;
    }
  }
}

function getLayerWindows(metadata: ExrMetadataEntry[]): LayerWindows {
  return {
    dataWindow: parseBox2iMetadata(metadata.find((entry) => entry.key === 'dataWindow')?.value),
    displayWindow: parseBox2iMetadata(metadata.find((entry) => entry.key === 'displayWindow')?.value)
  };
}

function hasCroppedDataWindow(windows: LayerWindows, width: number, height: number): boolean {
  const dataWindow = windows.dataWindow;
  if (!dataWindow) {
    return false;
  }

  const displayWindow = windows.displayWindow ?? { minX: 0, minY: 0, maxX: width - 1, maxY: height - 1 };
  return (
    getBoxWidth(dataWindow) !== width ||
    getBoxHeight(dataWindow) !== height ||
    dataWindow.minX !== displayWindow.minX ||
    dataWindow.minY !== displayWindow.minY
  );
}

function parseBox2iMetadata(value: string | undefined): Box2i | null {
  if (!value) {
    return null;
  }

  const match = /^\[(-?\d+),(-?\d+)\]-\[(-?\d+),(-?\d+)\]$/u.exec(value.trim());
  if (!match) {
    return null;
  }

  const [, minX, minY, maxX, maxY] = match;
  return {
    minX: Number(minX),
    minY: Number(minY),
    maxX: Number(maxX),
    maxY: Number(maxY)
  };
}

function getBoxWidth(box: Box2i): number {
  return Math.max(0, box.maxX - box.minX + 1);
}

function getBoxHeight(box: Box2i): number {
  return Math.max(0, box.maxY - box.minY + 1);
}
