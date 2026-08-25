import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ENVIRONMENT_SPHERE_MATERIAL,
  cloneEnvironmentSphereMaterial,
  createDefaultEnvironmentSphereMaterial,
  normalizeEnvironmentSphereMaterial,
  normalizeEnvironmentSphereMaterialValue,
  sameEnvironmentSphereMaterial
} from '../src/environment-sphere-material';

describe('environment sphere material', () => {
  it('uses Mitsuba roughplastic defaults', () => {
    expect(createDefaultEnvironmentSphereMaterial()).toEqual({
      diffuseReflectance: { r: 0.5, g: 0.5, b: 0.5 },
      alpha: 0.1,
      intIor: 1.49,
      extIor: 1.000277,
      distribution: 'beckmann',
      nonlinear: false
    });
  });

  it('normalizes patches against the current material', () => {
    const normalized = normalizeEnvironmentSphereMaterial({
      diffuseReflectance: { r: -1, g: 0.25, b: 2 },
      alpha: 0,
      intIor: 8,
      extIor: Number.NaN,
      distribution: 'ggx',
      nonlinear: true
    });

    expect(normalized).toEqual({
      diffuseReflectance: { r: 0, g: 0.25, b: 1 },
      alpha: 0.001,
      intIor: 4,
      extIor: DEFAULT_ENVIRONMENT_SPHERE_MATERIAL.extIor,
      distribution: 'ggx',
      nonlinear: true
    });
  });

  it('clones nested values and compares structurally', () => {
    const material = createDefaultEnvironmentSphereMaterial();
    const cloned = cloneEnvironmentSphereMaterial(material);

    expect(cloned).toEqual(material);
    expect(cloned).not.toBe(material);
    expect(cloned.diffuseReflectance).not.toBe(material.diffuseReflectance);
    expect(sameEnvironmentSphereMaterial(material, cloned)).toBe(true);
    cloned.diffuseReflectance.r = 0.25;
    expect(sameEnvironmentSphereMaterial(material, cloned)).toBe(false);
  });

  it('normalizes unknown serialized material values', () => {
    expect(normalizeEnvironmentSphereMaterialValue({
      diffuseReflectance: { r: 0.2, g: 0.3, b: 0.4 },
      alpha: 0.35,
      intIor: 1.6,
      extIor: 1,
      distribution: 'ggx',
      nonlinear: true
    })).toMatchObject({
      diffuseReflectance: { r: 0.2, g: 0.3, b: 0.4 },
      alpha: 0.35,
      intIor: 1.6,
      extIor: 1,
      distribution: 'ggx',
      nonlinear: true
    });
    expect(normalizeEnvironmentSphereMaterialValue('invalid')).toBeNull();
  });
});
