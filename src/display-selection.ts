import {
  buildChannelMonoSelection,
  buildChannelRgbSelection,
  extractComponentChannelGroups,
  extractRgbChannelGroups,
  findRecognizedCandidateForSelection,
  findSelectedComponentChannelGroup,
  pickDefaultRecognizedCandidate,
  recognizeLayerChannels,
  type ChannelRecognitionResult,
  resolveAlphaChannelForChannel,
  type ComponentGroupCandidate,
  type NormalMapCandidate,
  type RecognizedChannelCandidate,
  type RgbChannelGroup,
  type SingleChannelCandidate
} from './channel-recognition';
import {
  sameDisplaySelection,
  type ChannelSelection,
  type DisplaySelection
} from './display-model';
import type { DisplayChannelMapping } from './types';
import type { StokesParameterVisibilitySettings } from './stokes';
import type { ChannelRecognitionSettings } from './channel-recognition-settings';
import type { ChannelRecognitionNameRules } from './channel-recognition-name-rules';

export type { RgbChannelGroup } from './channel-recognition';

export interface ChannelDisplayOption {
  key: string;
  label: string;
  selection: ChannelSelection;
  mapping: DisplayChannelMapping;
}

export interface ChannelDisplayOptionsConfig {
  includeRgbGroups?: boolean;
  includeSplitChannels?: boolean;
  includeAlphaCompanions?: boolean;
  channelRecognitionSettings?: ChannelRecognitionSettings;
  channelRecognitionNameRules?: ChannelRecognitionNameRules;
}

export interface DisplaySelectionAvailabilityConfig {
  stokesParameterVisibility?: StokesParameterVisibilitySettings;
  spectralRgbGroupingEnabled?: boolean;
  channelRecognitionSettings?: ChannelRecognitionSettings;
  channelRecognitionNameRules?: ChannelRecognitionNameRules;
}

export function pickDefaultDisplaySelection(
  channelNames: string[],
  config: DisplaySelectionAvailabilityConfig = {}
): DisplaySelection | null {
  return pickDefaultSelectionFromRecognition(recognizeLayerChannels(channelNames, config));
}

export function resolveDisplaySelectionForLayer(
  channelNames: string[],
  currentSelection: DisplaySelection | null,
  config: DisplaySelectionAvailabilityConfig = {}
): DisplaySelection | null {
  const recognition = recognizeLayerChannels(channelNames, config);
  if (!currentSelection) {
    return pickDefaultSelectionFromRecognition(recognition);
  }

  if (currentSelection.kind === 'channelMono' || currentSelection.kind === 'channelRgb') {
    const normalized = normalizeChannelSelection(channelNames, currentSelection, config, recognition);
    return normalized && findRecognizedCandidateForSelection(recognition, normalized)
      ? normalized
      : pickDefaultSelectionFromRecognition(recognition);
  }

  return findRecognizedCandidateForSelection(recognition, currentSelection)
    ? currentSelection
    : pickDefaultSelectionFromRecognition(recognition);
}

export { extractRgbChannelGroups, resolveAlphaChannelForChannel };

export function findSelectedRgbGroup(
  groups: RgbChannelGroup[],
  displayR: string,
  displayG: string,
  displayB: string
): RgbChannelGroup | null {
  return groups.find((group) => group.r === displayR && group.g === displayG && group.b === displayB) ?? null;
}

export function buildChannelDisplayOptions(
  channelNames: string[],
  config: ChannelDisplayOptionsConfig = {}
): ChannelDisplayOption[] {
  const includeRgbGroups = config.includeRgbGroups ?? true;
  const includeSplitChannels = config.includeSplitChannels ?? false;
  const includeAlphaCompanions = config.includeAlphaCompanions ?? !includeSplitChannels;
  const recognition = recognizeLayerChannels(channelNames, {
    includeAlphaCompanions,
    channelRecognitionSettings: config.channelRecognitionSettings,
    channelRecognitionNameRules: config.channelRecognitionNameRules
  });

  return recognition.candidates
    .filter((candidate) => {
      if (candidate.kind === 'componentGroup' || candidate.kind === 'normalMap') {
        return includeRgbGroups;
      }

      if (candidate.kind !== 'singleChannel') {
        return false;
      }

      return includeSplitChannels
        ? candidate.availability.split
        : candidate.availability.merged;
    })
    .filter(isChannelDisplayCandidate)
    .sort((a, b) => a.sourceOrder - b.sourceOrder)
    .map((candidate) => ({
      key: candidate.key,
      label: candidate.label,
      selection: candidate.selection,
      mapping: candidate.mapping
    }));
}

export function findSelectedChannelDisplayOption(
  options: ChannelDisplayOption[],
  selected: DisplaySelection | null
): ChannelDisplayOption | null {
  if (!selected || (selected.kind !== 'channelMono' && selected.kind !== 'channelRgb')) {
    return null;
  }

  return options.find((option) => sameDisplaySelection(option.selection, selected)) ?? null;
}

export function findMergedSelectionForSplitDisplay(
  channelNames: string[],
  selected: DisplaySelection | null,
  config: DisplaySelectionAvailabilityConfig = {}
): DisplaySelection | null {
  if (!selected) {
    return null;
  }

  const recognition = recognizeLayerChannels(channelNames, config);
  const splitCandidate = findRecognizedCandidateForSelection(recognition, selected, 'split');
  if (!splitCandidate?.mergedParentKey) {
    return null;
  }

  return recognition.candidates.find((candidate) => (
    candidate.availability.merged &&
    candidate.key === splitCandidate.mergedParentKey
  ))?.selection ?? null;
}

export function findSplitSelectionForMergedDisplay(
  channelNames: string[],
  selected: DisplaySelection | null,
  config: DisplaySelectionAvailabilityConfig = {}
): DisplaySelection | null {
  if (!selected) {
    return null;
  }

  const recognition = recognizeLayerChannels(channelNames, config);
  const mergedCandidate = findRecognizedCandidateForSelection(recognition, selected, 'merged');
  if (!mergedCandidate || mergedCandidate.splitChildren.length === 0) {
    return null;
  }

  const splitChildKeys = new Set(mergedCandidate.splitChildren);
  return recognition.candidates.find((candidate) => (
    candidate.availability.split &&
    splitChildKeys.has(candidate.key) &&
    candidate.mergedParentKey === mergedCandidate.key
  ))?.selection ?? null;
}

function normalizeChannelSelection(
  channelNames: string[],
  selection: ChannelSelection,
  config: DisplaySelectionAvailabilityConfig = {},
  recognition = recognizeLayerChannels(channelNames, config)
): ChannelSelection | null {
  if (selection.kind === 'channelMono') {
    if (!channelNames.includes(selection.channel)) {
      return null;
    }

    const recognized = recognition.candidates.find((candidate) => (
      candidate.kind === 'singleChannel' &&
      candidate.selection.kind === 'channelMono' &&
      candidate.selection.channel === selection.channel &&
      candidate.availability.merged
    ));
    return recognized?.kind === 'singleChannel'
      ? recognized.selection
      : buildChannelMonoSelection(channelNames, selection.channel);
  }

  const group = findSelectedComponentChannelGroup(
    extractComponentChannelGroups(channelNames, {
      channelRecognitionNameRules: config.channelRecognitionNameRules
    }),
    selection.r,
    selection.g,
    selection.b
  );
  const recognized = recognition.candidates.find((candidate) => (
    (candidate.kind === 'componentGroup' || candidate.kind === 'normalMap') &&
    candidate.selection.kind === 'channelRgb' &&
    candidate.selection.r === selection.r &&
    candidate.selection.g === selection.g &&
    candidate.selection.b === selection.b &&
    (candidate.selection.alpha ?? null) === (selection.alpha ?? null)
  ));
  if (recognized?.selection.kind === 'channelRgb') {
    return recognized.selection;
  }

  return group ? buildChannelRgbSelection(group) : null;
}

function pickDefaultSelectionFromRecognition(recognition: ChannelRecognitionResult): DisplaySelection | null {
  return pickDefaultRecognizedCandidate(recognition)?.selection ?? null;
}

function isChannelDisplayCandidate(
  candidate: RecognizedChannelCandidate
): candidate is ComponentGroupCandidate | NormalMapCandidate | SingleChannelCandidate {
  return candidate.selection.kind === 'channelMono' || candidate.selection.kind === 'channelRgb';
}
