import { imageToScreen } from '../interaction/image-geometry';
import type { Disposable } from '../lifecycle';
import { resolveActiveProbePixel } from '../probe';
import type { ImagePixel, ImageRoi, ViewerState, ViewportInfo } from '../types';
import type { ViewerPaneRenderInfo } from '../viewer-pane-layout';

export class ProbeOverlayRenderer implements Disposable {
  private readonly overlayCanvas: HTMLCanvasElement;
  private readonly overlayContext: CanvasRenderingContext2D;
  private viewport: ViewportInfo = { width: 1, height: 1 };
  private panes: ViewerPaneRenderInfo[] = [];
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

  clearImage(): void {
    if (this.disposed) {
      return;
    }

    this.hasImage = false;
    this.overlayContext.clearRect(0, 0, this.viewport.width, this.viewport.height);
  }

  render(state: ViewerState): void {
    if (this.disposed) {
      return;
    }

    this.clearOverlay();

    if (!this.hasImage || state.viewerMode === 'panorama') {
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

    this.overlayContext.clearRect(0, 0, this.viewport.width, this.viewport.height);
  }

  renderPane(state: ViewerState, pane: ViewerPaneRenderInfo): void {
    if (this.disposed || !this.hasImage || state.viewerMode === 'panorama') {
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

      if (state.roi) {
        this.drawRoi(state, state.roi, pane.viewport, 'rgba(255, 122, 89, 0.95)');
      }

      if (state.draftRoi) {
        this.drawRoi(state, state.draftRoi, pane.viewport, 'rgba(75, 192, 255, 0.95)');
      }

      if (state.roi && (state.roiInteraction.hoverHandle || state.roiInteraction.activeHandle)) {
        this.drawRoiHandles(state, state.draftRoi ?? state.roi, pane.viewport);
      }

      const probe = resolveActiveProbePixel(state.lockedPixel, state.hoveredPixel);
      if (probe) {
        this.drawProbeMarker(state, probe, pane.viewport);
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
    this.overlayContext.clearRect(0, 0, this.viewport.width, this.viewport.height);
  }

  private drawProbeMarker(state: ViewerState, pixel: ImagePixel, viewport: ViewportInfo): void {
    const ctx = this.overlayContext;
    const topLeft = imageToScreen(pixel.ix, pixel.iy, state, viewport);

    ctx.strokeStyle = state.lockedPixel ? 'rgba(255, 196, 0, 0.95)' : 'rgba(255, 255, 255, 0.95)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(topLeft.x, topLeft.y, state.zoom, state.zoom);
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
