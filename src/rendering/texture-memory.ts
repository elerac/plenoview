export function predictTextureStorageBytes(
  width: number,
  height: number,
  bytesPerTexel: number,
  includeMipmaps: boolean
): number {
  let levelWidth = normalizeTextureDimension(width);
  let levelHeight = normalizeTextureDimension(height);
  if (
    levelWidth === 0 ||
    levelHeight === 0 ||
    !Number.isFinite(bytesPerTexel) ||
    bytesPerTexel <= 0
  ) {
    return 0;
  }

  let texelCount = 0;
  while (true) {
    texelCount += levelWidth * levelHeight;
    if (!includeMipmaps || (levelWidth === 1 && levelHeight === 1)) {
      break;
    }
    levelWidth = Math.max(1, Math.floor(levelWidth / 2));
    levelHeight = Math.max(1, Math.floor(levelHeight / 2));
  }

  return texelCount * bytesPerTexel;
}

function normalizeTextureDimension(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}
