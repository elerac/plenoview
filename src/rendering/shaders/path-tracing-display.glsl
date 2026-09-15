// Compute derived polarization only after averaging Stokes samples.
// Averaging per-sample DoLP/AoLP would produce a biased result.
uniform int uPathTracingOutputComponent;
uniform int uPathTracingOutputColorChannel;

vec4 encodePathTracingStokes(
  vec2 screen, vec3 s0, vec3 s1, vec3 s2, vec3 s3, float alpha
) {
  vec4 red = vec4(s0.r, s1.r, s2.r, s3.r);
  vec4 green = vec4(s0.g, s1.g, s2.g, s3.g);
  vec4 blue = vec4(s0.b, s1.b, s2.b, s3.b);
  vec4 scalar = red * REC709_LUMINANCE_WEIGHT_R +
    green * REC709_LUMINANCE_WEIGHT_G + blue * REC709_LUMINANCE_WEIGHT_B;
  if (uPathTracingOutputColorChannel == 0) scalar = red;
  if (uPathTracingOutputColorChannel == 1) scalar = green;
  if (uPathTracingOutputColorChannel == 2) scalar = blue;

  vec3 linear = s0;
  if (uPathTracingOutputComponent == 1) linear = s1;
  if (uPathTracingOutputComponent == 2) linear = s2;
  if (uPathTracingOutputComponent == 3) linear = s3;
  bool invalid = hasInvalidValue(linear);
  if (uStokesParameter >= 0) {
    if (uUseColormap || uPathTracingOutputColorChannel >= 0) {
      linear = vec3(computeStokesDisplayValue(uStokesParameter, scalar.x, scalar.y, scalar.z, scalar.w));
      invalid = isInvalidStokesDisplayValue(scalar, linear.r);
    } else {
      linear = vec3(
        computeStokesDisplayValue(uStokesParameter, red.x, red.y, red.z, red.w),
        computeStokesDisplayValue(uStokesParameter, green.x, green.y, green.z, green.w),
        computeStokesDisplayValue(uStokesParameter, blue.x, blue.y, blue.z, blue.w)
      );
      invalid = hasInvalidStokesDisplayValues(red, green, blue, linear);
    }
  } else if (uPathTracingOutputColorChannel >= 0) {
    linear = vec3(linear[uPathTracingOutputColorChannel]);
  }

  vec3 color;
  if (uUseColormap) {
    color = sampleColormap(computeRec709Luminance(linear.r, linear.g, linear.b), uColormapMin, uColormapMax);
    if (uUseStokesDegreeModulation && uStokesParameter >= 0) {
      vec3 hsv = rgbToHsv(color);
      float degree = computeStokesDegreeModulationDisplayValue(uStokesParameter, scalar.x, scalar.y, scalar.z, scalar.w);
      if (uStokesDegreeModulationMode == STOKES_DEGREE_MODULATION_MODE_SATURATION) hsv.y *= degree;
      else hsv.z *= degree;
      color = hsvToRgb(hsv);
    }
  } else {
    color = sanitizeDisplayColor(linearToDisplayGamma(linear * exp2(uExposure)));
  }
  return applyInvalidValueWarning(encodeOutputColor(screen, color, alpha), invalid);
}
