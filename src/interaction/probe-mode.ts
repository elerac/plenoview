import type { ImagePixel, ViewerState, ViewportInfo } from '../types';
import { screenToImage } from './image-geometry';
import { screenToPanoramaPixel } from './panorama-geometry';
import type { DepthProbePixelResolver, ImageSize, PointerPosition } from './shared';
import { resolvePanoramaDisplayMode } from '../panorama-lighting';

export function resolveProbePixel(
  point: PointerPosition,
  state: ViewerState,
  viewport: ViewportInfo,
  imageSize: ImageSize,
  resolveDepthProbePixel?: DepthProbePixelResolver
): ImagePixel | null {
  if (state.viewerMode === '3d') {
    return resolveDepthProbePixel?.(point, state, viewport) ?? null;
  }

  if (
    state.viewerMode === 'panorama' &&
    resolvePanoramaDisplayMode(state.panoramaDisplayMode) === 'environmentLighting'
  ) {
    return null;
  }

  return state.viewerMode === 'panorama'
    ? screenToPanoramaPixel(point.x, point.y, state, viewport, imageSize.width, imageSize.height)
    : screenToImage(point.x, point.y, state, viewport, imageSize.width, imageSize.height);
}

export function resolveHoverPixel(
  lastPointerInElement: PointerPosition | null,
  state: ViewerState,
  viewport: ViewportInfo,
  imageSize: ImageSize,
  resolveDepthProbePixel?: DepthProbePixelResolver
): ImagePixel | null {
  if (!lastPointerInElement) {
    return null;
  }

  return resolveProbePixel(lastPointerInElement, state, viewport, imageSize, resolveDepthProbePixel);
}
