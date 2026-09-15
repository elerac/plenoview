import { getChannelReadView, readChannelValue } from '../../channel-storage';
import type { ChannelRecognitionNameRules } from '../../channel-recognition-name-rules';
import type { DisplaySourceBinding } from '../../display/bindings';
import type { EnvironmentImportanceSamplingTable } from '../../panorama-lighting';
import { detectRgbStokesChannels, type RgbStokesChannels } from '../../stokes';
import type { DecodedLayer } from '../../types';

export interface PolarizedEnvironmentSource {
  sourceKey: string;
  layer: DecodedLayer;
  channels: RgbStokesChannels;
  width: number;
  height: number;
}

export interface PolarizedEnvironmentImportanceSamplingTable extends EnvironmentImportanceSamplingTable {
  bilinear: true;
}

const COMPONENTS = ['s0', 's1', 's2', 's3'] as const;

/** Select the complete RGB Stokes emitter independently of its display parameter. */
export function resolvePolarizedEnvironmentChannels(
  layer: DecodedLayer,
  binding: DisplaySourceBinding,
  channelRecognitionNameRules?: ChannelRecognitionNameRules
): RgbStokesChannels | null {
  const channels = detectRgbStokesChannels(layer.channelNames, { channelRecognitionNameRules });
  if (!channels) {
    return null;
  }
  // penvmap accepts an absent S3, but requires RGB when any S3 is present.
  const s3Count = [channels.r.s3, channels.g.s3, channels.b.s3].filter(Boolean).length;
  if (s3Count !== 0 && s3Count !== 3) {
    return null;
  }
  const sourceChannels = new Set(
    [channels.r, channels.g, channels.b].flatMap(channel => COMPONENTS.map(component => channel[component]))
  );
  const selectedChannels = binding.slots.filter((channel): channel is string => channel !== null);
  const rootRgb = binding.mode === 'channelRgb' &&
    binding.slots[0]?.toUpperCase() === 'R' && binding.slots[1]?.toUpperCase() === 'G' && binding.slots[2]?.toUpperCase() === 'B';
  if (!rootRgb && (selectedChannels.length === 0 || !selectedChannels.some(channel => sourceChannels.has(channel)))) {
    return null;
  }
  return channels;
}

export function polarizedEnvironmentSourceKey(
  sessionId: string,
  layerIndex: number,
  channels: RgbStokesChannels
): string {
  return `${sessionId}:${layerIndex}:penvmap:${[channels.r, channels.g, channels.b]
    .flatMap(channel => COMPONENTS.map(component => channel[component] ?? '')).join(':')}`;
}

export function polarizedEnvironmentSize(source: Pick<PolarizedEnvironmentSource, 'width' | 'height'>): {
  width: number;
  height: number;
} {
  if (!Number.isInteger(source.width) || !Number.isInteger(source.height) || source.width < 1 || source.height < 1) {
    throw new RangeError('Polarized environment dimensions must be positive integers.');
  }
  return { width: Math.max(2, source.width), height: Math.max(3, source.height) };
}

/** Linear signed RGB, including edge padding and the optional zero-filled S3. */
export function buildPolarizedEnvironmentPixels(
  source: PolarizedEnvironmentSource,
  component: 0 | 1 | 2 | 3
): Float32Array {
  const { width, height } = polarizedEnvironmentSize(source);
  const name = COMPONENTS[component];
  const views = [source.channels.r, source.channels.g, source.channels.b].map(channels => {
    const channel = channels[name];
    return channel ? getChannelReadView(source.layer, channel) : null;
  });
  const pixels = new Float32Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const inputIndex = Math.min(y, source.height - 1) * source.width + Math.min(x, source.width - 1);
      const outputIndex = (y * width + x) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        pixels[outputIndex + channel] = readChannelValue(views[channel], inputIndex);
      }
      pixels[outputIndex + 3] = 1;
    }
  }
  return pixels;
}

/**
 * penvmap.cpp's Hierarchical2D density: bilinear interpolation of
 * max(luminance(S0), 0) * sin(y * pi / (H-1)) on its periodic W+1 by H grid.
 * An alias table chooses the same bilinear cells without the hierarchy; exact
 * conditional linear inversion in the shader reproduces the continuous PDF.
 * Each cell occupies two texels: [accept, alias, mass, 0], [w00,w10,w01,w11].
 * Corner values are normalized as densities with respect to the unit UV square.
 */
export function buildPolarizedEnvironmentImportanceSampling(
  source: PolarizedEnvironmentSource
): PolarizedEnvironmentImportanceSamplingTable {
  const { width, height } = polarizedEnvironmentSize(source);
  const views = [source.channels.r, source.channels.g, source.channels.b]
    .map(channels => getChannelReadView(source.layer, channels.s0));
  const density = new Float64Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const sinTheta = y === 0 || y === height - 1 ? 0 : Math.max(0, Math.sin(y * Math.PI / (height - 1)));
    for (let x = 0; x < width; x += 1) {
      const inputIndex = Math.min(y, source.height - 1) * source.width + Math.min(x, source.width - 1);
      // Mitsuba's sRGB luminance coefficients (include/core/spectrum.h).
      const luminance = 0.212671 * readChannelValue(views[0], inputIndex) +
        0.715160 * readChannelValue(views[1], inputIndex) +
        0.072169 * readChannelValue(views[2], inputIndex);
      density[y * width + x] = Number.isFinite(luminance) ? Math.max(0, luminance) * sinTheta : 0;
    }
  }

  const entryCount = width * (height - 1);
  const rgba32f = new Float32Array(entryCount * 8);
  const weights = new Float64Array(entryCount);
  let totalWeight = 0;
  for (let y = 0; y < height - 1; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const nextX = (x + 1) % width;
      const index = y * width + x;
      const offset = index * 8;
      const w00 = density[y * width + x];
      const w10 = density[y * width + nextX];
      const w01 = density[(y + 1) * width + x];
      const w11 = density[(y + 1) * width + nextX];
      weights[index] = (w00 + w10 + w01 + w11) * 0.25;
      totalWeight += weights[index];
      rgba32f[offset + 4] = w00;
      rgba32f[offset + 5] = w10;
      rgba32f[offset + 6] = w01;
      rgba32f[offset + 7] = w11;
    }
  }

  if (!(totalWeight > 0)) {
    // An all-black emitter contributes zero. A uniform UV fallback keeps the
    // sampling machinery finite even though Mitsuba's zero PDF is undefined.
    weights.fill(1);
    totalWeight = entryCount;
    for (let index = 0; index < entryCount; index += 1) {
      rgba32f.fill(1, index * 8 + 4, index * 8 + 8);
    }
  }
  const normalization = entryCount / totalWeight;
  const small: number[] = [];
  const large: number[] = [];
  for (let index = 0; index < entryCount; index += 1) {
    const offset = index * 8;
    rgba32f[offset + 2] = weights[index] / totalWeight;
    weights[index] *= normalization;
    for (let corner = 4; corner < 8; corner += 1) {
      rgba32f[offset + corner] *= normalization;
    }
    (weights[index] < 1 ? small : large).push(index);
  }
  while (small.length > 0 && large.length > 0) {
    const smallIndex = small.pop() as number;
    const largeIndex = large.pop() as number;
    rgba32f[smallIndex * 8] = weights[smallIndex];
    rgba32f[smallIndex * 8 + 1] = largeIndex;
    weights[largeIndex] += weights[smallIndex] - 1;
    (weights[largeIndex] < 1 ? small : large).push(largeIndex);
  }
  for (const index of [...small, ...large]) {
    rgba32f[index * 8] = 1;
    rgba32f[index * 8 + 1] = index;
  }
  return { projection: 'equirectangular', bilinear: true, gridWidth: width, gridHeight: height - 1, entryCount, rgba32f };
}
