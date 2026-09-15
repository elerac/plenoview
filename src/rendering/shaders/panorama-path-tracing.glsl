// Runtime bounce bounds keep compilation independent of the requested quality.
uniform int uPathTracingMaxBounces;
#ifdef PATH_TRACING_ACCUMULATE_ONLY
const int uPathTracingPass = 1;
#else
uniform int uPathTracingPass;
#endif
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
const int ENVIRONMENT_IMPORTANCE_PROJECTION_PENVMAP = 2;

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
  if (uEnvironmentImportanceProjection == ENVIRONMENT_IMPORTANCE_PROJECTION_PENVMAP) safeIndex *= 2;
  return texelFetch(
    uEnvironmentImportanceTexture,
    ivec2(safeIndex - (safeIndex / width) * width, safeIndex / width),
    0
  );
}

vec4 readPenvmapImportanceCorners(int index) {
  int width = max(uEnvironmentImportanceTextureSize.x, 1);
  int offset = 2 * index + 1;
  return texelFetch(uEnvironmentImportanceTexture, ivec2(offset % width, offset / width), 0);
}

float bilinearImportanceDensity(vec4 corners, vec2 p) {
  return mix(mix(corners.x, corners.y, p.x), mix(corners.z, corners.w, p.x), p.y);
}

float sampleLinearDensity(float sampleValue, float start, float end) {
  // Invert the integral with a cancellation-free quadratic root.
  if (abs(end - start) < 1.0e-6 * max(start + end, 1.0e-20)) return sampleValue;
  float integral = sampleValue * (start + end);
  return clamp(integral / max(start + sqrt(max(0.0,
    start * start + (end - start) * integral)), 1.0e-30), 0.0, 1.0);
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
  if (uEnvironmentImportanceProjection == ENVIRONMENT_IMPORTANCE_PROJECTION_PENVMAP) {
    vec3 localDirection = viewerToPenvmap(normalize(direction));
    vec2 uv = penvmapDirectionToUv(localDirection);
    vec2 grid = vec2(fract(uv.x - 0.5 / float(gridWidth)), uv.y) * vec2(gridWidth, gridHeight);
    ivec2 cell = min(ivec2(grid), ivec2(gridWidth - 1, gridHeight - 1));
    float density = bilinearImportanceDensity(readPenvmapImportanceCorners(cell.y * gridWidth + cell.x), grid - vec2(cell));
    float sine = length(localDirection.xz);
    return density / (2.0 * PI * PI * max(sine, 1.0e-7));
  }
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

  if (uEnvironmentImportanceProjection == ENVIRONMENT_IMPORTANCE_PROJECTION_PENVMAP) {
    int row = selectedIndex / gridWidth;
    int column = selectedIndex - row * gridWidth;
    vec4 corners = readPenvmapImportanceCorners(selectedIndex);
    float y = sampleLinearDensity(sampleValue.y, corners.x + corners.y, corners.z + corners.w);
    float x = sampleLinearDensity(sampleValue.x, mix(corners.x, corners.z, y), mix(corners.y, corners.w, y));
    vec2 uv = vec2((float(column) + x + 0.5) / float(gridWidth),
                   (float(row) + y) / float(gridHeight));
    vec3 localDirection = penvmapUvToDirection(uv);
    direction = penvmapToViewer(localDirection);
    pdf = bilinearImportanceDensity(corners, vec2(x, y)) /
      (2.0 * PI * PI * max(length(localDirection.xz), 1.0e-7));
  } else if (uEnvironmentImportanceProjection == ENVIRONMENT_IMPORTANCE_PROJECTION_CUBEMAP) {
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
  float distribution = mitsubaMicrofacetDistribution(
    normal,
    microfacetNormal,
    alpha
  );
  float geometry = mitsubaSmithG1(
    viewDirection,
    microfacetNormal,
    normal,
    alpha
  ) * mitsubaSmithG1(
    lightDirection,
    microfacetNormal,
    normal,
    alpha
  );
  vec3 specular = vec3(
    fresnel * distribution * geometry /
    (4.0 * normalDotView * normalDotLight)
  );

  vec3 diffuseReflectance = clamp(
    materialDiffuseReflectance,
    vec3(0.0),
    vec3(1.0)
  );
  vec2 viewLookup = roughPlasticLookup(normalDotView, alpha);
  float internalReflectance = viewLookup.y;
  vec3 internalDenominator = uEnvironmentSphereNonlinear
    ? vec3(1.0) - diffuseReflectance * internalReflectance
    : vec3(1.0 - internalReflectance);
  vec3 correctedDiffuseReflectance = diffuseReflectance /
    internalDenominator;
  float viewTransmittance = viewLookup.x;
  float lightTransmittance = roughPlasticLookup(normalDotLight, alpha).x;
  vec3 diffuse = correctedDiffuseReflectance *
    (viewTransmittance * lightTransmittance /
      (PI * eta * eta));

  return max(specular + diffuse, vec3(0.0));
}

float resolvePathTracingRoughPlasticSpecularProbability(
  vec3 normal,
  vec3 viewDirection,
  float alpha,
  vec3 diffuseReflectance
) {
  float normalDotView = max(dot(normal, viewDirection), 0.0);
  float transmittance = roughPlasticLookup(normalDotView, alpha).x;
  float diffuseMean = dot(diffuseReflectance, vec3(1.0 / 3.0));
  float specularWeight = 1.0 / max(1.0 + diffuseMean, 1.0e-8);
  float specular = (1.0 - transmittance) * specularWeight;
  float diffuse = transmittance * (1.0 - specularWeight);
  return specular / max(specular + diffuse, 1.0e-20);
}

float evaluatePathTracingRoughPlasticPdf(
  vec3 normal,
  vec3 viewDirection,
  vec3 lightDirection,
  float eta,
  float alpha,
  vec3 diffuseReflectance
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
      specularPdf = mitsubaMicrofacetDistribution(
        normal,
        microfacetNormal,
        alpha
      ) * mitsubaSmithG1(viewDirection, microfacetNormal, normal, alpha) /
        max(4.0 * dot(normal, viewDirection), 1.0e-20);
    }
  }
  float diffusePdf = normalDotLight / PI;
  float specularProbability = resolvePathTracingRoughPlasticSpecularProbability(
    normal,
    viewDirection,
    alpha,
    diffuseReflectance
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

  float alpha = max(materialAlpha, 1.0e-4);
  float eta = max(uEnvironmentSphereIntIor, 1.0e-3) /
    max(uEnvironmentSphereExtIor, 1.0e-3);
  float normalDotView = max(dot(normal, viewDirection), 0.0);
  if (normalDotView <= 0.0) {
    return false;
  }

  float specularProbability = resolvePathTracingRoughPlasticSpecularProbability(
    normal,
    viewDirection,
    alpha,
    diffuseReflectance
  );
  if (nextPathTracingRandom(randomState) < specularProbability) {
    vec3 microfacetNormal = sampleMitsubaVisibleMicrofacet(
      normal, viewDirection, alpha, nextPathTracingRandom2(randomState));
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
    alpha,
    diffuseReflectance
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
  float alpha = max(materialAlpha, 1.0e-4);
  float eta = max(uEnvironmentSphereIntIor, 1.0e-3) /
    max(uEnvironmentSphereExtIor, 1.0e-3);
  samplingPdf = evaluatePathTracingRoughPlasticPdf(
    normal,
    viewDirection,
    lightDirection,
    eta,
    alpha,
    albedo
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

// pplastic.cpp uses a reflectance-only mixture, independent of incident angle.
float polarizedPlasticSpecularProbability(vec3 albedo) {
  return 1.0 / max(1.0 + dot(albedo, vec3(1.0 / 3.0)), 1.0e-8);
}

RgbMueller evaluatePathTracingPolarizedPlasticBsdf(
  vec3 normal, vec3 viewDirection, vec3 lightDirection, vec3 albedo,
  float materialAlpha, out float samplingPdf
) {
  samplingPdf = 0.0;
  float normalDotView = dot(normal, viewDirection);
  float normalDotLight = dot(normal, lightDirection);
  if (normalDotView <= 0.0 || normalDotLight <= 0.0) return depolarizingMueller(vec3(0.0));
  vec3 halfway = viewDirection + lightDirection;
  if (dot(halfway, halfway) <= 1.0e-20) return depolarizingMueller(vec3(0.0));
  vec3 microfacet = normalize(halfway);
  float alpha = max(materialAlpha, 1.0e-4);
  float eta = uEnvironmentSphereIntIor / uEnvironmentSphereExtIor;
  float distribution = mitsubaMicrofacetDistribution(normal, microfacet, alpha);
  float gView = mitsubaSmithG1(viewDirection, microfacet, normal, alpha);
  float gLight = mitsubaSmithG1(lightDirection, microfacet, normal, alpha);
  float specularPdf = distribution * gView / (4.0 * normalDotView);
  if (dot(viewDirection, microfacet) <= 0.0 || dot(lightDirection, microfacet) <= 0.0) specularPdf = 0.0;
  float specularProbability = polarizedPlasticSpecularProbability(albedo);
  samplingPdf = specularProbability * specularPdf + (1.0 - specularProbability) * normalDotLight / PI;
  // Our integrator applies cos(theta_o) separately; upstream eval includes it.
  float specularScale = distribution * gView * gLight / (4.0 * normalDotView * normalDotLight);
  if (!uEnvironmentPolarized) {
    float ignoredCosThetaT;
    float reflection = mitsubaDielectricFresnel(dot(viewDirection, microfacet), eta, ignoredCosThetaT);
    float reflectView = mitsubaDielectricFresnel(normalDotView, eta, ignoredCosThetaT);
    float reflectLight = mitsubaDielectricFresnel(normalDotLight, eta, ignoredCosThetaT);
    return depolarizingMueller(vec3(reflection * specularScale) +
      albedo * ((1.0 - reflectLight) * (1.0 - reflectView) / PI));
  }
  mat4 specular = dielectricReflectionMueller(microfacet, viewDirection, lightDirection, eta) * specularScale;
  mat4 diffuse = pplasticDiffuseMueller(normal, viewDirection, lightDirection, eta) / PI;
  // No roughplastic lookup, internal-scattering correction, or eta^-2 term:
  // pplastic defines this direct sum of two differently polarized components.
  return RgbMueller(specular + diffuse * albedo.r,
                     specular + diffuse * albedo.g,
                     specular + diffuse * albedo.b);
}

bool samplePathTracingPolarizedPlastic(
  vec3 normal, vec3 viewDirection, vec3 albedo, float materialAlpha,
  inout uint randomState, out vec3 lightDirection, out RgbMueller weight,
  out float samplingPdf
) {
  weight = depolarizingMueller(vec3(0.0));
  samplingPdf = 0.0;
  if (dot(normal, viewDirection) <= 0.0) return false;
  float sampleLobe = nextPathTracingRandom(randomState);
  vec2 sampleDirection = nextPathTracingRandom2(randomState);
  if (sampleLobe < polarizedPlasticSpecularProbability(albedo)) {
    vec3 microfacet = sampleMitsubaVisibleMicrofacet(normal, viewDirection,
      max(materialAlpha, 1.0e-4), sampleDirection);
    lightDirection = reflect(-viewDirection, microfacet);
  } else {
    vec2 disk = mitsubaConcentricDisk(sampleDirection);
    vec3 tangent = mitsubaStokesBasis(normal), bitangent = cross(normal, tangent);
    lightDirection = tangent * disk.x + bitangent * disk.y +
      normal * sqrt(max(0.0, 1.0 - dot(disk, disk)));
  }
  RgbMueller value = evaluatePathTracingPolarizedPlasticBsdf(normal, viewDirection,
    lightDirection, albedo, materialAlpha, samplingPdf);
  if (!(samplingPdf > 0.0) || !isFiniteValue(samplingPdf)) return false;
  weight = scaleMueller(value, dot(normal, lightDirection) / samplingPdf);
  return true;
}

bool usesPolarizedPlasticSurface(int surfaceType) {
#ifdef PATH_TRACING_DEPOLARIZING_SPHERE
  // In a polarized environment, floor/comparison spheres use polarized plastic.
  // Conductors have already branched before this call. Only the central legacy
  // roughplastic material can require the scalar BSDF path.
  return !PATH_TRACING_DEPOLARIZING_SPHERE || surfaceType != ENVIRONMENT_SURFACE_SPHERE;
#else
  if (surfaceType == ENVIRONMENT_SURFACE_SPHERE) return uEnvironmentSpherePolarizedPlastic;
  return uEnvironmentPolarized && (surfaceType == ENVIRONMENT_SURFACE_FLOOR ||
    surfaceType == ENVIRONMENT_SURFACE_COMPARISON_SPHERE);
#endif
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
    position + normal * ENVIRONMENT_RAY_EPSILON,
    direction,
    ignoredPosition,
    ignoredNormal,
    ignoredAlbedo,
    ignoredVisibility,
    ignoredMaterialAlpha,
    ignoredSurfaceType
  );
}

// Each returned BSDF maps the incoming WORLD Stokes frame (-lightDirection)
// to the outgoing WORLD frame (+viewDirection), as si.to_world_mueller does.
RgbMueller evaluatePolarizedSurfaceBsdf(
  vec3 normal, vec3 viewDirection, vec3 lightDirection, vec3 albedo,
  float materialAlpha, int surfaceType, out float samplingPdf
) {
  samplingPdf = 0.0;
  if (surfaceType != ENVIRONMENT_SURFACE_SMOOTH_SILVER) {
    if (usesPolarizedPlasticSurface(surfaceType)) {
      return evaluatePathTracingPolarizedPlasticBsdf(normal, viewDirection,
        lightDirection, albedo, materialAlpha, samplingPdf);
    }
    // Upstream roughplastic intentionally depolarizes BOTH lobes.
    return depolarizingMueller(evaluatePathTracingSurfaceBsdf(
      normal, viewDirection, lightDirection, albedo, materialAlpha, samplingPdf));
  }
  if (!uEnvironmentSphereRoughSilver) return depolarizingMueller(vec3(0.0));
  float normalDotView = dot(normal, viewDirection);
  float normalDotLight = dot(normal, lightDirection);
  if (normalDotView <= 0.0 || normalDotLight <= 0.0) return depolarizingMueller(vec3(0.0));
  vec3 halfway = viewDirection + lightDirection;
  if (dot(halfway, halfway) <= 1.0e-20) return depolarizingMueller(vec3(0.0));
  vec3 microfacet = normalize(halfway);
  float alpha = max(materialAlpha, 1.0e-4);
  float distribution = mitsubaMicrofacetDistribution(normal, microfacet, alpha);
  float gView = mitsubaSmithG1(viewDirection, microfacet, normal, alpha);
  float gLight = mitsubaSmithG1(lightDirection, microfacet, normal, alpha);
  samplingPdf = distribution * gView / (4.0 * normalDotView);
  RgbMueller reflection = silverReflectionMueller(microfacet, viewDirection, lightDirection);
  if (!uEnvironmentPolarized) reflection = depolarizingMueller(unpolarizedMueller(reflection));
  return scaleMueller(reflection, distribution * gView * gLight /
    (4.0 * normalDotView * normalDotLight));
}

bool samplePolarizedSurfaceBsdf(
  vec3 normal, vec3 viewDirection, vec3 albedo, float materialAlpha, int surfaceType,
  inout uint randomState, out vec3 lightDirection, out RgbMueller weight,
  out float samplingPdf, out bool delta
) {
  samplingPdf = 0.0;
  delta = false;
  weight = depolarizingMueller(vec3(0.0));
  if (dot(normal, viewDirection) <= 0.0) return false;
  if (surfaceType != ENVIRONMENT_SURFACE_SMOOTH_SILVER) {
    if (usesPolarizedPlasticSurface(surfaceType)) {
      return samplePathTracingPolarizedPlastic(normal, viewDirection, albedo,
        materialAlpha, randomState, lightDirection, weight, samplingPdf);
    }
    vec3 scalarWeight = vec3(0.0);
    bool valid = samplePathTracingRoughPlastic(normal, viewDirection, albedo,
      materialAlpha, randomState, lightDirection, scalarWeight, samplingPdf);
    weight = depolarizingMueller(scalarWeight);
    return valid;
  }
  delta = !uEnvironmentSphereRoughSilver;
  float alpha = max(materialAlpha, 1.0e-4);
  vec3 microfacet = delta ? normal : sampleMitsubaVisibleMicrofacet(
    normal, viewDirection, alpha, nextPathTracingRandom2(randomState));
  lightDirection = reflect(-viewDirection, microfacet);
  if (dot(normal, lightDirection) <= 0.0 || dot(viewDirection, microfacet) <= 0.0) return false;
  weight = silverReflectionMueller(microfacet, viewDirection, lightDirection);
  if (!uEnvironmentPolarized) weight = depolarizingMueller(unpolarizedMueller(weight));
  if (delta) {
    samplingPdf = 1.0;
  } else {
    samplingPdf = mitsubaMicrofacetDistribution(normal, microfacet, alpha) *
      mitsubaSmithG1(viewDirection, microfacet, normal, alpha) / (4.0 * dot(normal, viewDirection));
    // Visible-normal sampling cancels D, G1(wi) and the reflection Jacobian.
    weight = scaleMueller(weight, mitsubaSmithG1(lightDirection, microfacet, normal, alpha));
  }
  return samplingPdf > 0.0 && isFiniteValue(samplingPdf);
}

bool finiteMueller(RgbMueller matrix) {
  for (int column = 0; column < 4; ++column) {
    if (any(isnan(matrix.r[column])) || any(isinf(matrix.r[column])) ||
        any(isnan(matrix.g[column])) || any(isinf(matrix.g[column])) ||
        any(isnan(matrix.b[column])) || any(isinf(matrix.b[column]))) return false;
  }
  return true;
}

PolarizedStokes tracePolarizedEnvironmentPath(
  vec3 initialRayOrigin, vec3 initialRayDirection, inout uint randomState
) {
  PolarizedStokes radiance = zeroStokes();
  RgbMueller throughput = identityMueller();
  vec3 rayOrigin = initialRayOrigin, rayDirection = initialRayDirection;
  float previousBsdfPdf = 0.0;
  bool previousDelta = true;

  // uPathTracingMaxBounces counts surface scattering events. Evaluate an
  // escaping emitter ray after the final event too, to pair both MIS proposals.
  for (int bounce = 0; bounce <= uPathTracingMaxBounces; ++bounce) {
    vec3 position, normal, albedo;
    float visibility, materialAlpha;
    int surfaceType;
    if (!resolveEnvironmentScene(rayOrigin, rayDirection, position, normal,
                                  albedo, visibility, materialAlpha, surfaceType)) {
      float misWeight = previousDelta ? 1.0 : pathTracingPowerHeuristic(
        previousBsdfPdf, environmentImportancePdf(rayDirection));
      radiance = addStokes(radiance, scaleStokes(
        applyMueller(throughput, samplePolarizedEnvironment(rayDirection)), misWeight));
      break;
    }
    if (bounce == uPathTracingMaxBounces) break;
    vec3 viewDirection = -rayDirection;
    if (dot(normal, viewDirection) <= 0.0) break;
    bool delta = surfaceType == ENVIRONMENT_SURFACE_SMOOTH_SILVER && !uEnvironmentSphereRoughSilver;

    // path.cpp: throughput * (world BSDF * world emitter Stokes), in this order.
    if (!delta) {
      vec3 lightDirection;
      float environmentPdf;
      if (sampleEnvironmentImportance(randomState, lightDirection, environmentPdf) &&
          dot(normal, lightDirection) > 0.0 &&
          isEnvironmentDirectionVisible(position, normal, lightDirection)) {
        float bsdfPdf;
        RgbMueller bsdf = evaluatePolarizedSurfaceBsdf(normal, viewDirection,
          lightDirection, albedo, materialAlpha, surfaceType, bsdfPdf);
        float scale = dot(normal, lightDirection) *
          pathTracingPowerHeuristic(environmentPdf, bsdfPdf) / environmentPdf;
        PolarizedStokes contribution = applyMueller(throughput,
          applyMueller(bsdf, samplePolarizedEnvironment(lightDirection)));
        radiance = addStokes(radiance, scaleStokes(contribution, scale));
      }
    }

    vec3 nextDirection;
    RgbMueller bounceWeight;
    float nextPdf;
    bool nextDelta;
    if (!samplePolarizedSurfaceBsdf(normal, viewDirection, albedo, materialAlpha,
        surfaceType, randomState, nextDirection, bounceWeight, nextPdf, nextDelta)) break;
    throughput = multiplyMueller(throughput, bounceWeight);
    float throughputMaximum = maxColorComponent(unpolarizedMueller(throughput));
    if (!finiteMueller(throughput) || !(throughputMaximum > 0.0)) break;

    // Mitsuba's default rr_depth=5, using max(M00), never signed S1-S3.
    if (bounce + 1 >= 5) {
      float survival = min(throughputMaximum, 0.95);
      if (nextPathTracingRandom(randomState) >= survival) break;
      throughput = scaleMueller(throughput, 1.0 / survival);
    }
    rayOrigin = position + normal * ENVIRONMENT_RAY_EPSILON;
    rayDirection = nextDirection;
    previousBsdfPdf = nextPdf;
    previousDelta = nextDelta;
  }
  // No clamping or tone mapping of signed Stokes components during transport.
  return stokesToSensor(radiance, initialRayDirection);
}

vec3 traceEnvironmentPath(vec3 rayOrigin, vec3 rayDirection, inout uint randomState) {
  return tracePolarizedEnvironmentPath(rayOrigin, rayDirection, randomState).s0;
}
