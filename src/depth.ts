import {
  getChannelReadView,
  readChannelValue
} from './channel-storage';
import {
  normalizeChannelRecognitionSettings,
  type ChannelRecognitionSettings
} from './channel-recognition-settings';
import {
  compileChannelRecognitionNameRules,
  parseDepthMapChannelNameWithRules,
  parsePositionMapChannelNameWithRules,
  type ChannelRecognitionNameRules,
  type CompiledChannelRecognitionNameRules
} from './channel-recognition-name-rules';
import type {
  DecodedLayer,
  DisplayLuminanceRange,
  ImagePixel,
  ViewportInfo
} from './types';

export const MIN_DEPTH_YAW_DEG = -89.9;
export const MAX_DEPTH_YAW_DEG = 89.9;
export const MIN_DEPTH_PITCH_DEG = -89.9;
export const MAX_DEPTH_PITCH_DEG = 89.9;
export const DEFAULT_DEPTH_ZOOM = 1;
export const MIN_DEPTH_ZOOM = 0.05;
export const MAX_DEPTH_ZOOM = 50;
export const DEFAULT_DEPTH_TARGET = 0;
export const DEFAULT_DEPTH_POINT_SIZE_PX = 2;
export const MIN_DEPTH_POINT_SIZE_PX = 1;
export const MAX_DEPTH_POINT_SIZE_PX = 8;
export const MAX_DEPTH_POINTS = 1_000_000;
const DEPTH_PROBE_SPATIAL_GRID_CELL_SIZE_PX = 16;
const DEPTH_PROBE_FRAME_MARGIN_PX = Math.max(MAX_DEPTH_POINT_SIZE_PX * 0.5, 3);

export interface DepthChannelOption {
  value: string;
  label: string;
}

export type DepthSourceKind = 'scalarDepth' | 'xyzPosition';
export type DepthRotationSource = DepthSource | DepthSourceKind | string | null | undefined;

export interface ScalarDepthSource {
  kind: 'scalarDepth';
  channelName: string;
}

export interface XyzPositionDepthSource {
  kind: 'xyzPosition';
  base: string;
  xChannel: string;
  yChannel: string;
  zChannel: string;
}

export type DepthSource = ScalarDepthSource | XyzPositionDepthSource;

export interface DepthPositionBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

export type DepthSourceGeometry =
  | {
      kind: 'scalarDepth';
      range: DisplayLuminanceRange;
    }
  | {
      kind: 'xyzPosition';
      bounds: DepthPositionBounds;
    };

export interface ResolveDepthChannelOptions {
  allowArbitraryZSuffix?: boolean;
  channelRecognitionSettings?: ChannelRecognitionSettings;
  channelRecognitionNameRules?: ChannelRecognitionNameRules;
}

export interface DepthChannelOptionsConfig {
  allowArbitraryZSuffix?: boolean;
  channelRecognitionSettings?: ChannelRecognitionSettings;
  channelRecognitionNameRules?: ChannelRecognitionNameRules;
}

export interface DepthPointSampling {
  step: number;
  gridWidth: number;
  gridHeight: number;
  pointCount: number;
}

export interface DepthPoint {
  x: number;
  y: number;
  z: number;
}

export interface DepthProjectionView {
  depthFocalLengthPx: number | null | undefined;
  depthYawDeg: number;
  depthPitchDeg: number;
  depthZoom: number;
  depthTargetX?: number;
  depthTargetY?: number;
  depthTargetZ?: number;
  depthPointSizePx: number;
}

export interface ProjectedDepthPixel {
  pixel: ImagePixel;
  screenX: number;
  screenY: number;
  ndcZ: number;
  depth: number;
}

export interface ProjectDepthPixelToScreenOptions extends DepthProjectionView {
  width: number;
  height: number;
  viewport: ViewportInfo;
  depthRange: DisplayLuminanceRange;
}

export interface DepthProbeProjectionArgs extends DepthProjectionView {
  layer: DecodedLayer;
  width: number;
  height: number;
  source?: DepthSource | null | undefined;
  channelName?: string | null | undefined;
  viewport: ViewportInfo;
  geometry?: DepthSourceGeometry | null;
  depthRange?: DisplayLuminanceRange | null;
  maxPoints?: number;
  hitRadiusPx?: number;
}

export interface DepthProbePixelValidationArgs {
  layer: DecodedLayer;
  width: number;
  height: number;
  source?: DepthSource | null | undefined;
  channelName?: string | null | undefined;
  maxPoints?: number;
}

interface DepthProjectionFrame {
  layer: DecodedLayer;
  key: string;
  count: number;
  pixelX: Uint32Array;
  pixelY: Uint32Array;
  screenX: Float32Array;
  screenY: Float32Array;
  ndcZ: Float32Array;
  cellSizePx: number;
  spatialGridWidth: number;
  spatialGridHeight: number;
  cellHeads: Int32Array;
  nextPoint: Int32Array;
}

interface DepthRangeCache {
  layer: DecodedLayer;
  width: number;
  height: number;
  sourceKey: string;
  geometry: DepthSourceGeometry | null;
}

const POSITION_DEPTH_SOURCE_PREFIX = '__position:';
const POSITION_DEPTH_BASES = ['P', 'Position', 'position'] as const;
const POSITION_DEPTH_BASE_PRIORITY = new Map<string, number>(
  POSITION_DEPTH_BASES.map((base, index) => [base, index])
);

export function normalizeDepthYaw(yawDeg: number): number {
  return normalizeDepthRotationAngle(yawDeg);
}

export function normalizeDepthRotationAngle(angleDeg: number): number {
  if (!Number.isFinite(angleDeg)) {
    return 0;
  }

  const wrapped = ((angleDeg + 180) % 360 + 360) % 360;
  return wrapped - 180;
}

export function clampDepthYaw(yawDeg: number): number {
  return clampFinite(yawDeg, MIN_DEPTH_YAW_DEG, MAX_DEPTH_YAW_DEG, 0);
}

export function clampDepthPitch(pitchDeg: number): number {
  return clampFinite(pitchDeg, MIN_DEPTH_PITCH_DEG, MAX_DEPTH_PITCH_DEG, 0);
}

export function normalizeDepthYawForSource(
  yawDeg: number,
  source: DepthRotationSource
): number {
  return isFreeDepthRotationSource(source)
    ? normalizeDepthYaw(yawDeg)
    : clampDepthYaw(yawDeg);
}

export function normalizeDepthPitchForSource(
  pitchDeg: number,
  source: DepthRotationSource
): number {
  return isFreeDepthRotationSource(source)
    ? normalizeDepthRotationAngle(pitchDeg)
    : clampDepthPitch(pitchDeg);
}

export function clampDepthZoom(zoom: number): number {
  return clampFinite(zoom, MIN_DEPTH_ZOOM, MAX_DEPTH_ZOOM, DEFAULT_DEPTH_ZOOM);
}

export function normalizeDepthTarget(value: number): number {
  return Number.isFinite(value) ? value : DEFAULT_DEPTH_TARGET;
}

export function normalizeDepthPointSize(pointSizePx: number): number {
  return clampFinite(
    pointSizePx,
    MIN_DEPTH_POINT_SIZE_PX,
    MAX_DEPTH_POINT_SIZE_PX,
    DEFAULT_DEPTH_POINT_SIZE_PX
  );
}

export function normalizeDepthFocalLengthPx(value: number | null | undefined): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  return Number.isFinite(value) && value > 0 ? value : null;
}

export function resolveDepthFocalLengthPx(
  width: number,
  height: number,
  focalLengthPx: number | null | undefined
): number {
  return normalizeDepthFocalLengthPx(focalLengthPx) ?? Math.max(1, width, height);
}

export function getDepthChannelOptions(
  channelNames: readonly string[],
  config: DepthChannelOptionsConfig = { allowArbitraryZSuffix: true }
): DepthChannelOption[] {
  return getDepthSourceOptions(channelNames, config);
}

export function getDepthSourceOptions(
  channelNames: readonly string[],
  config: DepthChannelOptionsConfig = { allowArbitraryZSuffix: true }
): DepthChannelOption[] {
  if (!isDepthMapRecognitionEnabled(config.channelRecognitionSettings)) {
    return [];
  }

  const nameRules = compileChannelRecognitionNameRules(config.channelRecognitionNameRules);
  const positionOptions = getPositionDepthSources(
    channelNames,
    config.channelRecognitionSettings,
    nameRules
  ).map((source) => ({
    value: serializeDepthSource(source),
    label: `${source.xChannel}/${source.yChannel}/${source.zChannel}`
  }));
  const scalarOptions = channelNames
    .filter((channelName) => (
      isRecognizedDepthChannel(channelName, nameRules) ||
      (config.allowArbitraryZSuffix !== false && isZSuffixChannel(channelName))
    ))
    .map((channelName) => ({
      value: channelName,
      label: channelName
    }));
  return [...positionOptions, ...scalarOptions];
}

export function resolveDepthChannelForLayer(
  channelNames: readonly string[],
  current: string | null | undefined,
  options: ResolveDepthChannelOptions = {}
): string | null {
  const source = resolveDepthSourceForLayer(channelNames, current, options);
  return source ? serializeDepthSource(source) : null;
}

export function resolveDepthSourceForLayer(
  channelNames: readonly string[],
  current: string | null | undefined,
  options: ResolveDepthChannelOptions = {}
): DepthSource | null {
  if (!isDepthMapRecognitionEnabled(options.channelRecognitionSettings)) {
    return null;
  }

  const available = new Set(channelNames);
  const nameRules = compileChannelRecognitionNameRules(options.channelRecognitionNameRules);
  const recognizedChannels = channelNames.filter((channelName) => isRecognizedDepthChannel(channelName, nameRules));
  const recognizedChannelSet = new Set(recognizedChannels);
  const positionSources = getPositionDepthSources(channelNames, options.channelRecognitionSettings, nameRules);
  const currentPositionSource = current
    ? positionSources.find((source) => serializeDepthSource(source) === current)
    : null;
  if (currentPositionSource) {
    return currentPositionSource;
  }

  if (
    current &&
    available.has(current) &&
    (recognizedChannelSet.has(current) || (options.allowArbitraryZSuffix && isZSuffixChannel(current)))
  ) {
    return {
      kind: 'scalarDepth',
      channelName: current
    };
  }

  const preferredPositionSource = positionSources[0];
  if (preferredPositionSource) {
    return preferredPositionSource;
  }

  const exactZ = recognizedChannels.find((channelName) => channelName === 'Z');
  if (exactZ) {
    return {
      kind: 'scalarDepth',
      channelName: exactZ
    };
  }

  const exactDepthZ = recognizedChannels.find((channelName) => channelName === 'depth.Z');
  if (exactDepthZ) {
    return {
      kind: 'scalarDepth',
      channelName: exactDepthZ
    };
  }

  const depthLikeZ = recognizedChannels.find(isDepthLikeZSuffixChannel);
  if (depthLikeZ) {
    return {
      kind: 'scalarDepth',
      channelName: depthLikeZ
    };
  }

  const customDepth = recognizedChannels[0];
  if (customDepth) {
    return {
      kind: 'scalarDepth',
      channelName: customDepth
    };
  }

  if (options.allowArbitraryZSuffix) {
    const arbitraryZ = channelNames.find(isZSuffixChannel);
    return arbitraryZ
      ? {
          kind: 'scalarDepth',
          channelName: arbitraryZ
        }
      : null;
  }

  return null;
}

export function resolveDepthPointSampling(
  width: number,
  height: number,
  maxPoints = MAX_DEPTH_POINTS
): DepthPointSampling {
  const sourceWidth = Math.max(0, Math.floor(width));
  const sourceHeight = Math.max(0, Math.floor(height));
  const pixelCount = sourceWidth * sourceHeight;
  const pointBudget = Math.max(1, Math.floor(maxPoints));
  const step = pixelCount > pointBudget
    ? Math.ceil(Math.sqrt(pixelCount / pointBudget))
    : 1;
  const gridWidth = step > 0 ? Math.ceil(sourceWidth / step) : 0;
  const gridHeight = step > 0 ? Math.ceil(sourceHeight / step) : 0;
  return {
    step,
    gridWidth,
    gridHeight,
    pointCount: gridWidth * gridHeight
  };
}

export function isDepthSampledPixel(
  pixel: ImagePixel,
  width: number,
  height: number,
  maxPoints = MAX_DEPTH_POINTS
): boolean {
  const sourceWidth = Math.max(0, Math.floor(width));
  const sourceHeight = Math.max(0, Math.floor(height));
  const x = Math.floor(pixel.ix);
  const y = Math.floor(pixel.iy);
  if (x < 0 || y < 0 || x >= sourceWidth || y >= sourceHeight) {
    return false;
  }

  const sampling = resolveDepthPointSampling(sourceWidth, sourceHeight, maxPoints);
  return sampling.step > 0 && x % sampling.step === 0 && y % sampling.step === 0;
}

export function serializeDepthSource(source: DepthSource): string {
  return source.kind === 'xyzPosition'
    ? `${POSITION_DEPTH_SOURCE_PREFIX}${source.base}`
    : source.channelName;
}

export function parseDepthSourceValue(
  value: string | null | undefined,
  channelNames: readonly string[]
): DepthSource | null {
  if (!value) {
    return null;
  }

  if (value.startsWith(POSITION_DEPTH_SOURCE_PREFIX)) {
    const base = value.slice(POSITION_DEPTH_SOURCE_PREFIX.length);
    return getPositionDepthSources(channelNames).find((source) => source.base === base) ?? null;
  }

  return channelNames.includes(value)
    ? {
        kind: 'scalarDepth',
        channelName: value
      }
    : null;
}

export function isXyzPositionDepthSourceValue(value: string | null | undefined): boolean {
  return Boolean(value?.startsWith(POSITION_DEPTH_SOURCE_PREFIX));
}

export function isFreeDepthRotationSource(source: DepthRotationSource): boolean {
  if (!source) {
    return false;
  }

  if (typeof source === 'string') {
    return source === 'xyzPosition' || isXyzPositionDepthSourceValue(source);
  }

  return source.kind === 'xyzPosition';
}

export function getDepthSourceChannelNames(source: DepthSource | null | undefined): string[] {
  if (!source) {
    return [];
  }

  return source.kind === 'xyzPosition'
    ? [source.xChannel, source.yChannel, source.zChannel]
    : [source.channelName];
}

export function getDepthSourceGeometry(
  layer: DecodedLayer,
  width: number,
  height: number,
  source: DepthSource | null | undefined
): DepthSourceGeometry | null {
  if (!source) {
    return null;
  }

  if (source.kind === 'xyzPosition') {
    const bounds = computeFinitePositionBounds(layer, width, height, source);
    return bounds ? { kind: 'xyzPosition', bounds } : null;
  }

  const range = computePositiveFiniteDepthRange(layer, width, height, source.channelName);
  return range ? { kind: 'scalarDepth', range } : null;
}

export function isValidDepthProbePixel(
  pixel: ImagePixel,
  args: DepthProbePixelValidationArgs
): boolean {
  const source = resolveDepthProbeSource(args);
  if (!source || !isDepthSampledPixel(pixel, args.width, args.height, args.maxPoints)) {
    return false;
  }

  const sourceWidth = Math.max(0, Math.floor(args.width));
  const x = Math.floor(pixel.ix);
  const y = Math.floor(pixel.iy);
  const pixelIndex = y * sourceWidth + x;
  if (source.kind === 'xyzPosition') {
    const point = readPositionPoint(args.layer, source, pixelIndex);
    return Boolean(point);
  }

  const view = getChannelReadView(args.layer, source.channelName);
  if (!view) {
    return false;
  }

  const depth = readChannelValue(view, pixelIndex);
  return Number.isFinite(depth) && depth > 0;
}

export function projectDepthPixelToPoint(
  x: number,
  y: number,
  depth: number,
  width: number,
  height: number,
  focalLengthPx: number | null | undefined
): DepthPoint | null {
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(depth) ||
    depth <= 0 ||
    width <= 0 ||
    height <= 0
  ) {
    return null;
  }

  const f = resolveDepthFocalLengthPx(width, height, focalLengthPx);
  return {
    x: (x + 0.5 - width / 2) * depth / f,
    y: (height / 2 - (y + 0.5)) * depth / f,
    z: depth
  };
}

export function projectDepthPixelToScreen(
  x: number,
  y: number,
  depth: number,
  options: ProjectDepthPixelToScreenOptions
): ProjectedDepthPixel | null {
  const {
    width,
    height,
    viewport,
    depthRange
  } = options;
  if (
    viewport.width <= 0 ||
    viewport.height <= 0 ||
    x < 0 ||
    y < 0 ||
    x >= width ||
    y >= height ||
    !Number.isFinite(depthRange.min) ||
    !Number.isFinite(depthRange.max)
  ) {
    return null;
  }

  const focalLengthPx = resolveDepthFocalLengthPx(width, height, options.depthFocalLengthPx);
  const point = projectDepthPixelToPoint(x, y, depth, width, height, focalLengthPx);
  if (!point) {
    return null;
  }

  const minDepth = depthRange.min;
  const maxDepth = Math.max(depthRange.max, minDepth + 1.0e-6);
  const centerDepth = (minDepth + maxDepth) * 0.5;
  const depthSpan = Math.max(maxDepth - minDepth, 1.0e-6);
  const xSpan = width * maxDepth / focalLengthPx;
  const ySpan = height * maxDepth / focalLengthPx;
  const sceneScale = Math.max(xSpan, ySpan, depthSpan, 1.0e-6);
  const normalizedPoint = {
    x: point.x / sceneScale,
    y: point.y / sceneScale,
    z: (point.z - centerDepth) / sceneScale
  };

  return projectNormalizedDepthPointToScreen(normalizedPoint, {
    pixel: { ix: x, iy: y },
    depthSource: 'scalarDepth',
    viewport,
    depthYawDeg: options.depthYawDeg,
    depthPitchDeg: options.depthPitchDeg,
    depthZoom: options.depthZoom,
    depthTargetX: options.depthTargetX,
    depthTargetY: options.depthTargetY,
    depthTargetZ: options.depthTargetZ,
    depth
  });
}

export function projectPositionPointToScreen(
  x: number,
  y: number,
  point: DepthPoint,
  options: Omit<ProjectDepthPixelToScreenOptions, 'depthRange'> & { bounds: DepthPositionBounds }
): ProjectedDepthPixel | null {
  const {
    width,
    height,
    viewport,
    bounds
  } = options;
  if (
    viewport.width <= 0 ||
    viewport.height <= 0 ||
    x < 0 ||
    y < 0 ||
    x >= width ||
    y >= height ||
    !isFiniteDepthPoint(point) ||
    !isUsablePositionBounds(bounds)
  ) {
    return null;
  }

  const centerX = (bounds.minX + bounds.maxX) * 0.5;
  const centerY = (bounds.minY + bounds.maxY) * 0.5;
  const centerZ = (bounds.minZ + bounds.maxZ) * 0.5;
  const sceneScale = computePositionBoundsScale(bounds);
  return projectNormalizedDepthPointToScreen({
    x: (point.x - centerX) / sceneScale,
    y: (point.y - centerY) / sceneScale,
    z: (point.z - centerZ) / sceneScale
  }, {
    pixel: { ix: x, iy: y },
    depthSource: 'xyzPosition',
    viewport,
    depthYawDeg: options.depthYawDeg,
    depthPitchDeg: options.depthPitchDeg,
    depthZoom: options.depthZoom,
    depthTargetX: options.depthTargetX,
    depthTargetY: options.depthTargetY,
    depthTargetZ: options.depthTargetZ,
    depth: point.z
  });
}

export function pickDepthPixelAtScreenPoint(
  point: { x: number; y: number },
  args: DepthProbeProjectionArgs
): ImagePixel | null {
  return new DepthProbeProjectionCache().pick(point, args);
}

export class DepthProbeProjectionCache {
  private rangeCache: DepthRangeCache | null = null;
  private frame: DepthProjectionFrame | null = null;
  private frameBuildCount = 0;
  private lastPickCandidateCount = 0;

  clear(): void {
    this.rangeCache = null;
    this.frame = null;
    this.frameBuildCount = 0;
    this.lastPickCandidateCount = 0;
  }

  pick(point: { x: number; y: number }, args: DepthProbeProjectionArgs): ImagePixel | null {
    this.lastPickCandidateCount = 0;
    const frame = this.getFrame(args);
    if (!frame) {
      return null;
    }

    const radius = args.hitRadiusPx ?? Math.max(normalizeDepthPointSize(args.depthPointSizePx) * 0.5, 3);
    const radiusSq = radius * radius;
    let bestIndex = -1;
    let bestNdcZ = Number.POSITIVE_INFINITY;
    const minCellX = clampInteger(
      Math.floor((point.x - radius) / frame.cellSizePx),
      0,
      frame.spatialGridWidth - 1
    );
    const maxCellX = clampInteger(
      Math.floor((point.x + radius) / frame.cellSizePx),
      0,
      frame.spatialGridWidth - 1
    );
    const minCellY = clampInteger(
      Math.floor((point.y - radius) / frame.cellSizePx),
      0,
      frame.spatialGridHeight - 1
    );
    const maxCellY = clampInteger(
      Math.floor((point.y + radius) / frame.cellSizePx),
      0,
      frame.spatialGridHeight - 1
    );

    for (let cellY = minCellY; cellY <= maxCellY; cellY += 1) {
      for (let cellX = minCellX; cellX <= maxCellX; cellX += 1) {
        let index = frame.cellHeads[cellY * frame.spatialGridWidth + cellX]!;
        while (index >= 0) {
          this.lastPickCandidateCount += 1;
          const dx = point.x - frame.screenX[index]!;
          const dy = point.y - frame.screenY[index]!;
          if (dx * dx + dy * dy <= radiusSq) {
            const ndcZ = frame.ndcZ[index]!;
            if (ndcZ < bestNdcZ || (ndcZ === bestNdcZ && (bestIndex < 0 || index < bestIndex))) {
              bestIndex = index;
              bestNdcZ = ndcZ;
            }
          }

          index = frame.nextPoint[index]!;
        }
      }
    }

    return bestIndex >= 0
      ? {
          ix: frame.pixelX[bestIndex]!,
          iy: frame.pixelY[bestIndex]!
        }
      : null;
  }

  projectPixel(pixel: ImagePixel, args: DepthProbeProjectionArgs): ProjectedDepthPixel | null {
    const source = resolveDepthProbeSource(args);
    const geometry = this.resolveDepthGeometry(args, source);
    if (!source || !geometry) {
      return null;
    }

    if (!isValidDepthProbePixel(pixel, args)) {
      return null;
    }

    const x = Math.floor(pixel.ix);
    const y = Math.floor(pixel.iy);
    if (x < 0 || y < 0 || x >= args.width || y >= args.height) {
      return null;
    }

    const pixelIndex = y * Math.floor(args.width) + x;
    const commonOptions = {
      width: args.width,
      height: args.height,
      viewport: args.viewport,
      depthFocalLengthPx: args.depthFocalLengthPx,
      depthYawDeg: args.depthYawDeg,
      depthPitchDeg: args.depthPitchDeg,
      depthZoom: args.depthZoom,
      depthTargetX: args.depthTargetX,
      depthTargetY: args.depthTargetY,
      depthTargetZ: args.depthTargetZ,
      depthPointSizePx: args.depthPointSizePx
    };
    if (source.kind === 'xyzPosition') {
      const point = readPositionPoint(args.layer, source, pixelIndex);
      return point && geometry.kind === 'xyzPosition'
        ? projectPositionPointToScreen(x, y, point, {
            ...commonOptions,
            bounds: geometry.bounds
          })
        : null;
    }

    if (geometry.kind !== 'scalarDepth') {
      return null;
    }

    const view = getChannelReadView(args.layer, source.channelName);
    if (!view) {
      return null;
    }

    const depth = readChannelValue(view, pixelIndex);
    return projectDepthPixelToScreen(x, y, depth, {
      ...commonOptions,
      depthRange: geometry.range
    });
  }

  private getFrame(args: DepthProbeProjectionArgs): DepthProjectionFrame | null {
    const source = resolveDepthProbeSource(args);
    if (!source || args.width <= 0 || args.height <= 0 || args.viewport.width <= 0 || args.viewport.height <= 0) {
      return null;
    }

    const geometry = this.resolveDepthGeometry(args, source);
    if (!geometry) {
      return null;
    }

    const sampling = resolveDepthPointSampling(args.width, args.height, args.maxPoints);
    if (sampling.pointCount <= 0) {
      return null;
    }

    const key = buildDepthProjectionFrameKey(args, source, geometry, sampling);
    if (this.frame && this.frame.layer === args.layer && this.frame.key === key) {
      return this.frame;
    }

    const scalarView = source.kind === 'scalarDepth'
      ? getChannelReadView(args.layer, source.channelName)
      : null;
    const positionViews = source.kind === 'xyzPosition'
      ? getPositionReadViews(args.layer, source)
      : null;
    if ((source.kind === 'scalarDepth' && !scalarView) || (source.kind === 'xyzPosition' && !positionViews)) {
      return null;
    }

    const pixelX = new Uint32Array(sampling.pointCount);
    const pixelY = new Uint32Array(sampling.pointCount);
    const screenX = new Float32Array(sampling.pointCount);
    const screenY = new Float32Array(sampling.pointCount);
    const ndcZ = new Float32Array(sampling.pointCount);
    const spatialGridWidth = Math.max(1, Math.ceil(args.viewport.width / DEPTH_PROBE_SPATIAL_GRID_CELL_SIZE_PX));
    const spatialGridHeight = Math.max(1, Math.ceil(args.viewport.height / DEPTH_PROBE_SPATIAL_GRID_CELL_SIZE_PX));
    const cellHeads = new Int32Array(spatialGridWidth * spatialGridHeight);
    const nextPoint = new Int32Array(sampling.pointCount);
    cellHeads.fill(-1);
    nextPoint.fill(-1);
    const sourceWidth = Math.max(0, Math.floor(args.width));
    const sourceHeight = Math.max(0, Math.floor(args.height));
    const scalarProjection = geometry.kind === 'scalarDepth'
      ? createScalarProjectionNormalization(args.width, args.height, args.depthFocalLengthPx, geometry.range)
      : null;
    const positionProjection = geometry.kind === 'xyzPosition'
      ? createPositionProjectionNormalization(geometry.bounds)
      : null;
    const yawRad = -normalizeDepthYawForSource(args.depthYawDeg, source) * Math.PI / 180;
    const pitchRad = -normalizeDepthPitchForSource(args.depthPitchDeg, source) * Math.PI / 180;
    const yawCos = Math.cos(yawRad);
    const yawSin = Math.sin(yawRad);
    const pitchCos = Math.cos(pitchRad);
    const pitchSin = Math.sin(pitchRad);
    const zoom = clampDepthZoom(args.depthZoom);
    const depthTargetX = normalizeDepthTarget(args.depthTargetX ?? DEFAULT_DEPTH_TARGET);
    const depthTargetY = normalizeDepthTarget(args.depthTargetY ?? DEFAULT_DEPTH_TARGET);
    const depthTargetZ = normalizeDepthTarget(args.depthTargetZ ?? DEFAULT_DEPTH_TARGET);
    const aspect = Math.max(args.viewport.width / Math.max(args.viewport.height, 1), 1.0e-6);
    const screenCenterX = args.viewport.width * 0.5;
    const screenCenterY = args.viewport.height * 0.5;
    const screenScaleX = args.viewport.width * zoom / aspect;
    const screenScaleY = args.viewport.height * zoom;
    let count = 0;

    for (let vertexId = 0; vertexId < sampling.pointCount; vertexId += 1) {
      const gridX = vertexId % sampling.gridWidth;
      const gridY = Math.floor(vertexId / sampling.gridWidth);
      const x = gridX * sampling.step;
      const y = gridY * sampling.step;
      if (x >= sourceWidth || y >= sourceHeight) {
        continue;
      }

      const pixelIndex = y * sourceWidth + x;
      let normalizedX = 0;
      let normalizedY = 0;
      let normalizedZ = 0;
      if (source.kind === 'xyzPosition') {
        if (!positionViews || !positionProjection) {
          continue;
        }
        const px = readChannelValue(positionViews.x, pixelIndex);
        const py = readChannelValue(positionViews.y, pixelIndex);
        const pz = readChannelValue(positionViews.z, pixelIndex);
        if (!Number.isFinite(px) || !Number.isFinite(py) || !Number.isFinite(pz)) {
          continue;
        }
        normalizedX = (px - positionProjection.centerX) * positionProjection.invSceneScale;
        normalizedY = (py - positionProjection.centerY) * positionProjection.invSceneScale;
        normalizedZ = (pz - positionProjection.centerZ) * positionProjection.invSceneScale;
      } else {
        if (!scalarView || !scalarProjection) {
          continue;
        }
        const depth = readChannelValue(scalarView, pixelIndex);
        if (!Number.isFinite(depth) || depth <= 0) {
          continue;
        }
        normalizedX = (x + 0.5 - args.width / 2) * depth * scalarProjection.invFocalSceneScale;
        normalizedY = (args.height / 2 - (y + 0.5)) * depth * scalarProjection.invFocalSceneScale;
        normalizedZ = (depth - scalarProjection.centerDepth) * scalarProjection.invSceneScale;
      }
      const targetRelativeX = normalizedX - depthTargetX;
      const targetRelativeY = normalizedY - depthTargetY;
      const targetRelativeZ = normalizedZ - depthTargetZ;
      const yawX = yawCos * targetRelativeX + yawSin * targetRelativeZ;
      const yawZ = -yawSin * targetRelativeX + yawCos * targetRelativeZ;
      const cameraY = pitchCos * targetRelativeY - pitchSin * yawZ;
      const cameraZ = pitchSin * targetRelativeY + pitchCos * yawZ;
      const projectedScreenX = screenCenterX + yawX * screenScaleX;
      const projectedScreenY = screenCenterY - cameraY * screenScaleY;
      if (
        !Number.isFinite(projectedScreenX) ||
        !Number.isFinite(projectedScreenY) ||
        projectedScreenX < -DEPTH_PROBE_FRAME_MARGIN_PX ||
        projectedScreenY < -DEPTH_PROBE_FRAME_MARGIN_PX ||
        projectedScreenX > args.viewport.width + DEPTH_PROBE_FRAME_MARGIN_PX ||
        projectedScreenY > args.viewport.height + DEPTH_PROBE_FRAME_MARGIN_PX
      ) {
        continue;
      }

      const cellX = clampInteger(
        Math.floor(projectedScreenX / DEPTH_PROBE_SPATIAL_GRID_CELL_SIZE_PX),
        0,
        spatialGridWidth - 1
      );
      const cellY = clampInteger(
        Math.floor(projectedScreenY / DEPTH_PROBE_SPATIAL_GRID_CELL_SIZE_PX),
        0,
        spatialGridHeight - 1
      );
      const cellIndex = cellY * spatialGridWidth + cellX;
      pixelX[count] = x;
      pixelY[count] = y;
      screenX[count] = projectedScreenX;
      screenY[count] = projectedScreenY;
      ndcZ[count] = clampFinite(cameraZ * zoom, -1, 1, 1);
      nextPoint[count] = cellHeads[cellIndex]!;
      cellHeads[cellIndex] = count;
      count += 1;
    }

    this.frameBuildCount += 1;
    this.frame = {
      layer: args.layer,
      key,
      count,
      pixelX,
      pixelY,
      screenX,
      screenY,
      ndcZ,
      cellSizePx: DEPTH_PROBE_SPATIAL_GRID_CELL_SIZE_PX,
      spatialGridWidth,
      spatialGridHeight,
      cellHeads,
      nextPoint
    };
    return this.frame;
  }

  private resolveDepthGeometry(
    args: DepthProbeProjectionArgs,
    source: DepthSource | null
  ): DepthSourceGeometry | null {
    if (!source) {
      return null;
    }

    if (args.geometry) {
      return isUsableDepthSourceGeometry(args.geometry) ? args.geometry : null;
    }

    if (args.depthRange && source.kind === 'scalarDepth') {
      return isUsableDepthRange(args.depthRange)
        ? { kind: 'scalarDepth', range: args.depthRange }
        : null;
    }

    const sourceKey = serializeDepthSource(source);
    if (
      this.rangeCache &&
      this.rangeCache.layer === args.layer &&
      this.rangeCache.width === args.width &&
      this.rangeCache.height === args.height &&
      this.rangeCache.sourceKey === sourceKey
    ) {
      return this.rangeCache.geometry;
    }

    const geometry = getDepthSourceGeometry(args.layer, args.width, args.height, source);
    this.rangeCache = {
      layer: args.layer,
      width: args.width,
      height: args.height,
      sourceKey,
      geometry
    };
    return geometry;
  }
}

export function computePositiveFiniteDepthRange(
  layer: DecodedLayer,
  width: number,
  height: number,
  channelName: string | null | undefined
): DisplayLuminanceRange | null {
  if (!channelName || width <= 0 || height <= 0) {
    return null;
  }

  const view = getChannelReadView(layer, channelName);
  if (!view) {
    return null;
  }

  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let count = 0;
  const pixelCount = Math.max(0, Math.floor(width) * Math.floor(height));
  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
    const value = readChannelValue(view, pixelIndex);
    if (!Number.isFinite(value) || value <= 0) {
      continue;
    }

    count += 1;
    if (value < min) {
      min = value;
    }
    if (value > max) {
      max = value;
    }
  }

  return count > 0 ? { min, max } : null;
}

export function computeFinitePositionBounds(
  layer: DecodedLayer,
  width: number,
  height: number,
  source: XyzPositionDepthSource | null | undefined
): DepthPositionBounds | null {
  if (!source || width <= 0 || height <= 0) {
    return null;
  }

  const views = getPositionReadViews(layer, source);
  if (!views) {
    return null;
  }

  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  let count = 0;
  const pixelCount = Math.max(0, Math.floor(width) * Math.floor(height));
  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
    const x = readChannelValue(views.x, pixelIndex);
    const y = readChannelValue(views.y, pixelIndex);
    const z = readChannelValue(views.z, pixelIndex);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      continue;
    }

    count += 1;
    if (x < minX) {
      minX = x;
    }
    if (x > maxX) {
      maxX = x;
    }
    if (y < minY) {
      minY = y;
    }
    if (y > maxY) {
      maxY = y;
    }
    if (z < minZ) {
      minZ = z;
    }
    if (z > maxZ) {
      maxZ = z;
    }
  }

  return count > 0
    ? { minX, maxX, minY, maxY, minZ, maxZ }
    : null;
}

export function hasDepthChannelCandidate(
  channelNames: readonly string[],
  config: ResolveDepthChannelOptions = {}
): boolean {
  return resolveDepthChannelForLayer(channelNames, null, {
    ...config,
    allowArbitraryZSuffix: config.allowArbitraryZSuffix ?? true
  }) !== null;
}

function isZSuffixChannel(channelName: string): boolean {
  return channelName.endsWith('.Z');
}

function getPositionDepthSources(
  channelNames: readonly string[],
  settings?: ChannelRecognitionSettings,
  nameRules: CompiledChannelRecognitionNameRules = compileChannelRecognitionNameRules()
): XyzPositionDepthSource[] {
  if (!isPositionDepthSourceRecognitionEnabled(settings)) {
    return [];
  }

  const groups = new Map<string, {
    sourceOrder: number;
    xChannel?: string;
    yChannel?: string;
    zChannel?: string;
  }>();
  for (let index = 0; index < channelNames.length; index += 1) {
    const channelName = channelNames[index];
    if (channelName === undefined) {
      continue;
    }

    const parsed = parsePositionMapChannelNameWithRules(channelName, nameRules);
    if (!parsed) {
      continue;
    }

    let group = groups.get(parsed.base);
    if (!group) {
      group = { sourceOrder: index };
      groups.set(parsed.base, group);
    }

    switch (parsed.component) {
      case 'x':
        group.xChannel ??= channelName;
        break;
      case 'y':
        group.yChannel ??= channelName;
        break;
      case 'z':
        group.zChannel ??= channelName;
        break;
    }
  }

  return [...groups.entries()]
    .filter((entry): entry is [string, {
      sourceOrder: number;
      xChannel: string;
      yChannel: string;
      zChannel: string;
    }] => {
      const group = entry[1];
      return Boolean(group.xChannel && group.yChannel && group.zChannel);
    })
    .sort(([aBase, aGroup], [bBase, bGroup]) => {
      const aPriority = POSITION_DEPTH_BASE_PRIORITY.get(aBase) ?? Number.POSITIVE_INFINITY;
      const bPriority = POSITION_DEPTH_BASE_PRIORITY.get(bBase) ?? Number.POSITIVE_INFINITY;
      return aPriority === bPriority
        ? aGroup.sourceOrder - bGroup.sourceOrder
        : aPriority - bPriority;
    })
    .map(([base, group]) => ({
      kind: 'xyzPosition' as const,
      base,
      xChannel: group.xChannel,
      yChannel: group.yChannel,
      zChannel: group.zChannel
    }));
}

function isDepthLikeZSuffixChannel(channelName: string): boolean {
  if (!isZSuffixChannel(channelName)) {
    return false;
  }

  const prefix = channelName.slice(0, -2).toLowerCase();
  return prefix.includes('depth');
}

function isRecognizedDepthChannel(
  channelName: string,
  nameRules: CompiledChannelRecognitionNameRules
): boolean {
  return parseDepthMapChannelNameWithRules(channelName, nameRules) !== null;
}

function isDepthMapRecognitionEnabled(settings: ChannelRecognitionSettings | undefined): boolean {
  return normalizeChannelRecognitionSettings(settings)['depth.map'] !== false;
}

function isPositionDepthSourceRecognitionEnabled(settings: ChannelRecognitionSettings | undefined): boolean {
  const normalized = normalizeChannelRecognitionSettings(settings);
  return normalized['depth.map'] !== false && normalized['position.map'] !== false;
}

function clampFinite(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, value));
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.min(max, Math.max(min, Math.floor(value)));
}

function rotateYaw(point: DepthPoint, angleRad: number): DepthPoint {
  const c = Math.cos(angleRad);
  const s = Math.sin(angleRad);
  return {
    x: c * point.x + s * point.z,
    y: point.y,
    z: -s * point.x + c * point.z
  };
}

function rotatePitch(point: DepthPoint, angleRad: number): DepthPoint {
  const c = Math.cos(angleRad);
  const s = Math.sin(angleRad);
  return {
    x: point.x,
    y: c * point.y - s * point.z,
    z: s * point.y + c * point.z
  };
}

function isUsableDepthRange(range: DisplayLuminanceRange): boolean {
  return Number.isFinite(range.min) && Number.isFinite(range.max);
}

function isUsablePositionBounds(bounds: DepthPositionBounds): boolean {
  return Number.isFinite(bounds.minX) &&
    Number.isFinite(bounds.maxX) &&
    Number.isFinite(bounds.minY) &&
    Number.isFinite(bounds.maxY) &&
    Number.isFinite(bounds.minZ) &&
    Number.isFinite(bounds.maxZ);
}

function isUsableDepthSourceGeometry(geometry: DepthSourceGeometry): boolean {
  return geometry.kind === 'xyzPosition'
    ? isUsablePositionBounds(geometry.bounds)
    : isUsableDepthRange(geometry.range);
}

function isFiniteDepthPoint(point: DepthPoint): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z);
}

function computePositionBoundsScale(bounds: DepthPositionBounds): number {
  return Math.max(
    bounds.maxX - bounds.minX,
    bounds.maxY - bounds.minY,
    bounds.maxZ - bounds.minZ,
    1.0e-6
  );
}

function projectNormalizedDepthPointToScreen(
  point: DepthPoint,
  options: Pick<
    DepthProjectionView,
    'depthYawDeg' | 'depthPitchDeg' | 'depthZoom' | 'depthTargetX' | 'depthTargetY' | 'depthTargetZ'
  > & {
    pixel: ImagePixel;
    depthSource: DepthRotationSource;
    viewport: ViewportInfo;
    depth: number;
  }
): ProjectedDepthPixel | null {
  if (!isFiniteDepthPoint(point) || options.viewport.width <= 0 || options.viewport.height <= 0) {
    return null;
  }

  const yawRad = -normalizeDepthYawForSource(options.depthYawDeg, options.depthSource) * Math.PI / 180;
  const pitchRad = -normalizeDepthPitchForSource(options.depthPitchDeg, options.depthSource) * Math.PI / 180;
  const targetRelativePoint = {
    x: point.x - normalizeDepthTarget(options.depthTargetX ?? DEFAULT_DEPTH_TARGET),
    y: point.y - normalizeDepthTarget(options.depthTargetY ?? DEFAULT_DEPTH_TARGET),
    z: point.z - normalizeDepthTarget(options.depthTargetZ ?? DEFAULT_DEPTH_TARGET)
  };
  const yawPoint = rotateYaw(targetRelativePoint, yawRad);
  const cameraPoint = rotatePitch(yawPoint, pitchRad);
  const zoom = clampDepthZoom(options.depthZoom);
  const aspect = Math.max(options.viewport.width / Math.max(options.viewport.height, 1), 1.0e-6);
  const projectedX = cameraPoint.x / aspect * zoom * 2;
  const projectedY = cameraPoint.y * zoom * 2;

  return {
    pixel: {
      ix: Math.floor(options.pixel.ix),
      iy: Math.floor(options.pixel.iy)
    },
    screenX: (projectedX * 0.5 + 0.5) * options.viewport.width,
    screenY: (0.5 - projectedY * 0.5) * options.viewport.height,
    ndcZ: clampFinite(cameraPoint.z * zoom, -1, 1, 1),
    depth: options.depth
  };
}

function createScalarProjectionNormalization(
  width: number,
  height: number,
  focalLengthPx: number | null | undefined,
  depthRange: DisplayLuminanceRange
): {
  centerDepth: number;
  invFocalSceneScale: number;
  invSceneScale: number;
} {
  const resolvedFocalLengthPx = resolveDepthFocalLengthPx(width, height, focalLengthPx);
  const minDepth = depthRange.min;
  const maxDepth = Math.max(depthRange.max, minDepth + 1.0e-6);
  const centerDepth = (minDepth + maxDepth) * 0.5;
  const depthSpan = Math.max(maxDepth - minDepth, 1.0e-6);
  const xSpan = width * maxDepth / resolvedFocalLengthPx;
  const ySpan = height * maxDepth / resolvedFocalLengthPx;
  const sceneScale = Math.max(xSpan, ySpan, depthSpan, 1.0e-6);
  return {
    centerDepth,
    invFocalSceneScale: 1 / (resolvedFocalLengthPx * sceneScale),
    invSceneScale: 1 / sceneScale
  };
}

function createPositionProjectionNormalization(
  bounds: DepthPositionBounds
): {
  centerX: number;
  centerY: number;
  centerZ: number;
  invSceneScale: number;
} {
  return {
    centerX: (bounds.minX + bounds.maxX) * 0.5,
    centerY: (bounds.minY + bounds.maxY) * 0.5,
    centerZ: (bounds.minZ + bounds.maxZ) * 0.5,
    invSceneScale: 1 / computePositionBoundsScale(bounds)
  };
}

function resolveDepthProbeSource(
  args: Pick<DepthProbeProjectionArgs, 'source' | 'channelName'>
): DepthSource | null {
  if (args.source) {
    return args.source;
  }

  return args.channelName
    ? {
        kind: 'scalarDepth',
        channelName: args.channelName
      }
    : null;
}

function getPositionReadViews(
  layer: DecodedLayer,
  source: XyzPositionDepthSource
): {
  x: NonNullable<ReturnType<typeof getChannelReadView>>;
  y: NonNullable<ReturnType<typeof getChannelReadView>>;
  z: NonNullable<ReturnType<typeof getChannelReadView>>;
} | null {
  const x = getChannelReadView(layer, source.xChannel);
  const y = getChannelReadView(layer, source.yChannel);
  const z = getChannelReadView(layer, source.zChannel);
  return x && y && z ? { x, y, z } : null;
}

function readPositionPoint(
  layer: DecodedLayer,
  source: XyzPositionDepthSource,
  pixelIndex: number
): DepthPoint | null {
  const views = getPositionReadViews(layer, source);
  if (!views) {
    return null;
  }

  const point = {
    x: readChannelValue(views.x, pixelIndex),
    y: readChannelValue(views.y, pixelIndex),
    z: readChannelValue(views.z, pixelIndex)
  };
  return isFiniteDepthPoint(point) ? point : null;
}

function buildDepthProjectionFrameKey(
  args: DepthProbeProjectionArgs,
  source: DepthSource,
  geometry: DepthSourceGeometry,
  sampling: DepthPointSampling
): string {
  const geometryParts = geometry.kind === 'xyzPosition'
    ? [
        geometry.bounds.minX,
        geometry.bounds.maxX,
        geometry.bounds.minY,
        geometry.bounds.maxY,
        geometry.bounds.minZ,
        geometry.bounds.maxZ
      ]
    : [
        geometry.range.min,
        geometry.range.max,
        resolveDepthFocalLengthPx(args.width, args.height, args.depthFocalLengthPx)
      ];
  return [
    Math.floor(args.width),
    Math.floor(args.height),
    serializeDepthSource(source),
    ...geometryParts,
    normalizeDepthYawForSource(args.depthYawDeg, source),
    normalizeDepthPitchForSource(args.depthPitchDeg, source),
    clampDepthZoom(args.depthZoom),
    normalizeDepthTarget(args.depthTargetX ?? DEFAULT_DEPTH_TARGET),
    normalizeDepthTarget(args.depthTargetY ?? DEFAULT_DEPTH_TARGET),
    normalizeDepthTarget(args.depthTargetZ ?? DEFAULT_DEPTH_TARGET),
    Math.floor(args.viewport.width),
    Math.floor(args.viewport.height),
    sampling.step,
    sampling.gridWidth,
    sampling.gridHeight
  ].join(':');
}
