uniform sampler2D uSourceTextures[12];

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
