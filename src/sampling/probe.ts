import { readPixelChannelValue } from '../channel-storage';
import {
  getDisplaySelectionOptionLabel,
  isGroupedRgbMuellerMatrixSelection,
  isMuellerMatrixSelection,
  isSpectralRgbSelection,
  isStokesSelection,
  type DisplaySelection
} from '../display-model';
import { resolveDisplayImageSize } from '../display-size';
import {
  readDisplaySelectionPixelValuesAtIndex,
  resolveDisplaySelectionEvaluator,
  type DisplayEvaluationOptions,
  type DisplayPixelValues
} from '../display/evaluator';
import { isStokesDisplayAvailable } from '../stokes';
import { appendSpectralStokesRgbSampleValues } from '../stokes/spectral-stokes-rgb';
import { appendStokesSampleValues } from '../stokes/stokes-display';
import { isSpectralRgbDisplayAvailable } from '../spectral';
import {
  detectMuellerMatrixChannels,
  detectRgbMuellerMatrixChannels,
  readMuellerMatrixPixelValue,
  resolveMuellerMatrixDisplayPixel
} from '../mueller';
import type { DecodedLayer, ImagePixel, PixelSample, VisualizationMode } from '../types';

export function readDisplaySelectionPixelValues(
  layer: DecodedLayer,
  width: number,
  height: number,
  pixel: ImagePixel,
  selection: DisplaySelection | null,
  visualizationMode: VisualizationMode = 'rgb',
  output?: DisplayPixelValues,
  stokesOptions: DisplayEvaluationOptions = {}
): DisplayPixelValues | null {
  const displaySize = resolveDisplayImageSize(width, height, selection);
  if (pixel.ix < 0 || pixel.iy < 0 || pixel.ix >= displaySize.width || pixel.iy >= displaySize.height) {
    return null;
  }

  return readDisplaySelectionPixelValuesAtIndex(
    resolveDisplaySelectionEvaluator(layer, selection, visualizationMode, {
      ...stokesOptions,
      sourceWidth: width,
      sourceHeight: height
    }),
    pixel.iy * displaySize.width + pixel.ix,
    output
  );
}

export function samplePixelValues(
  layer: DecodedLayer,
  width: number,
  height: number,
  pixel: ImagePixel
): PixelSample | null {
  if (pixel.ix < 0 || pixel.iy < 0 || pixel.ix >= width || pixel.iy >= height) {
    return null;
  }

  const flatIndex = pixel.iy * width + pixel.ix;
  const values: Record<string, number> = {};

  for (let channelIndex = 0; channelIndex < layer.channelNames.length; channelIndex += 1) {
    const channelName = layer.channelNames[channelIndex];
    if (!channelName) {
      continue;
    }
    values[channelName] = readPixelChannelValue(layer, flatIndex, channelName);
  }

  return {
    x: pixel.ix,
    y: pixel.iy,
    values
  };
}

export function samplePixelValuesForDisplay(
  layer: DecodedLayer,
  width: number,
  height: number,
  pixel: ImagePixel,
  selection: DisplaySelection | null,
  visualizationMode: VisualizationMode = 'rgb',
  stokesOptions: DisplayEvaluationOptions = {}
): PixelSample | null {
  if (isMuellerMatrixSelection(selection)) {
    return sampleMuellerMatrixPixelValuesForDisplay(layer, width, height, pixel, selection);
  }

  const sample = samplePixelValues(layer, width, height, pixel);
  if (!sample) {
    return sample;
  }

  const flatIndex = pixel.iy * width + pixel.ix;
  if (
    isStokesSelection(selection) &&
    isStokesDisplayAvailable(
      layer.channelNames,
      selection,
      undefined,
      stokesOptions.spectralRgbGroupingEnabled !== false
    )
  ) {
    if (selection.source.kind === 'spectralRgb') {
      appendSpectralStokesRgbSampleValues(layer, flatIndex, selection, sample.values, visualizationMode, stokesOptions);
    } else {
      appendStokesSampleValues(layer, flatIndex, selection, sample.values, visualizationMode, stokesOptions);
    }
  }

  if (
    isSpectralRgbSelection(selection) &&
    stokesOptions.spectralRgbGroupingEnabled !== false &&
    isSpectralRgbDisplayAvailable(layer.channelNames, selection)
  ) {
    const values = readDisplaySelectionPixelValuesAtIndex(
      resolveDisplaySelectionEvaluator(layer, selection, visualizationMode, {
        ...stokesOptions,
        sourceWidth: width,
        sourceHeight: height
      }),
      flatIndex
    );
    const label = getDisplaySelectionOptionLabel(selection);
    sample.values[`${label}.R`] = values.r;
    sample.values[`${label}.G`] = values.g;
    sample.values[`${label}.B`] = values.b;
  }

  return sample;
}

function sampleMuellerMatrixPixelValuesForDisplay(
  layer: DecodedLayer,
  width: number,
  height: number,
  pixel: ImagePixel,
  selection: Extract<DisplaySelection, { kind: 'muellerMatrix' }>
): PixelSample | null {
  const resolvedPixel = resolveMuellerMatrixDisplayPixel(pixel, width, height);
  if (!resolvedPixel) {
    return null;
  }

  const sourceSample = samplePixelValues(layer, width, height, resolvedPixel.sourcePixel);
  if (!sourceSample) {
    return null;
  }

  const values = { ...sourceSample.values };
  if (isGroupedRgbMuellerMatrixSelection(selection)) {
    const channels = detectRgbMuellerMatrixChannels(layer.channelNames);
    if (!channels) {
      return null;
    }

    const label = getDisplaySelectionOptionLabel(selection);
    values[`${label}.R`] = readMuellerMatrixPixelValue(
      layer,
      resolvedPixel.sourceIndex,
      channels.r,
      resolvedPixel.element
    );
    values[`${label}.G`] = readMuellerMatrixPixelValue(
      layer,
      resolvedPixel.sourceIndex,
      channels.g,
      resolvedPixel.element
    );
    values[`${label}.B`] = readMuellerMatrixPixelValue(
      layer,
      resolvedPixel.sourceIndex,
      channels.b,
      resolvedPixel.element
    );
    return {
      x: pixel.ix,
      y: pixel.iy,
      values
    };
  }

  const channels = detectMuellerMatrixChannels(layer.channelNames, selection.suffix ?? null);
  if (!channels) {
    return null;
  }

  values[getDisplaySelectionOptionLabel(selection)] = readMuellerMatrixPixelValue(
    layer,
    resolvedPixel.sourceIndex,
    channels,
    resolvedPixel.element
  );

  return {
    x: pixel.ix,
    y: pixel.iy,
    values
  };
}
