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
  channelName: string | null | undefined;
  viewport: ViewportInfo;
  depthRange?: DisplayLuminanceRange | null;
  maxPoints?: number;
  hitRadiusPx?: number;
}

export interface DepthProbePixelValidationArgs {
  layer: DecodedLayer;
  width: number;
  height: number;
  channelName: string | null | undefined;
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
  channelName: string;
  range: DisplayLuminanceRange | null;
}

export function normalizeDepthYaw(yawDeg: number): number {
  if (!Number.isFinite(yawDeg)) {
    return 0;
  }

  const wrapped = ((yawDeg + 180) % 360 + 360) % 360;
  return wrapped - 180;
}

export function clampDepthYaw(yawDeg: number): number {
  return clampFinite(yawDeg, MIN_DEPTH_YAW_DEG, MAX_DEPTH_YAW_DEG, 0);
}

export function clampDepthPitch(pitchDeg: number): number {
  return clampFinite(pitchDeg, MIN_DEPTH_PITCH_DEG, MAX_DEPTH_PITCH_DEG, 0);
}

export function clampDepthZoom(zoom: number): number {
  return clampFinite(zoom, MIN_DEPTH_ZOOM, MAX_DEPTH_ZOOM, DEFAULT_DEPTH_ZOOM);
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
  if (!isDepthMapRecognitionEnabled(config.channelRecognitionSettings)) {
    return [];
  }

  const nameRules = compileChannelRecognitionNameRules(config.channelRecognitionNameRules);
  return channelNames
    .filter((channelName) => (
      isRecognizedDepthChannel(channelName, nameRules) ||
      (config.allowArbitraryZSuffix !== false && isZSuffixChannel(channelName))
    ))
    .map((channelName) => ({
      value: channelName,
      label: channelName
    }));
}

export function resolveDepthChannelForLayer(
  channelNames: readonly string[],
  current: string | null | undefined,
  options: ResolveDepthChannelOptions = {}
): string | null {
  if (!isDepthMapRecognitionEnabled(options.channelRecognitionSettings)) {
    return null;
  }

  const available = new Set(channelNames);
  const nameRules = compileChannelRecognitionNameRules(options.channelRecognitionNameRules);
  const recognizedChannels = channelNames.filter((channelName) => isRecognizedDepthChannel(channelName, nameRules));
  const recognizedChannelSet = new Set(recognizedChannels);
  if (
    current &&
    available.has(current) &&
    (recognizedChannelSet.has(current) || (options.allowArbitraryZSuffix && isZSuffixChannel(current)))
  ) {
    return current;
  }

  const exactZ = recognizedChannels.find((channelName) => channelName === 'Z');
  if (exactZ) {
    return exactZ;
  }

  const exactDepthZ = recognizedChannels.find((channelName) => channelName === 'depth.Z');
  if (exactDepthZ) {
    return exactDepthZ;
  }

  const depthLikeZ = recognizedChannels.find(isDepthLikeZSuffixChannel);
  if (depthLikeZ) {
    return depthLikeZ;
  }

  const customDepth = recognizedChannels[0];
  if (customDepth) {
    return customDepth;
  }

  if (options.allowArbitraryZSuffix) {
    return channelNames.find(isZSuffixChannel) ?? null;
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

export function isValidDepthProbePixel(
  pixel: ImagePixel,
  args: DepthProbePixelValidationArgs
): boolean {
  if (!args.channelName || !isDepthSampledPixel(pixel, args.width, args.height, args.maxPoints)) {
    return false;
  }

  const sourceWidth = Math.max(0, Math.floor(args.width));
  const x = Math.floor(pixel.ix);
  const y = Math.floor(pixel.iy);
  const view = getChannelReadView(args.layer, args.channelName);
  if (!view) {
    return false;
  }

  const depth = readChannelValue(view, y * sourceWidth + x);
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

  const yawRad = -clampDepthYaw(options.depthYawDeg) * Math.PI / 180;
  const pitchRad = -clampDepthPitch(options.depthPitchDeg) * Math.PI / 180;
  const yawPoint = rotateYaw(normalizedPoint, yawRad);
  const cameraPoint = rotatePitch(yawPoint, pitchRad);
  const zoom = clampDepthZoom(options.depthZoom);
  const aspect = Math.max(viewport.width / Math.max(viewport.height, 1), 1.0e-6);
  const projectedX = cameraPoint.x / aspect * zoom * 2;
  const projectedY = cameraPoint.y * zoom * 2;

  return {
    pixel: {
      ix: Math.floor(x),
      iy: Math.floor(y)
    },
    screenX: (projectedX * 0.5 + 0.5) * viewport.width,
    screenY: (0.5 - projectedY * 0.5) * viewport.height,
    ndcZ: clampFinite(cameraPoint.z * zoom, -1, 1, 1),
    depth
  };
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
    const depthRange = this.resolveDepthRange(args);
    if (!depthRange || !args.channelName) {
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

    const view = getChannelReadView(args.layer, args.channelName);
    if (!view) {
      return null;
    }

    const depth = readChannelValue(view, y * Math.floor(args.width) + x);
    return projectDepthPixelToScreen(x, y, depth, {
      width: args.width,
      height: args.height,
      viewport: args.viewport,
      depthRange,
      depthFocalLengthPx: args.depthFocalLengthPx,
      depthYawDeg: args.depthYawDeg,
      depthPitchDeg: args.depthPitchDeg,
      depthZoom: args.depthZoom,
      depthPointSizePx: args.depthPointSizePx
    });
  }

  private getFrame(args: DepthProbeProjectionArgs): DepthProjectionFrame | null {
    if (!args.channelName || args.width <= 0 || args.height <= 0 || args.viewport.width <= 0 || args.viewport.height <= 0) {
      return null;
    }

    const depthRange = this.resolveDepthRange(args);
    if (!depthRange) {
      return null;
    }

    const sampling = resolveDepthPointSampling(args.width, args.height, args.maxPoints);
    if (sampling.pointCount <= 0) {
      return null;
    }

    const key = buildDepthProjectionFrameKey(args, depthRange, sampling);
    if (this.frame && this.frame.layer === args.layer && this.frame.key === key) {
      return this.frame;
    }

    const view = getChannelReadView(args.layer, args.channelName);
    if (!view) {
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
    const focalLengthPx = resolveDepthFocalLengthPx(args.width, args.height, args.depthFocalLengthPx);
    const minDepth = depthRange.min;
    const maxDepth = Math.max(depthRange.max, minDepth + 1.0e-6);
    const centerDepth = (minDepth + maxDepth) * 0.5;
    const depthSpan = Math.max(maxDepth - minDepth, 1.0e-6);
    const xSpan = args.width * maxDepth / focalLengthPx;
    const ySpan = args.height * maxDepth / focalLengthPx;
    const sceneScale = Math.max(xSpan, ySpan, depthSpan, 1.0e-6);
    const invFocalSceneScale = 1 / (focalLengthPx * sceneScale);
    const invSceneScale = 1 / sceneScale;
    const yawRad = -clampDepthYaw(args.depthYawDeg) * Math.PI / 180;
    const pitchRad = -clampDepthPitch(args.depthPitchDeg) * Math.PI / 180;
    const yawCos = Math.cos(yawRad);
    const yawSin = Math.sin(yawRad);
    const pitchCos = Math.cos(pitchRad);
    const pitchSin = Math.sin(pitchRad);
    const zoom = clampDepthZoom(args.depthZoom);
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

      const depth = readChannelValue(view, y * sourceWidth + x);
      if (!Number.isFinite(depth) || depth <= 0) {
        continue;
      }

      const normalizedX = (x + 0.5 - args.width / 2) * depth * invFocalSceneScale;
      const normalizedY = (args.height / 2 - (y + 0.5)) * depth * invFocalSceneScale;
      const normalizedZ = (depth - centerDepth) * invSceneScale;
      const yawX = yawCos * normalizedX + yawSin * normalizedZ;
      const yawZ = -yawSin * normalizedX + yawCos * normalizedZ;
      const cameraY = pitchCos * normalizedY - pitchSin * yawZ;
      const cameraZ = pitchSin * normalizedY + pitchCos * yawZ;
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

  private resolveDepthRange(args: DepthProbeProjectionArgs): DisplayLuminanceRange | null {
    if (args.depthRange) {
      return isUsableDepthRange(args.depthRange) ? args.depthRange : null;
    }

    if (!args.channelName) {
      return null;
    }

    if (
      this.rangeCache &&
      this.rangeCache.layer === args.layer &&
      this.rangeCache.width === args.width &&
      this.rangeCache.height === args.height &&
      this.rangeCache.channelName === args.channelName
    ) {
      return this.rangeCache.range;
    }

    const range = computePositiveFiniteDepthRange(args.layer, args.width, args.height, args.channelName);
    this.rangeCache = {
      layer: args.layer,
      width: args.width,
      height: args.height,
      channelName: args.channelName,
      range
    };
    return range;
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

function buildDepthProjectionFrameKey(
  args: DepthProbeProjectionArgs,
  depthRange: DisplayLuminanceRange,
  sampling: DepthPointSampling
): string {
  return [
    Math.floor(args.width),
    Math.floor(args.height),
    args.channelName ?? '',
    depthRange.min,
    depthRange.max,
    resolveDepthFocalLengthPx(args.width, args.height, args.depthFocalLengthPx),
    clampDepthYaw(args.depthYawDeg),
    clampDepthPitch(args.depthPitchDeg),
    clampDepthZoom(args.depthZoom),
    Math.floor(args.viewport.width),
    Math.floor(args.viewport.height),
    sampling.step,
    sampling.gridWidth,
    sampling.gridHeight
  ].join(':');
}
