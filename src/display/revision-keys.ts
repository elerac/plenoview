import {
  AUTO_EXPOSURE_PERCENTILE,
  AUTO_EXPOSURE_SOURCE
} from '../analysis/auto-exposure';
import {
  isGroupedRgbStokesSelection,
  isStokesSelection,
  serializeDisplaySelectionKey,
  type DisplaySelection
} from '../display-model';
import type { ViewerState, VisualizationMode } from '../types';

type StokesMaskRevisionState = Partial<Pick<ViewerState, 'maskInvalidStokesVectors'>>;
type SpectralRgbGroupingRevisionState = Partial<Pick<ViewerState, 'spectralRgbGroupingEnabled'>>;

function serializeDisplaySelectionRevisionKey(
  selection: DisplaySelection | null,
  visualizationMode: VisualizationMode,
  state: StokesMaskRevisionState & SpectralRgbGroupingRevisionState = {}
): string {
  if (!selection) {
    return 'none';
  }

  const baseKey = serializeDisplaySelectionKey(selection);
  const key = isGroupedRgbStokesSelection(selection)
    ? `${baseKey}:${visualizationMode}`
    : baseKey;
  return appendSpectralRgbGroupingRevisionKey(appendStokesMaskRevisionKey(key, selection, state), selection, state);
}

export function serializeDisplaySelectionLuminanceKey(
  selection: DisplaySelection | null,
  visualizationMode: VisualizationMode = 'rgb',
  state: StokesMaskRevisionState & SpectralRgbGroupingRevisionState = {}
): string {
  if (!selection) {
    return 'none';
  }

  switch (selection.kind) {
    case 'channelRgb':
      return `channelRgb:${selection.r}:${selection.g}:${selection.b}`;
    case 'channelMono':
      return `channelMono:${selection.channel}`;
    case 'spectralRgb':
      return serializeDisplaySelectionRevisionKey(selection, visualizationMode, state);
    case 'stokesScalar':
    case 'stokesAngle':
      return serializeDisplaySelectionRevisionKey(selection, visualizationMode, state);
  }
}

export function buildDisplayTextureRevisionKey(
  state: Pick<ViewerState, 'activeLayer' | 'displaySelection'> &
    Partial<Pick<ViewerState, 'visualizationMode' | 'maskInvalidStokesVectors' | 'spectralRgbGroupingEnabled'>>
): string {
  return [
    state.activeLayer,
    serializeDisplaySelectionRevisionKey(state.displaySelection, state.visualizationMode ?? 'rgb', state)
  ].join(':');
}

export function buildDisplayLuminanceRevisionKey(
  state: Pick<ViewerState, 'activeLayer' | 'displaySelection'> &
    Partial<Pick<ViewerState, 'visualizationMode' | 'maskInvalidStokesVectors' | 'spectralRgbGroupingEnabled'>>
): string {
  return [
    state.activeLayer,
    serializeDisplaySelectionLuminanceKey(state.displaySelection, state.visualizationMode ?? 'rgb', state)
  ].join(':');
}

export function buildDisplayImageStatsRevisionKey(
  state: Pick<ViewerState, 'activeLayer' | 'displaySelection'> &
    Partial<Pick<ViewerState, 'visualizationMode' | 'maskInvalidStokesVectors' | 'spectralRgbGroupingEnabled'>>
): string {
  return [
    state.activeLayer,
    serializeDisplaySelectionRevisionKey(state.displaySelection, state.visualizationMode ?? 'rgb', state)
  ].join(':');
}

export function buildDisplayAutoExposureRevisionKey(
  state: Pick<ViewerState, 'activeLayer' | 'displaySelection'> &
    Partial<Pick<ViewerState, 'visualizationMode' | 'maskInvalidStokesVectors' | 'spectralRgbGroupingEnabled'>>,
  percentile = AUTO_EXPOSURE_PERCENTILE
): string {
  return [
    state.activeLayer,
    serializeDisplaySelectionRevisionKey(state.displaySelection, state.visualizationMode ?? 'rgb', state),
    `autoExposure:${AUTO_EXPOSURE_SOURCE}:p${percentile}`
  ].join(':');
}

function appendStokesMaskRevisionKey(
  key: string,
  selection: DisplaySelection,
  state: StokesMaskRevisionState
): string {
  if (!isStokesSelection(selection)) {
    return key;
  }

  return `${key}:maskInvalidStokesVectors:${state.maskInvalidStokesVectors !== false}`;
}

function appendSpectralRgbGroupingRevisionKey(
  key: string,
  selection: DisplaySelection,
  state: SpectralRgbGroupingRevisionState
): string {
  const affectsSelection = selection.kind === 'spectralRgb' || (
    isStokesSelection(selection) && selection.source.kind === 'spectralRgb'
  );
  return affectsSelection
    ? `${key}:spectralRgbGrouping:${state.spectralRgbGroupingEnabled !== false}`
    : key;
}
