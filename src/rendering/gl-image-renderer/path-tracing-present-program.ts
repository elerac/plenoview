import mainSource from '../shaders/path-tracing-present.frag.glsl?raw';
import commonSource from '../shaders/panorama-common.glsl?raw';
import displaySource from '../shaders/display-colors.glsl?raw';
import pathTracingDisplaySource from '../shaders/path-tracing-display.glsl?raw';
import vertexSource from '../shaders/fullscreen-triangle.vert.glsl?raw';
import { COLORMAP_TEXTURE_UNIT, PATH_TRACING_ACCUMULATION_TEXTURE_UNIT, PATH_TRACING_STOKES_TEXTURE_UNITS } from './constants';
import { createProgram, getCommonUniforms, getRequiredUniformLocation } from './program-utils';
import type { PathTracingPresentUniforms, ProgramBundle } from './types';

export function createPathTracingPresentProgram(
  gl: WebGL2RenderingContext
): ProgramBundle<PathTracingPresentUniforms> {
  const program = createProgram(gl, vertexSource, ['#version 300 es', '#define PATH_TRACED_STOKES', commonSource, displaySource, pathTracingDisplaySource, mainSource].join('\n'));
  gl.useProgram(program);
  gl.uniform1i(
    getRequiredUniformLocation(gl, program, 'uAccumulationTexture'),
    PATH_TRACING_ACCUMULATION_TEXTURE_UNIT
  );
  gl.uniform1i(gl.getUniformLocation(program, 'uColormapTexture'), COLORMAP_TEXTURE_UNIT);
  for (let component = 1; component < 4; component += 1) {
    gl.uniform1i(gl.getUniformLocation(program, `uAccumulationS${component}Texture`), PATH_TRACING_STOKES_TEXTURE_UNITS[component]);
  }
  return {
    program,
    uniforms: {
      ...getCommonUniforms(gl, program, true),
      environmentPolarized: gl.getUniformLocation(program, 'uEnvironmentPolarized'),
      pathTracingOutputComponent: gl.getUniformLocation(program, 'uPathTracingOutputComponent'),
      pathTracingOutputColorChannel: gl.getUniformLocation(program, 'uPathTracingOutputColorChannel'),
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
