import { describe, expect, it } from 'vitest';
import {
  approximateInternalDiffuseReflectance,
  evaluateDielectricFresnel,
  evaluateRoughPlasticSmithG1
} from '../src/roughplastic';

describe('rough plastic reference math', () => {
  it('matches dielectric Fresnel at normal and grazing incidence', () => {
    const eta = 1.49 / 1.000277;
    const expectedF0 = ((eta - 1) / (eta + 1)) ** 2;

    expect(evaluateDielectricFresnel(1, eta)).toBeCloseTo(expectedF0, 12);
    expect(evaluateDielectricFresnel(1e-8, eta)).toBeGreaterThan(0.999);
  });

  it('handles total internal reflection for reciprocal IOR', () => {
    expect(evaluateDielectricFresnel(0.5, 1 / 1.49)).toBe(1);
  });

  it('uses Mitsuba-compatible Beckmann and GGX Smith masking behavior', () => {
    for (const distribution of ['beckmann', 'ggx'] as const) {
      expect(evaluateRoughPlasticSmithG1({
        cosTheta: 1,
        directionDotMicrofacet: 1,
        alpha: 0.1,
        distribution
      })).toBe(1);
      expect(evaluateRoughPlasticSmithG1({
        cosTheta: 0.2,
        directionDotMicrofacet: -0.1,
        alpha: 0.3,
        distribution
      })).toBe(0);

      const grazing = evaluateRoughPlasticSmithG1({
        cosTheta: 0.1,
        directionDotMicrofacet: 0.5,
        alpha: 0.3,
        distribution
      });
      expect(grazing).toBeGreaterThan(0);
      expect(grazing).toBeLessThan(1);
    }
  });

  it('keeps the internal diffuse-reflection approximation finite and bounded', () => {
    for (const eta of [1 / 1.49, 1, 1.49, 2.5]) {
      const reflectance = approximateInternalDiffuseReflectance(eta);
      expect(Number.isFinite(reflectance)).toBe(true);
      expect(reflectance).toBeGreaterThanOrEqual(0);
      expect(reflectance).toBeLessThan(1);
    }
    expect(approximateInternalDiffuseReflectance(1)).toBe(0);
  });
});
