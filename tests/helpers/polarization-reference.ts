/** Independent, double-precision references for the GPU's Mitsuba conventions.
 * Sources: mitsuba3/include/mitsuba/{render/mueller.h,render/fresnel.h,core/vector.h}
 * and mitsuba3/src/{bsdfs/roughconductor.cpp,bsdfs/pplastic.cpp,integrators/stokes.cpp}.
 * Audited revision: f2f30d101bbd5ee07b6e54643c7fef6949924b8f.
 * Matrices here are ROW major (unlike GLSL constructors).
 */
export type Vector3 = readonly [number, number, number];
export type Stokes = readonly [number, number, number, number];
export type Matrix4 = readonly [Stokes, Stokes, Stokes, Stokes];
type Complex = readonly [number, number];

export function normalize(v: Vector3): Vector3 {
  const length = Math.hypot(...v);
  return [v[0] / length, v[1] / length, v[2] / length];
}
export function cross(a: Vector3, b: Vector3): Vector3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
export function dot(a: Vector3, b: Vector3): number { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
export function negate(v: Vector3): Vector3 { return [-v[0], -v[1], -v[2]]; }
export function stokesBasis(n: Vector3): Vector3 {
  const sign = n[2] < 0 ? -1 : 1;
  const a = -1 / (sign + n[2]);
  return [1 + sign * n[0] * n[0] * a, sign * n[0] * n[1] * a, -sign * n[0]];
}
export function basisRotation(forward: Vector3, from: Vector3, to: Vector3): Matrix4 {
  const a = normalize(from), b = normalize(to);
  const theta = Math.atan2(dot(forward, cross(a, b)), dot(a, b));
  const c = Math.cos(2 * theta), s = Math.sin(2 * theta);
  return [[1, 0, 0, 0], [0, c, s, 0], [0, -s, c, 0], [0, 0, 0, 1]];
}
export function apply(matrix: Matrix4, value: Stokes): Stokes {
  return matrix.map(row => row.reduce((sum, entry, i) => sum + entry * value[i], 0)) as unknown as Stokes;
}
export function multiply(a: Matrix4, b: Matrix4): Matrix4 {
  return a.map(row => [0, 1, 2, 3].map(column => row.reduce((sum, entry, i) => sum + entry * b[i][column], 0))) as unknown as Matrix4;
}
export function transpose(matrix: Matrix4): Matrix4 {
  return [0, 1, 2, 3].map(i => matrix.map(row => row[i])) as unknown as Matrix4;
}
export function scaleMatrix(matrix: Matrix4, value: number): Matrix4 {
  return matrix.map(row => row.map(entry => entry * value)) as unknown as Matrix4;
}
export function addMatrix(a: Matrix4, b: Matrix4): Matrix4 {
  return a.map((row, i) => row.map((entry, j) => entry + b[i][j])) as unknown as Matrix4;
}

function multiplyComplex(a: Complex, b: Complex): Complex {
  return [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
}
function divideComplex(a: Complex, b: Complex): Complex {
  const norm = b[0] * b[0] + b[1] * b[1];
  return [(a[0] * b[0] + a[1] * b[1]) / norm, (a[1] * b[0] - a[0] * b[1]) / norm];
}
function sqrtComplex(a: Complex): Complex {
  const radius = Math.sqrt(Math.hypot(...a));
  const halfAngle = Math.atan2(a[1], a[0]) / 2;
  return [radius * Math.cos(halfAngle), radius * Math.sin(halfAngle)];
}

/** Verdet amplitudes, including Mitsuba's conversion from positive extinction k. */
export function fresnelAmplitudes(cosine: number, eta: number, k: number): { s: Complex; p: Complex } {
  if (eta === 1 && k === 0) return { s: [0, 0], p: [0, 0] };
  let index: Complex = [eta, -Math.abs(k)];
  if (cosine < 0) index = divideComplex([1, 0], index);
  const sinSquaredOverIndexSquared = divideComplex([1 - cosine * cosine, 0], multiplyComplex(index, index));
  let transmitted = sqrtComplex([1 - sinSquaredOverIndexSquared[0], -sinSquaredOverIndexSquared[1]]);
  if (transmitted[1] > 0) transmitted = [transmitted[0], -transmitted[1]];
  const c = Math.abs(cosine);
  const etaCosT = multiplyComplex(index, transmitted);
  const etaCosI: Complex = [index[0] * c, index[1] * c];
  return {
    s: divideComplex([c - etaCosT[0], -etaCosT[1]], [c + etaCosT[0], etaCosT[1]]),
    p: divideComplex([etaCosI[0] - transmitted[0], etaCosI[1] - transmitted[1]],
      [etaCosI[0] + transmitted[0], etaCosI[1] + transmitted[1]])
  };
}

export function reflectionMueller(cosine: number, eta: number, k: number): Matrix4 {
  const { s, p } = fresnelAmplitudes(cosine, eta, k);
  const rs = s[0] * s[0] + s[1] * s[1], rp = p[0] * p[0] + p[1] * p[1];
  const a = (rs + rp) / 2, b = (rs - rp) / 2;
  // Use the phase-difference form in mueller.h, independently of the shader's
  // real/imaginary cross-product shortcut.
  const phase = Math.atan2(p[1], p[0]) - Math.atan2(s[1], s[0]);
  const amplitude = Math.sqrt(rs * rp);
  const c = amplitude * Math.cos(phase), d = amplitude * Math.sin(phase);
  return [[a, b, 0, 0], [b, a, 0, 0], [0, 0, c, -d], [0, 0, d, c]];
}

export function worldReflectionMueller(normal: Vector3, view: Vector3, light: Vector3, eta: number, k: number): Matrix4 {
  const incident = negate(light);
  let inputS = cross(normal, incident), outputS = cross(normal, view);
  if (Math.hypot(...inputS) < 1e-12) {
    inputS = outputS = stokesBasis(view);
  }
  const inputRotation = basisRotation(incident, inputS, stokesBasis(incident));
  const outputRotation = basisRotation(view, outputS, stokesBasis(view));
  return multiply(multiply(outputRotation, reflectionMueller(dot(light, normal), eta, k)), transpose(inputRotation));
}

/** Lossless dielectric transmission derived from transmitted s/p POWER, rather
 * than mueller.h's transmitted-amplitude/unit-conversion-factor formulation. */
export function transmissionMueller(cosine: number, eta: number): Matrix4 {
  if (Math.abs(cosine) <= 1e-8) return scaleMatrix(reflectionMueller(1, 1.5, 0), 0);
  const { s, p } = fresnelAmplitudes(cosine, eta, 0);
  const ts = Math.max(0, 1 - s[0] * s[0] - s[1] * s[1]);
  const tp = Math.max(0, 1 - p[0] * p[0] - p[1] * p[1]);
  const a = (ts + tp) / 2, b = (ts - tp) / 2, c = Math.sqrt(ts * tp);
  return [[a, b, 0, 0], [b, a, 0, 0], [0, 0, c, 0], [0, 0, 0, c]];
}

/** pplastic.cpp's Ti * depolarizer(1) * To in world implicit Stokes frames.
 * The caller applies albedo/pi; this intentionally has no eta^-2 factor or
 * roughplastic internal-reflection compensation. */
export function pplasticDiffuseMueller(normal: Vector3, view: Vector3, light: Vector3, eta: number): Matrix4 {
  const nv = dot(normal, view), nl = dot(normal, light);
  const cosInside = Math.sqrt(Math.max(0, 1 - (1 - nv * nv) / (eta * eta)));
  const incoming = transmissionMueller(Math.abs(nl), eta);
  const outgoing = transmissionMueller(cosInside, 1 / eta);
  const depolarizer: Matrix4 = [[1, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
  let inputS = cross(normal, negate(light)), outputS = cross(normal, view);
  if (Math.hypot(...inputS) < 1e-12) inputS = stokesBasis(normal);
  if (Math.hypot(...outputS) < 1e-12) outputS = stokesBasis(normal);
  const rotateIn = basisRotation(negate(light), inputS, stokesBasis(negate(light)));
  const rotateOut = basisRotation(view, outputS, stokesBasis(view));
  return multiply(multiply(rotateOut, multiply(multiply(outgoing, depolarizer), incoming)), transpose(rotateIn));
}

type MicrofacetDistribution = 'beckmann' | 'ggx';
function microfacetD(normal: Vector3, half: Vector3, alpha: number, distribution: MicrofacetDistribution): number {
  const cosine = dot(normal, half);
  if (cosine <= 0) return 0;
  const cosine2 = cosine * cosine;
  const tangent2 = (1 - cosine2) / cosine2;
  const d = distribution === 'beckmann'
    ? Math.exp(-tangent2 / (alpha * alpha)) / (Math.PI * alpha * alpha * cosine2 * cosine2)
    : alpha * alpha / (Math.PI * cosine2 * cosine2 * (alpha * alpha + tangent2) ** 2);
  return d * cosine > 1e-20 ? d : 0;
}
function microfacetG1(normal: Vector3, half: Vector3, v: Vector3, alpha: number, distribution: MicrofacetDistribution): number {
  const cosine = dot(normal, v);
  if (dot(half, v) * cosine <= 0) return 0;
  const tangentAlpha2 = alpha * alpha * Math.max(0, 1 - cosine * cosine) / (cosine * cosine);
  if (tangentAlpha2 === 0) return 1;
  if (distribution === 'ggx') return 2 / (1 + Math.sqrt(1 + tangentAlpha2));
  const a = 1 / Math.sqrt(tangentAlpha2);
  return a >= 1.6 ? 1 : (3.535 * a + 2.181 * a * a) / (1 + 2.276 * a + 2.577 * a * a);
}

export interface PplasticReferenceInput {
  normal: Vector3;
  view: Vector3;
  light: Vector3;
  eta: number;
  alpha: number;
  albedo: number;
  distribution: MicrofacetDistribution;
}

/** One color channel of the BRDF (without the outgoing cosine in Mitsuba eval). */
export function pplasticBsdf(input: PplasticReferenceInput): Matrix4 {
  const { normal, view, light, eta, alpha, albedo, distribution } = input;
  const nv = dot(normal, view), nl = dot(normal, light);
  if (nv <= 0 || nl <= 0) return scaleMatrix(reflectionMueller(1, eta, 0), 0);
  const half = normalize([view[0] + light[0], view[1] + light[1], view[2] + light[2]]);
  const factor = microfacetD(normal, half, alpha, distribution) *
    microfacetG1(normal, half, view, alpha, distribution) * microfacetG1(normal, half, light, alpha, distribution) / (4 * nv * nl);
  const specular = scaleMatrix(worldReflectionMueller(half, view, light, eta, 0), factor);
  const diffuse = scaleMatrix(pplasticDiffuseMueller(normal, view, light, eta), albedo / Math.PI);
  return addMatrix(specular, diffuse);
}

/** Mixture PDF follows spp/(spp+mean(albedo)), without Fresnel steering. */
export function pplasticPdf(input: PplasticReferenceInput, meanAlbedo = input.albedo): number {
  const { normal, view, light, alpha, distribution } = input;
  const nv = dot(normal, view), nl = dot(normal, light);
  if (nv <= 0 || nl <= 0) return 0;
  const half = normalize([view[0] + light[0], view[1] + light[1], view[2] + light[2]]);
  const specularPdf = microfacetD(normal, half, alpha, distribution) * microfacetG1(normal, half, view, alpha, distribution) / (4 * nv);
  const specularProbability = 1 / (1 + meanAlbedo);
  return specularProbability * specularPdf + (1 - specularProbability) * nl / Math.PI;
}

// Proper 180-degree Z rotation preserves the viewer's existing panorama mapping
// (front +Z sees u=.5, image rows grow toward viewer +Y).
export function viewerToPenvmap(direction: Vector3): Vector3 { return [-direction[0], -direction[1], direction[2]]; }
export function penvmapDirectionToUv(d: Vector3): readonly [number, number] {
  const u = Math.atan2(d[0], -d[2]) / (2 * Math.PI);
  return [u - Math.floor(u), Math.acos(Math.min(1, Math.max(-1, d[1]))) / Math.PI];
}
export function environmentBasisRotation(viewerDirection: Vector3): Matrix4 {
  const localForward = negate(viewerToPenvmap(viewerDirection));
  const worldForward = negate(viewerDirection);
  const transportedBasis = viewerToPenvmap(stokesBasis(localForward));
  return basisRotation(worldForward, transportedBasis, stokesBasis(worldForward));
}
export function sensorBasisRotation(ray: Vector3, vertical: Vector3): Matrix4 {
  return basisRotation(negate(ray), stokesBasis(negate(ray)), cross(ray, vertical));
}

/** Jones coherency transform used to verify Mueller reflection on arbitrary,
 * including partially polarized, states without multiplying a Mueller matrix. */
export function reflectCoherency(stokes: Stokes, cosine: number, eta: number, k: number): Stokes {
  const { s, p } = fresnelAmplitudes(cosine, eta, k);
  const c00 = (stokes[0] + stokes[1]) / 2;
  const c11 = (stokes[0] - stokes[1]) / 2;
  const crossAmplitude = multiplyComplex(s, [p[0], -p[1]]);
  const c01 = multiplyComplex(crossAmplitude, [stokes[2] / 2, -stokes[3] / 2]);
  const out00 = (s[0] * s[0] + s[1] * s[1]) * c00;
  const out11 = (p[0] * p[0] + p[1] * p[1]) * c11;
  return [out00 + out11, out00 - out11, 2 * c01[0], -2 * c01[1]];
}
