// Runtime bounds prevent pathological loop expansion in native shader compilers.
uniform ivec2 uEnvironmentSampleCounts;
uniform vec3 uEnvironmentShIrradiance[36];

vec3 evaluateEnvironmentIrradiance(vec3 normal) {
  float x = normal.x;
  float y = normal.y;
  float z = normal.z;
  float x2 = x * x;
  float y2 = y * y;
  float z2 = z * z;
  float x4 = x2 * x2;
  float y4 = y2 * y2;
  float z4 = z2 * z2;
  float basis[36];
  basis[0] = 0.28209479177387814;
  basis[1] = 0.4886025119029199 * y;
  basis[2] = 0.4886025119029199 * z;
  basis[3] = 0.4886025119029199 * x;
  basis[4] = 1.0925484305920792 * x * y;
  basis[5] = 1.0925484305920792 * y * z;
  basis[6] = 0.31539156525252005 * (3.0 * z2 - 1.0);
  basis[7] = 1.0925484305920792 * x * z;
  basis[8] = 0.5462742152960396 * (x2 - y2);
  basis[9] = 0.5900435899266435 * y * (3.0 * x2 - y2);
  basis[10] = 2.890611442640554 * x * y * z;
  basis[11] = 0.4570457994644658 * y * (5.0 * z2 - 1.0);
  basis[12] = 0.3731763325901154 * z * (5.0 * z2 - 3.0);
  basis[13] = 0.4570457994644658 * x * (5.0 * z2 - 1.0);
  basis[14] = 1.445305721320277 * z * (x2 - y2);
  basis[15] = 0.5900435899266435 * x * (x2 - 3.0 * y2);
  basis[16] = 2.5033429417967046 * x * y * (x2 - y2);
  basis[17] = 1.7701307697799304 * y * z * (3.0 * x2 - y2);
  basis[18] = 0.9461746957575601 * x * y * (7.0 * z2 - 1.0);
  basis[19] = 0.6690465435572892 * y * z * (7.0 * z2 - 3.0);
  basis[20] = 0.10578554691520431 * (35.0 * z2 * z2 - 30.0 * z2 + 3.0);
  basis[21] = 0.6690465435572892 * x * z * (7.0 * z2 - 3.0);
  basis[22] = 0.47308734787878004 * (x2 - y2) * (7.0 * z2 - 1.0);
  basis[23] = 1.7701307697799304 * x * z * (x2 - 3.0 * y2);
  basis[24] = 0.6258357354491761 * (x4 - 6.0 * x2 * y2 + y4);
  basis[25] = 0.6563820568401701 * y * (5.0 * x4 - 10.0 * x2 * y2 + y4);
  basis[26] = 8.302649259524164 * x * y * z * (x2 - y2);
  basis[27] = 0.4892382994352504 * y * (3.0 * x2 - y2) * (9.0 * z2 - 1.0);
  basis[28] = 4.793536784973324 * x * y * z * (3.0 * z2 - 1.0);
  basis[29] = 0.45294665119569694 * y * (21.0 * z4 - 14.0 * z2 + 1.0);
  basis[30] = 0.1169503224534236 * z * (63.0 * z4 - 70.0 * z2 + 15.0);
  basis[31] = 0.45294665119569694 * x * (21.0 * z4 - 14.0 * z2 + 1.0);
  basis[32] = 2.396768392486662 * z * (x2 - y2) * (3.0 * z2 - 1.0);
  basis[33] = 0.4892382994352504 * x * (x2 - 3.0 * y2) * (9.0 * z2 - 1.0);
  basis[34] = 2.075662314881041 * z * (x4 - 6.0 * x2 * y2 + y4);
  basis[35] = 0.6563820568401701 * x * (x4 - 10.0 * x2 * y2 + 5.0 * y4);

  vec3 irradiance = vec3(0.0);
  for (int coefficientIndex = 0; coefficientIndex < 36; coefficientIndex += 1) {
    irradiance += uEnvironmentShIrradiance[coefficientIndex] * basis[coefficientIndex];
  }
  return max(irradiance, vec3(0.0));
}

float roughPlasticRadicalInverse(int index) {
  int bits = index;
  float inverse = 0.0;
  float fraction = 0.5;
  for (int bitIndex = 0; bitIndex < 16; bitIndex += 1) {
    inverse += float(bits - (bits / 2) * 2) * fraction;
    bits /= 2;
    fraction *= 0.5;
  }
  return inverse;
}

vec2 roughPlasticSample2D(int sampleIndex, int sampleCount, float offset) {
  return vec2(
    (float(sampleIndex) + 0.5) / float(sampleCount),
    fract(roughPlasticRadicalInverse(sampleIndex) + offset)
  );
}

float resolveEnvironmentSampleLod(
  vec3 direction,
  float directionPdf,
  float sampleCount,
  float maximumLod
) {
  vec3 ray = normalize(direction);
  float texelSolidAngle;
  float resolvedMaximumLod = maximumLod;
  if (usesCubemapCrossProjection()) {
    if (!usesMipmappedCubemapCrossProjection()) {
      return 0.0;
    }

    float faceSize = max(uImageSize.x * 0.25, 1.0);
    float majorAxis = max(abs(ray.x), max(abs(ray.y), abs(ray.z)));
    texelSolidAngle = 4.0 * majorAxis * majorAxis * majorAxis /
      (faceSize * faceSize);
    resolvedMaximumLod = min(resolvedMaximumLod, log2(faceSize));
  } else {
    float latitudeScale = max(sqrt(max(0.0, 1.0 - ray.y * ray.y)), 1.0e-3);
    texelSolidAngle =
      (2.0 * PI / max(uImageSize.x, 1.0)) *
      (PI / max(uImageSize.y, 1.0)) *
      latitudeScale;
  }
  // A mip texel's nominal solid angle describes its full box footprint, while
  // its reconstruction radius reaches only halfway toward adjacent samples.
  // Four-times the area makes neighboring finite-sample footprints overlap,
  // avoiding isolated copies of very small, very bright HDR features.
  float sampleSolidAngle = ROUGH_PLASTIC_SAMPLE_FILTER_OVERLAP /
    max(sampleCount * directionPdf, 1.0e-8);
  return clamp(
    0.5 * log2(max(sampleSolidAngle / max(texelSolidAngle, 1.0e-8), 1.0)),
    0.0,
    resolvedMaximumLod
  );
}

vec3 evaluateEnvironmentRoughPlastic(
  vec3 normal,
  vec3 viewDirection,
  vec3 materialDiffuseReflectance,
  float materialAlpha,
  bool useSphericalHarmonicsDiffuse
) {
  vec3 cameraForward;
  vec3 cameraRight;
  vec3 cameraDown;
  resolveEnvironmentOrbitBasis(cameraForward, cameraRight, cameraDown);
  vec3 tangent;
  vec3 bitangent;
  buildRoughPlasticFrame(normal, cameraRight, cameraDown, tangent, bitangent);

  float alpha = clamp(materialAlpha, 1.0e-3, 1.0);
  float eta = max(uEnvironmentSphereIntIor, 1.0e-3) /
    max(uEnvironmentSphereExtIor, 1.0e-3);
  float maximumEnvironmentLod = max(log2(max(uImageSize.x, uImageSize.y)), 0.0);
  vec3 wo = normalize(viewDirection);
  float normalDotView = max(dot(normal, wo), 1.0e-5);
  int specularSampleCount = uEnvironmentSampleCounts.x;
  int diffuseSampleCount = uEnvironmentSampleCounts.y;

  vec3 specular = vec3(0.0);
  float roughReflectance = 0.0;
  for (int sampleIndex = 0; sampleIndex < specularSampleCount; sampleIndex += 1) {
    vec2 sampleValue = roughPlasticSample2D(
      sampleIndex,
      specularSampleCount,
      0.0
    );
    vec3 localMicrofacetNormal = sampleRoughPlasticMicrofacetNormal(sampleValue, alpha);
    vec3 microfacetNormal = roughPlasticLocalToWorld(
      localMicrofacetNormal,
      normal,
      tangent,
      bitangent
    );
    float viewDotMicrofacet = dot(wo, microfacetNormal);
    float normalDotMicrofacet = dot(normal, microfacetNormal);
    if (viewDotMicrofacet <= 1.0e-6 || normalDotMicrofacet <= 1.0e-6) {
      continue;
    }

    vec3 wi = reflect(-wo, microfacetNormal);
    float normalDotLight = dot(normal, wi);
    if (normalDotLight <= 1.0e-6) {
      continue;
    }

    float fresnel = evaluateDielectricFresnel(viewDotMicrofacet, eta);
    float geometry = evaluateRoughPlasticSmithG1(
      wi,
      microfacetNormal,
      normal,
      alpha
    ) * evaluateRoughPlasticSmithG1(
      wo,
      microfacetNormal,
      normal,
      alpha
    );
    float sampleWeight = fresnel * geometry * viewDotMicrofacet /
      max(normalDotView * normalDotMicrofacet, 1.0e-6);
    float microfacetDensity = evaluateRoughPlasticMicrofacetDistribution(
      normalDotMicrofacet,
      alpha
    );
    float directionPdf = microfacetDensity * normalDotMicrofacet /
      max(4.0 * viewDotMicrofacet, 1.0e-6);
    float environmentLod = resolveEnvironmentSampleLod(
      wi,
      directionPdf,
      float(specularSampleCount),
      maximumEnvironmentLod
    );
    specular += sampleEnvironmentRadiance(wi, environmentLod) * sampleWeight;
    roughReflectance += sampleWeight;
  }
  specular /= float(specularSampleCount);
  roughReflectance = clamp(
    roughReflectance / float(specularSampleCount),
    0.0,
    1.0
  );

  vec3 transmittedIrradiance;
  if (useSphericalHarmonicsDiffuse) {
    float exteriorDiffuseTransmittance = 1.0 -
      approximateInternalDiffuseReflectance(1.0 / eta);
    transmittedIrradiance = evaluateEnvironmentIrradiance(normal) *
      (exteriorDiffuseTransmittance / PI);
  } else {
    transmittedIrradiance = vec3(0.0);
    for (int sampleIndex = 0; sampleIndex < diffuseSampleCount; sampleIndex += 1) {
      vec2 sampleValue = roughPlasticSample2D(
        sampleIndex,
        diffuseSampleCount,
        0.3819660112501051
      );
      vec3 wi = roughPlasticLocalToWorld(
        sampleCosineHemisphere(sampleValue),
        normal,
        tangent,
        bitangent
      );
      float normalDotLight = max(dot(normal, wi), 1.0e-6);
      float externalTransmittance = 1.0 - evaluateDielectricFresnel(normalDotLight, eta);
      float environmentLod = resolveEnvironmentSampleLod(
        wi,
        normalDotLight / PI,
        float(diffuseSampleCount),
        maximumEnvironmentLod
      );
      transmittedIrradiance += sampleEnvironmentRadiance(wi, environmentLod) *
        externalTransmittance;
    }
    transmittedIrradiance /= float(diffuseSampleCount);
  }

  vec3 diffuseReflectance = clamp(materialDiffuseReflectance, vec3(0.0), vec3(1.0));
  float internalReflectance = approximateInternalDiffuseReflectance(eta);
  vec3 internalDenominator = uEnvironmentSphereNonlinear
    ? vec3(1.0) - diffuseReflectance * internalReflectance
    : vec3(1.0 - internalReflectance);
  vec3 correctedDiffuseReflectance = diffuseReflectance /
    max(internalDenominator, vec3(1.0e-4));
  float externalViewTransmittance = 1.0 - roughReflectance;
  vec3 diffuse = correctedDiffuseReflectance * transmittedIrradiance *
    (externalViewTransmittance / max(eta * eta, 1.0e-6));

  return max(diffuse + specular, vec3(0.0));
}

vec3 sampleSilverSceneRadiance(vec3 position, vec3 normal, vec3 reflectedDirection, float lod) {
  vec3 reflectedPosition;
  vec3 reflectedNormal;
  vec3 reflectedAlbedo;
  float reflectedVisibility;
  float reflectedAlpha;
  int reflectedSurfaceType;
  vec3 reflectedRadiance;
  // The center sphere is convex: its outward reflection can only hit the floor
  // or a comparison sphere. Shade that hit with the same preview lighting.
  if (resolveEnvironmentScene(
    position + normal * ENVIRONMENT_RAY_EPSILON,
    reflectedDirection,
    reflectedPosition,
    reflectedNormal,
    reflectedAlbedo,
    reflectedVisibility,
    reflectedAlpha,
    reflectedSurfaceType
  )) {
    reflectedRadiance = evaluateEnvironmentRoughPlastic(
      reflectedNormal,
      -reflectedDirection,
      reflectedAlbedo,
      reflectedAlpha,
      reflectedSurfaceType == ENVIRONMENT_SURFACE_FLOOR
    ) * reflectedVisibility;
  } else {
    reflectedRadiance = sampleEnvironmentRadiance(reflectedDirection, lod);
  }
  return max(reflectedRadiance, vec3(0.0));
}

vec3 evaluateEnvironmentSmoothSilver(
  vec3 position, vec3 normal, vec3 viewDirection, float materialAlpha
) {
  vec3 radiance = vec3(0.0);
  // Each scene reflection may shade another rough surface. A small quadrature
  // budget keeps the narrow silver lobe interactive; mip filtering fills gaps.
  int sampleCount = min(uEnvironmentSampleCounts.x, 4);
  float maximumLod = max(log2(max(uImageSize.x, uImageSize.y)), 0.0);
  for (int sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
    vec3 reflectedDirection;
    vec3 reflectionWeight;
    float directionPdf;
    if (!sampleSmoothSilverReflection(
      normal,
      normalize(viewDirection),
      materialAlpha,
      roughPlasticSample2D(sampleIndex, sampleCount, 0.0),
      reflectedDirection,
      reflectionWeight,
      directionPdf
    )) {
      continue;
    }
    float lod = resolveEnvironmentSampleLod(reflectedDirection, directionPdf, float(sampleCount), maximumLod);
    radiance += sampleSilverSceneRadiance(position, normal, reflectedDirection, lod) * reflectionWeight;
  }
  return radiance / float(sampleCount);
}
