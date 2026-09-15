import { describe, expect, it, vi } from 'vitest';
import type { ViewerPaneRenderSource } from '../src/app/viewer-app-types';
import type { WebGlExrRenderer } from '../src/renderer';
import { PathTracingRenderLoop } from '../src/services/path-tracing-render-loop';
import type { RenderCacheService } from '../src/services/render-cache-service';
import { createInteractionState, mergeRenderState } from '../src/view-state';
import type { ViewerRenderState } from '../src/types';
import type { ViewerPaneRenderInfo } from '../src/viewer-pane-layout';
import { createInitialState } from '../src/viewer-store';
import { createLayerFromChannels } from './helpers/state-fixtures';

describe('path tracing render loop', () => {
  it('redraws every visible pane while a path-traced pane is converging', () => {
    const harness = createHarness({
      panes: [createPane([], 0, true), createPane([1], 100, false)]
    });
    const loop = new PathTracingRenderLoop(harness.dependencies);
    const pathTraced = createRenderSource({ pathTracing: true });
    const ordinary = createRenderSource({ path: [1], pathTracing: false });
    harness.renderer.renderImagePane.mockImplementation((_pane, state) => (
      state.viewerMode === 'panorama' && state.panoramaDisplayMode === 'environmentLighting'
    ));

    loop.sync([pathTraced, ordinary]);
    harness.flushNext();

    expect(harness.renderer.beginProgressiveImageRender).toHaveBeenCalledTimes(1);
    expect(harness.renderCache.prepareActiveSession).toHaveBeenCalledTimes(2);
    expect(harness.renderer.renderImagePane.mock.calls.filter((call) => (
      call[1].viewerMode === 'panorama' && call[1].panoramaDisplayMode === 'environmentLighting'
    ))).toHaveLength(1);
    expect(harness.renderer.renderImagePane).toHaveBeenCalledWith(
      createPane([1], 100, false),
      expect.objectContaining({ viewerMode: 'image' })
    );
    expect(harness.queuedFrameCount()).toBe(1);

    harness.renderer.renderImagePane.mockReturnValue(false);
    harness.flushNext();

    expect(harness.renderer.beginProgressiveImageRender).toHaveBeenCalledTimes(2);
    expect(harness.queuedFrameCount()).toBe(0);
    loop.dispose();
  });

  it('does not schedule without a panorama source and cancels on mode exit', () => {
    const harness = createHarness();
    const loop = new PathTracingRenderLoop(harness.dependencies);

    loop.sync([createRenderSource({ pathTracing: false })]);
    expect(harness.requestAnimationFrame).not.toHaveBeenCalled();

    loop.sync([createRenderSource({ pathTracing: true })]);
    expect(harness.queuedFrameCount()).toBe(1);

    loop.sync([createRenderSource({ pathTracing: false })]);
    expect(harness.cancelAnimationFrame).toHaveBeenCalledTimes(1);
    expect(harness.queuedFrameCount()).toBe(0);
  });

  it('polls ordinary panorama compilation once per frame and stops when ready', () => {
    const harness = createHarness();
    const loop = new PathTracingRenderLoop(harness.dependencies);
    harness.renderer.renderImagePane.mockReturnValueOnce(true).mockReturnValueOnce(true).mockReturnValue(false);

    loop.sync([createRenderSource({ pathTracing: false, panorama: true })]);
    harness.flushNext();
    expect(harness.renderer.renderImagePane).toHaveBeenCalledTimes(1);
    expect(harness.queuedFrameCount()).toBe(1);
    harness.flushNext();
    expect(harness.renderer.renderImagePane).toHaveBeenCalledTimes(2);
    expect(harness.queuedFrameCount()).toBe(1);
    harness.flushNext();
    expect(harness.renderer.renderImagePane).toHaveBeenCalledTimes(3);
    expect(harness.queuedFrameCount()).toBe(0);
    loop.dispose();
  });

  it('cancels an ordinary panorama compilation poll when leaving the mode or disposing', () => {
    const harness = createHarness();
    const loop = new PathTracingRenderLoop(harness.dependencies);
    harness.renderer.renderImagePane.mockReturnValue(true);

    loop.sync([createRenderSource({ pathTracing: false, panorama: true })]);
    harness.flushNext();
    loop.sync([createRenderSource({ pathTracing: false })]);
    expect(harness.queuedFrameCount()).toBe(0);
    expect(harness.cancelAnimationFrame).toHaveBeenCalledTimes(1);

    loop.sync([createRenderSource({ pathTracing: false, panorama: true })]);
    expect(harness.queuedFrameCount()).toBe(1);
    loop.dispose();
    expect(harness.queuedFrameCount()).toBe(0);
    expect(harness.cancelAnimationFrame).toHaveBeenCalledTimes(2);
  });

  it('reports a shader failure once, stops polling, and can render a later selection', () => {
    const harness = createHarness();
    const loop = new PathTracingRenderLoop(harness.dependencies);
    const failure = new Error('Fragment shader compile failed');
    harness.renderer.renderImagePane.mockImplementationOnce(() => { throw failure; });

    loop.sync([createRenderSource({ pathTracing: false, panorama: true })]);
    harness.flushNext();
    expect(harness.onError).toHaveBeenCalledTimes(1);
    expect(harness.onError).toHaveBeenCalledWith(failure);
    loop.wake();
    expect(harness.queuedFrameCount()).toBe(0);
    expect(harness.queuedDelayCount()).toBe(0);

    loop.sync([createRenderSource({ pathTracing: true })]);
    harness.flushNext();
    expect(harness.renderer.renderImagePane).toHaveBeenCalledTimes(2);
    expect(harness.onError).toHaveBeenCalledTimes(1);
    expect(harness.queuedFrameCount()).toBe(0);
    loop.dispose();
  });

  it('restores the source colormap before each progressive pane render', () => {
    const harness = createHarness();
    const colormapLut = {
      id: 'lut',
      label: 'LUT',
      entryCount: 2,
      rgba8: new Uint8Array([0, 0, 0, 255, 255, 255, 255, 255])
    };
    const loop = new PathTracingRenderLoop(harness.dependencies);

    loop.sync([createRenderSource({ pathTracing: true, colormapLut })]);
    harness.flushNext();

    expect(harness.renderer.setColormapTexture).toHaveBeenCalledWith(
      colormapLut.entryCount,
      colormapLut.rgba8
    );
    loop.dispose();
  });

  it('yields between expensive GPU submissions so interaction tasks can run', () => {
    const harness = createHarness({ nowValues: [0, 80] });
    harness.renderer.renderImagePane.mockReturnValue(true);
    const loop = new PathTracingRenderLoop(harness.dependencies);

    loop.sync([createRenderSource({ pathTracing: true })]);
    harness.flushNext();

    expect(harness.queuedFrameCount()).toBe(0);
    expect(harness.queuedDelayCount()).toBe(1);
    expect(harness.setTimeout).toHaveBeenCalledWith(expect.any(Function), 16);

    loop.sync([createRenderSource({ pathTracing: false })]);
    expect(harness.clearTimeout).toHaveBeenCalledTimes(1);
    expect(harness.queuedDelayCount()).toBe(0);
  });
});

function createHarness(options: {
  panes?: ViewerPaneRenderInfo[];
  nowValues?: number[];
} = {}) {
  let nextFrameHandle = 1;
  let nextDelayHandle = 1;
  const frames = new Map<number, FrameRequestCallback>();
  const delays = new Map<number, () => void>();
  const nowValues = [...(options.nowValues ?? [])];
  const renderer = createRendererMock();
  const renderCache = { prepareActiveSession: vi.fn() };
  const onError = vi.fn();
  const requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
    const handle = nextFrameHandle;
    nextFrameHandle += 1;
    frames.set(handle, callback);
    return handle;
  });
  const cancelAnimationFrame = vi.fn((handle: number) => {
    frames.delete(handle);
  });
  const setTimeout = vi.fn((callback: () => void, _delayMs: number) => {
    const handle = nextDelayHandle;
    nextDelayHandle += 1;
    delays.set(handle, callback);
    return handle;
  });
  const clearTimeout = vi.fn((handle: number) => {
    delays.delete(handle);
  });
  return {
    renderer,
    renderCache,
    requestAnimationFrame,
    cancelAnimationFrame,
    onError,
    dependencies: {
      renderer: renderer as unknown as WebGlExrRenderer,
      renderCache: renderCache as unknown as RenderCacheService,
      getPanes: () => options.panes ?? [createPane([], 0, true)],
      requestAnimationFrame,
      cancelAnimationFrame,
      setTimeout,
      clearTimeout,
      onError,
      now: () => nowValues.shift() ?? 0
    },
    flushNext: () => {
      const [handle, callback] = frames.entries().next().value as [
        number,
        FrameRequestCallback
      ];
      frames.delete(handle);
      callback(0);
    },
    queuedFrameCount: () => frames.size,
    queuedDelayCount: () => delays.size,
    setTimeout,
    clearTimeout
  };
}

function createRendererMock() {
  return {
    beginProgressiveImageRender: vi.fn(),
    setColormapTexture: vi.fn(),
    clearColormapTexture: vi.fn(),
    renderImagePane: vi.fn((_pane: ViewerPaneRenderInfo, _state: ViewerRenderState) => false)
  };
}

function createRenderSource(options: {
  pathTracing: boolean;
  panorama?: boolean;
  path?: number[];
  colormapLut?: ViewerPaneRenderSource['colormapLut'];
}): ViewerPaneRenderSource {
  const layer = createLayerFromChannels({ R: [1], G: [0], B: [0] });
  const decoded = { width: 1, height: 1, layers: [layer] };
  const sessionState = {
    ...createInitialState(),
    viewerMode: options.pathTracing || options.panorama ? 'panorama' : 'image',
    panoramaDisplayMode: options.pathTracing ? 'environmentLighting' : 'image',
    panoramaLightingMethod: 'pathTracing'
  } as const;
  const renderState = mergeRenderState(
    sessionState,
    createInteractionState(sessionState)
  );
  return {
    path: options.path ?? [],
    active: true,
    session: {
      id: 'session-1',
      filename: 'image.exr',
      displayName: 'image.exr',
      fileSizeBytes: 16,
      source: { kind: 'url', url: '/image.exr' },
      decoded,
      state: sessionState
    },
    activeLayer: 0,
    layer,
    renderState,
    colormapLut: options.colormapLut ?? null
  };
}

function createPane(path: number[], x: number, active: boolean): ViewerPaneRenderInfo {
  return {
    path,
    rect: { x, y: 0, width: 100, height: 80 },
    viewport: { width: 100, height: 80 },
    active
  };
}
