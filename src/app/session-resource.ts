import { computeFitView } from '../interaction/image-geometry';
import { DEFAULT_DISPLAY_GAMMA } from '../color';
import {
  DEFAULT_DEPTH_POINT_SIZE_PX,
  DEFAULT_DEPTH_ZOOM,
  resolveDepthChannelForLayer
} from '../depth';
import { DEFAULT_PANORAMA_HFOV_DEG } from '../interaction/panorama-geometry';
import { cloneDisplayLuminanceRange } from '../colormap-range';
import {
  cloneDisplaySelection,
  sameDisplaySelection,
  type DisplaySelection
} from '../display-model';
import { resolveDisplayImageSize } from '../display-size';
import { clampImageRoiToBounds } from '../roi';
import {
  buildSessionDisplayName,
  cloneViewerSessionState,
  normalizeSessionDisplayName
} from '../session-state';
import {
  DEFAULT_STOKES_AOLP_DEGREE_MODULATION_MODE,
  createDefaultStokesDegreeModulation,
  type StokesParameterVisibilitySettings
} from '../stokes';
import type { ChannelRecognitionSettings } from '../channel-recognition-settings';
import type { ChannelRecognitionNameRules } from '../channel-recognition-name-rules';
import type {
  DecodedExrImage,
  ImagePixel,
  OpenedImageSession,
  SessionSource,
  ViewportInsets,
  ViewerSessionState,
  ViewportInfo
} from '../types';
import { buildViewerStateForLayer } from '../viewer-store';

export interface BuildLoadedSessionArgs {
  sessionId: string;
  decoded: DecodedExrImage;
  filename: string;
  displayName?: string;
  fileSizeBytes: number | null;
  source: SessionSource;
  existingSessions: OpenedImageSession[];
  defaultColormapId: string;
  viewport: ViewportInfo;
  fitInsets?: ViewportInsets;
  currentSessionState: ViewerSessionState;
  hasActiveSession: boolean;
  previousImage: DecodedExrImage | null;
  autoFitImageOnSelect: boolean;
  stokesParameterVisibility?: StokesParameterVisibilitySettings;
  spectralRgbGroupingEnabled?: boolean;
  channelRecognitionSettings?: ChannelRecognitionSettings;
  channelRecognitionNameRules?: ChannelRecognitionNameRules;
}

export interface BuildSwitchedSessionStateOptions {
  autoFitViewport?: ViewportInfo | null;
  autoFitInsets?: ViewportInsets | null;
  stokesParameterVisibility?: StokesParameterVisibilitySettings;
  spectralRgbGroupingEnabled?: boolean;
  channelRecognitionSettings?: ChannelRecognitionSettings;
  channelRecognitionNameRules?: ChannelRecognitionNameRules;
}

export function buildLoadedSession(args: BuildLoadedSessionArgs): OpenedImageSession {
  const generatedDisplayName = buildSessionDisplayName(
    args.filename,
    args.existingSessions.map((session) => session.filename)
  );
  const customDisplayName = normalizeSessionDisplayName(args.displayName);
  const defaultBaseState = buildViewerStateForLayer(
    createClearedViewerState(args.defaultColormapId),
    args.decoded,
    0,
    {
      stokesParameterVisibility: args.stokesParameterVisibility,
      spectralRgbGroupingEnabled: args.spectralRgbGroupingEnabled,
      channelRecognitionSettings: args.channelRecognitionSettings,
      channelRecognitionNameRules: args.channelRecognitionNameRules
    }
  );
  const defaultDisplaySize = resolveDisplayImageSize(
    args.decoded.width,
    args.decoded.height,
    defaultBaseState.displaySelection
  );
  const fitView = computeFitView(args.viewport, defaultDisplaySize.width, defaultDisplaySize.height, args.fitInsets);
  const defaultSessionState = {
    ...defaultBaseState,
    zoom: fitView.zoom,
    panX: fitView.panX,
    panY: fitView.panY
  };
  const baseSession: OpenedImageSession = {
    id: args.sessionId,
    filename: args.filename,
    displayName: customDisplayName ?? generatedDisplayName,
    ...(customDisplayName ? { displayNameIsCustom: true } : {}),
    fileSizeBytes: args.fileSizeBytes,
    source: args.source,
    decoded: args.decoded,
    state: defaultSessionState
  };
  const sessionState = args.hasActiveSession
    ? buildSwitchedSessionState(baseSession, args.currentSessionState, args.previousImage, {
        autoFitViewport: args.autoFitImageOnSelect ? args.viewport : null,
        autoFitInsets: args.autoFitImageOnSelect ? args.fitInsets ?? null : null,
        stokesParameterVisibility: args.stokesParameterVisibility,
        spectralRgbGroupingEnabled: args.spectralRgbGroupingEnabled,
        channelRecognitionSettings: args.channelRecognitionSettings,
        channelRecognitionNameRules: args.channelRecognitionNameRules
      })
    : defaultSessionState;

  return {
    ...baseSession,
    state: sessionState
  };
}

export function buildReloadedSession(
  session: OpenedImageSession,
  decoded: DecodedExrImage,
  baseState: ViewerSessionState,
  stokesParameterVisibility?: StokesParameterVisibilitySettings,
  spectralRgbGroupingEnabled?: boolean,
  channelRecognitionSettings?: ChannelRecognitionSettings,
  channelRecognitionNameRules?: ChannelRecognitionNameRules
): OpenedImageSession {
  return {
    ...session,
    decoded,
    state: buildReloadedSessionState(
      baseState,
      session.decoded,
      decoded,
      stokesParameterVisibility,
      spectralRgbGroupingEnabled,
      channelRecognitionSettings,
      channelRecognitionNameRules
    )
  };
}

export function createClearedViewerState(_defaultColormapId: string): ViewerSessionState {
  return {
    exposureEv: 0,
    channelThumbnailExposureEv: 0,
    displayGamma: DEFAULT_DISPLAY_GAMMA,
    channelThumbnailDisplayGamma: DEFAULT_DISPLAY_GAMMA,
    viewerMode: 'image',
    visualizationMode: 'rgb',
    activeColormapId: null,
    colormapExposureEv: 0,
    colormapGamma: 1,
    colormapRange: null,
    colormapRangeMode: 'alwaysAuto',
    colormapZeroCentered: false,
    colormapReversed: false,
    stokesDegreeModulation: createDefaultStokesDegreeModulation(),
    stokesAolpDegreeModulationMode: DEFAULT_STOKES_AOLP_DEGREE_MODULATION_MODE,
    zoom: 1,
    panX: 0,
    panY: 0,
    panoramaYawDeg: 0,
    panoramaPitchDeg: 0,
    panoramaHfovDeg: DEFAULT_PANORAMA_HFOV_DEG,
    depthYawDeg: 0,
    depthPitchDeg: 0,
    depthZoom: DEFAULT_DEPTH_ZOOM,
    activeLayer: 0,
    displaySelection: null,
    depthChannel: null,
    depthFocalLengthPx: null,
    depthPointSizePx: DEFAULT_DEPTH_POINT_SIZE_PX,
    lockedPixel: null,
    roi: null
  };
}

export function buildReloadedSessionState(
  currentState: ViewerSessionState,
  previousImage: DecodedExrImage,
  decoded: DecodedExrImage,
  stokesParameterVisibility?: StokesParameterVisibilitySettings,
  spectralRgbGroupingEnabled?: boolean,
  channelRecognitionSettings?: ChannelRecognitionSettings,
  channelRecognitionNameRules?: ChannelRecognitionNameRules
): ViewerSessionState {
  const resolvedState = buildViewerStateForLayer(
    currentState,
    decoded,
    currentState.activeLayer,
    { stokesParameterVisibility, spectralRgbGroupingEnabled, channelRecognitionSettings, channelRecognitionNameRules }
  );
  const displaySize = resolveDisplayImageSize(decoded.width, decoded.height, resolvedState.displaySelection);
  const lockedPixel = currentState.lockedPixel
    ? clampPixelToImageBounds(currentState.lockedPixel, displaySize.width, displaySize.height)
    : null;
  const roi = currentState.roi
    ? clampImageRoiToBounds(currentState.roi, displaySize.width, displaySize.height)
    : null;
  const nextImageCamera = currentState.viewerMode === 'image'
    ? {
        zoom: currentState.zoom,
        ...remapPanToImageCenterAnchor(
          currentState.panX,
          currentState.panY,
          previousImage,
          decoded,
          currentState.displaySelection,
          resolvedState.displaySelection
        )
      }
    : {
        zoom: currentState.zoom,
        panX: currentState.panX,
        panY: currentState.panY
      };

  const nextState = buildViewerStateForLayer(
    {
      ...currentState,
      ...nextImageCamera,
      displaySelection: cloneDisplaySelection(resolvedState.displaySelection),
      lockedPixel,
      roi
    },
    decoded,
    currentState.activeLayer,
    { stokesParameterVisibility, spectralRgbGroupingEnabled, channelRecognitionSettings, channelRecognitionNameRules }
  );
  if (currentState.viewerMode === 'depth') {
    const nextLayer = decoded.layers[nextState.activeLayer] ?? null;
    nextState.depthChannel = nextLayer
      ? resolveDepthChannelForLayer(
          nextLayer.channelNames,
          currentState.depthChannel,
          {
            allowArbitraryZSuffix: true,
            channelRecognitionSettings,
            channelRecognitionNameRules
          }
        )
      : null;
    if (!nextState.depthChannel) {
      nextState.viewerMode = 'image';
    }
  }

  return nextState;
}

export function buildSwitchedSessionState(
  nextSession: OpenedImageSession,
  currentState: ViewerSessionState,
  previousImage: DecodedExrImage | null,
  options: BuildSwitchedSessionStateOptions = {}
): ViewerSessionState {
  const resolvedState = buildViewerStateForLayer(
    {
      ...cloneViewerSessionState(nextSession.state),
      displaySelection: cloneDisplaySelection(currentState.displaySelection)
    },
    nextSession.decoded,
    nextSession.state.activeLayer,
    {
      stokesParameterVisibility: options.stokesParameterVisibility,
      spectralRgbGroupingEnabled: options.spectralRgbGroupingEnabled,
      channelRecognitionSettings: options.channelRecognitionSettings,
      channelRecognitionNameRules: options.channelRecognitionNameRules
    }
  );
  const displaySize = resolveDisplayImageSize(
    nextSession.decoded.width,
    nextSession.decoded.height,
    resolvedState.displaySelection
  );
  const lockedPixel = currentState.lockedPixel
    ? clampPixelToImageBounds(currentState.lockedPixel, displaySize.width, displaySize.height)
    : null;
  const roi = currentState.roi
    ? clampImageRoiToBounds(currentState.roi, displaySize.width, displaySize.height)
    : null;
  const nextImageCamera = buildSwitchedImageCamera(
    nextSession,
    currentState,
    previousImage,
    resolvedState.displaySelection,
    options
  );
  const nextPanoramaCamera = currentState.viewerMode === 'panorama'
    ? {
        panoramaYawDeg: currentState.panoramaYawDeg,
        panoramaPitchDeg: currentState.panoramaPitchDeg,
        panoramaHfovDeg: currentState.panoramaHfovDeg
      }
    : {
        panoramaYawDeg: nextSession.state.panoramaYawDeg,
        panoramaPitchDeg: nextSession.state.panoramaPitchDeg,
        panoramaHfovDeg: nextSession.state.panoramaHfovDeg
      };
  const nextDepthCamera = currentState.viewerMode === 'depth'
    ? {
        depthYawDeg: currentState.depthYawDeg,
        depthPitchDeg: currentState.depthPitchDeg,
        depthZoom: currentState.depthZoom
      }
    : {
        depthYawDeg: nextSession.state.depthYawDeg,
        depthPitchDeg: nextSession.state.depthPitchDeg,
        depthZoom: nextSession.state.depthZoom
      };

  const nextState = buildViewerStateForLayer(
    {
      ...cloneViewerSessionState(nextSession.state),
      viewerMode: currentState.viewerMode,
      ...nextImageCamera,
      ...nextPanoramaCamera,
      ...nextDepthCamera,
      exposureEv: currentState.exposureEv,
      channelThumbnailExposureEv: currentState.channelThumbnailExposureEv,
      displayGamma: currentState.displayGamma,
      channelThumbnailDisplayGamma: currentState.channelThumbnailDisplayGamma,
      displaySelection: cloneDisplaySelection(resolvedState.displaySelection),
      depthChannel: currentState.depthChannel,
      depthFocalLengthPx: currentState.depthFocalLengthPx,
      depthPointSizePx: currentState.depthPointSizePx,
      stokesDegreeModulation: { ...currentState.stokesDegreeModulation },
      stokesAolpDegreeModulationMode: currentState.stokesAolpDegreeModulationMode,
      lockedPixel,
      roi
    },
    nextSession.decoded,
    resolvedState.activeLayer,
    {
      stokesParameterVisibility: options.stokesParameterVisibility,
      spectralRgbGroupingEnabled: options.spectralRgbGroupingEnabled,
      channelRecognitionSettings: options.channelRecognitionSettings,
      channelRecognitionNameRules: options.channelRecognitionNameRules
    }
  );
  if (currentState.viewerMode === 'depth') {
    const nextLayer = nextSession.decoded.layers[nextState.activeLayer] ?? null;
    nextState.depthChannel = nextLayer
      ? resolveDepthChannelForLayer(
          nextLayer.channelNames,
          currentState.depthChannel,
          {
            allowArbitraryZSuffix: true,
            channelRecognitionSettings: options.channelRecognitionSettings,
            channelRecognitionNameRules: options.channelRecognitionNameRules
          }
        )
      : null;
    if (!nextState.depthChannel) {
      nextState.viewerMode = 'image';
    }
  }

  if (!shouldCarryColormapState(currentState.displaySelection, nextState.displaySelection)) {
    return nextState;
  }

  return {
    ...nextState,
    visualizationMode: currentState.visualizationMode,
    activeColormapId: currentState.activeColormapId,
    colormapExposureEv: currentState.colormapExposureEv,
    colormapGamma: currentState.colormapGamma,
    colormapRange: cloneDisplayLuminanceRange(currentState.colormapRange),
    colormapRangeMode: currentState.colormapRangeMode,
    colormapZeroCentered: currentState.colormapZeroCentered,
    colormapReversed: currentState.colormapReversed
  };
}

function buildSwitchedImageCamera(
  nextSession: OpenedImageSession,
  currentState: ViewerSessionState,
  previousImage: DecodedExrImage | null,
  nextDisplaySelection: DisplaySelection | null,
  options: BuildSwitchedSessionStateOptions
): Pick<ViewerSessionState, 'zoom' | 'panX' | 'panY'> {
  if (currentState.viewerMode !== 'image') {
    return {
      zoom: nextSession.state.zoom,
      panX: nextSession.state.panX,
      panY: nextSession.state.panY
    };
  }

  if (options.autoFitViewport) {
    const displaySize = resolveDisplayImageSize(
      nextSession.decoded.width,
      nextSession.decoded.height,
      nextDisplaySelection
    );
    return computeFitView(
      options.autoFitViewport,
      displaySize.width,
      displaySize.height,
      options.autoFitInsets
    );
  }

  return {
    zoom: currentState.zoom,
    ...remapPanToImageCenterAnchor(
      currentState.panX,
      currentState.panY,
      previousImage,
      nextSession.decoded,
      currentState.displaySelection,
      nextDisplaySelection
    )
  };
}

export function buildResetSessionState(
  activeSession: OpenedImageSession | null,
  currentState: ViewerSessionState,
  defaultColormapId: string,
  viewport: ViewportInfo,
  fitInsets?: ViewportInsets,
  options: Pick<BuildSwitchedSessionStateOptions, 'stokesParameterVisibility' | 'spectralRgbGroupingEnabled' | 'channelRecognitionSettings' | 'channelRecognitionNameRules'> = {}
): ViewerSessionState {
  const resetBaseState = buildResetSessionBaseState(
    activeSession,
    currentState,
    defaultColormapId,
    options
  );
  if (!activeSession) {
    return resetBaseState;
  }

  const displaySize = resolveDisplayImageSize(
    activeSession.decoded.width,
    activeSession.decoded.height,
    resetBaseState.displaySelection
  );
  const fitView = computeFitView(viewport, displaySize.width, displaySize.height, fitInsets);
  return {
    ...resetBaseState,
    zoom: fitView.zoom,
    panX: fitView.panX,
    panY: fitView.panY
  };
}

export function buildResetSessionBaseState(
  activeSession: OpenedImageSession | null,
  currentState: ViewerSessionState,
  defaultColormapId: string,
  options: Pick<BuildSwitchedSessionStateOptions, 'stokesParameterVisibility' | 'spectralRgbGroupingEnabled' | 'channelRecognitionSettings' | 'channelRecognitionNameRules'> = {}
): ViewerSessionState {
  if (!activeSession) {
    return createClearedViewerState(defaultColormapId);
  }

  const resetBaseState = buildViewerStateForLayer(
    {
      ...createClearedViewerState(defaultColormapId),
      viewerMode: currentState.viewerMode
    },
    activeSession.decoded,
    0,
    {
      stokesParameterVisibility: options.stokesParameterVisibility,
      spectralRgbGroupingEnabled: options.spectralRgbGroupingEnabled,
      channelRecognitionSettings: options.channelRecognitionSettings,
      channelRecognitionNameRules: options.channelRecognitionNameRules
    }
  );
  return resetBaseState;
}

function remapPanToImageCenterAnchor(
  panX: number,
  panY: number,
  previousImage: DecodedExrImage | null,
  nextImage: DecodedExrImage,
  previousSelection: DisplaySelection | null,
  nextSelection: DisplaySelection | null
): { panX: number; panY: number } {
  if (!previousImage) {
    return { panX, panY };
  }

  const previousSize = resolveDisplayImageSize(previousImage.width, previousImage.height, previousSelection);
  const nextSize = resolveDisplayImageSize(nextImage.width, nextImage.height, nextSelection);
  const previousCenterX = previousSize.width * 0.5;
  const previousCenterY = previousSize.height * 0.5;
  const nextCenterX = nextSize.width * 0.5;
  const nextCenterY = nextSize.height * 0.5;

  return {
    panX: nextCenterX + (panX - previousCenterX),
    panY: nextCenterY + (panY - previousCenterY)
  };
}

function clampPixelToImageBounds(pixel: ImagePixel, width: number, height: number): ImagePixel | null {
  if (pixel.ix < 0 || pixel.iy < 0 || pixel.ix >= width || pixel.iy >= height) {
    return null;
  }

  return {
    ix: pixel.ix,
    iy: pixel.iy
  };
}

function shouldCarryColormapState(previous: DisplaySelection | null, next: DisplaySelection | null): boolean {
  if (!previous || !next || previous.kind !== next.kind) {
    return false;
  }

  if (previous.kind === 'channelMono') {
    return next.kind === 'channelMono' && previous.channel === next.channel;
  }

  if (previous.kind === 'channelRgb') {
    return next.kind === 'channelRgb' &&
      previous.r === next.r &&
      previous.g === next.g &&
      previous.b === next.b &&
      (previous.colorMapping ?? null) === (next.colorMapping ?? null);
  }

  return sameDisplaySelection(previous, next);
}
