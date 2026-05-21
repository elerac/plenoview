import { computeFitView } from '../interaction/image-geometry';
import { DEFAULT_DISPLAY_GAMMA } from '../color';
import { DEFAULT_PANORAMA_HFOV_DEG } from '../interaction/panorama-geometry';
import { cloneDisplayLuminanceRange } from '../colormap-range';
import {
  cloneDisplaySelection,
  sameDisplaySelection,
  type DisplaySelection
} from '../display-model';
import { clampImageRoiToBounds } from '../roi';
import {
  buildSessionDisplayName,
  cloneViewerSessionState
} from '../session-state';
import {
  DEFAULT_STOKES_AOLP_DEGREE_MODULATION_MODE,
  createDefaultStokesDegreeModulation,
  type StokesParameterVisibilitySettings
} from '../stokes';
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
}

export interface BuildSwitchedSessionStateOptions {
  autoFitViewport?: ViewportInfo | null;
  autoFitInsets?: ViewportInsets | null;
  stokesParameterVisibility?: StokesParameterVisibilitySettings;
  spectralRgbGroupingEnabled?: boolean;
}

export function buildLoadedSession(args: BuildLoadedSessionArgs): OpenedImageSession {
  const fitView = computeFitView(args.viewport, args.decoded.width, args.decoded.height, args.fitInsets);
  const displayName = buildSessionDisplayName(
    args.filename,
    args.existingSessions.map((session) => session.filename)
  );
  const defaultSessionState = buildViewerStateForLayer(
    {
      ...createClearedViewerState(args.defaultColormapId),
      zoom: fitView.zoom,
      panX: fitView.panX,
      panY: fitView.panY
    },
    args.decoded,
    0,
    {
      stokesParameterVisibility: args.stokesParameterVisibility,
      spectralRgbGroupingEnabled: args.spectralRgbGroupingEnabled
    }
  );
  const baseSession: OpenedImageSession = {
    id: args.sessionId,
    filename: args.filename,
    displayName: args.displayName ?? displayName,
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
        spectralRgbGroupingEnabled: args.spectralRgbGroupingEnabled
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
  spectralRgbGroupingEnabled?: boolean
): OpenedImageSession {
  return {
    ...session,
    decoded,
    state: buildReloadedSessionState(
      baseState,
      session.decoded,
      decoded,
      stokesParameterVisibility,
      spectralRgbGroupingEnabled
    )
  };
}

export function createClearedViewerState(defaultColormapId: string): ViewerSessionState {
  return {
    exposureEv: 0,
    channelThumbnailExposureEv: 0,
    displayGamma: DEFAULT_DISPLAY_GAMMA,
    channelThumbnailDisplayGamma: DEFAULT_DISPLAY_GAMMA,
    viewerMode: 'image',
    visualizationMode: 'rgb',
    activeColormapId: defaultColormapId,
    colormapRange: null,
    colormapRangeMode: 'alwaysAuto',
    colormapZeroCentered: false,
    stokesDegreeModulation: createDefaultStokesDegreeModulation(),
    stokesAolpDegreeModulationMode: DEFAULT_STOKES_AOLP_DEGREE_MODULATION_MODE,
    zoom: 1,
    panX: 0,
    panY: 0,
    panoramaYawDeg: 0,
    panoramaPitchDeg: 0,
    panoramaHfovDeg: DEFAULT_PANORAMA_HFOV_DEG,
    activeLayer: 0,
    displaySelection: null,
    lockedPixel: null,
    roi: null
  };
}

export function buildReloadedSessionState(
  currentState: ViewerSessionState,
  previousImage: DecodedExrImage,
  decoded: DecodedExrImage,
  stokesParameterVisibility?: StokesParameterVisibilitySettings,
  spectralRgbGroupingEnabled?: boolean
): ViewerSessionState {
  const lockedPixel = currentState.lockedPixel
    ? clampPixelToImageBounds(currentState.lockedPixel, decoded.width, decoded.height)
    : null;
  const roi = currentState.roi
    ? clampImageRoiToBounds(currentState.roi, decoded.width, decoded.height)
    : null;
  const nextImageCamera = currentState.viewerMode === 'image'
    ? {
        zoom: currentState.zoom,
        ...remapPanToImageCenterAnchor(
          currentState.panX,
          currentState.panY,
          previousImage,
          decoded
        )
      }
    : {
        zoom: currentState.zoom,
        panX: currentState.panX,
        panY: currentState.panY
      };

  return buildViewerStateForLayer(
    {
      ...currentState,
      ...nextImageCamera,
      lockedPixel,
      roi
    },
    decoded,
    currentState.activeLayer,
    { stokesParameterVisibility, spectralRgbGroupingEnabled }
  );
}

export function buildSwitchedSessionState(
  nextSession: OpenedImageSession,
  currentState: ViewerSessionState,
  previousImage: DecodedExrImage | null,
  options: BuildSwitchedSessionStateOptions = {}
): ViewerSessionState {
  const lockedPixel = currentState.lockedPixel
    ? clampPixelToImageBounds(currentState.lockedPixel, nextSession.decoded.width, nextSession.decoded.height)
    : null;
  const roi = currentState.roi
    ? clampImageRoiToBounds(currentState.roi, nextSession.decoded.width, nextSession.decoded.height)
    : null;
  const nextImageCamera = buildSwitchedImageCamera(nextSession, currentState, previousImage, options);
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

  const nextState = buildViewerStateForLayer(
    {
      ...cloneViewerSessionState(nextSession.state),
      viewerMode: currentState.viewerMode,
      ...nextImageCamera,
      ...nextPanoramaCamera,
      exposureEv: currentState.exposureEv,
      channelThumbnailExposureEv: currentState.channelThumbnailExposureEv,
      displayGamma: currentState.displayGamma,
      channelThumbnailDisplayGamma: currentState.channelThumbnailDisplayGamma,
      displaySelection: cloneDisplaySelection(currentState.displaySelection),
      stokesDegreeModulation: { ...currentState.stokesDegreeModulation },
      stokesAolpDegreeModulationMode: currentState.stokesAolpDegreeModulationMode,
      lockedPixel,
      roi
    },
    nextSession.decoded,
    nextSession.state.activeLayer,
    {
      stokesParameterVisibility: options.stokesParameterVisibility,
      spectralRgbGroupingEnabled: options.spectralRgbGroupingEnabled
    }
  );

  if (!shouldCarryColormapState(currentState.displaySelection, nextState.displaySelection)) {
    return nextState;
  }

  return {
    ...nextState,
    visualizationMode: currentState.visualizationMode,
    activeColormapId: currentState.activeColormapId,
    colormapRange: cloneDisplayLuminanceRange(currentState.colormapRange),
    colormapRangeMode: currentState.colormapRangeMode,
    colormapZeroCentered: currentState.colormapZeroCentered
  };
}

function buildSwitchedImageCamera(
  nextSession: OpenedImageSession,
  currentState: ViewerSessionState,
  previousImage: DecodedExrImage | null,
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
    return computeFitView(
      options.autoFitViewport,
      nextSession.decoded.width,
      nextSession.decoded.height,
      options.autoFitInsets
    );
  }

  return {
    zoom: currentState.zoom,
    ...remapPanToImageCenterAnchor(
      currentState.panX,
      currentState.panY,
      previousImage,
      nextSession.decoded
    )
  };
}

export function buildResetSessionState(
  activeSession: OpenedImageSession | null,
  currentState: ViewerSessionState,
  defaultColormapId: string,
  viewport: ViewportInfo,
  fitInsets?: ViewportInsets,
  options: Pick<BuildSwitchedSessionStateOptions, 'stokesParameterVisibility' | 'spectralRgbGroupingEnabled'> = {}
): ViewerSessionState {
  if (!activeSession) {
    return createClearedViewerState(defaultColormapId);
  }

  const fitView = computeFitView(viewport, activeSession.decoded.width, activeSession.decoded.height, fitInsets);
  return buildViewerStateForLayer(
    {
      ...createClearedViewerState(defaultColormapId),
      viewerMode: currentState.viewerMode,
      zoom: fitView.zoom,
      panX: fitView.panX,
      panY: fitView.panY
    },
    activeSession.decoded,
    0,
    {
      stokesParameterVisibility: options.stokesParameterVisibility,
      spectralRgbGroupingEnabled: options.spectralRgbGroupingEnabled
    }
  );
}

function remapPanToImageCenterAnchor(
  panX: number,
  panY: number,
  previousImage: DecodedExrImage | null,
  nextImage: DecodedExrImage
): { panX: number; panY: number } {
  if (!previousImage) {
    return { panX, panY };
  }

  const previousCenterX = previousImage.width * 0.5;
  const previousCenterY = previousImage.height * 0.5;
  const nextCenterX = nextImage.width * 0.5;
  const nextCenterY = nextImage.height * 0.5;

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
    return next.kind === 'channelRgb' && previous.r === next.r && previous.g === next.g && previous.b === next.b;
  }

  return sameDisplaySelection(previous, next);
}
