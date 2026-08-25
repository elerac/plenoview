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

  it('keeps power-of-two horizontal-cross cubemap faces isolated down to one texel per face', () => {
    const faceSize = 4;
    const width = faceSize * 4;
    const height = faceSize * 3;
    const unusedValue = 1000;
    const source = new Float32Array(width * height).fill(unusedValue);
    const faces = [
      { column: 1, row: 0, value: 1 },
      { column: 0, row: 1, value: 2 },
      { column: 1, row: 1, value: 3 },
      { column: 2, row: 1, value: 4 },
      { column: 3, row: 1, value: 5 },
      { column: 1, row: 2, value: 6 }
    ] as const;

    for (const face of faces) {
      for (let localY = 0; localY < faceSize; localY += 1) {
        for (let localX = 0; localX < faceSize; localX += 1) {
          const x = face.column * faceSize + localX;
          const y = face.row * faceSize + localY;
          source[y * width + x] = face.value;
        }
      }
    }

    const twoTexelsPerFace = buildNextFloatMipLevel(source, width, height, 1);
    expect(twoTexelsPerFace).not.toBeNull();
    const oneTexelPerFace = buildNextFloatMipLevel(
      twoTexelsPerFace!.pixels,
      twoTexelsPerFace!.width,
      twoTexelsPerFace!.height,
      1
    );

    expect(oneTexelPerFace).toEqual({
      width: 4,
      height: 3,
      pixels: new Float32Array([
        unusedValue, 1, unusedValue, unusedValue,
        2, 3, 4, 5,
        unusedValue, 6, unusedValue, unusedValue
      ])
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
