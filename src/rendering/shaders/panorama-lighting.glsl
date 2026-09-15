uniform bool uSourceTextureMipmapsAvailable;
uniform bool uEnvironmentSphereSmoothSilver;
uniform bool uEnvironmentSphereRoughSilver;
uniform bool uEnvironmentSpherePolarizedPlastic;
uniform vec3 uEnvironmentSphereDiffuseReflectance;
uniform float uEnvironmentSphereAlpha;
uniform float uEnvironmentSphereIntIor;
uniform float uEnvironmentSphereExtIor;
uniform int uEnvironmentSphereDistribution;
uniform bool uEnvironmentSphereNonlinear;

uniform sampler2D uEnvironmentRadianceTexture;

const int ENVIRONMENT_SURFACE_FLOOR = 0;
const int ENVIRONMENT_SURFACE_SPHERE = 1;
const int ENVIRONMENT_SURFACE_SMOOTH_SILVER = 2;
const int ENVIRONMENT_SURFACE_COMPARISON_SPHERE = 3;
const float ENVIRONMENT_RAY_EPSILON = 1.0e-3;
const int MICROFACET_DISTRIBUTION_GGX = 1;
const vec3 ENVIRONMENT_SPHERE_CENTER = vec3(0.0, 0.0, 3.5);
const float ENVIRONMENT_SPHERE_RADIUS = 1.0;
const int ENVIRONMENT_COMPARISON_SPHERE_COUNT = 6;
const float ENVIRONMENT_COMPARISON_SPHERE_RADIUS = 0.3;
const vec3 ENVIRONMENT_COMPARISON_SPHERE_CENTERS[6] = vec3[6](
  vec3(1.45, 0.7, 3.5),
  vec3(0.725, 0.7, 4.75574),
  vec3(-0.725, 0.7, 4.75574),
  vec3(-1.45, 0.7, 3.5),
  vec3(-0.725, 0.7, 2.24426),
  vec3(0.725, 0.7, 2.24426)
);
const vec3 ENVIRONMENT_COMPARISON_SPHERE_DIFFUSE_REFLECTANCE[6] = vec3[6](
  vec3(0.7, 0.04, 0.03),
  vec3(0.72, 0.32, 0.03),
  vec3(0.05, 0.58, 0.12),
  vec3(0.03, 0.5, 0.62),
  vec3(0.04, 0.1, 0.72),
  vec3(0.62, 0.04, 0.48)
);
const float ENVIRONMENT_COMPARISON_SPHERE_ALPHA[6] = float[6](
  0.02,
  0.05,
  0.1,
  0.2,
  0.4,
  0.7
);
const vec3 ENVIRONMENT_FLOOR_CENTER = vec3(0.0, 1.0, 3.5);
const float ENVIRONMENT_FLOOR_RADIUS = 2.75;
const float ENVIRONMENT_FLOOR_ALPHA = 0.7;
const float ENVIRONMENT_CAMERA_ORBIT_RADIUS = 3.5;
const float MIN_ENVIRONMENT_CAMERA_ORBIT_PITCH_DEG = -15.0;

float intersectEnvironmentSphere(
  vec3 rayOrigin,
  vec3 rayDirection,
  vec3 center,
  float radius
) {
  vec3 originToCenter = rayOrigin - center;
  float b = dot(originToCenter, rayDirection);
  float discriminant = b * b - (dot(originToCenter, originToCenter) - radius * radius);
  if (discriminant < 0.0) {
    return -1.0;
  }

  float root = sqrt(discriminant);
  float nearDistance = -b - root;
  float farDistance = -b + root;
  return nearDistance > 0.0 ? nearDistance : farDistance > 0.0 ? farDistance : -1.0;
}

float intersectEnvironmentFloor(
  vec3 rayOrigin,
  vec3 rayDirection,
  vec3 center,
  float radius
) {
  if (abs(rayDirection.y) <= 1.0e-6) {
    return -1.0;
  }

  float distance = (center.y - rayOrigin.y) / rayDirection.y;
  vec3 point = rayOrigin + rayDirection * distance;
  return distance > 0.0 && length(point.xz - center.xz) <= radius ? distance : -1.0;
}

bool resolveEnvironmentScene(
  vec3 rayOrigin,
  vec3 rayDirection,
  out vec3 position,
  out vec3 normal,
  out vec3 albedo,
  out float visibility,
  out float materialAlpha,
  out int surfaceType
) {
  float sphereDistance = intersectEnvironmentSphere(
    rayOrigin,
    rayDirection,
    ENVIRONMENT_SPHERE_CENTER,
    ENVIRONMENT_SPHERE_RADIUS
  );
  vec3 sphereCenter = ENVIRONMENT_SPHERE_CENTER;
  vec3 sphereDiffuseReflectance = uEnvironmentSphereDiffuseReflectance;
  float sphereAlpha = uEnvironmentSphereAlpha;
  int sphereSurfaceType = (uEnvironmentSphereSmoothSilver || uEnvironmentSphereRoughSilver)
    ? ENVIRONMENT_SURFACE_SMOOTH_SILVER
    : ENVIRONMENT_SURFACE_SPHERE;
  for (
    int sphereIndex = 0;
    sphereIndex < ENVIRONMENT_COMPARISON_SPHERE_COUNT;
    sphereIndex += 1
  ) {
    float candidateDistance = intersectEnvironmentSphere(
      rayOrigin,
      rayDirection,
      ENVIRONMENT_COMPARISON_SPHERE_CENTERS[sphereIndex],
      ENVIRONMENT_COMPARISON_SPHERE_RADIUS
    );
    if (
      candidateDistance > 0.0 &&
      (sphereDistance < 0.0 || candidateDistance < sphereDistance)
    ) {
      sphereDistance = candidateDistance;
      sphereCenter = ENVIRONMENT_COMPARISON_SPHERE_CENTERS[sphereIndex];
      sphereDiffuseReflectance =
        ENVIRONMENT_COMPARISON_SPHERE_DIFFUSE_REFLECTANCE[sphereIndex];
      sphereAlpha = ENVIRONMENT_COMPARISON_SPHERE_ALPHA[sphereIndex];
      sphereSurfaceType = ENVIRONMENT_SURFACE_COMPARISON_SPHERE;
    }
  }
  float floorDistance = intersectEnvironmentFloor(
    rayOrigin,
    rayDirection,
    ENVIRONMENT_FLOOR_CENTER,
    ENVIRONMENT_FLOOR_RADIUS
  );
  if (sphereDistance > 0.0 && (floorDistance < 0.0 || sphereDistance < floorDistance)) {
    position = rayOrigin + rayDirection * sphereDistance;
    normal = normalize(position - sphereCenter);
    albedo = sphereDiffuseReflectance;
    visibility = 1.0;
    materialAlpha = sphereAlpha;
    surfaceType = sphereSurfaceType;
    return true;
  }

  if (floorDistance > 0.0) {
    position = rayOrigin + rayDirection * floorDistance;
    vec2 floorOffset = position.xz - ENVIRONMENT_FLOOR_CENTER.xz;
    float checker = mod(floor(floorOffset.x * 1.4) + floor(floorOffset.y * 1.4), 2.0);
    normal = vec3(0.0, -1.0, 0.0);
    albedo = mix(vec3(0.34), vec3(0.43), checker);
    visibility = mix(0.38, 1.0, smoothstep(0.18, 1.35, length(floorOffset)));
    for (
      int sphereIndex = 0;
      sphereIndex < ENVIRONMENT_COMPARISON_SPHERE_COUNT;
      sphereIndex += 1
    ) {
      float comparisonShadowDistance = length(
        position.xz - ENVIRONMENT_COMPARISON_SPHERE_CENTERS[sphereIndex].xz
      );
      float comparisonVisibility = mix(
        0.55,
        1.0,
        smoothstep(0.06, 0.48, comparisonShadowDistance)
      );
      visibility = min(visibility, comparisonVisibility);
    }
    materialAlpha = ENVIRONMENT_FLOOR_ALPHA;
    surfaceType = ENVIRONMENT_SURFACE_FLOOR;
    return true;
  }

  return false;
}

void resolveEnvironmentOrbitBasis(
  out vec3 forward,
  out vec3 right,
  out vec3 down
) {
  float pitch = max(
    uPanoramaPitchDeg,
    MIN_ENVIRONMENT_CAMERA_ORBIT_PITCH_DEG
  ) * DEG_TO_RAD;
  float yaw = uPanoramaYawDeg * DEG_TO_RAD;
  forward = rotateYaw(rotatePitch(vec3(0.0, 0.0, 1.0), pitch), yaw);
  // Deriving right from yaw avoids the zero-length world-up cross product at
  // the exact top view. Down then remains well-defined over the full orbit.
  right = rotateYaw(vec3(1.0, 0.0, 0.0), yaw);
  down = cross(forward, right);
}

void resolveEnvironmentOrbitCamera(
  vec3 cameraRay,
  out vec3 rayOrigin,
  out vec3 rayDirection
) {
  vec3 forward;
  vec3 right;
  vec3 down;
  resolveEnvironmentOrbitBasis(forward, right, down);

  rayOrigin = ENVIRONMENT_SPHERE_CENTER - forward * ENVIRONMENT_CAMERA_ORBIT_RADIUS;
  rayDirection = normalize(
    right * cameraRay.x +
    down * cameraRay.y +
    forward * cameraRay.z
  );
}

bool usesMipmappedCubemapCrossProjection() {
  if (!usesCubemapCrossProjection()) {
    return false;
  }

  int imageWidth = int(uImageSize.x);
  int imageHeight = int(uImageSize.y);
  int faceSize = imageWidth / 4;
  return faceSize > 0 &&
    imageWidth == faceSize * 4 &&
    imageHeight == faceSize * 3 &&
    (faceSize & (faceSize - 1)) == 0;
}

vec2 cubemapFaceSafeUvAtMip(ivec2 face, vec2 local, float mipLevel) {
  float faceSize = uImageSize.x * 0.25;
  float mipFaceSize = max(faceSize * exp2(-mipLevel), 1.0);
  vec2 mipImageSize = vec2(4.0, 3.0) * mipFaceSize;
  vec2 facePixel = clamp(
    (local * 0.5 + 0.5) * mipFaceSize,
    vec2(0.5),
    vec2(mipFaceSize - 0.5)
  );
  return (vec2(face) * mipFaceSize + facePixel) / mipImageSize;
}

void buildRoughPlasticFrame(
  vec3 normal,
  vec3 cameraRight,
  vec3 cameraDown,
  out vec3 tangent,
  out vec3 bitangent
) {
  // Keep the deterministic quadrature frame smooth over the visible sphere.
  // Projecting camera right moves the unavoidable tangent-frame singularity to
  // the silhouette instead of placing a pinwheel in the sphere interior.
  vec3 candidate = cameraRight - normal * dot(cameraRight, normal);
  float candidateLengthSquared = dot(candidate, candidate);
  if (candidateLengthSquared < 1.0e-8) {
    candidate = cameraDown - normal * dot(cameraDown, normal);
    candidateLengthSquared = dot(candidate, candidate);
  }
  tangent = candidate * inversesqrt(max(candidateLengthSquared, 1.0e-12));
  bitangent = cross(normal, tangent);
}

vec3 roughPlasticLocalToWorld(
  vec3 localDirection,
  vec3 normal,
  vec3 tangent,
  vec3 bitangent
) {
  return normalize(
    tangent * localDirection.x +
    bitangent * localDirection.y +
    normal * localDirection.z
  );
}

vec3 sampleCosineHemisphere(vec2 sampleValue) {
  float radius = sqrt(sampleValue.x);
  float phi = 2.0 * PI * sampleValue.y;
  return vec3(
    radius * cos(phi),
    radius * sin(phi),
    sqrt(max(0.0, 1.0 - sampleValue.x))
  );
}

float evaluateDielectricFresnel(float cosThetaI, float eta) {
  float cosTheta = clamp(abs(cosThetaI), 0.0, 1.0);
  float sinThetaTSquared = max(0.0, 1.0 - cosTheta * cosTheta) / (eta * eta);
  if (sinThetaTSquared >= 1.0) {
    return 1.0;
  }

  float cosThetaT = sqrt(max(0.0, 1.0 - sinThetaTSquared));
  float rsNumerator = cosTheta - eta * cosThetaT;
  float rsDenominator = cosTheta + eta * cosThetaT;
  float rpNumerator = eta * cosTheta - cosThetaT;
  float rpDenominator = eta * cosTheta + cosThetaT;
  float rs = rsNumerator / max(abs(rsDenominator), 1.0e-6);
  float rp = rpNumerator / max(abs(rpDenominator), 1.0e-6);
  return clamp(0.5 * (rs * rs + rp * rp), 0.0, 1.0);
}

// The selected display channels are evaluated once into a linear HDR texture.
// Lighting loops never expand the RGB, spectral, or Stokes display evaluator.
vec3 sampleEnvironmentRadiance(vec3 direction, float lod) {
  vec3 ray = normalize(direction);
  bool cubemap = usesCubemapCrossProjection();
  if (
    !uSourceTextureMipmapsAvailable ||
    (cubemap && (lod <= 0.0 || !usesMipmappedCubemapCrossProjection()))
  ) {
    ivec2 pixel = panoramaDirectionToPixel(ray);
    return texelFetch(uEnvironmentRadianceTexture, pixel, 0).rgb;
  }

  vec2 uv;
  float sampleLod = lod;
  if (cubemap) {
    ivec2 face;
    vec2 local;
    resolveCubemapFaceAndLocal(ray, face, local);
    float maximumMip = log2(max(uImageSize.x * 0.25, 1.0));
    float clampedLod = clamp(lod, 0.0, maximumMip);
    // Trilinear filtering reads both adjacent levels. Clamp against the coarser
    // level so neither footprint crosses a face boundary in the cross atlas.
    float uvClampMip = ceil(clampedLod);
    uv = cubemapFaceSafeUvAtMip(face, local, uvClampMip);
    sampleLod = clampedLod;
  } else {
    uv = equirectangularDirectionToUv(ray);
  }
  return textureLod(uEnvironmentRadianceTexture, uv, sampleLod).rgb;
}
