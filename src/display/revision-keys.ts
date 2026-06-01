import {
  AUTO_EXPOSURE_PERCENTILE,
  AUTO_EXPOSURE_SOURCE
} from '../analysis/auto-exposure';
import {
  isGroupedRgbStokesSelection,
  isNormalMapSelection,
  isStokesSelection,
  serializeDisplaySelectionKey,
  type DisplaySelection
} from '../display-model';
import { DEFAULT_MASK_INVALID_STOKES_VECTORS } from '../stokes';
import {
  createDefaultChannelRecognitionSettings,
  sameChannelRecognitionSettings,
  serializeChannelRecognitionSettingsKey,
  type ChannelRecognitionSettings
} from '../channel-recognition-settings';
import {
  createDefaultChannelRecognitionNameRules,
  sameChannelRecognitionNameRules,
  serializeChannelRecognitionNameRulesKey,
  type ChannelRecognitionNameRules
} from '../channel-recognition-name-rules';
import type { ViewerState, VisualizationMode } from '../types';

type StokesMaskRevisionState = Partial<Pick<ViewerState, 'maskInvalidStokesVectors'>>;
type SpectralRgbGroupingRevisionState = Partial<Pick<ViewerState, 'spectralRgbGroupingEnabled'>>;
type ChannelRecognitionRevisionState = {
  channelRecognitionSettings?: ChannelRecognitionSettings;
  channelRecognitionNameRules?: ChannelRecognitionNameRules;
};

function serializeDisplaySelectionRevisionKey(
  selection: DisplaySelection | null,
  visualizationMode: VisualizationMode,
  state: StokesMaskRevisionState & SpectralRgbGroupingRevisionState & ChannelRecognitionRevisionState = {}
): string {
  if (!selection) {
    return 'none';
  }

  const baseKey = serializeDisplaySelectionKey(selection);
  const key = isGroupedRgbStokesSelection(selection)
    ? `${baseKey}:${visualizationMode}`
    : baseKey;
  return appendChannelRecognitionRevisionKey(
    appendSpectralRgbGroupingRevisionKey(appendStokesMaskRevisionKey(key, selection, state), selection, state),
    state
  );
}

export function serializeDisplaySelectionLuminanceKey(
  selection: DisplaySelection | null,
  visualizationMode: VisualizationMode = 'rgb',
  state: StokesMaskRevisionState & SpectralRgbGroupingRevisionState & ChannelRecognitionRevisionState = {}
): string {
  if (!selection) {
    return appendChannelRecognitionRevisionKey('none', state);
  }

  switch (selection.kind) {
    case 'channelRgb':
      return appendChannelRecognitionRevisionKey(
        `channelRgb:${selection.r}:${selection.g}:${selection.b ?? ''}${isNormalMapSelection(selection) ? ':normalMap' : ''}`,
        state
      );
    case 'channelMono':
      return appendChannelRecognitionRevisionKey(`channelMono:${selection.channel}`, state);
    case 'spectralRgb':
      return serializeDisplaySelectionRevisionKey(selection, visualizationMode, state);
    case 'muellerMatrix':
      return serializeDisplaySelectionRevisionKey(selection, visualizationMode, state);
    case 'stokesScalar':
    case 'stokesAngle':
      return serializeDisplaySelectionRevisionKey(selection, visualizationMode, state);
  }

  return appendChannelRecognitionRevisionKey(serializeDisplaySelectionKey(selection), state);
}

export function buildDisplayTextureRevisionKey(
  state: Pick<ViewerState, 'activeLayer' | 'displaySelection'> &
    Partial<Pick<ViewerState, 'visualizationMode' | 'viewerMode' | 'depthChannel' | 'maskInvalidStokesVectors' | 'spectralRgbGroupingEnabled'>> &
    ChannelRecognitionRevisionState
): string {
  const parts = [
    state.activeLayer,
    serializeDisplaySelectionRevisionKey(state.displaySelection, state.visualizationMode ?? 'rgb', state)
  ];
  if (state.viewerMode === 'depth') {
    parts.push(`depth:${state.depthChannel ?? ''}`);
  }
  return parts.join(':');
}

export function buildDisplayLuminanceRevisionKey(
  state: Pick<ViewerState, 'activeLayer' | 'displaySelection'> &
    Partial<Pick<ViewerState, 'visualizationMode' | 'maskInvalidStokesVectors' | 'spectralRgbGroupingEnabled'>> &
    ChannelRecognitionRevisionState
): string {
  return [
    state.activeLayer,
    serializeDisplaySelectionLuminanceKey(state.displaySelection, state.visualizationMode ?? 'rgb', state)
  ].join(':');
}

export function buildDisplayImageStatsRevisionKey(
  state: Pick<ViewerState, 'activeLayer' | 'displaySelection'> &
    Partial<Pick<ViewerState, 'visualizationMode' | 'maskInvalidStokesVectors' | 'spectralRgbGroupingEnabled'>> &
    ChannelRecognitionRevisionState
): string {
  return [
    state.activeLayer,
    serializeDisplaySelectionRevisionKey(state.displaySelection, state.visualizationMode ?? 'rgb', state)
  ].join(':');
}

export function buildDisplayAutoExposureRevisionKey(
  state: Pick<ViewerState, 'activeLayer' | 'displaySelection'> &
    Partial<Pick<ViewerState, 'visualizationMode' | 'maskInvalidStokesVectors' | 'spectralRgbGroupingEnabled'>> &
    ChannelRecognitionRevisionState,
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

  return `${key}:maskInvalidStokesVectors:${state.maskInvalidStokesVectors ?? DEFAULT_MASK_INVALID_STOKES_VECTORS}`;
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

function appendChannelRecognitionRevisionKey(
  key: string,
  state: ChannelRecognitionRevisionState
): string {
  const settings = state.channelRecognitionSettings;
  const settingsKey = settings && !sameChannelRecognitionSettings(settings, createDefaultChannelRecognitionSettings())
    ? `:channelRecognition:${serializeChannelRecognitionSettingsKey(settings)}`
    : '';
  const nameRules = state.channelRecognitionNameRules;
  const nameRulesKey = nameRules && !sameChannelRecognitionNameRules(nameRules, createDefaultChannelRecognitionNameRules())
    ? `:channelRecognitionRules:${serializeChannelRecognitionNameRulesKey(nameRules)}`
    : '';
  return `${key}${settingsKey}${nameRulesKey}`;
}
