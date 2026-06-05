import { sanitizeByteCount } from './memory-accounting';

const DECODE_HARD_GUARD_EXTRA_BYTES = 1024 * 1024 * 1024;

export type ResidentResourceKind =
  | 'source-texture'
  | 'derived-texture'
  | 'cpu-materialized'
  | 'decoded-session'
  | 'analysis-cache';

export type DecodeMemoryReservationReason =
  | 'active-open'
  | 'folder-load'
  | 'background-load'
  | 'reload-cold-session';

export interface DecodeMemoryReservation {
  id: string;
  sourceBytes: number;
  estimatedDecodedBytes: number;
  estimatedScratchBytes: number;
  estimatedFirstDisplayBytes: number;
  totalReservedBytes: number;
  reason: DecodeMemoryReservationReason;
}

export type DecodeMemoryReservationEstimate = Omit<DecodeMemoryReservation, 'id' | 'totalReservedBytes'>;

export interface ResidentResourceBinding {
  sessionId: string;
  layerIndex: number;
  sourceNames: ReadonlySet<string>;
}

export interface ResidentResourceMetadata {
  sessionId: string;
  layerIndex: number | null;
  sourceName: string | null;
  resourceKind: ResidentResourceKind;
  bytes: number;
  lastAccessToken: number;
  accessCount: number;
  visible: boolean;
  pinned: boolean;
  evict: () => number;
}

export interface EvictionContext {
  activeSessionId: string | null;
  visibleSessionIds: ReadonlySet<string>;
  activeBindings: readonly ResidentResourceBinding[];
  pinnedSessionIds: ReadonlySet<string>;
  protectedResourceKeys?: ReadonlySet<string>;
}

export interface MemoryBudgetEnforcementResult {
  trackedBytes: number;
  evictedBytes: number;
  evictedResources: ResidentResourceMetadata[];
  overBudget: boolean;
}

export class DecodeMemoryReservationManager {
  private readonly reservations = new Map<string, DecodeMemoryReservation>();
  private displayCacheBudgetBytes: number;
  private nextReservationId = 1;
  private onReservationsChanged: (() => void) | null = null;

  constructor(options: { displayCacheBudgetBytes?: number } = {}) {
    this.displayCacheBudgetBytes = sanitizeByteCount(options.displayCacheBudgetBytes ?? 0);
  }

  setDisplayCacheBudgetBytes(displayCacheBudgetBytes: number): void {
    this.displayCacheBudgetBytes = sanitizeByteCount(displayCacheBudgetBytes);
  }

  setReservationChangeListener(listener: (() => void) | null): void {
    this.onReservationsChanged = listener;
  }

  getHardGuardBytes(): number {
    return resolveDecodeHardGuardBytes(this.displayCacheBudgetBytes);
  }

  reserveDecode(estimate: DecodeMemoryReservationEstimate): DecodeMemoryReservation | null {
    const normalized = normalizeDecodeReservationEstimate(estimate);
    if (!this.canAdmitDecode(normalized)) {
      return null;
    }

    const reservation: DecodeMemoryReservation = {
      id: `decode-reservation-${this.nextReservationId}`,
      ...normalized,
      totalReservedBytes: getDecodeReservationTotalBytes(normalized)
    };
    this.nextReservationId += 1;
    this.reservations.set(reservation.id, reservation);
    this.onReservationsChanged?.();
    return reservation;
  }

  releaseReservation(id: string | null | undefined): void {
    if (!id) {
      return;
    }

    if (this.reservations.delete(id)) {
      this.onReservationsChanged?.();
    }
  }

  getActiveReservationBytes(): number {
    let bytes = 0;
    for (const reservation of this.reservations.values()) {
      bytes += sanitizeByteCount(reservation.totalReservedBytes);
    }
    return bytes;
  }

  canAdmitDecode(estimate: DecodeMemoryReservationEstimate): boolean {
    const normalized = normalizeDecodeReservationEstimate(estimate);
    const activeReservationBytes = this.getActiveReservationBytes();
    const totalReservedBytes = getDecodeReservationTotalBytes(normalized);
    const hardGuardBytes = this.getHardGuardBytes();

    if (activeReservationBytes + totalReservedBytes <= hardGuardBytes) {
      return true;
    }

    return isPrivilegedDecodeReason(normalized.reason) && activeReservationBytes === 0;
  }
}

export function resolveDecodeHardGuardBytes(displayCacheBudgetBytes: number): number {
  const budgetBytes = sanitizeByteCount(displayCacheBudgetBytes);
  return Math.max(2 * budgetBytes, budgetBytes + DECODE_HARD_GUARD_EXTRA_BYTES);
}

export function enforceMemoryBudget(args: {
  resources: readonly ResidentResourceMetadata[];
  trackedBytes: number;
  budgetBytes: number;
  reservedBytes?: number;
  context: EvictionContext;
}): MemoryBudgetEnforcementResult {
  const budgetBytes = sanitizeByteCount(args.budgetBytes);
  const reservedBytes = sanitizeByteCount(args.reservedBytes ?? 0);
  let trackedBytes = sanitizeByteCount(args.trackedBytes);
  let evictedBytes = 0;
  const evictedResources: ResidentResourceMetadata[] = [];

  if (trackedBytes + reservedBytes <= budgetBytes) {
    return {
      trackedBytes,
      evictedBytes,
      evictedResources,
      overBudget: false
    };
  }

  for (const resource of getEvictionCandidates(args.resources, args.context, budgetBytes)) {
    if (trackedBytes + reservedBytes <= budgetBytes) {
      break;
    }

    const removedBytes = sanitizeByteCount(resource.evict());
    if (removedBytes <= 0) {
      continue;
    }

    trackedBytes = Math.max(0, trackedBytes - removedBytes);
    evictedBytes += removedBytes;
    evictedResources.push(resource);
  }

  return {
    trackedBytes,
    evictedBytes,
    evictedResources,
    overBudget: trackedBytes + reservedBytes > budgetBytes
  };
}

export function getEvictionCandidates(
  resources: readonly ResidentResourceMetadata[],
  context: EvictionContext,
  budgetBytes: number
): ResidentResourceMetadata[] {
  return resources
    .filter((resource) => {
      return isEvictableResource(resource) && !isProtectedResource(resource, context);
    })
    .sort((left, right) => compareEvictionCandidates(left, right, budgetBytes));
}

export function isProtectedResource(resource: ResidentResourceMetadata, context: EvictionContext): boolean {
  if (resource.pinned || context.pinnedSessionIds.has(resource.sessionId)) {
    return true;
  }

  if (resource.visible) {
    return true;
  }

  const resourceKey = getResidentResourceKey(resource);
  if (context.protectedResourceKeys?.has(resourceKey)) {
    return true;
  }

  if (isResourceUsedByBinding(resource, context.activeBindings)) {
    return true;
  }

  return false;
}

export function getResidentResourceKey(resource: Pick<
  ResidentResourceMetadata,
  'sessionId' | 'layerIndex' | 'sourceName' | 'resourceKind'
>): string {
  return `${resource.sessionId}:${resource.layerIndex ?? ''}:${resource.sourceName ?? ''}:${resource.resourceKind}`;
}

function compareEvictionCandidates(
  left: ResidentResourceMetadata,
  right: ResidentResourceMetadata,
  budgetBytes: number
): number {
  const leftTier = getEvictionTier(left);
  const rightTier = getEvictionTier(right);
  if (leftTier !== rightTier) {
    return leftTier - rightTier;
  }

  const leftProbationary = isLargeProbationaryDerivedResource(left, budgetBytes);
  const rightProbationary = isLargeProbationaryDerivedResource(right, budgetBytes);
  if (leftProbationary !== rightProbationary) {
    return leftProbationary ? -1 : 1;
  }

  if (leftProbationary && rightProbationary && left.bytes !== right.bytes) {
    return sanitizeByteCount(right.bytes) - sanitizeByteCount(left.bytes);
  }

  if (left.lastAccessToken !== right.lastAccessToken) {
    return left.lastAccessToken - right.lastAccessToken;
  }

  if (left.sessionId !== right.sessionId) {
    return left.sessionId.localeCompare(right.sessionId);
  }

  if ((left.layerIndex ?? -1) !== (right.layerIndex ?? -1)) {
    return (left.layerIndex ?? -1) - (right.layerIndex ?? -1);
  }

  if ((left.sourceName ?? '') !== (right.sourceName ?? '')) {
    return (left.sourceName ?? '').localeCompare(right.sourceName ?? '');
  }

  return left.resourceKind.localeCompare(right.resourceKind);
}

function isEvictableResource(resource: ResidentResourceMetadata): boolean {
  return resource.resourceKind !== 'decoded-session' && sanitizeByteCount(resource.bytes) > 0;
}

function getEvictionTier(resource: ResidentResourceMetadata): number {
  switch (resource.resourceKind) {
    case 'derived-texture':
      return 0;
    case 'source-texture':
      return 1;
    case 'cpu-materialized':
      return 2;
    case 'analysis-cache':
      return 3;
    case 'decoded-session':
      return 4;
  }
}

function isLargeProbationaryDerivedResource(resource: ResidentResourceMetadata, budgetBytes: number): boolean {
  return (
    resource.resourceKind === 'derived-texture' &&
    sanitizeByteCount(resource.bytes) > sanitizeByteCount(budgetBytes) * 0.25 &&
    resource.accessCount < 2
  );
}

function normalizeDecodeReservationEstimate(
  estimate: DecodeMemoryReservationEstimate
): DecodeMemoryReservationEstimate {
  return {
    sourceBytes: sanitizeByteCount(estimate.sourceBytes),
    estimatedDecodedBytes: sanitizeByteCount(estimate.estimatedDecodedBytes),
    estimatedScratchBytes: sanitizeByteCount(estimate.estimatedScratchBytes),
    estimatedFirstDisplayBytes: sanitizeByteCount(estimate.estimatedFirstDisplayBytes),
    reason: estimate.reason
  };
}

function getDecodeReservationTotalBytes(estimate: DecodeMemoryReservationEstimate): number {
  return sanitizeByteCount(estimate.sourceBytes) +
    sanitizeByteCount(estimate.estimatedDecodedBytes) +
    sanitizeByteCount(estimate.estimatedScratchBytes) +
    sanitizeByteCount(estimate.estimatedFirstDisplayBytes);
}

function isPrivilegedDecodeReason(reason: DecodeMemoryReservationReason): boolean {
  return reason === 'active-open' || reason === 'reload-cold-session';
}

function isResourceUsedByBinding(
  resource: ResidentResourceMetadata,
  bindings: readonly ResidentResourceBinding[]
): boolean {
  if (resource.layerIndex === null || resource.sourceName === null) {
    return false;
  }

  if (resource.resourceKind !== 'source-texture' && resource.resourceKind !== 'derived-texture') {
    return false;
  }

  return bindings.some((binding) => {
    return (
      binding.sessionId === resource.sessionId &&
      binding.layerIndex === resource.layerIndex &&
      binding.sourceNames.has(resource.sourceName ?? '')
    );
  });
}
