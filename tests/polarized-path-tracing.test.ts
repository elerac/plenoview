import { describe, expect, it } from 'vitest';
import {
  apply, basisRotation, environmentBasisRotation, normalize, penvmapDirectionToUv,
  pplasticBsdf, pplasticDiffuseMueller, pplasticPdf, reflectCoherency, reflectionMueller,
  sensorBasisRotation, stokesBasis, transmissionMueller, viewerToPenvmap,
  worldReflectionMueller, type Stokes
} from './helpers/polarization-reference';

function expectStokesClose(actual: Stokes, expected: Stokes): void {
  actual.forEach((value, index) => expect(value).toBeCloseTo(expected[index], 11));
}

describe('Mitsuba polarization numerical references', () => {
  it('retains the Verdet normal-incidence sign reversal for S2 and S3', () => {
    const eta = 0.2, k = 3;
    const reflectance = ((eta - 1) ** 2 + k * k) / ((eta + 1) ** 2 + k * k);
    expectStokesClose(apply(reflectionMueller(1, eta, k), [2, -0.4, 0.7, -0.3]),
      [2 * reflectance, -0.4 * reflectance, -0.7 * reflectance, 0.3 * reflectance]);
  });

  it('matches independent Jones coherency transport of mixed linear/circular light', () => {
    for (const cosine of [1, 0.7, 0.1, 0.001]) {
      for (const [eta, k] of [[0.2, 3], [1.5, 0], [0.4, 2.7]]) {
        const input: Stokes = [1.2, -0.2, 0.5, -0.4];
        expectStokesClose(apply(reflectionMueller(cosine, eta, k), input), reflectCoherency(input, cosine, eta, k));
      }
    }
  });

  it('generates purely s-polarized reflection at the dielectric Brewster angle', () => {
    const matrix = reflectionMueller(1 / Math.sqrt(1 + 1.5 ** 2), 1.5, 0);
    const result = apply(matrix, [1, 0, 0, 0]);
    expect(result[0]).toBeCloseTo(0.07396449704142012, 13);
    expectStokesClose(result, [result[0], result[0], 0, 0]);
  });

  it('rotates reference axes with Mitsuba double-angle signs without changing circular handedness', () => {
    const rotation = basisRotation([0, 0, 1], [1, 0, 0], normalize([1, -1, 0]));
    expectStokesClose(apply(rotation, [1, 1, 0, 0]), [1, 0, 1, 0]);
    for (const d of [normalize([1, 2, 3]), normalize([-2, 1, -3]), [0, 1, 0] as const]) {
      expectStokesClose(apply(environmentBasisRotation(d), [1, 0, 0, -1]), [1, 0, 0, -1]);
      const basis = stokesBasis(d);
      expect(Math.hypot(...basis)).toBeCloseTo(1, 13);
      expect(basis.reduce((sum, value, i) => sum + value * d[i], 0)).toBeCloseTo(0, 13);
    }
  });

  it('maps the emitter with a proper rotation and top/bottom latitude endpoints', () => {
    expect(penvmapDirectionToUv(viewerToPenvmap([0, 0, 1]))).toEqual([0.5, 0.5]);
    expect(penvmapDirectionToUv(viewerToPenvmap([0, -1, 0]))[1]).toBe(0);
    expect(penvmapDirectionToUv(viewerToPenvmap([0, 1, 0]))[1]).toBe(1);
  });

  it('expresses sensor Stokes around the propagated direction for off-axis camera rays', () => {
    const ray = normalize([1, 0.4, 2]);
    const sensor = sensorBasisRotation(ray, [0, -1, 0]);
    const input: Stokes = [1, 0.3, -0.4, -0.6];
    const output = apply(sensor, input);
    expect(output[0]).toBe(input[0]);
    expect(output[3]).toBe(input[3]);
    expect(Math.hypot(output[1], output[2])).toBeCloseTo(0.5, 13);
  });

  it('preserves fully polarized states through noncoplanar conductor reflections', () => {
    const view = normalize([0.2, 0.4, 1]), light = normalize([-0.5, 0.3, 1]);
    const normal = normalize([view[0] + light[0], view[1] + light[1], view[2] + light[2]]);
    const output = apply(worldReflectionMueller(normal, view, light, 0.2, 3), [1, 0.36, -0.48, 0.8]);
    expect(Math.hypot(output[1], output[2], output[3])).toBeCloseTo(output[0], 12);
    expect(output.every(Number.isFinite)).toBe(true);
  });
});

describe('Mitsuba polarized plastic references', () => {
  it('transmits energy conservatively at a single dielectric interface including TIR', () => {
    for (const eta of [1.5, 1 / 1.5]) {
      for (const cosine of [1, 0.8, 0.5, 0.01]) {
        const transmission = transmissionMueller(cosine, eta);
        const reflection = reflectionMueller(cosine, eta, 0);
        expect(transmission[0][0] + reflection[0][0]).toBeCloseTo(1, 12);
        expect(transmission[0][1] + reflection[0][1]).toBeCloseTo(0, 12);
      }
    }
    expectStokesClose(apply(transmissionMueller(0.5, 1 / 1.5), [1, 0.2, 0.3, 0.4]), [0, 0, 0, 0]);
  });

  it('introduces diffuse exit polarization with the opposite orientation to specular reflection', () => {
    const normal = [0, 0, 1] as const;
    const view = normalize([1.4, 0, 1]), light = normalize([0.5, 0, 1]);
    const diffuse = apply(pplasticDiffuseMueller(normal, view, light, 1.5), [1, 0, 0, 0]);
    const half = normalize([view[0] + light[0], 0, view[2] + light[2]]);
    const specular = apply(worldReflectionMueller(half, view, light, 1.5, 0), [1, 0, 0, 0]);
    expect(diffuse[0]).toBeGreaterThan(0);
    expect(Math.abs(diffuse[1])).toBeGreaterThan(.01);
    expect(diffuse[1] * specular[1]).toBeLessThan(0);
    expect(diffuse[2]).toBeCloseTo(0, 12);
    expect(diffuse[3]).toBe(0);
  });

  it('retains incoming linear-polarization intensity dependence across diffuse depolarization', () => {
    const diffuse = pplasticDiffuseMueller([0, 0, 1], normalize([1, .2, 1]), normalize([1.2, .4, 1]), 1.5);
    const horizontal = apply(diffuse, [1, 1, 0, 0]);
    const vertical = apply(diffuse, [1, -1, 0, 0]);
    expect(Math.abs(horizontal[0] - vertical[0])).toBeGreaterThan(.01);
    expect(horizontal[1] / horizontal[0]).toBeCloseTo(vertical[1] / vertical[0], 12);
    expect(horizontal[2] / horizontal[0]).toBeCloseTo(vertical[2] / vertical[0], 12);
    expect(horizontal[3]).toBe(0);
    expect(vertical[3]).toBe(0);
  });

  it.each(['beckmann', 'ggx'] as const)('has the analytic normal-incidence %s diffuse+specular limit', distribution => {
    const eta = 1.5, alpha = .2, albedo = .5;
    const input = { normal: [0, 0, 1] as const, view: [0, 0, 1] as const, light: [0, 0, 1] as const, eta, alpha, albedo, distribution };
    const f0 = ((eta - 1) / (eta + 1)) ** 2;
    const expected = f0 / (4 * Math.PI * alpha * alpha) + albedo * (1 - f0) ** 2 / Math.PI;
    expectStokesClose(apply(pplasticBsdf(input), [1, 0, 0, 0]), [expected, 0, 0, 0]);
    const probability = 1 / (1 + albedo);
    expect(pplasticPdf(input)).toBeCloseTo(probability / (4 * Math.PI * alpha * alpha) + (1 - probability) / Math.PI, 12);
  });
});
