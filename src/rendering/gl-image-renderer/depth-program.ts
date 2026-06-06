import fragmentShaderSource from '../shaders/exr-image.frag.glsl?raw';
import vertexShaderSource from '../shaders/depth-cloud.vert.glsl?raw';
import type { DepthUniforms, ProgramBundle } from './types';
import {
  createProgram,
  getCommonUniforms,
  getRequiredUniformLocation
} from './program-utils';

export function createDepthProgram(gl: WebGL2RenderingContext): ProgramBundle<DepthUniforms> {
  const program = createProgram(gl, vertexShaderSource, createDepthFragmentShaderSource());
  return {
    program,
    uniforms: {
      ...getCommonUniforms(gl, program),
      depthOutputOrigin: getRequiredUniformLocation(gl, program, 'uDepthOutputOrigin'),
      depthSourceKind: getRequiredUniformLocation(gl, program, 'uDepthSourceKind'),
      depthFocalLengthPx: getRequiredUniformLocation(gl, program, 'uDepthFocalLengthPx'),
      depthYawDeg: getRequiredUniformLocation(gl, program, 'uDepthYawDeg'),
      depthPitchDeg: getRequiredUniformLocation(gl, program, 'uDepthPitchDeg'),
      depthZoom: getRequiredUniformLocation(gl, program, 'uDepthZoom'),
      depthTarget: getRequiredUniformLocation(gl, program, 'uDepthTarget'),
      depthPointSizePx: getRequiredUniformLocation(gl, program, 'uDepthPointSizePx'),
      depthGridSize: getRequiredUniformLocation(gl, program, 'uDepthGridSize'),
      depthSampleStep: getRequiredUniformLocation(gl, program, 'uDepthSampleStep'),
      depthRange: getRequiredUniformLocation(gl, program, 'uDepthRange'),
      depthCameraZRange: getRequiredUniformLocation(gl, program, 'uDepthCameraZRange'),
      depthPositionBoundsMin: getRequiredUniformLocation(gl, program, 'uDepthPositionBoundsMin'),
      depthPositionBoundsMax: getRequiredUniformLocation(gl, program, 'uDepthPositionBoundsMax')
    }
  };
}

function createDepthFragmentShaderSource(): string {
  const prefix = fragmentShaderSource.replace(/void main\(\) \{[\s\S]*$/, '');
  return `${prefix}
in vec2 vDepthPixel;
flat in int vDepthValid;

void main() {
  if (vDepthValid == 0) {
    discard;
  }

  vec2 pointCoord = gl_PointCoord * 2.0 - 1.0;
  if (dot(pointCoord, pointCoord) > 1.0) {
    discard;
  }

  vec2 screen = uScreenOrigin + vec2(gl_FragCoord.x - 0.5, uOutputSize.y - gl_FragCoord.y - 0.5);
  ivec2 pixel = ivec2(vDepthPixel);
  DisplaySample displaySample = readDisplaySample(pixel);
  vec3 linear = displaySample.linear;
  float imageAlpha = displaySample.alpha;

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
`;
}
