import {
  clampDisplayCacheBudgetMb,
  createSessionResourceEntry,
  displayCacheBudgetMbToBytes,
  estimateDecodedImageBytes,
  getTrackedResidentBytes,
  getTrackedResidentChannelBytes,
  readStoredDisplayCacheBudgetMb,
  saveStoredDisplayCacheBudgetMb,
  type ResidentChannelUpload,
  type ResidentLayerResourceEntry,
  type SessionResourceEntry
} from '../display-cache';
import {
  AUTO_EXPOSURE_PERCENTILE,
  type AutoExposureResult
} from '../analysis/auto-exposure';
import {
  pendingResource,
  successResource
} from '../async-resource';
import {
  buildDisplaySourceBinding,
  getDisplaySourceBindingChannelNames
} from '../display/bindings';
import {
  buildSpectralRgbSourceName,
  findSpectralRgbSeriesKeyForChannel,
  isSpectralRgbSourceName,
  isSpectralStokesRgbSourceName,
  pickDefaultSpectralRgbSelection
} from '../spectral';
import {
  buildDisplayAutoExposureRevisionKey,
  buildDisplayImageStatsRevisionKey,
  buildDisplayLuminanceRevisionKey,
  buildDisplayTextureRevisionKey,
  serializeDisplaySelectionLuminanceKey
} from '../display/revision-keys';
import { traceViewerInteraction } from '../interaction-trace';
import {
  computeDisplaySelectionLuminanceRange,
  computeDisplaySelectionLuminanceRangeAsync,
  computeDisplaySelectionImageStatsAsync
} from '../analysis/image-stats';
import {
  computeDisplaySelectionAutoExposureAsync,
  computeDisplaySelectionAutoExposurePreview
} from '../analysis/auto-exposure';
import { cloneDisplaySelection, type DisplaySelection } from '../display-model';
import { getFiniteChannelRange } from '../channel-storage';
import type {
  DecodedLayer,
  DisplayLuminanceRange,
  ImageStats,
  OpenedImageSession,
  ViewerRenderState,
  ViewerSessionState
} from '../types';
import { createAbortError, isAbortError, throwIfAborted, type Disposable } from '../lifecycle';

export interface PrepareActiveSessionResult {
  textureRevisionKey: string;
  textureDirty: boolean;
}

export interface RequestDisplayLuminanceRangeResult {
  displayLuminanceRange: DisplayLuminanceRange | null;
  pending: boolean;
}

export interface RequestAutoExposureResult {
  autoExposure: AutoExposureResult | null;
  previewAutoExposure?: AutoExposureResult | null;
  pending: boolean;
}

export interface RequestImageStatsResult {
  imageStats: ImageStats | null;
  pending: boolean;
}

export interface DisplayLuminanceRangeResolvedEvent {
  requestId: number | null;
  requestKey: string;
  sessionId: string;
  activeLayer: number;
  displaySelection: DisplaySelection | null;
  displayLuminanceRange: DisplayLuminanceRange | null;
}

export interface ImageStatsResolvedEvent {
  requestId: number | null;
  requestKey: string;
  sessionId: string;
  activeLayer: number;
  visualizationMode: ViewerSessionState['visualizationMode'];
  displaySelection: DisplaySelection | null;
  imageStats: ImageStats | null;
}

export interface AutoExposureResolvedEvent {
  requestId: number | null;
  requestKey: string;
  sessionId: string;
  activeLayer: number;
  visualizationMode: ViewerSessionState['visualizationMode'];
  displaySelection: DisplaySelection | null;
  autoExposure: AutoExposureResult | null;
}

interface RenderCacheUi {
  setDisplayCacheBudget: (mb: number) => void;
  setDisplayCacheUsage: (usedBytes: number, budgetBytes: number) => void;
}

interface RenderCacheRenderer {
  ensureLayerChannelsResident: (
    sessionId: string,
    layerIndex: number,
    width: number,
    height: number,
    layer: DecodedLayer,
    channelNames: string[]
  ) => ResidentChannelUpload[];
  setDisplaySelectionBindings: (
    sessionId: string,
    layerIndex: number,
    width: number,
    height: number,
    layer: DecodedLayer,
    selection: ViewerSessionState['displaySelection'],
    visualizationMode: ViewerSessionState['visualizationMode'],
    maskInvalidStokesVectors: boolean | undefined,
    textureRevisionKey: string,
    binding: ReturnType<typeof buildDisplaySourceBinding>
  ) => void;
  discardChannelSourceTexture: (sessionId: string, layerIndex: number, channelName: string) => void;
  discardLayerSourceTextures: (sessionId: string, layerIndex: number) => void;
  discardSessionTextures: (sessionId: string) => void;
}

interface ProtectedBinding {
  sessionId: string;
  layerIndex: number;
  channelNames: Set<string>;
}

interface IdleDeadlineLike {
  readonly didTimeout: boolean;
  timeRemaining(): number;
}

type IdleCallbackLike = (deadline: IdleDeadlineLike) => void;

export interface RenderCacheWindowLike {
  requestAnimationFrame?: (callback: FrameRequestCallback) => number;
  cancelAnimationFrame?: (handle: number) => void;
  setTimeout: typeof window.setTimeout;
  clearTimeout?: typeof window.clearTimeout;
  requestIdleCallback?: (callback: IdleCallbackLike, options?: { timeout?: number }) => number;
  cancelIdleCallback?: (handle: number) => void;
}

interface PendingDisplayLuminanceRangeJob {
  requestId: number | null;
  sessionId: string;
  revisionKey: string;
  activeLayer: number;
  visualizationMode: ViewerSessionState['visualizationMode'];
  displaySelection: DisplaySelection | null;
  maskInvalidStokesVectors?: boolean;
  width: number;
  height: number;
  layer: DecodedLayer;
  controller: AbortController;
}

interface PendingImageStatsJob {
  requestId: number | null;
  sessionId: string;
  revisionKey: string;
  activeLayer: number;
  visualizationMode: ViewerSessionState['visualizationMode'];
  displaySelection: DisplaySelection | null;
  maskInvalidStokesVectors?: boolean;
  width: number;
  height: number;
  layer: DecodedLayer;
  controller: AbortController;
}

interface PendingAutoExposureJob {
  requestId: number | null;
  sessionId: string;
  revisionKey: string;
  activeLayer: number;
  visualizationMode: ViewerSessionState['visualizationMode'];
  displaySelection: DisplaySelection | null;
  maskInvalidStokesVectors?: boolean;
  percentile: number;
  width: number;
  height: number;
  layer: DecodedLayer;
  controller: AbortController;
}

type PendingAnalysisJob =
  | PendingDisplayLuminanceRangeJob
  | PendingImageStatsJob
  | PendingAutoExposureJob;

type RenderCacheDisplayState =
  Pick<ViewerSessionState, 'activeLayer' | 'displaySelection' | 'visualizationMode'> &
  Partial<Pick<ViewerRenderState, 'maskInvalidStokesVectors'>>;

const DISPLAY_LUMINANCE_RANGE_IDLE_TIMEOUT_MS = 250;
const DISPLAY_LUMINANCE_RANGE_IDLE_FALLBACK_DELAY_MS = 64;
const SPECTRAL_RGB_PREWARM_IDLE_TIMEOUT_MS = 500;
const DEFAULT_ANALYSIS_COMPUTE_CHUNK_SIZE = 32_768;

export interface RenderCacheServiceDependencies {
  ui: RenderCacheUi;
  renderer: RenderCacheRenderer;
  getActiveSessionId?: () => string | null;
  onDisplayLuminanceRangeResolved?: (event: DisplayLuminanceRangeResolvedEvent) => void;
  onImageStatsResolved?: (event: ImageStatsResolvedEvent) => void;
  onAutoExposureResolved?: (event: AutoExposureResolvedEvent) => void;
  windowLike?: RenderCacheWindowLike | null;
  analysisChunkSize?: number;
}

export class RenderCacheService implements Disposable {
  private readonly ui: RenderCacheUi;
  private readonly renderer: RenderCacheRenderer;
  private readonly getActiveSessionId: () => string | null;
  private readonly onDisplayLuminanceRangeResolved: (event: DisplayLuminanceRangeResolvedEvent) => void;
  private readonly onImageStatsResolved: (event: ImageStatsResolvedEvent) => void;
  private readonly onAutoExposureResolved: (event: AutoExposureResolvedEvent) => void;
  private readonly windowLike: RenderCacheWindowLike | null;
  private readonly analysisChunkSize: number;

  private readonly entries = new Map<string, SessionResourceEntry>();
  private readonly pendingDisplayLuminanceRangeJobs = new Map<string, Map<string, PendingDisplayLuminanceRangeJob>>();
  private readonly queuedDisplayLuminanceRangeJobs: PendingDisplayLuminanceRangeJob[] = [];
  private readonly pendingImageStatsJobs = new Map<string, Map<string, PendingImageStatsJob>>();
  private readonly queuedImageStatsJobs: PendingImageStatsJob[] = [];
  private readonly pendingAutoExposureJobs = new Map<string, Map<string, PendingAutoExposureJob>>();
  private readonly queuedAutoExposureJobs: PendingAutoExposureJob[] = [];
  private readonly abortController = new AbortController();
  private budgetMb = readStoredDisplayCacheBudgetMb();
  private boundSessionId: string | null = null;
  private boundLayerIndex: number | null = null;
  private boundChannelNames = new Set<string>();
  private boundTextureRevisionKey = '';
  private activeHotSessionId: string | null = null;
  private activeHotLayerIndex: number | null = null;
  private activeHotChannelNames = new Set<string>();
  private spectralRgbPrewarmToken = 0;
  private pendingSpectralRgbPrewarmKey: string | null = null;
  private nextAccessToken = 1;
  private processingPromise: Promise<void> | null = null;
  private processingImageStatsPromise: Promise<void> | null = null;
  private processingAutoExposurePromise: Promise<void> | null = null;
  private disposed = false;

  constructor(dependencies: RenderCacheServiceDependencies) {
    this.ui = dependencies.ui;
    this.renderer = dependencies.renderer;
    this.getActiveSessionId = dependencies.getActiveSessionId ?? (() => null);
    this.onDisplayLuminanceRangeResolved = dependencies.onDisplayLuminanceRangeResolved ?? (() => undefined);
    this.onImageStatsResolved = dependencies.onImageStatsResolved ?? (() => undefined);
    this.onAutoExposureResolved = dependencies.onAutoExposureResolved ?? (() => undefined);
    this.windowLike = dependencies.windowLike ?? resolveWindowLike();
    this.analysisChunkSize = normalizeAnalysisChunkSize(dependencies.analysisChunkSize);

    this.ui.setDisplayCacheBudget(this.budgetMb);
    this.syncDisplayCacheUsageUi();
  }

  prepareActiveSession(
    session: OpenedImageSession,
    state: ViewerSessionState & Partial<Pick<ViewerRenderState, 'maskInvalidStokesVectors'>>
  ): PrepareActiveSessionResult {
    if (this.disposed) {
      return {
        textureRevisionKey: '',
        textureDirty: false
      };
    }

    const entry = this.getOrCreateEntry(session.id);
    this.updateDecodedBytes(entry, session);

    const layer = session.decoded.layers[state.activeLayer] ?? null;
    if (!layer || session.decoded.width <= 0 || session.decoded.height <= 0) {
      if (this.getActiveSessionId() === session.id) {
        this.clearActiveHotSourceTracking(session.id);
      }
      this.enforceResidencyBudget();
      this.syncDisplayCacheUsageUi();
      return {
        textureRevisionKey: '',
        textureDirty: false
      };
    }

    const textureRevisionKey = buildDisplayTextureRevisionKey(state);
    const binding = buildDisplaySourceBinding(layer, state.displaySelection, state.visualizationMode);
    const requiredChannelNames = getDisplaySourceBindingChannelNames(binding).filter((channelName) => {
      return isDerivedDisplaySourceName(channelName) ||
        layer.channelStorage.channelIndexByName[channelName] !== undefined;
    });
    const protectedBinding = this.resolvePrepareProtectedBinding(
      session.id,
      state.activeLayer,
      layer,
      state.displaySelection,
      requiredChannelNames
    );
    const { missingChannelNames } = this.ensureResidentChannels({
      session,
      layerIndex: state.activeLayer,
      width: session.decoded.width,
      height: session.decoded.height,
      layer,
      channelNames: requiredChannelNames,
      protectedBinding
    });
    const textureDirty =
      missingChannelNames.length > 0 ||
      this.boundSessionId !== session.id ||
      this.boundTextureRevisionKey !== textureRevisionKey;

    if (textureDirty) {
      this.renderer.setDisplaySelectionBindings(
        session.id,
        state.activeLayer,
        session.decoded.width,
        session.decoded.height,
        layer,
        state.displaySelection,
        state.visualizationMode,
        state.maskInvalidStokesVectors,
        textureRevisionKey,
        binding
      );
      this.setBoundTextureTracking(protectedBinding, textureRevisionKey);
    }

    this.enforceResidencyBudget({
      protectedBinding
    });
    this.syncDisplayCacheUsageUi();
    this.scheduleSpectralRgbPrewarm(session, state, layer);

    return {
      textureRevisionKey,
      textureDirty
    };
  }

  requestDisplayLuminanceRange(
    session: OpenedImageSession,
    state: RenderCacheDisplayState,
    requestId: number | null = null
  ): RequestDisplayLuminanceRangeResult {
    if (this.disposed) {
      return {
        displayLuminanceRange: null,
        pending: false
      };
    }

    const layer = session.decoded.layers[state.activeLayer] ?? null;
    if (!layer || session.decoded.width <= 0 || session.decoded.height <= 0) {
      return {
        displayLuminanceRange: null,
        pending: false
      };
    }

    this.cancelAnalysisJobsForInactiveSessions();
    const entry = this.getOrCreateEntry(session.id);
    const revisionKey = buildDisplayLuminanceRevisionKey(state);
    const cachedRange = entry.luminanceRangeByRevision.get(revisionKey);
    if (cachedRange?.status === 'success') {
      return {
        displayLuminanceRange: cachedRange.value,
        pending: false
      };
    }

    this.cancelSupersededDisplayLuminanceRangeJobs(session.id, revisionKey);
    const pendingJobs = this.getOrCreatePendingDisplayLuminanceRangeJobs(session.id);
    if (pendingJobs.has(revisionKey)) {
      const existingJob = pendingJobs.get(revisionKey);
      if (existingJob) {
        existingJob.requestId = requestId;
        entry.luminanceRangeByRevision.set(
          revisionKey,
          pendingResource(buildSessionResourceKey(session.id, revisionKey), requestId ?? 0)
        );
      }
      return {
        displayLuminanceRange: null,
        pending: true
      };
    }

    const job: PendingDisplayLuminanceRangeJob = {
      requestId,
      sessionId: session.id,
      revisionKey,
      activeLayer: state.activeLayer,
      visualizationMode: state.visualizationMode,
      displaySelection: cloneDisplaySelection(state.displaySelection),
      maskInvalidStokesVectors: state.maskInvalidStokesVectors,
      width: session.decoded.width,
      height: session.decoded.height,
      layer,
      controller: new AbortController()
    };
    pendingJobs.set(revisionKey, job);
    entry.luminanceRangeByRevision.set(
      revisionKey,
      pendingResource(buildSessionResourceKey(session.id, revisionKey), requestId ?? 0)
    );
    this.queuedDisplayLuminanceRangeJobs.push(job);
    void this.processDisplayLuminanceRangeJobs();

    return {
      displayLuminanceRange: null,
      pending: true
    };
  }

  requestImageStats(
    session: OpenedImageSession,
    state: RenderCacheDisplayState,
    requestId: number | null = null
  ): RequestImageStatsResult {
    if (this.disposed) {
      return {
        imageStats: null,
        pending: false
      };
    }

    const layer = session.decoded.layers[state.activeLayer] ?? null;
    if (!layer || session.decoded.width <= 0 || session.decoded.height <= 0) {
      return {
        imageStats: null,
        pending: false
      };
    }

    this.cancelAnalysisJobsForInactiveSessions();
    const entry = this.getOrCreateEntry(session.id);
    const revisionKey = buildDisplayImageStatsRevisionKey(state);
    const cachedStats = entry.imageStatsByRevision.get(revisionKey);
    if (cachedStats?.status === 'success') {
      return {
        imageStats: cachedStats.value,
        pending: false
      };
    }

    this.cancelSupersededImageStatsJobs(session.id, revisionKey);
    const pendingJobs = this.getOrCreatePendingImageStatsJobs(session.id);
    if (pendingJobs.has(revisionKey)) {
      const existingJob = pendingJobs.get(revisionKey);
      if (existingJob) {
        existingJob.requestId = requestId;
        entry.imageStatsByRevision.set(
          revisionKey,
          pendingResource(buildSessionResourceKey(session.id, revisionKey), requestId ?? 0)
        );
      }
      return {
        imageStats: null,
        pending: true
      };
    }

    const job: PendingImageStatsJob = {
      requestId,
      sessionId: session.id,
      revisionKey,
      activeLayer: state.activeLayer,
      visualizationMode: state.visualizationMode,
      displaySelection: cloneDisplaySelection(state.displaySelection),
      maskInvalidStokesVectors: state.maskInvalidStokesVectors,
      width: session.decoded.width,
      height: session.decoded.height,
      layer,
      controller: new AbortController()
    };
    pendingJobs.set(revisionKey, job);
    entry.imageStatsByRevision.set(
      revisionKey,
      pendingResource(buildSessionResourceKey(session.id, revisionKey), requestId ?? 0)
    );
    this.queuedImageStatsJobs.push(job);
    void this.processImageStatsJobs();

    return {
      imageStats: null,
      pending: true
    };
  }

  requestAutoExposure(
    session: OpenedImageSession,
    state: RenderCacheDisplayState,
    requestId: number | null = null,
    percentile = AUTO_EXPOSURE_PERCENTILE
  ): RequestAutoExposureResult {
    if (this.disposed || state.visualizationMode !== 'rgb') {
      return {
        autoExposure: null,
        pending: false
      };
    }

    const layer = session.decoded.layers[state.activeLayer] ?? null;
    if (!layer || session.decoded.width <= 0 || session.decoded.height <= 0) {
      return {
        autoExposure: null,
        pending: false
      };
    }

    this.cancelAnalysisJobsForInactiveSessions();
    const entry = this.getOrCreateEntry(session.id);
    const revisionKey = buildDisplayAutoExposureRevisionKey(state, percentile);
    const cachedAutoExposure = entry.autoExposureByRevision.get(revisionKey);
    if (cachedAutoExposure?.status === 'success') {
      return {
        autoExposure: cachedAutoExposure.value,
        pending: false
      };
    }

    const previewAutoExposure = computeDisplaySelectionAutoExposurePreview(
      layer,
      session.decoded.width,
      session.decoded.height,
      state.displaySelection,
      state.visualizationMode,
      percentile,
      { maskInvalidStokesVectors: state.maskInvalidStokesVectors }
    );

    this.cancelSupersededAutoExposureJobs(session.id, revisionKey);
    const pendingJobs = this.getOrCreatePendingAutoExposureJobs(session.id);
    if (pendingJobs.has(revisionKey)) {
      const existingJob = pendingJobs.get(revisionKey);
      if (existingJob) {
        existingJob.requestId = requestId;
        entry.autoExposureByRevision.set(
          revisionKey,
          pendingResource(buildSessionResourceKey(session.id, revisionKey), requestId ?? 0)
        );
      }
      return {
        autoExposure: null,
        previewAutoExposure,
        pending: true
      };
    }

    const job: PendingAutoExposureJob = {
      requestId,
      sessionId: session.id,
      revisionKey,
      activeLayer: state.activeLayer,
      visualizationMode: state.visualizationMode,
      displaySelection: cloneDisplaySelection(state.displaySelection),
      maskInvalidStokesVectors: state.maskInvalidStokesVectors,
      percentile,
      width: session.decoded.width,
      height: session.decoded.height,
      layer,
      controller: new AbortController()
    };
    pendingJobs.set(revisionKey, job);
    entry.autoExposureByRevision.set(
      revisionKey,
      pendingResource(buildSessionResourceKey(session.id, revisionKey), requestId ?? 0)
    );
    this.queuedAutoExposureJobs.push(job);
    void this.processAutoExposureJobs();

    return {
      autoExposure: null,
      previewAutoExposure,
      pending: true
    };
  }

  getCachedLuminanceRange(
    sessionId: string,
    state: RenderCacheDisplayState
  ): DisplayLuminanceRange | null {
    if (this.disposed) {
      return null;
    }

    const entry = this.entries.get(sessionId);
    if (!entry) {
      return null;
    }

    const resource = entry.luminanceRangeByRevision.get(buildDisplayLuminanceRevisionKey(state));
    return resource?.status === 'success' ? resource.value : null;
  }

  getCachedImageStats(
    sessionId: string,
    state: RenderCacheDisplayState
  ): ImageStats | null {
    if (this.disposed) {
      return null;
    }

    const entry = this.entries.get(sessionId);
    if (!entry) {
      return null;
    }

    const resource = entry.imageStatsByRevision.get(buildDisplayImageStatsRevisionKey(state));
    return resource?.status === 'success' ? resource.value : null;
  }

  resolveDisplayLuminanceRange(
    session: OpenedImageSession,
    state: RenderCacheDisplayState
  ): DisplayLuminanceRange | null {
    if (this.disposed) {
      return null;
    }

    const layer = session.decoded.layers[state.activeLayer] ?? null;
    if (!layer || session.decoded.width <= 0 || session.decoded.height <= 0) {
      return null;
    }

    const entry = this.getOrCreateEntry(session.id);
    const revisionKey = buildDisplayLuminanceRevisionKey(state);
    const cachedRange = entry.luminanceRangeByRevision.get(revisionKey);
    if (cachedRange?.status === 'success') {
      return cachedRange.value;
    }

    const range = this.getOrComputeDisplayLuminanceRange(
      layer,
      session.decoded.width,
      session.decoded.height,
      state.displaySelection,
      state.visualizationMode,
      state.maskInvalidStokesVectors
    );
    entry.luminanceRangeByRevision.set(
      revisionKey,
      successResource(buildSessionResourceKey(session.id, revisionKey), range)
    );
    return range;
  }

  setBudgetMb(valueMb: number): void {
    if (this.disposed) {
      return;
    }

    this.budgetMb = clampDisplayCacheBudgetMb(valueMb);
    this.enforceResidencyBudget();
    saveStoredDisplayCacheBudgetMb(this.budgetMb);
    this.ui.setDisplayCacheBudget(this.budgetMb);
    this.syncDisplayCacheUsageUi();
  }

  trackSession(session: OpenedImageSession): void {
    if (this.disposed) {
      return;
    }

    const entry = this.getOrCreateEntry(session.id);
    this.updateDecodedBytes(entry, session);
    this.enforceResidencyBudget();
    this.syncDisplayCacheUsageUi();
  }

  discard(sessionId: string): void {
    if (this.disposed) {
      return;
    }

    this.removePendingDisplayLuminanceRangeJobsForSession(sessionId);
    this.entries.delete(sessionId);
    this.renderer.discardSessionTextures(sessionId);
    this.clearBoundTextureTracking(sessionId);
    this.clearActiveHotSourceTracking(sessionId);
    this.syncDisplayCacheUsageUi();
  }

  clear(): void {
    if (this.disposed) {
      return;
    }

    for (const sessionId of this.entries.keys()) {
      this.renderer.discardSessionTextures(sessionId);
    }
    this.cancelAllAnalysisJobs('Render cache was cleared.');
    this.entries.clear();
    this.boundSessionId = null;
    this.boundLayerIndex = null;
    this.boundChannelNames.clear();
    this.boundTextureRevisionKey = '';
    this.clearActiveHotSourceTracking();
    this.nextAccessToken = 1;
    this.syncDisplayCacheUsageUi();
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.abortController.abort(createAbortError('Render cache service has been disposed.'));
    this.cancelAllAnalysisJobs('Render cache service has been disposed.');
    for (const sessionId of this.entries.keys()) {
      this.renderer.discardSessionTextures(sessionId);
    }
    this.entries.clear();
    this.boundSessionId = null;
    this.boundLayerIndex = null;
    this.boundChannelNames.clear();
    this.boundTextureRevisionKey = '';
    this.clearActiveHotSourceTracking();
    this.nextAccessToken = 1;
  }

  setSessionPinned(sessionId: string, pinned: boolean): void {
    if (this.disposed) {
      return;
    }

    if (!pinned && !this.entries.has(sessionId)) {
      return;
    }

    const entry = this.getOrCreateEntry(sessionId);
    entry.pinned = pinned;
    if (!pinned) {
      this.enforceResidencyBudget();
    }
    this.syncDisplayCacheUsageUi();
  }

  isSessionPinned(sessionId: string): boolean {
    if (this.disposed) {
      return false;
    }

    return this.entries.get(sessionId)?.pinned ?? false;
  }

  private async processDisplayLuminanceRangeJobs(): Promise<void> {
    if (this.processingPromise) {
      return this.processingPromise;
    }

    this.processingPromise = (async () => {
      try {
        while (this.queuedDisplayLuminanceRangeJobs.length > 0) {
          throwIfAborted(this.abortController.signal, 'Render cache service has been disposed.');

          const job = this.queuedDisplayLuminanceRangeJobs.shift();
          if (!job) {
            continue;
          }

          if (!this.isDisplayLuminanceRangeJobCurrent(job)) {
            this.cancelDisplayLuminanceRangeJob(job, 'Display luminance range request became stale.');
            continue;
          }

          await this.waitForNextPaint(job.controller.signal);
          this.throwIfAnalysisJobAborted(job);
          await this.waitForIdleSlot(DISPLAY_LUMINANCE_RANGE_IDLE_TIMEOUT_MS, job.controller.signal);
          this.throwIfAnalysisJobAborted(job);

          if (!this.isDisplayLuminanceRangeJobCurrent(job)) {
            this.cancelDisplayLuminanceRangeJob(job, 'Display luminance range request became stale.');
            continue;
          }

          const range = await this.getOrComputeDisplayLuminanceRangeAsync(
            job.layer,
            job.width,
            job.height,
            job.displaySelection,
            job.visualizationMode,
            job.maskInvalidStokesVectors,
            job.controller.signal
          );

          if (!this.isDisplayLuminanceRangeJobCurrent(job)) {
            this.cancelDisplayLuminanceRangeJob(job, 'Display luminance range request became stale.');
            continue;
          }

          this.cacheDisplayLuminanceRange(job, range);
          const entry = this.entries.get(job.sessionId);
          this.removePendingDisplayLuminanceRangeJob(job.sessionId, job.revisionKey);
          if (!entry) {
            continue;
          }

          const requestKey = buildSessionResourceKey(job.sessionId, job.revisionKey);
          entry.luminanceRangeByRevision.set(job.revisionKey, successResource(requestKey, range));
          this.onDisplayLuminanceRangeResolved({
            requestId: job.requestId,
            requestKey,
            sessionId: job.sessionId,
            activeLayer: job.activeLayer,
            displaySelection: cloneDisplaySelection(job.displaySelection),
            displayLuminanceRange: range
          });
        }
      } catch (error) {
        if (!isAbortError(error)) {
          throw error;
        }
      } finally {
        this.processingPromise = null;
        if (!this.disposed && this.queuedDisplayLuminanceRangeJobs.length > 0) {
          void this.processDisplayLuminanceRangeJobs();
        }
      }
    })();

    return this.processingPromise;
  }

  private async processImageStatsJobs(): Promise<void> {
    if (this.processingImageStatsPromise) {
      return this.processingImageStatsPromise;
    }

    this.processingImageStatsPromise = (async () => {
      try {
        while (this.queuedImageStatsJobs.length > 0) {
          throwIfAborted(this.abortController.signal, 'Render cache service has been disposed.');

          const job = this.queuedImageStatsJobs.shift();
          if (!job) {
            continue;
          }

          if (!this.isImageStatsJobCurrent(job)) {
            this.cancelImageStatsJob(job, 'Image stats request became stale.');
            continue;
          }

          await this.waitForNextPaint(job.controller.signal);
          this.throwIfAnalysisJobAborted(job);
          await this.waitForIdleSlot(DISPLAY_LUMINANCE_RANGE_IDLE_TIMEOUT_MS, job.controller.signal);
          this.throwIfAnalysisJobAborted(job);

          if (!this.isImageStatsJobCurrent(job)) {
            this.cancelImageStatsJob(job, 'Image stats request became stale.');
            continue;
          }

          const imageStats = await computeDisplaySelectionImageStatsAsync(
            job.layer,
            job.width,
            job.height,
            job.displaySelection,
            job.visualizationMode,
            {
              ...this.createAnalysisComputeOptions(job.controller.signal),
              maskInvalidStokesVectors: job.maskInvalidStokesVectors
            }
          );

          if (!this.isImageStatsJobCurrent(job)) {
            this.cancelImageStatsJob(job, 'Image stats request became stale.');
            continue;
          }

          const entry = this.entries.get(job.sessionId);
          this.removePendingImageStatsJob(job.sessionId, job.revisionKey);
          if (!entry) {
            continue;
          }

          const requestKey = buildSessionResourceKey(job.sessionId, job.revisionKey);
          entry.imageStatsByRevision.set(job.revisionKey, successResource(requestKey, imageStats));
          this.onImageStatsResolved({
            requestId: job.requestId,
            requestKey,
            sessionId: job.sessionId,
            activeLayer: job.activeLayer,
            visualizationMode: job.visualizationMode,
            displaySelection: cloneDisplaySelection(job.displaySelection),
            imageStats
          });
        }
      } catch (error) {
        if (!isAbortError(error)) {
          throw error;
        }
      } finally {
        this.processingImageStatsPromise = null;
        if (!this.disposed && this.queuedImageStatsJobs.length > 0) {
          void this.processImageStatsJobs();
        }
      }
    })();

    return this.processingImageStatsPromise;
  }

  private async processAutoExposureJobs(): Promise<void> {
    if (this.processingAutoExposurePromise) {
      return this.processingAutoExposurePromise;
    }

    this.processingAutoExposurePromise = (async () => {
      try {
        while (this.queuedAutoExposureJobs.length > 0) {
          throwIfAborted(this.abortController.signal, 'Render cache service has been disposed.');

          const job = this.queuedAutoExposureJobs.shift();
          if (!job) {
            continue;
          }

          if (!this.isAutoExposureJobCurrent(job)) {
            this.cancelAutoExposureJob(job, 'Auto exposure request became stale.');
            continue;
          }

          await this.waitForNextPaint(job.controller.signal);
          this.throwIfAnalysisJobAborted(job);
          await this.waitForIdleSlot(DISPLAY_LUMINANCE_RANGE_IDLE_TIMEOUT_MS, job.controller.signal);
          this.throwIfAnalysisJobAborted(job);

          if (!this.isAutoExposureJobCurrent(job)) {
            this.cancelAutoExposureJob(job, 'Auto exposure request became stale.');
            continue;
          }

          const autoExposure = await computeDisplaySelectionAutoExposureAsync(
            job.layer,
            job.width,
            job.height,
            job.displaySelection,
            job.visualizationMode,
            job.percentile,
            {
              ...this.createAnalysisComputeOptions(job.controller.signal),
              maskInvalidStokesVectors: job.maskInvalidStokesVectors
            }
          );

          if (!this.isAutoExposureJobCurrent(job)) {
            this.cancelAutoExposureJob(job, 'Auto exposure request became stale.');
            continue;
          }

          const entry = this.entries.get(job.sessionId);
          this.removePendingAutoExposureJob(job.sessionId, job.revisionKey);
          if (!entry) {
            continue;
          }

          const requestKey = buildSessionResourceKey(job.sessionId, job.revisionKey);
          entry.autoExposureByRevision.set(job.revisionKey, successResource(requestKey, autoExposure));
          this.onAutoExposureResolved({
            requestId: job.requestId,
            requestKey,
            sessionId: job.sessionId,
            activeLayer: job.activeLayer,
            visualizationMode: job.visualizationMode,
            displaySelection: cloneDisplaySelection(job.displaySelection),
            autoExposure
          });
        }
      } catch (error) {
        if (!isAbortError(error)) {
          throw error;
        }
      } finally {
        this.processingAutoExposurePromise = null;
        if (!this.disposed && this.queuedAutoExposureJobs.length > 0) {
          void this.processAutoExposureJobs();
        }
      }
    })();

    return this.processingAutoExposurePromise;
  }

  private getOrCreateEntry(sessionId: string): SessionResourceEntry {
    const existing = this.entries.get(sessionId);
    if (existing) {
      return existing;
    }

    const entry = createSessionResourceEntry(sessionId);
    this.entries.set(sessionId, entry);
    return entry;
  }

  private getOrCreatePendingDisplayLuminanceRangeJobs(
    sessionId: string
  ): Map<string, PendingDisplayLuminanceRangeJob> {
    const existing = this.pendingDisplayLuminanceRangeJobs.get(sessionId);
    if (existing) {
      return existing;
    }

    const pendingJobs = new Map<string, PendingDisplayLuminanceRangeJob>();
    this.pendingDisplayLuminanceRangeJobs.set(sessionId, pendingJobs);
    return pendingJobs;
  }

  private getOrCreatePendingImageStatsJobs(
    sessionId: string
  ): Map<string, PendingImageStatsJob> {
    const existing = this.pendingImageStatsJobs.get(sessionId);
    if (existing) {
      return existing;
    }

    const pendingJobs = new Map<string, PendingImageStatsJob>();
    this.pendingImageStatsJobs.set(sessionId, pendingJobs);
    return pendingJobs;
  }

  private getOrCreatePendingAutoExposureJobs(
    sessionId: string
  ): Map<string, PendingAutoExposureJob> {
    const existing = this.pendingAutoExposureJobs.get(sessionId);
    if (existing) {
      return existing;
    }

    const pendingJobs = new Map<string, PendingAutoExposureJob>();
    this.pendingAutoExposureJobs.set(sessionId, pendingJobs);
    return pendingJobs;
  }

  private hasPendingDisplayLuminanceRangeJob(job: PendingDisplayLuminanceRangeJob): boolean {
    return this.pendingDisplayLuminanceRangeJobs.get(job.sessionId)?.get(job.revisionKey) === job;
  }

  private hasPendingImageStatsJob(job: PendingImageStatsJob): boolean {
    return this.pendingImageStatsJobs.get(job.sessionId)?.get(job.revisionKey) === job;
  }

  private hasPendingAutoExposureJob(job: PendingAutoExposureJob): boolean {
    return this.pendingAutoExposureJobs.get(job.sessionId)?.get(job.revisionKey) === job;
  }

  private isDisplayLuminanceRangeJobCurrent(job: PendingDisplayLuminanceRangeJob): boolean {
    return (
      !this.disposed &&
      !job.controller.signal.aborted &&
      this.hasPendingDisplayLuminanceRangeJob(job) &&
      this.isAnalysisJobSessionCurrent(job)
    );
  }

  private isImageStatsJobCurrent(job: PendingImageStatsJob): boolean {
    return (
      !this.disposed &&
      !job.controller.signal.aborted &&
      this.hasPendingImageStatsJob(job) &&
      this.isAnalysisJobSessionCurrent(job)
    );
  }

  private isAutoExposureJobCurrent(job: PendingAutoExposureJob): boolean {
    return (
      !this.disposed &&
      !job.controller.signal.aborted &&
      this.hasPendingAutoExposureJob(job) &&
      this.isAnalysisJobSessionCurrent(job)
    );
  }

  private isAnalysisJobSessionCurrent(job: PendingAnalysisJob): boolean {
    const activeSessionId = this.getActiveSessionId();
    return !activeSessionId || activeSessionId === job.sessionId;
  }

  private throwIfAnalysisJobAborted(job: PendingAnalysisJob): void {
    throwIfAborted(this.abortController.signal, 'Render cache service has been disposed.');
    throwIfAborted(job.controller.signal, 'Render cache job was cancelled.');
  }

  private createAnalysisComputeOptions(signal: AbortSignal) {
    return {
      signal,
      chunkSize: this.analysisChunkSize,
      yieldControl: () => this.waitForIdleSlot(0, signal)
    };
  }

  private removePendingDisplayLuminanceRangeJob(sessionId: string, revisionKey: string): void {
    const pendingJobs = this.pendingDisplayLuminanceRangeJobs.get(sessionId);
    if (!pendingJobs) {
      return;
    }

    pendingJobs.delete(revisionKey);
    if (pendingJobs.size === 0) {
      this.pendingDisplayLuminanceRangeJobs.delete(sessionId);
    }
  }

  private removePendingImageStatsJob(sessionId: string, revisionKey: string): void {
    const pendingJobs = this.pendingImageStatsJobs.get(sessionId);
    if (!pendingJobs) {
      return;
    }

    pendingJobs.delete(revisionKey);
    if (pendingJobs.size === 0) {
      this.pendingImageStatsJobs.delete(sessionId);
    }
  }

  private removePendingAutoExposureJob(sessionId: string, revisionKey: string): void {
    const pendingJobs = this.pendingAutoExposureJobs.get(sessionId);
    if (!pendingJobs) {
      return;
    }

    pendingJobs.delete(revisionKey);
    if (pendingJobs.size === 0) {
      this.pendingAutoExposureJobs.delete(sessionId);
    }
  }

  private removePendingDisplayLuminanceRangeJobsForSession(sessionId: string): void {
    this.cancelDisplayLuminanceRangeJobsWhere(
      (job) => job.sessionId === sessionId,
      'Render cache session was discarded.'
    );
    this.cancelImageStatsJobsWhere(
      (job) => job.sessionId === sessionId,
      'Render cache session was discarded.'
    );
    this.cancelAutoExposureJobsWhere(
      (job) => job.sessionId === sessionId,
      'Render cache session was discarded.'
    );
  }

  private cancelAnalysisJobsForInactiveSessions(): void {
    const activeSessionId = this.getActiveSessionId();
    if (!activeSessionId) {
      return;
    }

    this.cancelDisplayLuminanceRangeJobsWhere(
      (job) => job.sessionId !== activeSessionId,
      'Render cache job became inactive.'
    );
    this.cancelImageStatsJobsWhere(
      (job) => job.sessionId !== activeSessionId,
      'Render cache job became inactive.'
    );
    this.cancelAutoExposureJobsWhere(
      (job) => job.sessionId !== activeSessionId,
      'Render cache job became inactive.'
    );
  }

  private cancelSupersededDisplayLuminanceRangeJobs(sessionId: string, revisionKey: string): void {
    this.cancelDisplayLuminanceRangeJobsWhere(
      (job) => job.sessionId === sessionId && job.revisionKey !== revisionKey,
      'Display luminance range request was superseded.'
    );
  }

  private cancelSupersededImageStatsJobs(sessionId: string, revisionKey: string): void {
    this.cancelImageStatsJobsWhere(
      (job) => job.sessionId === sessionId && job.revisionKey !== revisionKey,
      'Image stats request was superseded.'
    );
  }

  private cancelSupersededAutoExposureJobs(sessionId: string, revisionKey: string): void {
    this.cancelAutoExposureJobsWhere(
      (job) => job.sessionId === sessionId && job.revisionKey !== revisionKey,
      'Auto exposure request was superseded.'
    );
  }

  private cancelAllAnalysisJobs(message: string): void {
    this.cancelDisplayLuminanceRangeJobsWhere(() => true, message);
    this.cancelImageStatsJobsWhere(() => true, message);
    this.cancelAutoExposureJobsWhere(() => true, message);
  }

  private cancelDisplayLuminanceRangeJob(job: PendingDisplayLuminanceRangeJob, message: string): void {
    this.cancelDisplayLuminanceRangeJobsWhere((candidate) => candidate === job, message);
  }

  private cancelImageStatsJob(job: PendingImageStatsJob, message: string): void {
    this.cancelImageStatsJobsWhere((candidate) => candidate === job, message);
  }

  private cancelAutoExposureJob(job: PendingAutoExposureJob, message: string): void {
    this.cancelAutoExposureJobsWhere((candidate) => candidate === job, message);
  }

  private cancelDisplayLuminanceRangeJobsWhere(
    predicate: (job: PendingDisplayLuminanceRangeJob) => boolean,
    message: string
  ): void {
    this.cancelPendingAnalysisJobs(
      this.pendingDisplayLuminanceRangeJobs,
      this.queuedDisplayLuminanceRangeJobs,
      predicate,
      message
    );
  }

  private cancelImageStatsJobsWhere(
    predicate: (job: PendingImageStatsJob) => boolean,
    message: string
  ): void {
    this.cancelPendingAnalysisJobs(
      this.pendingImageStatsJobs,
      this.queuedImageStatsJobs,
      predicate,
      message
    );
  }

  private cancelAutoExposureJobsWhere(
    predicate: (job: PendingAutoExposureJob) => boolean,
    message: string
  ): void {
    this.cancelPendingAnalysisJobs(
      this.pendingAutoExposureJobs,
      this.queuedAutoExposureJobs,
      predicate,
      message
    );
  }

  private cancelPendingAnalysisJobs<TJob extends PendingAnalysisJob>(
    pendingJobsBySession: Map<string, Map<string, TJob>>,
    queuedJobs: TJob[],
    predicate: (job: TJob) => boolean,
    message: string
  ): void {
    for (const [sessionId, pendingJobs] of [...pendingJobsBySession.entries()]) {
      for (const [revisionKey, job] of [...pendingJobs.entries()]) {
        if (!predicate(job)) {
          continue;
        }

        this.abortAnalysisJob(job, message);
        pendingJobs.delete(revisionKey);
      }

      if (pendingJobs.size === 0) {
        pendingJobsBySession.delete(sessionId);
      }
    }

    for (let index = queuedJobs.length - 1; index >= 0; index -= 1) {
      const job = queuedJobs[index];
      if (job && predicate(job)) {
        queuedJobs.splice(index, 1);
      }
    }
  }

  private abortAnalysisJob(job: PendingAnalysisJob, message: string): void {
    if (!job.controller.signal.aborted) {
      job.controller.abort(createAbortError(message));
    }
  }

  private syncDisplayCacheUsageUi(): void {
    this.ui.setDisplayCacheUsage(
      getTrackedResidentBytes([...this.entries.values()]),
      displayCacheBudgetMbToBytes(this.budgetMb)
    );
  }

  private ensureResidentChannels(args: {
    session: OpenedImageSession;
    layerIndex: number;
    width: number;
    height: number;
    layer: DecodedLayer;
    channelNames: readonly string[];
    protectedBinding: ProtectedBinding;
  }): {
    residentLayer: ResidentLayerResourceEntry;
    missingChannelNames: string[];
  } {
    const entry = this.getOrCreateEntry(args.session.id);
    let residentLayer = this.getOrCreateResidentLayerEntry(entry, args.layerIndex);
    const channelNames = uniqueStrings(args.channelNames);
    const missingChannelNames = channelNames.filter((channelName) => {
      return !residentLayer.residentChannels.has(channelName);
    });

    if (missingChannelNames.length === 0) {
      this.touchResidentChannels(residentLayer, channelNames);
      return {
        residentLayer,
        missingChannelNames
      };
    }

    this.enforceResidencyBudget({
      reservedBytes: predictRetainedChannelBytes(
        args.width,
        args.height,
        args.layer,
        missingChannelNames
      ),
      protectedBinding: args.protectedBinding
    });
    residentLayer = this.getOrCreateResidentLayerEntry(entry, args.layerIndex);

    const prepareStartedAt = performance.now();
    traceViewerInteraction({
      type: 'displayChannelPrepareStart',
      sessionId: args.session.id,
      missingChannelCount: missingChannelNames.length
    });
    const residentChannelUploads = this.renderer.ensureLayerChannelsResident(
      args.session.id,
      args.layerIndex,
      args.width,
      args.height,
      args.layer,
      missingChannelNames
    );
    traceViewerInteraction({
      type: 'displayChannelPrepareEnd',
      sessionId: args.session.id,
      missingChannelCount: missingChannelNames.length,
      textureBytes: residentChannelUploads.reduce((total, upload) => total + upload.textureBytes, 0),
      materializedBytes: residentChannelUploads.reduce((total, upload) => total + upload.materializedBytes, 0),
      durationMs: performance.now() - prepareStartedAt
    });
    for (const upload of residentChannelUploads) {
      residentLayer.residentChannels.set(upload.channelName, {
        textureBytes: upload.textureBytes,
        materializedBytes: upload.materializedBytes,
        lastAccessToken: this.takeAccessToken()
      });
    }

    this.enforceResidencyBudget({
      protectedBinding: args.protectedBinding
    });
    this.touchResidentChannels(residentLayer, channelNames);

    return {
      residentLayer,
      missingChannelNames
    };
  }

  private resolvePrepareProtectedBinding(
    sessionId: string,
    layerIndex: number,
    layer: DecodedLayer,
    selection: DisplaySelection | null,
    requiredChannelNames: readonly string[]
  ): ProtectedBinding {
    if (this.getActiveSessionId() !== sessionId) {
      return this.createProtectedBinding(sessionId, layerIndex, requiredChannelNames);
    }

    this.setActiveHotSourceContext(sessionId, layerIndex);
    this.addActiveHotSourceNames(resolveSpectralRgbHotSourceNames(layer, selection));
    return this.createProtectedBinding(
      sessionId,
      layerIndex,
      unionStrings(requiredChannelNames, this.activeHotChannelNames)
    );
  }

  private setActiveHotSourceContext(sessionId: string, layerIndex: number): void {
    if (this.activeHotSessionId === sessionId && this.activeHotLayerIndex === layerIndex) {
      return;
    }

    this.activeHotSessionId = sessionId;
    this.activeHotLayerIndex = layerIndex;
    this.activeHotChannelNames.clear();
    this.invalidateSpectralRgbPrewarm();
  }

  private addActiveHotSourceNames(channelNames: Iterable<string>): void {
    for (const channelName of channelNames) {
      this.activeHotChannelNames.add(channelName);
    }
  }

  private clearActiveHotSourceTracking(sessionId?: string): void {
    if (sessionId !== undefined && this.activeHotSessionId !== sessionId) {
      return;
    }

    this.activeHotSessionId = null;
    this.activeHotLayerIndex = null;
    this.activeHotChannelNames.clear();
    this.invalidateSpectralRgbPrewarm();
  }

  private invalidateSpectralRgbPrewarm(): void {
    this.spectralRgbPrewarmToken += 1;
    this.pendingSpectralRgbPrewarmKey = null;
  }

  private scheduleSpectralRgbPrewarm(
    session: OpenedImageSession,
    state: ViewerSessionState,
    layer: DecodedLayer
  ): void {
    if (this.disposed || this.getActiveSessionId() !== session.id) {
      return;
    }

    const sourceName = resolvePrewarmSpectralRgbSourceName(layer, state.displaySelection);
    if (!sourceName) {
      return;
    }

    this.setActiveHotSourceContext(session.id, state.activeLayer);
    this.addActiveHotSourceNames([sourceName]);

    const residentLayer = this.entries.get(session.id)?.residentLayers.get(state.activeLayer) ?? null;
    if (residentLayer?.residentChannels.has(sourceName)) {
      return;
    }

    const prewarmKey = buildPrewarmKey(session.id, state.activeLayer, sourceName);
    if (this.pendingSpectralRgbPrewarmKey === prewarmKey) {
      return;
    }

    const token = this.spectralRgbPrewarmToken + 1;
    this.spectralRgbPrewarmToken = token;
    this.pendingSpectralRgbPrewarmKey = prewarmKey;
    void this.runSpectralRgbPrewarm({
      session,
      layerIndex: state.activeLayer,
      layer,
      sourceName,
      prewarmKey,
      token
    });
  }

  private async runSpectralRgbPrewarm(args: {
    session: OpenedImageSession;
    layerIndex: number;
    layer: DecodedLayer;
    sourceName: string;
    prewarmKey: string;
    token: number;
  }): Promise<void> {
    try {
      await this.waitForIdleSlot(SPECTRAL_RGB_PREWARM_IDLE_TIMEOUT_MS);
      if (!this.isSpectralRgbPrewarmCurrent(args)) {
        return;
      }

      const entry = this.entries.get(args.session.id);
      const residentLayer = entry?.residentLayers.get(args.layerIndex) ?? null;
      if (!entry || residentLayer?.residentChannels.has(args.sourceName)) {
        return;
      }

      const protectedBinding = this.createProtectedBinding(
        args.session.id,
        args.layerIndex,
        this.resolveActiveProtectedChannelNames(args.session.id, args.layerIndex)
      );
      this.ensureResidentChannels({
        session: args.session,
        layerIndex: args.layerIndex,
        width: args.session.decoded.width,
        height: args.session.decoded.height,
        layer: args.layer,
        channelNames: [args.sourceName],
        protectedBinding
      });
      this.syncDisplayCacheUsageUi();
    } catch (error) {
      if (isAbortError(error) || this.disposed) {
        return;
      }
      // Prewarm is opportunistic; a foreground display switch will retry and surface failures.
    } finally {
      if (this.pendingSpectralRgbPrewarmKey === args.prewarmKey) {
        this.pendingSpectralRgbPrewarmKey = null;
      }
    }
  }

  private isSpectralRgbPrewarmCurrent(args: {
    session: OpenedImageSession;
    layerIndex: number;
    sourceName: string;
    prewarmKey: string;
    token: number;
  }): boolean {
    return (
      !this.disposed &&
      this.spectralRgbPrewarmToken === args.token &&
      this.pendingSpectralRgbPrewarmKey === args.prewarmKey &&
      this.getActiveSessionId() === args.session.id &&
      this.activeHotSessionId === args.session.id &&
      this.activeHotLayerIndex === args.layerIndex &&
      this.activeHotChannelNames.has(args.sourceName) &&
      this.entries.has(args.session.id)
    );
  }

  private clearBoundTextureTracking(sessionId: string): void {
    if (this.boundSessionId === sessionId) {
      this.boundSessionId = null;
      this.boundLayerIndex = null;
      this.boundChannelNames.clear();
      this.boundTextureRevisionKey = '';
    }
  }

  private createProtectedBinding(sessionId: string, layerIndex: number, channelNames: Iterable<string>): ProtectedBinding {
    return {
      sessionId,
      layerIndex,
      channelNames: new Set(channelNames)
    };
  }

  private setBoundTextureTracking(protectedBinding: ProtectedBinding, textureRevisionKey: string): void {
    this.boundSessionId = protectedBinding.sessionId;
    this.boundLayerIndex = protectedBinding.layerIndex;
    this.boundChannelNames = new Set(protectedBinding.channelNames);
    this.boundTextureRevisionKey = textureRevisionKey;
  }

  private getOrCreateResidentLayerEntry(entry: SessionResourceEntry, layerIndex: number): ResidentLayerResourceEntry {
    const existing = entry.residentLayers.get(layerIndex);
    if (existing) {
      return existing;
    }

    const layer: ResidentLayerResourceEntry = {
      residentChannels: new Map()
    };
    entry.residentLayers.set(layerIndex, layer);
    return layer;
  }

  private touchResidentChannels(
    layer: ResidentLayerResourceEntry,
    channelNames: string[]
  ): void {
    if (channelNames.length === 0) {
      return;
    }

    for (const channelName of channelNames) {
      const channel = layer.residentChannels.get(channelName);
      if (!channel) {
        continue;
      }

      channel.lastAccessToken = this.takeAccessToken();
    }
  }

  private takeAccessToken(): number {
    const token = this.nextAccessToken;
    this.nextAccessToken += 1;
    return token;
  }

  private enforceResidencyBudget(options: {
    reservedBytes?: number;
    protectedBinding?: ProtectedBinding | null;
  } = {}): void {
    const reservedBytes = Math.max(0, Math.floor(options.reservedBytes ?? 0));
    const budgetBytes = displayCacheBudgetMbToBytes(this.budgetMb);
    let trackedBytes = getTrackedResidentBytes([...this.entries.values()]);
    if (trackedBytes + reservedBytes <= budgetBytes) {
      return;
    }

    const protectedBinding = this.resolveProtectedBinding(options.protectedBinding);
    for (const candidate of this.getEvictionCandidates(protectedBinding)) {
      if (trackedBytes + reservedBytes <= budgetBytes) {
        break;
      }
      trackedBytes -= this.evictResidentChannel(candidate.sessionId, candidate.layerIndex, candidate.channelName);
    }
  }

  private resolveProtectedBinding(protectedBinding: ProtectedBinding | null | undefined): ProtectedBinding | null {
    if (protectedBinding) {
      return protectedBinding;
    }

    const activeSessionId = this.getActiveSessionId();
    if (
      activeSessionId &&
      activeSessionId === this.activeHotSessionId &&
      this.activeHotLayerIndex !== null &&
      this.activeHotChannelNames.size > 0
    ) {
      return this.createProtectedBinding(
        activeSessionId,
        this.activeHotLayerIndex,
        this.resolveActiveProtectedChannelNames(activeSessionId, this.activeHotLayerIndex)
      );
    }

    if (!activeSessionId || activeSessionId !== this.boundSessionId || this.boundLayerIndex === null) {
      return null;
    }

    return this.createProtectedBinding(this.boundSessionId, this.boundLayerIndex, this.boundChannelNames);
  }

  private resolveActiveProtectedChannelNames(sessionId: string, layerIndex: number): string[] {
    const boundChannelNames = this.boundSessionId === sessionId && this.boundLayerIndex === layerIndex
      ? this.boundChannelNames
      : [];
    return unionStrings(boundChannelNames, this.activeHotChannelNames);
  }

  private getEvictionCandidates(
    protectedBinding: ProtectedBinding | null
  ): Array<{ sessionId: string; layerIndex: number; channelName: string; lastAccessToken: number }> {
    const candidates: Array<{ sessionId: string; layerIndex: number; channelName: string; lastAccessToken: number }> = [];

    for (const [sessionId, entry] of this.entries) {
      if (entry.pinned) {
        continue;
      }

      for (const [layerIndex, layer] of entry.residentLayers) {
        for (const [channelName, channel] of layer.residentChannels) {
          if (
            protectedBinding &&
            protectedBinding.sessionId === sessionId &&
            protectedBinding.layerIndex === layerIndex &&
            protectedBinding.channelNames.has(channelName)
          ) {
            continue;
          }

          candidates.push({
            sessionId,
            layerIndex,
            channelName,
            lastAccessToken: channel.lastAccessToken
          });
        }
      }
    }

    candidates.sort((left, right) => {
      if (left.lastAccessToken !== right.lastAccessToken) {
        return left.lastAccessToken - right.lastAccessToken;
      }
      if (left.sessionId !== right.sessionId) {
        return left.sessionId.localeCompare(right.sessionId);
      }
      if (left.layerIndex !== right.layerIndex) {
        return left.layerIndex - right.layerIndex;
      }
      return left.channelName.localeCompare(right.channelName);
    });
    return candidates;
  }

  private evictResidentChannel(sessionId: string, layerIndex: number, channelName: string): number {
    const entry = this.entries.get(sessionId);
    const layer = entry?.residentLayers.get(layerIndex);
    const channel = layer?.residentChannels.get(channelName);
    if (!entry || !layer || !channel) {
      return 0;
    }

    layer.residentChannels.delete(channelName);
    if (layer.residentChannels.size === 0) {
      entry.residentLayers.delete(layerIndex);
    }
    this.renderer.discardChannelSourceTexture(sessionId, layerIndex, channelName);
    return getTrackedResidentChannelBytes(channel);
  }

  private updateDecodedBytes(entry: SessionResourceEntry, session: OpenedImageSession): void {
    entry.decodedBytes = estimateDecodedImageBytes(session.decoded);
  }

  private getOrComputeDisplayLuminanceRange(
    layer: DecodedLayer,
    width: number,
    height: number,
    selection: DisplaySelection | null,
    visualizationMode: ViewerSessionState['visualizationMode'],
    maskInvalidStokesVectors?: boolean
  ): DisplayLuminanceRange | null {
    const selectionKey = serializeDisplaySelectionLuminanceKey(
      selection,
      visualizationMode,
      { maskInvalidStokesVectors }
    );
    if (Object.prototype.hasOwnProperty.call(layer.analysis.displayLuminanceRangeBySelectionKey, selectionKey)) {
      return layer.analysis.displayLuminanceRangeBySelectionKey[selectionKey] ?? null;
    }

    let range: DisplayLuminanceRange | null;
    if (selection?.kind === 'channelMono') {
      if (Object.prototype.hasOwnProperty.call(layer.analysis.finiteRangeByChannel, selection.channel)) {
        range = layer.analysis.finiteRangeByChannel[selection.channel] ?? null;
      } else {
        range = getFiniteChannelRange(layer, selection.channel);
        layer.analysis.finiteRangeByChannel[selection.channel] = range;
      }
    } else {
      range = computeDisplaySelectionLuminanceRange(
        layer,
        width,
        height,
        selection,
        visualizationMode,
        { maskInvalidStokesVectors }
      );
    }

    layer.analysis.displayLuminanceRangeBySelectionKey[selectionKey] = range;
    return range;
  }

  private async getOrComputeDisplayLuminanceRangeAsync(
    layer: DecodedLayer,
    width: number,
    height: number,
    selection: DisplaySelection | null,
    visualizationMode: ViewerSessionState['visualizationMode'],
    maskInvalidStokesVectors: boolean | undefined,
    signal: AbortSignal
  ): Promise<DisplayLuminanceRange | null> {
    throwIfAborted(signal, 'Render cache job was cancelled.');
    const selectionKey = serializeDisplaySelectionLuminanceKey(
      selection,
      visualizationMode,
      { maskInvalidStokesVectors }
    );
    if (Object.prototype.hasOwnProperty.call(layer.analysis.displayLuminanceRangeBySelectionKey, selectionKey)) {
      return layer.analysis.displayLuminanceRangeBySelectionKey[selectionKey] ?? null;
    }

    if (
      selection?.kind === 'channelMono' &&
      Object.prototype.hasOwnProperty.call(layer.analysis.finiteRangeByChannel, selection.channel)
    ) {
      const range = layer.analysis.finiteRangeByChannel[selection.channel] ?? null;
      throwIfAborted(signal, 'Render cache job was cancelled.');
      layer.analysis.displayLuminanceRangeBySelectionKey[selectionKey] = range;
      return range;
    }

    const range = await computeDisplaySelectionLuminanceRangeAsync(
      layer,
      width,
      height,
      selection,
      visualizationMode,
      {
        ...this.createAnalysisComputeOptions(signal),
        maskInvalidStokesVectors
      }
    );

    return range;
  }

  private cacheDisplayLuminanceRange(
    job: PendingDisplayLuminanceRangeJob,
    range: DisplayLuminanceRange | null
  ): void {
    const selectionKey = serializeDisplaySelectionLuminanceKey(
      job.displaySelection,
      job.visualizationMode,
      { maskInvalidStokesVectors: job.maskInvalidStokesVectors }
    );
    if (job.displaySelection?.kind === 'channelMono') {
      job.layer.analysis.finiteRangeByChannel[job.displaySelection.channel] = range;
    }
    job.layer.analysis.displayLuminanceRangeBySelectionKey[selectionKey] = range;
  }

  private waitForNextPaint(signal?: AbortSignal): Promise<void> {
    throwIfAborted(this.abortController.signal, 'Render cache service has been disposed.');
    if (signal) {
      throwIfAborted(signal, 'Render cache job was cancelled.');
    }

    const windowLike = this.windowLike;
    if (!windowLike?.requestAnimationFrame) {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      let firstHandle = 0;
      let secondHandle = 0;
      const cleanupAbort = this.bindAbortRejection(() => {
        if (firstHandle && typeof windowLike.cancelAnimationFrame === 'function') {
          windowLike.cancelAnimationFrame(firstHandle);
        }
        if (secondHandle && typeof windowLike.cancelAnimationFrame === 'function') {
          windowLike.cancelAnimationFrame(secondHandle);
        }
      }, () => {
        resolve();
      }, signal);

      firstHandle = windowLike.requestAnimationFrame?.(() => {
        firstHandle = 0;
        secondHandle = windowLike.requestAnimationFrame?.(() => {
          secondHandle = 0;
          cleanupAbort();
          resolve();
        }) ?? 0;
      }) ?? 0;
    });
  }

  private waitForIdleSlot(timeoutMs: number, signal?: AbortSignal): Promise<void> {
    throwIfAborted(this.abortController.signal, 'Render cache service has been disposed.');
    if (signal) {
      throwIfAborted(signal, 'Render cache job was cancelled.');
    }

    const windowLike = this.windowLike;
    if (!windowLike) {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      if (typeof windowLike.requestIdleCallback !== 'function') {
        const handle = windowLike.setTimeout(
          () => {
            cleanupAbort();
            resolve();
          },
          Math.max(0, Math.min(timeoutMs, DISPLAY_LUMINANCE_RANGE_IDLE_FALLBACK_DELAY_MS))
        );
        const cleanupAbort = this.bindAbortRejection(() => {
          windowLike.clearTimeout?.(handle);
        }, () => {
          resolve();
        }, signal);
        return;
      }

      const handle = windowLike.requestIdleCallback(() => {
        cleanupAbort();
        resolve();
      }, { timeout: timeoutMs });
      const cleanupAbort = this.bindAbortRejection(() => {
        windowLike.cancelIdleCallback?.(handle);
      }, () => {
        resolve();
      }, signal);
    });
  }

  private bindAbortRejection(cancel: () => void, complete: () => void, jobSignal?: AbortSignal): () => void {
    const signals = jobSignal ? [this.abortController.signal, jobSignal] : [this.abortController.signal];
    let cleaned = false;
    const cleanup = () => {
      if (cleaned) {
        return;
      }

      cleaned = true;
      for (const signal of signals) {
        signal.removeEventListener('abort', onAbort);
      }
    };
    const onAbort = () => {
      if (cleaned) {
        return;
      }

      cancel();
      complete();
      cleanup();
    };

    for (const signal of signals) {
      signal.addEventListener('abort', onAbort, { once: true });
    }
    return cleanup;
  }
}

function predictChannelTextureBytes(width: number, height: number): number {
  return Math.max(0, width * height * Float32Array.BYTES_PER_ELEMENT);
}

function predictRetainedChannelBytes(
  width: number,
  height: number,
  layer: DecodedLayer,
  channelNames: readonly string[]
): number {
  const perChannelTextureBytes = predictChannelTextureBytes(width, height);
  const perChannelMaterializedBytes = layer.channelStorage.kind === 'interleaved-f32'
    ? predictChannelTextureBytes(width, height)
    : 0;
  return channelNames.reduce((total, channelName) => {
    if (isDerivedDisplaySourceName(channelName)) {
      return total + perChannelTextureBytes * 4;
    }

    return total + perChannelTextureBytes + perChannelMaterializedBytes;
  }, 0);
}

function isDerivedDisplaySourceName(channelName: string): boolean {
  return isSpectralRgbSourceName(channelName) || isSpectralStokesRgbSourceName(channelName);
}

function resolveSpectralRgbHotSourceNames(
  layer: DecodedLayer,
  selection: DisplaySelection | null
): string[] {
  if (selection?.kind === 'spectralRgb') {
    return [buildSpectralRgbSourceName(selection.seriesKey)];
  }

  if (selection?.kind !== 'channelMono') {
    return [];
  }

  const seriesKey = findSpectralRgbSeriesKeyForChannel(layer.channelNames, selection.channel);
  return seriesKey === null ? [] : [selection.channel, buildSpectralRgbSourceName(seriesKey)];
}

function resolvePrewarmSpectralRgbSourceName(
  layer: DecodedLayer,
  selection: DisplaySelection | null
): string | null {
  const hotSourceNames = resolveSpectralRgbHotSourceNames(layer, selection);
  const pairedSourceName = hotSourceNames.find(isSpectralRgbSourceName) ?? null;
  if (pairedSourceName) {
    return pairedSourceName;
  }

  const defaultSelection = pickDefaultSpectralRgbSelection(layer.channelNames);
  return defaultSelection ? buildSpectralRgbSourceName(defaultSelection.seriesKey) : null;
}

function buildPrewarmKey(sessionId: string, layerIndex: number, sourceName: string): string {
  return `${sessionId}:${layerIndex}:${sourceName}`;
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function unionStrings(...groups: Iterable<string>[]): string[] {
  const values = new Set<string>();
  for (const group of groups) {
    for (const value of group) {
      values.add(value);
    }
  }
  return [...values];
}

function resolveWindowLike(): RenderCacheWindowLike | null {
  if (typeof window === 'undefined') {
    return null;
  }

  return window;
}

function normalizeAnalysisChunkSize(value: number | undefined): number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
    ? value
    : DEFAULT_ANALYSIS_COMPUTE_CHUNK_SIZE;
}

function buildSessionResourceKey(sessionId: string, revisionKey: string): string {
  return `${sessionId}:${revisionKey}`;
}
