import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  computeRoughPlasticTransmittance,
  integrateRoughDielectric,
  interpolateRoughPlasticTransmittance
} from '../src/roughplastic-transmittance';
import { evaluateDielectricFresnel } from '../src/roughplastic';

describe('Mitsuba rough plastic hemispherical tables', () => {
  it('preserves all angular values from the pre-optimization Beckmann tables', () => {
    // Captured before reusing X slopes across quadrature rows; compare every
    // angle at both narrow and broad roughness, including internal reflection.
    const references = JSON.parse(readFileSync(new URL('./helpers/roughplastic-transmittance-reference.json', import.meta.url), 'utf8')) as {
      alpha: number; eta: number; externalTransmittance: number[]; internalReflectance: number;
    }[];
    for (const reference of references) {
      const actual = computeRoughPlasticTransmittance({ ...reference, distribution: 'beckmann' });
      expect(actual.externalTransmittance.length).toBe(reference.externalTransmittance.length);
      actual.externalTransmittance.forEach((value, index) => expect(value).toBeCloseTo(reference.externalTransmittance[index], 7));
      expect(actual.internalReflectance).toBeCloseTo(reference.internalReflectance, 12);
    }
  });

  it.each(['beckmann', 'ggx'] as const)('approaches smooth-interface Fresnel as %s roughness tends to zero', distribution => {
    for (const mu of [0.3, 0.7, 1]) {
      const input = { distribution, alpha: 1e-4, eta: 1.5 };
      const reflection = integrateRoughDielectric(input, mu, true);
      const transmission = integrateRoughDielectric(input, mu, false);
      expect(reflection).toBeCloseTo(evaluateDielectricFresnel(mu, 1.5), 5);
      expect(transmission).toBeCloseTo(1 - evaluateDielectricFresnel(mu, 1.5), 5);
      expect(reflection + transmission).toBeCloseTo(1, 5);
    }
  });

  it.each(['beckmann', 'ggx'] as const)('keeps %s quadrature converged at substantial roughness', distribution => {
    const input = { distribution, alpha: 0.4, eta: 1.49 / 1.000277 };
    for (const reflection of [false, true]) {
      const coarse = integrateRoughDielectric(input, 0.6, reflection, 32);
      const refined = integrateRoughDielectric(input, 0.6, reflection, 64);
      expect(Math.abs(coarse - refined)).toBeLessThan(0.001);
      expect(coarse).toBeGreaterThan(0);
      expect(coarse).toBeLessThan(1);
    }
    const rough = integrateRoughDielectric(input, 0.05, false);
    expect(Math.abs(rough - (1 - evaluateDielectricFresnel(0.05, input.eta)))).toBeGreaterThan(0.1);
  });

  it.each(['beckmann', 'ggx'] as const)('builds the same 64-node %s angular table and endpoint interpolation', distribution => {
    const table = computeRoughPlasticTransmittance({ distribution, alpha: 0.2, eta: 1.49 / 1.000277 });
    expect(table.externalTransmittance.length).toBe(64);
    expect(Array.from(table.externalTransmittance).every(value => Number.isFinite(value) && value >= 0 && value <= 1)).toBe(true);
    expect(table.internalReflectance).toBeGreaterThan(0);
    expect(table.internalReflectance).toBeLessThan(1);
    expect(interpolateRoughPlasticTransmittance(table.externalTransmittance, 0)).toBe(table.externalTransmittance[0]);
    expect(interpolateRoughPlasticTransmittance(table.externalTransmittance, 1)).toBe(table.externalTransmittance[63]);
    expect(interpolateRoughPlasticTransmittance(table.externalTransmittance, 0.5))
      .toBeCloseTo((table.externalTransmittance[31] + table.externalTransmittance[32]) / 2, 12);
  });
});
