void main() {
  vec2 pixelScale = max(uOutputPixelScale, vec2(1.0e-6));
  vec2 screen = uScreenOrigin + vec2(
    (gl_FragCoord.x - 0.5) / pixelScale.x,
    uOutputSize.y - (gl_FragCoord.y + 0.5) / pixelScale.y
  );
  if (uImageSize.x <= 0.0 || uImageSize.y <= 0.0) {
    outColor = backgroundColor(screen);
    return;
  }

  vec2 pixelSample = vec2(0.5);
  vec2 samplePosition = screen + pixelSample / pixelScale;
  float projectionDiameter = max(panoramaProjectionDiameter(uViewport, uPanoramaHfovDeg), 1e-6);
  vec2 radial = (samplePosition - uViewport * 0.5) / (projectionDiameter * 0.5);
  float radius = length(radial);
  float theta = panoramaScreenRadiusToTheta(radius, uPanoramaHfovDeg);
  if (theta > PI * 0.5 + 1e-6) {
    outColor = backgroundColor(screen);
    return;
  }

  vec2 direction = radius <= 1e-6 ? vec2(0.0) : radial / radius;
  vec3 cameraRay = vec3(direction * sin(theta), cos(theta));
  vec3 ray = cameraRay;
  ray = rotatePitch(ray, uPanoramaPitchDeg * DEG_TO_RAD);
  ray = rotateYaw(ray, uPanoramaYawDeg * DEG_TO_RAD);

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
      modulation = pow(modulation, 1.0 / uStokesDegreeModulationGamma);
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
