uniform float uPanoramaYawDeg;
uniform float uPanoramaPitchDeg;
uniform float uPanoramaHfovDeg;

vec3 rotatePitch(vec3 vector, float angleRad) {
  float cosAngle = cos(angleRad);
  float sinAngle = sin(angleRad);
  return vec3(
    vector.x,
    vector.y * cosAngle + vector.z * sinAngle,
    -vector.y * sinAngle + vector.z * cosAngle
  );
}

vec3 rotateYaw(vec3 vector, float angleRad) {
  float cosAngle = cos(angleRad);
  float sinAngle = sin(angleRad);
  return vec3(
    vector.x * cosAngle + vector.z * sinAngle,
    vector.y,
    -vector.x * sinAngle + vector.z * cosAngle
  );
}

float panoramaWideAngleBlend(float hfovDeg) {
  float t = clamp((hfovDeg - 120.0) / 60.0, 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

float panoramaProjectionDiameter(vec2 viewport, float hfovDeg) {
  return mix(viewport.x, min(viewport.x, viewport.y), panoramaWideAngleBlend(hfovDeg));
}

float panoramaScreenRadiusToTheta(float radius, float hfovDeg) {
  float safeRadius = max(radius, 0.0);
  float clampedHfov = clamp(hfovDeg, 1.0, 180.0);
  float halfFovRad = clampedHfov * DEG_TO_RAD * 0.5;
  if (clampedHfov <= 120.0) {
    return atan(safeRadius * tan(halfFovRad));
  }

  float blend = panoramaWideAngleBlend(clampedHfov);
  if (blend >= 1.0) {
    return safeRadius * halfFovRad;
  }

  float perspectiveTheta = atan(safeRadius * tan(halfFovRad));
  float equidistantTheta = safeRadius * halfFovRad;
  return mix(perspectiveTheta, equidistantTheta, blend);
}

bool usesCubemapCrossProjection() {
  return abs(uImageSize.x * 3.0 - uImageSize.y * 4.0) < 0.5;
}

void resolveCubemapFaceAndLocal(
  vec3 ray,
  out ivec2 face,
  out vec2 local
) {
  vec3 absoluteRay = abs(ray);

  if (absoluteRay.z >= absoluteRay.x && absoluteRay.z >= absoluteRay.y) {
    face.y = 1;
    if (ray.z >= 0.0) {
      face.x = 1;
      local = vec2(ray.x, ray.y) / absoluteRay.z;
    } else {
      face.x = 3;
      local = vec2(-ray.x, ray.y) / absoluteRay.z;
    }
  } else if (absoluteRay.x >= absoluteRay.y) {
    face.y = 1;
    if (ray.x >= 0.0) {
      face.x = 2;
      local = vec2(-ray.z, ray.y) / absoluteRay.x;
    } else {
      face.x = 0;
      local = vec2(ray.z, ray.y) / absoluteRay.x;
    }
  } else if (ray.y < 0.0) {
    face = ivec2(1, 0);
    local = vec2(ray.x, ray.z) / absoluteRay.y;
  } else {
    face = ivec2(1, 2);
    local = vec2(ray.x, -ray.z) / absoluteRay.y;
  }

  if (abs(local.x) < 1e-6) {
    local.x = 0.0;
  }
  if (abs(local.y) < 1e-6) {
    local.y = 0.0;
  }
}

ivec2 cubemapDirectionToPixel(vec3 ray) {
  ivec2 face;
  vec2 local;
  resolveCubemapFaceAndLocal(ray, face, local);

  int faceSize = int(uImageSize.x) / 4;
  vec2 facePixel = clamp(
    floor((local * 0.5 + 0.5) * float(faceSize)),
    vec2(0.0),
    vec2(float(faceSize - 1))
  );
  return face * faceSize + ivec2(facePixel);
}

ivec2 panoramaDirectionToPixel(vec3 ray) {
  if (usesCubemapCrossProjection()) {
    return cubemapDirectionToPixel(ray);
  }

  vec2 uv = vec2(
    fract(0.5 + atan(ray.x, ray.z) / (2.0 * PI)),
    clamp(0.5 + asin(clamp(ray.y, -1.0, 1.0)) / PI, 0.0, 1.0 - 1e-7)
  );
  return ivec2(
    int(floor(uv.x * uImageSize.x)),
    int(clamp(floor(uv.y * uImageSize.y), 0.0, uImageSize.y - 1.0))
  );
}

vec2 equirectangularDirectionToUv(vec3 direction) {
  vec3 ray = normalize(direction);
  return vec2(
    fract(0.5 + atan(ray.x, ray.z) / (2.0 * PI)),
    clamp(0.5 + asin(clamp(ray.y, -1.0, 1.0)) / PI, 0.0, 1.0 - 1e-7)
  );
}
