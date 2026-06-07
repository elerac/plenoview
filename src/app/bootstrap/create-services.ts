import {
  disposeDecodeWorker,
  loadExrOffMainThread,
  retryDecodeMemoryAdmission,
  setDecodeMemoryReservationManager
} from '../../exr-worker-client';
import { disposeExportWorker } from '../../export/export-worker-client';
import { ViewerInteractionCoordinator } from '../../interaction-coordinator';
import { WebGlExrRenderer } from '../../renderer';
import { resolveRulerFitInsets } from '../../ruler-layout';
import { ChannelThumbnailService } from '../../services/channel-thumbnail-service';
import { InvalidValueWarningRenderLoop } from '../../services/invalid-value-warning-render-loop';
import { LoadQueueService } from '../../services/load-queue';
import { RenderCacheService } from '../../services/render-cache-service';
import { ThumbnailService } from '../../services/thumbnail-service';
import { DisplayController } from '../../controllers/display-controller';
import { SessionController } from '../../controllers/session-controller';
import type { ViewerRuntimeUi } from '../../ui/viewer-runtime-ui';
import { ViewerAppCore } from '../viewer-app-core';
import type { DesktopFileEntry, PathFileProvider, ViewerHost } from '../../platform';
import { DecodeMemoryReservationManager } from '../../memory/memory-manager';

export interface BootstrapServices {
  renderer: WebGlExrRenderer;
  renderCache: RenderCacheService;
  thumbnailService: ThumbnailService;
  channelThumbnailService: ChannelThumbnailService;
  invalidValueWarningRenderLoop: InvalidValueWarningRenderLoop;
  sessionController: SessionController;
  interactionCoordinator: ViewerInteractionCoordinator;
  displayController: DisplayController;
}

interface CreateBootstrapServicesArgs {
  core: ViewerAppCore;
  ui: ViewerRuntimeUi;
  loadQueue: LoadQueueService;
  probeEnabled?: boolean;
  hostKind: ViewerHost['kind'];
  pathFileProvider?: PathFileProvider | null;
  onPathSessionLoaded?: (entry: DesktopFileEntry) => void;
  onPathSessionLoadFailed?: (entry: DesktopFileEntry, error: unknown) => void;
  isDisposed: () => boolean;
}

export function createBootstrapServices({
  core,
  ui,
  loadQueue,
  probeEnabled = true,
  hostKind,
  pathFileProvider,
  onPathSessionLoaded,
  onPathSessionLoadFailed,
  isDisposed
}: CreateBootstrapServicesArgs): BootstrapServices {
  const renderer = new WebGlExrRenderer(
    ui.glCanvas,
    ui.overlayCanvas,
    ui.probeOverlayCanvas,
    ui.rulerOverlaySvg,
    ui.rulerLabelOverlay
  );
  renderer.setProbeOverlayEnabled(probeEnabled);
  renderer.setRulersVisible(core.getState().rulersVisible);
  const decodeMemoryReservationManager = new DecodeMemoryReservationManager();
  setDecodeMemoryReservationManager(decodeMemoryReservationManager);
  const renderCache = new RenderCacheService({
    ui,
    renderer,
    getActiveSessionId: () => core.getState().activeSessionId,
    displayCacheBudgetHostKind: hostKind,
    decodeMemoryReservationManager,
    onDisplayLuminanceRangeResolved: (event) => {
      core.dispatch({
        type: 'displayLuminanceRangeResolved',
        requestId: event.requestId,
        requestKey: event.requestKey,
        sessionId: event.sessionId,
        activeLayer: event.activeLayer,
        displaySelection: event.displaySelection,
        displayLuminanceRange: event.displayLuminanceRange
      });
    },
    onImageStatsResolved: (event) => {
      core.dispatch({
        type: 'imageStatsResolved',
        requestId: event.requestId,
        requestKey: event.requestKey,
        sessionId: event.sessionId,
        activeLayer: event.activeLayer,
        visualizationMode: event.visualizationMode,
        displaySelection: event.displaySelection,
        imageStats: event.imageStats
      });
    },
    onAutoExposureResolved: (event) => {
      core.dispatch({
        type: 'autoExposureResolved',
        requestId: event.requestId,
        requestKey: event.requestKey,
        sessionId: event.sessionId,
        activeLayer: event.activeLayer,
        visualizationMode: event.visualizationMode,
        displaySelection: event.displaySelection,
        autoExposure: event.autoExposure
      });
    }
  });
  const thumbnailService = new ThumbnailService({
    getSession: (sessionId) => {
      return core.getState().sessions.find((session) => session.id === sessionId) ?? null;
    },
    onThumbnailReady: (event) => {
      core.dispatch({
        type: 'thumbnailReady',
        sessionId: event.sessionId,
        token: event.token,
        thumbnailDataUrl: event.thumbnailDataUrl
      });
    }
  });
  const channelThumbnailService = new ChannelThumbnailService({
    getSession: (sessionId) => {
      return core.getState().sessions.find((session) => session.id === sessionId) ?? null;
    },
    getColormapRegistry: () => core.getState().colormapRegistry,
    onThumbnailReady: (event) => {
      core.dispatch({
        type: 'channelThumbnailReady',
        sessionId: event.sessionId,
        requestKey: event.requestKey,
        contextKey: event.contextKey,
        token: event.token,
        thumbnailDataUrl: event.thumbnailDataUrl
      });
    }
  });
  const invalidValueWarningRenderLoop = new InvalidValueWarningRenderLoop({
    renderer,
    renderCache,
    getPanes: () => ui.getViewerPaneRenderInfos()
  });
  const sessionController = new SessionController({
    core,
    loadQueue,
    decodeBytes: loadExrOffMainThread,
    pathFileProvider,
    onPathSessionLoaded,
    onPathSessionLoadFailed,
    retryDecodeAdmission: retryDecodeMemoryAdmission,
    getViewport: () => ui.getActiveViewerPane().viewport,
    getFitInsets: () => resolveRulerFitInsets(core.getState().rulersVisible)
  });
  const interactionCoordinator = new ViewerInteractionCoordinator({
    initialSessionState: core.getState().sessionState,
    getSessionState: () => core.getState().sessionState,
    commitViewState: (view) => {
      core.dispatch({
        type: 'viewStateCommitted',
        view
      });
    },
    onInteractionChange: (state) => {
      if (isDisposed()) {
        return;
      }

      core.dispatch({
        type: 'interactionStatePublished',
        interactionState: state
      });
    }
  });
  const displayController = new DisplayController({
    core
  });

  return {
    renderer,
    renderCache,
    thumbnailService,
    channelThumbnailService,
    invalidValueWarningRenderLoop,
    sessionController,
    interactionCoordinator,
    displayController
  };
}

export function disposeBootstrapServices(services: Partial<BootstrapServices>): void {
  services.interactionCoordinator?.dispose();
  services.displayController?.dispose();
  services.sessionController?.dispose();
  services.thumbnailService?.dispose();
  services.channelThumbnailService?.dispose();
  services.invalidValueWarningRenderLoop?.dispose();
  services.renderCache?.dispose();
  services.renderer?.dispose();
  disposeDecodeWorker();
  disposeExportWorker();
}
