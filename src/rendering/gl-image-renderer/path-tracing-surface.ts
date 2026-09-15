import { PATH_TRACING_ACCUMULATION_TEXTURE_UNIT } from './constants';
import type {
  GlImageRendererState,
  PathTracingAccumulationSurface
} from './types';

export function getOrCreatePathTracingSurface(
  state: GlImageRendererState,
  key: string,
  width: number,
  height: number,
  signature: string,
  polarized = false
): PathTracingAccumulationSurface {
  const existing = state.pathTracingSurfaces.get(key);
  if (existing && existing.width === width && existing.height === height && existing.polarized === polarized) {
    if (existing.signature !== signature) {
      resetPathTracingSurface(state.gl, existing, signature);
    }
    return existing;
  }

  if (existing) {
    deletePathTracingSurface(state.gl, existing);
  }
  const created = createPathTracingSurface(state.gl, width, height, signature, polarized);
  state.pathTracingSurfaces.set(key, created);
  return created;
}

export function clearPathTracingSurfaces(state: GlImageRendererState): void {
  for (const surface of state.pathTracingSurfaces.values()) {
    deletePathTracingSurface(state.gl, surface);
  }
  state.pathTracingSurfaces.clear();
}

export function deletePathTracingSurfaceByKey(state: GlImageRendererState, key: string): void {
  const surface = state.pathTracingSurfaces.get(key);
  if (!surface) return;
  deletePathTracingSurface(state.gl, surface);
  state.pathTracingSurfaces.delete(key);
}

export function prunePathTracingSurfaces(
  state: GlImageRendererState,
  validKeys: ReadonlySet<string>
): void {
  for (const [key, surface] of state.pathTracingSurfaces) {
    if (!validKeys.has(key)) {
      deletePathTracingSurface(state.gl, surface);
      state.pathTracingSurfaces.delete(key);
    }
  }
}

function createPathTracingSurface(
  gl: WebGL2RenderingContext,
  width: number,
  height: number,
  signature: string,
  polarized: boolean
): PathTracingAccumulationSurface {
  const textures: WebGLTexture[] = [];
  const framebuffers: WebGLFramebuffer[] = [];
  const stokesTextures: WebGLTexture[][] = [[], []];
  gl.activeTexture(gl.TEXTURE0 + PATH_TRACING_ACCUMULATION_TEXTURE_UNIT);

  try {
    for (let index = 0; index < 2; index += 1) {
      const framebuffer = gl.createFramebuffer();
      if (!framebuffer) throw new Error('Failed to create path-tracing accumulation framebuffer.');
      framebuffers.push(framebuffer);
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      const attachments: number[] = [];
      for (let component = 0; component < (polarized ? 4 : 1); component += 1) {
        const texture = gl.createTexture();
        if (!texture) {
          throw new Error('Failed to create path-tracing accumulation texture.');
        }
        textures.push(texture);
        stokesTextures[index].push(texture);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          gl.RGBA32F,
          width,
          height,
          0,
          gl.RGBA,
          gl.FLOAT,
          null
        );

        gl.framebufferTexture2D(
          gl.FRAMEBUFFER,
          gl.COLOR_ATTACHMENT0 + component,
          gl.TEXTURE_2D,
          texture,
          0
        );
        attachments.push(gl.COLOR_ATTACHMENT0 + component);
      }
      if (polarized) gl.drawBuffers(attachments);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
        throw new Error('Path-tracing floating-point framebuffer is incomplete.');
      }
    }
  } catch (error) {
    for (const framebuffer of framebuffers) {
      gl.deleteFramebuffer(framebuffer);
    }
    for (const texture of textures) {
      gl.deleteTexture(texture);
    }
    throw error;
  }

  const surface: PathTracingAccumulationSurface = {
    framebuffers: [framebuffers[0], framebuffers[1]],
    textures: [stokesTextures[0][0], stokesTextures[1][0]],
    stokesTextures: [stokesTextures[0], stokesTextures[1]],
    polarized,
    width,
    height,
    readIndex: 0,
    sampleCount: 0,
    signature
  };
  clearSurfaceTextures(gl, surface);
  return surface;
}

function resetPathTracingSurface(
  gl: WebGL2RenderingContext,
  surface: PathTracingAccumulationSurface,
  signature: string
): void {
  surface.readIndex = 0;
  surface.sampleCount = 0;
  surface.signature = signature;
  clearSurfaceTextures(gl, surface);
}

function clearSurfaceTextures(
  gl: WebGL2RenderingContext,
  surface: PathTracingAccumulationSurface
): void {
  gl.disable(gl.SCISSOR_TEST);
  gl.clearColor(0, 0, 0, 0);
  for (const framebuffer of surface.framebuffers) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.viewport(0, 0, surface.width, surface.height);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }
}

function deletePathTracingSurface(
  gl: WebGL2RenderingContext,
  surface: PathTracingAccumulationSurface
): void {
  for (const framebuffer of surface.framebuffers) {
    gl.deleteFramebuffer(framebuffer);
  }
  for (const textures of surface.stokesTextures) {
    for (const texture of textures) gl.deleteTexture(texture);
  }
}
