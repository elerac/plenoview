export type EnvironmentMicrofacetDistribution = 'beckmann' | 'ggx';

export type EnvironmentSphereMaterialPreset =
  | 'roughConductor'
  | 'roughPlasticWhite'
  | 'roughPlasticBlack';

export interface EnvironmentSphereDiffuseReflectance {
  r: number;
  g: number;
  b: number;
}

export interface EnvironmentSphereMaterial {
  type: 'pplastic' | 'roughplastic' | 'smoothSilver' | 'roughSilver';
  diffuseReflectance: EnvironmentSphereDiffuseReflectance;
  alpha: number;
  intIor: number;
  extIor: number;
  distribution: EnvironmentMicrofacetDistribution;
  nonlinear: boolean;
}

export type EnvironmentSphereMaterialPatch =
  Partial<Omit<EnvironmentSphereMaterial, 'diffuseReflectance'>> & {
    diffuseReflectance?: Partial<EnvironmentSphereDiffuseReflectance>;
  };

export const ENVIRONMENT_SPHERE_ALPHA_MIN = 0.001;
export const ENVIRONMENT_SPHERE_ALPHA_MAX = 1;
export const ENVIRONMENT_SPHERE_IOR_MIN = 1;
export const ENVIRONMENT_SPHERE_IOR_MAX = 4;

const DEFAULT_DIFFUSE_REFLECTANCE: EnvironmentSphereDiffuseReflectance = {
  r: 0.5,
  g: 0.5,
  b: 0.5
};

export const DEFAULT_ENVIRONMENT_SPHERE_MATERIAL: Readonly<EnvironmentSphereMaterial> = Object.freeze({
  type: 'roughSilver',
  diffuseReflectance: Object.freeze({ ...DEFAULT_DIFFUSE_REFLECTANCE }),
  alpha: 0.01,
  intIor: 1.49,
  extIor: 1.000277,
  distribution: 'beckmann',
  nonlinear: false
});

export function createDefaultEnvironmentSphereMaterial(): EnvironmentSphereMaterial {
  return cloneEnvironmentSphereMaterial(DEFAULT_ENVIRONMENT_SPHERE_MATERIAL);
}

export function resolveEnvironmentSphereMaterialPreset(
  material: Readonly<EnvironmentSphereMaterial>
): EnvironmentSphereMaterialPreset {
  if (material.type === 'smoothSilver' || material.type === 'roughSilver') {
    return 'roughConductor';
  }
  const { r, g, b } = material.diffuseReflectance;
  return (r + g + b) / 3 >= 0.5 ? 'roughPlasticWhite' : 'roughPlasticBlack';
}

export function createEnvironmentSphereMaterialPresetPatch(
  preset: EnvironmentSphereMaterialPreset
): EnvironmentSphereMaterialPatch {
  if (preset === 'roughConductor') {
    return { type: 'roughSilver', alpha: 0.01, distribution: 'beckmann' };
  }
  const reflectance = preset === 'roughPlasticWhite' ? 1 : 0;
  return {
    type: 'pplastic',
    diffuseReflectance: { r: reflectance, g: reflectance, b: reflectance },
    alpha: 0.1,
    distribution: 'beckmann'
  };
}

export function cloneEnvironmentSphereMaterial(
  material: Readonly<EnvironmentSphereMaterial> | null | undefined
): EnvironmentSphereMaterial {
  const resolved = material ?? DEFAULT_ENVIRONMENT_SPHERE_MATERIAL;
  return {
    type: resolved.type,
    diffuseReflectance: { ...resolved.diffuseReflectance },
    alpha: resolved.alpha,
    intIor: resolved.intIor,
    extIor: resolved.extIor,
    distribution: resolved.distribution,
    nonlinear: resolved.nonlinear
  };
}

export function normalizeEnvironmentSphereMaterial(
  patch: EnvironmentSphereMaterialPatch | null | undefined,
  base: Readonly<EnvironmentSphereMaterial> = DEFAULT_ENVIRONMENT_SPHERE_MATERIAL
): EnvironmentSphereMaterial {
  const diffusePatch = patch?.diffuseReflectance;
  return {
    type: patch?.type === 'pplastic' || patch?.type === 'roughplastic' || patch?.type === 'smoothSilver' || patch?.type === 'roughSilver'
      ? patch.type
      : base.type,
    diffuseReflectance: {
      r: clampFinite(diffusePatch?.r, 0, 1, base.diffuseReflectance.r),
      g: clampFinite(diffusePatch?.g, 0, 1, base.diffuseReflectance.g),
      b: clampFinite(diffusePatch?.b, 0, 1, base.diffuseReflectance.b)
    },
    alpha: clampFinite(
      patch?.alpha,
      ENVIRONMENT_SPHERE_ALPHA_MIN,
      ENVIRONMENT_SPHERE_ALPHA_MAX,
      base.alpha
    ),
    intIor: clampFinite(
      patch?.intIor,
      ENVIRONMENT_SPHERE_IOR_MIN,
      ENVIRONMENT_SPHERE_IOR_MAX,
      base.intIor
    ),
    extIor: clampFinite(
      patch?.extIor,
      ENVIRONMENT_SPHERE_IOR_MIN,
      ENVIRONMENT_SPHERE_IOR_MAX,
      base.extIor
    ),
    // The viewer uses Beckmann for every center-sphere preset, including restored sessions.
    distribution: 'beckmann',
    nonlinear: typeof patch?.nonlinear === 'boolean' ? patch.nonlinear : base.nonlinear
  };
}

export function normalizeEnvironmentSphereMaterialValue(value: unknown): EnvironmentSphereMaterial | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const diffuseValue = record.diffuseReflectance;
  const diffuseRecord = diffuseValue && typeof diffuseValue === 'object' && !Array.isArray(diffuseValue)
    ? diffuseValue as Record<string, unknown>
    : {};
  return normalizeEnvironmentSphereMaterial({
    // Snapshots created before material types were introduced used roughplastic.
    type: record.type === 'pplastic' || record.type === 'smoothSilver' || record.type === 'roughSilver' ? record.type : 'roughplastic',
    diffuseReflectance: {
      r: finiteNumberOrUndefined(diffuseRecord.r),
      g: finiteNumberOrUndefined(diffuseRecord.g),
      b: finiteNumberOrUndefined(diffuseRecord.b)
    },
    alpha: finiteNumberOrUndefined(record.alpha),
    intIor: finiteNumberOrUndefined(record.intIor),
    extIor: finiteNumberOrUndefined(record.extIor),
    distribution: record.distribution === 'beckmann' || record.distribution === 'ggx'
      ? record.distribution
      : undefined,
    nonlinear: typeof record.nonlinear === 'boolean' ? record.nonlinear : undefined
  });
}

export function sameEnvironmentSphereMaterial(
  a: Readonly<EnvironmentSphereMaterial> | null | undefined,
  b: Readonly<EnvironmentSphereMaterial> | null | undefined
): boolean {
  const resolvedA = a ?? DEFAULT_ENVIRONMENT_SPHERE_MATERIAL;
  const resolvedB = b ?? DEFAULT_ENVIRONMENT_SPHERE_MATERIAL;
  return (
    resolvedA.type === resolvedB.type &&
    resolvedA.diffuseReflectance.r === resolvedB.diffuseReflectance.r &&
    resolvedA.diffuseReflectance.g === resolvedB.diffuseReflectance.g &&
    resolvedA.diffuseReflectance.b === resolvedB.diffuseReflectance.b &&
    resolvedA.alpha === resolvedB.alpha &&
    resolvedA.intIor === resolvedB.intIor &&
    resolvedA.extIor === resolvedB.extIor &&
    resolvedA.distribution === resolvedB.distribution &&
    resolvedA.nonlinear === resolvedB.nonlinear
  );
}

function clampFinite(value: number | undefined, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
}

function finiteNumberOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
