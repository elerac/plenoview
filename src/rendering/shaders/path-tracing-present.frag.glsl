#version 300 es
precision highp float;

uniform sampler2D uAccumulationTexture;
uniform ivec2 uOutputOriginPx;
uniform vec2 uOutputSize;
uniform vec2 uOutputPixelScale;
uniform vec2 uViewportOrigin;
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
const float DISPLAY_GAMMA_MIN = 0.01;

vec3 checker(vec2 screen) {
  vec2 anchoredScreen = screen + uViewportOrigin;
  float tile = mod(
    floor(anchoredScreen.x / 16.0) + floor(anchoredScreen.y / 16.0),
    2.0
  );
  return mix(vec3(0.09), vec3(0.12), tile);
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

void main() {
  ivec2 localPixel = ivec2(gl_FragCoord.xy) - uOutputOriginPx;
  vec4 accumulated = texelFetch(uAccumulationTexture, localPixel, 0);
  float alpha = clamp(accumulated.a, 0.0, 1.0);
  vec3 linear = alpha > 1.0e-6
    ? max(accumulated.rgb / alpha, vec3(0.0))
    : vec3(0.0);
  linear *= exp2(uExposure);
  float gamma = max(uDisplayGamma, DISPLAY_GAMMA_MIN);
  vec3 color = pow(linear, vec3(1.0 / gamma));
  vec2 pixelScale = max(uOutputPixelScale, vec2(1.0e-6));
  vec2 localPhysical = vec2(localPixel) + vec2(0.5);
  vec2 screen = vec2(
    localPhysical.x / pixelScale.x,
    uOutputSize.y - localPhysical.y / pixelScale.y
  );
  outColor = encodeOutputColor(screen, color, alpha);
}
