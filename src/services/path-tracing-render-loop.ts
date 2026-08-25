import type { ViewerPaneRenderSource } from '../app/viewer-app-types';
import { usesPathTracingEnvironmentLighting } from '../panorama-lighting';
import type { Disposable } from '../lifecycle';
import type { WebGlExrRenderer } from '../renderer';
import type { ViewerPaneRenderInfo } from '../viewer-pane-layout';
import type { RenderCacheService } from './render-cache-service';

interface PathTracingRenderLoopDependencies {
  renderer: WebGlExrRenderer;
  renderCache: RenderCacheService;
  getPanes: () => ViewerPaneRenderInfo[];
  requestAnimationFrame?: (callback: FrameRequestCallback) => number;
  cancelAnimationFrame?: (handle: number) => void;
  setTimeout?: (callback: () => void, delayMs: number) => number;
  clearTimeout?: (handle: number) => void;
  now?: () => number;
}

const MAX_PATH_TRACING_PASSES_PER_FRAME = 4;
const TARGET_PATH_TRACING_PIXEL_SAMPLES_PER_FRAME = 750_000;
const FAST_PATH_TRACING_FRAME_MS = 8;
const LONG_PATH_TRACING_FRAME_MS = 24;
const MAX_PATH_TRACING_YIELD_MS = 100;

export class PathTracingRenderLoop implements Disposable {
  private readonly renderer: WebGlExrRenderer;
  private readonly renderCache: RenderCacheService;
  private readonly getPanes: () => ViewerPaneRenderInfo[];
  private readonly scheduleFrame: (callback: FrameRequestCallback) => number;
  private readonly cancelFrame: (handle: number) => void;
  private readonly scheduleDelay: (callback: () => void, delayMs: number) => number;
  private readonly cancelDelay: (handle: number) => void;
  private readonly now: () => number;
  private sources: ViewerPaneRenderSource[] = [];
  private frameHandle: number | null = null;
  private delayHandle: number | null = null;
  private passesPerFrame = 1;
  private disposed = false;

  constructor(dependencies: PathTracingRenderLoopDependencies) {
    this.renderer = dependencies.renderer;
    this.renderCache = dependencies.renderCache;
    this.getPanes = dependencies.getPanes;
    this.scheduleFrame = dependencies.requestAnimationFrame ?? window.requestAnimationFrame.bind(window);
    this.cancelFrame = dependencies.cancelAnimationFrame ?? window.cancelAnimationFrame.bind(window);
    this.scheduleDelay = dependencies.setTimeout ?? window.setTimeout.bind(window);
    this.cancelDelay = dependencies.clearTimeout ?? window.clearTimeout.bind(window);
    this.now = dependencies.now ?? performance.now.bind(performance);
  }

  sync(sources: readonly ViewerPaneRenderSource[]): void {
    if (this.disposed) {
      return;
    }

    this.sources = sources.map(cloneViewerPaneRenderSource);
    this.passesPerFrame = 1;
    if (!this.shouldRun()) {
      this.stop();
      return;
    }
    this.cancelDelayedWake();
    this.wake();
  }

  wake(): void {
    if (this.disposed || !this.shouldRun()) {
      return;
    }
    this.cancelDelayedWake();
    if (this.frameHandle !== null) {
      return;
    }
    this.frameHandle = this.scheduleFrame(this.tick);
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.stop();
    this.sources = [];
  }

  private readonly tick = (): void => {
    this.frameHandle = null;
    if (this.disposed || !this.shouldRun()) {
      return;
    }

    const panes = this.getPanes();
    const maximumPassesPerFrame = resolveMaximumPathTracingPassesPerFrame(
      new Map(panes.map((pane) => [serializePanePath(pane.path), pane])),
      this.sources
    );
    const startTime = this.now();
    const needsMoreSamples = renderPathTracingSources(
      this.renderer,
      this.renderCache,
      panes,
      this.sources,
      Math.min(this.passesPerFrame, maximumPassesPerFrame)
    );
    const elapsedMs = Math.max(0, this.now() - startTime);
    if (elapsedMs > LONG_PATH_TRACING_FRAME_MS) {
      this.passesPerFrame = Math.max(1, Math.floor(this.passesPerFrame / 2));
    } else if (
      elapsedMs < FAST_PATH_TRACING_FRAME_MS &&
      this.passesPerFrame < maximumPassesPerFrame
    ) {
      this.passesPerFrame += 1;
    }
    if (needsMoreSamples) {
      if (elapsedMs > LONG_PATH_TRACING_FRAME_MS) {
        this.scheduleDelayedWake(Math.min(
          MAX_PATH_TRACING_YIELD_MS,
          Math.max(16, elapsedMs * 0.1)
        ));
      } else {
        this.wake();
      }
    }
  };

  private shouldRun(): boolean {
    return this.sources.some((source) => usesPathTracingEnvironmentLighting(source.renderState));
  }

  private stop(): void {
    if (this.frameHandle !== null) {
      this.cancelFrame(this.frameHandle);
      this.frameHandle = null;
    }
    this.cancelDelayedWake();
  }

  private scheduleDelayedWake(delayMs: number): void {
    if (this.delayHandle !== null || this.disposed || !this.shouldRun()) {
      return;
    }
    this.delayHandle = this.scheduleDelay(() => {
      this.delayHandle = null;
      this.wake();
    }, delayMs);
  }

  private cancelDelayedWake(): void {
    if (this.delayHandle !== null) {
      this.cancelDelay(this.delayHandle);
      this.delayHandle = null;
    }
  }
}

function renderPathTracingSources(
  renderer: WebGlExrRenderer,
  renderCache: RenderCacheService,
  panes: readonly ViewerPaneRenderInfo[],
  sources: readonly ViewerPaneRenderSource[],
  passesPerPathTracedPane: number
): boolean {
  const panesByPath = new Map(panes.map((pane) => [serializePanePath(pane.path), pane]));
  let needsMoreSamples = false;
  renderer.beginProgressiveImageRender();
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
    renderCache.prepareActiveSession(source.session, source.renderState);
    const passCount = usesPathTracingEnvironmentLighting(source.renderState)
      ? passesPerPathTracedPane
      : 1;
    let sourceNeedsMoreSamples = false;
    for (let passIndex = 0; passIndex < passCount; passIndex += 1) {
      sourceNeedsMoreSamples = renderer.renderImagePane(pane, source.renderState);
      if (!sourceNeedsMoreSamples) {
        break;
      }
    }
    needsMoreSamples = sourceNeedsMoreSamples || needsMoreSamples;
  }
  return needsMoreSamples;
}

function resolveMaximumPathTracingPassesPerFrame(
  panesByPath: ReadonlyMap<string, ViewerPaneRenderInfo>,
  sources: readonly ViewerPaneRenderSource[]
): number {
  let panePixelEstimate = 0;
  for (const source of sources) {
    if (!usesPathTracingEnvironmentLighting(source.renderState)) {
      continue;
    }
    const pane = panesByPath.get(serializePanePath(source.path));
    if (pane) {
      panePixelEstimate += Math.max(1, pane.rect.width) * Math.max(1, pane.rect.height);
    }
  }
  return Math.max(1, Math.min(
    MAX_PATH_TRACING_PASSES_PER_FRAME,
    Math.floor(TARGET_PATH_TRACING_PIXEL_SAMPLES_PER_FRAME /
      Math.max(panePixelEstimate, 1))
  ));
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
