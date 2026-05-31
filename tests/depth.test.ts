import { describe, expect, it } from 'vitest';
import {
  clampDepthYaw,
  computePositiveFiniteDepthRange,
  DepthProbeProjectionCache,
  getDepthChannelOptions,
  hasDepthChannelCandidate,
  isDepthSampledPixel,
  pickDepthPixelAtScreenPoint,
  projectDepthPixelToScreen,
  projectDepthPixelToPoint,
  resolveDepthChannelForLayer,
  resolveDepthFocalLengthPx,
  resolveDepthPointSampling
} from '../src/depth';
import { createDefaultChannelRecognitionSettings } from '../src/channel-recognition-settings';
import { createDefaultChannelRecognitionNameRules } from '../src/channel-recognition-name-rules';
import { createLayerFromChannels } from './helpers/state-fixtures';

describe('depth utilities', () => {
  it('resolves preferred depth channels in priority order', () => {
    expect(resolveDepthChannelForLayer(['R', 'G', 'B', 'Z'], null)).toBe('Z');
    expect(resolveDepthChannelForLayer(['R', 'depth.Z', 'B'], null)).toBe('depth.Z');
    expect(resolveDepthChannelForLayer(['beauty.R', 'cameraDepth.Z', 'beauty.G'], null)).toBe('cameraDepth.Z');
  });

  it('preserves a valid current depth channel', () => {
    expect(resolveDepthChannelForLayer(['Z', 'depth.Z'], 'depth.Z')).toBe('depth.Z');
  });

  it('clamps depth yaw to the front-facing range', () => {
    expect(clampDepthYaw(45)).toBe(45);
    expect(clampDepthYaw(120)).toBe(89.9);
    expect(clampDepthYaw(-120)).toBe(-89.9);
    expect(clampDepthYaw(180)).toBe(89.9);
    expect(clampDepthYaw(181)).toBe(89.9);
    expect(clampDepthYaw(-181)).toBe(-89.9);
    expect(clampDepthYaw(270)).toBe(89.9);
  });

  it('only selects arbitrary .Z suffix channels when explicitly allowed', () => {
    expect(resolveDepthChannelForLayer(['beauty.R', 'beauty.Z'], null)).toBeNull();
    expect(resolveDepthChannelForLayer(['beauty.R', 'beauty.Z'], null, {
      allowArbitraryZSuffix: true
    })).toBe('beauty.Z');
  });

  it('gates depth detection through channel recognition settings', () => {
    const channelRecognitionSettings = {
      ...createDefaultChannelRecognitionSettings(),
      'depth.map': false
    };

    expect(resolveDepthChannelForLayer(['Z', 'depth.Z'], null, {
      allowArbitraryZSuffix: true,
      channelRecognitionSettings
    })).toBeNull();
    expect(getDepthChannelOptions(['Z', 'depth.Z'], { channelRecognitionSettings })).toEqual([]);
    expect(hasDepthChannelCandidate(['Z'], { channelRecognitionSettings })).toBe(false);
  });

  it('uses custom depth name rules before arbitrary .Z fallback', () => {
    const channelRecognitionNameRules = createDefaultChannelRecognitionNameRules();
    channelRecognitionNameRules['depth.map'] = {
      pattern: '^(?<depth>worldDepth)$'
    };

    expect(resolveDepthChannelForLayer(['Z', 'worldDepth', 'beauty.Z'], null, {
      channelRecognitionNameRules
    })).toBe('worldDepth');
    expect(resolveDepthChannelForLayer(['Z', 'beauty.Z'], null, {
      channelRecognitionNameRules,
      allowArbitraryZSuffix: true
    })).toBe('beauty.Z');
    expect(getDepthChannelOptions(['worldDepth', 'beauty.Z'], {
      channelRecognitionNameRules
    }).map((option) => option.value)).toEqual(['worldDepth', 'beauty.Z']);
  });

  it('projects pixel centers with auto and manual focal length', () => {
    expect(projectDepthPixelToPoint(0, 0, 2, 4, 2, 4)).toEqual({
      x: -0.75,
      y: 0.25,
      z: 2
    });
    expect(resolveDepthFocalLengthPx(4, 2, null)).toBe(4);
    expect(resolveDepthFocalLengthPx(4, 2, 10)).toBe(10);
  });

  it('rejects invalid depth samples and computes positive finite range', () => {
    const layer = createLayerFromChannels({
      Z: [1, Number.NaN, -1, Number.POSITIVE_INFINITY, 5, 0]
    });

    expect(projectDepthPixelToPoint(0, 0, 0, 2, 3, null)).toBeNull();
    expect(projectDepthPixelToPoint(0, 0, Number.NaN, 2, 3, null)).toBeNull();
    expect(projectDepthPixelToScreen(2, 0, 1, {
      width: 2,
      height: 1,
      viewport: { width: 100, height: 100 },
      depthRange: { min: 1, max: 1 },
      depthFocalLengthPx: null,
      depthYawDeg: 0,
      depthPitchDeg: 0,
      depthZoom: 1,
      depthPointSizePx: 2
    })).toBeNull();
    expect(computePositiveFiniteDepthRange(layer, 2, 3, 'Z')).toEqual({ min: 1, max: 5 });
  });

  it('limits point sampling to the configured budget', () => {
    expect(resolveDepthPointSampling(100, 100, 1_000_000)).toEqual({
      step: 1,
      gridWidth: 100,
      gridHeight: 100,
      pointCount: 10_000
    });
    expect(resolveDepthPointSampling(2000, 2000, 1_000_000)).toEqual({
      step: 2,
      gridWidth: 1000,
      gridHeight: 1000,
      pointCount: 1_000_000
    });
    expect(isDepthSampledPixel({ ix: 0, iy: 0 }, 4, 1, 1)).toBe(true);
    expect(isDepthSampledPixel({ ix: 1, iy: 0 }, 4, 1, 1)).toBe(false);
  });

  it('picks the visible projected depth point at the cursor', () => {
    const layer = createLayerFromChannels({
      Z: [2]
    });
    const viewport = { width: 100, height: 100 };

    expect(pickDepthPixelAtScreenPoint({ x: 50, y: 50 }, {
      layer,
      width: 1,
      height: 1,
      channelName: 'Z',
      viewport,
      depthRange: { min: 2, max: 2 },
      depthFocalLengthPx: null,
      depthYawDeg: 0,
      depthPitchDeg: 0,
      depthZoom: 1,
      depthPointSizePx: 2
    })).toEqual({ ix: 0, iy: 0 });
  });

  it('skips invalid depth points while picking', () => {
    const layer = createLayerFromChannels({
      Z: [0, Number.NaN, Number.POSITIVE_INFINITY, -1]
    });

    expect(pickDepthPixelAtScreenPoint({ x: 50, y: 50 }, {
      layer,
      width: 2,
      height: 2,
      channelName: 'Z',
      viewport: { width: 100, height: 100 },
      depthRange: { min: 1, max: 1 },
      depthFocalLengthPx: null,
      depthYawDeg: 0,
      depthPitchDeg: 0,
      depthZoom: 1,
      depthPointSizePx: 8
    })).toBeNull();
  });

  it('limits depth picking to rendered sampled pixels', () => {
    const layer = createLayerFromChannels({
      Z: [1, 1, 1, 1]
    });
    const viewport = { width: 400, height: 400 };
    const unsampledProjection = projectDepthPixelToScreen(1, 0, 1, {
      width: 4,
      height: 1,
      viewport,
      depthRange: { min: 1, max: 1 },
      depthFocalLengthPx: 4,
      depthYawDeg: 0,
      depthPitchDeg: 0,
      depthZoom: 1,
      depthPointSizePx: 2
    });

    expect(unsampledProjection).not.toBeNull();
    expect(pickDepthPixelAtScreenPoint({
      x: unsampledProjection!.screenX,
      y: unsampledProjection!.screenY
    }, {
      layer,
      width: 4,
      height: 1,
      channelName: 'Z',
      viewport,
      depthRange: { min: 1, max: 1 },
      depthFocalLengthPx: 4,
      depthYawDeg: 0,
      depthPitchDeg: 0,
      depthZoom: 1,
      depthPointSizePx: 2,
      maxPoints: 1
    })).toBeNull();
    expect(new DepthProbeProjectionCache().projectPixel({ ix: 1, iy: 0 }, {
      layer,
      width: 4,
      height: 1,
      channelName: 'Z',
      viewport,
      depthRange: { min: 1, max: 1 },
      depthFocalLengthPx: 4,
      depthYawDeg: 0,
      depthPitchDeg: 0,
      depthZoom: 1,
      depthPointSizePx: 2,
      maxPoints: 1
    })).toBeNull();
  });

  it('uses focal length, yaw, pitch, and zoom while projecting depth points', () => {
    const viewport = { width: 200, height: 200 };
    const wideProjection = projectDepthPixelToScreen(1, 0, 2, {
      width: 2,
      height: 1,
      viewport,
      depthRange: { min: 2, max: 2 },
      depthFocalLengthPx: 2,
      depthYawDeg: 0,
      depthPitchDeg: 0,
      depthZoom: 1,
      depthPointSizePx: 2
    });
    const narrowProjection = projectDepthPixelToScreen(1, 0, 2, {
      width: 2,
      height: 1,
      viewport,
      depthRange: { min: 2, max: 2 },
      depthFocalLengthPx: 20,
      depthYawDeg: 30,
      depthPitchDeg: 20,
      depthZoom: 2,
      depthPointSizePx: 2
    });

    expect(wideProjection).not.toBeNull();
    expect(narrowProjection).not.toBeNull();
    expect(narrowProjection!.screenX).not.toBeCloseTo(wideProjection!.screenX);
    expect(narrowProjection!.screenY).not.toBeCloseTo(wideProjection!.screenY);
  });

  it('chooses the frontmost point when projected depth hits overlap', () => {
    const layer = createLayerFromChannels({
      Z: [1, 10]
    });

    expect(pickDepthPixelAtScreenPoint({ x: 50, y: 50 }, {
      layer,
      width: 2,
      height: 1,
      channelName: 'Z',
      viewport: { width: 100, height: 100 },
      depthRange: { min: 1, max: 10 },
      depthFocalLengthPx: 2,
      depthYawDeg: 0,
      depthPitchDeg: 0,
      depthZoom: 1,
      depthPointSizePx: 2,
      hitRadiusPx: 1000
    })).toEqual({ ix: 0, iy: 0 });
  });

  it('honors depth point hit radius and missing prerequisites', () => {
    const layer = createLayerFromChannels({
      Z: [1]
    });
    const base = {
      layer,
      width: 1,
      height: 1,
      channelName: 'Z',
      viewport: { width: 100, height: 100 },
      depthRange: { min: 1, max: 1 },
      depthFocalLengthPx: null,
      depthYawDeg: 0,
      depthPitchDeg: 0,
      depthZoom: 1,
      depthPointSizePx: 2
    };

    expect(pickDepthPixelAtScreenPoint({ x: 53, y: 50 }, base)).toEqual({ ix: 0, iy: 0 });
    expect(pickDepthPixelAtScreenPoint({ x: 54, y: 50 }, base)).toBeNull();
    expect(pickDepthPixelAtScreenPoint({ x: 50, y: 50 }, {
      ...base,
      channelName: null
    })).toBeNull();
    expect(pickDepthPixelAtScreenPoint({ x: 50, y: 50 }, {
      ...base,
      viewport: { width: 0, height: 100 }
    })).toBeNull();
  });

  it('uses a spatial grid for cached depth picking', () => {
    const width = 100;
    const height = 100;
    const layer = createLayerFromChannels({
      Z: new Float32Array(width * height).fill(1)
    });
    const cache = new DepthProbeProjectionCache();
    const args = {
      layer,
      width,
      height,
      channelName: 'Z',
      viewport: { width: 1000, height: 1000 },
      depthRange: { min: 1, max: 1 },
      depthFocalLengthPx: 100,
      depthYawDeg: 0,
      depthPitchDeg: 0,
      depthZoom: 1,
      depthPointSizePx: 2
    };

    expect(cache.pick({ x: 495, y: 495 }, args)).toEqual({ ix: 49, iy: 49 });

    const debug = getDepthProbeCacheDebug(cache);
    expect(debug.frameBuildCount).toBe(1);
    expect(debug.lastPickCandidateCount).toBeGreaterThan(0);
    expect(debug.lastPickCandidateCount).toBeLessThan(width * height);

    cache.pick({ x: 495, y: 495 }, args);
    expect(debug.frameBuildCount).toBe(1);
    expect(debug.lastPickCandidateCount).toBeLessThan(width * height);
  });

  it('reuses projected depth frame coordinates when only point size changes', () => {
    const layer = createLayerFromChannels({
      Z: [1]
    });
    const cache = new DepthProbeProjectionCache();
    const base = {
      layer,
      width: 1,
      height: 1,
      channelName: 'Z',
      viewport: { width: 100, height: 100 },
      depthRange: { min: 1, max: 1 },
      depthFocalLengthPx: null,
      depthYawDeg: 0,
      depthPitchDeg: 0,
      depthZoom: 1
    };

    expect(cache.pick({ x: 54, y: 50 }, {
      ...base,
      depthPointSizePx: 2
    })).toBeNull();
    expect(getDepthProbeCacheDebug(cache).frameBuildCount).toBe(1);

    expect(cache.pick({ x: 54, y: 50 }, {
      ...base,
      depthPointSizePx: 8
    })).toEqual({ ix: 0, iy: 0 });
    expect(getDepthProbeCacheDebug(cache).frameBuildCount).toBe(1);
  });

  it('rebuilds projected depth frames when projection inputs change', () => {
    const layer = createLayerFromChannels({
      Z: [1],
      'depth.Z': [2]
    });
    const cache = new DepthProbeProjectionCache();
    const base = {
      layer,
      width: 1,
      height: 1,
      channelName: 'Z',
      viewport: { width: 100, height: 100 },
      depthRange: { min: 1, max: 2 },
      depthFocalLengthPx: null,
      depthYawDeg: 0,
      depthPitchDeg: 0,
      depthZoom: 1,
      depthPointSizePx: 2
    };

    cache.pick({ x: 50, y: 50 }, base);
    expect(getDepthProbeCacheDebug(cache).frameBuildCount).toBe(1);

    cache.pick({ x: 50, y: 50 }, {
      ...base,
      depthYawDeg: 10
    });
    expect(getDepthProbeCacheDebug(cache).frameBuildCount).toBe(2);

    cache.pick({ x: 50, y: 50 }, {
      ...base,
      viewport: { width: 120, height: 100 }
    });
    expect(getDepthProbeCacheDebug(cache).frameBuildCount).toBe(3);

    cache.pick({ x: 50, y: 50 }, {
      ...base,
      channelName: 'depth.Z'
    });
    expect(getDepthProbeCacheDebug(cache).frameBuildCount).toBe(4);
  });
});

function getDepthProbeCacheDebug(cache: DepthProbeProjectionCache): {
  frameBuildCount: number;
  lastPickCandidateCount: number;
} {
  return cache as unknown as {
    frameBuildCount: number;
    lastPickCandidateCount: number;
  };
}
