import { DEFAULT_DISPLAY_CACHE_BUDGET_MB } from '../../display-cache';
import { serializeChannelThumbnailRequestKey } from '../../channel-thumbnail-keys';
import { ViewerUi, type UiCallbacks } from '../../ui/viewer-ui';
import { imageToScreen } from '../../interaction/image-geometry';
import { getPanoramaProjectionDiameter } from '../../interaction/panorama-geometry';
import {
  handleCopyImageToClipboard,
  handleExportColormap,
  handleExportImage,
  handleExportImageBatch,
  handleExportScreenshotRegions,
  resolveExportImageBatchPreviewPixels
} from './export-actions';
import type { ExportImagePixels } from '../../export/export-pixels';
import { mergeRenderState } from '../../view-state';
import { resolveDisplayImageSize } from '../../display-size';
import { selectActiveSession } from '../viewer-app-selectors';
import { ViewerAppCore } from '../viewer-app-core';
import type { DisplayController } from '../../controllers/display-controller';
import type { SessionController } from '../../controllers/session-controller';
import type {
  ExportColormapPreviewRequest,
  ExportColormapRequest,
  ExportImageBatchPreviewRequest,
  ExportImageBatchRequest,
  ExportImagePreviewRequest,
  ExportImageRequest,
  ExportScreenshotRegionsRequest,
  ExportProgressUpdate,
  OpenedImageDropPlacement,
  ViewerKeyboardNavigationInput,
  ViewerKeyboardZoomInput,
  ViewerViewState,
  ViewportInfo,
  ViewportRect
} from '../../types';
import type { StokesColormapDefaultGroup, StokesColormapDefaultSetting } from '../../stokes';
import type { RenderCacheService } from '../../services/render-cache-service';
import type { ChannelThumbnailService } from '../../services/channel-thumbnail-service';
import type { WebGlExrRenderer } from '../../renderer';
import type { DisplaySelection } from '../../display-model';
import { saveStoredInvalidValueWarningSetting } from '../../invalid-value-warning-settings';
import type { ViewerHost } from '../../platform';
import { presentDesktopError } from '../../platform';

interface InteractionInputBridge {
  setViewerKeyboardNavigationInput(input: ViewerKeyboardNavigationInput): void;
  setViewerKeyboardZoomInput(input: ViewerKeyboardZoomInput): void;
}

interface CreateViewerUiDependencies {
  core: ViewerAppCore;
  getSessionController: () => SessionController;
  getDisplayController: () => DisplayController;
  getChannelThumbnailService: () => ChannelThumbnailService;
  getRenderCache: () => RenderCacheService;
  getRenderer: () => WebGlExrRenderer;
  getInteraction: () => InteractionInputBridge | null;
  host: ViewerHost;
  resolveColormapExportPixels: (
    request: ExportColormapPreviewRequest | ExportColormapRequest,
    options?: { signal?: AbortSignal; previewMaxLongestEdge?: number }
  ) => Promise<{ width: number; height: number; data: Uint8ClampedArray }>;
  resolveImageExportPixels: (
    request?: ExportImagePreviewRequest | ExportImageRequest,
    options?: { signal?: AbortSignal; previewMaxLongestEdge?: number }
  ) => Promise<ExportImagePixels>;
  onImageLoadWorkersChange: (workerCount: number) => void;
  isDisposed: () => boolean;
}

export function createViewerUi({
  core,
  getSessionController,
  getDisplayController,
  getChannelThumbnailService,
  getRenderCache,
  getRenderer,
  getInteraction,
  host,
  resolveColormapExportPixels,
  resolveImageExportPixels,
  onImageLoadWorkersChange,
  isDisposed
}: CreateViewerUiDependencies): ViewerUi {
  const callbacks: UiCallbacks = {
    onOpenFileClick: () => {
      host.openFiles({
        fallback: () => {
          const input = document.getElementById('file-input') as HTMLInputElement;
          input.click();
        },
        onEntries: (entries) => {
          void getSessionController().enqueuePathEntries(entries);
        },
        onError: (error) => {
          const { message } = presentDesktopError(error);
          if (message) {
            core.dispatch({ type: 'errorSet', message });
          }
        }
      });
    },
    onOpenFolderClick: () => {
      host.openFolder({
        fallback: () => {
          const input = document.getElementById('folder-input') as HTMLInputElement;
          input.click();
        },
        onEntries: (entries) => {
          void getSessionController().enqueueFolderPathEntries(entries);
        },
        onError: (error) => {
          const { message } = presentDesktopError(error);
          if (message) {
            core.dispatch({ type: 'errorSet', message });
          }
        }
      });
    },
    onExportImage: async (
      request: ExportImageRequest,
      onProgress?: (update: ExportProgressUpdate) => void
    ) => {
      return await handleExportImage(request, {
        core,
        resolveImageExportPixels,
        exportSink: host,
        isDisposed
      }, onProgress);
    },
    onCopyImageToClipboard: async () => {
      await handleCopyImageToClipboard({
        core,
        resolveImageExportPixels,
        exportSink: host,
        isDisposed
      });
    },
    onExportScreenshotRegions: async (
      request: ExportScreenshotRegionsRequest,
      onProgress?: (update: ExportProgressUpdate) => void
    ) => {
      return await handleExportScreenshotRegions(request, {
        core,
        resolveImageExportPixels,
        exportSink: host,
        isDisposed
      }, onProgress);
    },
    onResolveExportImagePreview: async (request, signal) => {
      return await resolveImageExportPixels(request, {
        signal,
        previewMaxLongestEdge: 256
      });
    },
    onExportImageBatch: async (
      request: ExportImageBatchRequest,
      signal: AbortSignal,
      onProgress?: (update: ExportProgressUpdate) => void
    ) => {
      return await handleExportImageBatch(request, signal, {
        core,
        getRenderCache,
        getRenderer,
        exportSink: host,
        isDisposed
      }, onProgress);
    },
    onResolveExportImageBatchPreview: async (request: ExportImageBatchPreviewRequest, signal: AbortSignal) => {
      return await resolveExportImageBatchPreviewPixels(request, signal, {
        core,
        getRenderCache,
        getRenderer,
        isDisposed,
        previewMaxLongestEdge: 64
      });
    },
    onExportColormap: async (request: ExportColormapRequest) => {
      return await handleExportColormap(request, {
        core,
        resolveColormapExportPixels,
        exportSink: host,
        isDisposed
      });
    },
    onResolveExportColormapPreview: async (request, signal) => {
      return await resolveColormapExportPixels(request, {
        signal,
        previewMaxLongestEdge: 256
      });
    },
    onFileSelected: (file) => {
      void getSessionController().enqueueFiles([file]);
    },
    onFolderSelected: (files, options) => {
      void getSessionController().enqueueFolderFiles(files, options);
    },
    onFilesDropped: (files) => {
      void getSessionController().enqueueFiles(files);
    },
    onGalleryImageSelected: (galleryId) => {
      void getSessionController().enqueueGalleryImage(galleryId);
    },
    onReloadAllOpenedImages: () => {
      void getSessionController().reloadAllSessions();
    },
    onReloadSelectedOpenedImage: (sessionId) => {
      void getSessionController().reloadSession(sessionId);
    },
    onCloseSelectedOpenedImage: (sessionId) => {
      getSessionController().closeSession(sessionId);
    },
    onCloseAllOpenedImages: () => {
      getSessionController().closeAllSessions();
    },
    onOpenedImageSelected: (sessionId, targetPane) => {
      getSessionController().switchActiveSession(sessionId, targetPane);
    },
    onOpenedImageAssignedToViewerPane: (sessionId, targetPane) => {
      getSessionController().assignSessionToViewerPane(sessionId, targetPane.path);
    },
    onOpenedImageDisplayNameChange: (sessionId, displayName) => {
      getSessionController().renameSessionDisplayName(sessionId, displayName);
    },
    onReorderOpenedImage: (
      draggedSessionId: string,
      targetSessionId: string,
      placement: OpenedImageDropPlacement
    ) => {
      getSessionController().reorderSessions(draggedSessionId, targetSessionId, placement);
    },
    onDisplayCacheBudgetChange: (valueMb) => {
      getRenderCache().setBudgetMb(valueMb);
    },
    onExposureChange: (value) => {
      core.dispatch({ type: 'exposureSet', exposureEv: value });
    },
    onExposureCommit: () => {
      core.dispatch({ type: 'exposureCommitted' });
    },
    onDisplayGammaChange: (value) => {
      core.dispatch({ type: 'displayGammaSet', displayGamma: value });
    },
    onDisplayGammaCommit: () => {
      core.dispatch({ type: 'displayGammaCommitted' });
    },
    onViewerKeyboardNavigationInputChange: (input) => {
      getInteraction()?.setViewerKeyboardNavigationInput(input);
    },
    onViewerKeyboardZoomInputChange: (input) => {
      getInteraction()?.setViewerKeyboardZoomInput(input);
    },
    onViewerViewStateChange: (patch: Partial<ViewerViewState>) => {
      core.dispatch({
        type: 'viewerStateEdited',
        patch
      });
    },
    onDepthSettingsChange: (patch) => {
      core.dispatch({
        type: 'depthSettingsEdited',
        patch
      });
    },
    onAutoFitImageOnSelectChange: (enabled) => {
      core.dispatch({ type: 'autoFitImageOnSelectSet', enabled });
    },
    onAutoFitImage: () => {
      getSessionController().fitActiveSessionToViewport();
    },
    onAutoExposureChange: (enabled) => {
      core.dispatch({ type: 'autoExposureSet', enabled });
    },
    onAutoExposurePercentileChange: (percentile) => {
      core.dispatch({ type: 'autoExposurePercentileSet', percentile });
    },
    onImageLoadWorkersChange: (workerCount) => {
      onImageLoadWorkersChange(workerCount);
    },
    onRulersVisibleChange: (enabled) => {
      core.dispatch({ type: 'rulersVisibleSet', enabled });
    },
    onViewerPaneSplit: (orientation) => {
      core.dispatch({ type: 'viewerPaneSplit', orientation });
    },
    onViewerPaneReset: () => {
      core.dispatch({ type: 'viewerPaneReset' });
    },
    onViewerPaneActivated: (path) => {
      core.dispatch({ type: 'viewerPaneActivated', path });
    },
    getScreenshotSelectionContext: () => {
      const state = core.getState();
      const activeSession = selectActiveSession(state);
      const renderState = mergeRenderState(state.sessionState, state.interactionState, {
        maskInvalidStokesVectors: state.maskInvalidStokesVectors,
        spectralRgbGroupingEnabled: state.spectralRgbGroupingEnabled,
        channelRecognitionSettings: state.channelRecognitionSettings,
        channelRecognitionNameRules: state.channelRecognitionNameRules,
        invalidValueWarningEnabled: state.invalidValueWarningEnabled
      });
      return {
        viewerMode: renderState.viewerMode,
        view: {
          zoom: renderState.zoom,
          panX: renderState.panX,
          panY: renderState.panY,
          panoramaYawDeg: renderState.panoramaYawDeg,
          panoramaPitchDeg: renderState.panoramaPitchDeg,
          panoramaHfovDeg: renderState.panoramaHfovDeg,
          depthYawDeg: renderState.depthYawDeg,
          depthPitchDeg: renderState.depthPitchDeg,
          depthZoom: renderState.depthZoom
        },
        imageSize: activeSession
          ? resolveDisplayImageSize(
              activeSession.decoded.width,
              activeSession.decoded.height,
              renderState.displaySelection
            )
          : null
      };
    },
    getScreenshotFitRect: () => {
      const state = core.getState();
      const activeSession = selectActiveSession(state);
      if (!activeSession) {
        return null;
      }

      const viewport = getRenderer().getViewport();
      const renderState = mergeRenderState(state.sessionState, state.interactionState, {
        maskInvalidStokesVectors: state.maskInvalidStokesVectors,
        spectralRgbGroupingEnabled: state.spectralRgbGroupingEnabled,
        channelRecognitionSettings: state.channelRecognitionSettings,
        channelRecognitionNameRules: state.channelRecognitionNameRules,
        invalidValueWarningEnabled: state.invalidValueWarningEnabled
      });
      if (renderState.viewerMode === 'panorama') {
        return resolveVisiblePanoramaRect(renderState.panoramaHfovDeg, viewport);
      }

      if (renderState.viewerMode === 'depth') {
        return {
          x: 0,
          y: 0,
          width: viewport.width,
          height: viewport.height
        };
      }

      if (renderState.viewerMode !== 'image') {
        return null;
      }

      const displaySize = resolveDisplayImageSize(
        activeSession.decoded.width,
        activeSession.decoded.height,
        renderState.displaySelection
      );
      const topLeft = imageToScreen(0, 0, renderState, viewport);
      const bottomRight = imageToScreen(displaySize.width, displaySize.height, renderState, viewport);
      return intersectViewportRect({
        x: Math.min(topLeft.x, bottomRight.x),
        y: Math.min(topLeft.y, bottomRight.y),
        width: Math.abs(bottomRight.x - topLeft.x),
        height: Math.abs(bottomRight.y - topLeft.y)
      }, viewport);
    },
    onViewerModeChange: (mode) => {
      getDisplayController().setViewerMode(mode);
    },
    onLayerChange: (layerIndex) => {
      getDisplayController().setActiveLayer(layerIndex);
    },
    onRgbGroupChange: (mapping) => {
      promoteActiveChannelThumbnail(core, getChannelThumbnailService, mapping);
      void getDisplayController().applyDisplaySelection(mapping);
    },
    onColormapChange: (colormapId) => {
      void getDisplayController().setActiveColormap(colormapId);
    },
    onColormapRangeChange: (range) => {
      getDisplayController().setColormapRange(range);
    },
    onColormapExposureChange: (value) => {
      getDisplayController().setColormapExposure(value);
    },
    onColormapGammaChange: (value) => {
      getDisplayController().setColormapGamma(value);
    },
    onColormapRangeReset: () => {
      getDisplayController().resetColormapRange();
    },
    onColormapZeroCenterToggle: () => {
      getDisplayController().toggleColormapZeroCenter();
    },
    onColormapReverseToggle: () => {
      getDisplayController().toggleColormapReverse();
    },
    onStokesDegreeModulationToggle: () => {
      getDisplayController().toggleStokesDegreeModulation();
    },
    onStokesAolpDegreeModulationModeChange: (mode) => {
      getDisplayController().setStokesAolpDegreeModulationMode(mode);
    },
    onStokesDefaultSettingChange: (
      group: StokesColormapDefaultGroup,
      setting: StokesColormapDefaultSetting
    ) => {
      void getDisplayController().setStokesColormapDefaultSetting(group, setting);
    },
    onStokesParameterVisibilityChange: (group, enabled) => {
      getDisplayController().setStokesParameterVisibility(group, enabled);
    },
    onMaskInvalidStokesVectorsChange: (enabled) => {
      getDisplayController().setMaskInvalidStokesVectors(enabled);
    },
    onChannelRecognitionSettingsChange: (settings) => {
      getDisplayController().setChannelRecognitionSettings(settings);
    },
    onChannelRecognitionNameRulesChange: (rules) => {
      getDisplayController().setChannelRecognitionNameRules(rules);
    },
    onSpectralRgbGroupingChange: (enabled) => {
      getDisplayController().setSpectralRgbGroupingEnabled(enabled);
    },
    onInvalidValueWarningChange: (enabled) => {
      saveStoredInvalidValueWarningSetting(enabled);
      core.dispatch({ type: 'invalidValueWarningSet', enabled });
    },
    onClearRoi: () => {
      core.dispatch({
        type: 'roiSet',
        roi: null
      });
    },
    onResetSettings: () => {
      getRenderCache().setBudgetMb(DEFAULT_DISPLAY_CACHE_BUDGET_MB);
      void getDisplayController().resetStokesColormapDefaults();
      getDisplayController().resetStokesParameterVisibility();
      getDisplayController().resetMaskInvalidStokesVectors();
      getDisplayController().resetChannelRecognitionSettings();
      getDisplayController().resetChannelRecognitionNameRules();
      getDisplayController().resetInvalidValueWarning();
    },
    onResetView: () => {
      getDisplayController().resetActiveSessionDisplayState();
    },
    onViewerStateReset: () => {
      getSessionController().resetActiveSessionViewState();
    }
  };

  return new ViewerUi(callbacks, host.appFullscreen);
}

export function promoteActiveChannelThumbnail(
  core: ViewerAppCore,
  getChannelThumbnailService: () => ChannelThumbnailService,
  selection: DisplaySelection
): void {
  const state = core.getState();
  const activeSession = selectActiveSession(state);
  if (!activeSession) {
    return;
  }

  const requestKey = serializeChannelThumbnailRequestKey({
    sessionId: activeSession.id,
    activeLayer: state.sessionState.activeLayer,
    selection,
    exposureEv: state.sessionState.channelThumbnailExposureEv,
    displayGamma: state.sessionState.channelThumbnailDisplayGamma,
    stokesDegreeModulation: state.sessionState.stokesDegreeModulation,
    stokesAolpDegreeModulationMode: state.sessionState.stokesAolpDegreeModulationMode,
    maskInvalidStokesVectors: state.maskInvalidStokesVectors,
    spectralRgbGroupingEnabled: state.spectralRgbGroupingEnabled,
    channelRecognitionSettings: state.channelRecognitionSettings,
    channelRecognitionNameRules: state.channelRecognitionNameRules
  });

  getChannelThumbnailService().promoteRequest(requestKey);
}

function resolveVisiblePanoramaRect(hfovDeg: number, viewport: ViewportInfo): ViewportRect | null {
  const projectionDiameter = getPanoramaProjectionDiameter(viewport, hfovDeg);
  return intersectViewportRect({
    x: viewport.width * 0.5 - projectionDiameter * 0.5,
    y: viewport.height * 0.5 - projectionDiameter * 0.5,
    width: projectionDiameter,
    height: projectionDiameter
  }, viewport);
}

function intersectViewportRect(rect: ViewportRect, viewport: ViewportInfo): ViewportRect | null {
  const viewportWidth = Math.max(0, viewport.width);
  const viewportHeight = Math.max(0, viewport.height);
  if (!isFinitePositiveRect(rect) || viewportWidth <= 0 || viewportHeight <= 0) {
    return null;
  }

  const x0 = Math.max(0, Math.min(viewportWidth, rect.x));
  const y0 = Math.max(0, Math.min(viewportHeight, rect.y));
  const x1 = Math.max(0, Math.min(viewportWidth, rect.x + rect.width));
  const y1 = Math.max(0, Math.min(viewportHeight, rect.y + rect.height));
  const width = x1 - x0;
  const height = y1 - y0;
  if (width <= 0 || height <= 0) {
    return null;
  }

  return {
    x: x0,
    y: y0,
    width,
    height
  };
}

function isFinitePositiveRect(rect: ViewportRect): boolean {
  return (
    Number.isFinite(rect.x) &&
    Number.isFinite(rect.y) &&
    Number.isFinite(rect.width) &&
    Number.isFinite(rect.height) &&
    rect.width > 0 &&
    rect.height > 0
  );
}
