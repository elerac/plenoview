export type EnvironmentMicrofacetDistribution = 'beckmann' | 'ggx';

export interface EnvironmentSphereDiffuseReflectance {
  r: number;
  g: number;
  b: number;
}

export interface EnvironmentSphereMaterial {
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
  diffuseReflectance: Object.freeze({ ...DEFAULT_DIFFUSE_REFLECTANCE }),
  alpha: 0.1,
  intIor: 1.49,
  extIor: 1.000277,
  distribution: 'beckmann',
  nonlinear: false
});

export function createDefaultEnvironmentSphereMaterial(): EnvironmentSphereMaterial {
  return cloneEnvironmentSphereMaterial(DEFAULT_ENVIRONMENT_SPHERE_MATERIAL);
}

export function cloneEnvironmentSphereMaterial(
  material: Readonly<EnvironmentSphereMaterial> | null | undefined
): EnvironmentSphereMaterial {
  const resolved = material ?? DEFAULT_ENVIRONMENT_SPHERE_MATERIAL;
  return {
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
    distribution: patch?.distribution === 'beckmann' || patch?.distribution === 'ggx'
      ? patch.distribution
      : base.distribution,
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
