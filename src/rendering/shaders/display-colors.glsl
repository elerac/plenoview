uniform sampler2D uColormapTexture;
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
const float REC709_LUMINANCE_WEIGHT_R = 0.2126;
const float REC709_LUMINANCE_WEIGHT_G = 0.7152;
const float REC709_LUMINANCE_WEIGHT_B = 0.0722;
const float COLORMAP_GAMMA_MIN = 0.2;
#ifdef PATH_TRACED_STOKES
// Basis rotations, Mueller products and RGBA32F averaging introduce rounding.
// Keep the original tighter validation for source-image inspection.
const float STOKES_VECTOR_VALIDITY_RTOL = 2.0e-6;
#else
const float STOKES_VECTOR_VALIDITY_RTOL = 1.0e-8;
#endif
const vec3 INVALID_VALUE_WARNING_COLOR = vec3(1.0, 0.0, 1.0);

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
