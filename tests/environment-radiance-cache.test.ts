import { describe, expect, it, vi } from 'vitest';
import { EnvironmentRadianceCache } from '../src/rendering/gl-image-renderer/environment-radiance-cache';

describe('environment radiance cache', () => {
  it('bakes each source revision once and rebakes changed dimensions', () => {
    const { cache, gl } = createHarness();
    const bake = vi.fn();
    const first = cache.getOrCreate('session:0:rgb:1', 8, 4, bake);

    expect(cache.getOrCreate('session:0:rgb:1', 8, 4, bake)).toBe(first);
    expect(bake).toHaveBeenCalledTimes(1);
    const revision = cache.getOrCreate('session:0:rgb:2', 8, 4, bake);
    expect(revision.texture).not.toBe(first.texture);
    const resized = cache.getOrCreate('session:0:rgb:2', 16, 8, bake);
    expect(resized.texture).not.toBe(revision.texture);
    expect(gl.deleteTexture).toHaveBeenCalledWith(revision.texture);
    expect(bake).toHaveBeenCalledTimes(3);
    expect(gl.texImage2D).toHaveBeenLastCalledWith(
      gl.TEXTURE_2D, 0, gl.RGBA32F, 16, 8, 0, gl.RGBA, gl.FLOAT, null
    );
  });

  it('invalidates a session or layer prefix and disposes all remaining textures once', () => {
    const { cache, gl } = createHarness();
    const bake = vi.fn();
    const a = cache.getOrCreate('session-a:0:1', 8, 4, bake);
    const b = cache.getOrCreate('session-a:1:1', 8, 4, bake);
    const c = cache.getOrCreate('session-b:0:1', 8, 4, bake);

    cache.deleteByPrefix('session-a:0:');
    expect(gl.deleteTexture).toHaveBeenCalledTimes(1);
    expect(gl.deleteTexture).toHaveBeenCalledWith(a.texture);
    cache.deleteByPrefix('session-a:');
    expect(gl.deleteTexture).toHaveBeenLastCalledWith(b.texture);
    expect(cache.getOrCreate('session-b:0:1', 8, 4, bake)).toBe(c);
    cache.dispose();
    cache.dispose();
    expect(gl.deleteTexture).toHaveBeenCalledTimes(3);
    expect(gl.deleteTexture).toHaveBeenLastCalledWith(c.texture);
    expect(() => cache.getOrCreate('new', 8, 4, bake)).toThrow('disposed');
  });

  it('can clear without disposing the cache', () => {
    const { cache, gl } = createHarness();
    const bake = vi.fn();
    const first = cache.getOrCreate('source', 8, 4, bake);
    cache.clear();
    expect(gl.deleteTexture).toHaveBeenCalledWith(first.texture);
    expect(cache.getOrCreate('source', 8, 4, bake).texture).not.toBe(first.texture);
  });

  it('evicts the least recently used selection before exceeding the budget', () => {
    const { cache, gl } = createHarness({ smooth: false });
    const bake = vi.fn();
    // Each RGBA32F texture occupies 64 MiB without mipmaps.
    const a = cache.getOrCreate('a', 2048, 2048, bake);
    const b = cache.getOrCreate('b', 2048, 2048, bake);
    cache.getOrCreate('a', 2048, 2048, bake);
    cache.getOrCreate('c', 2048, 2048, bake);

    expect(gl.deleteTexture).toHaveBeenCalledTimes(1);
    expect(gl.deleteTexture).toHaveBeenCalledWith(b.texture);
    expect(cache.getOrCreate('a', 2048, 2048, bake)).toBe(a);
    expect(bake).toHaveBeenCalledTimes(3);
  });

  it('counts mipmap memory and retains one oversized image', () => {
    const { cache, gl } = createHarness();
    const bake = vi.fn();
    const a = cache.getOrCreate('a', 2048, 2048, bake);
    const b = cache.getOrCreate('b', 2048, 2048, bake);
    // The two base levels alone fit, but both complete mip chains do not.
    expect(gl.deleteTexture).toHaveBeenCalledTimes(1);
    expect(gl.deleteTexture).toHaveBeenCalledWith(a.texture);
    const large = cache.getOrCreate('large', 4096, 4096, bake);
    expect(gl.deleteTexture).toHaveBeenLastCalledWith(b.texture);
    expect(cache.getOrCreate('large', 4096, 4096, bake)).toBe(large);
    cache.getOrCreate('small', 8, 4, bake);
    expect(gl.deleteTexture).toHaveBeenLastCalledWith(large.texture);
  });

  it('bakes the entire source on a separate texture unit and restores render state', () => {
    const { cache, gl, state } = createHarness();
    const before = snapshot(state);
    cache.getOrCreate('source', 8, 4, () => {
      expect(state.viewport).toEqual([0, 0, 8, 4]);
      expect(state.scissorEnabled).toBe(false);
      expect(state.drawFramebuffer).not.toBe(before.drawFramebuffer);
      expect(state.readFramebuffer).toBe(state.drawFramebuffer);
      expect(state.textures.get(gl.TEXTURE0)).toBe(before.textures.get(gl.TEXTURE0));
      expect(state.activeTexture).toBe(gl.TEXTURE0 + 15);
      gl.activeTexture(gl.TEXTURE0 + 2);
      gl.viewport(1, 2, 3, 4);
      gl.scissor(5, 6, 7, 8);
    });

    expect(snapshot(state)).toEqual(before);
    expect(gl.deleteFramebuffer).toHaveBeenCalledTimes(1);
    expect(gl.generateMipmap).toHaveBeenCalledTimes(1);
    expect(gl.generateMipmap).toHaveBeenCalledWith(gl.TEXTURE_2D);
  });

  it('restores disabled scissor testing too', () => {
    const { cache, gl, state } = createHarness();
    state.scissorEnabled = false;
    const before = snapshot(state);
    cache.getOrCreate('source', 8, 4, () => gl.enable(gl.SCISSOR_TEST));
    expect(snapshot(state)).toEqual(before);
  });

  it('uses HDR mipmaps when supported and nearest sampling otherwise', () => {
    const smooth = createHarness();
    expect(smooth.cache.getOrCreate('source', 8, 4, vi.fn()).mipmapsAvailable).toBe(true);
    expect(smooth.gl.texParameteri).toHaveBeenCalledWith(
      smooth.gl.TEXTURE_2D, smooth.gl.TEXTURE_MIN_FILTER, smooth.gl.LINEAR_MIPMAP_LINEAR
    );
    expect(smooth.gl.texParameteri).toHaveBeenCalledWith(
      smooth.gl.TEXTURE_2D, smooth.gl.TEXTURE_WRAP_S, smooth.gl.REPEAT
    );
    expect(smooth.gl.texParameteri).toHaveBeenCalledWith(
      smooth.gl.TEXTURE_2D, smooth.gl.TEXTURE_WRAP_T, smooth.gl.CLAMP_TO_EDGE
    );

    const nearest = createHarness({ smooth: false });
    expect(nearest.cache.getOrCreate('source', 8, 4, vi.fn()).mipmapsAvailable).toBe(false);
    expect(nearest.gl.generateMipmap).not.toHaveBeenCalled();
    expect(nearest.gl.texParameteri).toHaveBeenCalledWith(
      nearest.gl.TEXTURE_2D, nearest.gl.TEXTURE_MIN_FILTER, nearest.gl.NEAREST
    );
    expect(nearest.gl.texParameteri).toHaveBeenCalledWith(
      nearest.gl.TEXTURE_2D, nearest.gl.TEXTURE_MAG_FILTER, nearest.gl.NEAREST
    );
  });

  it('reports unsupported float rendering only when lighting needs a texture', () => {
    const { cache, gl } = createHarness({ floatColorBuffer: false });
    expect(() => cache.getOrCreate('source', 8, 4, vi.fn())).toThrow('EXT_color_buffer_float');
    expect(gl.createTexture).not.toHaveBeenCalled();
  });

  it('cleans up incomplete framebuffers and restores state before allowing a retry', () => {
    const { cache, gl, state } = createHarness();
    const before = snapshot(state);
    const bake = vi.fn();
    gl.checkFramebufferStatus.mockReturnValueOnce(0);
    expect(() => cache.getOrCreate('source', 8, 4, bake)).toThrow('framebuffer is incomplete');
    expect(bake).not.toHaveBeenCalled();
    expect(gl.deleteTexture).toHaveBeenCalledTimes(1);
    expect(gl.deleteFramebuffer).toHaveBeenCalledTimes(1);
    expect(snapshot(state)).toEqual(before);
    cache.getOrCreate('source', 8, 4, bake);
    expect(bake).toHaveBeenCalledTimes(1);
  });

  it('cleans up a failed bake and restores state', () => {
    const { cache, gl, state } = createHarness();
    const before = snapshot(state);
    expect(() => cache.getOrCreate('source', 8, 4, () => {
      gl.activeTexture(gl.TEXTURE0 + 3);
      throw new Error('bake failed');
    })).toThrow('bake failed');
    expect(gl.deleteTexture).toHaveBeenCalledTimes(1);
    expect(gl.deleteFramebuffer).toHaveBeenCalledTimes(1);
    expect(gl.generateMipmap).not.toHaveBeenCalled();
    expect(snapshot(state)).toEqual(before);
  });

  it('cleans up and restores state when allocation fails', () => {
    const { cache, gl, state } = createHarness();
    const before = snapshot(state);
    gl.createFramebuffer.mockReturnValueOnce(null);
    expect(() => cache.getOrCreate('source', 8, 4, vi.fn())).toThrow('Failed to create');
    expect(gl.deleteTexture).toHaveBeenCalledTimes(1);
    expect(snapshot(state)).toEqual(before);
    gl.createTexture.mockReturnValueOnce(null);
    expect(() => cache.getOrCreate('source', 8, 4, vi.fn())).toThrow('Failed to create');
    expect(snapshot(state)).toEqual(before);
  });

  it.each([[0, 4], [8, -1], [1.5, 4], [32768, 4]])('rejects invalid dimensions %s × %s', (width, height) => {
    const { cache, gl } = createHarness();
    expect(() => cache.getOrCreate('source', width, height, vi.fn())).toThrow('dimensions');
    expect(gl.createTexture).not.toHaveBeenCalled();
  });
});

function createHarness({ smooth = true, floatColorBuffer = true } = {}) {
  const state = {
    drawFramebuffer: { id: 'draw' } as WebGLFramebuffer | null,
    readFramebuffer: { id: 'read' } as WebGLFramebuffer | null,
    viewport: [10, 20, 100, 200],
    scissorBox: [30, 40, 50, 60],
    scissorEnabled: true,
    activeTexture: 100,
    textures: new Map<number, WebGLTexture | null>([
      [100, { id: 'source' } as WebGLTexture],
      [115, { id: 'previous environment' } as WebGLTexture]
    ])
  };
  let nextTexture = 0;
  let nextFramebuffer = 0;
  const gl = {
    MAX_TEXTURE_SIZE: 1,
    DRAW_FRAMEBUFFER_BINDING: 2,
    READ_FRAMEBUFFER_BINDING: 3,
    VIEWPORT: 4,
    SCISSOR_BOX: 5,
    SCISSOR_TEST: 6,
    ACTIVE_TEXTURE: 7,
    TEXTURE_BINDING_2D: 8,
    TEXTURE0: 100,
    TEXTURE_2D: 9,
    TEXTURE_MIN_FILTER: 10,
    TEXTURE_MAG_FILTER: 11,
    TEXTURE_WRAP_S: 12,
    TEXTURE_WRAP_T: 13,
    LINEAR_MIPMAP_LINEAR: 14,
    NEAREST: 15,
    LINEAR: 16,
    REPEAT: 17,
    CLAMP_TO_EDGE: 18,
    RGBA32F: 19,
    RGBA: 20,
    FLOAT: 21,
    FRAMEBUFFER: 22,
    DRAW_FRAMEBUFFER: 23,
    READ_FRAMEBUFFER: 24,
    COLOR_ATTACHMENT0: 25,
    FRAMEBUFFER_COMPLETE: 26,
    getExtension: vi.fn(() => floatColorBuffer ? {} : null),
    getParameter: vi.fn((parameter: number): unknown => {
      switch (parameter) {
        case gl.MAX_TEXTURE_SIZE: return 16384;
        case gl.DRAW_FRAMEBUFFER_BINDING: return state.drawFramebuffer;
        case gl.READ_FRAMEBUFFER_BINDING: return state.readFramebuffer;
        case gl.VIEWPORT: return new Int32Array(state.viewport);
        case gl.SCISSOR_BOX: return new Int32Array(state.scissorBox);
        case gl.ACTIVE_TEXTURE: return state.activeTexture;
        case gl.TEXTURE_BINDING_2D: return state.textures.get(state.activeTexture) ?? null;
        default: throw new Error(`Unexpected parameter ${parameter}`);
      }
    }),
    activeTexture: vi.fn((unit: number) => { state.activeTexture = unit; }),
    bindTexture: vi.fn((_target: number, texture: WebGLTexture | null) => {
      state.textures.set(state.activeTexture, texture);
    }),
    isEnabled: vi.fn((_capability: number) => state.scissorEnabled),
    enable: vi.fn((_capability: number) => { state.scissorEnabled = true; }),
    disable: vi.fn((_capability: number) => { state.scissorEnabled = false; }),
    viewport: vi.fn((x: number, y: number, width: number, height: number) => {
      state.viewport = [x, y, width, height];
    }),
    scissor: vi.fn((x: number, y: number, width: number, height: number) => {
      state.scissorBox = [x, y, width, height];
    }),
    createTexture: vi.fn((): WebGLTexture | null => ({ id: ++nextTexture }) as WebGLTexture),
    createFramebuffer: vi.fn((): WebGLFramebuffer | null => ({ id: ++nextFramebuffer }) as WebGLFramebuffer),
    bindFramebuffer: vi.fn((target: number, framebuffer: WebGLFramebuffer | null) => {
      if (target === gl.FRAMEBUFFER || target === gl.DRAW_FRAMEBUFFER) {
        state.drawFramebuffer = framebuffer;
      }
      if (target === gl.FRAMEBUFFER || target === gl.READ_FRAMEBUFFER) {
        state.readFramebuffer = framebuffer;
      }
    }),
    deleteTexture: vi.fn(),
    deleteFramebuffer: vi.fn(),
    texParameteri: vi.fn(),
    texImage2D: vi.fn(),
    framebufferTexture2D: vi.fn(),
    checkFramebufferStatus: vi.fn(() => 26),
    generateMipmap: vi.fn()
  };
  return {
    cache: new EnvironmentRadianceCache(gl as unknown as WebGL2RenderingContext, smooth),
    gl,
    state
  };
}

function snapshot(state: ReturnType<typeof createHarness>['state']) {
  return { ...state, textures: new Map(state.textures) };
}
