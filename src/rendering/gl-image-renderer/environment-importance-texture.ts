import type { EnvironmentImportanceSamplingTable } from '../../panorama-lighting';
import { PATH_TRACING_ENVIRONMENT_TABLE_TEXTURE_UNIT } from './constants';
import type { GlImageRendererState } from './types';

const EMPTY_IMPORTANCE_TABLE = new Float32Array([1, 0, 1, 0]);

export function createEnvironmentImportanceTexture(
  gl: WebGL2RenderingContext
): WebGLTexture {
  const texture = gl.createTexture();
  if (!texture) {
    throw new Error('Failed to create environment importance texture.');
  }
  gl.activeTexture(gl.TEXTURE0 + PATH_TRACING_ENVIRONMENT_TABLE_TEXTURE_UNIT);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA32F,
    1,
    1,
    0,
    gl.RGBA,
    gl.FLOAT,
    EMPTY_IMPORTANCE_TABLE
  );
  return texture;
}

export function setEnvironmentImportanceTexture(
  state: GlImageRendererState,
  table: EnvironmentImportanceSamplingTable
): void {
  const gl = state.gl;
  const maxTextureSize = Math.max(1, gl.getParameter(gl.MAX_TEXTURE_SIZE) as number);
  const textureWidth = Math.max(1, Math.min(table.entryCount, maxTextureSize));
  const textureHeight = Math.max(1, Math.ceil(table.entryCount / textureWidth));
  const upload = textureWidth * textureHeight * 4 === table.rgba32f.length
    ? table.rgba32f
    : padImportanceTable(table.rgba32f, textureWidth * textureHeight * 4);

  gl.activeTexture(gl.TEXTURE0 + PATH_TRACING_ENVIRONMENT_TABLE_TEXTURE_UNIT);
  gl.bindTexture(gl.TEXTURE_2D, state.environmentImportanceTexture);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA32F,
    textureWidth,
    textureHeight,
    0,
    gl.RGBA,
    gl.FLOAT,
    upload
  );
  state.environmentImportanceTextureSize = {
    width: textureWidth,
    height: textureHeight
  };
  state.environmentImportanceGridSize = {
    width: table.gridWidth,
    height: table.gridHeight
  };
  state.environmentImportanceEntryCount = table.entryCount;
  state.environmentImportanceProjection = table.projection === 'cubemap-cross' ? 1 : 0;
}

export function clearEnvironmentImportanceTextureState(
  state: GlImageRendererState
): void {
  state.environmentImportanceTextureSize = { width: 1, height: 1 };
  state.environmentImportanceGridSize = { width: 1, height: 1 };
  state.environmentImportanceEntryCount = 0;
  state.environmentImportanceProjection = 0;
}

function padImportanceTable(source: Float32Array, length: number): Float32Array {
  const padded = new Float32Array(length);
  padded.set(source.subarray(0, length));
  return padded;
}
