// Mitsuba 3 ports: render/mueller.h, render/fresnel.h, render/microfacet.h,
// bsdfs/{conductor,roughconductor,pplastic,roughplastic}.cpp and integrators/stokes.cpp.
// Source: https://github.com/mitsuba-renderer/mitsuba3 (BSD-3-Clause).
// Verified revision: f2f30d101bbd5ee07b6e54643c7fef6949924b8f.
// Stokes vectors follow the physical propagation direction, opposite to the
// traced camera ray. Matrices below use GLSL's COLUMN-major constructors.
uniform bool uEnvironmentPolarized;
uniform sampler2D uEnvironmentStokesS1Texture;
uniform sampler2D uEnvironmentStokesS2Texture;
uniform sampler2D uEnvironmentStokesS3Texture;
uniform sampler2D uRoughPlasticTransmittanceTexture;

struct PolarizedStokes { vec3 s0; vec3 s1; vec3 s2; vec3 s3; };
struct RgbMueller { mat4 r; mat4 g; mat4 b; };

PolarizedStokes zeroStokes() {
  return PolarizedStokes(vec3(0.0), vec3(0.0), vec3(0.0), vec3(0.0));
}

PolarizedStokes addStokes(PolarizedStokes a, PolarizedStokes b) {
  return PolarizedStokes(a.s0 + b.s0, a.s1 + b.s1, a.s2 + b.s2, a.s3 + b.s3);
}

PolarizedStokes scaleStokes(PolarizedStokes a, float factor) {
  return PolarizedStokes(a.s0 * factor, a.s1 * factor, a.s2 * factor, a.s3 * factor);
}

RgbMueller identityMueller() { return RgbMueller(mat4(1.0), mat4(1.0), mat4(1.0)); }

RgbMueller multiplyMueller(RgbMueller a, RgbMueller b) {
  return RgbMueller(a.r * b.r, a.g * b.g, a.b * b.b);
}

RgbMueller scaleMueller(RgbMueller a, float value) {
  return RgbMueller(a.r * value, a.g * value, a.b * value);
}

RgbMueller depolarizingMueller(vec3 value) {
  mat4 r = mat4(0.0), g = mat4(0.0), b = mat4(0.0);
  r[0][0] = value.r; g[0][0] = value.g; b[0][0] = value.b;
  return RgbMueller(r, g, b);
}

vec3 unpolarizedMueller(RgbMueller value) {
  return vec3(value.r[0][0], value.g[0][0], value.b[0][0]);
}

PolarizedStokes applyMueller(RgbMueller matrix, PolarizedStokes value) {
  vec4 r = matrix.r * vec4(value.s0.r, value.s1.r, value.s2.r, value.s3.r);
  vec4 g = matrix.g * vec4(value.s0.g, value.s1.g, value.s2.g, value.s3.g);
  vec4 b = matrix.b * vec4(value.s0.b, value.s1.b, value.s2.b, value.s3.b);
  return PolarizedStokes(vec3(r.x, g.x, b.x), vec3(r.y, g.y, b.y),
                         vec3(r.z, g.z, b.z), vec3(r.w, g.w, b.w));
}

// core/vector.h::coordinate_system (Duff et al.), including the z=0 branch.
vec3 mitsubaStokesBasis(vec3 forward) {
  float signZ = forward.z < 0.0 ? -1.0 : 1.0;
  float a = -1.0 / (signZ + forward.z);
  float b = forward.x * forward.y * a;
  return vec3(1.0 + signZ * forward.x * forward.x * a,
              signZ * b, -signZ * forward.x);
}

mat4 rotateStokesBasis(vec3 forward, vec3 current, vec3 target) {
  current = normalize(current);
  target = normalize(target);
  float cosine = clamp(dot(current, target), -1.0, 1.0);
  float sine = dot(forward, cross(current, target));
  // Algebraically identical to mueller::rotator(signed unit_angle(..));
  // avoids loss of precision at the identity rotation and a costly acos.
  float c = cosine * cosine - sine * sine;
  float s = 2.0 * sine * cosine;
  return mat4(1, 0, 0, 0, 0, c, -s, 0, 0, s, c, 0, 0, 0, 0, 1);
}

PolarizedStokes rotateStokes(PolarizedStokes value, mat4 rotation) {
  return applyMueller(RgbMueller(rotation, rotation, rotation), value);
}

// The emitter's to_world is a 180-degree Z rotation. This proper rotation
// preserves the viewer's existing equirectangular pixel directions:
// atan2(local.x,-local.z)/(2pi) = fract(.5+atan2(world.x,world.z)/(2pi)),
// acos(local.y)/pi = .5+asin(world.y)/pi. A y reflection alone would incorrectly
// reverse circular handedness. Apply this rotation to the Stokes basis too.
vec3 penvmapToViewer(vec3 direction) { return direction * vec3(-1.0, -1.0, 1.0); }
vec3 viewerToPenvmap(vec3 direction) { return penvmapToViewer(direction); }

vec2 penvmapDirectionToUv(vec3 localDirection) {
  return vec2(fract(atan(localDirection.x, -localDirection.z) / (2.0 * PI)),
              acos(clamp(localDirection.y, -1.0, 1.0)) / PI);
}

vec3 penvmapUvToDirection(vec2 uv) {
  float theta = uv.y * PI, phi = uv.x * 2.0 * PI;
  return vec3(sin(theta) * sin(phi), cos(theta), -sin(theta) * cos(phi));
}

// penvmap.cpp::eval_stokes_component: periodic half-texel azimuth and
// endpoint latitude samples. Explicit fetches also work without float filtering.
vec3 samplePenvmapComponent(sampler2D image, vec2 uv) {
  ivec2 size = textureSize(image, 0);
  vec2 pixel = vec2(fract(uv.x - 0.5 / float(size.x)) * float(size.x),
                    clamp(uv.y, 0.0, 1.0) * float(size.y - 1));
  ivec2 p = min(ivec2(floor(pixel)), size - ivec2(1, 2));
  vec2 weight = pixel - vec2(p);
  int nextX = (p.x + 1) % size.x;
  return mix(mix(texelFetch(image, p, 0).rgb,
                 texelFetch(image, ivec2(nextX, p.y), 0).rgb, weight.x),
             mix(texelFetch(image, p + ivec2(0, 1), 0).rgb,
                 texelFetch(image, ivec2(nextX, p.y + 1), 0).rgb, weight.x), weight.y);
}

PolarizedStokes samplePolarizedEnvironment(vec3 direction) {
  if (!uEnvironmentPolarized) {
    return PolarizedStokes(max(sampleEnvironmentRadiance(direction, 0.0), vec3(0.0)),
                           vec3(0.0), vec3(0.0), vec3(0.0));
  }
  vec3 localDirection = viewerToPenvmap(normalize(direction));
  vec2 uv = penvmapDirectionToUv(localDirection);
  PolarizedStokes value = PolarizedStokes(
    samplePenvmapComponent(uEnvironmentRadianceTexture, uv),
    samplePenvmapComponent(uEnvironmentStokesS1Texture, uv),
    samplePenvmapComponent(uEnvironmentStokesS2Texture, uv),
    samplePenvmapComponent(uEnvironmentStokesS3Texture, uv));
  vec3 forward = -normalize(direction);
  return rotateStokes(value, rotateStokesBasis(forward,
    penvmapToViewer(mitsubaStokesBasis(-localDirection)), mitsubaStokesBasis(forward)));
}

PolarizedStokes stokesToSensor(PolarizedStokes value, vec3 initialRayDirection) {
  vec3 forward, right, down;
  resolveEnvironmentOrbitBasis(forward, right, down);
  vec3 target = cross(initialRayDirection, -down);
  if (dot(target, target) < 1.0e-12) target = right;
  return rotateStokes(value, rotateStokesBasis(-initialRayDirection,
    mitsubaStokesBasis(-initialRayDirection), target));
}

vec2 complexMultiply(vec2 a, vec2 b) {
  return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x);
}

vec2 complexDivide(vec2 a, vec2 b) {
  return vec2(dot(a, b), a.y * b.x - a.x * b.y) / max(dot(b, b), 1.0e-30);
}

vec2 complexSqrt(vec2 value) {
  float magnitude = length(value);
  if (magnitude == 0.0) return vec2(0.0);
  // Recover the small component from 2*real*imag=value.y. Subtracting
  // magnitude-real loses the conductor's small but essential phase delay.
  if (value.x >= 0.0) {
    float realPart = sqrt(0.5 * (magnitude + value.x));
    return vec2(realPart, value.y / (2.0 * realPart));
  }
  float imaginaryPart = sqrt(0.5 * (magnitude - value.x));
  return vec2(abs(value.y) / (2.0 * imaginaryPart), value.y < 0.0 ? -imaginaryPart : imaginaryPart);
}

mat4 mitsubaSpecularReflection(float cosThetaI, vec2 eta) {
  eta.y = -abs(eta.y); // fresnel_polarized uses negative kappa.
  if (dot(eta, eta) == 0.0 || (eta.x == 1.0 && eta.y == 0.0)) return mat4(0.0);
  vec2 etaIt = cosThetaI >= 0.0 ? eta : complexDivide(vec2(1, 0), eta);
  vec2 etaTi = complexDivide(vec2(1, 0), etaIt);
  float cosine = clamp(abs(cosThetaI), 0.0, 1.0);
  vec2 cosThetaT = complexSqrt(vec2(1, 0) - complexMultiply(etaTi, etaTi) *
                              (1.0 - cosine * cosine));
  cosThetaT.y = -abs(cosThetaT.y);
  vec2 etaCosThetaT = complexMultiply(etaIt, cosThetaT);
  vec2 aS = complexDivide(vec2(cosine, 0) - etaCosThetaT,
                          vec2(cosine, 0) + etaCosThetaT);
  vec2 aP = complexDivide(etaIt * cosine - cosThetaT, etaIt * cosine + cosThetaT);
  float rs = dot(aS, aS), rp = dot(aP, aP);
  float a = 0.5 * (rs + rp), b = 0.5 * (rs - rp);
  // c*cos(delta), c*sin(delta) directly; finite also at Brewster's angle.
  vec2 phase = complexMultiply(aP, vec2(aS.x, -aS.y));
  return mat4(a, b, 0, 0, b, a, 0, 0,
              0, 0, phase.x, phase.y, 0, 0, -phase.y, phase.x);
}

// render/fresnel.h::fresnel, including the transmitted direction's sign.
float mitsubaDielectricFresnel(float cosThetaI, float eta, out float cosThetaT) {
  float cosine = clamp(abs(cosThetaI), 0.0, 1.0);
  float etaIt = cosThetaI >= 0.0 ? eta : 1.0 / eta;
  float cosTransmitted = sqrt(max(0.0, 1.0 - (1.0 - cosine * cosine) / (etaIt * etaIt)));
  cosThetaT = cosThetaI >= 0.0 ? -cosTransmitted : cosTransmitted;
  if (eta == 1.0) return 0.0;
  if (cosine == 0.0) return 1.0;
  float aS = (cosine - etaIt * cosTransmitted) / (cosine + etaIt * cosTransmitted);
  float aP = (etaIt * cosine - cosTransmitted) / (etaIt * cosine + cosTransmitted);
  return 0.5 * (aS * aS + aP * aP);
}

// mueller.h::specular_transmission. At and beyond the critical angle its
// flux factor vanishes; real Fresnel amplitudes suffice on the remaining branch.
mat4 mitsubaSpecularTransmission(float cosThetaI, float eta) {
  float cosine = clamp(abs(cosThetaI), 0.0, 1.0);
  if (eta <= 0.0 || cosine <= 1.0e-8) return mat4(0.0);
  float etaIt = cosThetaI >= 0.0 ? eta : 1.0 / eta;
  float etaTi = 1.0 / etaIt;
  float cosThetaT2 = 1.0 - (1.0 - cosine * cosine) * etaTi * etaTi;
  if (cosThetaT2 <= 0.0) return mat4(0.0);
  float cosThetaT = sqrt(cosThetaT2);
  float aS = eta == 1.0 ? 0.0 :
    (cosine - etaIt * cosThetaT) / (cosine + etaIt * cosThetaT);
  float aP = eta == 1.0 ? 0.0 :
    (etaIt * cosine - cosThetaT) / (etaIt * cosine + cosThetaT);
  float factor = etaIt * cosThetaT / cosine;
  float amplitudeS = 1.0 + aS, amplitudeP = (1.0 + aP) * etaTi;
  float tS = amplitudeS * amplitudeS, tP = amplitudeP * amplitudeP;
  float a = 0.5 * factor * (tS + tP);
  float b = 0.5 * factor * (tS - tP);
  float c = factor * sqrt(tS * tP);
  return mat4(a, b, 0, 0, b, a, 0, 0, 0, 0, c, 0, 0, 0, 0, c);
}

// Apply the equivalent of local BSDF basis rotations followed by
// si.to_world_mueller, directly using the world-space scattering planes.
mat4 surfaceMuellerToWorld(mat4 value, vec3 basisNormal, vec3 viewDirection, vec3 lightDirection) {
  vec3 inForward = -lightDirection, outForward = viewDirection;
  vec3 inAxis = cross(basisNormal, inForward), outAxis = cross(basisNormal, outForward);
  // pplastic's diffuse entrance and exit planes can be singular independently.
  if (dot(inAxis, inAxis) < 1.0e-16) inAxis = mitsubaStokesBasis(basisNormal);
  if (dot(outAxis, outAxis) < 1.0e-16) outAxis = mitsubaStokesBasis(basisNormal);
  mat4 rotateIn = transpose(rotateStokesBasis(inForward, inAxis, mitsubaStokesBasis(inForward)));
  mat4 rotateOut = rotateStokesBasis(outForward, outAxis, mitsubaStokesBasis(outForward));
  return rotateOut * value * rotateIn;
}

mat4 dielectricReflectionMueller(vec3 microfacet, vec3 viewDirection, vec3 lightDirection, float eta) {
  return surfaceMuellerToWorld(mitsubaSpecularReflection(dot(lightDirection, microfacet), vec2(eta, 0.0)),
                               microfacet, viewDirection, lightDirection);
}

// pplastic.cpp's diffuse path: entrance transmission, depolarizing subsurface
// scattering, then exit transmission. Unit albedo here; the caller applies RGB/pi.
mat4 pplasticDiffuseMueller(vec3 normal, vec3 viewDirection, vec3 lightDirection, float eta) {
  mat4 transmissionIn = mitsubaSpecularTransmission(abs(dot(normal, lightDirection)), eta);
  float cosThetaTransmitted;
  mitsubaDielectricFresnel(dot(normal, viewDirection), eta, cosThetaTransmitted);
  // In local coordinates -refract(wi_hat, cos_theta_t_i, 1/eta).z is -cos_theta_t_i.
  mat4 transmissionOut = mitsubaSpecularTransmission(abs(cosThetaTransmitted), 1.0 / eta);
  mat4 diffuse = mat4(0.0);
  diffuse[0][0] = 1.0;
  return surfaceMuellerToWorld(transmissionOut * diffuse * transmissionIn,
                               normal, viewDirection, lightDirection);
}

// RGB optical constants are supplied from Mitsuba's Ag spectral data.
uniform vec3 uConductorEta;
uniform vec3 uConductorK;

RgbMueller silverReflectionMueller(vec3 normal, vec3 viewDirection, vec3 lightDirection) {
  vec3 inForward = -lightDirection, outForward = viewDirection;
  vec3 inAxis = cross(normal, inForward), outAxis = cross(normal, outForward);
  if (dot(inAxis, inAxis) < 1.0e-16) {
    inAxis = mitsubaStokesBasis(normal);
    outAxis = inAxis;
  }
  mat4 rotateIn = transpose(rotateStokesBasis(inForward, inAxis, mitsubaStokesBasis(inForward)));
  mat4 rotateOut = rotateStokesBasis(outForward, outAxis, mitsubaStokesBasis(outForward));
  float cosine = dot(lightDirection, normal);
  return RgbMueller(
    rotateOut * mitsubaSpecularReflection(cosine, vec2(uConductorEta.r, uConductorK.r)) * rotateIn,
    rotateOut * mitsubaSpecularReflection(cosine, vec2(uConductorEta.g, uConductorK.g)) * rotateIn,
    rotateOut * mitsubaSpecularReflection(cosine, vec2(uConductorEta.b, uConductorK.b)) * rotateIn);
}

float mitsubaMicrofacetDistribution(vec3 normal, vec3 microfacet, float alpha) {
  float cosine = dot(normal, microfacet);
  if (cosine <= 0.0) return 0.0;
  float cos2 = cosine * cosine;
  // Use the projected normal rather than 1-cos^2: the latter rounds to zero
  // for narrow lobes in float precision, unlike Mitsuba's local x/y formula.
  vec3 projected = cross(normal, microfacet);
  float sin2 = dot(projected, projected);
  float a2 = alpha * alpha;
  float distribution;
  if (uEnvironmentSphereDistribution == MICROFACET_DISTRIBUTION_GGX) {
    float denominator = sin2 / a2 + cos2;
    distribution = 1.0 / (PI * a2 * denominator * denominator);
  } else {
    distribution = exp(-sin2 / (a2 * cos2)) / (PI * a2 * cos2 * cos2);
  }
  return distribution * cosine > 1.0e-20 ? distribution : 0.0;
}

float mitsubaSmithG1(vec3 direction, vec3 microfacet, vec3 normal, float alpha) {
  float cosine = dot(direction, normal);
  if (dot(direction, microfacet) * cosine <= 0.0) return 0.0;
  vec3 projected = cross(normal, direction);
  float xyAlpha2 = alpha * alpha * dot(projected, projected);
  if (xyAlpha2 == 0.0) return 1.0;
  float tanAlpha2 = xyAlpha2 / (cosine * cosine);
  if (uEnvironmentSphereDistribution == MICROFACET_DISTRIBUTION_GGX) {
    return 2.0 / (1.0 + sqrt(1.0 + tanAlpha2));
  }
  float a = inversesqrt(tanAlpha2), a2 = a * a;
  return a >= 1.6 ? 1.0 : (3.535 * a + 2.181 * a2) / (1.0 + 2.276 * a + 2.577 * a2);
}

// GLSL ES has no erf/erfinv. Float-accurate polynomial approximations supply
// the same functions used by Mitsuba's three-iteration Beckmann inversion.
float mitsubaErf(float x) {
  float t = 1.0 / (1.0 + 0.3275911 * abs(x));
  float result = 1.0 - (((((1.061405429 * t - 1.453152027) * t) +
                 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * exp(-x * x);
  return x < 0.0 ? -result : result;
}

float mitsubaErfInv(float x) {
  x = clamp(x, -0.99999994, 0.99999994);
  float w = -log((1.0 - x) * (1.0 + x));
  float p;
  if (w < 5.0) {
    w -= 2.5;
    p = 2.81022636e-08;
    p = 3.43273939e-07 + p * w; p = -3.5233877e-06 + p * w;
    p = -4.39150654e-06 + p * w; p = 0.00021858087 + p * w;
    p = -0.00125372503 + p * w; p = -0.00417768164 + p * w;
    p = 0.246640727 + p * w; p = 1.50140941 + p * w;
  } else {
    w = sqrt(w) - 3.0;
    p = -0.000200214257;
    p = 0.000100950558 + p * w; p = 0.00134934322 + p * w;
    p = -0.00367342844 + p * w; p = 0.00573950773 + p * w;
    p = -0.0076224613 + p * w; p = 0.00943887047 + p * w;
    p = 1.00167406 + p * w; p = 2.83297682 + p * w;
  }
  return p * x;
}

vec2 mitsubaConcentricDisk(vec2 sampleValue) {
  vec2 p = 2.0 * sampleValue - 1.0;
  if (p.x == 0.0 && p.y == 0.0) return vec2(0.0);
  float radius, phi;
  if (abs(p.x) > abs(p.y)) { radius = p.x; phi = (PI * 0.25) * p.y / p.x; }
  else { radius = p.y; phi = PI * 0.5 - (PI * 0.25) * p.x / p.y; }
  return radius * vec2(cos(phi), sin(phi));
}

vec2 mitsubaVisibleSlope(float cosine, vec2 sampleValue) {
  if (uEnvironmentSphereDistribution == MICROFACET_DISTRIBUTION_GGX) {
    vec2 p = mitsubaConcentricDisk(sampleValue);
    p.y = mix(sqrt(max(0.0, 1.0 - p.x * p.x)), p.y, 0.5 * (1.0 + cosine));
    float z = sqrt(max(0.0, 1.0 - dot(p, p)));
    float sine = sqrt(max(0.0, 1.0 - cosine * cosine));
    return vec2(cosine * p.y - sine * z, p.x) / max(sine * p.y + cosine * z, 1.0e-20);
  }
  sampleValue = clamp(sampleValue, vec2(1.0e-6), vec2(1.0 - 1.0e-6));
  float sine = sqrt(max(0.0, 1.0 - cosine * cosine));
  if (sine < 1.0e-6) return vec2(mitsubaErfInv(2.0 * sampleValue.x - 1.0),
                                 mitsubaErfInv(2.0 * sampleValue.y - 1.0));
  float cotangent = cosine / sine, tangent = sine / max(cosine, 1.0e-20);
  float maximum = mitsubaErf(cotangent);
  float x = maximum - (maximum + 1.0) * mitsubaErf(sqrt(-log(sampleValue.x)));
  float normalizedSample = sampleValue.x *
    (1.0 + maximum + 0.5641895835477563 * tangent * exp(-cotangent * cotangent));
  for (int i = 0; i < 3; ++i) {
    float slope = mitsubaErfInv(x);
    float value = 1.0 + x + 0.5641895835477563 * tangent * exp(-slope * slope) - normalizedSample;
    x -= value / (1.0 - slope * tangent);
  }
  return vec2(mitsubaErfInv(x), mitsubaErfInv(2.0 * sampleValue.y - 1.0));
}

vec3 sampleMitsubaVisibleMicrofacet(vec3 normal, vec3 viewDirection, float alpha, vec2 sampleValue) {
  vec3 tangent = mitsubaStokesBasis(normal), bitangent = cross(normal, tangent);
  vec3 localView = vec3(dot(viewDirection, tangent), dot(viewDirection, bitangent), dot(viewDirection, normal));
  vec3 stretched = normalize(vec3(alpha * localView.xy, localView.z));
  float projectedLength = length(stretched.xy);
  vec2 azimuth = projectedLength > 0.0 ? stretched.xy / projectedLength : vec2(1.0, 0.0);
  vec2 slope = mitsubaVisibleSlope(stretched.z, sampleValue);
  slope = alpha * vec2(azimuth.x * slope.x - azimuth.y * slope.y,
                        azimuth.y * slope.x + azimuth.x * slope.y);
  return normalize(tangent * (-slope.x) + bitangent * (-slope.y) + normal);
}

int roughPlasticLookupRow(float alpha) {
  // Resource rows: current material, floor, six comparison spheres.
  if (abs(alpha - max(uEnvironmentSphereAlpha, 1.0e-4)) < 1.0e-7) return 0;
  for (int i = 0; i < ENVIRONMENT_COMPARISON_SPHERE_COUNT; ++i)
    if (abs(alpha - ENVIRONMENT_COMPARISON_SPHERE_ALPHA[i]) < 1.0e-7) return i + 2;
  return 1;
}

vec2 roughPlasticLookup(float cosine, float alpha) {
  ivec2 size = textureSize(uRoughPlasticTransmittanceTexture, 0);
  int row = roughPlasticLookupRow(alpha);
  float position = clamp(cosine, 0.0, 1.0) * float(size.x - 1);
  int index = min(int(position), size.x - 2);
  return mix(texelFetch(uRoughPlasticTransmittanceTexture, ivec2(index, row), 0).rg,
             texelFetch(uRoughPlasticTransmittanceTexture, ivec2(index + 1, row), 0).rg,
             position - float(index));
}
