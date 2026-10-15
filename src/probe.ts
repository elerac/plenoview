import { DEFAULT_DISPLAY_GAMMA, computeRec709Luminance, linearToDisplayGammaByte } from './color';
import { ColormapLut, mapValueToColormapRgbBytes, modulateRgbBytesHsv } from './colormaps';
import {
  getDisplaySelectionDegreeModulationValueLabel,
  getDisplaySelectionOptionLabel,
  getDisplaySelectionValueLabel,
  getSelectionAlpha,
  isGroupedRgbStokesSelection,
  isGroupedRgbMuellerMatrixSelection,
  isChannelSelection,
  isMonoSelection,
  isNormalMapSelection,
  isMuellerMatrixSelection,
  isSpectralRgbSelection,
  isStokesSelection,
  type DisplaySelection,
  type StokesAolpDegreeModulationMode,
  type StokesDegreeModulationState
} from './display-model';
import {
  applyStokesDegreeModulationGamma,
  clampStokesDegreeModulationValue,
  createDefaultStokesDegreeModulation,
  getStokesDegreeModulationLabel,
  getStokesParameterLabel,
  isStokesDegreeModulationEnabled,
  resolveStokesDegreeModulationMode
} from './stokes';
import { mapNormalComponentToDisplayValue } from './display/evaluator';
import {
  DisplayLuminanceRange,
  ImagePixel,
  PixelSample,
  VisualizationMode
} from './types';
import { formatOverlayValue } from './value-format';

export interface ProbeColorPreview {
  cssColor: string;
  displayValues: ProbeDisplayValue[];
}

export interface ProbeDisplayValue {
  label: string;
  value: string;
}

export interface ProbeVisualizationOptions {
  mode: VisualizationMode;
  colormapRange: DisplayLuminanceRange | null;
  colormapLut?: ColormapLut | null;
  colormapExposureEv?: number;
  colormapGamma?: number;
  colormapZeroCentered?: boolean;
  colormapReversed?: boolean;
  stokesDegreeModulation?: StokesDegreeModulationState;
  stokesAolpDegreeModulationMode?: StokesAolpDegreeModulationMode;
  stokesAolpDegreeModulationGamma?: number;
}

export function resolveActiveProbePixel(
  lockedPixel: ImagePixel | null,
  hoveredPixel: ImagePixel | null
): ImagePixel | null {
  return lockedPixel ?? hoveredPixel;
}

export function resolveProbeMode(lockedPixel: ImagePixel | null): 'Hover' | 'Locked' {
  return lockedPixel ? 'Locked' : 'Hover';
}

export function sameActiveProbeTarget(
  previousLockedPixel: ImagePixel | null,
  previousHoveredPixel: ImagePixel | null,
  nextLockedPixel: ImagePixel | null,
  nextHoveredPixel: ImagePixel | null
): boolean {
  return (
    resolveProbeMode(previousLockedPixel) === resolveProbeMode(nextLockedPixel) &&
    samePixel(
      resolveActiveProbePixel(previousLockedPixel, previousHoveredPixel),
      resolveActiveProbePixel(nextLockedPixel, nextHoveredPixel)
    )
  );
}

export function buildProbeColorPreview(
  sample: PixelSample | null,
  selection: DisplaySelection | null,
  exposureEv: number,
  displayGammaOrVisualization: number | ProbeVisualizationOptions = DEFAULT_DISPLAY_GAMMA,
  visualization: ProbeVisualizationOptions = { mode: 'rgb', colormapRange: null }
): ProbeColorPreview | null {
  if (!sample) {
    return null;
  }

  const displayGamma = typeof displayGammaOrVisualization === 'number'
    ? displayGammaOrVisualization
    : DEFAULT_DISPLAY_GAMMA;
  const resolvedVisualization = typeof displayGammaOrVisualization === 'number'
    ? visualization
    : displayGammaOrVisualization;
  const [rawR, rawG, rawB] = readProbeDisplayValues(sample, selection, resolvedVisualization.mode);
  const rawA = readProbeDisplayAlpha(sample, selection);
  const exposureScale = 2 ** exposureEv;
  let bytes: [number, number, number];
  const monoValue = computeRec709Luminance(rawR, rawG, rawB);
  let displayValues: ProbeDisplayValue[];
  if (isNormalMapSelection(selection)) {
    bytes = [
      normalMapDisplayByte(rawR),
      normalMapDisplayByte(rawG),
      normalMapDisplayByte(rawB)
    ];
    displayValues = buildProbeRgbDisplayValues(selection, rawR, rawG, rawB);
  } else if (resolvedVisualization.mode === 'colormap') {
    bytes = mapValueToColormapRgbBytes(
      monoValue,
      resolvedVisualization.colormapRange,
      resolvedVisualization.colormapLut ?? null,
      {
        exposureEv: resolvedVisualization.colormapExposureEv,
        gamma: resolvedVisualization.colormapGamma,
        zeroCentered: resolvedVisualization.colormapZeroCentered,
        reverse: resolvedVisualization.colormapReversed
      }
    );
    displayValues = [{ label: 'Mono', value: formatOverlayValue(monoValue) }];

    const stokesDegreeModulation =
      resolvedVisualization.stokesDegreeModulation ?? createDefaultStokesDegreeModulation();
    if (isStokesDegreeModulationEnabled(selection, stokesDegreeModulation)) {
      bytes = modulateRgbBytesHsv(
        bytes,
        applyStokesDegreeModulationGamma(
          readProbeStokesDegreeModulationValue(sample, selection),
          selection,
          resolvedVisualization.stokesAolpDegreeModulationGamma ?? 1
        ),
        resolveStokesDegreeModulationMode(
          selection,
          resolvedVisualization.stokesAolpDegreeModulationMode ?? 'value'
        )
      );
    }
  } else {
    bytes = [
      linearToDisplayGammaByte(rawR * exposureScale, displayGamma),
      linearToDisplayGammaByte(rawG * exposureScale, displayGamma),
      linearToDisplayGammaByte(rawB * exposureScale, displayGamma)
    ];
    displayValues = isMonoSelection(selection)
      ? [{ label: 'Mono', value: formatOverlayValue(rawR) }]
      : buildProbeRgbDisplayValues(selection, rawR, rawG, rawB);
  }

  if (rawA !== null) {
    displayValues = [
      ...displayValues,
      { label: 'A', value: formatOverlayValue(rawA) }
    ];
  }

  return {
    cssColor: rawA === null
      ? `rgb(${bytes[0]}, ${bytes[1]}, ${bytes[2]})`
      : `rgba(${bytes[0]}, ${bytes[1]}, ${bytes[2]}, ${formatCssAlpha(rawA)})`,
    displayValues
  };
}

function normalMapDisplayByte(value: number): number {
  return Math.round(mapNormalComponentToDisplayValue(value) * 255);
}

function readProbeDisplayValues(
  sample: PixelSample,
  selection: DisplaySelection | null,
  visualizationMode: VisualizationMode
): [number, number, number] {
  if (!selection) {
    return [0, 0, 0];
  }

  if (isStokesSelection(selection)) {
    if (visualizationMode === 'rgb' && isGroupedRgbStokesSelection(selection)) {
      const label = getStokesParameterLabel(selection.parameter);
      const displayLabel = getDisplaySelectionValueLabel(selection) ?? label;
      return [
        readFirstProbeChannel(sample, [`${displayLabel}.R`, `${label}.R`, displayLabel, label]),
        readFirstProbeChannel(sample, [`${displayLabel}.G`, `${label}.G`, displayLabel, label]),
        readFirstProbeChannel(sample, [`${displayLabel}.B`, `${label}.B`, displayLabel, label])
      ];
    }

    const value = readFirstProbeChannel(sample, [
      getDisplaySelectionValueLabel(selection),
      getStokesParameterLabel(selection.parameter)
    ]);
    return [value, value, value];
  }

  if (isSpectralRgbSelection(selection)) {
    const label = getDisplaySelectionOptionLabel(selection);
    return [
      readProbeChannel(sample, `${label}.R`),
      readProbeChannel(sample, `${label}.G`),
      readProbeChannel(sample, `${label}.B`)
    ];
  }

  if (isMuellerMatrixSelection(selection)) {
    if (isGroupedRgbMuellerMatrixSelection(selection)) {
      const label = getDisplaySelectionOptionLabel(selection);
      return [
        readProbeChannel(sample, `${label}.R`),
        readProbeChannel(sample, `${label}.G`),
        readProbeChannel(sample, `${label}.B`)
      ];
    }

    const value = readProbeChannel(sample, getDisplaySelectionOptionLabel(selection));
    return [value, value, value];
  }

  if (selection.kind === 'channelMono') {
    const value = readProbeChannel(sample, selection.channel);
    return [value, value, value];
  }

  return [
    readProbeChannel(sample, selection.r),
    readProbeChannel(sample, selection.g),
    selection.b ? readProbeChannel(sample, selection.b) : 0
  ];
}

function buildProbeRgbDisplayValues(
  selection: DisplaySelection | null,
  rawR: number,
  rawG: number,
  rawB: number
): ProbeDisplayValue[] {
  const values: ProbeDisplayValue[] = [
    { label: 'R', value: formatOverlayValue(rawR) },
    { label: 'G', value: formatOverlayValue(rawG) }
  ];
  if (!selection || selection.kind !== 'channelRgb' || selection.b) {
    values.push({ label: 'B', value: formatOverlayValue(rawB) });
  }

  return values;
}

function readProbeDisplayAlpha(sample: PixelSample, selection: DisplaySelection | null): number | null {
  const alphaChannel = isChannelSelection(selection)
    ? getSelectionAlpha(selection)
    : null;
  if (!alphaChannel) {
    return null;
  }

  return readProbeChannel(sample, alphaChannel);
}

function readFirstProbeChannel(sample: PixelSample, channelNames: Array<string | null>): number {
  for (const channelName of channelNames) {
    if (!channelName || !(channelName in sample.values)) {
      continue;
    }
    return readProbeChannel(sample, channelName);
  }

  return 0;
}

function readProbeChannel(sample: PixelSample, channelName: string): number {
  const value = sample.values[channelName];
  return value ?? 0;
}

function readProbeStokesDegreeModulationValue(sample: PixelSample, selection: DisplaySelection | null): number {
  const parameter = isStokesSelection(selection) ? selection.parameter : null;
  return clampStokesDegreeModulationValue(
    readFirstProbeChannel(sample, [
      getDisplaySelectionDegreeModulationValueLabel(selection),
      getStokesDegreeModulationLabel(parameter)
    ])
  );
}

function clampAlpha(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.min(1, Math.max(0, value));
}

function formatCssAlpha(value: number): string {
  return Number(clampAlpha(value).toPrecision(4)).toString();
}

function samePixel(a: ImagePixel | null, b: ImagePixel | null): boolean {
  if (!a && !b) {
    return true;
  }

  if (!a || !b) {
    return false;
  }

  return a.ix === b.ix && a.iy === b.iy;
}
