precision highp float;

uniform vec2 uViewport;
uniform vec2 uViewportOrigin;
uniform vec2 uOutputSize;
uniform vec2 uOutputPixelScale;
uniform vec2 uScreenOrigin;
uniform vec2 uImageSize;
uniform float uExposure;
uniform float uDisplayGamma;
uniform int uBackgroundMode;
uniform vec3 uBackgroundColor;
uniform int uAlphaOutputMode;

out vec4 outColor;

const int ALPHA_OUTPUT_OPAQUE = 0;
const int ALPHA_OUTPUT_STRAIGHT = 1;
const int ALPHA_OUTPUT_PREMULTIPLIED = 2;
const int BACKGROUND_MODE_NONE = 0;
const int BACKGROUND_MODE_CHECKER = 1;
const int BACKGROUND_MODE_SOLID = 2;
const float PI = 3.1415926535897932384626433832795;
const float DEG_TO_RAD = PI / 180.0;
const float DISPLAY_GAMMA_MIN = 0.01;

bool isFiniteValue(float value) {
  highp uint bits = floatBitsToUint(value);
  return (bits & 0x7f800000u) != 0x7f800000u;
}

bool hasInvalidValue(vec3 value) {
  return !isFiniteValue(value.r) || !isFiniteValue(value.g) || !isFiniteValue(value.b);
}

bool hasInvalidValue(vec4 value) {
  return !isFiniteValue(value.x) || !isFiniteValue(value.y) || !isFiniteValue(value.z) || !isFiniteValue(value.w);
}

float sanitizeDisplayValue(float value) {
  // Select integer representations so native fast-math optimization cannot
  // propagate a NaN through a floating-point conditional into the HDR mipmaps.
  highp uint bits = floatBitsToUint(value);
  highp uint finiteBits = (bits & 0x7f800000u) == 0x7f800000u ? 0u : bits;
  return uintBitsToFloat(finiteBits);
}

vec3 sanitizeDisplayColor(vec3 color) {
  return vec3(
    sanitizeDisplayValue(color.r),
    sanitizeDisplayValue(color.g),
    sanitizeDisplayValue(color.b)
  );
}

vec3 linearToDisplayGamma(vec3 linear) {
  float displayGamma = max(uDisplayGamma, DISPLAY_GAMMA_MIN);
  return sign(linear) * pow(abs(linear), vec3(1.0 / displayGamma));
}

vec3 checker(vec2 screen) {
  vec2 anchoredScreen = screen + uViewportOrigin;
  float tile = mod(floor(anchoredScreen.x / 16.0) + floor(anchoredScreen.y / 16.0), 2.0);
  return mix(vec3(0.09), vec3(0.12), tile);
}

vec4 backgroundColor(vec2 screen) {
  if (uBackgroundMode == BACKGROUND_MODE_CHECKER) {
    return vec4(checker(screen), 1.0);
  }

  if (uBackgroundMode == BACKGROUND_MODE_SOLID) {
    return vec4(uBackgroundColor, 1.0);
  }

  if (uAlphaOutputMode == ALPHA_OUTPUT_OPAQUE) {
    return vec4(0.0, 0.0, 0.0, 1.0);
  }

  return vec4(0.0);
}

vec4 encodeOutputColor(vec2 screen, vec3 color, float alpha) {
  if (uBackgroundMode == BACKGROUND_MODE_CHECKER) {
    return vec4(mix(checker(screen), color, alpha), 1.0);
  }

  if (uBackgroundMode == BACKGROUND_MODE_SOLID) {
    return vec4(mix(uBackgroundColor, color, alpha), 1.0);
  }

  if (uAlphaOutputMode == ALPHA_OUTPUT_PREMULTIPLIED) {
    return vec4(color * alpha, alpha);
  }

  if (uAlphaOutputMode == ALPHA_OUTPUT_STRAIGHT) {
    return vec4(color, alpha);
  }

  return vec4(color, 1.0);
}
