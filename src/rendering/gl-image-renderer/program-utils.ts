import { DISPLAY_SOURCE_SLOT_COUNT } from '../../display/bindings';
import {
  COLORMAP_TEXTURE_UNIT,
  DEPTH_TEXTURE_UNIT,
  DEPTH_POSITION_Y_TEXTURE_UNIT,
  DEPTH_POSITION_Z_TEXTURE_UNIT
} from './constants';
import type { CommonUniforms } from './types';

export function getRequiredUniformLocation(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  name: string
): WebGLUniformLocation {
  const location = gl.getUniformLocation(program, name);
  if (!location) {
    throw new Error('Failed to resolve shader uniforms.');
  }
  return location;
}

export function getCommonUniforms(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  specialized = false
): CommonUniforms {
  // Specialized programs deliberately omit unused display/output uniforms.
  const location = specialized
    ? (_gl: WebGL2RenderingContext, _program: WebGLProgram, name: string) => gl.getUniformLocation(program, name)
    : getRequiredUniformLocation;
  return {
    viewport: location(gl, program, 'uViewport'),
    viewportOrigin: location(gl, program, 'uViewportOrigin'),
    outputSize: location(gl, program, 'uOutputSize'),
    outputPixelScale: location(gl, program, 'uOutputPixelScale'),
    screenOrigin: location(gl, program, 'uScreenOrigin'),
    imageSize: location(gl, program, 'uImageSize'),
    exposure: location(gl, program, 'uExposure'),
    displayGamma: location(gl, program, 'uDisplayGamma'),
    useColormap: location(gl, program, 'uUseColormap'),
    colormapExposure: location(gl, program, 'uColormapExposure'),
    colormapGamma: location(gl, program, 'uColormapGamma'),
    colormapZeroCentered: location(gl, program, 'uColormapZeroCentered'),
    colormapReversed: location(gl, program, 'uColormapReversed'),
    colormapMin: location(gl, program, 'uColormapMin'),
    colormapMax: location(gl, program, 'uColormapMax'),
    colormapTextureSize: location(gl, program, 'uColormapTextureSize'),
    colormapEntryCount: location(gl, program, 'uColormapEntryCount'),
    displayMode: location(gl, program, 'uDisplayMode'),
    stokesParameter: location(gl, program, 'uStokesParameter'),
    maskInvalidStokesVectors: location(gl, program, 'uMaskInvalidStokesVectors'),
    warnInvalidValues: location(gl, program, 'uWarnInvalidValues'),
    invalidValueWarningPhase: location(gl, program, 'uInvalidValueWarningPhase'),
    useStokesDegreeModulation: location(gl, program, 'uUseStokesDegreeModulation'),
    stokesDegreeModulationMode: location(gl, program, 'uStokesDegreeModulationMode'),
    useImageAlpha: location(gl, program, 'uUseImageAlpha'),
    backgroundMode: location(gl, program, 'uBackgroundMode'),
    backgroundColor: location(gl, program, 'uBackgroundColor'),
    alphaOutputMode: location(gl, program, 'uAlphaOutputMode')
  };
}

export function configureProgramSamplers(gl: WebGL2RenderingContext, program: WebGLProgram): void {
  gl.useProgram(program);
  gl.uniform1iv(
    getRequiredUniformLocation(gl, program, 'uSourceTextures[0]'),
    Int32Array.from({ length: DISPLAY_SOURCE_SLOT_COUNT }, (_, index) => index)
  );
  gl.uniform1i(
    getRequiredUniformLocation(gl, program, 'uColormapTexture'),
    COLORMAP_TEXTURE_UNIT
  );
}

export function configureDepthProgramSamplers(gl: WebGL2RenderingContext, program: WebGLProgram): void {
  configureProgramSamplers(gl, program);
  gl.uniform1i(
    getRequiredUniformLocation(gl, program, 'uDepthTexture'),
    DEPTH_TEXTURE_UNIT
  );
  gl.uniform1i(
    getRequiredUniformLocation(gl, program, 'uDepthPositionYTexture'),
    DEPTH_POSITION_Y_TEXTURE_UNIT
  );
  gl.uniform1i(
    getRequiredUniformLocation(gl, program, 'uDepthPositionZTexture'),
    DEPTH_POSITION_Z_TEXTURE_UNIT
  );
}

export function createProgram(
  gl: WebGL2RenderingContext,
  vertexShaderSource: string,
  fragmentShaderSource: string
): WebGLProgram {
  const vertexShader = compileShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
  const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource);

  const program = gl.createProgram();
  if (!program) {
    throw new Error('Unable to create shader program.');
  }

  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) ?? 'Unknown shader link error.';
    gl.deleteProgram(program);
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    throw new Error(`Shader link failed: ${log}`);
  }

  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);
  return program;
}

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) {
    throw new Error('Unable to create shader object.');
  }

  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? 'Unknown shader compile error.';
    gl.deleteShader(shader);
    throw new Error(`Shader compile failed: ${log}`);
  }

  return shader;
}
