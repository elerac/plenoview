import { MAX_DEPTH_POINTS } from './depth';

export const CONSTRAINED_DEPTH_POINTS = 350_000;

const CONSTRAINED_DEVICE_MEMORY_GB = 4;
const CONSTRAINED_HARDWARE_CONCURRENCY = 4;
const CONSTRAINED_JS_HEAP_SIZE_LIMIT_BYTES = 1536 * 1024 * 1024;
const CONSTRAINED_TOUCH_VIEWPORT_SIDE_PX = 900;
const MOBILE_USER_AGENT_PATTERN =
  /\b(Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile)\b/i;

export interface DepthPointBudgetViewport {
  width: number;
  height: number;
}

export interface DepthPointBudgetEnvironmentHints {
  deviceMemoryGb?: number | null;
  hardwareConcurrency?: number | null;
  jsHeapSizeLimitBytes?: number | null;
  maxTouchPoints?: number | null;
  coarsePointer?: boolean | null;
  anyCoarsePointer?: boolean | null;
  viewportWidth?: number | null;
  viewportHeight?: number | null;
  userAgentDataMobile?: boolean | null;
  userAgent?: string | null;
}

export type DepthPointBudgetResolver = (viewport?: DepthPointBudgetViewport) => number;

export function resolveAdaptiveDepthPointBudget(
  hints: DepthPointBudgetEnvironmentHints = collectDepthPointBudgetEnvironmentHints()
): number {
  const deviceMemoryGb = normalizePositiveNumber(hints.deviceMemoryGb);
  if (deviceMemoryGb !== null && deviceMemoryGb <= CONSTRAINED_DEVICE_MEMORY_GB) {
    return CONSTRAINED_DEPTH_POINTS;
  }

  const hardwareConcurrency = normalizePositiveNumber(hints.hardwareConcurrency);
  if (hardwareConcurrency !== null && hardwareConcurrency <= CONSTRAINED_HARDWARE_CONCURRENCY) {
    return CONSTRAINED_DEPTH_POINTS;
  }

  const jsHeapSizeLimitBytes = normalizePositiveNumber(hints.jsHeapSizeLimitBytes);
  if (jsHeapSizeLimitBytes !== null && jsHeapSizeLimitBytes <= CONSTRAINED_JS_HEAP_SIZE_LIMIT_BYTES) {
    return CONSTRAINED_DEPTH_POINTS;
  }

  if (isConstrainedTouchViewport(hints)) {
    return CONSTRAINED_DEPTH_POINTS;
  }

  if (hints.userAgentDataMobile === true) {
    return CONSTRAINED_DEPTH_POINTS;
  }

  if (typeof hints.userAgent === 'string' && MOBILE_USER_AGENT_PATTERN.test(hints.userAgent)) {
    return CONSTRAINED_DEPTH_POINTS;
  }

  return MAX_DEPTH_POINTS;
}

export function collectDepthPointBudgetEnvironmentHints(
  globalLike: unknown = typeof globalThis === 'undefined' ? null : globalThis,
  viewport?: DepthPointBudgetViewport
): DepthPointBudgetEnvironmentHints {
  const globalRecord = isRecord(globalLike) ? globalLike : {};
  const navigatorRecord = isRecord(globalRecord.navigator) ? globalRecord.navigator : {};
  const userAgentDataRecord = isRecord(navigatorRecord.userAgentData) ? navigatorRecord.userAgentData : {};
  const performanceRecord = isRecord(globalRecord.performance) ? globalRecord.performance : {};
  const performanceMemoryRecord = isRecord(performanceRecord.memory) ? performanceRecord.memory : {};

  return {
    deviceMemoryGb: normalizePositiveNumber(navigatorRecord.deviceMemory),
    hardwareConcurrency: normalizePositiveNumber(navigatorRecord.hardwareConcurrency),
    jsHeapSizeLimitBytes: normalizePositiveNumber(performanceMemoryRecord.jsHeapSizeLimit),
    maxTouchPoints: normalizePositiveNumber(navigatorRecord.maxTouchPoints),
    coarsePointer: readMatchMedia(globalRecord, '(pointer: coarse)'),
    anyCoarsePointer: readMatchMedia(globalRecord, '(any-pointer: coarse)'),
    viewportWidth: normalizePositiveNumber(viewport?.width) ?? normalizePositiveNumber(globalRecord.innerWidth),
    viewportHeight: normalizePositiveNumber(viewport?.height) ?? normalizePositiveNumber(globalRecord.innerHeight),
    userAgentDataMobile: typeof userAgentDataRecord.mobile === 'boolean' ? userAgentDataRecord.mobile : null,
    userAgent: typeof navigatorRecord.userAgent === 'string' ? navigatorRecord.userAgent : null
  };
}

export function createAdaptiveDepthPointBudgetResolver(
  globalLike: unknown = typeof globalThis === 'undefined' ? null : globalThis
): DepthPointBudgetResolver {
  return (viewport) => resolveAdaptiveDepthPointBudget(
    collectDepthPointBudgetEnvironmentHints(globalLike, viewport)
  );
}

function isConstrainedTouchViewport(hints: DepthPointBudgetEnvironmentHints): boolean {
  const maxTouchPoints = normalizePositiveNumber(hints.maxTouchPoints);
  const viewportWidth = normalizePositiveNumber(hints.viewportWidth);
  const viewportHeight = normalizePositiveNumber(hints.viewportHeight);
  if (
    maxTouchPoints === null ||
    maxTouchPoints <= 0 ||
    viewportWidth === null ||
    viewportHeight === null ||
    hints.coarsePointer !== true && hints.anyCoarsePointer !== true
  ) {
    return false;
  }

  return Math.min(viewportWidth, viewportHeight) <= CONSTRAINED_TOUCH_VIEWPORT_SIDE_PX;
}

function readMatchMedia(globalRecord: Record<string, unknown>, query: string): boolean | null {
  if (typeof globalRecord.matchMedia !== 'function') {
    return null;
  }

  try {
    const result = globalRecord.matchMedia(query);
    return isRecord(result) && typeof result.matches === 'boolean' ? result.matches : null;
  } catch {
    return null;
  }
}

function normalizePositiveNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object');
}
