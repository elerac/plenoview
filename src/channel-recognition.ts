import {
  buildRgbGroupLabel,
  getDisplaySelectionOptionLabel,
  isMuellerMatrixSelection,
  isSpectralRgbSelection,
  isStokesSelection,
  serializeDisplaySelectionKey,
  type ChannelMonoSelection,
  type ChannelRgbSelection,
  type DisplaySelection,
  type MuellerMatrixSelection,
  type SpectralRgbSelection,
  type StokesParameter,
  type StokesSelection
} from './display-model';
import {
  detectRgbStokesChannels,
  detectScalarStokesChannels,
  getStokesDisplayOptions,
  type RgbStokesChannels,
  type ScalarStokesChannels,
  type StokesDisplayOption,
  type StokesParameterVisibilitySettings
} from './stokes';
import { getRgbComponentChannels } from './stokes/stokes-display';
import {
  detectSpectralChannelsForSeries,
  detectSpectralStokesChannelGroups,
  getSpectralRgbDisplayOptions,
  hasCompleteSpectralStokesS3,
  isSpectralStokesSuffix,
  type SpectralChannel,
  type SpectralRgbDisplayOption
} from './spectral';
import {
  detectMuellerMatrixChannels,
  detectRgbMuellerMatrixChannels,
  getMuellerMatrixDisplayOptions,
  type MuellerMatrixChannels,
  type MuellerMatrixDisplayOption,
  type RgbMuellerMatrixChannels
} from './mueller';
import {
  normalizeChannelRecognitionSettings,
  type ChannelRecognitionSettingId,
  type ChannelRecognitionSettings
} from './channel-recognition-settings';
import {
  compileChannelRecognitionNameRules,
  parseAlphaChannelNameWithRules,
  parseComponentChannelNameWithRules,
  parseNormalMapChannelNameWithRules,
  type ChannelRecognitionNameRules,
  type CompiledChannelRecognitionNameRules
} from './channel-recognition-name-rules';
import type { DisplayChannelMapping } from './types';

export type ComponentChannelGroupKind = 'rgb' | 'xyz' | 'uv';

export interface RgbChannelGroup {
  key: string;
  label: string;
  r: string;
  g: string;
  b: string;
  a?: string;
}

export interface ComponentChannelGroup {
  kind: ComponentChannelGroupKind;
  optionKey: string;
  key: string;
  label: string;
  r: string;
  g: string;
  b: string | null;
  a?: string;
}

export interface NormalMapChannelGroup {
  kind: 'normalMap';
  optionKey: string;
  key: string;
  label: string;
  r: string;
  g: string;
  b: string;
  a?: string;
}

export interface ChannelRecognitionConfig {
  stokesParameterVisibility?: StokesParameterVisibilitySettings;
  spectralRgbGroupingEnabled?: boolean;
  includeAlphaCompanions?: boolean;
  channelRecognitionSettings?: ChannelRecognitionSettings;
  channelRecognitionNameRules?: ChannelRecognitionNameRules;
}

export interface ChannelRecognitionAvailability {
  available: boolean;
  merged: boolean;
  split: boolean;
  defaultEligible: boolean;
}

export interface ChannelRecognitionMetadata {
  componentKind?: ComponentChannelGroupKind;
  displayKind?: 'component' | 'spectral' | 'stokes' | 'mueller' | 'single';
  channelCount?: number;
  alpha?: string | null;
  suffix?: string | null;
  seriesKey?: string;
  seriesLabel?: string;
  parameter?: StokesParameter;
  component?: string | null;
  hasS3?: boolean;
  rgb?: boolean;
  hiddenInMergedChannelView?: boolean;
  synthetic?: boolean;
  defaultReason?: 'component' | 'rgbMueller' | 'spectral' | 'exactY' | 'grayscale' | 'mueller' | 'fallback';
}

interface BaseRecognizedChannelCandidate {
  kind: string;
  ruleId: string;
  key: string;
  label: string;
  channels: string[];
  selection: DisplaySelection;
  mapping: DisplayChannelMapping;
  priority: number;
  sourceOrder: number;
  splitChildren: string[];
  mergedParentKey: string | null;
  availability: ChannelRecognitionAvailability;
  metadata: ChannelRecognitionMetadata;
}

export interface ComponentGroupCandidate extends BaseRecognizedChannelCandidate {
  kind: 'componentGroup';
  ruleId: 'component.rgb' | 'component.xyz' | 'component.uv';
  selection: ChannelRgbSelection;
  metadata: ChannelRecognitionMetadata & {
    componentKind: ComponentChannelGroupKind;
    displayKind: 'component';
  };
}

export interface NormalMapCandidate extends BaseRecognizedChannelCandidate {
  kind: 'normalMap';
  ruleId: 'normal.map';
  selection: ChannelRgbSelection & { colorMapping: 'normalMap' };
  metadata: ChannelRecognitionMetadata & {
    componentKind: 'xyz';
    displayKind: 'component';
  };
}

export interface SpectralSeriesCandidate extends BaseRecognizedChannelCandidate {
  kind: 'spectralSeries';
  ruleId: 'spectral.series';
  selection: SpectralRgbSelection;
  metadata: ChannelRecognitionMetadata & {
    displayKind: 'spectral';
    seriesKey: string;
  };
}

export interface StokesVectorCandidate extends BaseRecognizedChannelCandidate {
  kind: 'stokesVector';
  ruleId: 'stokes.scalar' | 'stokes.rgb' | 'stokes.spectral';
  selection: StokesSelection;
  metadata: ChannelRecognitionMetadata & {
    displayKind: 'stokes';
    parameter: StokesParameter;
  };
}

export interface MuellerMatrixCandidate extends BaseRecognizedChannelCandidate {
  kind: 'muellerMatrix';
  ruleId: 'mueller.scalar' | 'mueller.rgb';
  selection: MuellerMatrixSelection;
  metadata: ChannelRecognitionMetadata & {
    displayKind: 'mueller';
    channelCount: number;
  };
}

export interface SingleChannelCandidate extends BaseRecognizedChannelCandidate {
  kind: 'singleChannel';
  ruleId: 'fallback.singleChannel';
  selection: ChannelMonoSelection;
  metadata: ChannelRecognitionMetadata & {
    displayKind: 'single';
  };
}

export type RecognizedChannelCandidate =
  | ComponentGroupCandidate
  | NormalMapCandidate
  | SpectralSeriesCandidate
  | StokesVectorCandidate
  | MuellerMatrixCandidate
  | SingleChannelCandidate;

export interface ChannelRecognitionResult {
  channelNames: string[];
  candidates: RecognizedChannelCandidate[];
}

interface ComponentRule {
  id: ComponentGroupCandidate['ruleId'];
  kind: ComponentChannelGroupKind;
  suffixes: readonly string[];
  optionKeyPrefix: string;
  priority: number;
}

interface ResolvedChannelRecognitionConfig {
  settings: ChannelRecognitionSettings;
  nameRules: CompiledChannelRecognitionNameRules;
}

type ComponentLikeChannelGroup = Pick<ComponentChannelGroup | NormalMapChannelGroup, 'kind' | 'optionKey' | 'r' | 'g' | 'b' | 'a'>;

interface AlphaChannelLookup {
  channelSet: ReadonlySet<string>;
  alphaByBase: ReadonlyMap<string, string>;
}

const RGB_COMPONENT_SOURCE_ORDER_BASE = 0;
const NORMAL_MAP_SOURCE_ORDER_BASE = 100_000;
const COMPONENT_SOURCE_ORDER_BASE = 200_000;
const SINGLE_SOURCE_ORDER_BASE = 500_000;
const SPECTRAL_SOURCE_ORDER_BASE = 1_000_000;
const STOKES_SOURCE_ORDER_BASE = 2_000_000;
const MUELLER_SOURCE_ORDER_BASE = 3_000_000;

const DEFAULT_PRIORITY_NORMAL_RGB = 10;
const DEFAULT_PRIORITY_RGB_MUELLER = 20;
const DEFAULT_PRIORITY_RGB_LIKE = 30;
const DEFAULT_PRIORITY_VECTOR = 40;
const DEFAULT_PRIORITY_SPECTRAL_RGB = 50;
const DEFAULT_PRIORITY_EXACT_Y = 55;
const DEFAULT_PRIORITY_GRAYSCALE = 60;
const DEFAULT_PRIORITY_MUELLER = 70;
const DEFAULT_PRIORITY_FALLBACK = 80;
const NON_DEFAULT_PRIORITY = Number.MAX_SAFE_INTEGER;

const COMPONENT_RULES: readonly ComponentRule[] = [
  {
    id: 'component.rgb',
    kind: 'rgb',
    suffixes: ['R', 'G', 'B'],
    optionKeyPrefix: 'group',
    priority: DEFAULT_PRIORITY_NORMAL_RGB
  },
  {
    id: 'component.xyz',
    kind: 'xyz',
    suffixes: ['X', 'Y', 'Z'],
    optionKeyPrefix: 'groupXYZ',
    priority: DEFAULT_PRIORITY_VECTOR
  },
  {
    id: 'component.uv',
    kind: 'uv',
    suffixes: ['U', 'V'],
    optionKeyPrefix: 'groupUV',
    priority: DEFAULT_PRIORITY_VECTOR
  }
];

const RGB_COMPONENTS = ['R', 'G', 'B'] as const;

export function recognizeLayerChannels(
  channelNames: string[],
  config: ChannelRecognitionConfig = {}
): ChannelRecognitionResult {
  const names = [...channelNames];
  const resolved = resolveChannelRecognitionConfig(config);
  const { settings, nameRules } = resolved;
  const includeAlphaCompanions = settings['fallback.alphaCompanions'];
  const alphaLookup = buildAlphaChannelLookup(names, nameRules);
  const normalMapGroups = extractEnabledNormalMapChannelGroups(
    names,
    settings,
    includeAlphaCompanions,
    nameRules,
    alphaLookup
  );
  const componentGroups = excludeNormalMapComponentDuplicates(
    extractEnabledComponentChannelGroups(names, settings, nameRules),
    normalMapGroups
  );
  const groupedDisplays = [...normalMapGroups, ...componentGroups];
  const spectralRecognition = buildSpectralSeriesCandidates(names, settings, nameRules);
  const splitSingleCandidates = buildSplitSingleChannelCandidates(
    names,
    groupedDisplays,
    spectralRecognition.parentKeyByChannel,
    includeAlphaCompanions,
    nameRules,
    alphaLookup
  );
  const mergedSingleCandidates = buildMergedSingleChannelCandidates(
    names,
    groupedDisplays,
    spectralRecognition.parentKeyByChannel,
    includeAlphaCompanions,
    nameRules,
    alphaLookup
  );

  return {
    channelNames: names,
    candidates: [
      ...normalMapGroups.map(buildNormalMapCandidate),
      ...componentGroups.map(buildComponentGroupCandidate),
      ...mergedSingleCandidates,
      ...splitSingleCandidates,
      ...spectralRecognition.candidates,
      ...buildStokesCandidates(names, config, resolved),
      ...buildMuellerCandidates(names, resolved)
    ]
  };
}

export function extractRgbChannelGroups(
  channelNames: string[],
  config: Pick<ChannelRecognitionConfig, 'channelRecognitionNameRules'> = {}
): RgbChannelGroup[] {
  return extractComponentChannelGroups(channelNames, config)
    .filter((group) => group.kind === 'rgb')
    .map((group) => ({
      key: group.key,
      label: group.label,
      r: group.r,
      g: group.g,
      b: group.b ?? '',
      a: group.a
    }));
}

export function extractComponentChannelGroups(
  channelNames: string[],
  config: Pick<ChannelRecognitionConfig, 'channelRecognitionNameRules'> = {}
): ComponentChannelGroup[] {
  const nameRules = compileChannelRecognitionNameRules(config.channelRecognitionNameRules);
  return COMPONENT_RULES.flatMap((rule) => extractComponentChannelGroupsForRule(channelNames, rule, nameRules));
}

function extractEnabledComponentChannelGroups(
  channelNames: string[],
  settings: ChannelRecognitionSettings,
  nameRules: CompiledChannelRecognitionNameRules
): ComponentChannelGroup[] {
  return COMPONENT_RULES
    .filter((rule) => isRecognitionSettingEnabled(settings, rule.id))
    .flatMap((rule) => extractComponentChannelGroupsForRule(channelNames, rule, nameRules));
}

function extractEnabledNormalMapChannelGroups(
  channelNames: string[],
  settings: ChannelRecognitionSettings,
  includeAlphaCompanions: boolean,
  nameRules: CompiledChannelRecognitionNameRules,
  alphaLookup: AlphaChannelLookup
): NormalMapChannelGroup[] {
  if (!isRecognitionSettingEnabled(settings, 'normal.map')) {
    return [];
  }

  const grouped = new Map<string, Partial<Record<'X' | 'Y' | 'Z', string>>>();
  for (const channelName of channelNames) {
    const parsed = parseNormalMapChannelNameWithRules(channelName, nameRules);
    if (!parsed) {
      continue;
    }

    const group = grouped.get(parsed.base) ?? {};
    const component = parsed.component.toUpperCase() as 'X' | 'Y' | 'Z';
    if (!group[component]) {
      group[component] = channelName;
      grouped.set(parsed.base, group);
    }
  }

  const groups: NormalMapChannelGroup[] = [];
  for (const [base, channels] of grouped.entries()) {
    if (!channels.X || !channels.Y || !channels.Z) {
      continue;
    }

    const alpha = includeAlphaCompanions
      ? findAlphaChannelForBase(channelNames, base, nameRules, alphaLookup) ?? undefined
      : undefined;
    groups.push({
      kind: 'normalMap',
      optionKey: `normalMap:${base}`,
      key: base,
      label: base ? `${base} Normal Map` : 'Normal Map',
      r: channels.X,
      g: channels.Y,
      b: channels.Z,
      ...(alpha ? { a: alpha } : {})
    });
  }

  groups.sort(compareComponentChannelGroups);
  return groups;
}

function excludeNormalMapComponentDuplicates(
  componentGroups: ComponentChannelGroup[],
  normalMapGroups: readonly NormalMapChannelGroup[]
): ComponentChannelGroup[] {
  if (normalMapGroups.length === 0) {
    return componentGroups;
  }

  const normalMapChannelTriples = new Set(normalMapGroups.map((group) => getChannelTripleKey(group)));
  return componentGroups.filter((group) => (
    group.kind !== 'xyz' || !normalMapChannelTriples.has(getChannelTripleKey(group))
  ));
}

export function findSelectedComponentChannelGroup(
  groups: readonly ComponentChannelGroup[],
  displayR: string,
  displayG: string,
  displayB: string | null
): ComponentChannelGroup | null {
  return groups.find((group) => group.r === displayR && group.g === displayG && group.b === displayB) ?? null;
}

export function buildChannelRgbSelection(group: Pick<ComponentChannelGroup, 'r' | 'g' | 'b' | 'a'>): ChannelRgbSelection {
  return {
    kind: 'channelRgb',
    r: group.r,
    g: group.g,
    b: group.b,
    alpha: group.a ?? null
  };
}

export function buildChannelMonoSelection(
  channelNames: readonly string[],
  channelName: string,
  config: Pick<ChannelRecognitionConfig, 'channelRecognitionNameRules'> = {}
): ChannelMonoSelection {
  return {
    kind: 'channelMono',
    channel: channelName,
    alpha: resolveAlphaChannelForChannel(channelNames, channelName, config)
  };
}

export function resolveAlphaChannelForChannel(
  channelNames: readonly string[],
  channelName: string,
  config: Pick<ChannelRecognitionConfig, 'channelRecognitionNameRules'> = {}
): string | null {
  const nameRules = compileChannelRecognitionNameRules(config.channelRecognitionNameRules);
  return resolveAlphaChannelForChannelWithRules(
    channelNames,
    channelName,
    nameRules,
    buildAlphaChannelLookup(channelNames, nameRules)
  );
}

function resolveAlphaChannelForChannelWithRules(
  channelNames: readonly string[],
  channelName: string,
  nameRules: CompiledChannelRecognitionNameRules,
  alphaLookup = buildAlphaChannelLookup(channelNames, nameRules)
): string | null {
  if (isAlphaChannelWithRules(channelName, nameRules)) {
    return null;
  }

  const parsed = parseComponentChannelNameWithRules(channelName, 'rgb', nameRules);
  if (parsed?.base) {
    const alphaChannel = findAlphaChannelForBase(channelNames, parsed.base, nameRules, alphaLookup);
    return alphaChannel && alphaLookup.channelSet.has(alphaChannel) ? alphaChannel : null;
  }

  if (channelName.includes('.')) {
    const dotIndex = channelName.lastIndexOf('.');
    const alphaChannel = findAlphaChannelForBase(channelNames, channelName.slice(0, dotIndex), nameRules, alphaLookup);
    return alphaChannel && alphaLookup.channelSet.has(alphaChannel) ? alphaChannel : null;
  }

  const alphaChannel = findAlphaChannelForBase(channelNames, '', nameRules, alphaLookup);
  return alphaChannel && alphaLookup.channelSet.has(alphaChannel) ? alphaChannel : null;
}

export function pickDefaultRecognizedCandidate(
  result: ChannelRecognitionResult
): RecognizedChannelCandidate | null {
  return result.candidates
    .filter((candidate) => candidate.availability.defaultEligible)
    .sort((a, b) => a.priority - b.priority || a.sourceOrder - b.sourceOrder || a.key.localeCompare(b.key))[0] ?? null;
}

export function findRecognizedCandidateForSelection(
  result: ChannelRecognitionResult,
  selection: DisplaySelection | null,
  presentation?: 'merged' | 'split'
): RecognizedChannelCandidate | null {
  if (!selection) {
    return null;
  }

  const selectionKey = serializeDisplaySelectionKey(selection);
  return result.candidates.find((candidate) => (
    serializeDisplaySelectionKey(candidate.selection) === selectionKey &&
    (presentation === undefined || candidate.availability[presentation])
  )) ?? null;
}

function extractComponentChannelGroupsForRule(
  channelNames: string[],
  rule: ComponentRule,
  nameRules: CompiledChannelRecognitionNameRules
): ComponentChannelGroup[] {
  const grouped = new Map<string, Partial<Record<string, string>>>();

  for (const channelName of channelNames) {
    const parsed = parseComponentChannelNameWithRules(channelName, rule.kind, nameRules);
    if (!parsed) {
      continue;
    }

    const group = grouped.get(parsed.base) ?? {};
    const suffix = getComponentRuleSuffixForSlot(parsed.slot);
    if (!group[suffix]) {
      group[suffix] = channelName;
      grouped.set(parsed.base, group);
    }
  }

  const groups: ComponentChannelGroup[] = [];
  for (const [base, channels] of grouped.entries()) {
    const r = channels[rule.suffixes[0]!];
    const g = channels[rule.suffixes[1]!];
    const bSuffix = rule.suffixes[2] ?? null;
    const b = bSuffix ? channels[bSuffix] ?? null : null;
    if (!r || !g || (bSuffix && !b)) {
      continue;
    }

    groups.push({
      kind: rule.kind,
      optionKey: `${rule.optionKeyPrefix}:${base}`,
      key: base,
      label: rule.kind === 'rgb'
        ? buildRgbGroupLabel(base, Boolean(channels.A))
        : buildComponentGroupLabel(base, rule.suffixes, Boolean(channels.A)),
      r,
      g,
      b,
      a: channels.A
    });
  }

  groups.sort(compareComponentChannelGroups);
  return groups;
}

function buildComponentGroupCandidate(
  group: ComponentChannelGroup,
  groupIndex: number
): ComponentGroupCandidate {
  const ruleId = getComponentRuleId(group.kind);
  const channels = [group.r, group.g, ...(group.b ? [group.b] : []), ...(group.a ? [group.a] : [])];
  const selection = buildChannelRgbSelection(group);
  const priority = getComponentGroupPriority(group);

  return {
    kind: 'componentGroup',
    ruleId,
    key: group.optionKey,
    label: group.label,
    channels,
    selection,
    mapping: {
      displayR: group.r,
      displayG: group.g,
      displayB: group.b,
      displayA: group.a ?? null
    },
    priority,
    sourceOrder: getComponentLikeSourceOrderBase(group) + groupIndex * 100,
    splitChildren: channels.map((channelName) => `channel:${channelName}`),
    mergedParentKey: null,
    availability: {
      available: true,
      merged: true,
      split: false,
      defaultEligible: true
    },
    metadata: {
      componentKind: group.kind,
      displayKind: 'component',
      alpha: group.a ?? null,
      channelCount: channels.length,
      defaultReason: 'component'
    }
  };
}

function buildNormalMapCandidate(
  group: NormalMapChannelGroup,
  groupIndex: number
): NormalMapCandidate {
  const channels = [group.r, group.g, group.b, ...(group.a ? [group.a] : [])];
  const selection = {
    ...buildChannelRgbSelection(group),
    colorMapping: 'normalMap' as const
  };

  return {
    kind: 'normalMap',
    ruleId: 'normal.map',
    key: group.optionKey,
    label: group.label,
    channels,
    selection,
    mapping: {
      displayR: group.r,
      displayG: group.g,
      displayB: group.b,
      displayA: group.a ?? null
    },
    priority: DEFAULT_PRIORITY_VECTOR,
    sourceOrder: NORMAL_MAP_SOURCE_ORDER_BASE + groupIndex * 100,
    splitChildren: channels.map((channelName) => `channel:${channelName}`),
    mergedParentKey: null,
    availability: {
      available: true,
      merged: true,
      split: false,
      defaultEligible: true
    },
    metadata: {
      componentKind: 'xyz',
      displayKind: 'component',
      alpha: group.a ?? null,
      channelCount: channels.length,
      defaultReason: 'component'
    }
  };
}

function buildMergedSingleChannelCandidates(
  channelNames: string[],
  componentGroups: readonly ComponentLikeChannelGroup[],
  spectralParentKeyByChannel: ReadonlyMap<string, string>,
  includeAlphaCompanions: boolean,
  nameRules: CompiledChannelRecognitionNameRules,
  alphaLookup: AlphaChannelLookup
): SingleChannelCandidate[] {
  const groupedComponentChannels = new Set<string>();
  const consumedAlphaChannels = new Set<string>();
  const singleChannelOptions = new Set<string>();

  for (const group of componentGroups) {
    groupedComponentChannels.add(group.r);
    groupedComponentChannels.add(group.g);
    if (group.b) {
      groupedComponentChannels.add(group.b);
    }
    if (group.a) {
      groupedComponentChannels.add(group.a);
      consumedAlphaChannels.add(group.a);
    }
  }

  if (includeAlphaCompanions) {
    for (const channelName of channelNames) {
      if (groupedComponentChannels.has(channelName) || isAlphaChannelWithRules(channelName, nameRules)) {
        continue;
      }

      const alphaChannel = resolveAlphaChannelForChannelWithRules(channelNames, channelName, nameRules, alphaLookup);
      if (alphaChannel) {
        consumedAlphaChannels.add(alphaChannel);
      }
    }
  }

  const grayscaleChannel = pickGrayscaleDisplayChannel(channelNames, nameRules);
  const fallbackChannel = pickFallbackDisplayChannel(channelNames, nameRules);
  const candidates: SingleChannelCandidate[] = [];
  for (const channelName of orderSingleChannelNames(channelNames)) {
    if (groupedComponentChannels.has(channelName) || consumedAlphaChannels.has(channelName)) {
      continue;
    }

    const selection: ChannelMonoSelection = {
      kind: 'channelMono',
      channel: channelName,
      alpha: includeAlphaCompanions
        ? resolveAlphaChannelForChannelWithRules(channelNames, channelName, nameRules, alphaLookup)
        : null
    };
    if (selection.alpha) {
      consumedAlphaChannels.add(selection.alpha);
    }
    if (isAlphaChannelWithRules(channelName, nameRules) && consumedAlphaChannels.has(channelName)) {
      continue;
    }
    if (singleChannelOptions.has(channelName)) {
      continue;
    }

    singleChannelOptions.add(channelName);
    candidates.push(buildSingleChannelCandidate({
      channelName,
      selection,
      sourceOrder: SINGLE_SOURCE_ORDER_BASE + candidates.length,
      merged: true,
      split: false,
      mergedParentKey: null,
      splitChildren: buildSingleChannelSplitChildren(selection),
      hiddenInMergedChannelView: spectralParentKeyByChannel.has(channelName),
      priority: getSingleChannelDefaultPriority(channelName, grayscaleChannel, fallbackChannel),
      defaultEligible: true
    }));
  }

  return candidates;
}

function buildSplitSingleChannelCandidates(
  channelNames: string[],
  componentGroups: readonly ComponentLikeChannelGroup[],
  spectralParentKeyByChannel: ReadonlyMap<string, string>,
  includeAlphaCompanions: boolean,
  nameRules: CompiledChannelRecognitionNameRules,
  alphaLookup: AlphaChannelLookup
): SingleChannelCandidate[] {
  const candidates: SingleChannelCandidate[] = [];
  const singleChannelOptions = new Set<string>();
  const parentKeyByGroupedChannel = new Map<string, string>();

  const pushSplitCandidate = (channelName: string, mergedParentKey: string | null, sourceOrder: number): void => {
    if (singleChannelOptions.has(channelName)) {
      return;
    }

    singleChannelOptions.add(channelName);
    candidates.push(buildSingleChannelCandidate({
      channelName,
      selection: {
        kind: 'channelMono',
        channel: channelName,
        alpha: null
      },
      sourceOrder,
      merged: false,
      split: true,
      mergedParentKey,
      splitChildren: [],
      hiddenInMergedChannelView: false,
      priority: NON_DEFAULT_PRIORITY,
      defaultEligible: false
    }));
  };

  componentGroups.forEach((group, groupIndex) => {
    const channels = [group.r, group.g, ...(group.b ? [group.b] : []), ...(group.a ? [group.a] : [])];
    channels.forEach((channelName, channelIndex) => {
      parentKeyByGroupedChannel.set(channelName, group.optionKey);
      pushSplitCandidate(
        channelName,
        group.optionKey,
        getComponentLikeSourceOrderBase(group) + groupIndex * 100 + channelIndex + 1
      );
    });
  });

  orderSingleChannelNames(channelNames).forEach((channelName, index) => {
    if (singleChannelOptions.has(channelName)) {
      return;
    }

    const alphaParentKey = includeAlphaCompanions && resolveAlphaChannelForChannelWithRules(
      channelNames,
      channelName,
      nameRules,
      alphaLookup
    )
      ? `channel:${channelName}`
      : null;
    const mergedParentKey = parentKeyByGroupedChannel.get(channelName)
      ?? spectralParentKeyByChannel.get(channelName)
      ?? alphaParentKey;
    pushSplitCandidate(channelName, mergedParentKey, SINGLE_SOURCE_ORDER_BASE + index);
  });

  return candidates;
}

function buildSingleChannelCandidate(args: {
  channelName: string;
  selection: ChannelMonoSelection;
  sourceOrder: number;
  merged: boolean;
  split: boolean;
  mergedParentKey: string | null;
  splitChildren: string[];
  hiddenInMergedChannelView: boolean;
  priority: number;
  defaultEligible: boolean;
}): SingleChannelCandidate {
  const channels = [args.channelName, ...(args.selection.alpha ? [args.selection.alpha] : [])];
  return {
    kind: 'singleChannel',
    ruleId: 'fallback.singleChannel',
    key: `channel:${args.channelName}`,
    label: args.selection.alpha ? `${args.channelName},${args.selection.alpha}` : args.channelName,
    channels,
    selection: args.selection,
    mapping: {
      displayR: args.channelName,
      displayG: args.channelName,
      displayB: args.channelName,
      displayA: args.selection.alpha
    },
    priority: args.priority,
    sourceOrder: args.sourceOrder,
    splitChildren: args.splitChildren,
    mergedParentKey: args.mergedParentKey,
    availability: {
      available: true,
      merged: args.merged,
      split: args.split,
      defaultEligible: args.defaultEligible
    },
    metadata: {
      displayKind: 'single',
      alpha: args.selection.alpha,
      channelCount: channels.length,
      hiddenInMergedChannelView: args.hiddenInMergedChannelView,
      defaultReason: args.defaultEligible
        ? getSingleChannelDefaultReason(args.priority)
        : undefined
    }
  };
}

function buildSpectralSeriesCandidates(
  channelNames: string[],
  settings: ChannelRecognitionSettings,
  nameRules: CompiledChannelRecognitionNameRules
): { candidates: SpectralSeriesCandidate[]; parentKeyByChannel: Map<string, string> } {
  const parentKeyByChannel = new Map<string, string>();
  if (!settings['spectral.series']) {
    return { candidates: [], parentKeyByChannel };
  }

  const options = getSpectralRgbDisplayOptions(channelNames, {
    compiledChannelRecognitionNameRules: nameRules
  });
  const candidates = options.map((option, index) => {
    const channels = detectSpectralChannelsForSeries(channelNames, option.selection.seriesKey, {
      compiledChannelRecognitionNameRules: nameRules
    });
    const splitChildren = channels.map((channel) => {
      const childKey = `channel:${channel.channelName}`;
      parentKeyByChannel.set(channel.channelName, option.key);
      return childKey;
    });
    return buildSpectralSeriesCandidate(option, channels, splitChildren, SPECTRAL_SOURCE_ORDER_BASE + index);
  });

  return { candidates, parentKeyByChannel };
}

function buildSpectralSeriesCandidate(
  option: SpectralRgbDisplayOption,
  channels: readonly SpectralChannel[],
  splitChildren: string[],
  sourceOrder: number
): SpectralSeriesCandidate {
  return {
    kind: 'spectralSeries',
    ruleId: 'spectral.series',
    key: option.key,
    label: option.label,
    channels: channels.map((channel) => channel.channelName),
    selection: option.selection,
    mapping: cloneMapping(option.mapping),
    priority: DEFAULT_PRIORITY_SPECTRAL_RGB,
    sourceOrder,
    splitChildren,
    mergedParentKey: null,
    availability: {
      available: true,
      merged: true,
      split: false,
      defaultEligible: true
    },
    metadata: {
      displayKind: 'spectral',
      seriesKey: option.selection.seriesKey,
      seriesLabel: channels[0]?.seriesLabel ?? option.selection.seriesKey,
      channelCount: channels.length,
      synthetic: true,
      defaultReason: 'spectral'
    }
  };
}

function buildStokesCandidates(
  channelNames: string[],
  config: ChannelRecognitionConfig,
  resolved: ResolvedChannelRecognitionConfig
): StokesVectorCandidate[] {
  const { settings, nameRules } = resolved;
  const spectralRgbGroupingEnabled = settings['stokes.spectral'];
  const mergedOptions = getStokesDisplayOptions(channelNames, {
    includeRgbGroups: true,
    includeSplitChannels: false,
    parameterVisibility: config.stokesParameterVisibility,
    spectralRgbGroupingEnabled,
    compiledChannelRecognitionNameRules: nameRules
  });
  const splitOptions = getStokesDisplayOptions(channelNames, {
    includeRgbGroups: false,
    includeSplitChannels: true,
    parameterVisibility: config.stokesParameterVisibility,
    spectralRgbGroupingEnabled,
    compiledChannelRecognitionNameRules: nameRules
  });

  return [
    ...mergedOptions.map((option, index) => buildStokesCandidate(
      channelNames,
      option,
      STOKES_SOURCE_ORDER_BASE + index,
      true,
      false,
      nameRules
    )),
    ...splitOptions.map((option, index) => buildStokesCandidate(
      channelNames,
      option,
      STOKES_SOURCE_ORDER_BASE + index,
      false,
      true,
      nameRules
    ))
  ].filter((candidate) => isStokesCandidateEnabled(candidate, settings));
}

function buildStokesCandidate(
  channelNames: string[],
  option: StokesDisplayOption,
  sourceOrder: number,
  merged: boolean,
  split: boolean,
  nameRules: CompiledChannelRecognitionNameRules
): StokesVectorCandidate {
  const stokesInfo = resolveStokesCandidateInfo(channelNames, option.selection, nameRules);
  const parentKey = split ? resolveStokesMergedParentKey(option.key, option.selection) : null;
  const splitChildren = merged ? resolveStokesSplitChildren(channelNames, option.key, option.selection, nameRules) : [];

  return {
    kind: 'stokesVector',
    ruleId: getStokesRuleId(option.selection, channelNames, nameRules),
    key: option.key,
    label: option.label,
    channels: stokesInfo.channels,
    selection: option.selection,
    mapping: cloneMapping(option.mapping),
    priority: NON_DEFAULT_PRIORITY,
    sourceOrder,
    splitChildren,
    mergedParentKey: parentKey,
    availability: {
      available: true,
      merged,
      split,
      defaultEligible: false
    },
    metadata: {
      displayKind: 'stokes',
      parameter: option.selection.parameter,
      component: option.component,
      suffix: option.selection.source.kind === 'scalar' ? option.selection.source.suffix ?? null : null,
      hasS3: stokesInfo.hasS3,
      channelCount: getDisplayMappingChannelCount(option.mapping),
      synthetic: option.selection.source.kind === 'spectralRgb'
    }
  };
}

function buildMuellerCandidates(
  channelNames: string[],
  resolved: ResolvedChannelRecognitionConfig
): MuellerMatrixCandidate[] {
  const { settings, nameRules } = resolved;
  const mergedOptions = getMuellerMatrixDisplayOptions(channelNames, {
    includeRgbGroups: true,
    includeSplitChannels: false,
    compiledChannelRecognitionNameRules: nameRules
  });
  const splitOptions = getMuellerMatrixDisplayOptions(channelNames, {
    includeRgbGroups: false,
    includeSplitChannels: true,
    compiledChannelRecognitionNameRules: nameRules
  });

  return [
    ...mergedOptions.map((option, index) => buildMuellerCandidate(
      channelNames,
      option,
      MUELLER_SOURCE_ORDER_BASE + index,
      true,
      false,
      nameRules
    )),
    ...splitOptions.map((option, index) => buildMuellerCandidate(
      channelNames,
      option,
      MUELLER_SOURCE_ORDER_BASE + index,
      false,
      true,
      nameRules
    ))
  ].filter((candidate) => isRecognitionSettingEnabled(settings, candidate.ruleId));
}

function buildMuellerCandidate(
  channelNames: string[],
  option: MuellerMatrixDisplayOption,
  sourceOrder: number,
  merged: boolean,
  split: boolean,
  nameRules: CompiledChannelRecognitionNameRules
): MuellerMatrixCandidate {
  const channels = resolveMuellerCandidateChannels(channelNames, option.selection, nameRules);
  const isRgb = Boolean(option.selection.rgb);

  return {
    kind: 'muellerMatrix',
    ruleId: isRgb ? 'mueller.rgb' : 'mueller.scalar',
    key: option.key,
    label: option.label,
    channels,
    selection: option.selection,
    mapping: cloneMapping(option.mapping),
    priority: isRgb ? DEFAULT_PRIORITY_RGB_MUELLER : DEFAULT_PRIORITY_MUELLER,
    sourceOrder,
    splitChildren: isRgb && merged
      ? RGB_COMPONENTS.map((component) => `muellerMatrix:${component}`)
      : [],
    mergedParentKey: split && isMuellerMatrixRgbComponentSuffix(option.selection.suffix)
      ? 'muellerMatrixRgb:'
      : null,
    availability: {
      available: true,
      merged,
      split,
      defaultEligible: true
    },
    metadata: {
      displayKind: 'mueller',
      suffix: option.selection.suffix ?? null,
      rgb: isRgb,
      channelCount: option.channelCount,
      synthetic: true,
      defaultReason: isRgb ? 'rgbMueller' : 'mueller'
    }
  };
}

function resolveStokesCandidateInfo(
  channelNames: string[],
  selection: StokesSelection,
  nameRules: CompiledChannelRecognitionNameRules
): { channels: string[]; hasS3: boolean } {
  if (selection.source.kind === 'scalar') {
    const channels = detectScalarStokesChannels(channelNames, selection.source.suffix ?? null, {
      compiledChannelRecognitionNameRules: nameRules
    });
    return {
      channels: channels ? collectScalarStokesChannels(channels) : [],
      hasS3: Boolean(channels?.s3)
    };
  }

  if (selection.source.kind === 'rgbComponent') {
    const rgbChannels = detectRgbStokesChannels(channelNames, {
      compiledChannelRecognitionNameRules: nameRules
    });
    if (!rgbChannels) {
      return { channels: [], hasS3: false };
    }
    const channels = getRgbComponentChannels(rgbChannels, selection.source.component);
    return {
      channels: collectScalarStokesChannels(channels),
      hasS3: Boolean(channels.s3)
    };
  }

  if (selection.source.kind === 'rgbLuminance') {
    const channels = detectRgbStokesChannels(channelNames, {
      compiledChannelRecognitionNameRules: nameRules
    });
    return {
      channels: channels ? collectRgbStokesChannels(channels) : [],
      hasS3: Boolean(channels && channels.r.s3 && channels.g.s3 && channels.b.s3)
    };
  }

  return {
    channels: detectSpectralStokesChannelGroups(channelNames, {
      compiledChannelRecognitionNameRules: nameRules
    })
      .flatMap((group) => [group.s0, group.s1, group.s2, ...(group.s3 ? [group.s3] : [])]),
    hasS3: hasCompleteSpectralStokesS3(channelNames, {
      compiledChannelRecognitionNameRules: nameRules
    })
  };
}

function resolveStokesSplitChildren(
  channelNames: string[],
  key: string,
  selection: StokesSelection,
  nameRules: CompiledChannelRecognitionNameRules
): string[] {
  if (selection.source.kind === 'rgbLuminance') {
    return RGB_COMPONENTS.map((component) => `stokesRgb:${selection.parameter}:${component}`);
  }

  if (selection.source.kind === 'spectralRgb') {
    return detectSpectralStokesChannelGroups(channelNames, {
      compiledChannelRecognitionNameRules: nameRules
    })
      .map((group) => `stokesScalar:${selection.parameter}:${group.suffix}`);
  }

  if (selection.source.kind === 'scalar' && selection.source.suffix) {
    return [`${key}`];
  }

  return [];
}

function resolveStokesMergedParentKey(key: string, selection: StokesSelection): string | null {
  if (selection.source.kind === 'rgbComponent') {
    return `stokesRgb:${selection.parameter}:group`;
  }

  if (
    selection.source.kind === 'scalar' &&
    selection.source.suffix &&
    isSpectralStokesSuffix(selection.source.suffix)
  ) {
    return `stokesSpectralRgb:${selection.parameter}:group`;
  }

  if (key.endsWith(':R') || key.endsWith(':G') || key.endsWith(':B')) {
    return `stokesRgb:${selection.parameter}:group`;
  }

  return null;
}

function resolveMuellerCandidateChannels(
  channelNames: string[],
  selection: MuellerMatrixSelection,
  nameRules: CompiledChannelRecognitionNameRules
): string[] {
  if (selection.rgb) {
    const channels = detectRgbMuellerMatrixChannels(channelNames, {
      compiledChannelRecognitionNameRules: nameRules
    });
    return channels ? collectRgbMuellerChannels(channels) : [];
  }

  const channels = detectMuellerMatrixChannels(channelNames, selection.suffix ?? null, {
    compiledChannelRecognitionNameRules: nameRules
  });
  return channels ? collectMuellerChannels(channels) : [];
}

function collectScalarStokesChannels(channels: ScalarStokesChannels): string[] {
  return [channels.s0, channels.s1, channels.s2, ...(channels.s3 ? [channels.s3] : [])];
}

function collectRgbStokesChannels(channels: RgbStokesChannels): string[] {
  return [
    ...collectScalarStokesChannels(channels.r),
    ...collectScalarStokesChannels(channels.g),
    ...collectScalarStokesChannels(channels.b)
  ];
}

function collectMuellerChannels(channels: MuellerMatrixChannels): string[] {
  return Object.values(channels.elements);
}

function collectRgbMuellerChannels(channels: RgbMuellerMatrixChannels): string[] {
  return [
    ...collectMuellerChannels(channels.r),
    ...collectMuellerChannels(channels.g),
    ...collectMuellerChannels(channels.b)
  ];
}

function getComponentGroupPriority(group: ComponentChannelGroup): number {
  if (group.kind === 'rgb') {
    return isMuellerMatrixElementName(group.key)
      ? DEFAULT_PRIORITY_RGB_LIKE
      : DEFAULT_PRIORITY_NORMAL_RGB;
  }

  return DEFAULT_PRIORITY_VECTOR;
}

function getComponentLikeSourceOrderBase(group: Pick<ComponentChannelGroup | NormalMapChannelGroup, 'kind'>): number {
  if (group.kind === 'rgb') {
    return RGB_COMPONENT_SOURCE_ORDER_BASE;
  }

  if (group.kind === 'normalMap') {
    return NORMAL_MAP_SOURCE_ORDER_BASE;
  }

  return COMPONENT_SOURCE_ORDER_BASE;
}

function getSingleChannelDefaultPriority(
  channelName: string,
  grayscaleChannel: string | null,
  fallbackChannel: string | null
): number {
  if (isExactYChannel(channelName)) {
    return DEFAULT_PRIORITY_EXACT_Y;
  }

  if (channelName === grayscaleChannel) {
    return DEFAULT_PRIORITY_GRAYSCALE;
  }

  return channelName === fallbackChannel
    ? DEFAULT_PRIORITY_FALLBACK
    : DEFAULT_PRIORITY_FALLBACK;
}

function getSingleChannelDefaultReason(priority: number): ChannelRecognitionMetadata['defaultReason'] {
  if (priority === DEFAULT_PRIORITY_EXACT_Y) {
    return 'exactY';
  }

  if (priority === DEFAULT_PRIORITY_GRAYSCALE) {
    return 'grayscale';
  }

  return 'fallback';
}

function orderSingleChannelNames(channelNames: readonly string[]): string[] {
  if (!channelNames.some(isExactYChannel)) {
    return [...channelNames];
  }

  return [
    ...channelNames.filter(isExactYChannel),
    ...channelNames.filter((channelName) => !isExactYChannel(channelName))
  ];
}

function isExactYChannel(channelName: string): boolean {
  return channelName === 'Y';
}

function buildSingleChannelSplitChildren(selection: ChannelMonoSelection): string[] {
  return selection.alpha ? [`channel:${selection.channel}`] : [];
}

function getComponentRuleId(kind: ComponentChannelGroupKind): ComponentGroupCandidate['ruleId'] {
  switch (kind) {
    case 'rgb':
      return 'component.rgb';
    case 'xyz':
      return 'component.xyz';
    case 'uv':
      return 'component.uv';
  }
}

function getStokesRuleId(
  selection: StokesSelection,
  channelNames: readonly string[],
  nameRules: CompiledChannelRecognitionNameRules
): StokesVectorCandidate['ruleId'] {
  switch (selection.source.kind) {
    case 'rgbLuminance':
    case 'rgbComponent':
      return 'stokes.rgb';
    case 'spectralRgb':
      return 'stokes.spectral';
    case 'scalar': {
      const suffix = selection.source.suffix;
      if (suffix && (
        isSpectralStokesSuffix(suffix) ||
        detectSpectralStokesChannelGroups([...channelNames], { compiledChannelRecognitionNameRules: nameRules })
          .some((group) => group.suffix === suffix)
      )) {
        return 'stokes.spectral';
      }
      return 'stokes.scalar';
    }
  }
}

function pickGrayscaleDisplayChannel(
  channelNames: readonly string[],
  nameRules: CompiledChannelRecognitionNameRules
): string | null {
  if (channelNames.length === 1) {
    return channelNames[0] ?? null;
  }

  const nonAlphaChannels = channelNames.filter((channelName) => !isAlphaChannelWithRules(channelName, nameRules));
  return nonAlphaChannels.length === 1 ? nonAlphaChannels[0] ?? null : null;
}

function pickFallbackDisplayChannel(
  channelNames: readonly string[],
  nameRules: CompiledChannelRecognitionNameRules
): string | null {
  return channelNames.find((channelName) => !isAlphaChannelWithRules(channelName, nameRules)) ?? channelNames[0] ?? null;
}

function getDisplayMappingChannelCount(mapping: DisplayChannelMapping): number {
  return new Set([
    mapping.displayR,
    mapping.displayG,
    mapping.displayB,
    ...(mapping.displayA ? [mapping.displayA] : [])
  ].filter((channelName): channelName is string => channelName !== null)).size;
}

function cloneMapping(mapping: DisplayChannelMapping): DisplayChannelMapping {
  return {
    displayR: mapping.displayR,
    displayG: mapping.displayG,
    displayB: mapping.displayB,
    displayA: mapping.displayA ?? null
  };
}

function getChannelTripleKey(group: Pick<ComponentChannelGroup | NormalMapChannelGroup, 'r' | 'g' | 'b'>): string {
  return `${group.r}\u0000${group.g}\u0000${group.b ?? ''}`;
}

function compareComponentChannelGroups(
  a: Pick<ComponentChannelGroup, 'key'>,
  b: Pick<ComponentChannelGroup, 'key'>
): number {
  if (a.key.length === 0) {
    return -1;
  }
  if (b.key.length === 0) {
    return 1;
  }
  return a.key.localeCompare(b.key);
}

function buildComponentGroupLabel(base: string, suffixes: readonly string[], hasAlpha: boolean): string {
  const channelsLabel = [...suffixes, ...(hasAlpha ? ['A'] : [])].join(',');
  return base.length > 0 ? `${base}.(${channelsLabel})` : channelsLabel;
}

function getComponentRuleSuffixForSlot(slot: string): string {
  return slot.toUpperCase();
}

function isAlphaChannelWithRules(
  channelName: string,
  nameRules: CompiledChannelRecognitionNameRules
): boolean {
  return parseAlphaChannelNameWithRules(channelName, nameRules) !== null;
}

function buildAlphaChannelLookup(
  channelNames: readonly string[],
  nameRules: CompiledChannelRecognitionNameRules
): AlphaChannelLookup {
  const channelSet = new Set(channelNames);
  const alphaByBase = new Map<string, string>();
  for (const channelName of channelNames) {
    const parsed = parseAlphaChannelNameWithRules(channelName, nameRules);
    if (parsed && !alphaByBase.has(parsed.base)) {
      alphaByBase.set(parsed.base, channelName);
    }
  }
  return { channelSet, alphaByBase };
}

function findAlphaChannelForBase(
  channelNames: readonly string[],
  base: string,
  nameRules: CompiledChannelRecognitionNameRules,
  alphaLookup = buildAlphaChannelLookup(channelNames, nameRules)
): string | null {
  return alphaLookup.alphaByBase.get(base) ?? null;
}

function isMuellerMatrixElementName(value: string): boolean {
  return /^M[0-3][0-3]$/.test(value);
}

function isMuellerMatrixRgbComponentSuffix(value: string | undefined): value is 'R' | 'G' | 'B' {
  return value === 'R' || value === 'G' || value === 'B';
}

export function isRecognizedSelectionType(selection: DisplaySelection | null): boolean {
  return Boolean(
    selection &&
    (
      isStokesSelection(selection) ||
      isSpectralRgbSelection(selection) ||
      isMuellerMatrixSelection(selection) ||
      selection.kind === 'channelRgb' ||
      selection.kind === 'channelMono'
    )
  );
}

export function getRecognizedSelectionLabel(selection: DisplaySelection): string {
  return getDisplaySelectionOptionLabel(selection);
}

function resolveChannelRecognitionConfig(config: ChannelRecognitionConfig): ResolvedChannelRecognitionConfig {
  const settings = normalizeChannelRecognitionSettings(config.channelRecognitionSettings);
  if (!config.channelRecognitionSettings && config.spectralRgbGroupingEnabled === false) {
    settings['spectral.series'] = false;
    settings['stokes.spectral'] = false;
  }
  if (config.includeAlphaCompanions !== undefined) {
    settings['fallback.alphaCompanions'] = config.includeAlphaCompanions !== false;
  }
  settings['fallback.singleChannel'] = true;
  return {
    settings,
    nameRules: compileChannelRecognitionNameRules(config.channelRecognitionNameRules)
  };
}

function isRecognitionSettingEnabled(
  settings: ChannelRecognitionSettings,
  id: ChannelRecognitionSettingId
): boolean {
  return settings[id] !== false;
}

function isStokesCandidateEnabled(
  candidate: StokesVectorCandidate,
  settings: ChannelRecognitionSettings
): boolean {
  if (candidate.ruleId === 'stokes.scalar') {
    return settings['stokes.scalar'] !== false;
  }
  if (candidate.ruleId === 'stokes.rgb') {
    return settings['stokes.rgb'] !== false;
  }
  return settings['stokes.spectral'] !== false;
}
