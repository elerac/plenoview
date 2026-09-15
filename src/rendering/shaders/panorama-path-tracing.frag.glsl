void main() {
  vec2 pixelScale = max(uOutputPixelScale, vec2(1.0e-6));
  vec2 screen = uScreenOrigin + vec2(
    (gl_FragCoord.x - 0.5) / pixelScale.x,
    uOutputSize.y - (gl_FragCoord.y + 0.5) / pixelScale.y
  );

  if (uImageSize.x <= 0.0 || uImageSize.y <= 0.0) {
    if (uPathTracingPass == PATH_TRACING_PASS_ACCUMULATE) {
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
  vec2 pixelSample = nextPathTracingRandom2(randomState);
  vec2 samplePosition = screen + pixelSample / pixelScale;
  float projectionDiameter = max(panoramaProjectionDiameter(uViewport, uPanoramaHfovDeg), 1e-6);
  vec2 radial = (samplePosition - uViewport * 0.5) / (projectionDiameter * 0.5);
  float radius = length(radial);
  float theta = panoramaScreenRadiusToTheta(radius, uPanoramaHfovDeg);
  if (theta > PI * 0.5 + 1e-6) {
    if (uPathTracingPass == PATH_TRACING_PASS_ACCUMULATE) {
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
  resolveEnvironmentOrbitCamera(cameraRay, rayOrigin, ray);

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
}
