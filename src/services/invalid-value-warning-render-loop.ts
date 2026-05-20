import type { ViewerPaneRenderSource } from '../app/viewer-app-types';
import type { RenderCacheService } from './render-cache-service';
import type { Disposable } from '../lifecycle';
import type { WebGlExrRenderer } from '../renderer';
import type { ViewerPaneRenderInfo } from '../viewer-pane-layout';

interface InvalidValueWarningRenderLoopDependencies {
  renderer: WebGlExrRenderer;
  renderCache: RenderCacheService;
  getPanes: () => ViewerPaneRenderInfo[];
  setTimeout?: (handler: () => void, timeout: number) => number;
  clearTimeout?: (handle: number) => void;
}

const INVALID_VALUE_WARNING_INTERVAL_MS = 500;

export class InvalidValueWarningRenderLoop implements Disposable {
  private readonly renderer: WebGlExrRenderer;
  private readonly renderCache: RenderCacheService;
  private readonly getPanes: () => ViewerPaneRenderInfo[];
  private readonly scheduleTimeout: (handler: () => void, timeout: number) => number;
  private readonly cancelTimeout: (handle: number) => void;
  private sources: ViewerPaneRenderSource[] = [];
  private timerHandle: number | null = null;
  private phase = 0;
  private disposed = false;

  constructor(dependencies: InvalidValueWarningRenderLoopDependencies) {
    this.renderer = dependencies.renderer;
    this.renderCache = dependencies.renderCache;
    this.getPanes = dependencies.getPanes;
    this.scheduleTimeout = dependencies.setTimeout ?? window.setTimeout.bind(window);
    this.cancelTimeout = dependencies.clearTimeout ?? window.clearTimeout.bind(window);
  }

  sync(sources: readonly ViewerPaneRenderSource[]): void {
    if (this.disposed) {
      return;
    }

    this.sources = sources.map(cloneViewerPaneRenderSource);
    if (!this.shouldRun()) {
      this.stop();
      return;
    }

    if (this.timerHandle === null) {
      this.phase = 0;
      this.renderer.setInvalidValueWarningPhase(this.phase);
      this.scheduleNextTick();
    }
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.stop();
    this.sources = [];
  }

  private shouldRun(): boolean {
    return this.sources.some((source) => source.renderState.invalidValueWarningEnabled !== false);
  }

  private scheduleNextTick(): void {
    this.timerHandle = this.scheduleTimeout(() => {
      this.timerHandle = null;
      this.tick();
    }, INVALID_VALUE_WARNING_INTERVAL_MS);
  }

  private tick(): void {
    if (this.disposed || !this.shouldRun()) {
      this.stop();
      return;
    }

    this.phase = this.phase >= 0.5 ? 0 : 1;
    this.renderer.setInvalidValueWarningPhase(this.phase);
    renderWarningPhaseSources(
      this.renderer,
      this.renderCache,
      this.getPanes(),
      this.sources,
      this.phase
    );
    this.scheduleNextTick();
  }

  private stop(): void {
    if (this.timerHandle !== null) {
      this.cancelTimeout(this.timerHandle);
      this.timerHandle = null;
    }
    this.phase = 0;
    this.renderer.setInvalidValueWarningPhase(this.phase);
  }
}

function renderWarningPhaseSources(
  renderer: WebGlExrRenderer,
  renderCache: RenderCacheService,
  panes: readonly ViewerPaneRenderInfo[],
  sources: readonly ViewerPaneRenderSource[],
  phase: number
): void {
  const panesByPath = new Map(panes.map((pane) => [serializePanePath(pane.path), pane]));
  renderer.beginPaneRender();
  for (const source of sources) {
    const pane = panesByPath.get(serializePanePath(source.path));
    if (!pane) {
      continue;
    }

    if (source.colormapLut) {
      renderer.setColormapTexture(source.colormapLut.entryCount, source.colormapLut.rgba8);
    } else {
      renderer.clearColormapTexture();
    }
    const renderState = {
      ...source.renderState,
      invalidValueWarningPhase: phase
    };
    renderCache.prepareActiveSession(source.session, renderState);
    renderer.renderImagePane(pane, renderState);
    renderer.renderValueOverlayPane(pane, renderState);
    renderer.renderProbeOverlayPane(pane, renderState);
    renderer.renderRulerOverlayPane(pane, renderState);
  }
}

function cloneViewerPaneRenderSource(source: ViewerPaneRenderSource): ViewerPaneRenderSource {
  return {
    ...source,
    path: [...source.path],
    renderState: { ...source.renderState }
  };
}

function serializePanePath(path: readonly number[]): string {
  return path.join('.');
}
