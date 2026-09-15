uniform sampler2D uAccumulationTexture;
uniform sampler2D uAccumulationS1Texture;
uniform sampler2D uAccumulationS2Texture;
uniform sampler2D uAccumulationS3Texture;
uniform bool uEnvironmentPolarized;
uniform ivec2 uOutputOriginPx;

void main() {
  ivec2 localPixel = ivec2(gl_FragCoord.xy) - uOutputOriginPx;
  vec4 accumulated = texelFetch(uAccumulationTexture, localPixel, 0);
  float alpha = clamp(accumulated.a, 0.0, 1.0);
  float inverseAlpha = alpha > 1.0e-6 ? 1.0 / alpha : 0.0;
  vec3 s0 = accumulated.rgb * inverseAlpha;
  vec2 pixelScale = max(uOutputPixelScale, vec2(1.0e-6));
  vec2 localPhysical = vec2(localPixel) + vec2(0.5);
  vec2 screen = vec2(localPhysical.x / pixelScale.x, uOutputSize.y - localPhysical.y / pixelScale.y);
  if (uEnvironmentPolarized) {
    vec3 s1 = texelFetch(uAccumulationS1Texture, localPixel, 0).rgb * inverseAlpha;
    vec3 s2 = texelFetch(uAccumulationS2Texture, localPixel, 0).rgb * inverseAlpha;
    vec3 s3 = texelFetch(uAccumulationS3Texture, localPixel, 0).rgb * inverseAlpha;
    outColor = encodePathTracingStokes(screen, s0, s1, s2, s3, alpha);
  } else {
    outColor = encodeOutputColor(screen, linearToDisplayGamma(max(s0, vec3(0.0)) * exp2(uExposure)), alpha);
  }
}
