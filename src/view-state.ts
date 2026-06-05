import type {
  ImagePixel,
  ViewerInteractionState,
  ViewerRenderState,
  ViewerRoiInteractionState,
  ViewerSessionState,
  ViewerViewState
} from './types';
import type { ChannelRecognitionSettings } from './channel-recognition-settings';
import type { ChannelRecognitionNameRules } from './channel-recognition-name-rules';
import {
  type DepthRotationSource,
  clampDepthZoom,
  normalizeDepthPitchForSource,
  normalizeDepthYawForSource
} from './depth';
import { sameImageRoi } from './roi';
import { DEFAULT_MASK_INVALID_STOKES_VECTORS } from './stokes';
import { DEFAULT_INVALID_VALUE_WARNING_ENABLED } from './invalid-value-warning-settings';
import { DEFAULT_SPECTRAL_RGB_GROUPING_ENABLED } from './spectral-default-settings';
import { DEFAULT_VIEWER_BACKGROUND_ID, type ViewerBackgroundId } from './viewer-background-settings';

export interface MergeRenderStateOptions {
  viewerBackground?: ViewerBackgroundId;
  maskInvalidStokesVectors?: boolean;
  spectralRgbGroupingEnabled?: boolean;
  channelRecognitionSettings?: ChannelRecognitionSettings;
  channelRecognitionNameRules?: ChannelRecognitionNameRules;
  invalidValueWarningEnabled?: boolean;
  invalidValueWarningPhase?: number;
}

export function pickViewState(
  state: ViewerViewState,
  depthSource: DepthRotationSource = null
): ViewerViewState {
  return {
    zoom: state.zoom,
    panX: state.panX,
    panY: state.panY,
    panoramaYawDeg: state.panoramaYawDeg,
    panoramaPitchDeg: state.panoramaPitchDeg,
    panoramaHfovDeg: state.panoramaHfovDeg,
    depthYawDeg: normalizeDepthYawForSource(state.depthYawDeg, depthSource),
    depthPitchDeg: normalizeDepthPitchForSource(state.depthPitchDeg, depthSource),
    depthZoom: clampDepthZoom(state.depthZoom)
  };
}

export function createInteractionState(sessionState: ViewerSessionState): ViewerInteractionState {
  return {
    view: pickViewState(sessionState, sessionState.depthChannel),
    hoveredPixel: null,
    draftRoi: null,
    roiInteraction: createEmptyRoiInteractionState()
  };
}

export function mergeRenderState(
  sessionState: ViewerSessionState,
  interactionState: ViewerInteractionState,
  options: MergeRenderStateOptions = {}
): ViewerRenderState {
  return {
    ...sessionState,
    ...pickViewState(interactionState.view, sessionState.depthChannel),
    viewerBackground: options.viewerBackground ?? DEFAULT_VIEWER_BACKGROUND_ID,
    maskInvalidStokesVectors: options.maskInvalidStokesVectors ?? DEFAULT_MASK_INVALID_STOKES_VECTORS,
    spectralRgbGroupingEnabled: options.spectralRgbGroupingEnabled ?? DEFAULT_SPECTRAL_RGB_GROUPING_ENABLED,
    ...(options.channelRecognitionSettings === undefined
      ? {}
      : { channelRecognitionSettings: options.channelRecognitionSettings }),
    ...(options.channelRecognitionNameRules === undefined
      ? {}
      : { channelRecognitionNameRules: options.channelRecognitionNameRules }),
    invalidValueWarningEnabled: options.invalidValueWarningEnabled ?? DEFAULT_INVALID_VALUE_WARNING_ENABLED,
    ...(options.invalidValueWarningPhase === undefined ? {} : { invalidValueWarningPhase: options.invalidValueWarningPhase }),
    hoveredPixel: interactionState.hoveredPixel,
    draftRoi: interactionState.draftRoi,
    roiInteraction: interactionState.roiInteraction
  };
}

export function createEmptyRoiInteractionState(): ViewerRoiInteractionState {
  return {
    hoverHandle: null,
    activeHandle: null
  };
}

export function sameViewState(a: ViewerViewState, b: ViewerViewState): boolean {
  return (
    a.zoom === b.zoom &&
    a.panX === b.panX &&
    a.panY === b.panY &&
    a.panoramaYawDeg === b.panoramaYawDeg &&
    a.panoramaPitchDeg === b.panoramaPitchDeg &&
    a.panoramaHfovDeg === b.panoramaHfovDeg &&
    a.depthYawDeg === b.depthYawDeg &&
    a.depthPitchDeg === b.depthPitchDeg &&
    a.depthZoom === b.depthZoom
  );
}

export function samePixel(a: ImagePixel | null | undefined, b: ImagePixel | null | undefined): boolean {
  if (!a && !b) {
    return true;
  }

  if (!a || !b) {
    return false;
  }

  return a.ix === b.ix && a.iy === b.iy;
}

export function sameRoi(a: ViewerSessionState['roi'] | ViewerInteractionState['draftRoi'], b: ViewerSessionState['roi'] | ViewerInteractionState['draftRoi']): boolean {
  return sameImageRoi(a, b);
}

export function sameRoiInteractionState(
  a: ViewerRoiInteractionState,
  b: ViewerRoiInteractionState
): boolean {
  return (
    a.hoverHandle === b.hoverHandle &&
    a.activeHandle === b.activeHandle
  );
}
