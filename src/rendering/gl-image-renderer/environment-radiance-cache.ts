import {
  buildPolarizedEnvironmentImportanceSampling,
  buildPolarizedEnvironmentPixels,
  polarizedEnvironmentSize,
  type PolarizedEnvironmentSource
} from './environment-polarization';

const ENVIRONMENT_RADIANCE_TEXTURE_UNIT = 15;
const CACHE_BUDGET_BYTES = 128 * 1024 * 1024;

export interface EnvironmentRadianceTexture {
  texture: WebGLTexture;
  mipmapsAvailable: boolean;
}

export interface PolarizedEnvironmentRadianceTexture extends EnvironmentRadianceTexture {
  textures: [WebGLTexture, WebGLTexture, WebGLTexture, WebGLTexture];
  width: number;
  height: number;
  importanceTexture: WebGLTexture;
  importanceTextureSize: { width: number; height: number };
  importanceGridSize: { width: number; height: number };
  importanceEntryCount: number;
}

interface CacheEntry extends EnvironmentRadianceTexture {
  width: number;
  height: number;
  bytes: number;
  polarized?: PolarizedEnvironmentRadianceTexture;
  sourceLayer?: PolarizedEnvironmentSource['layer'];
}

/** Linear HDR display selections, shared by the lighting programs. */
export class EnvironmentRadianceCache {
  private readonly entries = new Map<string, CacheEntry>();
  private readonly floatColorBufferSupported: boolean;
  private bytes = 0;
  private disposed = false;

  constructor(
    private readonly gl: WebGL2RenderingContext,
    private readonly smoothFloatMinification: boolean
  ) {
    this.floatColorBufferSupported = Boolean(gl.getExtension('EXT_color_buffer_float'));
  }

  getOrCreate(
    key: string,
    width: number,
    height: number,
    bake: () => void
  ): EnvironmentRadianceTexture {
    if (this.disposed) {
      throw new Error('The environment radiance cache has been disposed.');
    }
    if (!this.floatColorBufferSupported) {
      throw new Error('Environment lighting requires the WebGL EXT_color_buffer_float extension.');
    }
    const maxSize = this.gl.getParameter(this.gl.MAX_TEXTURE_SIZE) as number;
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 ||
      width > maxSize || height > maxSize) {
      throw new Error('Environment radiance dimensions exceed the supported texture size.');
    }

    const existing = this.entries.get(key);
    if (existing && existing.width === width && existing.height === height) {
      // Map iteration order is also the least-recently-used order.
      this.entries.delete(key);
      this.entries.set(key, existing);
      return existing;
    }
    if (existing) {
      this.deleteEntry(key, existing);
    }

    const bytes = textureBytes(width, height, this.smoothFloatMinification);
    // Evict before allocating to avoid briefly holding two large HDR selections.
    // A single image larger than the budget remains usable as the only entry.
    for (const [oldKey, entry] of this.entries) {
      if (this.bytes + bytes <= CACHE_BUDGET_BYTES) {
        break;
      }
      this.deleteEntry(oldKey, entry);
    }

    const entry = this.createEntry(width, height, bytes, bake);
    this.entries.set(key, entry);
    this.bytes += bytes;
    return entry;
  }

  /** Signed RGB Stokes inputs and the matching S0-only continuous PDF. */
  getOrCreatePolarized(key: string, source: PolarizedEnvironmentSource): PolarizedEnvironmentRadianceTexture {
    if (this.disposed) {
      throw new Error('The environment radiance cache has been disposed.');
    }
    const { width, height } = polarizedEnvironmentSize(source);
    const maxSize = this.gl.getParameter(this.gl.MAX_TEXTURE_SIZE) as number;
    if (width > maxSize || height > maxSize) {
      throw new RangeError('Polarized environment dimensions exceed the supported texture size.');
    }
    const existing = this.entries.get(key);
    if (existing?.polarized && existing.width === width && existing.height === height && existing.sourceLayer === source.layer) {
      this.entries.delete(key);
      this.entries.set(key, existing);
      return existing.polarized;
    }
    if (existing) {
      this.deleteEntry(key, existing);
    }
    const texelCount = width * (height - 1) * 2;
    // Even width keeps each two-texel alias/corner pair on the same row.
    const importanceWidth = Math.min(texelCount, maxSize - maxSize % 2);
    const importanceHeight = Math.ceil(texelCount / importanceWidth);
    if (importanceHeight > maxSize) {
      throw new RangeError('Polarized environment sampling table exceeds the supported texture size.');
    }
    const bytes = width * height * 64 + importanceWidth * importanceHeight * 16;
    for (const [oldKey, entry] of this.entries) {
      if (this.bytes + bytes <= CACHE_BUDGET_BYTES) {
        break;
      }
      this.deleteEntry(oldKey, entry);
    }

    const gl = this.gl;
    const previousActiveTexture = gl.getParameter(gl.ACTIVE_TEXTURE) as number;
    gl.activeTexture(gl.TEXTURE0 + ENVIRONMENT_RADIANCE_TEXTURE_UNIT);
    const previousTexture = gl.getParameter(gl.TEXTURE_BINDING_2D) as WebGLTexture | null;
    const allocated: WebGLTexture[] = [];
    try {
      const upload = (textureWidth: number, textureHeight: number, pixels: Float32Array): WebGLTexture => {
        const texture = gl.createTexture();
        if (!texture) {
          throw new Error('Failed to create a polarized environment texture.');
        }
        allocated.push(texture);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        // penvmap's latitude grid includes the poles; hardware filtering would
        // use a different grid. Its exact bilinear interpolation is in GLSL.
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, textureWidth, textureHeight, 0, gl.RGBA, gl.FLOAT, pixels);
        const uploadError = gl.getError();
        if (uploadError !== gl.NO_ERROR) {
          throw new Error(`Failed to upload a polarized environment texture (WebGL error 0x${uploadError.toString(16)}).`);
        }
        return texture;
      };
      const textures = [0, 1, 2, 3].map(component => upload(
        width, height, buildPolarizedEnvironmentPixels(source, component as 0 | 1 | 2 | 3)
      )) as PolarizedEnvironmentRadianceTexture['textures'];
      const table = buildPolarizedEnvironmentImportanceSampling(source);
      const importancePixels = importanceWidth * importanceHeight * 4 === table.rgba32f.length
        ? table.rgba32f
        : new Float32Array(importanceWidth * importanceHeight * 4);
      if (importancePixels !== table.rgba32f) {
        importancePixels.set(table.rgba32f);
      }
      const polarized: PolarizedEnvironmentRadianceTexture = {
        texture: textures[0], textures, width, height, mipmapsAvailable: false,
        importanceTexture: upload(importanceWidth, importanceHeight, importancePixels),
        importanceTextureSize: { width: importanceWidth, height: importanceHeight },
        importanceGridSize: { width: table.gridWidth, height: table.gridHeight },
        importanceEntryCount: table.entryCount
      };
      this.entries.set(key, { ...polarized, bytes, polarized, sourceLayer: source.layer });
      this.bytes += bytes;
      return polarized;
    } catch (error) {
      for (const texture of allocated) {
        gl.deleteTexture(texture);
      }
      throw error;
    } finally {
      gl.bindTexture(gl.TEXTURE_2D, previousTexture);
      gl.activeTexture(previousActiveTexture);
    }
  }

  deleteByPrefix(prefix: string): void {
    for (const [key, entry] of this.entries) {
      if (key.startsWith(prefix)) {
        this.deleteEntry(key, entry);
      }
    }
  }

  clear(): void {
    for (const [key, entry] of this.entries) {
      this.deleteEntry(key, entry);
    }
  }

  dispose(): void {
    this.clear();
    this.disposed = true;
  }

  private deleteEntry(key: string, entry: CacheEntry): void {
    this.entries.delete(key);
    this.bytes -= entry.bytes;
    for (const texture of entry.polarized
      ? [...entry.polarized.textures, entry.polarized.importanceTexture]
      : [entry.texture]) {
      this.gl.deleteTexture(texture);
    }
  }

  private createEntry(width: number, height: number, bytes: number, bake: () => void): CacheEntry {
    const gl = this.gl;
    const previousDrawFramebuffer = gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
    const previousReadFramebuffer = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
    const previousViewport = gl.getParameter(gl.VIEWPORT) as Int32Array;
    const previousScissorBox = gl.getParameter(gl.SCISSOR_BOX) as Int32Array;
    const scissorEnabled = gl.isEnabled(gl.SCISSOR_TEST);
    const previousActiveTexture = gl.getParameter(gl.ACTIVE_TEXTURE) as number;
    gl.activeTexture(gl.TEXTURE0 + ENVIRONMENT_RADIANCE_TEXTURE_UNIT);
    const previousTexture = gl.getParameter(gl.TEXTURE_BINDING_2D) as WebGLTexture | null;
    let texture: WebGLTexture | null = null;
    let framebuffer: WebGLFramebuffer | null = null;

    try {
      texture = gl.createTexture();
      if (!texture) {
        throw new Error('Failed to create the environment radiance texture.');
      }
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER,
        this.smoothFloatMinification ? gl.LINEAR_MIPMAP_LINEAR : gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER,
        this.smoothFloatMinification ? gl.LINEAR : gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, width, height, 0, gl.RGBA, gl.FLOAT, null);

      framebuffer = gl.createFramebuffer();
      if (!framebuffer) {
        throw new Error('Failed to create the environment radiance framebuffer.');
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
        throw new Error('The environment radiance floating-point framebuffer is incomplete.');
      }
      gl.viewport(0, 0, width, height);
      gl.disable(gl.SCISSOR_TEST);
      bake();
      if (this.smoothFloatMinification) {
        gl.activeTexture(gl.TEXTURE0 + ENVIRONMENT_RADIANCE_TEXTURE_UNIT);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.generateMipmap(gl.TEXTURE_2D);
      }

      return { texture, mipmapsAvailable: this.smoothFloatMinification, width, height, bytes };
    } catch (error) {
      if (texture) {
        gl.deleteTexture(texture);
      }
      throw error;
    } finally {
      if (framebuffer) {
        gl.deleteFramebuffer(framebuffer);
      }
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, previousDrawFramebuffer);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, previousReadFramebuffer);
      gl.viewport(previousViewport[0], previousViewport[1], previousViewport[2], previousViewport[3]);
      gl.scissor(previousScissorBox[0], previousScissorBox[1], previousScissorBox[2], previousScissorBox[3]);
      if (scissorEnabled) {
        gl.enable(gl.SCISSOR_TEST);
      } else {
        gl.disable(gl.SCISSOR_TEST);
      }
      gl.activeTexture(gl.TEXTURE0 + ENVIRONMENT_RADIANCE_TEXTURE_UNIT);
      gl.bindTexture(gl.TEXTURE_2D, previousTexture);
      gl.activeTexture(previousActiveTexture);
    }
  }
}

function textureBytes(width: number, height: number, mipmaps: boolean): number {
  let bytes = width * height * 16;
  while (mipmaps && (width > 1 || height > 1)) {
    width = Math.max(1, Math.floor(width / 2));
    height = Math.max(1, Math.floor(height / 2));
    bytes += width * height * 16;
  }
  return bytes;
}
