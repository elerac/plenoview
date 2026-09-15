import { resolveDisplayImageSize } from './display-size';
import {
  createDisplayPixelValues,
  readDisplaySelectionSnapshotPixelValuesAtIndex,
  resolveDisplaySelectionEvaluator
} from './display/evaluator';
import { resolvePanoramaProjection, type PanoramaProjection } from './interaction/panorama-geometry';
import type {
  DecodedLayer,
  PanoramaDisplayMode,
  PanoramaLightingMethod,
  ViewerRenderState,
  VisualizationMode
} from './types';

export const DEFAULT_PANORAMA_DISPLAY_MODE: PanoramaDisplayMode = 'image';
export const DEFAULT_PANORAMA_LIGHTING_METHOD: PanoramaLightingMethod = 'pathTracing';

const EQUIRECTANGULAR_SAMPLE_COLUMNS = 64;
const EQUIRECTANGULAR_SAMPLE_ROWS = 32;
const CUBEMAP_SAMPLE_COLUMNS_PER_FACE = 32;
const ENVIRONMENT_IMPORTANCE_UNIFORM_MIX = 0.02;
const REC709_LUMINANCE_R = 0.2126;
const REC709_LUMINANCE_G = 0.7152;
const REC709_LUMINANCE_B = 0.0722;

export interface EnvironmentMapSample {
  r: number;
  g: number;
  b: number;
}

export interface EnvironmentMapProjection {
  width: number;
  height: number;
  projection?: PanoramaProjection;
  sample: (x: number, y: number, output: EnvironmentMapSample) => EnvironmentMapSample;
}

export interface EnvironmentLightingSource {
  layer: DecodedLayer;
  sourceWidth: number;
  sourceHeight: number;
  selection: ViewerRenderState['displaySelection'];
  visualizationMode: VisualizationMode;
  maskInvalidStokesVectors?: boolean;
  spectralRgbGroupingEnabled?: boolean;
  channelRecognitionNameRules?: ViewerRenderState['channelRecognitionNameRules'];
}

export interface EnvironmentImportanceSamplingTable {
  projection: PanoramaProjection;
  gridWidth: number;
  gridHeight: number;
  entryCount: number;
  /** RGBA entries: alias acceptance, alias index, probability mass, unused. */
  rgba32f: Float32Array;
}

export function resolvePanoramaDisplayMode(
  mode: PanoramaDisplayMode | null | undefined
): PanoramaDisplayMode {
  return mode === 'environmentLighting' ? mode : DEFAULT_PANORAMA_DISPLAY_MODE;
}

export function resolvePanoramaLightingMethod(
  method: PanoramaLightingMethod | null | undefined
): PanoramaLightingMethod {
  return method === 'pathTracing' ? method : DEFAULT_PANORAMA_LIGHTING_METHOD;
}

export function usesPathTracingEnvironmentLighting(
  state: Pick<ViewerRenderState, 'viewerMode' | 'panoramaDisplayMode' | 'panoramaLightingMethod'>
): boolean {
  return state.viewerMode === 'panorama' &&
    resolvePanoramaDisplayMode(state.panoramaDisplayMode) === 'environmentLighting' &&
    resolvePanoramaLightingMethod(state.panoramaLightingMethod) === 'pathTracing';
}

export function computeEnvironmentMapImportanceSampling(
  source: EnvironmentLightingSource
): EnvironmentImportanceSamplingTable {
  return buildEnvironmentImportanceSamplingTable(createEnvironmentMapProjection(source));
}

function createEnvironmentMapProjection(
  source: EnvironmentLightingSource
): EnvironmentMapProjection {
  const displaySize = resolveDisplayImageSize(
    source.sourceWidth,
    source.sourceHeight,
    source.selection
  );
  const evaluator = resolveDisplaySelectionEvaluator(
    source.layer,
    source.selection,
    source.visualizationMode,
    {
      sourceWidth: source.sourceWidth,
      sourceHeight: source.sourceHeight,
      maskInvalidStokesVectors: source.maskInvalidStokesVectors,
      spectralRgbGroupingEnabled: source.spectralRgbGroupingEnabled,
      channelRecognitionNameRules: source.channelRecognitionNameRules
    }
  );
  const values = createDisplayPixelValues();

  return {
    width: displaySize.width,
    height: displaySize.height,
    sample: (x, y, output) => {
      readDisplaySelectionSnapshotPixelValuesAtIndex(
        evaluator,
        y * displaySize.width + x,
        values
      );
      output.r = values.r;
      output.g = values.g;
      output.b = values.b;
      return output;
    }
  };
}

/**
 * Builds a compact Walker alias table over a solid-angle-aware environment grid.
 * A small uniform component keeps the PDF non-zero when a coarse cell misses a
 * bright source or when BSDF sampling reaches a dark cell.
 */
export function buildEnvironmentImportanceSamplingTable(
  environment: EnvironmentMapProjection
): EnvironmentImportanceSamplingTable {
  const projection = environment.projection ?? resolvePanoramaProjection(
    environment.width,
    environment.height
  );
  const gridWidth = projection === 'cubemap-cross'
    ? Math.max(1, Math.min(Math.floor(environment.width / 4), CUBEMAP_SAMPLE_COLUMNS_PER_FACE))
    : Math.max(1, Math.min(environment.width, EQUIRECTANGULAR_SAMPLE_COLUMNS));
  const gridHeight = projection === 'cubemap-cross'
    ? gridWidth
    : Math.max(1, Math.min(environment.height, EQUIRECTANGULAR_SAMPLE_ROWS));
  const entryCount = projection === 'cubemap-cross'
    ? 6 * gridWidth * gridHeight
    : gridWidth * gridHeight;
  const luminance = new Float64Array(entryCount);
  const solidAngle = new Float64Array(entryCount);
  const color: EnvironmentMapSample = { r: 0, g: 0, b: 0 };

  if (projection === 'cubemap-cross') {
    populateCubemapImportanceSamples(
      environment,
      gridWidth,
      luminance,
      solidAngle,
      color
    );
  } else {
    populateEquirectangularImportanceSamples(
      environment,
      gridWidth,
      gridHeight,
      luminance,
      solidAngle,
      color
    );
  }

  return {
    projection,
    gridWidth,
    gridHeight,
    entryCount,
    rgba32f: buildAliasTable(luminance, solidAngle)
  };
}

function populateEquirectangularImportanceSamples(
  environment: EnvironmentMapProjection,
  sampleColumns: number,
  sampleRows: number,
  luminance: Float64Array,
  solidAngle: Float64Array,
  color: EnvironmentMapSample
): void {
  const longitudeStep = 2 * Math.PI / sampleColumns;
  for (let row = 0; row < sampleRows; row += 1) {
    const v = (row + 0.5) / sampleRows;
    const latitudeLower = (row / sampleRows - 0.5) * Math.PI;
    const latitudeUpper = ((row + 1) / sampleRows - 0.5) * Math.PI;
    const cellSolidAngle = longitudeStep * (
      Math.sin(latitudeUpper) - Math.sin(latitudeLower)
    );
    const y = Math.min(environment.height - 1, Math.floor(v * environment.height));
    for (let column = 0; column < sampleColumns; column += 1) {
      const u = (column + 0.5) / sampleColumns;
      const x = Math.min(environment.width - 1, Math.floor(u * environment.width));
      const index = row * sampleColumns + column;
      luminance[index] = sampleEnvironmentLuminance(environment, x, y, color);
      solidAngle[index] = cellSolidAngle;
    }
  }
}

function populateCubemapImportanceSamples(
  environment: EnvironmentMapProjection,
  samplesPerFace: number,
  luminance: Float64Array,
  solidAngle: Float64Array,
  color: EnvironmentMapSample
): void {
  const faceSize = Math.max(1, Math.floor(environment.width / 4));
  const localStep = 2 / samplesPerFace;
  const entriesPerFace = samplesPerFace * samplesPerFace;
  for (let faceIndex = 0; faceIndex < CUBEMAP_CROSS_FACES.length; faceIndex += 1) {
    const face = CUBEMAP_CROSS_FACES[faceIndex];
    for (let row = 0; row < samplesPerFace; row += 1) {
      const localY = -1 + (row + 0.5) * localStep;
      const pixelY = face.row * faceSize + Math.min(
        faceSize - 1,
        Math.floor((row + 0.5) * faceSize / samplesPerFace)
      );
      for (let column = 0; column < samplesPerFace; column += 1) {
        const localX = -1 + (column + 0.5) * localStep;
        const pixelX = face.column * faceSize + Math.min(
          faceSize - 1,
          Math.floor((column + 0.5) * faceSize / samplesPerFace)
        );
        const direction = face.direction(localX, localY);
        const length = Math.hypot(direction.x, direction.y, direction.z);
        const index = faceIndex * entriesPerFace + row * samplesPerFace + column;
        luminance[index] = sampleEnvironmentLuminance(environment, pixelX, pixelY, color);
        solidAngle[index] = localStep * localStep / (length * length * length);
      }
    }
  }
}

function sampleEnvironmentLuminance(
  environment: EnvironmentMapProjection,
  x: number,
  y: number,
  color: EnvironmentMapSample
): number {
  const sample = environment.sample(x, y, color);
  return REC709_LUMINANCE_R * sanitizeRadiance(sample.r) +
    REC709_LUMINANCE_G * sanitizeRadiance(sample.g) +
    REC709_LUMINANCE_B * sanitizeRadiance(sample.b);
}

function buildAliasTable(
  luminance: Float64Array,
  solidAngle: Float64Array
): Float32Array {
  const entryCount = luminance.length;
  const result = new Float32Array(entryCount * 4);
  if (entryCount === 0) {
    return result;
  }

  let radianceIntegral = 0;
  let totalSolidAngle = 0;
  for (let index = 0; index < entryCount; index += 1) {
    radianceIntegral += luminance[index] * solidAngle[index];
    totalSolidAngle += solidAngle[index];
  }
  const averageLuminance = totalSolidAngle > 0
    ? radianceIntegral / totalSolidAngle
    : 0;
  const weights = new Float64Array(entryCount);
  let totalWeight = 0;
  for (let index = 0; index < entryCount; index += 1) {
    const density = radianceIntegral > 0
      ? (1 - ENVIRONMENT_IMPORTANCE_UNIFORM_MIX) * luminance[index] +
        ENVIRONMENT_IMPORTANCE_UNIFORM_MIX * averageLuminance
      : 1;
    const weight = Math.max(0, solidAngle[index] * density);
    weights[index] = weight;
    totalWeight += weight;
  }
  if (!(totalWeight > 0)) {
    weights.fill(1);
    totalWeight = entryCount;
  }

  const scaled = new Float64Array(entryCount);
  const small: number[] = [];
  const large: number[] = [];
  for (let index = 0; index < entryCount; index += 1) {
    const probabilityMass = weights[index] / totalWeight;
    scaled[index] = probabilityMass * entryCount;
    result[index * 4 + 2] = probabilityMass;
    (scaled[index] < 1 ? small : large).push(index);
  }

  while (small.length > 0 && large.length > 0) {
    const smallIndex = small.pop() as number;
    const largeIndex = large.pop() as number;
    result[smallIndex * 4 + 0] = scaled[smallIndex];
    result[smallIndex * 4 + 1] = largeIndex;
    scaled[largeIndex] = scaled[largeIndex] + scaled[smallIndex] - 1;
    (scaled[largeIndex] < 1 ? small : large).push(largeIndex);
  }

  for (const index of [...small, ...large]) {
    result[index * 4 + 0] = 1;
    result[index * 4 + 1] = index;
  }
  return result;
}

const CUBEMAP_CROSS_FACES = [
  { column: 1, row: 0, direction: (x: number, y: number) => ({ x, y: -1, z: y }) },
  { column: 0, row: 1, direction: (x: number, y: number) => ({ x: -1, y, z: x }) },
  { column: 1, row: 1, direction: (x: number, y: number) => ({ x, y, z: 1 }) },
  { column: 2, row: 1, direction: (x: number, y: number) => ({ x: 1, y, z: -x }) },
  { column: 3, row: 1, direction: (x: number, y: number) => ({ x: -x, y, z: -1 }) },
  { column: 1, row: 2, direction: (x: number, y: number) => ({ x, y: 1, z: -y }) }
] as const;

function sanitizeRadiance(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}
