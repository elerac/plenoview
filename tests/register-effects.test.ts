import { describe, expect, it, vi } from 'vitest';
import { registerBootstrapEffects } from '../src/app/bootstrap/register-effects';
import type { BootstrapServices } from '../src/app/bootstrap/create-services';
import { ViewerAppCore } from '../src/app/viewer-app-core';
import { PathTracingRenderLoop } from '../src/services/path-tracing-render-loop';
import type { RenderCacheService } from '../src/services/render-cache-service';
import type { WebGlExrRenderer } from '../src/renderer';
import type { ViewerRuntimeUi } from '../src/ui/viewer-runtime-ui';
import type { ViewerRenderState } from '../src/types';
import type { ViewerPaneRenderInfo } from '../src/viewer-pane-layout';
import { buildViewerStateForLayer, createInitialState } from '../src/viewer-store';
import { createLayerFromChannels } from './helpers/state-fixtures';

// Keep the actual core, render effects, exposure reducer, and progressive loop;
// unrelated thumbnail and DOM effects do not participate in this regression.
vi.mock('../src/app/viewer-app-state-effects', () => ({
  syncInteractionCoordinator: vi.fn(),
  applySessionResourceEffects: vi.fn(),
  applyChannelThumbnailEffects: vi.fn(),
  applyActiveColormapLutEffects: vi.fn()
}));
vi.mock('../src/app/viewer-app-ui-effects', () => ({ applyUiEffects: vi.fn() }));

describe('bootstrap render effect registration', () => {
  it.each(['cached', 'preview', 'pending'] as const)(
    'keeps %s auto exposure in subsequent progressive frames after a nested dispatch',
    (resultKind) => {
      const core = new ViewerAppCore();
      const decoded = { width: 1, height: 1, layers: [createLayerFromChannels({ R: [256], G: [128], B: [64] })] };
      core.dispatch({
        type: 'sessionLoaded',
        session: {
          id: 'hdr', filename: 'hdr.exr', displayName: 'hdr.exr', fileSizeBytes: 12,
          source: { kind: 'url', url: '/hdr.exr' }, decoded,
          state: buildViewerStateForLayer(createInitialState(), decoded, 0)
        }
      });
      core.dispatch({ type: 'viewerModeSet', viewerMode: 'panorama' });
      core.dispatch({ type: 'panoramaDisplayModeSet', panoramaDisplayMode: 'environmentLighting' });
      core.dispatch({ type: 'panoramaLightingMethodSet', panoramaLightingMethod: 'pathTracing' });

      const panes: ViewerPaneRenderInfo[] = [{
        path: [], active: true,
        rect: { x: 0, y: 0, width: 320, height: 180 }, viewport: { width: 320, height: 180 }
      }];
      const ui = {
        getViewerPaneRenderInfos: () => panes,
        setProbeReadout: vi.fn(), setSpectralReadout: vi.fn(), setRoiReadout: vi.fn(),
        setViewerStateReadout: vi.fn(), setImageStats: vi.fn()
      } as unknown as ViewerRuntimeUi;
      const renderedExposures: number[] = [];
      const renderer = {
        setColormapTexture: vi.fn(), clearColormapTexture: vi.fn(), clearImage: vi.fn(),
        setViewerPanes: vi.fn(), setRulersVisible: vi.fn(), beginPaneRender: vi.fn(),
        beginProgressiveImageRender: vi.fn(), renderValueOverlayPane: vi.fn(),
        renderProbeOverlayPane: vi.fn(), renderRulerOverlayPane: vi.fn(),
        renderImagePane: vi.fn((_pane: ViewerPaneRenderInfo, state: ViewerRenderState) => {
          renderedExposures.push(state.exposureEv);
          return true;
        })
      };
      const autoExposure = { scalar: 256, exposureEv: -8, percentile: 99.5, source: 'rgbAbsMax' as const };
      const renderCache = {
        setVisibleDisplaySources: vi.fn(), prepareActiveSession: vi.fn(),
        getCachedLuminanceRange: vi.fn(() => null),
        requestDisplayLuminanceRange: vi.fn(() => ({ displayLuminanceRange: null, pending: false })),
        requestImageStats: vi.fn(() => ({ imageStats: null, pending: false })),
        requestAutoExposure: vi.fn(() => ({
          autoExposure: resultKind === 'cached' ? autoExposure : null,
          previewAutoExposure: resultKind === 'preview' ? autoExposure : null,
          pending: resultKind !== 'cached'
        }))
      };
      const queuedFrames = new Map<number, FrameRequestCallback>();
      let nextFrameId = 0;
      const pathTracingRenderLoop = new PathTracingRenderLoop({
        renderer: renderer as unknown as WebGlExrRenderer,
        renderCache: renderCache as unknown as RenderCacheService,
        getPanes: () => panes,
        requestAnimationFrame: callback => {
          const id = ++nextFrameId;
          queuedFrames.set(id, callback);
          return id;
        },
        cancelAnimationFrame: id => { queuedFrames.delete(id); },
        setTimeout: () => 1, clearTimeout: () => undefined, now: () => 0
      });
      const services = {
        renderer, renderCache, pathTracingRenderLoop,
        invalidValueWarningRenderLoop: { sync: vi.fn() }
      } as unknown as BootstrapServices;
      const unregister = registerBootstrapEffects({ core, ui, services, isDisposed: () => false });
      try {
        core.dispatch({ type: 'autoExposureSet', enabled: true });
        const expectedExposure = resultKind === 'pending' ? 0 : -8;
        expect(core.getState().sessionState.exposureEv).toBe(expectedExposure);
        expect(renderCache.requestAutoExposure).toHaveBeenCalledTimes(1);

        // A completed/preview result renders immediately and must survive in
        // the animation loop. A pending status alone must still wake the loop.
        renderedExposures.length = 0;
        for (let index = 0; index < 5; index += 1) {
          const [id, callback] = queuedFrames.entries().next().value!;
          queuedFrames.delete(id);
          callback(index * 16);
        }
        expect(renderedExposures.length).toBeGreaterThanOrEqual(5);
        expect(new Set(renderedExposures)).toEqual(new Set([expectedExposure]));
      } finally {
        pathTracingRenderLoop.dispose();
        for (const unsubscribe of unregister) unsubscribe();
      }
    }
  );
});
