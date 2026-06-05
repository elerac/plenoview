import { sanitizeByteCount } from './memory-accounting';

export type ResidentResourceKind =
  | 'source-texture'
  | 'derived-texture'
  | 'cpu-materialized'
  | 'decoded-session'
  | 'analysis-cache';

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
