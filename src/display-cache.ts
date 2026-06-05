import type { AutoExposureResult } from './analysis/auto-exposure';
import type { AsyncResource } from './async-resource';
import {
  createMemoryUsageSnapshot,
  sanitizeByteCount
} from './memory/memory-accounting';
import type { ResidentResourceKind } from './memory/memory-manager';
import type { DecodedExrImage, DisplayLuminanceRange, ImageStats } from './types';

export const DISPLAY_CACHE_BUDGET_STORAGE_KEY = 'prismifold:display-cache-budget-mb:v1';
export const DISPLAY_CACHE_BUDGET_OPTIONS_MB = [64, 128, 256, 512, 1024] as const;
export const MIN_DISPLAY_CACHE_BUDGET_MB = DISPLAY_CACHE_BUDGET_OPTIONS_MB[0];
export const MAX_DISPLAY_CACHE_BUDGET_MB =
  DISPLAY_CACHE_BUDGET_OPTIONS_MB[DISPLAY_CACHE_BUDGET_OPTIONS_MB.length - 1];
export const DEFAULT_DISPLAY_CACHE_BUDGET_MB = 256;
export const BYTES_PER_MEGABYTE = 1024 * 1024;
export const DEFAULT_DISPLAY_CACHE_BUDGET_MODE: DisplayCacheBudgetMode = 'automatic';

export type DisplayCacheBudgetMode = 'automatic' | 'fixed';
export type DisplayCacheBudgetHostKind = 'web' | 'tauri' | 'vscode';

export interface DisplayCacheBudgetPreference {
  mode: DisplayCacheBudgetMode;
  fixedMb: number;
}

export interface DisplayCacheBudgetResolutionHints {
  hostKind?: DisplayCacheBudgetHostKind | null;
  deviceMemoryGb?: number | null;
  jsHeapSizeLimitBytes?: number | null;
}

export interface ResolvedDisplayCacheBudget {
  preference: DisplayCacheBudgetPreference;
  budgetMb: number;
}

export type ResidentTextureResourceKind = Extract<ResidentResourceKind, 'source-texture' | 'derived-texture'>;

export interface ResidentChannelResourceEntry {
  textureBytes: number;
  materializedBytes: number;
  resourceKind: ResidentTextureResourceKind;
  bytes: number;
  lastAccessToken: number;
  accessCount: number;
}

export interface ResidentChannelUpload {
  channelName: string;
  textureBytes: number;
  materializedBytes: number;
  resourceKind: ResidentTextureResourceKind;
}

export interface ResidentLayerResourceEntry {
  residentChannels: Map<string, ResidentChannelResourceEntry>;
}

export interface SessionResourceEntry {
  id: string;
  pinned: boolean;
  decodedBytes: number;
  residentLayers: Map<number, ResidentLayerResourceEntry>;
  luminanceRangeByRevision: Map<string, AsyncResource<DisplayLuminanceRange | null>>;
  imageStatsByRevision: Map<string, AsyncResource<ImageStats | null>>;
  autoExposureByRevision: Map<string, AsyncResource<AutoExposureResult | null>>;
}

export function createSessionResourceEntry(id: string): SessionResourceEntry {
  return {
    id,
    pinned: false,
    decodedBytes: 0,
    residentLayers: new Map<number, ResidentLayerResourceEntry>(),
    luminanceRangeByRevision: new Map<string, AsyncResource<DisplayLuminanceRange | null>>(),
    imageStatsByRevision: new Map<string, AsyncResource<ImageStats | null>>(),
    autoExposureByRevision: new Map<string, AsyncResource<AutoExposureResult | null>>()
  };
}

export function clearSessionResources(entry: SessionResourceEntry): void {
  entry.pinned = false;
  entry.decodedBytes = 0;
  entry.residentLayers.clear();
  entry.luminanceRangeByRevision.clear();
  entry.imageStatsByRevision.clear();
  entry.autoExposureByRevision.clear();
}

export function getTrackedResidentChannelBytes(
  channel: Pick<ResidentChannelResourceEntry, 'textureBytes' | 'materializedBytes'>
): number {
  return sanitizeByteCount(channel.textureBytes) + sanitizeByteCount(channel.materializedBytes);
}

export function getTrackedResidentBytes(
  sessions: Array<Pick<SessionResourceEntry, 'decodedBytes' | 'residentLayers'>>
): number {
  return createMemoryUsageSnapshot(sessions).totalTrackedBytes;
}

export function getTrackedDisplayResidencyBytes(
  sessions: Iterable<Pick<SessionResourceEntry, 'residentLayers'>>
): number {
  const snapshot = createMemoryUsageSnapshot(
    Array.from(sessions, (session) => ({
      decodedBytes: 0,
      residentLayers: session.residentLayers
    }))
  );
  return snapshot.gpuTextureBytes + snapshot.cpuMaterializedBytes;
}

export function estimateDecodedImageBytes(image: DecodedExrImage): number {
  return image.layers.reduce((total, layer) => {
    const storage = layer.channelStorage;
    if (storage.kind === 'interleaved-f32') {
      return total + sanitizeByteCount(storage.pixels.byteLength);
    }

    const layerBytes = Object.values(storage.pixelsByChannel).reduce((layerTotal, pixels) => {
      return layerTotal + sanitizeByteCount(pixels.byteLength);
    }, 0);
    return total + layerBytes;
  }, 0);
}

export function clampDisplayCacheBudgetMb(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_DISPLAY_CACHE_BUDGET_MB;
  }

  const roundedValue = Math.round(value);
  let nearestBudget: number = DISPLAY_CACHE_BUDGET_OPTIONS_MB[0];
  let nearestDistance = Math.abs(roundedValue - nearestBudget);

  for (const budget of DISPLAY_CACHE_BUDGET_OPTIONS_MB.slice(1)) {
    const distance = Math.abs(roundedValue - budget);
    if (distance < nearestDistance || (distance === nearestDistance && budget > nearestBudget)) {
      nearestBudget = budget;
      nearestDistance = distance;
    }
  }

  return nearestBudget;
}

export function parseDisplayCacheBudgetStorageValue(value: string | null): number {
  return parseDisplayCacheBudgetPreferenceStorageValue(value).fixedMb;
}

export function createDefaultDisplayCacheBudgetPreference(): DisplayCacheBudgetPreference {
  return {
    mode: DEFAULT_DISPLAY_CACHE_BUDGET_MODE,
    fixedMb: DEFAULT_DISPLAY_CACHE_BUDGET_MB
  };
}

export function normalizeDisplayCacheBudgetPreference(input: unknown): DisplayCacheBudgetPreference {
  if (typeof input === 'number') {
    return {
      mode: 'fixed',
      fixedMb: clampDisplayCacheBudgetMb(input)
    };
  }

  if (!input || typeof input !== 'object') {
    return createDefaultDisplayCacheBudgetPreference();
  }

  const record = input as Record<string, unknown>;
  const mode: DisplayCacheBudgetMode = record.mode === 'fixed' ? 'fixed' : 'automatic';
  const fixedMb = typeof record.fixedMb === 'number'
    ? clampDisplayCacheBudgetMb(record.fixedMb)
    : DEFAULT_DISPLAY_CACHE_BUDGET_MB;

  return {
    mode,
    fixedMb
  };
}

export function parseDisplayCacheBudgetPreferenceStorageValue(value: string | null): DisplayCacheBudgetPreference {
  if (!value) {
    return createDefaultDisplayCacheBudgetPreference();
  }

  const trimmedValue = value.trim();
  if (!trimmedValue) {
    return createDefaultDisplayCacheBudgetPreference();
  }

  const numericValue = Number(trimmedValue);
  if (Number.isFinite(numericValue)) {
    return {
      mode: 'fixed',
      fixedMb: clampDisplayCacheBudgetMb(numericValue)
    };
  }

  try {
    return normalizeDisplayCacheBudgetPreference(JSON.parse(trimmedValue));
  } catch {
    return createDefaultDisplayCacheBudgetPreference();
  }
}

export function displayCacheBudgetMbToBytes(valueMb: number): number {
  return clampDisplayCacheBudgetMb(valueMb) * BYTES_PER_MEGABYTE;
}

export function displayCacheBudgetPreferenceToStorageValue(preference: DisplayCacheBudgetPreference): string {
  return JSON.stringify(normalizeDisplayCacheBudgetPreference(preference));
}

export function resolveDisplayCacheBudgetMb(
  preference: DisplayCacheBudgetPreference,
  hints: DisplayCacheBudgetResolutionHints = {}
): number {
  const normalizedPreference = normalizeDisplayCacheBudgetPreference(preference);
  if (normalizedPreference.mode === 'fixed') {
    return normalizedPreference.fixedMb;
  }

  return resolveAutomaticDisplayCacheBudgetMb(hints);
}

export function resolveDisplayCacheBudget(
  preference: DisplayCacheBudgetPreference,
  hints: DisplayCacheBudgetResolutionHints = {}
): ResolvedDisplayCacheBudget {
  const normalizedPreference = normalizeDisplayCacheBudgetPreference(preference);
  return {
    preference: normalizedPreference,
    budgetMb: resolveDisplayCacheBudgetMb(normalizedPreference, hints)
  };
}

export function resolveAutomaticDisplayCacheBudgetMb(
  hints: DisplayCacheBudgetResolutionHints = {}
): number {
  const deviceMemoryGb = normalizePositiveNumber(hints.deviceMemoryGb);
  const jsHeapSizeLimitBytes = normalizePositiveNumber(hints.jsHeapSizeLimitBytes);

  if (
    (deviceMemoryGb !== null && deviceMemoryGb <= 2) ||
    (jsHeapSizeLimitBytes !== null && jsHeapSizeLimitBytes <= 768 * BYTES_PER_MEGABYTE)
  ) {
    return 128;
  }

  if (
    hints.hostKind === 'tauri' ||
    (deviceMemoryGb !== null && deviceMemoryGb >= 8) ||
    (jsHeapSizeLimitBytes !== null && jsHeapSizeLimitBytes >= 4 * 1024 * BYTES_PER_MEGABYTE)
  ) {
    return 1024;
  }

  if (
    hints.hostKind === 'vscode' ||
    (deviceMemoryGb !== null && deviceMemoryGb >= 4) ||
    (jsHeapSizeLimitBytes !== null && jsHeapSizeLimitBytes >= 2 * 1024 * BYTES_PER_MEGABYTE)
  ) {
    return 512;
  }

  return 256;
}

export function collectDisplayCacheBudgetEnvironmentHints(
  hostKind?: DisplayCacheBudgetHostKind | null,
  globalLike: unknown = typeof globalThis === 'undefined' ? null : globalThis
): DisplayCacheBudgetResolutionHints {
  const globalRecord = isRecord(globalLike) ? globalLike : {};
  const navigatorRecord = isRecord(globalRecord.navigator) ? globalRecord.navigator : {};
  const performanceRecord = isRecord(globalRecord.performance) ? globalRecord.performance : {};
  const performanceMemoryRecord = isRecord(performanceRecord.memory) ? performanceRecord.memory : {};

  return {
    hostKind,
    deviceMemoryGb: normalizePositiveNumber(navigatorRecord.deviceMemory),
    jsHeapSizeLimitBytes: normalizePositiveNumber(performanceMemoryRecord.jsHeapSizeLimit)
  };
}

export function readStoredDisplayCacheBudgetMb(): number {
  return readStoredDisplayCacheBudgetPreference().fixedMb;
}

export function readStoredDisplayCacheBudgetPreference(): DisplayCacheBudgetPreference {
  if (typeof window === 'undefined') {
    return createDefaultDisplayCacheBudgetPreference();
  }

  try {
    return parseDisplayCacheBudgetPreferenceStorageValue(window.localStorage.getItem(DISPLAY_CACHE_BUDGET_STORAGE_KEY));
  } catch {
    return createDefaultDisplayCacheBudgetPreference();
  }
}

export function saveStoredDisplayCacheBudgetMb(valueMb: number): void {
  saveStoredDisplayCacheBudgetPreference({
    mode: 'fixed',
    fixedMb: valueMb
  });
}

export function saveStoredDisplayCacheBudgetPreference(preference: DisplayCacheBudgetPreference): void {
  if (typeof window === 'undefined') {
    return;
  }

  const storageValue = displayCacheBudgetPreferenceToStorageValue(preference);

  try {
    window.localStorage.setItem(DISPLAY_CACHE_BUDGET_STORAGE_KEY, storageValue);
  } catch {
    // Storage can be unavailable in private contexts; keep the runtime budget anyway.
  }
}

function normalizePositiveNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object');
}
