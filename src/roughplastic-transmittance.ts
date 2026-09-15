import type { EnvironmentMicrofacetDistribution } from './environment-sphere-material';

// Mitsuba 3, src/bsdfs/roughplastic.cpp and include/mitsuba/render/microfacet.h.
// Reference revision: f2f30d101bbd5ee07b6e54643c7fef6949924b8f (BSD-3-Clause).
// Keep the same angular resolution, visible-normal integrand, Gauss-Legendre
// orders and internal-reflectance average. Float rounding can differ from Dr.Jit.
export const ROUGH_PLASTIC_TRANSMITTANCE_RESOLUTION = 64;

export interface RoughPlasticTransmittanceInput {
  alpha: number;
  eta: number;
  distribution: EnvironmentMicrofacetDistribution;
}

export interface RoughPlasticTransmittance {
  externalTransmittance: Float32Array;
  internalReflectance: number;
}

type Vector3 = readonly [number, number, number];
interface QuadratureSample { x: number; y: number; weight: number; inverseErfY: number }
const quadratureCache = new Map<number, readonly QuadratureSample[]>();

/** The integral is evaluated only when a material's IOR/roughness changes. */
export function computeRoughPlasticTransmittance(
  input: RoughPlasticTransmittanceInput
): RoughPlasticTransmittance {
  const steps = computeRoughPlasticTransmittanceSteps(input);
  for (;;) {
    const step = steps.next();
    if (step.done) return step.value;
  }
}

/** Yield between angular integrals so live preparation can budget its CPU work. */
export function* computeRoughPlasticTransmittanceSteps(
  input: RoughPlasticTransmittanceInput
): Generator<void, RoughPlasticTransmittance, void> {
  const externalTransmittance = new Float32Array(ROUGH_PLASTIC_TRANSMITTANCE_RESOLUTION);
  let internalReflectance = 0;
  for (let i = 0; i < externalTransmittance.length; i += 1) {
    const mu = Math.max(1e-6, i / (externalTransmittance.length - 1));
    externalTransmittance[i] = integrateRoughDielectric(input, mu, false);
    yield;
    internalReflectance += integrateRoughDielectric({ ...input, eta: 1 / input.eta }, mu, true) * mu;
    yield;
  }
  return {
    externalTransmittance,
    internalReflectance: 2 * internalReflectance / externalTransmittance.length
  };
}

/** Hemispherical reflectance or transmittance, including Smith masking. */
export function integrateRoughDielectric(
  input: RoughPlasticTransmittanceInput,
  cosTheta: number,
  reflectance: boolean,
  quadratureOrder = input.eta > 1 ? 32 : 128
): number {
  const alpha = Math.max(input.alpha, 1e-4);
  const eta = input.eta;
  if (!(eta > 0) || !Number.isFinite(eta) || !Number.isFinite(alpha)) {
    throw new Error('Rough dielectric integration requires finite positive IOR and roughness.');
  }
  const mu = Math.max(1e-6, Math.min(1, cosTheta));
  const wi: Vector3 = [Math.sqrt(Math.max(0, 1 - mu * mu)), 0, mu];
  const stretchedCos = mu / Math.hypot(alpha * wi[0], mu);
  const samples = quadratureSamples(quadratureOrder);
  // Beckmann's X slope depends only on the X quadrature node and view angle.
  // Reuse it across all Y nodes instead of repeating the inverse-erf solve
  // 32 or 128 times for each column. Summation order stays unchanged.
  const beckmannSlopes = input.distribution === 'beckmann'
    ? samples.slice(0, quadratureOrder).map(node => beckmannSlopeX(stretchedCos, node.x))
    : null;
  let integral = 0;
  for (let index = 0; index < samples.length; index++) {
    const node = samples[index];
    const m = sampleVisibleNormal(stretchedCos, alpha, input.distribution, node,
      beckmannSlopes?.[index % quadratureOrder] ?? 0);
    const cosIncident = wi[0] * m[0] + wi[2] * m[2];
    const fresnel = dielectricFresnel(cosIncident, eta);
    let wo: Vector3;
    if (reflectance) {
      wo = [2 * cosIncident * m[0] - wi[0], 2 * cosIncident * m[1], 2 * cosIncident * m[2] - wi[2]];
      if (wo[2] <= 0) continue;
    } else {
      const normalScale = cosIncident / eta + fresnel.cosTransmitted;
      wo = [normalScale * m[0] - wi[0] / eta, normalScale * m[1], normalScale * m[2] - wi[2] / eta];
      if (wo[2] >= 0) continue;
    }
    const cosineWithNormal = wo[0] * m[0] + wo[1] * m[1] + wo[2] * m[2];
    const masking = smithG1(wo, cosineWithNormal, alpha, input.distribution);
    integral += masking * (reflectance ? fresnel.reflectance : 1 - fresnel.reflectance) * node.weight;
  }
  return integral;
}

export function interpolateRoughPlasticTransmittance(table: Float32Array, cosine: number): number {
  const position = Math.max(0, Math.min(1, cosine)) * (table.length - 1);
  const index = Math.min(Math.floor(position), table.length - 2);
  return table[index] + (table[index + 1] - table[index]) * (position - index);
}

function dielectricFresnel(cosIncident: number, eta: number): { reflectance: number; cosTransmitted: number } {
  const cosine = Math.abs(cosIncident);
  const etaDirection = cosIncident >= 0 ? eta : 1 / eta;
  const cosineSquared = 1 - (1 - cosine * cosine) / (etaDirection * etaDirection);
  const ct = Math.sqrt(Math.max(0, cosineSquared));
  let reflectance = 0;
  if (eta !== 1) {
    if (cosine === 0 || cosineSquared <= 0) reflectance = 1;
    else {
      const as = (cosine - etaDirection * ct) / (cosine + etaDirection * ct);
      const ap = (etaDirection * cosine - ct) / (etaDirection * cosine + ct);
      reflectance = (as * as + ap * ap) / 2;
    }
  }
  return { reflectance, cosTransmitted: cosIncident >= 0 ? -ct : ct };
}

function smithG1(v: Vector3, directionDotMicrofacet: number, alpha: number, distribution: EnvironmentMicrofacetDistribution): number {
  if (directionDotMicrofacet * v[2] <= 0) return 0;
  const xyAlphaSquared = alpha * alpha * (v[0] * v[0] + v[1] * v[1]);
  if (xyAlphaSquared === 0) return 1;
  const tanSquared = xyAlphaSquared / (v[2] * v[2]);
  if (distribution === 'ggx') return 2 / (1 + Math.sqrt(1 + tanSquared));
  const a = 1 / Math.sqrt(tanSquared);
  return a >= 1.6 ? 1 : (3.535 * a + 2.181 * a * a) / (1 + 2.276 * a + 2.577 * a * a);
}

function beckmannSlopeX(cosTheta: number, sampleX: number): number {
  const cotTheta = cosTheta / Math.sqrt(Math.max(0, 1 - cosTheta * cosTheta));
  const tanTheta = 1 / cotTheta;
  const maxValue = erf(cotTheta);
  const u = Math.min(1 - 1e-6, Math.max(1e-6, sampleX));
  let x = maxValue - (maxValue + 1) * erf(Math.sqrt(-Math.log(u)));
  const target = u * (1 + maxValue + tanTheta * Math.exp(-cotTheta * cotTheta) / Math.sqrt(Math.PI));
  for (let i = 0; i < 3; i += 1) {
    const slope = inverseErf(x);
    const value = 1 + x + tanTheta * Math.exp(-slope * slope) / Math.sqrt(Math.PI) - target;
    x -= value / (1 - slope * tanTheta);
  }
  return inverseErf(x);
}

function sampleVisibleNormal(cosTheta: number, alpha: number, distribution: EnvironmentMicrofacetDistribution,
  sample: QuadratureSample, beckmannX: number): Vector3 {
  let slopeX: number;
  let slopeY: number;
  if (distribution === 'beckmann') {
    slopeX = beckmannX;
    slopeY = sample.inverseErfY;
  } else {
    const sx = 2 * sample.x - 1;
    const sy = 2 * sample.y - 1;
    const radius = Math.abs(sx) > Math.abs(sy) ? sx : sy;
    const angle = Math.abs(sx) > Math.abs(sy)
      ? (Math.PI / 4) * sy / sx
      : Math.PI / 2 - (Math.PI / 4) * sx / sy;
    const x = radius === 0 ? 0 : radius * Math.cos(angle);
    let y = radius === 0 ? 0 : radius * Math.sin(angle);
    const s = (1 + cosTheta) / 2;
    y = Math.sqrt(Math.max(0, 1 - x * x)) * (1 - s) + y * s;
    const z = Math.sqrt(Math.max(0, 1 - x * x - y * y));
    const sinTheta = Math.sqrt(Math.max(0, 1 - cosTheta * cosTheta));
    const normalization = 1 / (sinTheta * y + cosTheta * z);
    slopeX = (cosTheta * y - sinTheta * z) * normalization;
    slopeY = x * normalization;
  }
  const x = -alpha * slopeX;
  const y = -alpha * slopeY;
  const invLength = 1 / Math.hypot(x, y, 1);
  return [x * invLength, y * invLength, invLength];
}

function quadratureSamples(order: number): readonly QuadratureSample[] {
  const previous = quadratureCache.get(order);
  if (previous) return previous;
  if (!Number.isInteger(order) || order < 2 || order > 256) throw new Error('Invalid quadrature order.');
  const nodes = new Float64Array(order);
  const weights = new Float64Array(order);
  for (let i = 0; i < Math.ceil(order / 2); i += 1) {
    let root = Math.cos(Math.PI * (i + 0.75) / (order + 0.5));
    let derivative = 0;
    for (let iteration = 0; iteration < 20; iteration += 1) {
      let p0 = 1;
      let p1 = root;
      for (let j = 2; j <= order; j += 1) {
        const p = ((2 * j - 1) * root * p1 - (j - 1) * p0) / j;
        p0 = p1;
        p1 = p;
      }
      derivative = order * (root * p1 - p0) / (root * root - 1);
      const delta = p1 / derivative;
      root -= delta;
      if (Math.abs(delta) < 1e-15) break;
    }
    nodes[i] = (1 - root) / 2;
    nodes[order - i - 1] = (1 + root) / 2;
    // Include the [-1,1] to [0,1] Jacobian in each 1D weight.
    weights[i] = weights[order - i - 1] = 1 / ((1 - root * root) * derivative * derivative);
  }
  const result: QuadratureSample[] = [];
  for (let y = 0; y < order; y += 1) {
    const inverseErfY = inverseErf(2 * Math.min(1 - 1e-6, Math.max(1e-6, nodes[y])) - 1);
    for (let x = 0; x < order; x += 1) {
      result.push({ x: nodes[x], y: nodes[y], weight: weights[x] * weights[y], inverseErfY });
    }
  }
  quadratureCache.set(order, result);
  return result;
}

// Abramowitz-Stegun erf approximation; error < 1.5e-7, below single-precision
// quadrature uncertainty. The inverse receives two Newton refinements.
function erf(value: number): number {
  if (!Number.isFinite(value)) return Math.sign(value);
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value);
  const t = 1 / (1 + 0.3275911 * x);
  const polynomial = (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t;
  return sign * (1 - polynomial * Math.exp(-x * x));
}

function inverseErf(value: number): number {
  const x = Math.min(1 - 1e-12, Math.max(-1 + 1e-12, value));
  // Mike Giles' inverse-erf polynomial, followed by Newton correction.
  let w = -Math.log((1 - x) * (1 + x));
  let p: number;
  if (w < 5) {
    w -= 2.5;
    p = 2.81022636e-8;
    p = 3.43273939e-7 + p * w;
    p = -3.5233877e-6 + p * w;
    p = -4.39150654e-6 + p * w;
    p = 2.1858087e-4 + p * w;
    p = -1.25372503e-3 + p * w;
    p = -4.17768164e-3 + p * w;
    p = 0.246640727 + p * w;
    p = 1.50140941 + p * w;
  } else {
    w = Math.sqrt(w) - 3;
    p = -2.00214257e-4;
    p = 1.00950558e-4 + p * w;
    p = 1.34934322e-3 + p * w;
    p = -3.67342844e-3 + p * w;
    p = 5.73950773e-3 + p * w;
    p = -7.6224613e-3 + p * w;
    p = 9.43887047e-3 + p * w;
    p = 1.00167406 + p * w;
    p = 2.83297682 + p * w;
  }
  let result = p * x;
  for (let i = 0; i < 2; i += 1) {
    result -= (erf(result) - x) / (2 / Math.sqrt(Math.PI) * Math.exp(-result * result));
  }
  return result;
}
