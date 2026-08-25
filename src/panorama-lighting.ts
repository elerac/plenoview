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
export const DEFAULT_PANORAMA_LIGHTING_METHOD: PanoramaLightingMethod = 'sphericalHarmonics';
export const SPHERICAL_HARMONICS_MAX_DEGREE = 5;
export const SPHERICAL_HARMONICS_COEFFICIENT_COUNT =
  (SPHERICAL_HARMONICS_MAX_DEGREE + 1) ** 2;

const EQUIRECTANGULAR_SAMPLE_COLUMNS = 64;
const EQUIRECTANGULAR_SAMPLE_ROWS = 32;
const CUBEMAP_SAMPLE_COLUMNS_PER_FACE = 32;
const FOUR_PI = 4 * Math.PI;
const ENVIRONMENT_IMPORTANCE_UNIFORM_MIX = 0.02;
const REC709_LUMINANCE_R = 0.2126;
const REC709_LUMINANCE_G = 0.7152;
const REC709_LUMINANCE_B = 0.0722;
const SH_L5_M4_NORMALIZATION = Math.sqrt(3465 / Math.PI) / 4;
const DIFFUSE_CONVOLUTION_BY_BAND = [
  Math.PI,
  2 * Math.PI / 3,
  Math.PI / 4,
  0,
  -Math.PI / 24,
  0
] as const;

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

export function computeEnvironmentMapIrradiance(
  source: EnvironmentLightingSource
): Float32Array {
  return projectEnvironmentMapToSphericalHarmonicsIrradiance(
    createEnvironmentMapProjection(source)
  );
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

/**
 * Projects an equirectangular or 4x3 cubemap-cross image into real, fifth-degree
 * spherical harmonics and applies the clamped-cosine convolution for diffuse irradiance.
 * Coefficients are returned coefficient-major as 36 consecutive RGB triplets.
 */
export function projectEnvironmentMapToSphericalHarmonicsIrradiance(
  environment: EnvironmentMapProjection
): Float32Array {
  const coefficients = new Float64Array(SPHERICAL_HARMONICS_COEFFICIENT_COUNT * 3);
  if (environment.width <= 0 || environment.height <= 0) {
    return new Float32Array(coefficients);
  }

  const projection = environment.projection ?? resolvePanoramaProjection(
    environment.width,
    environment.height
  );
  const totalWeight = projection === 'cubemap-cross'
    ? accumulateCubemapCrossSamples(environment, coefficients)
    : accumulateEquirectangularSamples(environment, coefficients);

  if (!(totalWeight > 0)) {
    return new Float32Array(coefficients);
  }

  const solidAngleNormalization = FOUR_PI / totalWeight;
  for (let coefficientIndex = 0; coefficientIndex < SPHERICAL_HARMONICS_COEFFICIENT_COUNT; coefficientIndex += 1) {
    const band = Math.floor(Math.sqrt(coefficientIndex));
    const scale = solidAngleNormalization * DIFFUSE_CONVOLUTION_BY_BAND[band];
    const offset = coefficientIndex * 3;
    coefficients[offset + 0] *= scale;
    coefficients[offset + 1] *= scale;
    coefficients[offset + 2] *= scale;
  }

  return Float32Array.from(coefficients);
}

export function evaluateSphericalHarmonicsIrradiance(
  coefficients: ArrayLike<number>,
  direction: { x: number; y: number; z: number }
): [number, number, number] {
  const length = Math.hypot(direction.x, direction.y, direction.z);
  if (!(length > 0)) {
    return [0, 0, 0];
  }

  const basis = evaluateRealShBasis(
    direction.x / length,
    direction.y / length,
    direction.z / length
  );
  const result: [number, number, number] = [0, 0, 0];
  for (let coefficientIndex = 0; coefficientIndex < SPHERICAL_HARMONICS_COEFFICIENT_COUNT; coefficientIndex += 1) {
    const offset = coefficientIndex * 3;
    result[0] += (coefficients[offset + 0] ?? 0) * basis[coefficientIndex];
    result[1] += (coefficients[offset + 1] ?? 0) * basis[coefficientIndex];
    result[2] += (coefficients[offset + 2] ?? 0) * basis[coefficientIndex];
  }
  return result;
}

function accumulateEquirectangularSamples(
  environment: EnvironmentMapProjection,
  coefficients: Float64Array
): number {
  const sampleColumns = Math.max(1, Math.min(environment.width, EQUIRECTANGULAR_SAMPLE_COLUMNS));
  const sampleRows = Math.max(1, Math.min(environment.height, EQUIRECTANGULAR_SAMPLE_ROWS));
  const longitudeStep = 2 * Math.PI / sampleColumns;
  const latitudeStep = Math.PI / sampleRows;
  const color: EnvironmentMapSample = { r: 0, g: 0, b: 0 };
  let totalWeight = 0;

  for (let row = 0; row < sampleRows; row += 1) {
    const v = (row + 0.5) / sampleRows;
    const latitude = (v - 0.5) * Math.PI;
    const cosLatitude = Math.cos(latitude);
    const solidAngle = cosLatitude * longitudeStep * latitudeStep;
    const y = Math.min(environment.height - 1, Math.floor(v * environment.height));
    for (let column = 0; column < sampleColumns; column += 1) {
      const u = (column + 0.5) / sampleColumns;
      const longitude = (u - 0.5) * 2 * Math.PI;
      const x = Math.min(environment.width - 1, Math.floor(u * environment.width));
      accumulateSample(
        coefficients,
        environment.sample(x, y, color),
        Math.sin(longitude) * cosLatitude,
        Math.sin(latitude),
        Math.cos(longitude) * cosLatitude,
        solidAngle
      );
      totalWeight += solidAngle;
    }
  }

  return totalWeight;
}

function accumulateCubemapCrossSamples(
  environment: EnvironmentMapProjection,
  coefficients: Float64Array
): number {
  const faceSize = Math.floor(environment.width / 4);
  if (faceSize <= 0) {
    return 0;
  }

  const sampleColumns = Math.max(1, Math.min(faceSize, CUBEMAP_SAMPLE_COLUMNS_PER_FACE));
  const localStep = 2 / sampleColumns;
  const color: EnvironmentMapSample = { r: 0, g: 0, b: 0 };
  let totalWeight = 0;

  for (const face of CUBEMAP_CROSS_FACES) {
    for (let row = 0; row < sampleColumns; row += 1) {
      const localY = -1 + (row + 0.5) * localStep;
      const pixelY = face.row * faceSize + Math.min(
        faceSize - 1,
        Math.floor((row + 0.5) * faceSize / sampleColumns)
      );
      for (let column = 0; column < sampleColumns; column += 1) {
        const localX = -1 + (column + 0.5) * localStep;
        const pixelX = face.column * faceSize + Math.min(
          faceSize - 1,
          Math.floor((column + 0.5) * faceSize / sampleColumns)
        );
        const direction = face.direction(localX, localY);
        const length = Math.hypot(direction.x, direction.y, direction.z);
        const solidAngle = localStep * localStep / (length * length * length);
        accumulateSample(
          coefficients,
          environment.sample(pixelX, pixelY, color),
          direction.x / length,
          direction.y / length,
          direction.z / length,
          solidAngle
        );
        totalWeight += solidAngle;
      }
    }
  }

  return totalWeight;
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

function accumulateSample(
  coefficients: Float64Array,
  color: EnvironmentMapSample,
  x: number,
  y: number,
  z: number,
  weight: number
): void {
  const r = sanitizeRadiance(color.r);
  const g = sanitizeRadiance(color.g);
  const b = sanitizeRadiance(color.b);
  const basis = evaluateRealShBasis(x, y, z);
  for (let coefficientIndex = 0; coefficientIndex < SPHERICAL_HARMONICS_COEFFICIENT_COUNT; coefficientIndex += 1) {
    const weightedBasis = basis[coefficientIndex] * weight;
    const offset = coefficientIndex * 3;
    coefficients[offset + 0] += r * weightedBasis;
    coefficients[offset + 1] += g * weightedBasis;
    coefficients[offset + 2] += b * weightedBasis;
  }
}

function evaluateRealShBasis(x: number, y: number, z: number): readonly number[] {
  const x2 = x * x;
  const y2 = y * y;
  const z2 = z * z;
  const x4 = x2 * x2;
  const y4 = y2 * y2;
  const z4 = z2 * z2;

  return [
    0.28209479177387814,
    0.4886025119029199 * y,
    0.4886025119029199 * z,
    0.4886025119029199 * x,
    1.0925484305920792 * x * y,
    1.0925484305920792 * y * z,
    0.31539156525252005 * (3 * z2 - 1),
    1.0925484305920792 * x * z,
    0.5462742152960396 * (x2 - y2),
    0.5900435899266435 * y * (3 * x2 - y2),
    2.890611442640554 * x * y * z,
    0.4570457994644658 * y * (5 * z2 - 1),
    0.3731763325901154 * z * (5 * z2 - 3),
    0.4570457994644658 * x * (5 * z2 - 1),
    1.445305721320277 * z * (x2 - y2),
    0.5900435899266435 * x * (x2 - 3 * y2),
    2.5033429417967046 * x * y * (x2 - y2),
    1.7701307697799304 * y * z * (3 * x2 - y2),
    0.9461746957575601 * x * y * (7 * z2 - 1),
    0.6690465435572892 * y * z * (7 * z2 - 3),
    0.10578554691520431 * (35 * z2 * z2 - 30 * z2 + 3),
    0.6690465435572892 * x * z * (7 * z2 - 3),
    0.47308734787878004 * (x2 - y2) * (7 * z2 - 1),
    1.7701307697799304 * x * z * (x2 - 3 * y2),
    0.6258357354491761 * (x4 - 6 * x2 * y2 + y4),
    0.6563820568401701 * y * (5 * x4 - 10 * x2 * y2 + y4),
    SH_L5_M4_NORMALIZATION * x * y * z * (x2 - y2),
    0.4892382994352504 * y * (3 * x2 - y2) * (9 * z2 - 1),
    4.793536784973324 * x * y * z * (3 * z2 - 1),
    0.45294665119569694 * y * (21 * z4 - 14 * z2 + 1),
    0.1169503224534236 * z * (63 * z4 - 70 * z2 + 15),
    0.45294665119569694 * x * (21 * z4 - 14 * z2 + 1),
    2.396768392486662 * z * (x2 - y2) * (3 * z2 - 1),
    0.4892382994352504 * x * (x2 - 3 * y2) * (9 * z2 - 1),
    2.075662314881041 * z * (x4 - 6 * x2 * y2 + y4),
    0.6563820568401701 * x * (x4 - 10 * x2 * y2 + 5 * y4)
  ];
}

function sanitizeRadiance(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}
