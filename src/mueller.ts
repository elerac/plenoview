import {
  getChannelReadView,
  readChannelValue,
  readPixelChannelValue,
  type ChannelReadView
} from './channel-storage';
import type { MuellerMatrixSelection } from './display-model';
import type { DecodedLayer, DisplayChannelMapping, ImagePixel } from './types';

export type MuellerMatrixRgbComponent = 'R' | 'G' | 'B';

export type MuellerMatrixElement =
  | 'M00' | 'M01' | 'M02' | 'M03'
  | 'M10' | 'M11' | 'M12' | 'M13'
  | 'M20' | 'M21' | 'M22' | 'M23'
  | 'M30' | 'M31' | 'M32' | 'M33';

export interface MuellerMatrixChannels {
  suffix?: string;
  elements: Record<MuellerMatrixElement, string>;
}

export interface ResolvedMuellerMatrixChannels {
  elements: Record<MuellerMatrixElement, ChannelReadView | null>;
}

export interface RgbMuellerMatrixChannels {
  r: MuellerMatrixChannels;
  g: MuellerMatrixChannels;
  b: MuellerMatrixChannels;
}

export interface ResolvedRgbMuellerMatrixChannels {
  r: ResolvedMuellerMatrixChannels;
  g: ResolvedMuellerMatrixChannels;
  b: ResolvedMuellerMatrixChannels;
}

export interface MuellerMatrixDisplayOption {
  key: string;
  label: string;
  selection: MuellerMatrixSelection;
  mapping: DisplayChannelMapping;
  channelCount: number;
}

interface MuellerMatrixChannelGroup {
  suffix: string | null;
  elements: Partial<Record<MuellerMatrixElement, string>>;
  firstIndex: number;
}

export const MUELLER_MATRIX_GRID_SIZE = 4;
export const MUELLER_MATRIX_CHANNEL_COUNT = 16;
export const MUELLER_MATRIX_ELEMENTS: readonly MuellerMatrixElement[] = [
  'M00', 'M01', 'M02', 'M03',
  'M10', 'M11', 'M12', 'M13',
  'M20', 'M21', 'M22', 'M23',
  'M30', 'M31', 'M32', 'M33'
];

const MUELLER_MATRIX_SOURCE_PREFIX = '__muellerMatrix:';
const RGB_MUELLER_MATRIX_SOURCE_NAME = '__muellerMatrixRgb:';
const RGB_MUELLER_SUFFIXES = new Set<string>(['R', 'G', 'B']);

export function buildMuellerMatrixSelection(suffix: string | null = null): MuellerMatrixSelection {
  return suffix ? { kind: 'muellerMatrix', suffix } : { kind: 'muellerMatrix' };
}

export function buildRgbMuellerMatrixSelection(): MuellerMatrixSelection {
  return { kind: 'muellerMatrix', rgb: true };
}

export function detectMuellerMatrixChannels(
  channelNames: string[],
  suffix: string | null = null
): MuellerMatrixChannels | null {
  const normalizedSuffix = suffix || null;
  if (isRgbMuellerMatrixSuffix(normalizedSuffix)) {
    return buildMuellerMatrixChannelsForSuffix(channelNames, normalizedSuffix);
  }

  return detectMuellerMatrixChannelSets(channelNames)
    .find((channels) => (channels.suffix ?? null) === normalizedSuffix) ?? null;
}

export function detectMuellerMatrixChannelSets(channelNames: string[]): MuellerMatrixChannels[] {
  const groups = new Map<string, MuellerMatrixChannelGroup>();

  channelNames.forEach((channelName, index) => {
    const parsed = parseMuellerMatrixChannelName(channelName);
    if (!parsed || isRgbMuellerMatrixSuffix(parsed.suffix)) {
      return;
    }

    const key = parsed.suffix ?? '';
    const group = groups.get(key) ?? {
      suffix: parsed.suffix,
      elements: {},
      firstIndex: index
    };
    group.elements[parsed.element] ??= channelName;
    group.firstIndex = Math.min(group.firstIndex, index);
    groups.set(key, group);
  });

  const completed = [...groups.values()]
    .map(buildMuellerMatrixChannelsFromGroup)
    .filter((channels): channels is MuellerMatrixChannels => channels !== null);
  const bare = completed.find((channels) => !channels.suffix) ?? null;
  const suffixed = completed
    .filter((channels) => channels.suffix)
    .sort((a, b) => (
      (groups.get(a.suffix ?? '')?.firstIndex ?? Number.MAX_SAFE_INTEGER) -
      (groups.get(b.suffix ?? '')?.firstIndex ?? Number.MAX_SAFE_INTEGER)
    ));

  return bare ? [bare, ...suffixed] : suffixed;
}

export function detectRgbMuellerMatrixChannels(channelNames: string[]): RgbMuellerMatrixChannels | null {
  const r = buildMuellerMatrixChannelsForSuffix(channelNames, 'R');
  const g = buildMuellerMatrixChannelsForSuffix(channelNames, 'G');
  const b = buildMuellerMatrixChannelsForSuffix(channelNames, 'B');
  return r && g && b ? { r, g, b } : null;
}

export function getMuellerMatrixDisplayOptions(
  channelNames: string[],
  config: { includeRgbGroups?: boolean; includeSplitChannels?: boolean } = {}
): MuellerMatrixDisplayOption[] {
  const options = detectMuellerMatrixChannelSets(channelNames).map(buildMuellerMatrixDisplayOption);
  const rgbChannels = detectRgbMuellerMatrixChannels(channelNames);
  if (!rgbChannels) {
    return options;
  }

  if (config.includeRgbGroups ?? true) {
    options.push(buildRgbMuellerMatrixDisplayOption(rgbChannels));
  }

  if (config.includeSplitChannels ?? false) {
    options.push(
      buildMuellerMatrixDisplayOption(rgbChannels.r),
      buildMuellerMatrixDisplayOption(rgbChannels.g),
      buildMuellerMatrixDisplayOption(rgbChannels.b)
    );
  }

  return options;
}

export function isMuellerMatrixDisplayAvailable(
  channelNames: string[],
  selection: MuellerMatrixSelection | null
): boolean {
  if (!selection) {
    return false;
  }

  if (selection.rgb) {
    return Boolean(detectRgbMuellerMatrixChannels(channelNames));
  }

  return Boolean(detectMuellerMatrixChannels(channelNames, selection.suffix ?? null));
}

export function buildMuellerMatrixSourceName(suffix: string | null = null): string {
  return `${MUELLER_MATRIX_SOURCE_PREFIX}${suffix ?? ''}`;
}

export function buildRgbMuellerMatrixSourceName(): string {
  return RGB_MUELLER_MATRIX_SOURCE_NAME;
}

export function parseMuellerMatrixSourceName(
  sourceName: string | null | undefined
): { suffix: string | null; rgb: boolean } | null {
  if (sourceName === RGB_MUELLER_MATRIX_SOURCE_NAME) {
    return { suffix: null, rgb: true };
  }

  if (!sourceName?.startsWith(MUELLER_MATRIX_SOURCE_PREFIX)) {
    return null;
  }

  const suffix = sourceName.slice(MUELLER_MATRIX_SOURCE_PREFIX.length);
  return { suffix: suffix || null, rgb: false };
}

export function isMuellerMatrixSourceName(sourceName: string | null | undefined): boolean {
  return parseMuellerMatrixSourceName(sourceName) !== null;
}

export function resolveMuellerMatrixDisplaySize(
  sourceWidth: number,
  sourceHeight: number
): { width: number; height: number } {
  return {
    width: Math.max(0, Math.floor(sourceWidth)) * MUELLER_MATRIX_GRID_SIZE,
    height: Math.max(0, Math.floor(sourceHeight)) * MUELLER_MATRIX_GRID_SIZE
  };
}

export function resolveMuellerMatrixDisplayPixel(
  displayPixel: ImagePixel,
  sourceWidth: number,
  sourceHeight: number
): { sourcePixel: ImagePixel; element: MuellerMatrixElement; displayIndex: number; sourceIndex: number } | null {
  const displaySize = resolveMuellerMatrixDisplaySize(sourceWidth, sourceHeight);
  if (
    sourceWidth <= 0 ||
    sourceHeight <= 0 ||
    displayPixel.ix < 0 ||
    displayPixel.iy < 0 ||
    displayPixel.ix >= displaySize.width ||
    displayPixel.iy >= displaySize.height
  ) {
    return null;
  }

  const cellColumn = Math.floor(displayPixel.ix / sourceWidth);
  const cellRow = Math.floor(displayPixel.iy / sourceHeight);
  const sourcePixel = {
    ix: displayPixel.ix - cellColumn * sourceWidth,
    iy: displayPixel.iy - cellRow * sourceHeight
  };
  const element = getMuellerMatrixElement(cellRow, cellColumn);
  return {
    sourcePixel,
    element,
    displayIndex: displayPixel.iy * displaySize.width + displayPixel.ix,
    sourceIndex: sourcePixel.iy * sourceWidth + sourcePixel.ix
  };
}

export function resolveMuellerMatrixDisplayPixelIndex(
  displayPixelIndex: number,
  sourceWidth: number,
  sourceHeight: number
): { sourceIndex: number; element: MuellerMatrixElement } | null {
  const displaySize = resolveMuellerMatrixDisplaySize(sourceWidth, sourceHeight);
  if (
    displayPixelIndex < 0 ||
    sourceWidth <= 0 ||
    sourceHeight <= 0 ||
    displayPixelIndex >= displaySize.width * displaySize.height
  ) {
    return null;
  }

  const displayX = displayPixelIndex % displaySize.width;
  const displayY = Math.floor(displayPixelIndex / displaySize.width);
  const cellColumn = Math.floor(displayX / sourceWidth);
  const cellRow = Math.floor(displayY / sourceHeight);
  const sourceX = displayX - cellColumn * sourceWidth;
  const sourceY = displayY - cellRow * sourceHeight;
  return {
    element: getMuellerMatrixElement(cellRow, cellColumn),
    sourceIndex: sourceY * sourceWidth + sourceX
  };
}

export function resolveMuellerMatrixChannelArrays(
  layer: DecodedLayer,
  channels: MuellerMatrixChannels | null
): ResolvedMuellerMatrixChannels {
  const elements = {} as Record<MuellerMatrixElement, ChannelReadView | null>;
  for (const element of MUELLER_MATRIX_ELEMENTS) {
    elements[element] = channels ? getChannelReadView(layer, channels.elements[element]) : null;
  }
  return { elements };
}

export function resolveRgbMuellerMatrixChannelArrays(
  layer: DecodedLayer,
  channels: RgbMuellerMatrixChannels | null
): ResolvedRgbMuellerMatrixChannels {
  return {
    r: resolveMuellerMatrixChannelArrays(layer, channels?.r ?? null),
    g: resolveMuellerMatrixChannelArrays(layer, channels?.g ?? null),
    b: resolveMuellerMatrixChannelArrays(layer, channels?.b ?? null)
  };
}

export function readMuellerMatrixDisplayValue(
  channels: ResolvedMuellerMatrixChannels,
  displayPixelIndex: number,
  sourceWidth: number,
  sourceHeight: number
): number {
  const resolved = resolveMuellerMatrixDisplayPixelIndex(displayPixelIndex, sourceWidth, sourceHeight);
  return resolved
    ? readChannelValue(channels.elements[resolved.element], resolved.sourceIndex)
    : 0;
}

export function readRgbMuellerMatrixDisplayValue(
  channels: ResolvedRgbMuellerMatrixChannels,
  displayPixelIndex: number,
  sourceWidth: number,
  sourceHeight: number,
  component: Lowercase<MuellerMatrixRgbComponent>
): number {
  const resolved = resolveMuellerMatrixDisplayPixelIndex(displayPixelIndex, sourceWidth, sourceHeight);
  return resolved
    ? readChannelValue(channels[component].elements[resolved.element], resolved.sourceIndex)
    : 0;
}

export function readMuellerMatrixPixelValue(
  layer: DecodedLayer,
  sourceIndex: number,
  channels: MuellerMatrixChannels,
  element: MuellerMatrixElement
): number {
  return readPixelChannelValue(layer, sourceIndex, channels.elements[element]);
}

export function getMuellerMatrixRgbComponentChannels(
  channels: RgbMuellerMatrixChannels,
  component: MuellerMatrixRgbComponent
): MuellerMatrixChannels {
  switch (component) {
    case 'R':
      return channels.r;
    case 'G':
      return channels.g;
    case 'B':
      return channels.b;
  }
}

function buildMuellerMatrixDisplayOption(channels: MuellerMatrixChannels): MuellerMatrixDisplayOption {
  const suffix = channels.suffix ?? null;
  return {
    key: `muellerMatrix:${suffix ?? ''}`,
    label: suffix ? `Mueller Matrix.${suffix}` : 'Mueller Matrix',
    selection: buildMuellerMatrixSelection(suffix),
    mapping: {
      displayR: channels.elements.M00,
      displayG: channels.elements.M01,
      displayB: channels.elements.M02,
      displayA: null
    },
    channelCount: MUELLER_MATRIX_CHANNEL_COUNT
  };
}

function buildRgbMuellerMatrixDisplayOption(channels: RgbMuellerMatrixChannels): MuellerMatrixDisplayOption {
  const selection = buildRgbMuellerMatrixSelection();
  return {
    key: 'muellerMatrixRgb:',
    label: 'Mueller Matrix.RGB',
    selection,
    mapping: {
      displayR: channels.r.elements.M00,
      displayG: channels.g.elements.M00,
      displayB: channels.b.elements.M00,
      displayA: null
    },
    channelCount: MUELLER_MATRIX_CHANNEL_COUNT * 3
  };
}

function parseMuellerMatrixChannelName(
  channelName: string
): { element: MuellerMatrixElement; suffix: string | null } | null {
  const match = /^(M[0-3][0-3])(?:\.(.+))?$/.exec(channelName);
  if (!match) {
    return null;
  }

  return {
    element: match[1] as MuellerMatrixElement,
    suffix: match[2] ?? null
  };
}

function buildMuellerMatrixChannelsForSuffix(
  channelNames: string[],
  suffix: MuellerMatrixRgbComponent
): MuellerMatrixChannels | null {
  const channelNameSet = new Set(channelNames);
  const elements = {} as Record<MuellerMatrixElement, string>;
  for (const element of MUELLER_MATRIX_ELEMENTS) {
    const channelName = `${element}.${suffix}`;
    if (!channelNameSet.has(channelName)) {
      return null;
    }
    elements[element] = channelName;
  }

  return { suffix, elements };
}

function buildMuellerMatrixChannelsFromGroup(
  group: MuellerMatrixChannelGroup
): MuellerMatrixChannels | null {
  const elements = {} as Record<MuellerMatrixElement, string>;
  for (const element of MUELLER_MATRIX_ELEMENTS) {
    const channelName = group.elements[element];
    if (!channelName) {
      return null;
    }
    elements[element] = channelName;
  }

  return group.suffix
    ? { suffix: group.suffix, elements }
    : { elements };
}

function isRgbMuellerMatrixSuffix(suffix: string | null): suffix is MuellerMatrixRgbComponent {
  return suffix !== null && RGB_MUELLER_SUFFIXES.has(suffix);
}

function getMuellerMatrixElement(row: number, column: number): MuellerMatrixElement {
  return `M${row}${column}` as MuellerMatrixElement;
}
