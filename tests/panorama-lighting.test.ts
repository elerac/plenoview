import { describe, expect, it } from 'vitest';
import {
  buildEnvironmentImportanceSamplingTable,
  type EnvironmentMapSample
} from '../src/panorama-lighting';

describe('panorama environment lighting', () => {
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
