import { createEmptyDisplaySourceBinding, type DisplaySourceBinding } from '../../display/bindings';
import type { ResidentChannelUpload } from '../../display-cache';
import {
  createAdaptiveDepthPointBudgetResolver,
  type DepthPointBudgetResolver
} from '../../depth-point-budget';
import type { DepthSource, DepthSourceGeometry } from '../../depth';
import type { ExportImagePixels } from '../../export/export-pixels';
import type { ChannelRecognitionNameRules } from '../../channel-recognition-name-rules';
import type { Disposable } from '../../lifecycle';
import type { EnvironmentImportanceSamplingTable } from '../../panorama-lighting';
import { usesPathTracingEnvironmentLighting } from '../../panorama-lighting';
import { normalizeEnvironmentSphereMaterial } from '../../environment-sphere-material';
import type { DecodedLayer, ViewerState, ViewportInfo } from '../../types';
import type { ViewerPaneRenderInfo } from '../../viewer-pane-layout';
import { REQUIRED_TEXTURE_UNITS } from './constants';
import { clearColormapTexture, setColormapTexture } from './colormap-texture';
import {
  clearEnvironmentImportanceTextureState,
  setEnvironmentImportanceTexture
} from './environment-importance-texture';
import { deleteExportSurface, readExportPixels } from './export-surface';
import { render } from './render-pass';
import {
  clearPathTracingSurfaces,
  prunePathTracingSurfaces
} from './path-tracing-surface';
import { createGlImageRendererState } from './shared-state';
import {
  discardChannelMaterializedBuffer,
  discardChannelSourceTexture,
  discardLayerSourceTextures,
  discardSessionTextures,
  ensureLayerChannelsResident,
  setDepthSourceBinding,
  setDisplaySelectionBindings
} from './texture-store';
import type { GlImageRendererState, ReadExportPixelsArgs } from './types';

export class GlImageRenderer implements Disposable {
  private readonly state: GlImageRendererState;
  private panes: ViewerPaneRenderInfo[] = [];

  private get layerTexturesBySession() {
    return this.state.layerTexturesBySession;
  }

  constructor(
    glCanvas: HTMLCanvasElement,
    resolveDepthPointBudget: DepthPointBudgetResolver = createAdaptiveDepthPointBudgetResolver()
  ) {
    this.state = createGlImageRendererState(glCanvas, resolveDepthPointBudget);
  }

  getViewport(): ViewportInfo {
    return this.state.viewport;
  }

  getImageSize(): { width: number; height: number } | null {
    return this.state.imageSize;
  }

  setPanes(panes: readonly ViewerPaneRenderInfo[]): void {
    this.panes = panes.map(clonePaneRenderInfo);
    prunePathTracingSurfaces(
      this.state,
      new Set(this.panes.length > 0
        ? this.panes.map(pane => serializePanePath(pane.path))
        : ['root'])
    );
  }

  resize(
    width: number,
    height: number,
    left = 0,
    top = 0,
    pixelRatio = readOutputPixelRatio()
  ): void {
    if (this.state.disposed) {
      return;
    }

    const previousCanvasWidth = this.state.glCanvas.width;
    const previousCanvasHeight = this.state.glCanvas.height;
    this.state.viewport = {
      width: Math.max(1, Math.floor(width)),
      height: Math.max(1, Math.floor(height))
    };
    this.state.viewportOrigin = {
      left: Number.isFinite(left) ? left : 0,
      top: Number.isFinite(top) ? top : 0
    };

    const normalizedPixelRatio = normalizeOutputPixelRatio(pixelRatio);
    this.state.glCanvas.width = Math.max(1, Math.round(this.state.viewport.width * normalizedPixelRatio));
    this.state.glCanvas.height = Math.max(1, Math.round(this.state.viewport.height * normalizedPixelRatio));
    if (
      this.state.glCanvas.width !== previousCanvasWidth ||
      this.state.glCanvas.height !== previousCanvasHeight
    ) {
      clearPathTracingSurfaces(this.state);
    }
    this.state.outputPixelScale = {
      x: this.state.glCanvas.width / this.state.viewport.width,
      y: this.state.glCanvas.height / this.state.viewport.height
    };
    this.state.gl.viewport(0, 0, this.state.glCanvas.width, this.state.glCanvas.height);
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
    if (this.state.disposed) {
      return [];
    }

    return ensureLayerChannelsResident(
      this.state,
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
    binding: DisplaySourceBinding,
    sourceRevisionKey?: string
  ): void {
    if (this.state.disposed) {
      return;
    }

    setDisplaySelectionBindings(this.state, sessionId, layerIndex, width, height, binding);
    this.state.activeSourceRevisionKey = [
      sessionId,
      layerIndex,
      sourceRevisionKey ?? '',
      binding.mode,
      binding.stokesParameter,
      binding.usesImageAlpha,
      ...binding.slots
    ].join(':');
  }

  setDepthSourceBinding(
    sessionId: string,
    layerIndex: number,
    width: number,
    height: number,
    source: DepthSource | null,
    geometry: DepthSourceGeometry | null
  ): void {
    if (this.state.disposed) {
      return;
    }

    setDepthSourceBinding(this.state, sessionId, layerIndex, width, height, source, geometry);
  }

  setColormapTexture(entryCount: number, rgba8: Uint8Array): void {
    if (this.state.disposed) {
      return;
    }

    setColormapTexture(this.state, entryCount, rgba8);
  }

  setInvalidValueWarningPhase(phase: number): void {
    if (this.state.disposed) {
      return;
    }

    this.state.invalidValueWarningPhase = phase >= 0.5 ? 1 : 0;
  }

  setEnvironmentImportanceSampling(table: EnvironmentImportanceSamplingTable): void {
    if (this.state.disposed) {
      return;
    }

    setEnvironmentImportanceTexture(this.state, table);
  }

  clearColormapTexture(): void {
    if (this.state.disposed) {
      return;
    }

    clearColormapTexture(this.state);
  }

  discardSessionTextures(sessionId: string): void {
    if (this.state.disposed) {
      return;
    }

    discardSessionTextures(this.state, sessionId);
    this.state.environmentRadianceCache.deleteByPrefix(`${sessionId}:`);
    clearPathTracingSurfaces(this.state);
  }

  discardLayerSourceTextures(sessionId: string, layerIndex: number): void {
    if (this.state.disposed) {
      return;
    }

    discardLayerSourceTextures(this.state, sessionId, layerIndex);
    this.state.environmentRadianceCache.deleteByPrefix(`${sessionId}:${layerIndex}:`);
    clearPathTracingSurfaces(this.state);
  }

  discardChannelMaterializedBuffer(sessionId: string, layerIndex: number, channelName: string): void {
    if (this.state.disposed) {
      return;
    }

    discardChannelMaterializedBuffer(this.state, sessionId, layerIndex, channelName);
  }

  discardChannelSourceTexture(sessionId: string, layerIndex: number, channelName: string): void {
    if (this.state.disposed) {
      return;
    }

    discardChannelSourceTexture(this.state, sessionId, layerIndex, channelName);
    this.state.environmentRadianceCache.deleteByPrefix(`${sessionId}:${layerIndex}:`);
  }

  clearImage(): void {
    if (this.state.disposed) {
      return;
    }

    this.state.imageSize = null;
    this.state.depthSourceSize = null;
    this.state.activeDepthSource = null;
    this.state.activeDepthTextures = null;
    this.state.activeDepthGeometry = null;
    this.state.activeBinding = createEmptyDisplaySourceBinding();
    this.state.activeSourceRevisionKey = '';
    this.state.activePolarizedEnvironment = null;
    this.state.activeSourceTextures = [];
    clearEnvironmentImportanceTextureState(this.state);
    clearPathTracingSurfaces(this.state);
    this.clearFramebuffer();
  }

  clearFramebuffer(): void {
    if (this.state.disposed) {
      return;
    }

    this.state.preparingPanorama = false;
    this.state.glCanvas.setAttribute('aria-busy', 'false');
    this.state.gl.bindFramebuffer(this.state.gl.FRAMEBUFFER, null);
    this.state.gl.viewport(0, 0, this.state.glCanvas.width, this.state.glCanvas.height);
    this.state.gl.clearColor(0, 0, 0, 0);
    this.state.gl.clear(this.state.gl.COLOR_BUFFER_BIT);
  }

  readExportPixels(args: ReadExportPixelsArgs): ExportImagePixels {
    if (this.state.disposed) {
      throw new Error('Renderer has been disposed.');
    }

    return readExportPixels(this.state, args);
  }

  async preparePanoramaPrograms(state: ViewerState, signal?: AbortSignal): Promise<void> {
    // Capture the prepared export source before another pane can change it
    // while the shader compilation promise is pending.
    const polarized = Boolean(this.state.activePolarizedEnvironment);
    const material = normalizeEnvironmentSphereMaterial(state.environmentSphereMaterial);
    await this.state.panoramaPrograms.prepare(state, signal, polarized,
      polarized && this.state.pathTracingFloatAccumulationSupported);
    if (state.viewerMode !== 'panorama' || !usesPathTracingEnvironmentLighting(state) ||
      (polarized && material.type !== 'roughplastic')) return;
    for (;;) {
      signal?.throwIfAborted();
      if (this.state.roughPlasticTransmittanceCache.prepare(material)) return;
      await new Promise<void>(resolve => setTimeout(resolve, 16));
    }
  }

  render(state: ViewerState): boolean {
    if (this.state.disposed) {
      return false;
    }

    return render(this.state, state, this.panes);
  }

  renderPane(state: ViewerState, pane: ViewerPaneRenderInfo): boolean {
    if (this.state.disposed) {
      return false;
    }

    return render(this.state, state, [pane], { clear: false });
  }

  dispose(): void {
    if (this.state.disposed) {
      return;
    }

    this.state.disposed = true;
    for (const sessionId of this.state.layerTexturesBySession.keys()) {
      discardSessionTextures(this.state, sessionId);
    }
    this.state.layerTexturesBySession.clear();
    this.state.imageSize = null;
    this.state.depthSourceSize = null;
    this.state.activeDepthSource = null;
    this.state.activeDepthTextures = null;
    this.state.activeDepthGeometry = null;
    this.state.colormapEntryCount = 0;
    this.state.activeBinding = createEmptyDisplaySourceBinding();
    this.state.activeSourceRevisionKey = '';
    this.state.activePolarizedEnvironment = null;
    this.state.activeSourceTextures = [];
    clearEnvironmentImportanceTextureState(this.state);
    clearPathTracingSurfaces(this.state);
    deleteExportSurface(this.state.gl, this.state.exportSourceSurface);
    this.state.exportSourceSurface = null;
    this.state.gl.bindVertexArray(null);
    this.state.gl.useProgram(null);
    for (let slotIndex = 0; slotIndex < REQUIRED_TEXTURE_UNITS; slotIndex += 1) {
      this.state.gl.activeTexture(this.state.gl.TEXTURE0 + slotIndex);
      this.state.gl.bindTexture(this.state.gl.TEXTURE_2D, null);
    }
    this.state.gl.deleteTexture(this.state.zeroTexture);
    this.state.gl.deleteTexture(this.state.colormapTexture);
    this.state.gl.deleteTexture(this.state.environmentImportanceTexture);
    this.state.gl.deleteVertexArray(this.state.vao);
    this.state.gl.deleteProgram(this.state.imageProgram.program);
    this.state.panoramaPrograms.dispose();
    this.state.environmentRadianceCache.dispose();
    this.state.roughPlasticTransmittanceCache.dispose();
    this.state.gl.deleteProgram(this.state.pathTracingPresentProgram.program);
    this.state.gl.deleteProgram(this.state.depthProgram.program);
  }
}

function readOutputPixelRatio(): number {
  return typeof window === 'undefined' ? 1 : window.devicePixelRatio;
}

function normalizeOutputPixelRatio(pixelRatio: number): number {
  return Number.isFinite(pixelRatio) && pixelRatio > 0 ? pixelRatio : 1;
}

function clonePaneRenderInfo(pane: ViewerPaneRenderInfo): ViewerPaneRenderInfo {
  return {
    path: [...pane.path],
    rect: { ...pane.rect },
    viewport: { ...pane.viewport },
    active: pane.active
  };
}

function serializePanePath(path: readonly number[]): string {
  return path.length === 0 ? 'root' : path.join('.');
}
