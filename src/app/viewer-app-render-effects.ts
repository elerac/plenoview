import { WebGlExrRenderer } from '../renderer';
import { RenderCacheService } from '../services/render-cache-service';
import { buildDisplayLuminanceRevisionKey } from '../display/revision-keys';
import type { ViewerRuntimeUi } from '../ui/viewer-runtime-ui';
import { ViewerAppCore } from './viewer-app-core';
import { ViewerRenderInvalidationFlags } from './viewer-app-render';
import { selectActiveDisplayLuminanceRange } from './viewer-app-selectors';
import type { ViewerPaneRenderSource, ViewerRenderTransition } from './viewer-app-types';
import type { ViewerPaneRenderInfo } from '../viewer-pane-layout';

export function applyRenderEffects(
  core: ViewerAppCore,
  ui: ViewerRuntimeUi,
  renderer: WebGlExrRenderer,
  renderCache: RenderCacheService,
  transition: ViewerRenderTransition
): void {
  const { snapshot, invalidation, state } = transition;
  const activeSession = snapshot.activeSession;
  let deferredAutoExposureDispatch: (() => void) | null = null;
  let renderedPaneSurfaces = false;

  if (invalidation & ViewerRenderInvalidationFlags.ViewerPaneLayout) {
    renderer.setViewerPanes(ui.getViewerPaneRenderInfos());
  }

  if (invalidation & ViewerRenderInvalidationFlags.ColormapTexture) {
    if (snapshot.activeColormapLut) {
      renderer.setColormapTexture(snapshot.activeColormapLut.entryCount, snapshot.activeColormapLut.rgba8);
    } else {
      renderer.clearColormapTexture();
    }
  }

  renderCache.setVisibleDisplaySources(snapshot.paneRenderSources.map((source) => ({
    session: source.session,
    state: source.renderState
  })));

  if ((ui.probeEnabled ?? true) && (invalidation & ViewerRenderInvalidationFlags.ProbeReadout)) {
    ui.setProbeReadout(
      snapshot.probeReadout.mode,
      snapshot.probeReadout.sample,
      snapshot.probeReadout.colorPreview,
      snapshot.probeReadout.imageSize
    );
  }

  if (invalidation & ViewerRenderInvalidationFlags.SpectralReadout) {
    ui.setSpectralReadout(snapshot.spectralPlotReadout);
  }

  if (invalidation & ViewerRenderInvalidationFlags.RoiReadout) {
    ui.setRoiReadout(snapshot.roiReadout);
  }

  if (invalidation & ViewerRenderInvalidationFlags.ViewerStateReadout) {
    ui.setViewerStateReadout(snapshot.viewerStateReadout);
  }

  if (invalidation & ViewerRenderInvalidationFlags.ImageStatsReadout) {
    ui.setImageStats(snapshot.imageStatsReadout);
  }

  if (invalidation & ViewerRenderInvalidationFlags.ResourceClearImage) {
    renderer.clearImage();
  }

  if (invalidation & ViewerRenderInvalidationFlags.RenderRulerOverlay) {
    renderer.setRulersVisible(snapshot.rulersVisible);
  }

  if ((invalidation & ViewerRenderInvalidationFlags.ResourcePrepare) && activeSession) {
    renderCache.prepareActiveSession(activeSession, snapshot.renderState);
    synchronizeCachedDisplayRange(core, renderCache, activeSession.id, snapshot.renderState);
  }

  if (
    (invalidation & ViewerRenderInvalidationFlags.ResourceRequestDisplayRange) &&
    activeSession &&
    snapshot.displayRangeRequest
  ) {
    const requestId = core.issueRequestId();
    const result = renderCache.requestDisplayLuminanceRange(activeSession, snapshot.displayRangeRequest, requestId);
    if (result.pending) {
      core.dispatch({
        type: 'displayRangeRequestStarted',
        requestId,
        requestKey: snapshot.displayRangeRequest.requestKey
      });
    } else {
      core.dispatch({
        type: 'displayLuminanceRangeResolved',
        requestId,
        requestKey: snapshot.displayRangeRequest.requestKey,
        sessionId: activeSession.id,
        activeLayer: state.sessionState.activeLayer,
        displaySelection: state.sessionState.displaySelection,
        displayLuminanceRange: result.displayLuminanceRange
      });
    }
  }

  if (
    (invalidation & ViewerRenderInvalidationFlags.ResourceRequestImageStats) &&
    activeSession &&
    snapshot.imageStatsRequest
  ) {
    const requestId = core.issueRequestId();
    const result = renderCache.requestImageStats(activeSession, snapshot.imageStatsRequest, requestId);
    if (result.pending) {
      core.dispatch({
        type: 'imageStatsRequestStarted',
        requestId,
        requestKey: snapshot.imageStatsRequest.requestKey
      });
    } else {
      core.dispatch({
        type: 'imageStatsResolved',
        requestId: null,
        requestKey: snapshot.imageStatsRequest.requestKey,
        sessionId: activeSession.id,
        activeLayer: state.sessionState.activeLayer,
        visualizationMode: state.sessionState.visualizationMode,
        displaySelection: state.sessionState.displaySelection,
        imageStats: result.imageStats
      });
    }
  }

  if (
    (invalidation & ViewerRenderInvalidationFlags.ResourceRequestAutoExposure) &&
    activeSession &&
    snapshot.autoExposureRequest
  ) {
    const autoExposureRequest = snapshot.autoExposureRequest;
    const requestId = core.issueRequestId();
    const result = renderCache.requestAutoExposure(
      activeSession,
      autoExposureRequest,
      requestId,
      autoExposureRequest.percentile
    );
    if (result.pending) {
      core.dispatch({
        type: 'autoExposureRequestStarted',
        requestId,
        requestKey: autoExposureRequest.requestKey
      });
      if (result.previewAutoExposure) {
        deferredAutoExposureDispatch = () => {
          core.dispatch({
            type: 'autoExposurePreviewResolved',
            requestId,
            requestKey: autoExposureRequest.requestKey,
            sessionId: activeSession.id,
            activeLayer: state.sessionState.activeLayer,
            visualizationMode: state.sessionState.visualizationMode,
            displaySelection: state.sessionState.displaySelection,
            autoExposure: result.previewAutoExposure ?? null
          });
        };
      }
    } else {
      deferredAutoExposureDispatch = () => {
        core.dispatch({
          type: 'autoExposureResolved',
          requestId: null,
          requestKey: autoExposureRequest.requestKey,
          sessionId: activeSession.id,
          activeLayer: state.sessionState.activeLayer,
          visualizationMode: state.sessionState.visualizationMode,
          displaySelection: state.sessionState.displaySelection,
          autoExposure: result.autoExposure
        });
      };
    }
  }

  if (snapshot.paneRenderSources.length === 0) {
    deferredAutoExposureDispatch?.();
    return;
  }

  if (
    invalidation & (
      ViewerRenderInvalidationFlags.ResourcePrepare |
      ViewerRenderInvalidationFlags.ColormapTexture |
      ViewerRenderInvalidationFlags.RenderImage |
      ViewerRenderInvalidationFlags.RenderValueOverlay |
      ViewerRenderInvalidationFlags.RenderProbeOverlay |
      ViewerRenderInvalidationFlags.RenderRulerOverlay
    )
  ) {
    renderPaneSources(renderer, renderCache, ui.getViewerPaneRenderInfos(), snapshot.paneRenderSources);
    renderedPaneSurfaces = true;
  }

  if (!renderedPaneSurfaces && invalidation & ViewerRenderInvalidationFlags.RenderRulerOverlay) {
    renderer.renderRulerOverlay(snapshot.renderState);
  }
  deferredAutoExposureDispatch?.();
}

function renderPaneSources(
  renderer: WebGlExrRenderer,
  renderCache: RenderCacheService,
  panes: ViewerPaneRenderInfo[],
  sources: ViewerPaneRenderSource[]
): void {
  const panesByPath = new Map(panes.map((pane) => [serializePanePath(pane.path), pane]));
  renderCache.setVisibleDisplaySources(sources.map((source) => ({
    session: source.session,
    state: source.renderState
  })));
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
    renderCache.prepareActiveSession(source.session, source.renderState);
    renderer.renderImagePane(pane, source.renderState);
    renderer.renderValueOverlayPane(pane, source.renderState);
    renderer.renderProbeOverlayPane(pane, source.renderState);
    renderer.renderRulerOverlayPane(pane, source.renderState);
  }
}

function serializePanePath(path: readonly number[]): string {
  return path.join('.');
}

function synchronizeCachedDisplayRange(
  core: ViewerAppCore,
  renderCache: RenderCacheService,
  sessionId: string,
  sessionState: ViewerRenderTransition['snapshot']['renderState']
): void {
  const displayState = {
    ...sessionState,
    channelRecognitionSettings: core.getState().channelRecognitionSettings
  };
  const cachedRange = renderCache.getCachedLuminanceRange(sessionId, displayState);
  const activeRange = selectActiveDisplayLuminanceRange(core.getState());
  if (
    cachedRange?.min === activeRange?.min &&
    cachedRange?.max === activeRange?.max
  ) {
    return;
  }

  core.dispatch({
    type: 'displayLuminanceRangeResolved',
    requestId: null,
    requestKey: `${sessionId}:${buildDisplayLuminanceRevisionKey(displayState)}`,
    sessionId,
    activeLayer: sessionState.activeLayer,
    displaySelection: sessionState.displaySelection,
    displayLuminanceRange: cachedRange
  });
}
