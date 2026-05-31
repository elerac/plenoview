import { DEFAULT_DISPLAY_GAMMA } from './color';
import {
  clampDepthPitch,
  clampDepthYaw,
  clampDepthZoom,
  DEFAULT_DEPTH_POINT_SIZE_PX,
  DEFAULT_DEPTH_ZOOM,
  resolveDepthChannelForLayer
} from './depth';
import { DEFAULT_PANORAMA_HFOV_DEG } from './interaction/panorama-geometry';
import { resolveDisplaySelectionForLayer, type DisplaySelectionAvailabilityConfig } from './display-selection';
import {
  DEFAULT_STOKES_AOLP_DEGREE_MODULATION_MODE,
  createDefaultStokesDegreeModulation
} from './stokes';
import {
  DecodedExrImage,
  ViewerSessionState
} from './types';

const SESSION_STATE_KEYS = [
  'exposureEv',
  'channelThumbnailExposureEv',
  'displayGamma',
  'channelThumbnailDisplayGamma',
  'viewerMode',
  'visualizationMode',
  'activeColormapId',
  'colormapExposureEv',
  'colormapGamma',
  'colormapRange',
  'colormapRangeMode',
  'colormapZeroCentered',
  'colormapReversed',
  'stokesDegreeModulation',
  'stokesAolpDegreeModulationMode',
  'zoom',
  'panX',
  'panY',
  'panoramaYawDeg',
  'panoramaPitchDeg',
  'panoramaHfovDeg',
  'depthYawDeg',
  'depthPitchDeg',
  'depthZoom',
  'activeLayer',
  'displaySelection',
  'depthChannel',
  'depthFocalLengthPx',
  'depthPointSizePx',
  'lockedPixel',
  'roi'
] as const satisfies ReadonlyArray<keyof ViewerSessionState>;

export function createInitialState(): ViewerSessionState {
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

export class ViewerStore {
  private state: ViewerSessionState;
  private listeners = new Set<(state: ViewerSessionState, previous: ViewerSessionState) => void>();

  constructor(initialState: ViewerSessionState) {
    this.state = initialState;
  }

  getState(): ViewerSessionState {
    return this.state;
  }

  setState(patch: Partial<ViewerSessionState>): void {
    const normalizedPatch = pickSessionStatePatch(patch);
    if (!hasStateChanges(this.state, normalizedPatch)) {
      return;
    }

    const previous = this.state;
    this.state = { ...this.state, ...normalizedPatch };
    for (const listener of this.listeners) {
      listener(this.state, previous);
    }
  }

  subscribe(listener: (state: ViewerSessionState, previous: ViewerSessionState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

export function pickValidLayerIndex(layerCount: number, requestedIndex: number): number {
  if (layerCount <= 0) {
    return 0;
  }

  const resolvedIndex = Number.isFinite(requestedIndex) ? Math.floor(requestedIndex) : 0;
  return Math.min(layerCount - 1, Math.max(0, resolvedIndex));
}

export function buildViewerStateForLayer(
  currentState: ViewerSessionState,
  decoded: DecodedExrImage,
  requestedLayerIndex: number = currentState.activeLayer,
  config: DisplaySelectionAvailabilityConfig = {}
): ViewerSessionState {
  const activeLayer = pickValidLayerIndex(decoded.layers.length, requestedLayerIndex);
  const layer = decoded.layers[activeLayer];
  if (!layer) {
    return {
      ...currentState,
      activeLayer: 0,
      displaySelection: null,
      depthYawDeg: clampDepthYaw(currentState.depthYawDeg),
      depthPitchDeg: clampDepthPitch(currentState.depthPitchDeg),
      depthZoom: clampDepthZoom(currentState.depthZoom),
      depthChannel: null
    };
  }

  return {
    ...currentState,
    activeLayer,
    displaySelection: resolveDisplaySelectionForLayer(layer.channelNames, currentState.displaySelection, config),
    depthYawDeg: clampDepthYaw(currentState.depthYawDeg),
    depthPitchDeg: clampDepthPitch(currentState.depthPitchDeg),
    depthZoom: clampDepthZoom(currentState.depthZoom),
    depthChannel: resolveDepthChannelForLayer(layer.channelNames, currentState.depthChannel, {
      channelRecognitionSettings: config.channelRecognitionSettings,
      channelRecognitionNameRules: config.channelRecognitionNameRules
    })
  };
}

function pickSessionStatePatch(patch: Partial<ViewerSessionState>): Partial<ViewerSessionState> {
  const nextPatch: Partial<ViewerSessionState> = {};
  for (const key of SESSION_STATE_KEYS) {
    if (key in patch) {
      Object.assign(nextPatch, {
        [key]: patch[key]
      });
    }
  }
  if (patch.depthYawDeg !== undefined) {
    nextPatch.depthYawDeg = clampDepthYaw(patch.depthYawDeg);
  }
  if (patch.depthPitchDeg !== undefined) {
    nextPatch.depthPitchDeg = clampDepthPitch(patch.depthPitchDeg);
  }
  if (patch.depthZoom !== undefined) {
    nextPatch.depthZoom = clampDepthZoom(patch.depthZoom);
  }
  return nextPatch;
}

function hasStateChanges(state: ViewerSessionState, patch: Partial<ViewerSessionState>): boolean {
  const entries = Object.entries(patch) as Array<[keyof ViewerSessionState, ViewerSessionState[keyof ViewerSessionState]]>;
  return entries.some(([key, value]) => state[key] !== value);
}
