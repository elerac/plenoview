import { GlImageRenderer } from './rendering/gl-image-renderer';
import { resolveDisplayImageSize } from './display-size';
import { OverlayRenderer } from './rendering/overlay-renderer';
import { ProbeOverlayRenderer } from './rendering/probe-overlay-renderer';
import { RulerOverlayRenderer } from './rendering/ruler-overlay-renderer';
import type { ExportImagePixels } from './export/export-pixels';
import type { Disposable } from './lifecycle';
import type { DisplaySourceBinding } from './display/bindings';
import type { ResidentChannelUpload } from './display-cache';
import type { ChannelRecognitionNameRules } from './channel-recognition-name-rules';
import type { DecodedLayer, ViewerRenderState, ViewerState, ViewportInfo } from './types';
import type { ViewerPaneRenderInfo } from './viewer-pane-layout';
import type { ReadExportPixelsArgs } from './rendering/gl-image-renderer';

export class WebGlExrRenderer implements Disposable {
  private readonly imageRenderer: GlImageRenderer;
  private readonly overlayRenderer: OverlayRenderer;
  private readonly probeOverlayRenderer: ProbeOverlayRenderer;
  private readonly rulerOverlayRenderer: RulerOverlayRenderer;
  private rulersVisible = false;
  private panes: ViewerPaneRenderInfo[] = [];
  private disposed = false;

  constructor(
    glCanvas: HTMLCanvasElement,
    overlayCanvas: HTMLCanvasElement,
    probeOverlayCanvas: HTMLCanvasElement,
    rulerOverlaySvg: SVGSVGElement,
    rulerLabelOverlay: HTMLElement
  ) {
    this.imageRenderer = new GlImageRenderer(glCanvas);
    this.overlayRenderer = new OverlayRenderer(overlayCanvas);
    this.probeOverlayRenderer = new ProbeOverlayRenderer(probeOverlayCanvas);
    this.rulerOverlayRenderer = new RulerOverlayRenderer(rulerOverlaySvg, rulerLabelOverlay);
  }

  getViewport(): ViewportInfo {
    return this.panes.find((pane) => pane.active)?.viewport ?? this.panes[0]?.viewport ?? this.imageRenderer.getViewport();
  }

  getImageSize(): { width: number; height: number } | null {
    return this.imageRenderer.getImageSize();
  }

  resize(width: number, height: number, viewportLeft = 0, viewportTop = 0): void {
    if (this.disposed) {
      return;
    }

    this.imageRenderer.resize(width, height, viewportLeft, viewportTop);
    const viewport = this.imageRenderer.getViewport();
    this.overlayRenderer.resize(viewport.width, viewport.height);
    this.probeOverlayRenderer.resize(viewport.width, viewport.height);
    this.rulerOverlayRenderer.resize(viewport.width, viewport.height);
  }

  setViewerPanes(panes: readonly ViewerPaneRenderInfo[]): void {
    if (this.disposed) {
      return;
    }

    this.panes = panes.map(clonePaneRenderInfo);
    this.imageRenderer.setPanes(this.panes);
    this.overlayRenderer.setPanes(this.panes);
    this.probeOverlayRenderer.setPanes(this.panes);
    this.rulerOverlayRenderer.setPanes(this.panes);
  }

  ensureLayerChannelsResident(
    sessionId: string,
    layerIndex: number,
    width: number,
    height: number,
    layer: DecodedLayer,
    channelNames: string[],
    channelRecognitionNameRules?: ChannelRecognitionNameRules
  ): ResidentChannelUpload[] {
    if (this.disposed) {
      return [];
    }

    return this.imageRenderer.ensureLayerChannelsResident(
      sessionId,
      layerIndex,
      width,
      height,
      layer,
      channelNames,
      channelRecognitionNameRules
    );
  }

  setDisplaySelectionBindings(
    sessionId: string,
    layerIndex: number,
    width: number,
    height: number,
    layer: DecodedLayer,
    selection: ViewerState['displaySelection'],
    visualizationMode: ViewerState['visualizationMode'],
    maskInvalidStokesVectors: ViewerState['maskInvalidStokesVectors'] | undefined,
    spectralRgbGroupingEnabled: ViewerState['spectralRgbGroupingEnabled'] | undefined,
    _textureRevisionKey: string,
    binding: DisplaySourceBinding,
    channelRecognitionNameRules?: ViewerState['channelRecognitionNameRules']
  ): void {
    if (this.disposed) {
      return;
    }

    this.imageRenderer.setDisplaySelectionBindings(sessionId, layerIndex, width, height, binding);
    const displaySize = resolveDisplayImageSize(width, height, selection);
    this.overlayRenderer.setDisplaySelectionContext(width, height, layer, selection, visualizationMode, {
      maskInvalidStokesVectors,
      spectralRgbGroupingEnabled,
      channelRecognitionNameRules
    });
    this.probeOverlayRenderer.setImagePresent(true);
    this.probeOverlayRenderer.setSourceContext(width, height, layer);
    this.rulerOverlayRenderer.setImageSize(displaySize.width, displaySize.height);
  }

  setDepthSourceBinding(
    sessionId: string,
    layerIndex: number,
    width: number,
    height: number,
    channelName: string | null,
    depthRange: { min: number; max: number } | null
  ): void {
    if (this.disposed) {
      return;
    }

    this.imageRenderer.setDepthSourceBinding(
      sessionId,
      layerIndex,
      width,
      height,
      channelName,
      depthRange
    );
    this.probeOverlayRenderer.setDepthSourceContext(channelName, depthRange);
  }

  setColormapTexture(entryCount: number, rgba8: Uint8Array): void {
    if (this.disposed) {
      return;
    }

    this.imageRenderer.setColormapTexture(entryCount, rgba8);
  }

  setInvalidValueWarningPhase(phase: number): void {
    if (this.disposed) {
      return;
    }

    this.imageRenderer.setInvalidValueWarningPhase(phase);
  }

  clearColormapTexture(): void {
    if (this.disposed) {
      return;
    }

    this.imageRenderer.clearColormapTexture();
  }

  discardSessionTextures(sessionId: string): void {
    if (this.disposed) {
      return;
    }

    this.imageRenderer.discardSessionTextures(sessionId);
  }

  discardLayerSourceTextures(sessionId: string, layerIndex: number): void {
    if (this.disposed) {
      return;
    }

    this.imageRenderer.discardLayerSourceTextures(sessionId, layerIndex);
  }

  discardChannelMaterializedBuffer(sessionId: string, layerIndex: number, channelName: string): void {
    if (this.disposed) {
      return;
    }

    this.imageRenderer.discardChannelMaterializedBuffer(sessionId, layerIndex, channelName);
  }

  discardChannelSourceTexture(sessionId: string, layerIndex: number, channelName: string): void {
    if (this.disposed) {
      return;
    }

    this.imageRenderer.discardChannelSourceTexture(sessionId, layerIndex, channelName);
  }

  clearImage(): void {
    if (this.disposed) {
      return;
    }

    this.imageRenderer.clearImage();
    this.overlayRenderer.clearImage();
    this.probeOverlayRenderer.clearImage();
    this.rulerOverlayRenderer.clearImage();
  }

  beginPaneRender(): void {
    if (this.disposed) {
      return;
    }

    this.imageRenderer.clearFramebuffer();
    this.overlayRenderer.clearValues();
    this.probeOverlayRenderer.clearOverlay();
    this.rulerOverlayRenderer.clearOverlay();
  }

  render(state: ViewerRenderState): void {
    if (this.disposed) {
      return;
    }

    this.renderImage(state);
    this.renderValueOverlay(state);
    this.renderProbeOverlay(state);
    this.renderRulerOverlay(state);
  }

  renderImage(state: ViewerState): void {
    if (this.disposed) {
      return;
    }

    this.imageRenderer.render(state);
  }

  renderImagePane(pane: ViewerPaneRenderInfo, state: ViewerState): void {
    if (this.disposed) {
      return;
    }

    this.imageRenderer.renderPane(state, pane);
  }

  renderValueOverlay(state: ViewerState): void {
    if (this.disposed) {
      return;
    }

    this.overlayRenderer.renderValues(state);
  }

  renderValueOverlayPane(pane: ViewerPaneRenderInfo, state: ViewerState): void {
    if (this.disposed) {
      return;
    }

    this.overlayRenderer.renderPaneValues(state, pane);
  }

  renderProbeOverlay(state: ViewerState): void {
    if (this.disposed) {
      return;
    }

    this.probeOverlayRenderer.render(state);
  }

  renderProbeOverlayPane(pane: ViewerPaneRenderInfo, state: ViewerState): void {
    if (this.disposed) {
      return;
    }

    this.probeOverlayRenderer.renderPane(state, pane);
  }

  setRulersVisible(visible: boolean): void {
    if (this.disposed) {
      return;
    }

    this.rulersVisible = visible;
  }

  renderRulerOverlay(state: ViewerState): void {
    if (this.disposed) {
      return;
    }

    this.rulerOverlayRenderer.render(state, this.rulersVisible);
  }

  renderRulerOverlayPane(pane: ViewerPaneRenderInfo, state: ViewerState): void {
    if (this.disposed) {
      return;
    }

    this.rulerOverlayRenderer.renderPane(state, this.rulersVisible, pane);
  }

  readExportPixels(args: ReadExportPixelsArgs): ExportImagePixels {
    if (this.disposed) {
      throw new Error('Renderer has been disposed.');
    }

    return this.imageRenderer.readExportPixels(args);
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.rulerOverlayRenderer.dispose();
    this.probeOverlayRenderer.dispose();
    this.overlayRenderer.dispose();
    this.imageRenderer.dispose();
  }
}

function clonePaneRenderInfo(pane: ViewerPaneRenderInfo): ViewerPaneRenderInfo {
  return {
    path: [...pane.path],
    rect: { ...pane.rect },
    viewport: { ...pane.viewport },
    active: pane.active
  };
}
