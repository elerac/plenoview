import { describe, expect, it, vi } from 'vitest';
import {
  enforceMemoryBudget,
  getEvictionCandidates,
  type EvictionContext,
  type ResidentResourceKind,
  type ResidentResourceMetadata
} from '../src/memory/memory-manager';

const EMPTY_CONTEXT: EvictionContext = {
  activeSessionId: null,
  visibleSessionIds: new Set(),
  activeBindings: [],
  pinnedSessionIds: new Set()
};

function createResource(
  id: string,
  resourceKind: ResidentResourceKind,
  options: Partial<ResidentResourceMetadata> = {}
): ResidentResourceMetadata {
  const evict = vi.fn(() => options.bytes ?? 10);
  return {
    sessionId: options.sessionId ?? id,
    layerIndex: options.layerIndex ?? 0,
    sourceName: options.sourceName ?? id,
    resourceKind,
    bytes: options.bytes ?? 10,
    lastAccessToken: options.lastAccessToken ?? 1,
    accessCount: options.accessCount ?? 1,
    visible: options.visible ?? false,
    pinned: options.pinned ?? false,
    evict: options.evict ?? evict
  };
}

describe('memory manager eviction', () => {
  it('keeps visible, pinned, and active binding resources protected under pressure', () => {
    const visible = createResource('visible', 'source-texture', { visible: true });
    const pinned = createResource('pinned', 'source-texture', { pinned: true });
    const active = createResource('active', 'source-texture', {
      sessionId: 'session-active',
      sourceName: 'R'
    });
    const old = createResource('old', 'source-texture', { bytes: 15, lastAccessToken: 0 });
    const context: EvictionContext = {
      activeSessionId: 'session-active',
      visibleSessionIds: new Set(['visible']),
      activeBindings: [{
        sessionId: 'session-active',
        layerIndex: 0,
        sourceNames: new Set(['R'])
      }],
      pinnedSessionIds: new Set(['pinned'])
    };

    const result = enforceMemoryBudget({
      resources: [visible, pinned, active, old],
      trackedBytes: 45,
      budgetBytes: 30,
      context
    });

    expect(result.evictedResources).toEqual([old]);
    expect(visible.evict).not.toHaveBeenCalled();
    expect(pinned.evict).not.toHaveBeenCalled();
    expect(active.evict).not.toHaveBeenCalled();
    expect(old.evict).toHaveBeenCalledTimes(1);
  });

  it('allows the budget to remain exceeded when only protected resources exist', () => {
    const visible = createResource('visible', 'source-texture', { visible: true, bytes: 100 });

    const result = enforceMemoryBudget({
      resources: [visible],
      trackedBytes: 100,
      budgetBytes: 10,
      context: EMPTY_CONTEXT
    });

    expect(result.overBudget).toBe(true);
    expect(result.evictedBytes).toBe(0);
    expect(visible.evict).not.toHaveBeenCalled();
  });

  it('orders candidates by derived texture, source texture, CPU materialized, then analysis cache', () => {
    const resources = [
      createResource('analysis', 'analysis-cache'),
      createResource('cpu', 'cpu-materialized'),
      createResource('source', 'source-texture'),
      createResource('derived', 'derived-texture')
    ];

    expect(getEvictionCandidates(resources, EMPTY_CONTEXT, 100).map((resource) => resource.resourceKind)).toEqual([
      'derived-texture',
      'source-texture',
      'cpu-materialized',
      'analysis-cache'
    ]);
  });

  it('evicts large one-shot derived textures before older small source textures', () => {
    const oldSource = createResource('old-source', 'source-texture', {
      bytes: 10,
      lastAccessToken: 1,
      accessCount: 20
    });
    const hugeDerived = createResource('huge-derived', 'derived-texture', {
      bytes: 40,
      lastAccessToken: 100,
      accessCount: 1
    });

    const result = enforceMemoryBudget({
      resources: [oldSource, hugeDerived],
      trackedBytes: 50,
      budgetBytes: 20,
      context: EMPTY_CONTEXT
    });

    expect(result.evictedResources[0]).toBe(hugeDerived);
    expect(hugeDerived.evict).toHaveBeenCalledTimes(1);
    expect(oldSource.evict).not.toHaveBeenCalled();
  });
});
