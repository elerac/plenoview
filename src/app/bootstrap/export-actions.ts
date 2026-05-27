import { zipSync } from 'fflate';
import { findColormapIdByLabel, getColormapAsset, loadColormapLut, type ColormapLut } from '../../colormaps';
import { cloneDisplayLuminanceRange, resolveColormapAutoRange } from '../../colormap-range';
import { computeRec709Luminance } from '../../color';
import { cloneDisplaySelection, isStokesSelection } from '../../display-model';
import { resolveDisplayImageSize } from '../../display-size';
import {
  createDisplayPixelValues,
  readDisplaySelectionPixelValuesAtIndex,
  resolveDisplaySelectionEvaluator
} from '../../display/evaluator';
import { createPngBlobFromPixels } from '../../export-image';
import { encodePngOffMainThread, zipFilesOffMainThread } from '../../export/export-worker-client';
import { buildColormapExportPixels, type ExportImagePixels } from '../../export/export-pixels';
import { cloneScreenshotRegionCrop } from '../../export/screenshot-region';
import {
  buildReproductionMetadataFilename,
  buildScreenshotReproductionMetadata,
  serializeScreenshotReproductionMetadata,
  type ScreenshotReproductionMetadataV2
} from '../../export/screenshot-reproduction-metadata';
import { createAbortError, isAbortError, throwIfAborted } from '../../lifecycle';
import { RenderCacheService } from '../../services/render-cache-service';
import { getStokesDisplayColormapDefault, isStokesDegreeModulationParameter } from '../../stokes';
import { buildDisplaySelectionThumbnailPixels } from '../../thumbnail';
import { createInteractionState, mergeRenderState } from '../../view-state';
import {
  selectActiveColormapLut,
  selectActiveSession,
  selectColormapLutById
} from '../viewer-app-selectors';
import { ViewerAppCore } from '../viewer-app-core';
import type { ViewerAppState } from '../viewer-app-types';
import type { DisplayController } from '../../controllers/display-controller';
import type {
  ExportColormapPreviewRequest,
  ExportColormapRequest,
  ExportImageBatchPreviewRequest,
  ExportImageBatchRequest,
  ExportImagePreviewRequest,
  ExportImageRequest,
  ExportProgressUpdate,
  ExportScreenshotRegionsRequest,
  DecodedLayer,
  DisplayLuminanceRange,
  OpenedImageSession,
  ViewerState,
  ViewerSessionState,
  VisualizationMode
} from '../../types';
import type { WebGlExrRenderer } from '../../renderer';

type BatchPreviewRangeStrategy = 'exact' | 'sampledPreview';

type BatchEntryVisualizationState = Pick<
  ViewerSessionState,
  'visualizationMode' | 'activeColormapId' | 'colormapRange' | 'colormapRangeMode' | 'colormapZeroCentered'
>;

interface ColormapExportResolverOptions {
  signal?: AbortSignal;
  previewMaxLongestEdge?: number;
}

interface ImageExportResolverOptions {
  signal?: AbortSignal;
  previewMaxLongestEdge?: number;
}

interface ColormapExportResolverDependencies {
  core: ViewerAppCore;
  isDisposed: () => boolean;
}

interface ImageExportResolverDependencies {
  core: ViewerAppCore;
  getRenderCache: () => RenderCacheService;
  getRenderer: () => WebGlExrRenderer;
  getDisplayController: () => DisplayController;
  isDisposed: () => boolean;
}

interface ExportImageActionDependencies {
  core: ViewerAppCore;
  resolveImageExportPixels: ReturnType<typeof createImageExportPixelsResolver>;
  isDisposed: () => boolean;
}

interface CopyImageToClipboardActionDependencies {
  core: ViewerAppCore;
  resolveImageExportPixels: ReturnType<typeof createImageExportPixelsResolver>;
  isDisposed: () => boolean;
}

interface ExportScreenshotRegionsActionDependencies {
  core: ViewerAppCore;
  resolveImageExportPixels: ReturnType<typeof createImageExportPixelsResolver>;
  isDisposed: () => boolean;
}

interface ExportImageBatchActionDependencies {
  core: ViewerAppCore;
  getRenderCache: () => RenderCacheService;
  getRenderer: () => WebGlExrRenderer;
  isDisposed: () => boolean;
}

interface ExportImageBatchPreviewActionDependencies {
  core: ViewerAppCore;
  getRenderCache: () => RenderCacheService;
  getRenderer: () => WebGlExrRenderer;
  isDisposed: () => boolean;
  previewMaxLongestEdge: number;
}

type ViewerStateProvider = () => ViewerAppState;
type ExportProgressReporter = (update: ExportProgressUpdate) => void;

const PREVIEW_LUMINANCE_RANGE_MAX_SAMPLES = 4096;
const BATCH_EXPORT_ENCODE_BACKLOG = 2;

interface PendingBatchEncode {
  entryIndex: number;
  entry: ExportImageBatchRequest['entries'][number];
  session: OpenedImageSession;
  renderState: ViewerState;
  pngBytes: Promise<Uint8Array>;
}

interface ExportColormapActionDependencies {
  core: ViewerAppCore;
  resolveColormapExportPixels: ReturnType<typeof createColormapExportPixelsResolver>;
  isDisposed: () => boolean;
}

export function createColormapExportPixelsResolver({
  core,
  isDisposed
}: ColormapExportResolverDependencies) {
  return async (
    request: ExportColormapPreviewRequest | ExportColormapRequest,
    options: ColormapExportResolverOptions = {}
  ) => {
    if (isDisposed()) {
      throw createAbortError('Viewer application has been disposed.');
    }

    if (options.signal) {
      throwIfAborted(options.signal);
    }

    const state = core.getState();
    const registry = state.colormapRegistry;
    if (!registry) {
      throw new Error('No colormaps are available.');
    }

    if (!Number.isInteger(request.width) || request.width <= 0 || !Number.isInteger(request.height) || request.height <= 0) {
      throw new Error('Colormap export dimensions must be positive integers.');
    }

    if (!getColormapAsset(registry, request.colormapId)) {
      throw new Error(`Unknown colormap: ${request.colormapId}`);
    }

    const dimensions = options.previewMaxLongestEdge
      ? resolveBoundedColormapExportSize(request.width, request.height, options.previewMaxLongestEdge)
      : { width: request.width, height: request.height };

    const lut = await loadColormapLut(registry, request.colormapId, options.signal);
    if (options.signal) {
      throwIfAborted(options.signal);
    }

    if (isDisposed()) {
      throw createAbortError('Viewer application has been disposed.');
    }

    return buildColormapExportPixels({
      lut,
      width: dimensions.width,
      height: dimensions.height,
      orientation: request.orientation
    });
  };
}

export function createImageExportPixelsResolver({
  core,
  getRenderCache,
  getRenderer,
  getDisplayController,
  isDisposed
}: ImageExportResolverDependencies): (
  request?: ExportImagePreviewRequest | ExportImageRequest,
  options?: ImageExportResolverOptions
) => Promise<ExportImagePixels> {
  return async (
    request: ExportImagePreviewRequest | ExportImageRequest = { mode: 'image' },
    options: ImageExportResolverOptions = {}
  ) => {
    if (isDisposed()) {
      throw createAbortError('Viewer application has been disposed.');
    }

    if (options.signal) {
      throwIfAborted(options.signal);
    }

    const state = core.getState();
    const activeSession = selectActiveSession(state);
    if (!activeSession) {
      throw new Error('No image is active.');
    }

    if (
      state.sessionState.visualizationMode === 'colormap' &&
      !getDisplayController().getActiveColormapLutForState(state.sessionState.activeColormapId)
    ) {
      throw new Error('The active colormap is not ready for export.');
    }

    const screenshotRegion = request.mode === 'screenshot' ? request : null;
    if (options.previewMaxLongestEdge && !screenshotRegion) {
      const layer = activeSession.decoded.layers[state.sessionState.activeLayer] ?? null;
      if (!layer) {
        throw new Error('No image layer is active.');
      }

      const pixels = buildDisplaySelectionThumbnailPixels(
        layer,
        activeSession.decoded.width,
        activeSession.decoded.height,
        state.sessionState,
        state.sessionState.displaySelection,
        options.previewMaxLongestEdge,
        {
          visualizationMode: state.sessionState.visualizationMode,
          colormapRange: state.sessionState.colormapRange,
          colormapLut: selectActiveColormapLut(state),
          stokesDegreeModulation: state.sessionState.stokesDegreeModulation,
          stokesAolpDegreeModulationMode: state.sessionState.stokesAolpDegreeModulationMode,
          maskInvalidStokesVectors: state.maskInvalidStokesVectors,
          spectralRgbGroupingEnabled: state.spectralRgbGroupingEnabled
        },
        {
          maskInvalidStokesVectors: state.maskInvalidStokesVectors,
          spectralRgbGroupingEnabled: state.spectralRgbGroupingEnabled
        }
      );
      assertActiveSessionCurrent(core.getState(), activeSession, options.signal);
      return pixels;
    }

    assertActiveSessionCurrent(core.getState(), activeSession, options.signal);
    const renderState = mergeRenderState(state.sessionState, state.interactionState, {
      maskInvalidStokesVectors: state.maskInvalidStokesVectors,
      spectralRgbGroupingEnabled: state.spectralRgbGroupingEnabled,
      invalidValueWarningEnabled: state.invalidValueWarningEnabled
    });
    getRenderCache().prepareActiveSession(activeSession, renderState);
    if (options.signal) {
      throwIfAborted(options.signal);
    }
    assertActiveSessionCurrent(core.getState(), activeSession, options.signal);

    if (isDisposed()) {
      throw createAbortError('Viewer application has been disposed.');
    }

    const displaySize = resolveDisplayImageSize(
      activeSession.decoded.width,
      activeSession.decoded.height,
      renderState.displaySelection
    );
    const requestedWidth = screenshotRegion?.outputWidth ?? displaySize.width;
    const requestedHeight = screenshotRegion?.outputHeight ?? displaySize.height;
    const outputSize = options.previewMaxLongestEdge
      ? resolveBoundedImageExportSize(requestedWidth, requestedHeight, options.previewMaxLongestEdge)
      : screenshotRegion
        ? { width: requestedWidth, height: requestedHeight }
        : null;

    return getRenderer().readExportPixels({
      state: renderState,
      sourceWidth: displaySize.width,
      sourceHeight: displaySize.height,
      ...(screenshotRegion ? {
        screenshot: cloneScreenshotRegionCrop(screenshotRegion)
      } : {}),
      ...(outputSize ? {
        outputWidth: outputSize.width,
        outputHeight: outputSize.height
      } : {})
    });
  };
}

export async function handleExportImage(
  request: ExportImageRequest,
  {
    core,
    resolveImageExportPixels,
    isDisposed
  }: ExportImageActionDependencies,
  onProgress?: ExportProgressReporter
): Promise<void> {
  if (isDisposed()) {
    throw createAbortError('Viewer application has been disposed.');
  }

  try {
    emitSingleExportProgress(onProgress, request, 'preparing');
    const stateSnapshot = core.getState();
    const sourceSession = selectActiveSession(stateSnapshot);
    emitSingleExportProgress(onProgress, request, 'rendering');
    const pixels = await resolveImageExportPixels(request);
    if (sourceSession) {
      assertActiveSessionCurrent(core.getState(), sourceSession);
    }
    emitSingleExportProgress(onProgress, request, 'encoding');
    const blob = await createPngBlobFromPixels(pixels, {
      compressionLevel: request.pngCompressionLevel
    });
    if (sourceSession) {
      assertActiveSessionCurrent(core.getState(), sourceSession);
    }
    if (isDisposed()) {
      throw createAbortError('Viewer application has been disposed.');
    }
    emitSingleExportProgress(onProgress, request, 'packaging', 1);
    if (sourceSession && request.mode === 'screenshot' && request.includeReproductionMetadata) {
      const jsonFilename = buildReproductionMetadataFilename(request.filename);
      const metadata = buildScreenshotReproductionMetadata({
        pngFilename: request.filename,
        jsonFilename,
        pngCompressionLevel: request.pngCompressionLevel,
        region: request,
        session: sourceSession,
        renderState: mergeRenderState(stateSnapshot.sessionState, stateSnapshot.interactionState, {
          maskInvalidStokesVectors: stateSnapshot.maskInvalidStokesVectors,
          spectralRgbGroupingEnabled: stateSnapshot.spectralRgbGroupingEnabled,
          invalidValueWarningEnabled: stateSnapshot.invalidValueWarningEnabled
        })
      });
      const zipBlob = createZipBlob({
        [request.filename]: new Uint8Array(await blob.arrayBuffer()),
        [jsonFilename]: new Uint8Array(await createJsonBlob(metadata).arrayBuffer())
      });
      triggerBrowserDownload(zipBlob, buildScreenshotMetadataBundleFilename(request.filename));
    } else {
      triggerBrowserDownload(blob, request.filename);
    }
  } catch (error) {
    if (isDisposed()) {
      throw error instanceof Error ? error : createAbortError('Viewer application has been disposed.');
    }

    if (isAbortError(error)) {
      throw error;
    }

    const message = error instanceof Error ? error.message : 'Export failed.';
    core.dispatch({ type: 'errorSet', message });
    throw new Error(message);
  }
}

export async function handleCopyImageToClipboard({
  core,
  resolveImageExportPixels,
  isDisposed
}: CopyImageToClipboardActionDependencies): Promise<void> {
  if (isDisposed()) {
    throw createAbortError('Viewer application has been disposed.');
  }

  let pngBlob: Promise<Blob> | null = null;
  try {
    if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
      throw new Error('Copying images to the clipboard is not supported by this browser.');
    }
    if (typeof ClipboardItem.supports === 'function' && !ClipboardItem.supports('image/png')) {
      throw new Error('Copying PNG images to the clipboard is not supported by this browser.');
    }

    const stateSnapshot = core.getState();
    const sourceSession = selectActiveSession(stateSnapshot);
    pngBlob = (async () => {
      const pixels = await resolveImageExportPixels({ mode: 'image' });
      if (sourceSession) {
        assertActiveSessionCurrent(core.getState(), sourceSession);
      }
      return await createPngBlobFromPixels(pixels);
    })();

    await navigator.clipboard.write([
      new ClipboardItem({
        'image/png': pngBlob
      })
    ]);
    if (sourceSession) {
      assertActiveSessionCurrent(core.getState(), sourceSession);
    }
  } catch (error) {
    void pngBlob?.catch(() => {});

    if (isDisposed()) {
      throw error instanceof Error ? error : createAbortError('Viewer application has been disposed.');
    }

    if (isAbortError(error)) {
      throw error;
    }

    const message = error instanceof Error ? error.message : 'Copy image failed.';
    core.dispatch({ type: 'errorSet', message });
    throw new Error(message);
  }
}

export async function handleExportScreenshotRegions(
  request: ExportScreenshotRegionsRequest,
  {
    core,
    resolveImageExportPixels,
    isDisposed
  }: ExportScreenshotRegionsActionDependencies,
  onProgress?: ExportProgressReporter
): Promise<void> {
  if (isDisposed()) {
    throw createAbortError('Viewer application has been disposed.');
  }

  try {
    if (request.format !== 'png-zip' || request.mode !== 'screenshot-regions') {
      throw new Error('Unsupported screenshot regions export format.');
    }
    if (request.regions.length === 0) {
      throw new Error('Select at least one screenshot region.');
    }

    const stateSnapshot = core.getState();
    const sourceSession = selectActiveSession(stateSnapshot);
    if (!sourceSession) {
      throw new Error('No image is active.');
    }

    const usedFilenames = new Map<string, number>();
    const files: Record<string, Uint8Array> = {};
    onProgress?.({
      completed: 0,
      total: request.regions.length,
      stage: 'preparing'
    });

    for (const [regionEntryIndex, region] of request.regions.entries()) {
      if (isDisposed()) {
        throw createAbortError('Viewer application has been disposed.');
      }

      const outputFilename = buildScreenshotRegionOutputFilename(
        request.baseFilename,
        region.index,
        region.count,
        usedFilenames
      );
      const regionRequest: ExportImageRequest = {
        filename: outputFilename,
        format: 'png',
        mode: 'screenshot',
        ...cloneScreenshotRegionCrop(region),
        outputWidth: region.outputWidth,
        outputHeight: region.outputHeight,
        pngCompressionLevel: request.pngCompressionLevel
      };

      onProgress?.({
        completed: regionEntryIndex,
        total: request.regions.length,
        stage: 'rendering',
        currentFilename: outputFilename
      });
      const pixels = await resolveImageExportPixels(regionRequest);
      assertActiveSessionCurrent(core.getState(), sourceSession);
      onProgress?.({
        completed: regionEntryIndex,
        total: request.regions.length,
        stage: 'encoding',
        currentFilename: outputFilename
      });
      const blob = await createPngBlobFromPixels(pixels, {
        compressionLevel: request.pngCompressionLevel
      });
      assertActiveSessionCurrent(core.getState(), sourceSession);
      files[outputFilename] = new Uint8Array(await blob.arrayBuffer());

      if (request.includeReproductionMetadata) {
        const jsonFilename = buildReproductionMetadataFilename(outputFilename);
        const metadata = buildScreenshotReproductionMetadata({
          pngFilename: outputFilename,
          jsonFilename,
          pngCompressionLevel: request.pngCompressionLevel,
          region,
          session: sourceSession,
          renderState: mergeRenderState(stateSnapshot.sessionState, stateSnapshot.interactionState, {
            maskInvalidStokesVectors: stateSnapshot.maskInvalidStokesVectors,
            spectralRgbGroupingEnabled: stateSnapshot.spectralRgbGroupingEnabled,
            invalidValueWarningEnabled: stateSnapshot.invalidValueWarningEnabled
          }),
          batch: {
            archiveFilename: request.archiveFilename,
            sessionId: sourceSession.id,
            channelLabel: 'Current Display',
            outputFilename,
            regionIndex: region.index,
            regionLabel: region.label,
            regionCount: region.count
          }
        });
        files[jsonFilename] = new Uint8Array(await createJsonBlob(metadata).arrayBuffer());
      }

      onProgress?.({
        completed: regionEntryIndex + 1,
        total: request.regions.length,
        stage: 'encoding'
      });
    }

    onProgress?.({
      completed: request.regions.length,
      total: request.regions.length,
      stage: 'packaging'
    });
    triggerBrowserDownload(createZipBlob(files), request.archiveFilename);
  } catch (error) {
    if (isDisposed()) {
      throw error instanceof Error ? error : createAbortError('Viewer application has been disposed.');
    }

    if (isAbortError(error)) {
      throw error;
    }

    const message = error instanceof Error ? error.message : 'Screenshot regions export failed.';
    core.dispatch({ type: 'errorSet', message });
    throw new Error(message);
  }
}

export async function handleExportImageBatch(
  request: ExportImageBatchRequest,
  signal: AbortSignal,
  {
    core,
    getRenderCache,
    getRenderer,
    isDisposed
  }: ExportImageBatchActionDependencies,
  onProgress?: ExportProgressReporter
): Promise<void> {
  if (isDisposed()) {
    throw createAbortError('Viewer application has been disposed.');
  }

  const renderCache = getRenderCache();
  const renderer = getRenderer();
  const stateSnapshot = core.getState();
  const lutCache = new Map<string, ColormapLut>();
  const exportAbortController = new AbortController();
  const abortExportWork = () => {
    exportAbortController.abort(signal.reason instanceof Error
      ? signal.reason
      : createAbortError('Batch export cancelled.'));
  };
  if (signal.aborted) {
    abortExportWork();
  } else {
    signal.addEventListener('abort', abortExportWork, { once: true });
  }
  const exportSignal = exportAbortController.signal;
  const pendingEncodes: PendingBatchEncode[] = [];

  try {
    if (request.format !== 'png-zip') {
      throw new Error('Unsupported batch export format.');
    }
    if (request.entries.length === 0) {
      throw new Error('Select at least one image.');
    }

    const files: Record<string, Uint8Array> = {};
    let completedEntries = 0;
    onProgress?.({
      completed: 0,
      total: request.entries.length,
      stage: 'preparing'
    });

    for (const [entryIndex, entry] of request.entries.entries()) {
      throwIfAborted(exportSignal, 'Batch export cancelled.');
      if (isDisposed()) {
        throw createAbortError('Viewer application has been disposed.');
      }

      const session = stateSnapshot.sessions.find((item) => item.id === entry.sessionId) ?? null;
      if (!session) {
        throw new Error(`Image is no longer open: ${entry.sessionId}`);
      }

      onProgress?.({
        completed: completedEntries,
        total: request.entries.length,
        stage: 'rendering',
        currentFilename: entry.outputFilename
      });
      const result = await resolveBatchEntryExportResult({
        entry,
        session,
        appState: stateSnapshot,
        getCurrentState: () => core.getState(),
        renderCache,
        renderer,
        lutCache,
        signal: exportSignal,
        abortMessage: 'Batch export cancelled.'
      });
      onProgress?.({
        completed: completedEntries,
        total: request.entries.length,
        stage: 'encoding',
        currentFilename: entry.outputFilename
      });
      pendingEncodes.push({
        entryIndex,
        entry,
        session,
        renderState: result.renderState,
        pngBytes: encodePngOffMainThread(result.pixels, {
          compressionLevel: request.pngCompressionLevel,
          signal: exportSignal
        })
      });

      while (pendingEncodes.length >= BATCH_EXPORT_ENCODE_BACKLOG) {
        completedEntries = await commitNextBatchEncode({
          pendingEncodes,
          files,
          request,
          core,
          signal: exportSignal,
          completedEntries,
          onProgress
        });
      }
    }

    while (pendingEncodes.length > 0) {
      completedEntries = await commitNextBatchEncode({
        pendingEncodes,
        files,
        request,
        core,
        signal: exportSignal,
        completedEntries,
        onProgress
      });
    }

    onProgress?.({
      completed: request.entries.length,
      total: request.entries.length,
      stage: 'packaging'
    });
    const zipBytes = await zipFilesOffMainThread(files, { signal: exportSignal });
    const zipBlob = createBlobFromBytes(zipBytes, 'application/zip');
    if (isDisposed()) {
      throw createAbortError('Viewer application has been disposed.');
    }
    triggerBrowserDownload(zipBlob, request.archiveFilename);
  } catch (error) {
    if (!exportSignal.aborted) {
      exportAbortController.abort(createAbortError('Batch export cancelled.'));
    }
    await Promise.allSettled(pendingEncodes.map((entry) => entry.pngBytes));

    if (isDisposed()) {
      throw error instanceof Error ? error : createAbortError('Viewer application has been disposed.');
    }

    if (signal.aborted || isAbortError(error)) {
      throw error instanceof Error ? error : createAbortError('Batch export cancelled.');
    }

    const message = error instanceof Error ? error.message : 'Batch export failed.';
    core.dispatch({ type: 'errorSet', message });
    throw new Error(message);
  } finally {
    signal.removeEventListener('abort', abortExportWork);
    if (!isDisposed()) {
      restoreActiveRendererBinding(core, renderCache, renderer);
    }
  }
}

export async function resolveExportImageBatchPreviewPixels(
  request: ExportImageBatchPreviewRequest,
  signal: AbortSignal,
  {
    core,
    getRenderCache,
    getRenderer,
    isDisposed,
    previewMaxLongestEdge
  }: ExportImageBatchPreviewActionDependencies
): Promise<ExportImagePixels> {
  if (isDisposed()) {
    throw createAbortError('Viewer application has been disposed.');
  }

  const renderCache = getRenderCache();
  const stateSnapshot = core.getState();
  const lutCache = new Map<string, ColormapLut>();

  try {
    throwIfAborted(signal, 'Batch export preview cancelled.');
    if (isDisposed()) {
      throw createAbortError('Viewer application has been disposed.');
    }

    const session = stateSnapshot.sessions.find((item) => item.id === request.sessionId) ?? null;
    if (!session) {
      throw new Error(`Image is no longer open: ${request.sessionId}`);
    }

    const pixels = await resolveBatchEntryPreviewPixels({
      entry: request,
      session,
      appState: stateSnapshot,
      getCurrentState: () => core.getState(),
      renderCache,
      renderer: getRenderer(),
      lutCache,
      signal,
      previewMaxLongestEdge,
      abortMessage: 'Batch export preview cancelled.'
    });
    if (isDisposed()) {
      throw createAbortError('Viewer application has been disposed.');
    }

    return pixels;
  } catch (error) {
    if (isDisposed()) {
      throw error instanceof Error ? error : createAbortError('Viewer application has been disposed.');
    }

    if (signal.aborted) {
      throw error instanceof Error ? error : createAbortError('Batch export preview cancelled.');
    }

    throw error instanceof Error ? error : new Error('Batch export preview failed.');
  } finally {
    if (request.mode === 'screenshot' && !isDisposed()) {
      restoreActiveRendererBinding(core, renderCache, getRenderer());
    }
  }
}

async function commitNextBatchEncode({
  pendingEncodes,
  files,
  request,
  core,
  signal,
  completedEntries,
  onProgress
}: {
  pendingEncodes: PendingBatchEncode[];
  files: Record<string, Uint8Array>;
  request: ExportImageBatchRequest;
  core: ViewerAppCore;
  signal: AbortSignal;
  completedEntries: number;
  onProgress?: ExportProgressReporter;
}): Promise<number> {
  const pending = pendingEncodes.shift();
  if (!pending) {
    return completedEntries;
  }

  const pngBytes = await pending.pngBytes;
  throwIfAborted(signal, 'Batch export cancelled.');
  assertSessionCurrent(core.getState(), pending.session, signal);
  files[pending.entry.outputFilename] = pngBytes;

  if (request.includeReproductionMetadata && pending.entry.mode === 'screenshot') {
    const jsonFilename = buildReproductionMetadataFilename(pending.entry.outputFilename);
    const metadata = buildScreenshotReproductionMetadata({
      pngFilename: pending.entry.outputFilename,
      jsonFilename,
      pngCompressionLevel: request.pngCompressionLevel,
      region: pending.entry,
      session: pending.session,
      renderState: pending.renderState,
      batch: {
        archiveFilename: request.archiveFilename,
        sessionId: pending.entry.sessionId,
        channelLabel: pending.entry.channelLabel,
        outputFilename: pending.entry.outputFilename,
        ...(pending.entry.screenshotRegionIndex !== undefined
          ? {
            regionIndex: pending.entry.screenshotRegionIndex,
            regionLabel: pending.entry.screenshotRegionLabel,
            regionCount: pending.entry.screenshotRegionCount
          }
          : {})
      }
    });
    files[jsonFilename] = createJsonBytes(metadata);
  }

  const nextCompletedEntries = completedEntries + 1;
  onProgress?.({
    completed: nextCompletedEntries,
    total: request.entries.length,
    stage: 'encoding'
  });
  throwIfAborted(signal, 'Batch export cancelled.');
  assertSessionCurrent(core.getState(), pending.session, signal);
  return nextCompletedEntries;
}

export async function handleExportColormap(
  request: ExportColormapRequest,
  {
    core,
    resolveColormapExportPixels,
    isDisposed
  }: ExportColormapActionDependencies
): Promise<void> {
  if (isDisposed()) {
    throw createAbortError('Viewer application has been disposed.');
  }

  try {
    const pixels = await resolveColormapExportPixels(request);
    const blob = await createPngBlobFromPixels(pixels, {
      compressionLevel: request.pngCompressionLevel
    });
    if (isDisposed()) {
      throw createAbortError('Viewer application has been disposed.');
    }

    triggerBrowserDownload(blob, request.filename);
  } catch (error) {
    if (isDisposed()) {
      throw error instanceof Error ? error : createAbortError('Viewer application has been disposed.');
    }

    const message = error instanceof Error ? error.message : 'Export failed.';
    core.dispatch({ type: 'errorSet', message });
    throw new Error(message);
  }
}

async function resolveBatchEntryExportResult({
  entry,
  session,
  appState,
  getCurrentState,
  renderCache,
  renderer,
  lutCache,
  signal,
  previewMaxLongestEdge,
  rangeStrategy = 'exact',
  abortMessage
}: {
  entry: ExportImageBatchPreviewRequest;
  session: OpenedImageSession;
  appState: ViewerAppState;
  getCurrentState: ViewerStateProvider;
  renderCache: RenderCacheService;
  renderer: WebGlExrRenderer;
  lutCache: Map<string, ColormapLut>;
  signal: AbortSignal;
  previewMaxLongestEdge?: number;
  rangeStrategy?: BatchPreviewRangeStrategy;
  abortMessage: string;
}): Promise<{ pixels: ExportImagePixels; renderState: ViewerState }> {
  const exportState = await resolveBatchEntryExportState({
    entry,
    session,
    appState,
    renderCache,
    lutCache,
    signal,
    rangeStrategy
  });
  assertSessionCurrent(getCurrentState(), session, signal);
  if (exportState.lut) {
    renderer.setColormapTexture(exportState.lut.entryCount, exportState.lut.rgba8);
  }

  assertSessionCurrent(getCurrentState(), session, signal);
  const screenshotRegion = entry.mode === 'screenshot' ? entry : null;
  const displaySize = resolveDisplayImageSize(session.decoded.width, session.decoded.height, exportState.state.displaySelection);
  const requestedWidth = screenshotRegion?.outputWidth ?? displaySize.width;
  const requestedHeight = screenshotRegion?.outputHeight ?? displaySize.height;
  const outputSize = previewMaxLongestEdge
    ? resolveBoundedImageExportSize(requestedWidth, requestedHeight, previewMaxLongestEdge)
    : screenshotRegion
      ? { width: requestedWidth, height: requestedHeight }
      : null;
  const renderState = screenshotRegion
    ? {
      ...mergeRenderState(exportState.state, createInteractionState(exportState.state), {
        maskInvalidStokesVectors: appState.maskInvalidStokesVectors,
        spectralRgbGroupingEnabled: appState.spectralRgbGroupingEnabled,
        invalidValueWarningEnabled: appState.invalidValueWarningEnabled
      }),
      viewerMode: appState.sessionState.viewerMode,
      ...appState.interactionState.view
    }
    : mergeRenderState(exportState.state, createInteractionState(exportState.state), {
      maskInvalidStokesVectors: appState.maskInvalidStokesVectors,
      spectralRgbGroupingEnabled: appState.spectralRgbGroupingEnabled,
      invalidValueWarningEnabled: appState.invalidValueWarningEnabled
    });

  renderCache.prepareActiveSession(session, renderState);
  throwIfAborted(signal, abortMessage);
  assertSessionCurrent(getCurrentState(), session, signal);

  const pixels = renderer.readExportPixels({
    state: renderState,
    sourceWidth: displaySize.width,
    sourceHeight: displaySize.height,
    ...(screenshotRegion ? {
      screenshot: cloneScreenshotRegionCrop(screenshotRegion)
    } : {}),
    ...(outputSize ? {
      outputWidth: outputSize.width,
      outputHeight: outputSize.height
    } : {})
  });
  throwIfAborted(signal, abortMessage);
  assertSessionCurrent(getCurrentState(), session, signal);
  return { pixels, renderState };
}

async function resolveBatchEntryPreviewPixels({
  entry,
  session,
  appState,
  getCurrentState,
  renderCache,
  renderer,
  lutCache,
  signal,
  previewMaxLongestEdge,
  abortMessage
}: {
  entry: ExportImageBatchPreviewRequest;
  session: OpenedImageSession;
  appState: ViewerAppState;
  getCurrentState: ViewerStateProvider;
  renderCache: RenderCacheService;
  renderer: WebGlExrRenderer;
  lutCache: Map<string, ColormapLut>;
  signal: AbortSignal;
  previewMaxLongestEdge: number;
  abortMessage: string;
}): Promise<ExportImagePixels> {
  if (entry.mode === 'screenshot') {
    const result = await resolveBatchEntryExportResult({
      entry,
      session,
      appState,
      getCurrentState,
      renderCache,
      renderer,
      lutCache,
      signal,
      previewMaxLongestEdge,
      rangeStrategy: 'sampledPreview',
      abortMessage
    });
    return result.pixels;
  }

  const exportState = await resolveBatchEntryExportState({
    entry,
    session,
    appState,
    renderCache,
    lutCache,
    signal,
    rangeStrategy: 'sampledPreview'
  });
  throwIfAborted(signal, abortMessage);
  assertSessionCurrent(getCurrentState(), session, signal);

  const layer = session.decoded.layers[exportState.state.activeLayer] ?? null;
  if (!layer) {
    throw new Error(`Channel is not available for ${session.displayName}: ${entry.channelLabel}`);
  }

  const pixels = buildDisplaySelectionThumbnailPixels(
    layer,
    session.decoded.width,
    session.decoded.height,
    exportState.state,
    exportState.state.displaySelection,
    previewMaxLongestEdge,
    {
      visualizationMode: exportState.state.visualizationMode,
      colormapRange: exportState.state.colormapRange,
      colormapLut: exportState.lut,
      stokesDegreeModulation: exportState.state.stokesDegreeModulation,
      stokesAolpDegreeModulationMode: exportState.state.stokesAolpDegreeModulationMode,
      maskInvalidStokesVectors: appState.maskInvalidStokesVectors,
      spectralRgbGroupingEnabled: appState.spectralRgbGroupingEnabled
    },
    {
      maskInvalidStokesVectors: appState.maskInvalidStokesVectors,
      spectralRgbGroupingEnabled: appState.spectralRgbGroupingEnabled
    }
  );
  throwIfAborted(signal, abortMessage);
  assertSessionCurrent(getCurrentState(), session, signal);
  return pixels;
}

async function resolveBatchEntryExportState({
  entry,
  session,
  appState,
  renderCache,
  lutCache,
  signal,
  rangeStrategy = 'exact'
}: {
  entry: ExportImageBatchPreviewRequest;
  session: OpenedImageSession;
  appState: ViewerAppState;
  renderCache: RenderCacheService;
  lutCache: Map<string, ColormapLut>;
  signal: AbortSignal;
  rangeStrategy?: BatchPreviewRangeStrategy;
}): Promise<{ state: ViewerSessionState; lut: ColormapLut | null }> {
  const selection = cloneDisplaySelection(entry.displaySelection);
  const layer = session.decoded.layers[entry.activeLayer] ?? null;
  if (!selection || !layer) {
    throw new Error(`Channel is not available for ${session.displayName}: ${entry.channelLabel}`);
  }

  const baseState = session.id === appState.activeSessionId ? appState.sessionState : session.state;
  const currentState = appState.sessionState;
  const stokesDefault = isStokesSelection(selection)
    ? getStokesDisplayColormapDefault(selection, appState.stokesColormapDefaults)
    : null;
  const entryVisualization = resolveBatchEntryVisualizationState(appState, session.id, baseState);

  let visualizationMode = entryVisualization.visualizationMode;
  let activeColormapId = entryVisualization.activeColormapId;
  let colormapRange = cloneDisplayLuminanceRange(entryVisualization.colormapRange);
  let colormapRangeMode = entryVisualization.colormapRangeMode;
  let colormapZeroCentered = entryVisualization.colormapZeroCentered;
  const stokesDegreeModulation = { ...currentState.stokesDegreeModulation };
  let stokesAolpDegreeModulationMode = currentState.stokesAolpDegreeModulationMode;

  if (stokesDefault) {
    if (!appState.colormapRegistry) {
      throw new Error('No colormaps are available.');
    }

    const stokesColormapId = findColormapIdByLabel(appState.colormapRegistry, stokesDefault.colormapLabel);
    if (!stokesColormapId) {
      throw new Error(`Required colormap not found: ${stokesDefault.colormapLabel}`);
    }

    visualizationMode = 'colormap';
    activeColormapId = stokesColormapId;
    colormapRange = cloneDisplayLuminanceRange(stokesDefault.range);
    colormapRangeMode = 'oneTime';
    colormapZeroCentered = stokesDefault.zeroCentered;
    if (isStokesSelection(selection) && isStokesDegreeModulationParameter(selection.parameter) && stokesDefault.modulation) {
      stokesDegreeModulation[selection.parameter] = stokesDefault.modulation.enabled;
      if (selection.parameter === 'aolp') {
        stokesAolpDegreeModulationMode = stokesDefault.modulation.aolpMode ?? 'value';
      }
    }
  } else if (visualizationMode === 'colormap' && colormapRangeMode === 'alwaysAuto') {
    const rangeState = {
      activeLayer: entry.activeLayer,
      displaySelection: selection,
      visualizationMode,
      maskInvalidStokesVectors: appState.maskInvalidStokesVectors,
      spectralRgbGroupingEnabled: appState.spectralRgbGroupingEnabled
    };
    const displayLuminanceRange = rangeStrategy === 'sampledPreview'
      ? resolvePreviewDisplayLuminanceRange(renderCache, session, layer, rangeState)
      : renderCache.resolveDisplayLuminanceRange(session, rangeState);
    colormapRange = resolveColormapAutoRange(selection, displayLuminanceRange, colormapZeroCentered);
  }

  const exportState: ViewerSessionState = {
    ...baseState,
    activeLayer: entry.activeLayer,
    displaySelection: selection,
    exposureEv: currentState.exposureEv,
    displayGamma: currentState.displayGamma,
    viewerMode: 'image',
    visualizationMode,
    activeColormapId,
    colormapRange,
    colormapRangeMode,
    colormapZeroCentered,
    stokesDegreeModulation,
    stokesAolpDegreeModulationMode,
    lockedPixel: null,
    roi: null
  };

  const lut = visualizationMode === 'colormap'
    ? await resolveBatchExportColormapLut(appState, activeColormapId, lutCache, signal)
    : null;

  return { state: exportState, lut };
}

function resolvePreviewDisplayLuminanceRange(
  renderCache: RenderCacheService,
  session: OpenedImageSession,
  layer: DecodedLayer,
  state: {
    activeLayer: number;
    displaySelection: ViewerSessionState['displaySelection'];
    visualizationMode: VisualizationMode;
    maskInvalidStokesVectors?: boolean;
    spectralRgbGroupingEnabled?: boolean;
  }
): DisplayLuminanceRange | null {
  const cachedRange = renderCache.getCachedLuminanceRange(session.id, state);
  if (cachedRange) {
    return cachedRange;
  }

  return computeSampledDisplayLuminanceRange(
    layer,
    session.decoded.width,
    session.decoded.height,
    state.displaySelection,
    state.visualizationMode,
    {
      maskInvalidStokesVectors: state.maskInvalidStokesVectors,
      spectralRgbGroupingEnabled: state.spectralRgbGroupingEnabled
    }
  );
}

function computeSampledDisplayLuminanceRange(
  layer: DecodedLayer,
  width: number,
  height: number,
  selection: ViewerSessionState['displaySelection'],
  visualizationMode: VisualizationMode,
  options: { maskInvalidStokesVectors?: boolean; spectralRgbGroupingEnabled?: boolean } = {}
): DisplayLuminanceRange | null {
  const displaySize = resolveDisplayImageSize(width, height, selection);
  const pixelCount = Math.max(0, displaySize.width * displaySize.height);
  if (pixelCount === 0) {
    return null;
  }

  const evaluator = resolveDisplaySelectionEvaluator(layer, selection, visualizationMode, {
    maskInvalidStokesVectors: options.maskInvalidStokesVectors,
    spectralRgbGroupingEnabled: options.spectralRgbGroupingEnabled,
    sourceWidth: width,
    sourceHeight: height
  });
  const sample = createDisplayPixelValues();
  const sampleStep = Math.max(1, Math.ceil(pixelCount / PREVIEW_LUMINANCE_RANGE_MAX_SAMPLES));
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let finiteCount = 0;

  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += sampleStep) {
    readDisplaySelectionPixelValuesAtIndex(evaluator, pixelIndex, sample);
    const luminance = computeRec709Luminance(sample.r, sample.g, sample.b);
    if (!Number.isFinite(luminance)) {
      continue;
    }

    finiteCount += 1;
    min = Math.min(min, luminance);
    max = Math.max(max, luminance);
  }

  return finiteCount > 0 ? { min, max } : null;
}

function resolveBatchEntryVisualizationState(
  appState: ViewerAppState,
  sessionId: string,
  baseState: ViewerSessionState
): BatchEntryVisualizationState {
  const source = isStokesSelection(baseState.displaySelection)
    ? appState.stokesDisplayRestoreStates[sessionId] ?? null
    : baseState;

  if (!source) {
    return {
      visualizationMode: 'rgb',
      activeColormapId: appState.defaultColormapId,
      colormapRange: null,
      colormapRangeMode: 'alwaysAuto',
      colormapZeroCentered: false
    };
  }

  return {
    visualizationMode: source.visualizationMode,
    activeColormapId: source.activeColormapId,
    colormapRange: cloneDisplayLuminanceRange(source.colormapRange),
    colormapRangeMode: source.colormapRangeMode,
    colormapZeroCentered: source.colormapZeroCentered
  };
}

async function resolveBatchExportColormapLut(
  appState: ViewerAppState,
  colormapId: string,
  lutCache: Map<string, ColormapLut>,
  signal: AbortSignal
): Promise<ColormapLut> {
  const cached = lutCache.get(colormapId);
  if (cached) {
    return cached;
  }

  const loadedLut = selectColormapLutById(appState, colormapId);
  if (loadedLut) {
    lutCache.set(colormapId, loadedLut);
    return loadedLut;
  }

  const registry = appState.colormapRegistry;
  if (!registry) {
    throw new Error('No colormaps are available.');
  }
  if (!getColormapAsset(registry, colormapId)) {
    throw new Error(`Unknown colormap: ${colormapId}`);
  }

  const lut = await loadColormapLut(registry, colormapId, signal);
  lutCache.set(colormapId, lut);
  return lut;
}

function restoreActiveRendererBinding(
  core: ViewerAppCore,
  renderCache: RenderCacheService,
  renderer: WebGlExrRenderer
): void {
  const state = core.getState();
  const activeSession = selectActiveSession(state);
  if (!activeSession) {
    return;
  }

  const activeColormapLut = selectActiveColormapLut(state);
  if (activeColormapLut) {
    renderer.setColormapTexture(activeColormapLut.entryCount, activeColormapLut.rgba8);
  }
  const renderState = mergeRenderState(state.sessionState, state.interactionState, {
    maskInvalidStokesVectors: state.maskInvalidStokesVectors,
    spectralRgbGroupingEnabled: state.spectralRgbGroupingEnabled,
    invalidValueWarningEnabled: state.invalidValueWarningEnabled
  });
  renderCache.prepareActiveSession(activeSession, renderState);
  renderer.renderImage(renderState);
}

function assertActiveSessionCurrent(
  state: ViewerAppState,
  session: OpenedImageSession,
  signal?: AbortSignal
): void {
  if (signal) {
    throwIfAborted(signal, 'Image export cancelled.');
  }

  const activeSession = selectActiveSession(state);
  if (!activeSession || activeSession.id !== session.id || activeSession.decoded !== session.decoded) {
    throw createAbortError('Active image changed before export finished.');
  }
}

function assertSessionCurrent(
  state: ViewerAppState,
  session: OpenedImageSession,
  signal?: AbortSignal
): void {
  if (signal) {
    throwIfAborted(signal, 'Export cancelled.');
  }

  const currentSession = state.sessions.find((item) => item.id === session.id) ?? null;
  if (!currentSession || currentSession.decoded !== session.decoded) {
    throw createAbortError('Image changed before export finished.');
  }
}

export function triggerBrowserDownload(blob: Blob, filename: string): void {
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = filename;
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => {
    URL.revokeObjectURL(objectUrl);
  }, 1000);
}

function createJsonBlob(metadata: ScreenshotReproductionMetadataV2): Blob {
  return new Blob([serializeScreenshotReproductionMetadata(metadata)], {
    type: 'application/json'
  });
}

function createJsonBytes(metadata: ScreenshotReproductionMetadataV2): Uint8Array {
  return Uint8Array.from(new TextEncoder().encode(serializeScreenshotReproductionMetadata(metadata)));
}

function createZipBlob(files: Record<string, Uint8Array>): Blob {
  const zipBytes = zipSync(files);
  return createBlobFromBytes(zipBytes, 'application/zip');
}

function createBlobFromBytes(bytes: Uint8Array, type: string): Blob {
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return new Blob([buffer], { type });
}

function emitSingleExportProgress(
  onProgress: ExportProgressReporter | undefined,
  request: ExportImageRequest,
  stage: ExportProgressUpdate['stage'],
  completed = 0
): void {
  onProgress?.({
    completed,
    total: 1,
    stage,
    currentFilename: request.filename,
    indeterminate: true
  });
}

function buildScreenshotMetadataBundleFilename(pngFilename: string): string {
  return /\.png$/i.test(pngFilename)
    ? pngFilename.replace(/\.png$/i, '.zip')
    : `${pngFilename}.zip`;
}

function buildScreenshotRegionOutputFilename(
  baseFilename: string,
  regionIndex: number,
  regionCount: number,
  usedFilenames: Map<string, number>
): string {
  const screenshotFilename = /\.png$/i.test(baseFilename)
    ? baseFilename.replace(/\.png$/i, '-screenshot.png')
    : `${baseFilename}-screenshot.png`;
  const filename = regionCount <= 1
    ? screenshotFilename
    : screenshotFilename.replace(/\.png$/i, `.region-${String(regionIndex + 1).padStart(2, '0')}.png`);
  return uniquifyExportFilename(filename, usedFilenames);
}

function uniquifyExportFilename(filename: string, usedFilenames: Map<string, number>): string {
  const count = usedFilenames.get(filename) ?? 0;
  usedFilenames.set(filename, count + 1);
  if (count === 0) {
    return filename;
  }

  return filename.replace(/\.png$/i, ` (${count + 1}).png`);
}

export function resolveBoundedColormapExportSize(
  width: number,
  height: number,
  maxLongestEdge: number
): { width: number; height: number } {
  const longestEdge = Math.max(width, height);
  if (!Number.isFinite(maxLongestEdge) || maxLongestEdge <= 0 || longestEdge <= maxLongestEdge) {
    return { width, height };
  }

  const scale = maxLongestEdge / longestEdge;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale))
  };
}

export function resolveBoundedImageExportSize(
  width: number,
  height: number,
  maxLongestEdge: number
): { width: number; height: number } {
  return resolveBoundedColormapExportSize(width, height, maxLongestEdge);
}
