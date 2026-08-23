export interface FloatMipLevel {
  width: number;
  height: number;
  pixels: Float32Array;
}

export function buildNextFloatMipLevel(
  source: Float32Array,
  width: number,
  height: number,
  components: number
): FloatMipLevel | null {
  validateFloatMipInput(source, width, height, components);
  if (width === 1 && height === 1) {
    return null;
  }

  const nextWidth = Math.max(1, Math.floor(width / 2));
  const nextHeight = Math.max(1, Math.floor(height / 2));
  if ((width === 1 || width % 2 === 0) && (height === 1 || height % 2 === 0)) {
    return buildUniformFloatMipLevel(
      source,
      width,
      height,
      nextWidth,
      nextHeight,
      components
    );
  }

  const pixels = new Float32Array(nextWidth * nextHeight * components);
  const componentSums = new Float64Array(components);

  for (let targetY = 0; targetY < nextHeight; targetY += 1) {
    const sourceYStart = targetY * height / nextHeight;
    const sourceYEnd = (targetY + 1) * height / nextHeight;
    const firstSourceY = Math.floor(sourceYStart);
    const lastSourceY = Math.min(height - 1, Math.ceil(sourceYEnd) - 1);

    for (let targetX = 0; targetX < nextWidth; targetX += 1) {
      const sourceXStart = targetX * width / nextWidth;
      const sourceXEnd = (targetX + 1) * width / nextWidth;
      const firstSourceX = Math.floor(sourceXStart);
      const lastSourceX = Math.min(width - 1, Math.ceil(sourceXEnd) - 1);
      const targetIndex = (targetY * nextWidth + targetX) * components;
      const sourceArea = (sourceXEnd - sourceXStart) * (sourceYEnd - sourceYStart);
      componentSums.fill(0);

      for (let sourceY = firstSourceY; sourceY <= lastSourceY; sourceY += 1) {
        const overlapY = Math.min(sourceY + 1, sourceYEnd) - Math.max(sourceY, sourceYStart);
        for (let sourceX = firstSourceX; sourceX <= lastSourceX; sourceX += 1) {
          const overlapX = Math.min(sourceX + 1, sourceXEnd) - Math.max(sourceX, sourceXStart);
          const weight = overlapX * overlapY;
          const sourceIndex = (sourceY * width + sourceX) * components;
          for (let component = 0; component < components; component += 1) {
            componentSums[component] += source[sourceIndex + component] * weight;
          }
        }
      }

      for (let component = 0; component < components; component += 1) {
        pixels[targetIndex + component] = componentSums[component] / sourceArea;
      }
    }
  }

  return { width: nextWidth, height: nextHeight, pixels };
}

function buildUniformFloatMipLevel(
  source: Float32Array,
  sourceWidth: number,
  sourceHeight: number,
  width: number,
  height: number,
  components: number
): FloatMipLevel {
  const scaleX = sourceWidth === 1 ? 1 : 2;
  const scaleY = sourceHeight === 1 ? 1 : 2;
  const sampleCount = scaleX * scaleY;
  const pixels = new Float32Array(width * height * components);

  for (let targetY = 0; targetY < height; targetY += 1) {
    for (let targetX = 0; targetX < width; targetX += 1) {
      const targetIndex = (targetY * width + targetX) * components;
      for (let component = 0; component < components; component += 1) {
        let sum = 0;
        for (let offsetY = 0; offsetY < scaleY; offsetY += 1) {
          const sourceY = targetY * scaleY + offsetY;
          for (let offsetX = 0; offsetX < scaleX; offsetX += 1) {
            const sourceX = targetX * scaleX + offsetX;
            const sourceIndex = (sourceY * sourceWidth + sourceX) * components + component;
            sum += source[sourceIndex];
          }
        }
        pixels[targetIndex + component] = sum / sampleCount;
      }
    }
  }

  return { width, height, pixels };
}

function validateFloatMipInput(
  source: Float32Array,
  width: number,
  height: number,
  components: number
): void {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    !Number.isInteger(components) ||
    width <= 0 ||
    height <= 0 ||
    components <= 0 ||
    source.length !== width * height * components
  ) {
    throw new RangeError('Float mip input dimensions do not match the source data.');
  }
}
