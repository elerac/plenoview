import { cloneDisplaySelection, sameDisplaySelection, serializeDisplaySelectionKey, type DisplaySelection } from './display-model';
import {
  recognizeLayerChannels,
  type RecognizedChannelCandidate
} from './channel-recognition';
import type { StokesParameterVisibilitySettings } from './stokes';
import type { ChannelRecognitionSettings } from './channel-recognition-settings';
import type { ChannelRecognitionNameRules } from './channel-recognition-name-rules';
import type { DisplayChannelMapping } from './types';

export interface ChannelViewItem {
  value: string;
  label: string;
  meta: string;
  swatches: string[];
  selection: DisplaySelection;
  selectionKey: string;
  recognitionKey: string;
  mergedParentKey: string | null;
  splitChildKeys: string[];
  mergedOrder: number | null;
  splitOrder: number | null;
}

export interface ChannelViewThumbnailItem extends ChannelViewItem {
  thumbnailDataUrl: string | null;
}

export interface ChannelViewStackInfo {
  key: string;
  parentValue: string;
  childValues: string[];
}

export interface ChannelViewStackPresentation {
  key: string;
  parentValue: string;
  childValues: string[];
  role: 'parent' | 'child';
  index: number;
  count: number;
}

export type ChannelViewStackedItem<T extends ChannelViewItem = ChannelViewItem> = T & {
  stack: ChannelViewStackPresentation | null;
};

export type ChannelViewStackedThumbnailItem = ChannelViewStackedItem<ChannelViewThumbnailItem>;

export interface ChannelViewItemsConfig {
  stokesParameterVisibility?: StokesParameterVisibilitySettings;
  spectralRgbGroupingEnabled?: boolean;
  channelRecognitionSettings?: ChannelRecognitionSettings;
  channelRecognitionNameRules?: ChannelRecognitionNameRules;
}

export function buildChannelViewItems(
  channelNames: string[],
  config: ChannelViewItemsConfig = {}
): ChannelViewItem[] {
  const recognition = recognizeLayerChannels(channelNames, {
    stokesParameterVisibility: config.stokesParameterVisibility,
    spectralRgbGroupingEnabled: config.spectralRgbGroupingEnabled,
    channelRecognitionSettings: config.channelRecognitionSettings,
    channelRecognitionNameRules: config.channelRecognitionNameRules
  });
  const mergedItems = buildDisplayItems(recognition.candidates, false);
  const splitItems = buildDisplayItems(recognition.candidates, true);
  const itemsByValue = new Map<string, ChannelViewItem>();
  const buildCollisionKey = (item: Omit<ChannelViewItem, 'mergedOrder' | 'splitOrder'>): string =>
    `${item.value}::${item.selectionKey}`;

  mergedItems.forEach((item, index) => {
    const existing = itemsByValue.get(item.value) ?? itemsByValue.get(buildCollisionKey(item));
    if (existing) {
      existing.mergedOrder = index;
      mergeChannelViewItemRelationships(existing, item);
      return;
    }

    itemsByValue.set(item.value, {
      ...item,
      mergedOrder: index,
      splitOrder: null
    });
  });

  splitItems.forEach((item, index) => {
    const existing = itemsByValue.get(item.value);
    if (existing) {
      if (existing.selectionKey !== item.selectionKey) {
        itemsByValue.set(buildCollisionKey(item), {
          ...item,
          value: buildCollisionKey(item),
          mergedOrder: null,
          splitOrder: index
        });
        return;
      }

      existing.splitOrder = index;
      mergeChannelViewItemRelationships(existing, item);
      return;
    }

    itemsByValue.set(item.value, {
      ...item,
      mergedOrder: null,
      splitOrder: index
    });
  });

  return Array.from(itemsByValue.values()).sort((a, b) => compareNullableOrder(a.mergedOrder ?? a.splitOrder, b.mergedOrder ?? b.splitOrder));
}

export function selectVisibleChannelViewItems<T extends Pick<ChannelViewItem, 'mergedOrder' | 'splitOrder'>>(
  items: readonly T[],
  includeSplitRgbChannels: boolean
): T[] {
  const visible = items.filter((item) => includeSplitRgbChannels ? item.splitOrder !== null : item.mergedOrder !== null);
  return [...visible].sort((a, b) => compareNullableOrder(
    includeSplitRgbChannels ? a.splitOrder : a.mergedOrder,
    includeSplitRgbChannels ? b.splitOrder : b.mergedOrder
  ));
}

export function hasSplitChannelViewItems(items: readonly Pick<ChannelViewItem, 'mergedOrder' | 'splitOrder'>[]): boolean {
  return items.some((item) => item.mergedOrder === null || item.splitOrder === null);
}

export function buildChannelViewStacks(
  _channelNames: string[],
  items: readonly ChannelViewItem[],
  _config: ChannelViewItemsConfig = {}
): ChannelViewStackInfo[] {
  const splitItems = selectVisibleChannelViewItems(items, true);
  const splitItemsByRecognitionKey = new Map<string, ChannelViewItem[]>();
  for (const item of splitItems) {
    const existing = splitItemsByRecognitionKey.get(item.recognitionKey) ?? [];
    existing.push(item);
    splitItemsByRecognitionKey.set(item.recognitionKey, existing);
  }

  const stacks: ChannelViewStackInfo[] = [];

  for (const parent of selectVisibleChannelViewItems(items, false)) {
    if (parent.splitChildKeys.length === 0) {
      continue;
    }

    const childItems = parent.splitChildKeys
      .flatMap((childKey) => splitItemsByRecognitionKey.get(childKey) ?? [])
      .filter((child) => child.mergedParentKey === parent.recognitionKey)
      .filter((child, index, children) => children.findIndex((candidate) => candidate.value === child.value) === index)
      .sort((a, b) => compareNullableOrder(a.splitOrder, b.splitOrder));

    if (childItems.length < 2) {
      continue;
    }

    stacks.push({
      key: `stack:${parent.value}:${parent.selectionKey}`,
      parentValue: parent.value,
      childValues: childItems.map((child) => child.value)
    });
  }

  return stacks;
}

export function selectStackedChannelViewItems<T extends ChannelViewItem>(
  channelNames: string[],
  items: readonly T[],
  expandedStackKeys: ReadonlySet<string>,
  config: ChannelViewItemsConfig = {}
): ChannelViewStackedItem<T>[] {
  const stacks = buildChannelViewStacks(channelNames, items, config);
  const stackByParentValue = new Map(stacks.map((stack) => [stack.parentValue, stack]));
  const itemByValue = new Map(items.map((item) => [item.value, item]));
  const visibleItems: ChannelViewStackedItem<T>[] = [];

  for (const item of selectVisibleChannelViewItems(items, false)) {
    const stack = stackByParentValue.get(item.value);
    if (!stack) {
      visibleItems.push(withoutStack(item));
      continue;
    }

    if (!expandedStackKeys.has(stack.key)) {
      visibleItems.push(withStackPresentation(item, stack, 'parent', 0));
      continue;
    }

    stack.childValues.forEach((childValue, index) => {
      const child = itemByValue.get(childValue);
      if (child) {
        visibleItems.push(withStackPresentation(child, stack, 'child', index));
      }
    });
  }

  return visibleItems;
}

export function pruneExpandedChannelStackKeys(
  channelNames: string[],
  items: readonly ChannelViewItem[],
  expandedStackKeys: ReadonlySet<string>,
  config: ChannelViewItemsConfig = {}
): Set<string> {
  const validStackKeys = new Set(buildChannelViewStacks(channelNames, items, config).map((stack) => stack.key));
  return new Set([...expandedStackKeys].filter((key) => validStackKeys.has(key)));
}

export function findChannelViewStackForValue(
  channelNames: string[],
  items: readonly ChannelViewItem[],
  value: string,
  config: ChannelViewItemsConfig = {}
): ChannelViewStackInfo | null {
  return buildChannelViewStacks(channelNames, items, config).find((stack) => (
    stack.parentValue === value || stack.childValues.includes(value)
  )) ?? null;
}

export function findSelectedChannelViewItem<T extends Pick<ChannelViewItem, 'selection'>>(
  items: readonly T[],
  selected: DisplaySelection | null
): T | null {
  if (!selected) {
    return null;
  }

  return items.find((item) => sameDisplaySelection(item.selection, selected)) ?? null;
}

export function getChannelViewSwatches(mapping: DisplayChannelMapping): string[] {
  const displayChannels = [mapping.displayR, mapping.displayG, mapping.displayB].filter((channelName): channelName is string => (
    channelName !== null
  ));
  if (displayChannels.every((channelName) => channelName === mapping.displayR)) {
    const swatches = [getRepresentativeChannelColor(mapping.displayR)];
    if (mapping.displayA && mapping.displayA !== mapping.displayR) {
      swatches.push(getRepresentativeChannelColor(mapping.displayA));
    }
    return swatches;
  }

  const uniqueChannels = Array.from(new Set(displayChannels));
  return uniqueChannels.slice(0, 3).map((channelName, index) => getDisplaySlotChannelColor(channelName, index));
}

function buildDisplayItems(
  candidates: readonly RecognizedChannelCandidate[],
  includeSplitRgbChannels: boolean
): Omit<ChannelViewItem, 'mergedOrder' | 'splitOrder'>[] {
  return candidates
    .filter((candidate) => includeSplitRgbChannels ? candidate.availability.split : candidate.availability.merged)
    .filter((candidate) => includeSplitRgbChannels || !candidate.metadata.hiddenInMergedChannelView)
    .sort((a, b) => a.sourceOrder - b.sourceOrder)
    .map((candidate) => {
      const channelCount = getChannelViewCandidateChannelCount(candidate);
      return {
        value: candidate.key,
        label: formatChannelViewLabel(candidate.label),
        meta: formatChannelViewMeta(candidate.mapping, channelCount),
        swatches: getChannelViewSwatches(candidate.mapping),
        selection: cloneDisplaySelection(candidate.selection) ?? candidate.selection,
        selectionKey: serializeDisplaySelectionKey(candidate.selection),
        recognitionKey: candidate.key,
        mergedParentKey: candidate.mergedParentKey,
        splitChildKeys: [...candidate.splitChildren]
      };
    });
}

function mergeChannelViewItemRelationships(
  target: Pick<ChannelViewItem, 'mergedParentKey' | 'splitChildKeys'>,
  source: Pick<ChannelViewItem, 'mergedParentKey' | 'splitChildKeys'>
): void {
  if (!target.mergedParentKey && source.mergedParentKey) {
    target.mergedParentKey = source.mergedParentKey;
  }
  for (const splitChildKey of source.splitChildKeys) {
    if (!target.splitChildKeys.includes(splitChildKey)) {
      target.splitChildKeys.push(splitChildKey);
    }
  }
}

function getChannelViewCandidateChannelCount(candidate: RecognizedChannelCandidate): number | undefined {
  return candidate.kind === 'muellerMatrix' ? candidate.metadata.channelCount : undefined;
}

function compareNullableOrder(a: number | null, b: number | null): number {
  const left = a ?? Number.MAX_SAFE_INTEGER;
  const right = b ?? Number.MAX_SAFE_INTEGER;
  return left - right;
}

function withoutStack<T extends ChannelViewItem>(item: T): ChannelViewStackedItem<T> {
  return {
    ...item,
    stack: null
  };
}

function withStackPresentation<T extends ChannelViewItem>(
  item: T,
  stack: ChannelViewStackInfo,
  role: ChannelViewStackPresentation['role'],
  index: number
): ChannelViewStackedItem<T> {
  return {
    ...item,
    stack: {
      key: stack.key,
      parentValue: stack.parentValue,
      childValues: [...stack.childValues],
      role,
      index,
      count: stack.childValues.length
    }
  };
}

function formatChannelViewLabel(label: string): string {
  if (label === 'R,G,B,A') {
    return 'RGBA';
  }
  if (label === 'R,G,B') {
    return 'RGB';
  }
  if (label === 'X,Y,Z,A') {
    return 'XYZA';
  }
  if (label === 'X,Y,Z') {
    return 'XYZ';
  }
  if (label === 'U,V,A') {
    return 'UVA';
  }
  if (label === 'U,V') {
    return 'UV';
  }

  return label
    .replace(/\.\(R,G,B,A\)/g, '.RGBA')
    .replace(/\.\(R,G,B\)/g, '.RGB')
    .replace(/\.\(X,Y,Z,A\)/g, '.XYZA')
    .replace(/\.\(X,Y,Z\)/g, '.XYZ')
    .replace(/\.\(U,V,A\)/g, '.UVA')
    .replace(/\.\(U,V\)/g, '.UV');
}

function formatChannelViewMeta(mapping: DisplayChannelMapping, channelCount?: number): string {
  const precisionCount = channelCount ?? getDisplayMappingChannelCount(mapping);
  return precisionCount > 1 ? `32f x ${precisionCount}` : '32f';
}

function getDisplayMappingChannelCount(mapping: DisplayChannelMapping): number {
  return new Set([
    mapping.displayR,
    mapping.displayG,
    mapping.displayB,
    ...(mapping.displayA ? [mapping.displayA] : [])
  ].filter((channelName): channelName is string => channelName !== null)).size;
}

function getDisplaySlotChannelColor(channelName: string, displaySlotIndex: number): string {
  if (displaySlotIndex === 0) {
    return '#ff6570';
  }
  if (displaySlotIndex === 1) {
    return '#6bd66f';
  }
  if (displaySlotIndex === 2) {
    return '#51aefe';
  }

  return getRepresentativeChannelColor(channelName);
}

function getRepresentativeChannelColor(channelName: string): string {
  const suffix = channelName.includes('.') ? channelName.slice(channelName.lastIndexOf('.') + 1) : channelName;
  const normalized = suffix.toUpperCase();
  if (normalized === 'R') {
    return '#ff6570';
  }
  if (normalized === 'G') {
    return '#6bd66f';
  }
  if (normalized === 'B') {
    return '#51aefe';
  }
  if (normalized === 'A') {
    return '#c6cbd2';
  }
  if (normalized === 'Z') {
    return '#8f83e6';
  }
  if (normalized === 'Y' || normalized === 'L') {
    return '#d7dde8';
  }
  if (normalized === 'V') {
    return '#11bfb8';
  }
  if (normalized === 'X' || normalized === 'U') {
    return '#f0b85a';
  }

  const palette = ['#11bfb8', '#b48cf2', '#f0719a', '#8bd36f', '#f0b85a', '#7aa7ff'];
  return palette[Math.abs(hashString(channelName)) % palette.length] ?? '#9aa4b4';
}

function hashString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  }
  return hash;
}
