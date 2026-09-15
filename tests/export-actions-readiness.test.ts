import { describe, expect, it, vi } from 'vitest';
import {
  createImageExportPixelsResolver,
  resolveExportImageBatchPreviewPixels
} from '../src/app/bootstrap/export-actions';
import type { ViewerAppCore } from '../src/app/viewer-app-core';
import { createInitialViewerAppState } from '../src/app/viewer-app-reducer';
import { successResource } from '../src/async-resource';
import type { ColormapLut } from '../src/colormaps';
import type { DisplayController } from '../src/controllers/display-controller';
import type { WebGlExrRenderer } from '../src/renderer';
import type { RenderCacheService } from '../src/services/render-cache-service';
import type { ExportImagePreviewRequest, OpenedImageSession, ViewerState } from '../src/types';
import { createChannelRgbSelection, createImage, createLayer } from './helpers/state-fixtures';

const viewportScreenshot = {
  mode: 'screenshot',
  coordinateSpace: 'viewport',
  rect: { x: 0, y: 0, width: 160, height: 90 },
  sourceViewport: { width: 320, height: 180 },
  outputWidth: 160,
  outputHeight: 90
} as const;

describe('panorama export shader readiness', () => {
  it('waits for the panorama program and restores the captured source and palette before readback', async () => {
    const harness = createHarness();
    const signal = new AbortController().signal;
    const result = harness.resolve(viewportScreenshot, { signal, previewMaxLongestEdge: 80 });

    expect(harness.renderer.preparePanoramaPrograms).toHaveBeenCalledWith(
      expect.objectContaining({ viewerMode: 'panorama' }), signal
    );
    expect(harness.renderer.readExportPixels).not.toHaveBeenCalled();
    harness.simulateOtherPaneRender();
    harness.compilation.resolve();
    await expect(result).resolves.toEqual(harness.pixels);

    expect(harness.bindingAtRead()).toEqual({ sessionId: harness.session.id, palette: harness.lut.rgba8 });
    expect(harness.renderCache.prepareActiveSession).toHaveBeenCalledTimes(2);
    expect(harness.renderer.readExportPixels).toHaveBeenCalledWith(expect.objectContaining({
      outputWidth: 80,
      outputHeight: 45
    }));
  });

  it.each(['cancelled', 'replaced', 'disposed'] as const)(
    'does not read pixels when the export becomes %s during compilation', async (change) => {
      const harness = createHarness();
      const abort = new AbortController();
      const result = harness.resolve(viewportScreenshot, { signal: abort.signal });
      const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' });
      if (change === 'cancelled') {
        abort.abort();
      } else if (change === 'replaced') {
        harness.state.sessions = [{ ...harness.session, decoded: createImage([createLayer()]) }];
      } else {
        harness.dispose();
      }
      harness.compilation.resolve();
      await rejected;

      expect(harness.renderer.readExportPixels).not.toHaveBeenCalled();
      expect(harness.renderCache.prepareActiveSession).toHaveBeenCalledTimes(1);
    }
  );

  it.each([
    { request: { mode: 'image' }, viewerMode: 'panorama' },
    { request: { ...viewportScreenshot, coordinateSpace: 'image', imageRect: { x: 0, y: 0, width: 2, height: 2 } }, viewerMode: 'panorama' },
    { request: viewportScreenshot, viewerMode: 'image' }
  ] as Array<{ request: ExportImagePreviewRequest; viewerMode: 'image' | 'panorama' }>)(
    'does not compile panorama programs for image rendering: $request.coordinateSpace/$viewerMode', async ({ request, viewerMode }) => {
      const harness = createHarness();
      harness.state.sessionState.viewerMode = viewerMode;

      await expect(harness.resolve(request)).resolves.toEqual(harness.pixels);
      expect(harness.renderer.preparePanoramaPrograms).not.toHaveBeenCalled();
      expect(harness.renderer.readExportPixels).toHaveBeenCalledTimes(1);
    }
  );

  it('restores the batch entry source and palette after waiting, then restores the active pane', async () => {
    const harness = createHarness();
    const secondSession = { ...harness.session, id: 'session-2' };
    harness.state.sessions.push(secondSession);
    const result = harness.resolveBatch(secondSession);
    await harness.compilationStarted.promise;
    expect(harness.renderer.readExportPixels).not.toHaveBeenCalled();

    harness.simulateOtherPaneRender();
    harness.compilation.resolve();
    await expect(result).resolves.toEqual(harness.pixels);
    expect(harness.bindingAtRead()).toEqual({ sessionId: secondSession.id, palette: harness.lut.rgba8 });
    expect(harness.renderCache.prepareActiveSession).toHaveBeenLastCalledWith(
      harness.session, expect.objectContaining({ viewerMode: 'panorama' })
    );
  });

  it.each(['single', 'batch'] as const)('clears another pane\'s palette for a %s export without a captured LUT', async (kind) => {
    const harness = createHarness();
    harness.state.sessionState.visualizationMode = 'rgb';
    harness.state.sessionState.activeColormapId = null;
    const result = kind === 'single'
      ? harness.resolve(viewportScreenshot)
      : harness.resolveBatch(harness.session);
    await harness.compilationStarted.promise;
    harness.simulateOtherPaneRender();
    harness.compilation.resolve();
    await result;

    expect(harness.bindingAtRead()).toEqual({ sessionId: harness.session.id, palette: null });
    expect(harness.renderer.clearColormapTexture).toHaveBeenCalled();
  });

  it.each(['cancelled', 'removed', 'disposed'] as const)(
    'aborts a batch preview that becomes %s during compilation', async (change) => {
      const harness = createHarness();
      const abort = new AbortController();
      const result = harness.resolveBatch(harness.session, abort.signal);
      const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' });
      await harness.compilationStarted.promise;

      if (change === 'cancelled') {
        abort.abort();
      } else if (change === 'removed') {
        harness.state.sessions = [];
      } else {
        harness.dispose();
      }
      harness.compilation.resolve();
      await rejected;
      expect(harness.renderer.readExportPixels).not.toHaveBeenCalled();
    }
  );
});

function createHarness() {
  const state = createInitialViewerAppState();
  const lut: ColormapLut = { id: 'palette', label: 'Palette', entryCount: 1, rgba8: new Uint8Array([12, 34, 56, 255]) };
  state.sessionState = {
    ...state.sessionState,
    viewerMode: 'panorama',
    activeColormapId: lut.id,
    visualizationMode: 'colormap',
    colormapRangeMode: 'oneTime',
    displaySelection: createChannelRgbSelection('R', 'G', 'B')
  };
  state.colormapLutsById[lut.id] = successResource(lut.id, lut);
  const session: OpenedImageSession = {
    id: 'session-1',
    filename: 'image.exr',
    displayName: 'image.exr',
    fileSizeBytes: 4,
    source: { kind: 'url', url: '/image.exr' },
    decoded: createImage([createLayer()]),
    state: state.sessionState
  };
  state.activeSessionId = session.id;
  state.sessions = [session];
  const pixels = { width: 1, height: 1, data: new Uint8ClampedArray([12, 34, 56, 255]) };
  const compilation = deferred();
  const compilationStarted = deferred();
  let disposed = false;
  let boundSessionId = session.id;
  let boundPalette: Uint8Array | null = lut.rgba8;
  let readBinding: { sessionId: string; palette: Uint8Array | null } | null = null;
  const renderer = {
    preparePanoramaPrograms: vi.fn((_state: ViewerState, _signal?: AbortSignal) => {
      compilationStarted.resolve();
      return compilation.promise;
    }),
    setColormapTexture: vi.fn((_count: number, palette: Uint8Array) => { boundPalette = palette; }),
    clearColormapTexture: vi.fn(() => { boundPalette = null; }),
    readExportPixels: vi.fn(() => {
      readBinding = { sessionId: boundSessionId, palette: boundPalette };
      return pixels;
    }),
    renderImage: vi.fn()
  };
  const renderCache = {
    prepareActiveSession: vi.fn((sourceSession: OpenedImageSession, _state: ViewerState) => {
      boundSessionId = sourceSession.id;
    })
  };
  const dependencies = {
    core: { getState: () => state } as ViewerAppCore,
    getRenderer: () => renderer as unknown as WebGlExrRenderer,
    getRenderCache: () => renderCache as unknown as RenderCacheService,
    getDisplayController: () => ({ getActiveColormapLutForState: () => lut }) as unknown as DisplayController,
    isDisposed: () => disposed
  };
  return {
    state, session, lut, pixels, renderer, renderCache, compilation, compilationStarted,
    resolve: createImageExportPixelsResolver(dependencies),
    resolveBatch: (entrySession: OpenedImageSession, signal = new AbortController().signal) => resolveExportImageBatchPreviewPixels({
      ...viewportScreenshot,
      sessionId: entrySession.id,
      activeLayer: 0,
      displaySelection: createChannelRgbSelection('R', 'G', 'B'),
      channelLabel: 'RGB'
    }, signal, { ...dependencies, previewMaxLongestEdge: 80 }),
    dispose: () => { disposed = true; },
    simulateOtherPaneRender: () => {
      boundSessionId = 'other-pane';
      boundPalette = new Uint8Array([255, 0, 0, 255]);
    },
    bindingAtRead: () => readBinding
  };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((complete) => { resolve = complete; });
  return { promise, resolve };
}
