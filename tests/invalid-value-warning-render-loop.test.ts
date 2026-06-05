import { describe, expect, it, vi } from 'vitest';
import { InvalidValueWarningRenderLoop } from '../src/services/invalid-value-warning-render-loop';
import { createInteractionState, mergeRenderState } from '../src/view-state';
import { createInitialState } from '../src/viewer-store';
import type { ViewerPaneRenderSource } from '../src/app/viewer-app-types';
import type { RenderCacheService } from '../src/services/render-cache-service';
import type { WebGlExrRenderer } from '../src/renderer';
import type { ViewerPaneRenderInfo } from '../src/viewer-pane-layout';
import { createLayerFromChannels } from './helpers/state-fixtures';

describe('invalid value warning render loop', () => {
  it('renders the active warning phase every 500 ms while enabled', () => {
    const harness = createHarness();
    const source = createRenderSource({ invalidValueWarningEnabled: true });
    const loop = new InvalidValueWarningRenderLoop(harness.dependencies);

    loop.sync([source]);

    expect(harness.setTimeout).toHaveBeenCalledWith(expect.any(Function), 500);
    expect(harness.renderer.renderImagePane).not.toHaveBeenCalled();

    harness.flushNext();

    expect(harness.renderer.beginPaneRender).toHaveBeenCalledTimes(1);
    expect(harness.renderer.setInvalidValueWarningPhase).toHaveBeenLastCalledWith(1);
    expect(harness.renderCache.prepareActiveSession).toHaveBeenCalledTimes(1);
    expect(harness.renderer.renderImagePane).toHaveBeenCalledTimes(1);
    expect(harness.renderer.renderImagePane.mock.calls[0]?.[1].invalidValueWarningPhase).toBe(1);

    harness.flushNext();

    expect(harness.renderer.setInvalidValueWarningPhase).toHaveBeenLastCalledWith(0);
    expect(harness.renderer.renderImagePane.mock.calls[1]?.[1].invalidValueWarningPhase).toBe(0);

    loop.dispose();
  });

  it('does not schedule without visible enabled warning sources and cancels when sources disappear', () => {
    const harness = createHarness();
    const loop = new InvalidValueWarningRenderLoop(harness.dependencies);

    loop.sync([createRenderSource({ invalidValueWarningEnabled: false })]);

    expect(harness.setTimeout).not.toHaveBeenCalled();

    loop.sync([createRenderSource({ invalidValueWarningEnabled: true })]);
    expect(harness.queuedTimeoutCount()).toBe(1);

    loop.sync([]);

    expect(harness.clearTimeout).toHaveBeenCalledTimes(1);
    expect(harness.renderer.setInvalidValueWarningPhase).toHaveBeenLastCalledWith(0);
    expect(harness.queuedTimeoutCount()).toBe(0);
  });

  it('renders the matching split pane source and restores its colormap texture', () => {
    const harness = createHarness({
      panes: [
        createPane([], 0, true),
        createPane([1], 100, false)
      ]
    });
    const colormapLut = {
      id: 'lut',
      label: 'LUT',
      entryCount: 2,
      rgba8: new Uint8Array([0, 0, 0, 255, 255, 0, 255, 255])
    };
    const source = createRenderSource({
      path: [1],
      invalidValueWarningEnabled: true,
      colormapLut
    });
    const loop = new InvalidValueWarningRenderLoop(harness.dependencies);

    loop.sync([source]);
    harness.flushNext();

    expect(harness.renderer.setColormapTexture).toHaveBeenCalledWith(2, colormapLut.rgba8);
    expect(harness.renderer.renderImagePane.mock.calls[0]?.[0]).toEqual(createPane([1], 100, false));

    loop.dispose();
  });
});

function createHarness(options: { panes?: ViewerPaneRenderInfo[] } = {}) {
  let nextTimeoutHandle = 1;
  const timeouts = new Map<number, () => void>();
  const renderer = createRendererMock();
  const renderCache = createRenderCacheMock();
  const setTimeout = vi.fn((handler: () => void) => {
    const handle = nextTimeoutHandle;
    nextTimeoutHandle += 1;
    timeouts.set(handle, handler);
    return handle;
  });
  const clearTimeout = vi.fn((handle: number) => {
    timeouts.delete(handle);
  });
  return {
    renderer,
    renderCache,
    setTimeout,
    clearTimeout,
    dependencies: {
      renderer: renderer as unknown as WebGlExrRenderer,
      renderCache: renderCache as unknown as RenderCacheService,
      getPanes: () => options.panes ?? [createPane([], 0, true)],
      setTimeout,
      clearTimeout
    },
    flushNext: () => {
      const [handle, callback] = timeouts.entries().next().value as [number, () => void];
      timeouts.delete(handle);
      callback();
    },
    queuedTimeoutCount: () => timeouts.size
  };
}

function createRendererMock() {
  return {
    setInvalidValueWarningPhase: vi.fn(),
    beginPaneRender: vi.fn(),
    setColormapTexture: vi.fn(),
    clearColormapTexture: vi.fn(),
    renderImagePane: vi.fn(),
    renderValueOverlayPane: vi.fn(),
    renderProbeOverlayPane: vi.fn(),
    renderRulerOverlayPane: vi.fn()
  };
}

function createRenderCacheMock() {
  return {
    setVisibleDisplaySources: vi.fn(),
    prepareActiveSession: vi.fn()
  };
}

function createRenderSource(options: {
  invalidValueWarningEnabled: boolean;
  path?: number[];
  colormapLut?: ViewerPaneRenderSource['colormapLut'];
}): ViewerPaneRenderSource {
  const layer = createLayerFromChannels({ R: [1], G: [0], B: [0] });
  const decoded = {
    width: 1,
    height: 1,
    layers: [layer]
  };
  const sessionState = createInitialState();
  const renderState = mergeRenderState(sessionState, createInteractionState(sessionState), {
    invalidValueWarningEnabled: options.invalidValueWarningEnabled
  });
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
