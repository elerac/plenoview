import {
  isSpectralRgbSelection,
  isStokesSelection,
  serializeDisplaySelectionKey,
  type DisplaySelection,
  type StokesAolpDegreeModulationMode,
  type StokesDegreeModulationState
} from './display-model';
import { DEFAULT_DISPLAY_GAMMA } from './color';
import {
  createDefaultChannelRecognitionSettings,
  sameChannelRecognitionSettings,
  serializeChannelRecognitionSettingsKey,
  type ChannelRecognitionSettings
} from './channel-recognition-settings';
import {
  createDefaultChannelRecognitionNameRules,
  sameChannelRecognitionNameRules,
  serializeChannelRecognitionNameRulesKey,
  type ChannelRecognitionNameRules
} from './channel-recognition-name-rules';
import { DEFAULT_MASK_INVALID_STOKES_VECTORS } from './stokes';

export function serializeChannelThumbnailContextKey(
  sessionId: string,
  activeLayer: number,
  selection: DisplaySelection | string
): string {
  const selectionKey = typeof selection === 'string' ? selection : serializeDisplaySelectionKey(selection);
  return `session:${sessionId}|layer:${activeLayer}|selection:${selectionKey}`;
}

export function serializeChannelThumbnailRequestKey(args: {
  sessionId: string;
  activeLayer: number;
  selection: DisplaySelection | string;
  exposureEv: number;
  displayGamma: number;
  stokesDegreeModulation: StokesDegreeModulationState;
  stokesAolpDegreeModulationMode: StokesAolpDegreeModulationMode;
  maskInvalidStokesVectors?: boolean;
  spectralRgbGroupingEnabled?: boolean;
  channelRecognitionSettings?: ChannelRecognitionSettings;
  channelRecognitionNameRules?: ChannelRecognitionNameRules;
}): string {
  const maskKey = isStokesThumbnailSelection(args.selection)
    ? `|maskInvalidStokesVectors:${(args.maskInvalidStokesVectors ?? DEFAULT_MASK_INVALID_STOKES_VECTORS) ? '1' : '0'}`
    : '';
  const spectralKey = isSpectralThumbnailSelection(args.selection)
    ? `|spectralRgbGrouping:${args.spectralRgbGroupingEnabled !== false ? '1' : '0'}`
    : '';
  const recognitionKey = args.channelRecognitionSettings &&
    !sameChannelRecognitionSettings(args.channelRecognitionSettings, createDefaultChannelRecognitionSettings())
    ? `|recognition:${serializeChannelRecognitionSettingsKey(args.channelRecognitionSettings)}`
    : '';
  const recognitionRulesKey = args.channelRecognitionNameRules &&
    !sameChannelRecognitionNameRules(args.channelRecognitionNameRules, createDefaultChannelRecognitionNameRules())
    ? `|recognitionRules:${serializeChannelRecognitionNameRulesKey(args.channelRecognitionNameRules)}`
    : '';
  return `${serializeChannelThumbnailContextKey(args.sessionId, args.activeLayer, args.selection)}|exposure:${serializeFiniteNumber(args.exposureEv, 0)}|gamma:${serializeFiniteNumber(args.displayGamma, DEFAULT_DISPLAY_GAMMA)}|modulation:${serializeStokesDegreeModulationKey(args.stokesDegreeModulation)}|aolpModulation:${args.stokesAolpDegreeModulationMode}${maskKey}${spectralKey}${recognitionKey}${recognitionRulesKey}`;
}

export function buildChannelThumbnailSessionPrefix(sessionId: string): string {
  return `session:${sessionId}|`;
}

function serializeFiniteNumber(value: number, fallback: number): string {
  return Number.isFinite(value) ? String(value) : String(fallback);
}

function serializeStokesDegreeModulationKey(modulation: StokesDegreeModulationState): string {
  return [
    `aolp:${modulation.aolp ? '1' : '0'}`,
    `cop:${modulation.cop ? '1' : '0'}`,
    `top:${modulation.top ? '1' : '0'}`
  ].join(',');
}

function isStokesThumbnailSelection(selection: DisplaySelection | string): boolean {
  if (typeof selection !== 'string') {
    return isStokesSelection(selection);
  }

  return selection.startsWith('stokesScalar:') || selection.startsWith('stokesAngle:');
}

function isSpectralThumbnailSelection(selection: DisplaySelection | string): boolean {
  if (typeof selection !== 'string') {
    return isSpectralRgbSelection(selection) || (
      isStokesSelection(selection) && selection.source.kind === 'spectralRgb'
    );
  }

  return selection.startsWith('spectralRgb:') || selection.includes(':spectralRgb');
}
