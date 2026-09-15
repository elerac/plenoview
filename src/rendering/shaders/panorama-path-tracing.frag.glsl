uniform sampler2D uPathTracingPreviousS1Texture;
uniform sampler2D uPathTracingPreviousS2Texture;
uniform sampler2D uPathTracingPreviousS3Texture;
layout(location = 1) out vec4 outStokesS1;
layout(location = 2) out vec4 outStokesS2;
layout(location = 3) out vec4 outStokesS3;

void writePathSample(vec2 screen, PolarizedStokes sampleValue, float alpha) {
  vec4 s0 = vec4(sampleValue.s0, alpha);
  vec4 s1 = vec4(sampleValue.s1, alpha);
  vec4 s2 = vec4(sampleValue.s2, alpha);
  vec4 s3 = vec4(sampleValue.s3, alpha);
  if (uPathTracingPass == PATH_TRACING_PASS_ACCUMULATE) {
    ivec2 pixel = ivec2(gl_FragCoord.xy);
    float weight = clamp(uPathTracingBlendWeight, 0.0, 1.0);
    outColor = mix(texelFetch(uPathTracingPreviousTexture, pixel, 0), s0, weight);
    if (uEnvironmentPolarized) {
      outStokesS1 = mix(texelFetch(uPathTracingPreviousS1Texture, pixel, 0), s1, weight);
      outStokesS2 = mix(texelFetch(uPathTracingPreviousS2Texture, pixel, 0), s2, weight);
      outStokesS3 = mix(texelFetch(uPathTracingPreviousS3Texture, pixel, 0), s3, weight);
    } else {
      outStokesS1 = vec4(0); outStokesS2 = vec4(0); outStokesS3 = vec4(0);
    }
  } else {
    outStokesS1 = s1; outStokesS2 = s2; outStokesS3 = s3;
    if (alpha == 0.0) outColor = backgroundColor(screen);
    else if (uEnvironmentPolarized) outColor = encodePathTracingStokes(screen, sampleValue.s0, sampleValue.s1, sampleValue.s2, sampleValue.s3, alpha);
    else outColor = encodeOutputColor(screen, sanitizeDisplayColor(linearToDisplayGamma(sampleValue.s0 * exp2(uExposure))), alpha);
  }
}

void main() {
  vec2 pixelScale = max(uOutputPixelScale, vec2(1.0e-6));
  vec2 screen = uScreenOrigin + vec2(
    (gl_FragCoord.x - 0.5) / pixelScale.x,
    uOutputSize.y - (gl_FragCoord.y + 0.5) / pixelScale.y
  );
  if (uImageSize.x <= 0.0 || uImageSize.y <= 0.0) {
    writePathSample(screen, zeroStokes(), 0.0);
    return;
  }
  uint randomState = initializePathTracingRandomState(ivec2(gl_FragCoord.xy), uPathTracingSampleIndex);
  vec2 samplePosition = screen + nextPathTracingRandom2(randomState) / pixelScale;
  float projectionDiameter = max(panoramaProjectionDiameter(uViewport, uPanoramaHfovDeg), 1e-6);
  vec2 radial = (samplePosition - uViewport * 0.5) / (projectionDiameter * 0.5);
  float radius = length(radial);
  float theta = panoramaScreenRadiusToTheta(radius, uPanoramaHfovDeg);
  if (theta > PI * 0.5 + 1e-6) {
    writePathSample(screen, zeroStokes(), 0.0);
    return;
  }
  vec2 direction = radius <= 1e-6 ? vec2(0.0) : radial / radius;
  vec3 cameraRay = vec3(direction * sin(theta), cos(theta));
  vec3 rayOrigin = vec3(0.0), ray = cameraRay;
  resolveEnvironmentOrbitCamera(cameraRay, rayOrigin, ray);
  PolarizedStokes sampleValue = tracePolarizedEnvironmentPath(rayOrigin, ray, randomState);
  writePathSample(screen, sampleValue, 1.0);
}
