import fragmentSource from '../shaders/path-tracing-present.frag.glsl?raw';
import vertexSource from '../shaders/fullscreen-triangle.vert.glsl?raw';
import { PATH_TRACING_ACCUMULATION_TEXTURE_UNIT } from './constants';
import { createProgram, getRequiredUniformLocation } from './program-utils';
import type { PathTracingPresentUniforms, ProgramBundle } from './types';

export function createPathTracingPresentProgram(
  gl: WebGL2RenderingContext
): ProgramBundle<PathTracingPresentUniforms> {
  const program = createProgram(gl, vertexSource, fragmentSource);
  gl.useProgram(program);
  gl.uniform1i(
    getRequiredUniformLocation(gl, program, 'uAccumulationTexture'),
    PATH_TRACING_ACCUMULATION_TEXTURE_UNIT
  );
  return {
    program,
    uniforms: {
      outputOriginPx: getRequiredUniformLocation(gl, program, 'uOutputOriginPx'),
      outputSize: getRequiredUniformLocation(gl, program, 'uOutputSize'),
      outputPixelScale: getRequiredUniformLocation(gl, program, 'uOutputPixelScale'),
      viewportOrigin: getRequiredUniformLocation(gl, program, 'uViewportOrigin'),
      exposure: getRequiredUniformLocation(gl, program, 'uExposure'),
      displayGamma: getRequiredUniformLocation(gl, program, 'uDisplayGamma'),
      backgroundMode: getRequiredUniformLocation(gl, program, 'uBackgroundMode'),
      backgroundColor: getRequiredUniformLocation(gl, program, 'uBackgroundColor'),
      alphaOutputMode: getRequiredUniformLocation(gl, program, 'uAlphaOutputMode')
    }
  };
}
