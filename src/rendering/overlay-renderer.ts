import {
  readDisplaySelectionOverlayPixelValuesAtIndex,
  resolveDisplaySelectionEvaluator,
  type DisplaySelectionEvaluator
} from '../display/evaluator';
import type { Disposable } from '../lifecycle';
import type { StokesComputationOptions } from '../stokes';
import type { DecodedLayer, ViewerState, ViewportInfo } from '../types';
import type { ViewerPaneRenderInfo } from '../viewer-pane-layout';
import { buildOverlayValueLines } from './overlay-value-lines';

const VALUE_LABEL_FADE_START_ZOOM = 24;
const VALUE_LABEL_FULL_OPACITY_ZOOM = 32;
const MAX_VALUE_LABELS = 1800;

export class OverlayRenderer implements Disposable {
  private readonly overlayCanvas: HTMLCanvasElement;
  private readonly overlayContext: CanvasRenderingContext2D;
  private viewport: ViewportInfo = { width: 1, height: 1 };
  private panes: ViewerPaneRenderInfo[] = [];
  private imageSize: { width: number; height: number } | null = null;
  private displayEvaluator: DisplaySelectionEvaluator | null = null;
  private disposed = false;

  constructor(overlayCanvas: HTMLCanvasElement) {
    const overlayContext = overlayCanvas.getContext('2d');
    if (!overlayContext) {
      throw new Error('Unable to create overlay 2D canvas context.');
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

  setDisplaySelectionContext(
    width: number,
    height: number,
    layer: DecodedLayer,
    selection: ViewerState['displaySelection'],
    visualizationMode: ViewerState['visualizationMode'],
    stokesOptions: StokesComputationOptions = {}
  ): void {
    if (this.disposed) {
      return;
    }

    this.imageSize = { width, height };
    this.displayEvaluator = resolveDisplaySelectionEvaluator(layer, selection, visualizationMode, stokesOptions);
  }

  clearImage(): void {
    if (this.disposed) {
      return;
    }

    this.imageSize = null;
    this.displayEvaluator = null;
    this.overlayContext.clearRect(0, 0, this.viewport.width, this.viewport.height);
  }

  render(state: ViewerState): void {
    this.renderValues(state);
  }

  renderValues(state: ViewerState): void {
    if (this.disposed) {
      return;
    }

    this.clearValues();

    const panes = this.panes.length > 0 ? this.panes : [createFullViewportPane(this.viewport)];
    for (const pane of panes) {
      this.renderPaneValues(state, pane);
    }
  }

  clearValues(): void {
    if (this.disposed) {
      return;
    }

    this.overlayContext.clearRect(0, 0, this.viewport.width, this.viewport.height);
  }

  renderPaneValues(state: ViewerState, pane: ViewerPaneRenderInfo): void {
    if (this.disposed || !this.imageSize || state.viewerMode === 'panorama') {
      return;
    }

    const labelOpacity = resolveValueLabelOpacity(state.zoom);
    if (labelOpacity > 0) {
      this.drawPixelValues(state, this.imageSize.width, this.imageSize.height, labelOpacity, pane);
    }
  }

  private drawPixelValues(
    state: ViewerState,
    imageWidth: number,
    imageHeight: number,
    opacity: number,
    pane: ViewerPaneRenderInfo
  ): void {
    const evaluator = this.displayEvaluator;
    if (!evaluator) {
      return;
    }

    const bounds = visibleBounds(state, pane.viewport);
    const startX = Math.max(0, Math.floor(bounds.left));
    const endX = Math.min(imageWidth - 1, Math.ceil(bounds.right));
    const startY = Math.max(0, Math.floor(bounds.top));
    const endY = Math.min(imageHeight - 1, Math.ceil(bounds.bottom));

    if (endX < startX || endY < startY) {
      return;
    }

    const labelCount = (endX - startX + 1) * (endY - startY + 1);
    if (labelCount > MAX_VALUE_LABELS) {
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
      prepareValueLabelContext(ctx);
      ctx.globalAlpha = opacity;
      const halfViewWidth = pane.viewport.width * 0.5;
      const halfViewHeight = pane.viewport.height * 0.5;
      const values = { r: 0, g: 0, b: 0, a: 1 };

      for (let y = startY; y <= endY; y += 1) {
        for (let x = startX; x <= endX; x += 1) {
          const pixelIndex = y * imageWidth + x;
          readDisplaySelectionOverlayPixelValuesAtIndex(evaluator, pixelIndex, values);
          const valueLines = buildOverlayValueLines(
            state,
            values.r,
            values.g,
            values.b,
            values.a
          );

          const centerX = (x + 0.5 - state.panX) * state.zoom + halfViewWidth;
          const centerY = (y + 0.5 - state.panY) * state.zoom + halfViewHeight;
          drawValueLines(ctx, valueLines, centerX, centerY, state.zoom, state.zoom);
        }
      }
    } finally {
      ctx.globalAlpha = 1;
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
    this.imageSize = null;
    this.displayEvaluator = null;
    this.overlayContext.clearRect(0, 0, this.viewport.width, this.viewport.height);
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

function prepareValueLabelContext(ctx: CanvasRenderingContext2D): void {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.9)';
}

function drawValueLines(
  ctx: CanvasRenderingContext2D,
  valueLines: ReturnType<typeof buildOverlayValueLines>,
  centerX: number,
  centerY: number,
  cellWidth: number,
  cellHeight: number
): void {
  const fontSize = resolveValueLabelFontSize(ctx, cellWidth, cellHeight, valueLines.length);
  if (fontSize < 5) {
    return;
  }

  ctx.font = `${fontSize}px "IBM Plex Mono", monospace`;
  const lineHeight = fontSize;
  const blockHeight = lineHeight * valueLines.length;
  let textY = centerY - blockHeight * 0.5 + lineHeight * 0.5;

  for (let lineIndex = 0; lineIndex < valueLines.length; lineIndex += 1) {
    const line = valueLines[lineIndex];
    ctx.fillStyle = line?.color ?? 'rgba(255, 255, 255, 0.95)';
    ctx.strokeText(line?.value ?? '', centerX, textY);
    ctx.fillText(line?.value ?? '', centerX, textY);
    textY += lineHeight;
  }
}

function resolveValueLabelFontSize(
  ctx: CanvasRenderingContext2D,
  cellWidth: number,
  cellHeight: number,
  lineCount: number
): number {
  const maxTextWidth = Math.max(1, cellWidth - 5);
  const maxTextHeight = Math.max(1, cellHeight - 5);
  let fontSize = Math.min(20, Math.min(cellWidth, cellHeight) * 0.33);
  ctx.font = `${fontSize}px "IBM Plex Mono", monospace`;

  const sizingProbe = '-1.2e+3';
  const probeWidth = ctx.measureText(sizingProbe).width;
  if (probeWidth > maxTextWidth) {
    fontSize *= maxTextWidth / probeWidth;
  }

  const maxLineHeight = maxTextHeight / Math.max(1, lineCount);
  if (fontSize > maxLineHeight) {
    fontSize = maxLineHeight;
  }

  return Math.floor(fontSize);
}

function resolveValueLabelOpacity(zoom: number): number {
  if (zoom <= VALUE_LABEL_FADE_START_ZOOM) {
    return 0;
  }

  if (zoom >= VALUE_LABEL_FULL_OPACITY_ZOOM) {
    return 1;
  }

  return (zoom - VALUE_LABEL_FADE_START_ZOOM) / (VALUE_LABEL_FULL_OPACITY_ZOOM - VALUE_LABEL_FADE_START_ZOOM);
}

function visibleBounds(state: ViewerState, viewport: ViewportInfo): {
  left: number;
  right: number;
  top: number;
  bottom: number;
} {
  const halfWidth = viewport.width / (2 * state.zoom);
  const halfHeight = viewport.height / (2 * state.zoom);

  return {
    left: state.panX - halfWidth,
    right: state.panX + halfWidth,
    top: state.panY - halfHeight,
    bottom: state.panY + halfHeight
  };
}
