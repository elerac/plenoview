import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDefaultEnvironmentSphereMaterial } from '../src/environment-sphere-material';
import { computeRoughPlasticTransmittanceSteps } from '../src/roughplastic-transmittance';
import { RoughPlasticTransmittanceCache } from '../src/rendering/gl-image-renderer/roughplastic-transmittance-texture';

const work = vi.hoisted(() => ({ slices: 0 }));
vi.mock('../src/roughplastic-transmittance', async importOriginal => ({
  ...await importOriginal<typeof import('../src/roughplastic-transmittance')>(),
  computeRoughPlasticTransmittanceSteps: vi.fn(function* ({ alpha }: { alpha: number }) {
    for (let i = 0; i < 3; i++) {
      work.slices++;
      yield;
    }
    return { externalTransmittance: new Float32Array(64).fill(alpha), internalReflectance: alpha / 2 };
  })
}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  work.slices = 0;
});

describe('material lighting preparation', () => {
  it('budgets CPU slices, reuses completed tables, and only uploads a complete material', () => {
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now += 6);
    const { cache, gl } = createHarness();
    const material = createDefaultEnvironmentSphereMaterial();
    expect(cache.prepare(material)).toBe(false);
    expect(work.slices).toBe(1);
    expect(gl.texImage2D).not.toHaveBeenCalled();
    expect(() => cache.getOrCreate(material)).toThrow('still preparing');
    for (let frame = 0; !cache.prepare(material); frame++) {
      expect(frame).toBeLessThan(32);
    }
    // The repeated fixed roughness (0.7) shares the same table.
    expect(computeRoughPlasticTransmittanceSteps).toHaveBeenCalledTimes(7);
    const texture = cache.getOrCreate(material);
    const pixels = vi.mocked(gl.texImage2D).mock.calls[0][8] as Float32Array;
    expect(pixels[0]).toBeCloseTo(material.alpha);
    expect(pixels[1]).toBeCloseTo(material.alpha / 2);
    expect(pixels[64 * 4]).toBeCloseTo(0.7);
    const slices = work.slices;
    expect(cache.prepare(material)).toBe(true);
    expect(cache.getOrCreate(material)).toBe(texture);
    expect(work.slices).toBe(slices);
    expect(gl.texImage2D).toHaveBeenCalledTimes(1);

    const changed = { ...material, alpha: 0.3 };
    expect(cache.prepare(changed)).toBe(false);
    expect(() => cache.getOrCreate(changed)).toThrow('still preparing');
    while (!cache.prepare(changed)) { /* advance the remaining slices */ }
    cache.getOrCreate(changed);
    expect(computeRoughPlasticTransmittanceSteps).toHaveBeenCalledTimes(8);
    expect(gl.texImage2D).toHaveBeenCalledTimes(2);
    cache.dispose();
    expect(gl.deleteTexture).toHaveBeenCalledTimes(1);
  });

  it('drops unfinished work on clear and never resumes it after disposal', () => {
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now += 6);
    const { cache } = createHarness();
    const material = createDefaultEnvironmentSphereMaterial();
    expect(cache.prepare(material)).toBe(false);
    cache.clear();
    expect(cache.prepare(material)).toBe(false);
    expect(computeRoughPlasticTransmittanceSteps).toHaveBeenCalledTimes(2);
    cache.dispose();
    const slices = work.slices;
    expect(() => cache.prepare(material)).toThrow('disposed');
    expect(() => cache.getOrCreate(material)).toThrow('disposed');
    expect(work.slices).toBe(slices);
  });
});

function createHarness() {
  const gl = {
    ACTIVE_TEXTURE: 0x84e0, TEXTURE0: 0x84c0, TEXTURE_2D: 0x0de1, TEXTURE_BINDING_2D: 0x8069,
    TEXTURE_MIN_FILTER: 0x2801, TEXTURE_MAG_FILTER: 0x2800, NEAREST: 0x2600,
    TEXTURE_WRAP_S: 0x2802, TEXTURE_WRAP_T: 0x2803, CLAMP_TO_EDGE: 0x812f,
    RGBA32F: 0x8814, RGBA: 0x1908, FLOAT: 0x1406,
    getParameter: vi.fn(() => 0), activeTexture: vi.fn(), bindTexture: vi.fn(),
    createTexture: vi.fn(() => ({})), texParameteri: vi.fn(), texImage2D: vi.fn(), deleteTexture: vi.fn()
  } as unknown as WebGL2RenderingContext;
  return { cache: new RoughPlasticTransmittanceCache(gl), gl };
}
