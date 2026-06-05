import {
  DepthProbeProjectionCache,
  normalizeDepthPointSize,
  resolveDepthSourceForLayer,
  type DepthSource,
  type DepthSourceGeometry
} from '../depth';
import { imageToScreen } from '../interaction/image-geometry';
import type { Disposable } from '../lifecycle';
import { resolveActiveProbePixel } from '../probe';
import type {
  DecodedLayer,
  ImagePixel,
  ImageRoi,
  ViewerState,
  ViewportInfo
} from '../types';
import type { ViewerPaneRenderInfo } from '../viewer-pane-layout';

export class ProbeOverlayRenderer implements Disposable {
  private readonly overlayCanvas: HTMLCanvasElement;
  private readonly overlayContext: CanvasRenderingContext2D;
  private readonly depthProjectionCache = new DepthProbeProjectionCache();
  private viewport: ViewportInfo = { width: 1, height: 1 };
  private panes: ViewerPaneRenderInfo[] = [];
  private sourceWidth = 0;
  private sourceHeight = 0;
  private sourceLayer: DecodedLayer | null = null;
  private depthSource: DepthSource | null = null;
  private depthGeometry: DepthSourceGeometry | null = null;
  private hasImage = false;
  private disposed = false;

  constructor(overlayCanvas: HTMLCanvasElement) {
    const overlayContext = overlayCanvas.getContext('2d');
    if (!overlayContext) {
      throw new Error('Unable to create probe overlay 2D canvas context.');
    }

    this.overlayCanvas = overlayCanvas;
    this.overlayContext = overlayContext;
  }

  resize(width: number, height: number): void {
    if (this.disposed) {
      return;
    }

    this.viewport = {
      width: Math.max(1, Math.floor(width)),
      height: Math.max(1, Math.floor(height))
    };
    this.overlayCanvas.width = this.viewport.width;
    this.overlayCanvas.height = this.viewport.height;
  }

  setPanes(panes: readonly ViewerPaneRenderInfo[]): void {
    this.panes = panes.map(clonePaneRenderInfo);
  }

  setImagePresent(hasImage: boolean): void {
    if (this.disposed) {
      return;
    }

    this.hasImage = hasImage;
  }

  setSourceContext(width: number, height: number, layer: DecodedLayer): void {
    if (this.disposed) {
      return;
    }

    this.sourceWidth = width;
    this.sourceHeight = height;
    this.sourceLayer = layer;
  }

  setDepthSourceContext(
    source: DepthSource | null,
    geometry: DepthSourceGeometry | null
  ): void {
    if (this.disposed) {
      return;
    }

    this.depthSource = source;
    this.depthGeometry = geometry;
  }

  clearImage(): void {
    if (this.disposed) {
      return;
    }

    this.hasImage = false;
    this.sourceWidth = 0;
    this.sourceHeight = 0;
    this.sourceLayer = null;
    this.depthSource = null;
    this.depthGeometry = null;
    this.depthProjectionCache.clear();
    this.clearCanvas();
  }

  render(state: ViewerState): void {
    if (this.disposed) {
      return;
    }

    this.clearOverlay();

    if (!this.hasImage || (state.viewerMode !== 'image' && state.viewerMode !== '3d')) {
      return;
    }

    const panes = this.panes.length > 0 ? this.panes : [createFullViewportPane(this.viewport)];
    for (const pane of panes) {
      this.renderPane(state, pane);
    }
  }

  clearOverlay(): void {
    if (this.disposed) {
      return;
    }

    this.clearCanvas();
  }

  renderPane(state: ViewerState, pane: ViewerPaneRenderInfo): void {
    if (this.disposed || !this.hasImage || (state.viewerMode !== 'image' && state.viewerMode !== '3d')) {
      return;
    }

    const ctx = this.overlayContext;
    const usePaneClip = !isFullViewportPane(pane, this.viewport);
    if (usePaneClip) {
      ctx.save();
    }
    try {
      if (usePaneClip) {
        ctx.beginPath();
        ctx.rect(pane.rect.x, pane.rect.y, pane.rect.width, pane.rect.height);
        ctx.clip();
        ctx.translate(pane.rect.x, pane.rect.y);
      }

      const probe = resolveActiveProbePixel(state.lockedPixel, state.hoveredPixel);
      if (state.viewerMode === '3d') {
        if (probe) {
          this.drawDepthProbeMarker(state, probe, pane.viewport);
        }
        return;
      }

      if (state.roi) {
        this.drawRoi(state, state.roi, pane.viewport, 'rgba(255, 122, 89, 0.95)');
      }

      if (state.draftRoi) {
        this.drawRoi(state, state.draftRoi, pane.viewport, 'rgba(75, 192, 255, 0.95)');
      }

      if (state.roi && (state.roiInteraction.hoverHandle || state.roiInteraction.activeHandle)) {
        this.drawRoiHandles(state, state.draftRoi ?? state.roi, pane.viewport);
      }
      if (probe) {
        this.drawImageProbeMarker(state, probe, pane.viewport);
      }
    } finally {
      if (usePaneClip) {
        ctx.restore();
      }
    }
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.hasImage = false;
    this.clearCanvas();
  }

  private drawImageProbeMarker(state: ViewerState, pixel: ImagePixel, viewport: ViewportInfo): void {
    const ctx = this.overlayContext;
    const topLeft = imageToScreen(pixel.ix, pixel.iy, state, viewport);

    ctx.strokeStyle = state.lockedPixel ? 'rgba(255, 196, 0, 0.95)' : 'rgba(255, 255, 255, 0.95)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(topLeft.x, topLeft.y, state.zoom, state.zoom);
  }

  private drawDepthProbeMarker(state: ViewerState, pixel: ImagePixel, viewport: ViewportInfo): void {
    if (!this.sourceLayer) {
      return;
    }

    const depthSource = this.depthSource ?? resolveDepthSourceForLayer(
      this.sourceLayer.channelNames,
      state.depthChannel,
      {
        allowArbitraryZSuffix: true,
        channelRecognitionSettings: state.channelRecognitionSettings,
        channelRecognitionNameRules: state.channelRecognitionNameRules
      }
    );
    if (!depthSource) {
      return;
    }

    const projected = this.depthProjectionCache.projectPixel(pixel, {
      layer: this.sourceLayer,
      width: this.sourceWidth,
      height: this.sourceHeight,
      source: depthSource,
      viewport,
      geometry: this.depthGeometry,
      depthFocalLengthPx: state.depthFocalLengthPx,
      depthYawDeg: state.depthYawDeg,
      depthPitchDeg: state.depthPitchDeg,
      depthZoom: state.depthZoom,
      depthTargetX: state.depthTargetX,
      depthTargetY: state.depthTargetY,
      depthTargetZ: state.depthTargetZ,
      depthPointSizePx: state.depthPointSizePx
    });
    if (!projected) {
      return;
    }

    const ctx = this.overlayContext;
    const size = Math.max(normalizeDepthPointSize(state.depthPointSizePx), 6);
    const half = size * 0.5;

    ctx.strokeStyle = state.lockedPixel ? 'rgba(255, 196, 0, 0.95)' : 'rgba(255, 255, 255, 0.95)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(projected.screenX - half, projected.screenY - half, size, size);
  }

  private drawRoi(state: ViewerState, roi: ImageRoi, viewport: ViewportInfo, strokeStyle: string): void {
    const ctx = this.overlayContext;
    const topLeft = imageToScreen(roi.x0, roi.y0, state, viewport);
    const bottomRight = imageToScreen(roi.x1 + 1, roi.y1 + 1, state, viewport);

    ctx.strokeStyle = strokeStyle;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(topLeft.x, topLeft.y, bottomRight.x - topLeft.x, bottomRight.y - topLeft.y);
  }

  private drawRoiHandles(state: ViewerState, roi: ImageRoi, viewport: ViewportInfo): void {
    const normalized = normalizeRoiForDrawing(roi);
    const leftTop = imageToScreen(normalized.x0, normalized.y0, state, viewport);
    const rightBottom = imageToScreen(normalized.x1 + 1, normalized.y1 + 1, state, viewport);
    const centerX = (leftTop.x + rightBottom.x) * 0.5;
    const centerY = (leftTop.y + rightBottom.y) * 0.5;
    const handles: Array<{ handle: NonNullable<ViewerState['roiInteraction']['hoverHandle']>; x: number; y: number }> = [
      { handle: 'corner-nw', x: leftTop.x, y: leftTop.y },
      { handle: 'edge-n', x: centerX, y: leftTop.y },
      { handle: 'corner-ne', x: rightBottom.x, y: leftTop.y },
      { handle: 'edge-e', x: rightBottom.x, y: centerY },
      { handle: 'corner-se', x: rightBottom.x, y: rightBottom.y },
      { handle: 'edge-s', x: centerX, y: rightBottom.y },
      { handle: 'corner-sw', x: leftTop.x, y: rightBottom.y },
      { handle: 'edge-w', x: leftTop.x, y: centerY }
    ];
    const activeHandle = state.roiInteraction.activeHandle;
    const hoverHandle = state.roiInteraction.hoverHandle;

    for (const handle of handles) {
      const active = handle.handle === activeHandle;
      const hovered = handle.handle === hoverHandle;
      this.drawRoiHandle(handle.x, handle.y, active, hovered);
    }
  }

  private drawRoiHandle(x: number, y: number, active: boolean, hovered: boolean): void {
    const ctx = this.overlayContext;
    const size = active || hovered ? 7 : 6;
    const half = size * 0.5;

    ctx.fillStyle = active ? 'rgba(125, 211, 252, 0.98)' : 'rgba(248, 251, 255, 0.96)';
    ctx.strokeStyle = active || hovered ? 'rgba(6, 12, 20, 0.92)' : 'rgba(0, 0, 0, 0.76)';
    ctx.lineWidth = 1;
    ctx.fillRect(x - half, y - half, size, size);
    ctx.strokeRect(x - half, y - half, size, size);
  }

  private clearCanvas(): void {
    const width = this.overlayCanvas.width;
    this.overlayCanvas.width = width;
  }
}

function createFullViewportPane(viewport: ViewportInfo): ViewerPaneRenderInfo {
  return {
    path: [],
    rect: {
      x: 0,
      y: 0,
      width: viewport.width,
      height: viewport.height
    },
    viewport: { ...viewport },
    active: true
  };
}

function clonePaneRenderInfo(pane: ViewerPaneRenderInfo): ViewerPaneRenderInfo {
  return {
    path: [...pane.path],
    rect: { ...pane.rect },
    viewport: { ...pane.viewport },
    active: pane.active
  };
}

function isFullViewportPane(pane: ViewerPaneRenderInfo, viewport: ViewportInfo): boolean {
  return (
    pane.rect.x === 0 &&
    pane.rect.y === 0 &&
    pane.rect.width === viewport.width &&
    pane.rect.height === viewport.height
  );
}

function normalizeRoiForDrawing(roi: ImageRoi): ImageRoi {
  return {
    x0: Math.min(roi.x0, roi.x1),
    y0: Math.min(roi.y0, roi.y1),
    x1: Math.max(roi.x0, roi.x1),
    y1: Math.max(roi.y0, roi.y1)
  };
}
