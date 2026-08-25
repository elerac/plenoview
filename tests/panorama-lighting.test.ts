import { describe, expect, it } from 'vitest';
import {
  buildEnvironmentImportanceSamplingTable,
  evaluateSphericalHarmonicsIrradiance,
  projectEnvironmentMapToSphericalHarmonicsIrradiance,
  SPHERICAL_HARMONICS_COEFFICIENT_COUNT,
  SPHERICAL_HARMONICS_MAX_DEGREE,
  type EnvironmentMapSample
} from '../src/panorama-lighting';

const AXIS_DIRECTIONS = [
  { x: 1, y: 0, z: 0 },
  { x: -1, y: 0, z: 0 },
  { x: 0, y: 1, z: 0 },
  { x: 0, y: -1, z: 0 },
  { x: 0, y: 0, z: 1 },
  { x: 0, y: 0, z: -1 }
] as const;

describe('panorama environment lighting', () => {
  it('uses fifth-degree RGB spherical harmonics', () => {
    expect(SPHERICAL_HARMONICS_MAX_DEGREE).toBe(5);
    expect(SPHERICAL_HARMONICS_COEFFICIENT_COUNT).toBe(36);
  });

  it('projects a constant RGB equirectangular environment to constant diffuse irradiance', () => {
    const radiance = { r: 0.25, g: 1, b: 4 };
    const coefficients = projectEnvironmentMapToSphericalHarmonicsIrradiance({
      width: 64,
      height: 32,
      projection: 'equirectangular',
      sample: (_x, _y, output) => assignSample(output, radiance)
    });

    for (const direction of AXIS_DIRECTIONS) {
      const irradiance = evaluateSphericalHarmonicsIrradiance(coefficients, direction);
      const expected = [
        Math.PI * radiance.r,
        Math.PI * radiance.g,
        Math.PI * radiance.b
      ] as const;
      for (let channel = 0; channel < 3; channel += 1) {
        expect(Math.abs(irradiance[channel] - expected[channel]) / expected[channel])
          .toBeLessThan(0.001);
      }
    }
  });

  it('responds more strongly toward a directional equirectangular source', () => {
    const coefficients = projectEnvironmentMapToSphericalHarmonicsIrradiance({
      width: 64,
      height: 32,
      projection: 'equirectangular',
      sample: (x, y, output) => assignSample(
        output,
        x === 32 && y === 16
          ? { r: 20, g: 10, b: 5 }
          : { r: 0, g: 0, b: 0 }
      )
    });

    const towardSource = evaluateSphericalHarmonicsIrradiance(
      coefficients,
      { x: 0, y: 0, z: 1 }
    );
    const awayFromSource = evaluateSphericalHarmonicsIrradiance(
      coefficients,
      { x: 0, y: 0, z: -1 }
    );

    expect(towardSource[0]).toBeGreaterThan(0);
    expect(towardSource[0]).toBeGreaterThan(awayFromSource[0] * 8);
    expect(towardSource[1]).toBeCloseTo(towardSource[0] * 0.5, 5);
    expect(towardSource[2]).toBeCloseTo(towardSource[0] * 0.25, 5);
  });

  it('zeros the odd third- and fifth-degree Lambertian bands and retains fourth-degree detail', () => {
    const coefficients = projectEnvironmentMapToSphericalHarmonicsIrradiance({
      width: 64,
      height: 32,
      projection: 'equirectangular',
      sample: (x, y, output) => assignSample(
        output,
        x === 32 && y === 16
          ? { r: 20, g: 10, b: 5 }
          : { r: 0, g: 0, b: 0 }
      )
    });

    expect(coefficients).toHaveLength(SPHERICAL_HARMONICS_COEFFICIENT_COUNT * 3);
    expect(Array.from(coefficients.slice(9 * 3, 16 * 3)).every(value => value === 0))
      .toBe(true);
    expect(Array.from(coefficients.slice(16 * 3, 25 * 3)).some(value => Math.abs(value) > 1e-6))
      .toBe(true);
    expect(Array.from(coefficients.slice(25 * 3, 36 * 3)).every(value => value === 0))
      .toBe(true);
    expect(coefficients[20 * 3]).toBeLessThan(0);
  });

  it('evaluates fifth-degree real-SH basis coefficients', () => {
    const coefficients = new Float32Array(SPHERICAL_HARMONICS_COEFFICIENT_COUNT * 3);
    coefficients[25 * 3 + 0] = 1;
    coefficients[30 * 3 + 1] = 1;
    coefficients[35 * 3 + 2] = 1;
    const direction = { x: 2, y: -1, z: 3 };
    const length = Math.hypot(direction.x, direction.y, direction.z);
    const x = direction.x / length;
    const y = direction.y / length;
    const z = direction.z / length;
    const x2 = x * x;
    const y2 = y * y;
    const z2 = z * z;
    const x4 = x2 * x2;
    const y4 = y2 * y2;
    const z4 = z2 * z2;

    expect(evaluateSphericalHarmonicsIrradiance(coefficients, direction)).toEqual([
      0.6563820568401701 * y * (5 * x4 - 10 * x2 * y2 + y4),
      0.1169503224534236 * z * (63 * z4 - 70 * z2 + 15),
      0.6563820568401701 * x * (x4 - 10 * x2 * y2 + 5 * y4)
    ]);
  });

  it('sanitizes negative and non-finite radiance before projection', () => {
    const coefficients = projectEnvironmentMapToSphericalHarmonicsIrradiance({
      width: 64,
      height: 32,
      projection: 'equirectangular',
      sample: (_x, _y, output) => assignSample(output, {
        r: -3,
        g: Number.NaN,
        b: 2
      })
    });

    expect(Array.from(coefficients).every(Number.isFinite)).toBe(true);
    expect(
      Array.from(coefficients)
        .filter((_value, index) => index % 3 === 0)
        .every(value => value === 0)
    ).toBe(true);
    expect(
      Array.from(coefficients)
        .filter((_value, index) => index % 3 === 1)
        .every(value => value === 0)
    ).toBe(true);

    for (const direction of AXIS_DIRECTIONS) {
      const irradiance = evaluateSphericalHarmonicsIrradiance(coefficients, direction);
      expect(irradiance[0]).toBe(0);
      expect(irradiance[1]).toBe(0);
      expect(irradiance[2]).toBeCloseTo(2 * Math.PI, 2);
    }
  });

  it('projects a constant RGB horizontal-cross cubemap as constant irradiance', () => {
    const radiance = { r: 3, g: 1.5, b: 0.5 };
    const coefficients = projectEnvironmentMapToSphericalHarmonicsIrradiance({
      width: 32,
      height: 24,
      sample: (_x, _y, output) => assignSample(output, radiance)
    });

    for (const direction of AXIS_DIRECTIONS) {
      const irradiance = evaluateSphericalHarmonicsIrradiance(coefficients, direction);
      const expected = [
        Math.PI * radiance.r,
        Math.PI * radiance.g,
        Math.PI * radiance.b
      ] as const;
      for (let channel = 0; channel < 3; channel += 1) {
        expect(Math.abs(irradiance[channel] - expected[channel]) / expected[channel])
          .toBeLessThan(0.001);
      }
    }
  });

  it('preserves the positive-X face direction in a horizontal-cross cubemap', () => {
    const faceSize = 8;
    const coefficients = projectEnvironmentMapToSphericalHarmonicsIrradiance({
      width: faceSize * 4,
      height: faceSize * 3,
      projection: 'cubemap-cross',
      sample: (x, y, output) => {
        const isPositiveXFace =
          x >= faceSize * 2 && x < faceSize * 3 &&
          y >= faceSize && y < faceSize * 2;
        return assignSample(
          output,
          isPositiveXFace
            ? { r: 1, g: 0.5, b: 0.25 }
            : { r: 0, g: 0, b: 0 }
        );
      }
    });

    const towardFace = evaluateSphericalHarmonicsIrradiance(
      coefficients,
      { x: 1, y: 0, z: 0 }
    );
    const awayFromFace = evaluateSphericalHarmonicsIrradiance(
      coefficients,
      { x: -1, y: 0, z: 0 }
    );

    expect(towardFace[0]).toBeGreaterThan(0);
    expect(towardFace[0]).toBeGreaterThan(awayFromFace[0] * 8);
    expect(towardFace[1]).toBeCloseTo(towardFace[0] * 0.5, 5);
    expect(towardFace[2]).toBeCloseTo(towardFace[0] * 0.25, 5);
  });

  it('builds a normalized solid-angle environment alias table with full support', () => {
    const table = buildEnvironmentImportanceSamplingTable({
      width: 64,
      height: 32,
      projection: 'equirectangular',
      sample: (x, y, output) => assignSample(
        output,
        x === 32 && y === 16
          ? { r: 100, g: 100, b: 100 }
          : { r: 0, g: 0, b: 0 }
      )
    });
    const masses = readImportanceProbabilityMasses(table.rgba32f);

    expect(table.projection).toBe('equirectangular');
    expect(table.gridWidth).toBe(64);
    expect(table.gridHeight).toBe(32);
    expect(table.entryCount).toBe(64 * 32);
    expect(masses.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 5);
    expect(Math.min(...masses)).toBeGreaterThan(0);
    expect(masses[16 * 64 + 32]).toBeGreaterThan(masses[16 * 64 + 31] * 1000);
    for (let index = 0; index < table.entryCount; index += 1) {
      expect(table.rgba32f[index * 4]).toBeGreaterThanOrEqual(0);
      expect(table.rgba32f[index * 4]).toBeLessThanOrEqual(1);
      expect(table.rgba32f[index * 4 + 1]).toBeGreaterThanOrEqual(0);
      expect(table.rgba32f[index * 4 + 1]).toBeLessThan(table.entryCount);
    }
  });

  it('packs all six horizontal-cross cubemap faces into the importance table', () => {
    const table = buildEnvironmentImportanceSamplingTable({
      width: 32,
      height: 24,
      projection: 'cubemap-cross',
      sample: (_x, _y, output) => assignSample(output, { r: 1, g: 1, b: 1 })
    });
    const masses = readImportanceProbabilityMasses(table.rgba32f);

    expect(table.gridWidth).toBe(8);
    expect(table.gridHeight).toBe(8);
    expect(table.entryCount).toBe(6 * 8 * 8);
    expect(masses.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 5);
    expect(masses.every(value => value > 0)).toBe(true);
  });
});

function readImportanceProbabilityMasses(rgba32f: Float32Array): number[] {
  return Array.from(
    { length: rgba32f.length / 4 },
    (_unused, index) => rgba32f[index * 4 + 2]
  );
}

function assignSample(
  output: EnvironmentMapSample,
  value: EnvironmentMapSample
): EnvironmentMapSample {
  output.r = value.r;
  output.g = value.g;
  output.b = value.b;
  return output;
}
