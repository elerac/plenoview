import { describe, expect, it } from 'vitest';
import {
  clampDepthYaw,
  computeFinitePositionBounds,
  computePositiveFiniteDepthRange,
  DEPTH_NDC_LIMIT,
  DepthProbeProjectionCache,
  getDepthChannelOptions,
  getDepthSourceOptions,
  hasDepthChannelCandidate,
  isDepthSampledPixel,
  normalizeDepthPitchForSource,
  normalizeDepthYawForSource,
  pickDepthPixelAtScreenPoint,
  projectDepthPixelToScreen,
  projectDepthPixelToPoint,
  projectPositionPointToScreen,
  resolveDepthChannelForLayer,
  resolveDepthSourceForLayer,
  resolveDepthFocalLengthPx,
  resolveDepthPointSampling,
  serializeDepthSource
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

  it('offers recognized position triplets as depth sources', () => {
    const options = getDepthSourceOptions([
      'R',
      'G',
      'B',
      'P.X',
      'P.Y',
      'P.Z',
      'Position.X',
      'Position.Y',
      'Position.Z',
      'position.X',
      'position.Y',
      'position.Z',
      'Z'
    ]);

    expect(options.map((option) => option.value).slice(0, 3)).toEqual([
      '__position:P',
      '__position:Position',
      '__position:position'
    ]);
    expect(options).toContainEqual({ value: 'Z', label: 'Z' });
  });

  it('prefers position triplets before scalar depth when no current source is valid', () => {
    const source = resolveDepthSourceForLayer([
      'Z',
      'P.X',
      'P.Y',
      'P.Z',
      'Position.X',
      'Position.Y',
      'Position.Z'
    ], null, {
      allowArbitraryZSuffix: true
    });

    expect(source).toEqual({
      kind: 'xyzPosition',
      base: 'P',
      xChannel: 'P.X',
      yChannel: 'P.Y',
      zChannel: 'P.Z'
    });
    expect(resolveDepthChannelForLayer(['Z', 'P.X', 'P.Y', 'P.Z'], null, {
      allowArbitraryZSuffix: true
    })).toBe('__position:P');
  });

  it('preserves a valid current scalar or position depth source', () => {
    expect(resolveDepthChannelForLayer(['Z', 'P.X', 'P.Y', 'P.Z'], 'Z', {
      allowArbitraryZSuffix: true
    })).toBe('Z');
    expect(resolveDepthChannelForLayer(['Z', 'P.X', 'P.Y', 'P.Z'], '__position:P', {
      allowArbitraryZSuffix: true
    })).toBe('__position:P');
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

  it('normalizes depth orbit angles by source kind', () => {
    expect(normalizeDepthYawForSource(120, 'Z')).toBe(89.9);
    expect(normalizeDepthPitchForSource(-120, 'Z')).toBe(-89.9);
    expect(normalizeDepthYawForSource(120, '__position:P')).toBe(120);
    expect(normalizeDepthPitchForSource(-120, 'xyzPosition')).toBe(-120);
    expect(normalizeDepthYawForSource(270, '__position:P')).toBe(-90);
    expect(normalizeDepthPitchForSource(181, '__position:P')).toBe(-179);
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

  it('gates position depth sources through position recognition settings', () => {
    const channelRecognitionSettings = {
      ...createDefaultChannelRecognitionSettings(),
      'position.map': false
    };

    expect(resolveDepthChannelForLayer(['P.X', 'P.Y', 'P.Z'], null, {
      allowArbitraryZSuffix: true,
      channelRecognitionSettings
    })).toBe('P.Z');
    expect(getDepthSourceOptions(['P.X', 'P.Y', 'P.Z'], {
      channelRecognitionSettings
    }).map((option) => option.value)).toEqual(['P.Z']);
  });

  it('keeps position depth sources independent from generic XYZ component recognition settings', () => {
    const channelRecognitionSettings = {
      ...createDefaultChannelRecognitionSettings(),
      'component.xyz': false
    };

    expect(resolveDepthChannelForLayer(['P.X', 'P.Y', 'P.Z'], null, {
      allowArbitraryZSuffix: true,
      channelRecognitionSettings
    })).toBe('__position:P');
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

  it('uses custom position name rules for depth source triplets', () => {
    const channelRecognitionNameRules = createDefaultChannelRecognitionNameRules();
    channelRecognitionNameRules['position.map'] = {
      pattern: '^(?<base>worldPosition)\\.(?:(?<x>px)|(?<y>py)|(?<z>pz))$'
    };

    expect(resolveDepthChannelForLayer([
      'Z',
      'worldPosition.px',
      'worldPosition.py',
      'worldPosition.pz'
    ], null, {
      channelRecognitionNameRules
    })).toBe('__position:worldPosition');
    expect(getDepthSourceOptions([
      'worldPosition.px',
      'worldPosition.py',
      'worldPosition.pz',
      'Z'
    ], {
      channelRecognitionNameRules
    })).toContainEqual({
      value: '__position:worldPosition',
      label: 'worldPosition.px/worldPosition.py/worldPosition.pz'
    });
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

  it('computes finite position bounds and projects position points', () => {
    const layer = createLayerFromChannels({
      'P.X': [-1, 1, Number.NaN, 4],
      'P.Y': [-2, 2, 0, Number.POSITIVE_INFINITY],
      'P.Z': [-3, 3, 0, 6]
    });
    const source = resolveDepthSourceForLayer(layer.channelNames, null);

    expect(source?.kind).toBe('xyzPosition');
    expect(source ? serializeDepthSource(source) : null).toBe('__position:P');
    if (!source || source.kind !== 'xyzPosition') {
      throw new Error('Expected position depth source.');
    }

    const bounds = computeFinitePositionBounds(layer, 2, 2, source);
    expect(bounds).toEqual({
      minX: -1,
      maxX: 1,
      minY: -2,
      maxY: 2,
      minZ: -3,
      maxZ: 3
    });
    expect(projectPositionPointToScreen(0, 0, { x: -1, y: -2, z: -3 }, {
      width: 2,
      height: 2,
      viewport: { width: 100, height: 100 },
      bounds: bounds!,
      depthFocalLengthPx: null,
      depthYawDeg: 0,
      depthPitchDeg: 0,
      depthZoom: 1,
      depthPointSizePx: 2
    })).toMatchObject({
      pixel: { ix: 0, iy: 0 },
      screenX: expect.any(Number),
      screenY: expect.any(Number),
      depth: -3
    });
  });

  it('projects position points with unrestricted orbit angles', () => {
    const bounds = {
      minX: -1,
      maxX: 1,
      minY: -1,
      maxY: 1,
      minZ: -1,
      maxZ: 1
    };
    const projection = projectPositionPointToScreen(0, 0, { x: 1, y: 0, z: 0 }, {
      width: 1,
      height: 1,
      viewport: { width: 100, height: 100 },
      bounds,
      depthFocalLengthPx: null,
      depthYawDeg: 120,
      depthPitchDeg: 0,
      depthZoom: 1,
      depthPointSizePx: 2
    });
    const clampedProjection = projectPositionPointToScreen(0, 0, { x: 1, y: 0, z: 0 }, {
      width: 1,
      height: 1,
      viewport: { width: 100, height: 100 },
      bounds,
      depthFocalLengthPx: null,
      depthYawDeg: 89.9,
      depthPitchDeg: 0,
      depthZoom: 1,
      depthPointSizePx: 2
    });

    expect(projection).not.toBeNull();
    expect(clampedProjection).not.toBeNull();
    expect(projection!.screenX).toBeCloseTo(25, 6);
    expect(projection!.screenX).not.toBeCloseTo(clampedProjection!.screenX, 2);
  });

  it('projects cached position probe pixels with unrestricted orbit angles', () => {
    const layer = createLayerFromChannels({
      'P.X': [1],
      'P.Y': [0],
      'P.Z': [0]
    });
    const cache = new DepthProbeProjectionCache();
    const projection = cache.projectPixel({ ix: 0, iy: 0 }, {
      layer,
      width: 1,
      height: 1,
      source: {
        kind: 'xyzPosition',
        base: 'P',
        xChannel: 'P.X',
        yChannel: 'P.Y',
        zChannel: 'P.Z'
      },
      viewport: { width: 100, height: 100 },
      geometry: {
        kind: 'xyzPosition',
        bounds: {
          minX: -1,
          maxX: 1,
          minY: -1,
          maxY: 1,
          minZ: -1,
          maxZ: 1
        }
      },
      depthFocalLengthPx: null,
      depthYawDeg: 120,
      depthPitchDeg: 0,
      depthZoom: 1,
      depthPointSizePx: 2
    });

    expect(projection).not.toBeNull();
    expect(projection!.screenX).toBeCloseTo(25, 6);
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

  it('picks projected position pixels using finite XYZ bounds', () => {
    const layer = createLayerFromChannels({
      'P.X': [0, 2],
      'P.Y': [0, 0],
      'P.Z': [0, 0]
    });
    const source = {
      kind: 'xyzPosition' as const,
      base: 'P',
      xChannel: 'P.X',
      yChannel: 'P.Y',
      zChannel: 'P.Z'
    };

    expect(pickDepthPixelAtScreenPoint({ x: 0, y: 50 }, {
      layer,
      width: 2,
      height: 1,
      source,
      viewport: { width: 100, height: 100 },
      geometry: {
        kind: 'xyzPosition',
        bounds: {
          minX: 0,
          maxX: 2,
          minY: 0,
          maxY: 0,
          minZ: 0,
          maxZ: 0
        }
      },
      depthFocalLengthPx: null,
      depthYawDeg: 0,
      depthPitchDeg: 0,
      depthZoom: 1,
      depthPointSizePx: 8
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

  it('keeps projected depth ordering independent from 3D zoom', () => {
    const viewport = { width: 200, height: 200 };
    const baseOptions = {
      width: 2,
      height: 1,
      viewport,
      depthRange: { min: 1, max: 10 },
      depthFocalLengthPx: 2,
      depthYawDeg: 0,
      depthPitchDeg: 0,
      depthPointSizePx: 2
    };
    const normalZoom = projectDepthPixelToScreen(1, 0, 10, {
      ...baseOptions,
      depthZoom: 1
    });
    const highZoom = projectDepthPixelToScreen(1, 0, 10, {
      ...baseOptions,
      depthZoom: 50
    });

    expect(normalZoom).not.toBeNull();
    expect(highZoom).not.toBeNull();
    expect(highZoom!.ndcZ).toBeCloseTo(normalZoom!.ndcZ, 7);
    expect(highZoom!.screenX).not.toBeCloseTo(normalZoom!.screenX, 2);
  });

  it('applies depth target translation while projecting depth points', () => {
    const viewport = { width: 100, height: 100 };
    const centeredProjection = projectDepthPixelToScreen(0, 0, 1, {
      width: 1,
      height: 1,
      viewport,
      depthRange: { min: 1, max: 1 },
      depthFocalLengthPx: null,
      depthYawDeg: 0,
      depthPitchDeg: 0,
      depthZoom: 1,
      depthTargetX: 0,
      depthTargetY: 0,
      depthTargetZ: 0,
      depthPointSizePx: 2
    });
    const pannedProjection = projectDepthPixelToScreen(0, 0, 1, {
      width: 1,
      height: 1,
      viewport,
      depthRange: { min: 1, max: 1 },
      depthFocalLengthPx: null,
      depthYawDeg: 0,
      depthPitchDeg: 0,
      depthZoom: 1,
      depthTargetX: -0.1,
      depthTargetY: 0.2,
      depthTargetZ: 0,
      depthPointSizePx: 2
    });

    expect(centeredProjection).not.toBeNull();
    expect(pannedProjection).not.toBeNull();
    expect(centeredProjection!.screenX).toBeCloseTo(50);
    expect(centeredProjection!.screenY).toBeCloseTo(50);
    expect(pannedProjection!.screenX).toBeCloseTo(60);
    expect(pannedProjection!.screenY).toBeCloseTo(70);
  });

  it('applies depth target translation while projecting cached scalar probe pixels', () => {
    const layer = createLayerFromChannels({
      Z: [1]
    });
    const projection = new DepthProbeProjectionCache().projectPixel({ ix: 0, iy: 0 }, {
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
      depthTargetX: -0.1,
      depthTargetY: 0.2,
      depthTargetZ: 0,
      depthPointSizePx: 2
    });

    expect(projection).not.toBeNull();
    expect(projection!.screenX).toBeCloseTo(60);
    expect(projection!.screenY).toBeCloseTo(70);
  });

  it('applies depth target translation while projecting cached position probe pixels', () => {
    const layer = createLayerFromChannels({
      'P.X': [0],
      'P.Y': [0],
      'P.Z': [0]
    });
    const projection = new DepthProbeProjectionCache().projectPixel({ ix: 0, iy: 0 }, {
      layer,
      width: 1,
      height: 1,
      source: {
        kind: 'xyzPosition',
        base: 'P',
        xChannel: 'P.X',
        yChannel: 'P.Y',
        zChannel: 'P.Z'
      },
      viewport: { width: 100, height: 100 },
      geometry: {
        kind: 'xyzPosition',
        bounds: {
          minX: -1,
          maxX: 1,
          minY: -1,
          maxY: 1,
          minZ: -1,
          maxZ: 1
        }
      },
      depthFocalLengthPx: null,
      depthYawDeg: 0,
      depthPitchDeg: 0,
      depthZoom: 1,
      depthTargetX: -0.1,
      depthTargetY: 0.2,
      depthTargetZ: 0,
      depthPointSizePx: 2
    });

    expect(projection).not.toBeNull();
    expect(projection!.screenX).toBeCloseTo(60);
    expect(projection!.screenY).toBeCloseTo(70);
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

  it('keeps high-zoom scalar depth picking ordered by true camera depth', () => {
    const layer = createLayerFromChannels({
      Z: [100, 90]
    });

    expect(pickDepthPixelAtScreenPoint({ x: 50, y: 50 }, {
      layer,
      width: 2,
      height: 1,
      channelName: 'Z',
      viewport: { width: 100, height: 100 },
      depthRange: { min: 1, max: 100 },
      depthFocalLengthPx: 2000,
      depthYawDeg: 0,
      depthPitchDeg: 0,
      depthZoom: 50,
      depthPointSizePx: 2,
      hitRadiusPx: 100
    })).toEqual({ ix: 1, iy: 0 });
  });

  it('keeps high-zoom XYZ position picking ordered by true camera depth', () => {
    const layer = createLayerFromChannels({
      'P.X': [0, 0],
      'P.Y': [0, 0],
      'P.Z': [10, 8]
    });
    const source = {
      kind: 'xyzPosition' as const,
      base: 'P',
      xChannel: 'P.X',
      yChannel: 'P.Y',
      zChannel: 'P.Z'
    };

    expect(pickDepthPixelAtScreenPoint({ x: 50, y: 50 }, {
      layer,
      width: 2,
      height: 1,
      source,
      viewport: { width: 100, height: 100 },
      geometry: {
        kind: 'xyzPosition',
        bounds: {
          minX: 0,
          maxX: 0,
          minY: 0,
          maxY: 0,
          minZ: 0,
          maxZ: 10
        }
      },
      depthFocalLengthPx: null,
      depthYawDeg: 0,
      depthPitchDeg: 0,
      depthZoom: 50,
      depthPointSizePx: 2,
      hitRadiusPx: 100
    })).toEqual({ ix: 1, iy: 0 });
  });

  it('keeps degenerate and large depth ranges inside the open NDC range', () => {
    const equalScalarDepth = projectDepthPixelToScreen(0, 0, 1, {
      width: 1,
      height: 1,
      viewport: { width: 100, height: 100 },
      depthRange: { min: 1, max: 1 },
      depthFocalLengthPx: null,
      depthYawDeg: 0,
      depthPitchDeg: 0,
      depthZoom: 50,
      depthTargetX: -0.1,
      depthTargetY: 0.2,
      depthTargetZ: 0.3,
      depthPointSizePx: 2
    });
    const largeScalarDepth = projectDepthPixelToScreen(0, 0, 1.0e9, {
      width: 1,
      height: 1,
      viewport: { width: 100, height: 100 },
      depthRange: { min: 1, max: 1.0e9 },
      depthFocalLengthPx: null,
      depthYawDeg: 0,
      depthPitchDeg: 0,
      depthZoom: 50,
      depthPointSizePx: 2
    });
    const zeroSpanPosition = projectPositionPointToScreen(0, 0, { x: 5, y: -2, z: 7 }, {
      width: 1,
      height: 1,
      viewport: { width: 100, height: 100 },
      bounds: {
        minX: 5,
        maxX: 5,
        minY: -2,
        maxY: -2,
        minZ: 7,
        maxZ: 7
      },
      depthFocalLengthPx: null,
      depthYawDeg: 120,
      depthPitchDeg: -45,
      depthZoom: 50,
      depthTargetX: 0.1,
      depthTargetY: -0.2,
      depthTargetZ: 0.3,
      depthPointSizePx: 2
    });

    expect(equalScalarDepth).not.toBeNull();
    expect(largeScalarDepth).not.toBeNull();
    expect(zeroSpanPosition).not.toBeNull();
    expect(Math.abs(equalScalarDepth!.ndcZ)).toBeLessThan(DEPTH_NDC_LIMIT);
    expect(Math.abs(largeScalarDepth!.ndcZ)).toBeLessThanOrEqual(DEPTH_NDC_LIMIT);
    expect(Math.abs(zeroSpanPosition!.ndcZ)).toBeLessThan(DEPTH_NDC_LIMIT);
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
      depthTargetX: -0.1
    });
    expect(getDepthProbeCacheDebug(cache).frameBuildCount).toBe(3);

    cache.pick({ x: 50, y: 50 }, {
      ...base,
      viewport: { width: 120, height: 100 }
    });
    expect(getDepthProbeCacheDebug(cache).frameBuildCount).toBe(4);

    cache.pick({ x: 50, y: 50 }, {
      ...base,
      channelName: 'depth.Z'
    });
    expect(getDepthProbeCacheDebug(cache).frameBuildCount).toBe(5);
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
