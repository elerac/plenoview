import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ENVIRONMENT_SPHERE_MATERIAL,
  cloneEnvironmentSphereMaterial,
  createDefaultEnvironmentSphereMaterial,
  createEnvironmentSphereMaterialPresetPatch,
  normalizeEnvironmentSphereMaterial,
  normalizeEnvironmentSphereMaterialValue,
  resolveEnvironmentSphereMaterialPreset,
  sameEnvironmentSphereMaterial
} from '../src/environment-sphere-material';

describe('environment sphere material', () => {
  it('defaults to Rough Conductor with Beckmann roughness 0.01', () => {
    expect(createDefaultEnvironmentSphereMaterial()).toEqual({
      type: 'roughSilver',
      diffuseReflectance: { r: 0.5, g: 0.5, b: 0.5 },
      alpha: 0.01,
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
      type: 'roughSilver',
      diffuseReflectance: { r: 0, g: 0.25, b: 1 },
      alpha: 0.001,
      intIor: 4,
      extIor: DEFAULT_ENVIRONMENT_SPHERE_MATERIAL.extIor,
      distribution: 'beckmann',
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
    expect(sameEnvironmentSphereMaterial(material, { ...cloned, type: 'roughplastic' })).toBe(false);
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
      type: 'roughplastic',
      diffuseReflectance: { r: 0.2, g: 0.3, b: 0.4 },
      alpha: 0.35,
      intIor: 1.6,
      extIor: 1,
      distribution: 'beckmann',
      nonlinear: true
    });
    expect(normalizeEnvironmentSphereMaterialValue('invalid')).toBeNull();
    expect(normalizeEnvironmentSphereMaterialValue({ type: 'smoothSilver' })?.type).toBe('smoothSilver');
    expect(normalizeEnvironmentSphereMaterial({ type: 'roughplastic' }).type).toBe('roughplastic');
    expect(normalizeEnvironmentSphereMaterial({ type: 'pplastic' }).type).toBe('pplastic');
    expect(normalizeEnvironmentSphereMaterialValue({ type: 'pplastic', alpha: 0.12 })?.type).toBe('pplastic');
  });

  it('selects polarized white and black plastic at 0.1 and conductor at 0.01', () => {
    const edited = normalizeEnvironmentSphereMaterial({ alpha: 0.15 });
    for (const [preset, reflectance] of [['roughPlasticWhite', 1], ['roughPlasticBlack', 0]] as const) {
      const material = normalizeEnvironmentSphereMaterial(createEnvironmentSphereMaterialPresetPatch(preset), edited);
      expect(material).toMatchObject({
        type: 'pplastic', alpha: 0.1, distribution: 'beckmann',
        diffuseReflectance: { r: reflectance, g: reflectance, b: reflectance }
      });
      expect(resolveEnvironmentSphereMaterialPreset(material)).toBe(preset);
      const conductor = normalizeEnvironmentSphereMaterial(createEnvironmentSphereMaterialPresetPatch('roughConductor'), material);
      expect(conductor).toMatchObject({ type: 'roughSilver', alpha: 0.01, distribution: 'beckmann' });
      expect(resolveEnvironmentSphereMaterialPreset(conductor)).toBe('roughConductor');
    }
  });
});
