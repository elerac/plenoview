// Runtime bounce bounds keep compilation independent of the requested quality.
uniform int uPathTracingMaxBounces;
uniform int uPathTracingPass;
uniform int uPathTracingSampleIndex;
uniform float uPathTracingBlendWeight;
uniform sampler2D uPathTracingPreviousTexture;
uniform sampler2D uEnvironmentImportanceTexture;
uniform ivec2 uEnvironmentImportanceTextureSize;
uniform ivec2 uEnvironmentImportanceGridSize;
uniform int uEnvironmentImportanceEntryCount;
uniform int uEnvironmentImportanceProjection;

const int PATH_TRACING_PASS_ACCUMULATE = 1;
const int ENVIRONMENT_IMPORTANCE_PROJECTION_CUBEMAP = 1;
const float PATH_TRACING_RAY_EPSILON = 1.0e-3;
const int PATH_TRACING_RUSSIAN_ROULETTE_START_BOUNCE = 2;

uint pathTracingHash(uint value) {
  uint state = value * 747796405u + 2891336453u;
  uint word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
  return (word >> 22u) ^ word;
}

uint initializePathTracingRandomState(ivec2 pixel, int sampleIndex) {
  uint x = uint(max(pixel.x, 0));
  uint y = uint(max(pixel.y, 0));
  uint sampleNumber = uint(max(sampleIndex, 0));
  return pathTracingHash(
    pathTracingHash(x + 0x9e3779b9u) ^
    pathTracingHash(y + 0x85ebca6bu) ^
    pathTracingHash(sampleNumber + 0xc2b2ae35u)
  );
}

float nextPathTracingRandom(inout uint state) {
  state = pathTracingHash(state);
  return float(state) * (1.0 / 4294967296.0);
}

vec2 nextPathTracingRandom2(inout uint state) {
  return vec2(nextPathTracingRandom(state), nextPathTracingRandom(state));
}

vec4 readEnvironmentImportanceEntry(int index) {
  int width = max(uEnvironmentImportanceTextureSize.x, 1);
  int safeIndex = clamp(index, 0, max(uEnvironmentImportanceEntryCount - 1, 0));
  return texelFetch(
    uEnvironmentImportanceTexture,
    ivec2(safeIndex - (safeIndex / width) * width, safeIndex / width),
    0
  );
}

vec3 cubemapImportanceDirection(int faceIndex, vec2 local) {
  if (faceIndex == 0) {
    return normalize(vec3(local.x, -1.0, local.y));
  }
  if (faceIndex == 1) {
    return normalize(vec3(-1.0, local.y, local.x));
  }
  if (faceIndex == 2) {
    return normalize(vec3(local.x, local.y, 1.0));
  }
  if (faceIndex == 3) {
    return normalize(vec3(1.0, local.y, -local.x));
  }
  if (faceIndex == 4) {
    return normalize(vec3(-local.x, local.y, -1.0));
  }
  return normalize(vec3(local.x, 1.0, -local.y));
}

void resolveCubemapImportanceFace(
  vec3 direction,
  out int faceIndex,
  out vec2 local
) {
  vec3 ray = normalize(direction);
  vec3 absoluteRay = abs(ray);
  if (absoluteRay.z >= absoluteRay.x && absoluteRay.z >= absoluteRay.y) {
    if (ray.z >= 0.0) {
      faceIndex = 2;
      local = vec2(ray.x, ray.y) / absoluteRay.z;
    } else {
      faceIndex = 4;
      local = vec2(-ray.x, ray.y) / absoluteRay.z;
    }
    return;
  }
  if (absoluteRay.x >= absoluteRay.y) {
    if (ray.x >= 0.0) {
      faceIndex = 3;
      local = vec2(-ray.z, ray.y) / absoluteRay.x;
    } else {
      faceIndex = 1;
      local = vec2(ray.z, ray.y) / absoluteRay.x;
    }
    return;
  }
  if (ray.y >= 0.0) {
    faceIndex = 5;
    local = vec2(ray.x, -ray.z) / absoluteRay.y;
  } else {
    faceIndex = 0;
    local = vec2(ray.x, ray.z) / absoluteRay.y;
  }
}

float environmentImportancePdf(vec3 direction) {
  if (uEnvironmentImportanceEntryCount <= 0) {
    return 1.0 / (4.0 * PI);
  }

  int gridWidth = max(uEnvironmentImportanceGridSize.x, 1);
  int gridHeight = max(uEnvironmentImportanceGridSize.y, 1);
  if (uEnvironmentImportanceProjection == ENVIRONMENT_IMPORTANCE_PROJECTION_CUBEMAP) {
    int faceIndex;
    vec2 local;
    resolveCubemapImportanceFace(direction, faceIndex, local);
    ivec2 cell = ivec2(clamp(
      floor((local * 0.5 + 0.5) * vec2(gridWidth, gridHeight)),
      vec2(0.0),
      vec2(gridWidth - 1, gridHeight - 1)
    ));
    int index = faceIndex * gridWidth * gridHeight + cell.y * gridWidth + cell.x;
    float probabilityMass = max(readEnvironmentImportanceEntry(index).b, 0.0);
    float localStepX = 2.0 / float(gridWidth);
    float localStepY = 2.0 / float(gridHeight);
    float lengthCubed = pow(1.0 + dot(local, local), 1.5);
    return probabilityMass * lengthCubed / (localStepX * localStepY);
  }

  vec2 uv = equirectangularDirectionToUv(direction);
  ivec2 cell = ivec2(
    min(int(floor(uv.x * float(gridWidth))), gridWidth - 1),
    min(int(floor(uv.y * float(gridHeight))), gridHeight - 1)
  );
  int index = cell.y * gridWidth + cell.x;
  float probabilityMass = max(readEnvironmentImportanceEntry(index).b, 0.0);
  float latitudeLower = (float(cell.y) / float(gridHeight) - 0.5) * PI;
  float latitudeUpper = (float(cell.y + 1) / float(gridHeight) - 0.5) * PI;
  float solidAngle = (2.0 * PI / float(gridWidth)) *
    (sin(latitudeUpper) - sin(latitudeLower));
  return probabilityMass / max(solidAngle, 1.0e-10);
}

bool sampleEnvironmentImportance(
  inout uint randomState,
  out vec3 direction,
  out float pdf
) {
  if (uEnvironmentImportanceEntryCount <= 0) {
    vec2 sampleValue = nextPathTracingRandom2(randomState);
    float y = 1.0 - 2.0 * sampleValue.x;
    float radial = sqrt(max(0.0, 1.0 - y * y));
    float azimuth = 2.0 * PI * sampleValue.y;
    direction = vec3(sin(azimuth) * radial, y, cos(azimuth) * radial);
    pdf = 1.0 / (4.0 * PI);
    return true;
  }

  float selector = nextPathTracingRandom(randomState) *
    float(uEnvironmentImportanceEntryCount);
  int candidateIndex = min(
    int(floor(selector)),
    uEnvironmentImportanceEntryCount - 1
  );
  vec4 candidate = readEnvironmentImportanceEntry(candidateIndex);
  int selectedIndex = fract(selector) < candidate.r
    ? candidateIndex
    : clamp(
        int(floor(candidate.g + 0.5)),
        0,
        uEnvironmentImportanceEntryCount - 1
      );
  float probabilityMass = max(readEnvironmentImportanceEntry(selectedIndex).b, 0.0);
  vec2 sampleValue = nextPathTracingRandom2(randomState);
  int gridWidth = max(uEnvironmentImportanceGridSize.x, 1);
  int gridHeight = max(uEnvironmentImportanceGridSize.y, 1);

  if (uEnvironmentImportanceProjection == ENVIRONMENT_IMPORTANCE_PROJECTION_CUBEMAP) {
    int entriesPerFace = gridWidth * gridHeight;
    int faceIndex = selectedIndex / entriesPerFace;
    int faceCell = selectedIndex - faceIndex * entriesPerFace;
    int row = faceCell / gridWidth;
    int column = faceCell - row * gridWidth;
    vec2 localStep = vec2(2.0 / float(gridWidth), 2.0 / float(gridHeight));
    vec2 local = vec2(-1.0) + (vec2(column, row) + sampleValue) * localStep;
    direction = cubemapImportanceDirection(faceIndex, local);
    float lengthCubed = pow(1.0 + dot(local, local), 1.5);
    pdf = probabilityMass * lengthCubed / (localStep.x * localStep.y);
  } else {
    int row = selectedIndex / gridWidth;
    int column = selectedIndex - row * gridWidth;
    float longitude = (
      (float(column) + sampleValue.x) / float(gridWidth) - 0.5
    ) * 2.0 * PI;
    float latitudeLower = (float(row) / float(gridHeight) - 0.5) * PI;
    float latitudeUpper = (float(row + 1) / float(gridHeight) - 0.5) * PI;
    float sinLatitude = mix(
      sin(latitudeLower),
      sin(latitudeUpper),
      sampleValue.y
    );
    float cosLatitude = sqrt(max(0.0, 1.0 - sinLatitude * sinLatitude));
    direction = vec3(
      sin(longitude) * cosLatitude,
      sinLatitude,
      cos(longitude) * cosLatitude
    );
    float solidAngle = (2.0 * PI / float(gridWidth)) *
      (sin(latitudeUpper) - sin(latitudeLower));
    pdf = probabilityMass / max(solidAngle, 1.0e-10);
  }
  return pdf > 0.0 && isFiniteValue(pdf);
}

float pathTracingPowerHeuristic(float firstPdf, float secondPdf) {
  float firstSquared = firstPdf * firstPdf;
  float secondSquared = secondPdf * secondPdf;
  return firstSquared / max(firstSquared + secondSquared, 1.0e-20);
}

float maxColorComponent(vec3 color) {
  return max(color.r, max(color.g, color.b));
}

vec3 evaluatePathTracingRoughPlasticBsdf(
  vec3 normal,
  vec3 viewDirection,
  vec3 lightDirection,
  float eta,
  float alpha,
  vec3 materialDiffuseReflectance
) {
  float normalDotView = dot(normal, viewDirection);
  float normalDotLight = dot(normal, lightDirection);
  if (normalDotView <= 0.0 || normalDotLight <= 0.0) {
    return vec3(0.0);
  }

  vec3 halfwayVector = viewDirection + lightDirection;
  float halfwayLengthSquared = dot(halfwayVector, halfwayVector);
  if (halfwayLengthSquared <= 1.0e-10) {
    return vec3(0.0);
  }
  vec3 microfacetNormal = halfwayVector * inversesqrt(halfwayLengthSquared);
  float normalDotMicrofacet = max(dot(normal, microfacetNormal), 0.0);
  float viewDotMicrofacet = max(dot(viewDirection, microfacetNormal), 0.0);
  if (normalDotMicrofacet <= 0.0 || viewDotMicrofacet <= 0.0) {
    return vec3(0.0);
  }

  float fresnel = evaluateDielectricFresnel(viewDotMicrofacet, eta);
  float distribution = evaluateRoughPlasticMicrofacetDistribution(
    normalDotMicrofacet,
    alpha
  );
  float geometry = evaluateRoughPlasticSmithG1(
    viewDirection,
    microfacetNormal,
    normal,
    alpha
  ) * evaluateRoughPlasticSmithG1(
    lightDirection,
    microfacetNormal,
    normal,
    alpha
  );
  vec3 specular = vec3(
    fresnel * distribution * geometry /
    max(4.0 * normalDotView * normalDotLight, 1.0e-8)
  );

  vec3 diffuseReflectance = clamp(
    materialDiffuseReflectance,
    vec3(0.0),
    vec3(1.0)
  );
  float internalReflectance = approximateInternalDiffuseReflectance(eta);
  vec3 internalDenominator = uEnvironmentSphereNonlinear
    ? vec3(1.0) - diffuseReflectance * internalReflectance
    : vec3(1.0 - internalReflectance);
  vec3 correctedDiffuseReflectance = diffuseReflectance /
    max(internalDenominator, vec3(1.0e-4));
  float viewTransmittance = 1.0 - evaluateDielectricFresnel(normalDotView, eta);
  float lightTransmittance = 1.0 - evaluateDielectricFresnel(normalDotLight, eta);
  vec3 diffuse = correctedDiffuseReflectance *
    (viewTransmittance * lightTransmittance /
      max(PI * eta * eta, 1.0e-6));

  return max(specular + diffuse, vec3(0.0));
}

float resolvePathTracingRoughPlasticSpecularProbability(
  vec3 normal,
  vec3 viewDirection,
  float eta
) {
  float normalDotView = max(dot(normal, viewDirection), 0.0);
  return clamp(
    0.25 + 0.5 * evaluateDielectricFresnel(normalDotView, eta),
    0.25,
    0.75
  );
}

float evaluatePathTracingRoughPlasticPdf(
  vec3 normal,
  vec3 viewDirection,
  vec3 lightDirection,
  float eta,
  float alpha
) {
  float normalDotLight = dot(normal, lightDirection);
  if (dot(normal, viewDirection) <= 0.0 || normalDotLight <= 0.0) {
    return 0.0;
  }

  vec3 halfwayVector = viewDirection + lightDirection;
  float halfwayLengthSquared = dot(halfwayVector, halfwayVector);
  float specularPdf = 0.0;
  if (halfwayLengthSquared > 1.0e-10) {
    vec3 microfacetNormal = halfwayVector * inversesqrt(halfwayLengthSquared);
    float normalDotMicrofacet = max(dot(normal, microfacetNormal), 0.0);
    float viewDotMicrofacet = max(dot(viewDirection, microfacetNormal), 0.0);
    if (normalDotMicrofacet > 0.0 && viewDotMicrofacet > 0.0) {
      specularPdf = evaluateRoughPlasticMicrofacetDistribution(
        normalDotMicrofacet,
        alpha
      ) * normalDotMicrofacet / max(4.0 * viewDotMicrofacet, 1.0e-8);
    }
  }
  float diffusePdf = normalDotLight / PI;
  float specularProbability = resolvePathTracingRoughPlasticSpecularProbability(
    normal,
    viewDirection,
    eta
  );
  return specularProbability * specularPdf +
    (1.0 - specularProbability) * diffusePdf;
}

bool samplePathTracingRoughPlastic(
  vec3 normal,
  vec3 viewDirection,
  vec3 diffuseReflectance,
  float materialAlpha,
  inout uint randomState,
  out vec3 lightDirection,
  out vec3 pathWeight,
  out float sampledPdf
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
  float normalDotView = max(dot(normal, viewDirection), 0.0);
  if (normalDotView <= 0.0) {
    return false;
  }

  float specularProbability = resolvePathTracingRoughPlasticSpecularProbability(
    normal,
    viewDirection,
    eta
  );
  if (nextPathTracingRandom(randomState) < specularProbability) {
    vec3 localMicrofacetNormal = sampleRoughPlasticMicrofacetNormal(
      nextPathTracingRandom2(randomState),
      alpha
    );
    vec3 microfacetNormal = roughPlasticLocalToWorld(
      localMicrofacetNormal,
      normal,
      tangent,
      bitangent
    );
    if (dot(viewDirection, microfacetNormal) <= 0.0) {
      return false;
    }
    lightDirection = reflect(-viewDirection, microfacetNormal);
  } else {
    lightDirection = roughPlasticLocalToWorld(
      sampleCosineHemisphere(nextPathTracingRandom2(randomState)),
      normal,
      tangent,
      bitangent
    );
  }

  float normalDotLight = dot(normal, lightDirection);
  if (normalDotLight <= 0.0) {
    return false;
  }

  sampledPdf = evaluatePathTracingRoughPlasticPdf(
    normal,
    viewDirection,
    lightDirection,
    eta,
    alpha
  );
  if (!(sampledPdf > 0.0) || !isFiniteValue(sampledPdf)) {
    return false;
  }

  vec3 bsdf = evaluatePathTracingRoughPlasticBsdf(
    normal,
    viewDirection,
    lightDirection,
    eta,
    alpha,
    diffuseReflectance
  );
  pathWeight = bsdf * (normalDotLight / sampledPdf);
  return !hasInvalidValue(pathWeight);
}

vec3 evaluatePathTracingSurfaceBsdf(
  vec3 normal,
  vec3 viewDirection,
  vec3 lightDirection,
  vec3 albedo,
  float materialAlpha,
  out float samplingPdf
) {
  float normalDotLight = max(dot(normal, lightDirection), 0.0);
  if (normalDotLight <= 0.0) {
    samplingPdf = 0.0;
    return vec3(0.0);
  }
  float alpha = clamp(materialAlpha, 1.0e-3, 1.0);
  float eta = max(uEnvironmentSphereIntIor, 1.0e-3) /
    max(uEnvironmentSphereExtIor, 1.0e-3);
  samplingPdf = evaluatePathTracingRoughPlasticPdf(
    normal,
    viewDirection,
    lightDirection,
    eta,
    alpha
  );
  return evaluatePathTracingRoughPlasticBsdf(
    normal,
    viewDirection,
    lightDirection,
    eta,
    alpha,
    albedo
  );
}

bool isEnvironmentDirectionVisible(
  vec3 position,
  vec3 normal,
  vec3 direction
) {
  vec3 ignoredPosition;
  vec3 ignoredNormal;
  vec3 ignoredAlbedo;
  float ignoredVisibility;
  float ignoredMaterialAlpha;
  int ignoredSurfaceType;
  return !resolveEnvironmentScene(
    position + normal * PATH_TRACING_RAY_EPSILON,
    direction,
    ignoredPosition,
    ignoredNormal,
    ignoredAlbedo,
    ignoredVisibility,
    ignoredMaterialAlpha,
    ignoredSurfaceType
  );
}

vec3 samplePathTracingDirectEnvironment(
  vec3 position,
  vec3 normal,
  vec3 viewDirection,
  vec3 albedo,
  float materialAlpha,
  inout uint randomState
) {
  vec3 lightDirection;
  float environmentPdf;
  if (!sampleEnvironmentImportance(randomState, lightDirection, environmentPdf)) {
    return vec3(0.0);
  }
  float normalDotLight = dot(normal, lightDirection);
  if (
    normalDotLight <= 0.0 ||
    !isEnvironmentDirectionVisible(position, normal, lightDirection)
  ) {
    return vec3(0.0);
  }

  float bsdfPdf;
  vec3 bsdf = evaluatePathTracingSurfaceBsdf(
    normal,
    viewDirection,
    lightDirection,
    albedo,
    materialAlpha,
    bsdfPdf
  );
  float misWeight = pathTracingPowerHeuristic(environmentPdf, bsdfPdf);
  vec3 environmentRadiance = max(
    sampleEnvironmentRadiance(lightDirection, 0.0),
    vec3(0.0)
  );
  return bsdf * environmentRadiance *
    (normalDotLight * misWeight / max(environmentPdf, 1.0e-10));
}

vec3 traceEnvironmentPath(
  vec3 initialRayOrigin,
  vec3 initialRayDirection,
  inout uint randomState
) {
  vec3 radiance = vec3(0.0);
  vec3 throughput = vec3(1.0);
  vec3 rayOrigin = initialRayOrigin;
  vec3 rayDirection = initialRayDirection;
  float previousBsdfPdf = 0.0;
  bool hasPreviousBsdfSample = false;

  for (int bounce = 0; bounce < uPathTracingMaxBounces; bounce += 1) {
    vec3 position;
    vec3 normal;
    vec3 albedo;
    float ignoredVisibility;
    float materialAlpha;
    int ignoredSurfaceType;
    if (!resolveEnvironmentScene(
      rayOrigin,
      rayDirection,
      position,
      normal,
      albedo,
      ignoredVisibility,
      materialAlpha,
      ignoredSurfaceType
    )) {
      float misWeight = hasPreviousBsdfSample
        ? pathTracingPowerHeuristic(
            previousBsdfPdf,
            environmentImportancePdf(rayDirection)
          )
        : 1.0;
      radiance += throughput * max(
        sampleEnvironmentRadiance(rayDirection, 0.0),
        vec3(0.0)
      ) * misWeight;
      break;
    }

    radiance += throughput * samplePathTracingDirectEnvironment(
      position,
      normal,
      -rayDirection,
      albedo,
      materialAlpha,
      randomState
    );

    vec3 nextDirection;
    vec3 bounceWeight;
    float nextBsdfPdf;
    if (!samplePathTracingRoughPlastic(
      normal,
      -rayDirection,
      albedo,
      materialAlpha,
      randomState,
      nextDirection,
      bounceWeight,
      nextBsdfPdf
    )) {
      break;
    }

    throughput *= bounceWeight;
    if (hasInvalidValue(throughput) || maxColorComponent(throughput) <= 0.0) {
      break;
    }

    if (bounce >= PATH_TRACING_RUSSIAN_ROULETTE_START_BOUNCE) {
      float survivalProbability = clamp(maxColorComponent(throughput), 0.05, 0.95);
      if (nextPathTracingRandom(randomState) >= survivalProbability) {
        break;
      }
      throughput /= survivalProbability;
    }

    rayOrigin = position + normal * PATH_TRACING_RAY_EPSILON;
    rayDirection = nextDirection;
    previousBsdfPdf = nextBsdfPdf;
    hasPreviousBsdfSample = true;
  }

  return sanitizeDisplayColor(max(radiance, vec3(0.0)));
}
