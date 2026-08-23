import { describe, expect, it } from 'vitest';
import { buildNextFloatMipLevel } from '../src/rendering/float-mipmap';

describe('float mipmap generation', () => {
  it('averages an even 2x2 scalar image into one texel', () => {
    expect(buildNextFloatMipLevel(
      new Float32Array([
        1, 3,
        5, 7
      ]),
      2,
      2,
      1
    )).toEqual({
      width: 1,
      height: 1,
      pixels: new Float32Array([4])
    });
  });

  it('does not overflow while averaging large finite float values', () => {
    const nextLevel = buildNextFloatMipLevel(
      new Float32Array(4).fill(3e38),
      2,
      2,
      1
    );

    expect(nextLevel).not.toBeNull();
    const value = nextLevel?.pixels[0] ?? Number.NaN;
    expect(Number.isFinite(value)).toBe(true);
    expect(value / 3e38).toBeCloseTo(1, 5);
  });

  it('area-weights every source texel when reducing a non-power-of-two axis', () => {
    expect(buildNextFloatMipLevel(
      new Float32Array([3, 6, 12]),
      3,
      1,
      1
    )).toEqual({
      width: 1,
      height: 1,
      pixels: new Float32Array([7])
    });
  });

  it('averages RGBA components independently', () => {
    expect(buildNextFloatMipLevel(
      new Float32Array([
        1, 2, 3, 4,
        5, 6, 7, 8,
        9, 10, 11, 12,
        13, 14, 15, 16
      ]),
      2,
      2,
      4
    )).toEqual({
      width: 1,
      height: 1,
      pixels: new Float32Array([7, 8, 9, 10])
    });
  });

  it.each([
    { width: 2, height: 1 },
    { width: 1, height: 2 }
  ])('reduces a one-dimensional $width x $height image', ({ width, height }) => {
    expect(buildNextFloatMipLevel(
      new Float32Array([2, 6]),
      width,
      height,
      1
    )).toEqual({
      width: 1,
      height: 1,
      pixels: new Float32Array([4])
    });
  });

  it('returns null when a 1x1 image has no next mip level', () => {
    expect(buildNextFloatMipLevel(new Float32Array([5]), 1, 1, 1)).toBeNull();
  });

  it('rejects invalid dimensions, component counts, and source lengths', () => {
    expect(() => buildNextFloatMipLevel(new Float32Array(), 0, 1, 1)).toThrow();
    expect(() => buildNextFloatMipLevel(new Float32Array([1, 2]), 1.5, 1, 1)).toThrow();
    expect(() => buildNextFloatMipLevel(new Float32Array([1]), 1, 1, 0)).toThrow();
    expect(() => buildNextFloatMipLevel(new Float32Array([1]), 2, 1, 1)).toThrow();
  });
});
