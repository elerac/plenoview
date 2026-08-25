#version 300 es
precision highp float;

uniform sampler2D uSourceTextures[12];
uniform sampler2D uColormapTexture;
uniform vec2 uViewport;
uniform vec2 uViewportOrigin;
uniform vec2 uOutputSize;
uniform vec2 uOutputPixelScale;
uniform vec2 uScreenOrigin;
uniform vec2 uImageSize;
uniform bool uSourceTextureMipmapsAvailable;
uniform float uExposure;
uniform float uDisplayGamma;
uniform bool uUseColormap;
uniform float uColormapExposure;
uniform float uColormapGamma;
uniform bool uColormapZeroCentered;
uniform bool uColormapReversed;
uniform float uColormapMin;
uniform float uColormapMax;
uniform ivec2 uColormapTextureSize;
uniform int uColormapEntryCount;
uniform int uDisplayMode;
uniform int uStokesParameter;
uniform bool uMaskInvalidStokesVectors;
uniform bool uWarnInvalidValues;
uniform float uInvalidValueWarningPhase;
uniform bool uUseStokesDegreeModulation;
uniform int uStokesDegreeModulationMode;
uniform bool uUseImageAlpha;
uniform int uBackgroundMode;
uniform vec3 uBackgroundColor;
uniform int uAlphaOutputMode;
uniform float uPanoramaYawDeg;
uniform float uPanoramaPitchDeg;
uniform float uPanoramaHfovDeg;
uniform int uPanoramaDisplayMode;
uniform int uPanoramaLightingMethod;
uniform int uPathTracingPass;
uniform int uPathTracingSampleIndex;
uniform float uPathTracingBlendWeight;
uniform sampler2D uPathTracingPreviousTexture;
uniform sampler2D uEnvironmentImportanceTexture;
uniform ivec2 uEnvironmentImportanceTextureSize;
uniform ivec2 uEnvironmentImportanceGridSize;
uniform int uEnvironmentImportanceEntryCount;
uniform int uEnvironmentImportanceProjection;
uniform vec3 uEnvironmentShIrradiance[36];
uniform vec3 uEnvironmentSphereDiffuseReflectance;
uniform float uEnvironmentSphereAlpha;
uniform float uEnvironmentSphereIntIor;
uniform float uEnvironmentSphereExtIor;
uniform int uEnvironmentSphereDistribution;
uniform bool uEnvironmentSphereNonlinear;
out vec4 outColor;

const int DISPLAY_MODE_EMPTY = 0;
const int DISPLAY_MODE_CHANNEL_RGB = 1;
const int DISPLAY_MODE_CHANNEL_MONO = 2;
const int DISPLAY_MODE_STOKES_DIRECT = 3;
const int DISPLAY_MODE_STOKES_RGB = 4;
const int DISPLAY_MODE_STOKES_RGB_LUMINANCE = 5;
const int DISPLAY_MODE_SPECTRAL_RGB = 6;
const int DISPLAY_MODE_STOKES_SPECTRAL_RGB = 7;
const int DISPLAY_MODE_STOKES_SPECTRAL_RGB_LUMINANCE = 8;
const int DISPLAY_MODE_MUELLER_MATRIX = 9;
const int DISPLAY_MODE_CHANNEL_NORMAL_MAP = 10;
const int ALPHA_OUTPUT_OPAQUE = 0;
const int ALPHA_OUTPUT_STRAIGHT = 1;
const int ALPHA_OUTPUT_PREMULTIPLIED = 2;
const int BACKGROUND_MODE_NONE = 0;
const int BACKGROUND_MODE_CHECKER = 1;
const int BACKGROUND_MODE_SOLID = 2;
const int PANORAMA_DISPLAY_MODE_ENVIRONMENT_LIGHTING = 1;
const int PANORAMA_LIGHTING_METHOD_PATH_TRACING = 1;
const int PATH_TRACING_PASS_ACCUMULATE = 1;
const int ENVIRONMENT_IMPORTANCE_PROJECTION_CUBEMAP = 1;
const int ENVIRONMENT_SURFACE_FLOOR = 0;
const int ENVIRONMENT_SURFACE_SPHERE = 1;
const int MICROFACET_DISTRIBUTION_BECKMANN = 0;
const int MICROFACET_DISTRIBUTION_GGX = 1;
const int ROUGH_PLASTIC_DIFFUSE_SAMPLE_COUNT = 256;
const int ROUGH_PLASTIC_SPECULAR_SAMPLE_COUNT = 128;
const float ROUGH_PLASTIC_SAMPLE_FILTER_OVERLAP = 4.0;
const int STOKES_DEGREE_MODULATION_MODE_VALUE = 0;
const int STOKES_DEGREE_MODULATION_MODE_SATURATION = 1;

const int STOKES_PARAMETER_AOLP = 0;
const int STOKES_PARAMETER_DOLP = 1;
const int STOKES_PARAMETER_DOP = 2;
const int STOKES_PARAMETER_DOCP = 3;
const int STOKES_PARAMETER_COP = 4;
const int STOKES_PARAMETER_TOP = 5;
const int STOKES_PARAMETER_S1_OVER_S0 = 6;
const int STOKES_PARAMETER_S2_OVER_S0 = 7;
const int STOKES_PARAMETER_S3_OVER_S0 = 8;

const float PI = 3.1415926535897932384626433832795;
const float DEG_TO_RAD = PI / 180.0;
const float REC709_LUMINANCE_WEIGHT_R = 0.2126;
const float REC709_LUMINANCE_WEIGHT_G = 0.7152;
const float REC709_LUMINANCE_WEIGHT_B = 0.0722;
const float DISPLAY_GAMMA_MIN = 0.01;
const float COLORMAP_GAMMA_MIN = 0.2;
const float STOKES_VECTOR_VALIDITY_RTOL = 1.0e-8;
const vec3 INVALID_VALUE_WARNING_COLOR = vec3(1.0, 0.0, 1.0);
const vec3 ENVIRONMENT_SPHERE_CENTER = vec3(0.0, 0.0, 3.5);
const float ENVIRONMENT_SPHERE_RADIUS = 1.0;
// These fixed comparison materials share the center sphere's IOR,
// distribution, and nonlinear setting while sampling color and roughness.
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
const float ENVIRONMENT_CAMERA_ORBIT_RADIUS = 3.5;
const float MIN_ENVIRONMENT_CAMERA_ORBIT_PITCH_DEG = -15.0;
const float PATH_TRACING_RAY_EPSILON = 1.0e-3;
const int PATH_TRACING_MAX_BOUNCES = 6;
const int PATH_TRACING_RUSSIAN_ROULETTE_START_BOUNCE = 2;

struct DisplaySample {
  vec3 linear;
  float alpha;
  vec4 stokes;
  bool invalidValue;
};

struct StokesRgbDisplaySample {
  vec3 value;
  bool invalidValue;
};

bool isFiniteValue(float value) {
  return !(isnan(value) || isinf(value));
}

bool hasInvalidValue(vec3 value) {
  return !isFiniteValue(value.r) || !isFiniteValue(value.g) || !isFiniteValue(value.b);
}

bool hasInvalidValue(vec4 value) {
  return !isFiniteValue(value.x) || !isFiniteValue(value.y) || !isFiniteValue(value.z) || !isFiniteValue(value.w);
}

float nanValue() {
  return uintBitsToFloat(0x7fc00000u);
}

bool isPhysicallyValidStokesVector(float s0, float s1, float s2, float s3) {
  if (
    !isFiniteValue(s0) ||
    !isFiniteValue(s1) ||
    !isFiniteValue(s2) ||
    !isFiniteValue(s3) ||
    s0 < 0.0
  ) {
    return false;
  }

  float s0Squared = s0 * s0;
  return s0Squared - (s1 * s1 + s2 * s2 + s3 * s3) >= -abs(STOKES_VECTOR_VALIDITY_RTOL) * s0Squared;
}

bool hasFiniteStokesVectorComponents(float s0, float s1, float s2, float s3) {
  return isFiniteValue(s0) && isFiniteValue(s1) && isFiniteValue(s2) && isFiniteValue(s3);
}

bool shouldRejectStokesVector(float s0, float s1, float s2, float s3) {
  if (!hasFiniteStokesVectorComponents(s0, s1, s2, s3)) {
    return true;
  }

  return uMaskInvalidStokesVectors && !isPhysicallyValidStokesVector(s0, s1, s2, s3);
}

float sanitizeDisplayValue(float value) {
  return isFiniteValue(value) ? value : 0.0;
}

vec3 sanitizeDisplayColor(vec3 color) {
  return vec3(
    sanitizeDisplayValue(color.r),
    sanitizeDisplayValue(color.g),
    sanitizeDisplayValue(color.b)
  );
}

float sanitizeAlphaValue(float value) {
  return isFiniteValue(value) ? clamp(value, 0.0, 1.0) : 0.0;
}

float mapNormalComponentToDisplayValue(float value) {
  return isFiniteValue(value) ? clamp(value * 0.5 + 0.5, 0.0, 1.0) : 0.5;
}

vec3 mapNormalToDisplayColor(vec3 normal) {
  return vec3(
    mapNormalComponentToDisplayValue(normal.r),
    mapNormalComponentToDisplayValue(normal.g),
    mapNormalComponentToDisplayValue(normal.b)
  );
}

float computeRec709Luminance(float r, float g, float b) {
  return REC709_LUMINANCE_WEIGHT_R * r +
    REC709_LUMINANCE_WEIGHT_G * g +
    REC709_LUMINANCE_WEIGHT_B * b;
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

ivec2 colormapCoord(int index) {
  int width = max(uColormapTextureSize.x, 1);
  return ivec2(index - (index / width) * width, index / width);
}

vec3 sampleColormap(float value, float vmin, float vmax) {
  if (
    !isFiniteValue(value) ||
    uColormapEntryCount < 2 ||
    uColormapTextureSize.x <= 0 ||
    uColormapTextureSize.y <= 0
  ) {
    return vec3(0.0);
  }

  float gamma = max(uColormapGamma, COLORMAP_GAMMA_MIN);
  float scaledValue = value * exp2(uColormapExposure);
  float t = 0.0;
  if (uColormapZeroCentered) {
    float magnitude = max(abs(vmin), abs(vmax));
    if (!isFiniteValue(magnitude) || magnitude <= 0.0) {
      return vec3(0.0);
    }

    float signedValue = clamp(scaledValue / magnitude, -1.0, 1.0);
    float signedGamma = sign(signedValue) * pow(abs(signedValue), 1.0 / gamma);
    t = clamp(0.5 + 0.5 * signedGamma, 0.0, 1.0);
  } else {
    if (vmax <= vmin) {
      return vec3(0.0);
    }

    t = pow(clamp((scaledValue - vmin) / (vmax - vmin), 0.0, 1.0), 1.0 / gamma);
  }

  if (uColormapReversed) {
    t = 1.0 - t;
  }

  float lutIndex = t * float(uColormapEntryCount - 1);
  int index0 = int(floor(lutIndex));
  int index1 = min(index0 + 1, uColormapEntryCount - 1);
  float f = lutIndex - float(index0);
  vec3 color0 = texelFetch(uColormapTexture, colormapCoord(index0), 0).rgb;
  vec3 color1 = texelFetch(uColormapTexture, colormapCoord(index1), 0).rgb;
  return mix(color0, color1, f);
}

vec3 rgbToHsv(vec3 c) {
  float maxValue = max(max(c.r, c.g), c.b);
  float minValue = min(min(c.r, c.g), c.b);
  float delta = maxValue - minValue;
  float hue = 0.0;
  if (delta > 0.0) {
    if (maxValue == c.r) {
      hue = mod((c.g - c.b) / delta, 6.0);
    } else if (maxValue == c.g) {
      hue = (c.b - c.r) / delta + 2.0;
    } else {
      hue = (c.r - c.g) / delta + 4.0;
    }
    hue /= 6.0;
    if (hue < 0.0) {
      hue += 1.0;
    }
  }

  float saturation = maxValue == 0.0 ? 0.0 : delta / maxValue;
  return vec3(hue, saturation, maxValue);
}

vec3 hsvToRgb(vec3 hsv) {
  float hue = fract(hsv.x);
  float saturation = clamp(hsv.y, 0.0, 1.0);
  float value = clamp(hsv.z, 0.0, 1.0);
  float c = value * saturation;
  float hp = hue * 6.0;
  float x = c * (1.0 - abs(mod(hp, 2.0) - 1.0));
  float m = value - c;
  vec3 rgb = vec3(0.0);

  if (hp < 1.0) {
    rgb = vec3(c, x, 0.0);
  } else if (hp < 2.0) {
    rgb = vec3(x, c, 0.0);
  } else if (hp < 3.0) {
    rgb = vec3(0.0, c, x);
  } else if (hp < 4.0) {
    rgb = vec3(0.0, x, c);
  } else if (hp < 5.0) {
    rgb = vec3(x, 0.0, c);
  } else {
    rgb = vec3(c, 0.0, x);
  }

  return rgb + vec3(m);
}

float computeStokesAolp(float s1, float s2) {
  if (!isFiniteValue(s1) || !isFiniteValue(s2)) {
    return nanValue();
  }

  if (s1 == 0.0 && s2 == 0.0) {
    return nanValue();
  }

  float aolp = 0.5 * atan(s2, s1);
  if (!isFiniteValue(aolp)) {
    return nanValue();
  }

  return aolp < 0.0 ? aolp + PI : aolp;
}

float computeStokesDolp(float s0, float s1, float s2) {
  if (!isFiniteValue(s0) || !isFiniteValue(s1) || !isFiniteValue(s2) || s0 == 0.0) {
    return nanValue();
  }

  float dolp = sqrt(s1 * s1 + s2 * s2) / s0;
  return isFiniteValue(dolp) ? dolp : nanValue();
}

float computeStokesDop(float s0, float s1, float s2, float s3) {
  if (!isFiniteValue(s0) || !isFiniteValue(s1) || !isFiniteValue(s2) || !isFiniteValue(s3) || s0 == 0.0) {
    return nanValue();
  }

  float dop = sqrt(s1 * s1 + s2 * s2 + s3 * s3) / s0;
  return isFiniteValue(dop) ? dop : nanValue();
}

float computeStokesDocp(float s0, float s3) {
  if (!isFiniteValue(s0) || !isFiniteValue(s3) || s0 == 0.0) {
    return nanValue();
  }

  float docp = abs(s3) / s0;
  return isFiniteValue(docp) ? docp : nanValue();
}

float computeStokesEang(float s1, float s2, float s3) {
  if (!isFiniteValue(s1) || !isFiniteValue(s2) || !isFiniteValue(s3)) {
    return nanValue();
  }

  if (s1 == 0.0 && s2 == 0.0 && s3 == 0.0) {
    return nanValue();
  }

  float eang = 0.5 * atan(s3, sqrt(s1 * s1 + s2 * s2));
  return isFiniteValue(eang) ? eang : nanValue();
}

float computeStokesNormalizedComponent(float s0, float component) {
  if (!isFiniteValue(s0) || !isFiniteValue(component) || s0 == 0.0) {
    return nanValue();
  }

  float normalized = component / s0;
  return isFiniteValue(normalized) ? normalized : nanValue();
}

float computeStokesDisplayValue(int parameter, float s0, float s1, float s2, float s3) {
  if (shouldRejectStokesVector(s0, s1, s2, s3)) {
    return nanValue();
  }

  if (parameter == STOKES_PARAMETER_AOLP) {
    return computeStokesAolp(s1, s2);
  }
  if (parameter == STOKES_PARAMETER_DOLP) {
    return computeStokesDolp(s0, s1, s2);
  }
  if (parameter == STOKES_PARAMETER_DOP) {
    return computeStokesDop(s0, s1, s2, s3);
  }
  if (parameter == STOKES_PARAMETER_DOCP) {
    return computeStokesDocp(s0, s3);
  }
  if (parameter == STOKES_PARAMETER_COP) {
    return computeStokesEang(s1, s2, s3);
  }
  if (parameter == STOKES_PARAMETER_TOP) {
    return computeStokesEang(s1, s2, s3);
  }
  if (parameter == STOKES_PARAMETER_S1_OVER_S0) {
    return computeStokesNormalizedComponent(s0, s1);
  }
  if (parameter == STOKES_PARAMETER_S2_OVER_S0) {
    return computeStokesNormalizedComponent(s0, s2);
  }
  if (parameter == STOKES_PARAMETER_S3_OVER_S0) {
    return computeStokesNormalizedComponent(s0, s3);
  }

  return 0.0;
}

float computeStokesDegreeModulationValue(int parameter, float s0, float s1, float s2, float s3) {
  if (shouldRejectStokesVector(s0, s1, s2, s3)) {
    return nanValue();
  }

  if (parameter == STOKES_PARAMETER_AOLP) {
    return computeStokesDolp(s0, s1, s2);
  }
  if (parameter == STOKES_PARAMETER_COP) {
    return computeStokesDocp(s0, s3);
  }
  if (parameter == STOKES_PARAMETER_TOP) {
    return computeStokesDop(s0, s1, s2, s3);
  }

  return 0.0;
}

float computeStokesDegreeModulationDisplayValue(int parameter, float s0, float s1, float s2, float s3) {
  float value = computeStokesDegreeModulationValue(parameter, s0, s1, s2, s3);
  return isFiniteValue(value) ? clamp(value, 0.0, 1.0) : 0.0;
}

vec4 applyInvalidValueWarning(vec4 color, bool invalidValue) {
  if (uWarnInvalidValues && invalidValue && uInvalidValueWarningPhase >= 0.5) {
    return vec4(INVALID_VALUE_WARNING_COLOR, 1.0);
  }

  return color;
}

bool isInvalidStokesDisplayValue(vec4 stokes, float value) {
  return shouldRejectStokesVector(stokes.x, stokes.y, stokes.z, stokes.w) || !isFiniteValue(value);
}

bool hasInvalidStokesDisplayValues(vec4 stokesR, vec4 stokesG, vec4 stokesB, vec3 value) {
  return isInvalidStokesDisplayValue(stokesR, value.r) ||
    isInvalidStokesDisplayValue(stokesG, value.g) ||
    isInvalidStokesDisplayValue(stokesB, value.b);
}

float readSource0(ivec2 pixel) {
  return texelFetch(uSourceTextures[0], pixel, 0).r;
}

float readSource1(ivec2 pixel) {
  return texelFetch(uSourceTextures[1], pixel, 0).r;
}

float readSource2(ivec2 pixel) {
  return texelFetch(uSourceTextures[2], pixel, 0).r;
}

float readSource3(ivec2 pixel) {
  return texelFetch(uSourceTextures[3], pixel, 0).r;
}

float readSource4(ivec2 pixel) {
  return texelFetch(uSourceTextures[4], pixel, 0).r;
}

float readSource5(ivec2 pixel) {
  return texelFetch(uSourceTextures[5], pixel, 0).r;
}

float readSource6(ivec2 pixel) {
  return texelFetch(uSourceTextures[6], pixel, 0).r;
}

float readSource7(ivec2 pixel) {
  return texelFetch(uSourceTextures[7], pixel, 0).r;
}

float readSource8(ivec2 pixel) {
  return texelFetch(uSourceTextures[8], pixel, 0).r;
}

float readSource9(ivec2 pixel) {
  return texelFetch(uSourceTextures[9], pixel, 0).r;
}

float readSource10(ivec2 pixel) {
  return texelFetch(uSourceTextures[10], pixel, 0).r;
}

float readSource11(ivec2 pixel) {
  return texelFetch(uSourceTextures[11], pixel, 0).r;
}

vec3 readRgbSource0(ivec2 pixel) {
  return texelFetch(uSourceTextures[0], pixel, 0).rgb;
}

vec3 readRgbSource1(ivec2 pixel) {
  return texelFetch(uSourceTextures[1], pixel, 0).rgb;
}

vec3 readRgbSource2(ivec2 pixel) {
  return texelFetch(uSourceTextures[2], pixel, 0).rgb;
}

vec3 readRgbSource3(ivec2 pixel) {
  return texelFetch(uSourceTextures[3], pixel, 0).rgb;
}

vec4 readDirectStokesSample(ivec2 pixel) {
  return vec4(
    readSource0(pixel),
    readSource1(pixel),
    readSource2(pixel),
    readSource3(pixel)
  );
}

vec4 readRgbLuminanceStokesSample(ivec2 pixel) {
  return vec4(
    computeRec709Luminance(
      readSource0(pixel),
      readSource4(pixel),
      readSource8(pixel)
    ),
    computeRec709Luminance(
      readSource1(pixel),
      readSource5(pixel),
      readSource9(pixel)
    ),
    computeRec709Luminance(
      readSource2(pixel),
      readSource6(pixel),
      readSource10(pixel)
    ),
    computeRec709Luminance(
      readSource3(pixel),
      readSource7(pixel),
      readSource11(pixel)
    )
  );
}

StokesRgbDisplaySample readRgbStokesDisplaySample(ivec2 pixel) {
  vec4 stokesR = vec4(readSource0(pixel), readSource1(pixel), readSource2(pixel), readSource3(pixel));
  vec4 stokesG = vec4(readSource4(pixel), readSource5(pixel), readSource6(pixel), readSource7(pixel));
  vec4 stokesB = vec4(readSource8(pixel), readSource9(pixel), readSource10(pixel), readSource11(pixel));
  vec3 value = vec3(
    computeStokesDisplayValue(uStokesParameter, stokesR.x, stokesR.y, stokesR.z, stokesR.w),
    computeStokesDisplayValue(uStokesParameter, stokesG.x, stokesG.y, stokesG.z, stokesG.w),
    computeStokesDisplayValue(uStokesParameter, stokesB.x, stokesB.y, stokesB.z, stokesB.w)
  );
  return StokesRgbDisplaySample(value, hasInvalidStokesDisplayValues(stokesR, stokesG, stokesB, value));
}

vec4 readSpectralStokesRgbComponentSample(ivec2 pixel, int componentIndex) {
  vec3 s0 = readRgbSource0(pixel);
  vec3 s1 = readRgbSource1(pixel);
  vec3 s2 = readRgbSource2(pixel);
  vec3 s3 = readRgbSource3(pixel);
  if (componentIndex == 0) {
    return vec4(s0.r, s1.r, s2.r, s3.r);
  }
  if (componentIndex == 1) {
    return vec4(s0.g, s1.g, s2.g, s3.g);
  }
  return vec4(s0.b, s1.b, s2.b, s3.b);
}

vec4 readSpectralStokesRgbLuminanceSample(ivec2 pixel) {
  vec3 s0 = readRgbSource0(pixel);
  vec3 s1 = readRgbSource1(pixel);
  vec3 s2 = readRgbSource2(pixel);
  vec3 s3 = readRgbSource3(pixel);
  return vec4(
    computeRec709Luminance(s0.r, s0.g, s0.b),
    computeRec709Luminance(s1.r, s1.g, s1.b),
    computeRec709Luminance(s2.r, s2.g, s2.b),
    computeRec709Luminance(s3.r, s3.g, s3.b)
  );
}

StokesRgbDisplaySample readSpectralStokesRgbDisplaySample(ivec2 pixel) {
  vec4 stokesR = readSpectralStokesRgbComponentSample(pixel, 0);
  vec4 stokesG = readSpectralStokesRgbComponentSample(pixel, 1);
  vec4 stokesB = readSpectralStokesRgbComponentSample(pixel, 2);
  vec3 value = vec3(
    computeStokesDisplayValue(uStokesParameter, stokesR.x, stokesR.y, stokesR.z, stokesR.w),
    computeStokesDisplayValue(uStokesParameter, stokesG.x, stokesG.y, stokesG.z, stokesG.w),
    computeStokesDisplayValue(uStokesParameter, stokesB.x, stokesB.y, stokesB.z, stokesB.w)
  );
  return StokesRgbDisplaySample(value, hasInvalidStokesDisplayValues(stokesR, stokesG, stokesB, value));
}

DisplaySample createEmptySample() {
  return DisplaySample(vec3(0.0), 1.0, vec4(0.0), false);
}

DisplaySample readDisplaySample(ivec2 pixel) {
  if (uDisplayMode == DISPLAY_MODE_CHANNEL_RGB) {
    vec3 rgb = vec3(readSource0(pixel), readSource1(pixel), readSource2(pixel));
    float alpha = readSource3(pixel);
    return DisplaySample(
      sanitizeDisplayColor(rgb),
      uUseImageAlpha ? sanitizeAlphaValue(alpha) : 1.0,
      vec4(0.0),
      hasInvalidValue(rgb) || (uUseImageAlpha && !isFiniteValue(alpha))
    );
  }

  if (uDisplayMode == DISPLAY_MODE_CHANNEL_NORMAL_MAP) {
    vec3 normal = vec3(readSource0(pixel), readSource1(pixel), readSource2(pixel));
    float alpha = readSource3(pixel);
    return DisplaySample(
      mapNormalToDisplayColor(normal),
      uUseImageAlpha ? sanitizeAlphaValue(alpha) : 1.0,
      vec4(0.0),
      hasInvalidValue(normal) || (uUseImageAlpha && !isFiniteValue(alpha))
    );
  }

  if (uDisplayMode == DISPLAY_MODE_CHANNEL_MONO) {
    float value = readSource0(pixel);
    float alpha = readSource3(pixel);
    return DisplaySample(
      vec3(sanitizeDisplayValue(value)),
      uUseImageAlpha ? sanitizeAlphaValue(alpha) : 1.0,
      vec4(0.0),
      !isFiniteValue(value) || (uUseImageAlpha && !isFiniteValue(alpha))
    );
  }

  if (uDisplayMode == DISPLAY_MODE_SPECTRAL_RGB) {
    vec3 spectralRgb = texelFetch(uSourceTextures[0], pixel, 0).rgb;
    return DisplaySample(
      sanitizeDisplayColor(spectralRgb),
      1.0,
      vec4(0.0),
      hasInvalidValue(spectralRgb)
    );
  }

  if (uDisplayMode == DISPLAY_MODE_MUELLER_MATRIX) {
    vec4 mueller = texelFetch(uSourceTextures[0], pixel, 0);
    return DisplaySample(
      sanitizeDisplayColor(mueller.rgb),
      sanitizeAlphaValue(mueller.a),
      vec4(0.0),
      hasInvalidValue(mueller.rgb) || !isFiniteValue(mueller.a)
    );
  }

  if (uDisplayMode == DISPLAY_MODE_STOKES_DIRECT) {
    vec4 stokes = readDirectStokesSample(pixel);
    float value = computeStokesDisplayValue(uStokesParameter, stokes.x, stokes.y, stokes.z, stokes.w);
    return DisplaySample(vec3(value), 1.0, stokes, isInvalidStokesDisplayValue(stokes, value));
  }

  if (uDisplayMode == DISPLAY_MODE_STOKES_RGB) {
    StokesRgbDisplaySample stokesRgb = readRgbStokesDisplaySample(pixel);
    return DisplaySample(stokesRgb.value, 1.0, vec4(0.0), stokesRgb.invalidValue);
  }

  if (uDisplayMode == DISPLAY_MODE_STOKES_RGB_LUMINANCE) {
    vec4 stokes = readRgbLuminanceStokesSample(pixel);
    float value = computeStokesDisplayValue(uStokesParameter, stokes.x, stokes.y, stokes.z, stokes.w);
    return DisplaySample(vec3(value), 1.0, stokes, isInvalidStokesDisplayValue(stokes, value));
  }

  if (uDisplayMode == DISPLAY_MODE_STOKES_SPECTRAL_RGB) {
    StokesRgbDisplaySample stokesRgb = readSpectralStokesRgbDisplaySample(pixel);
    return DisplaySample(stokesRgb.value, 1.0, vec4(0.0), stokesRgb.invalidValue);
  }

  if (uDisplayMode == DISPLAY_MODE_STOKES_SPECTRAL_RGB_LUMINANCE) {
    vec4 stokes = readSpectralStokesRgbLuminanceSample(pixel);
    float value = computeStokesDisplayValue(uStokesParameter, stokes.x, stokes.y, stokes.z, stokes.w);
    return DisplaySample(vec3(value), 1.0, stokes, isInvalidStokesDisplayValue(stokes, value));
  }

  return createEmptySample();
}

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
    surfaceType = ENVIRONMENT_SURFACE_SPHERE;
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
    materialAlpha = 1.0;
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

vec3 sampleFilteredEnvironmentRadiance(vec2 uv, float lod) {
  // The source textures carry CPU-built float mip levels when linear float
  // filtering is available. Sampling those levels keeps deterministic
  // rough-lobe integration stable without blurring the panorama background.
  if (uDisplayMode == DISPLAY_MODE_CHANNEL_RGB) {
    return sanitizeDisplayColor(vec3(
      textureLod(uSourceTextures[0], uv, lod).r,
      textureLod(uSourceTextures[1], uv, lod).r,
      textureLod(uSourceTextures[2], uv, lod).r
    ));
  }
  if (uDisplayMode == DISPLAY_MODE_CHANNEL_MONO) {
    return vec3(sanitizeDisplayValue(textureLod(uSourceTextures[0], uv, lod).r));
  }
  if (uDisplayMode == DISPLAY_MODE_SPECTRAL_RGB) {
    return sanitizeDisplayColor(textureLod(uSourceTextures[0], uv, lod).rgb);
  }
  if (uDisplayMode == DISPLAY_MODE_MUELLER_MATRIX) {
    return sanitizeDisplayColor(textureLod(uSourceTextures[0], uv, lod).rgb);
  }

  return vec3(0.0);
}

bool supportsFilteredEnvironmentRadiance() {
  return uSourceTextureMipmapsAvailable && (
    uDisplayMode == DISPLAY_MODE_CHANNEL_RGB ||
    uDisplayMode == DISPLAY_MODE_CHANNEL_MONO ||
    uDisplayMode == DISPLAY_MODE_SPECTRAL_RGB ||
    uDisplayMode == DISPLAY_MODE_MUELLER_MATRIX
  );
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

vec3 sampleEnvironmentRadiance(vec3 direction, float lod) {
  vec3 ray = normalize(direction);
  ivec2 pixel = panoramaDirectionToPixel(ray);

  if (usesCubemapCrossProjection()) {
    // The level-zero path stays texel-exact for path tracing and panorama
    // display. A power-of-two face size guarantees every CPU-built mip level
    // down to one texel per face keeps atlas boundaries aligned.
    if (
      lod <= 0.0 ||
      !usesMipmappedCubemapCrossProjection() ||
      !supportsFilteredEnvironmentRadiance()
    ) {
      return readDisplaySample(pixel).linear;
    }

    ivec2 face;
    vec2 local;
    resolveCubemapFaceAndLocal(ray, face, local);
    float maximumMip = log2(max(uImageSize.x * 0.25, 1.0));
    float clampedLod = clamp(lod, 0.0, maximumMip);
    // Trilinear filtering reads floor(LOD) and ceil(LOD). Clamping for the
    // coarser level keeps both footprints inside this face with one lookup.
    float uvClampMip = ceil(clampedLod);
    return sampleFilteredEnvironmentRadiance(
      cubemapFaceSafeUvAtMip(face, local, uvClampMip),
      clampedLod
    );
  }

  if (!supportsFilteredEnvironmentRadiance()) {
    return readDisplaySample(pixel).linear;
  }

  return sampleFilteredEnvironmentRadiance(
    equirectangularDirectionToUv(ray),
    lod
  );
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

vec3 sampleRoughPlasticMicrofacetNormal(vec2 sampleValue, float alpha) {
  float u = min(sampleValue.x, 1.0 - 1.0e-6);
  float alphaSquared = alpha * alpha;
  float tangentThetaSquared = uEnvironmentSphereDistribution == MICROFACET_DISTRIBUTION_GGX
    ? alphaSquared * u / max(1.0 - u, 1.0e-6)
    : -alphaSquared * log(max(1.0 - u, 1.0e-6));
  float cosTheta = inversesqrt(1.0 + tangentThetaSquared);
  float sinTheta = sqrt(max(0.0, 1.0 - cosTheta * cosTheta));
  float phi = 2.0 * PI * sampleValue.y;
  return vec3(sinTheta * cos(phi), sinTheta * sin(phi), cosTheta);
}

float evaluateRoughPlasticMicrofacetDistribution(float normalDotMicrofacet, float alpha) {
  float cosThetaSquared = max(normalDotMicrofacet * normalDotMicrofacet, 1.0e-8);
  float tanThetaSquared = max(0.0, 1.0 - cosThetaSquared) / cosThetaSquared;
  float alphaSquared = alpha * alpha;
  float cosThetaFourth = cosThetaSquared * cosThetaSquared;

  if (uEnvironmentSphereDistribution == MICROFACET_DISTRIBUTION_GGX) {
    float denominator = alphaSquared + tanThetaSquared;
    return alphaSquared / max(PI * cosThetaFourth * denominator * denominator, 1.0e-8);
  }

  return exp(-tanThetaSquared / alphaSquared) /
    max(PI * alphaSquared * cosThetaFourth, 1.0e-8);
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

float evaluateRoughPlasticSmithG1(
  vec3 direction,
  vec3 microfacetNormal,
  vec3 surfaceNormal,
  float alpha
) {
  float cosTheta = dot(direction, surfaceNormal);
  if (cosTheta <= 0.0 || dot(direction, microfacetNormal) * cosTheta <= 0.0) {
    return 0.0;
  }

  float sinThetaSquared = max(0.0, 1.0 - cosTheta * cosTheta);
  float tanThetaAlphaSquared = alpha * alpha * sinThetaSquared /
    max(cosTheta * cosTheta, 1.0e-8);
  if (tanThetaAlphaSquared <= 1.0e-8) {
    return 1.0;
  }

  if (uEnvironmentSphereDistribution == MICROFACET_DISTRIBUTION_GGX) {
    return 2.0 / (1.0 + sqrt(1.0 + tanThetaAlphaSquared));
  }

  float a = inversesqrt(tanThetaAlphaSquared);
  if (a >= 1.6) {
    return 1.0;
  }
  float aSquared = a * a;
  return (3.535 * a + 2.181 * aSquared) /
    (1.0 + 2.276 * a + 2.577 * aSquared);
}

float approximateInternalDiffuseReflectance(float eta) {
  float clampedEta = max(eta, 1.0e-3);
  if (abs(clampedEta - 1.0) <= 1.0e-4) {
    return 0.0;
  }
  if (clampedEta < 1.0) {
    float inverseEta = 1.0 / clampedEta;
    float inverseEtaSquared = inverseEta * inverseEta;
    return clamp(
      -0.4399 + 0.7099 * inverseEta - 0.3319 * inverseEtaSquared +
      0.0636 * inverseEtaSquared * inverseEta,
      0.0,
      0.999
    );
  }

  float inverseEta = 1.0 / clampedEta;
  return clamp(
    -1.4399 * inverseEta * inverseEta + 0.7099 * inverseEta +
    0.6681 + 0.0636 * clampedEta,
    0.0,
    0.999
  );
}

vec3 evaluateEnvironmentRoughPlastic(
  vec3 normal,
  vec3 viewDirection,
  vec3 materialDiffuseReflectance,
  float materialAlpha
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

  vec3 specular = vec3(0.0);
  float roughReflectance = 0.0;
  for (int sampleIndex = 0; sampleIndex < ROUGH_PLASTIC_SPECULAR_SAMPLE_COUNT; sampleIndex += 1) {
    vec2 sampleValue = roughPlasticSample2D(
      sampleIndex,
      ROUGH_PLASTIC_SPECULAR_SAMPLE_COUNT,
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
      float(ROUGH_PLASTIC_SPECULAR_SAMPLE_COUNT),
      maximumEnvironmentLod
    );
    specular += sampleEnvironmentRadiance(wi, environmentLod) * sampleWeight;
    roughReflectance += sampleWeight;
  }
  specular /= float(ROUGH_PLASTIC_SPECULAR_SAMPLE_COUNT);
  roughReflectance = clamp(
    roughReflectance / float(ROUGH_PLASTIC_SPECULAR_SAMPLE_COUNT),
    0.0,
    1.0
  );

  vec3 transmittedIrradiance = vec3(0.0);
  for (int sampleIndex = 0; sampleIndex < ROUGH_PLASTIC_DIFFUSE_SAMPLE_COUNT; sampleIndex += 1) {
    vec2 sampleValue = roughPlasticSample2D(
      sampleIndex,
      ROUGH_PLASTIC_DIFFUSE_SAMPLE_COUNT,
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
      float(ROUGH_PLASTIC_DIFFUSE_SAMPLE_COUNT),
      maximumEnvironmentLod
    );
    transmittedIrradiance += sampleEnvironmentRadiance(wi, environmentLod) *
      externalTransmittance;
  }
  transmittedIrradiance /= float(ROUGH_PLASTIC_DIFFUSE_SAMPLE_COUNT);

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

vec3 samplePathTracingLambertDirection(
  vec3 normal,
  inout uint randomState
) {
  vec3 cameraForward;
  vec3 cameraRight;
  vec3 cameraDown;
  resolveEnvironmentOrbitBasis(cameraForward, cameraRight, cameraDown);
  vec3 tangent;
  vec3 bitangent;
  buildRoughPlasticFrame(normal, cameraRight, cameraDown, tangent, bitangent);
  return roughPlasticLocalToWorld(
    sampleCosineHemisphere(nextPathTracingRandom2(randomState)),
    normal,
    tangent,
    bitangent
  );
}

vec3 evaluatePathTracingSurfaceBsdf(
  int surfaceType,
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
  if (surfaceType == ENVIRONMENT_SURFACE_SPHERE) {
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

  samplingPdf = normalDotLight / PI;
  return max(albedo, vec3(0.0)) / PI;
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
  int surfaceType,
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
    surfaceType,
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

  for (int bounce = 0; bounce < PATH_TRACING_MAX_BOUNCES; bounce += 1) {
    vec3 position;
    vec3 normal;
    vec3 albedo;
    float ignoredVisibility;
    float materialAlpha;
    int surfaceType;
    if (!resolveEnvironmentScene(
      rayOrigin,
      rayDirection,
      position,
      normal,
      albedo,
      ignoredVisibility,
      materialAlpha,
      surfaceType
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
      surfaceType,
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
    if (surfaceType == ENVIRONMENT_SURFACE_SPHERE) {
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
    } else {
      nextDirection = samplePathTracingLambertDirection(normal, randomState);
      bounceWeight = max(albedo, vec3(0.0));
      nextBsdfPdf = max(dot(normal, nextDirection), 0.0) / PI;
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

void main() {
  vec2 pixelScale = max(uOutputPixelScale, vec2(1.0e-6));
  vec2 screen = uScreenOrigin + vec2(
    (gl_FragCoord.x - 0.5) / pixelScale.x,
    uOutputSize.y - (gl_FragCoord.y + 0.5) / pixelScale.y
  );
  bool pathTracing =
    uPanoramaDisplayMode == PANORAMA_DISPLAY_MODE_ENVIRONMENT_LIGHTING &&
    uPanoramaLightingMethod == PANORAMA_LIGHTING_METHOD_PATH_TRACING;

  if (uImageSize.x <= 0.0 || uImageSize.y <= 0.0) {
    if (pathTracing && uPathTracingPass == PATH_TRACING_PASS_ACCUMULATE) {
      vec4 previous = texelFetch(
        uPathTracingPreviousTexture,
        ivec2(gl_FragCoord.xy),
        0
      );
      outColor = mix(previous, vec4(0.0), clamp(uPathTracingBlendWeight, 0.0, 1.0));
    } else {
      outColor = backgroundColor(screen);
    }
    return;
  }

  uint randomState = initializePathTracingRandomState(
    ivec2(gl_FragCoord.xy),
    uPathTracingSampleIndex
  );
  vec2 pixelSample = pathTracing
    ? nextPathTracingRandom2(randomState)
    : vec2(0.5);
  vec2 samplePosition = screen + pixelSample / pixelScale;
  float projectionDiameter = max(panoramaProjectionDiameter(uViewport, uPanoramaHfovDeg), 1e-6);
  vec2 radial = (samplePosition - uViewport * 0.5) / (projectionDiameter * 0.5);
  float radius = length(radial);
  float theta = panoramaScreenRadiusToTheta(radius, uPanoramaHfovDeg);
  if (theta > PI * 0.5 + 1e-6) {
    if (pathTracing && uPathTracingPass == PATH_TRACING_PASS_ACCUMULATE) {
      vec4 previous = texelFetch(
        uPathTracingPreviousTexture,
        ivec2(gl_FragCoord.xy),
        0
      );
      outColor = mix(previous, vec4(0.0), clamp(uPathTracingBlendWeight, 0.0, 1.0));
    } else {
      outColor = backgroundColor(screen);
    }
    return;
  }

  vec2 direction = radius <= 1e-6 ? vec2(0.0) : radial / radius;
  vec3 cameraRay = vec3(direction * sin(theta), cos(theta));
  vec3 rayOrigin = vec3(0.0);
  vec3 ray = cameraRay;
  if (uPanoramaDisplayMode == PANORAMA_DISPLAY_MODE_ENVIRONMENT_LIGHTING) {
    resolveEnvironmentOrbitCamera(cameraRay, rayOrigin, ray);
  } else {
    ray = rotatePitch(ray, uPanoramaPitchDeg * DEG_TO_RAD);
    ray = rotateYaw(ray, uPanoramaYawDeg * DEG_TO_RAD);
  }

  if (pathTracing) {
    vec4 pathSample = vec4(traceEnvironmentPath(rayOrigin, ray, randomState), 1.0);
    if (uPathTracingPass == PATH_TRACING_PASS_ACCUMULATE) {
      vec4 previous = texelFetch(
        uPathTracingPreviousTexture,
        ivec2(gl_FragCoord.xy),
        0
      );
      outColor = mix(previous, pathSample, clamp(uPathTracingBlendWeight, 0.0, 1.0));
    } else {
      vec3 linear = pathSample.rgb * exp2(uExposure);
      vec3 color = sanitizeDisplayColor(linearToDisplayGamma(linear));
      outColor = encodeOutputColor(screen, color, pathSample.a);
    }
    return;
  }

  if (uPanoramaDisplayMode == PANORAMA_DISPLAY_MODE_ENVIRONMENT_LIGHTING) {
    vec3 scenePosition;
    vec3 sceneNormal;
    vec3 sceneAlbedo;
    float sceneVisibility;
    float sceneMaterialAlpha;
    int surfaceType;
    if (resolveEnvironmentScene(
      rayOrigin,
      ray,
      scenePosition,
      sceneNormal,
      sceneAlbedo,
      sceneVisibility,
      sceneMaterialAlpha,
      surfaceType
    )) {
      vec3 linear = surfaceType == ENVIRONMENT_SURFACE_SPHERE
        ? evaluateEnvironmentRoughPlastic(
            sceneNormal,
            rayOrigin - scenePosition,
            sceneAlbedo,
            sceneMaterialAlpha
          )
        : sceneAlbedo * evaluateEnvironmentIrradiance(sceneNormal) * (sceneVisibility / PI);
      linear *= exp2(uExposure);
      vec3 color = sanitizeDisplayColor(linearToDisplayGamma(linear));
      outColor = encodeOutputColor(screen, color, 1.0);
      return;
    }
  }

  ivec2 pixel = panoramaDirectionToPixel(ray);
  DisplaySample displaySample = readDisplaySample(pixel);
  vec3 linear = displaySample.linear;
  float imageAlpha = displaySample.alpha;

  if (uDisplayMode == DISPLAY_MODE_CHANNEL_NORMAL_MAP) {
    outColor = applyInvalidValueWarning(encodeOutputColor(screen, linear, imageAlpha), displaySample.invalidValue);
    return;
  }

  if (uUseColormap) {
    float luminance = computeRec709Luminance(linear.r, linear.g, linear.b);
    vec3 color = sampleColormap(luminance, uColormapMin, uColormapMax);
    if (uUseStokesDegreeModulation) {
      vec3 hsv = rgbToHsv(color);
      float modulationValue = computeStokesDegreeModulationValue(
        uStokesParameter,
        displaySample.stokes.x,
        displaySample.stokes.y,
        displaySample.stokes.z,
        displaySample.stokes.w
      );
      if (!isFiniteValue(modulationValue)) {
        displaySample.invalidValue = true;
      }
      float modulation = isFiniteValue(modulationValue) ? clamp(modulationValue, 0.0, 1.0) : 0.0;
      if (uStokesDegreeModulationMode == STOKES_DEGREE_MODULATION_MODE_SATURATION) {
        hsv.y *= modulation;
      } else {
        hsv.z *= modulation;
      }
      color = hsvToRgb(hsv);
    }
    outColor = applyInvalidValueWarning(encodeOutputColor(screen, color, imageAlpha), displaySample.invalidValue);
    return;
  }

  linear *= exp2(uExposure);
  vec3 color = sanitizeDisplayColor(linearToDisplayGamma(linear));
  outColor = applyInvalidValueWarning(encodeOutputColor(screen, color, imageAlpha), displaySample.invalidValue);
}
