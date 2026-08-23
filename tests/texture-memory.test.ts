import { describe, expect, it } from 'vitest';
import { predictTextureStorageBytes } from '../src/rendering/texture-memory';

describe('texture memory prediction', () => {
  it('counts every level in a non-power-of-two mip chain', () => {
    expect(predictTextureStorageBytes(3, 5, 4, true)).toBe((15 + 2 + 1) * 4);
  });

  it('does not add a duplicate level to a 1x1 mipmapped texture', () => {
    expect(predictTextureStorageBytes(1, 1, 16, true)).toBe(16);
  });

  it('can predict base-level-only storage for the float-linear fallback', () => {
    expect(predictTextureStorageBytes(3, 5, 4, false)).toBe(15 * 4);
  });

  it('rejects invalid dimensions instead of attempting an invalid mip chain', () => {
    expect(predictTextureStorageBytes(Number.NaN, 5, 4, true)).toBe(0);
    expect(predictTextureStorageBytes(Number.POSITIVE_INFINITY, 5, 4, true)).toBe(0);
  });
});
