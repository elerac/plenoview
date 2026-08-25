import type { EnvironmentMicrofacetDistribution } from './environment-sphere-material';

export interface RoughPlasticSmithG1Input {
  cosTheta: number;
  directionDotMicrofacet: number;
  alpha: number;
  distribution: EnvironmentMicrofacetDistribution;
}

export function evaluateDielectricFresnel(cosThetaI: number, eta: number): number {
  const safeEta = Math.max(Math.abs(eta), 1e-6);
  const cosTheta = clamp(Math.abs(cosThetaI), 0, 1);
  const sinThetaTSquared = Math.max(0, 1 - cosTheta * cosTheta) / (safeEta * safeEta);
  if (sinThetaTSquared >= 1) {
    return 1;
  }

  const cosThetaT = Math.sqrt(Math.max(0, 1 - sinThetaTSquared));
  const rs = safeDivide(cosTheta - safeEta * cosThetaT, cosTheta + safeEta * cosThetaT);
  const rp = safeDivide(safeEta * cosTheta - cosThetaT, safeEta * cosTheta + cosThetaT);
  return clamp(0.5 * (rs * rs + rp * rp), 0, 1);
}

export function evaluateRoughPlasticSmithG1(input: RoughPlasticSmithG1Input): number {
  const cosTheta = clamp(input.cosTheta, -1, 1);
  if (cosTheta <= 0 || input.directionDotMicrofacet * cosTheta <= 0) {
    return 0;
  }

  const alpha = clamp(input.alpha, 1e-4, 1);
  const sinThetaSquared = Math.max(0, 1 - cosTheta * cosTheta);
  const tanThetaAlphaSquared = alpha * alpha * sinThetaSquared /
    Math.max(cosTheta * cosTheta, 1e-12);
  if (tanThetaAlphaSquared <= 1e-12) {
    return 1;
  }

  if (input.distribution === 'ggx') {
    return 2 / (1 + Math.sqrt(1 + tanThetaAlphaSquared));
  }

  const a = 1 / Math.sqrt(tanThetaAlphaSquared);
  if (a >= 1.6) {
    return 1;
  }
  const aSquared = a * a;
  return (3.535 * a + 2.181 * aSquared) /
    (1 + 2.276 * a + 2.577 * aSquared);
}

export function approximateInternalDiffuseReflectance(eta: number): number {
  const safeEta = Math.max(Math.abs(eta), 1e-3);
  if (Math.abs(safeEta - 1) <= 1e-4) {
    return 0;
  }
  if (safeEta < 1) {
    const inverseEta = 1 / safeEta;
    const inverseEtaSquared = inverseEta * inverseEta;
    return clamp(
      -0.4399 + 0.7099 * inverseEta - 0.3319 * inverseEtaSquared +
      0.0636 * inverseEtaSquared * inverseEta,
      0,
      0.999
    );
  }

  const inverseEta = 1 / safeEta;
  return clamp(
    -1.4399 * inverseEta * inverseEta + 0.7099 * inverseEta +
    0.6681 + 0.0636 * safeEta,
    0,
    0.999
  );
}

function safeDivide(numerator: number, denominator: number): number {
  return numerator / Math.max(Math.abs(denominator), 1e-12);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
