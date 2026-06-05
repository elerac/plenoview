import { cloneDisplayLuminanceRange } from './colormap-range';
import {
  clampDepthZoom,
  normalizeDepthTarget,
  normalizeDepthPitchForSource,
  normalizeDepthYawForSource
} from './depth';
import { cloneDisplaySelection } from './display-model';
import { cloneImageRoi } from './roi';
import { ViewerSessionState } from './types';

export function buildSessionDisplayName(filename: string, existingFilenames: string[]): string {
  const duplicateCount = existingFilenames.reduce((count, current) => {
    return count + (current === filename ? 1 : 0);
  }, 0);

  if (duplicateCount === 0) {
    return filename;
  }

  return `${filename} (${duplicateCount + 1})`;
}

export function normalizeSessionDisplayName(displayName: string | null | undefined): string | null {
  const trimmed = displayName?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : null;
}

export function pickNextSessionIndexAfterRemoval(removedIndex: number, remainingCount: number): number {
  if (removedIndex < 0 || remainingCount <= 0) {
    return -1;
  }

  return Math.min(removedIndex, remainingCount - 1);
}

export function persistActiveSessionState<T extends { id: string; state: ViewerSessionState }>(
  sessions: T[],
  activeSessionId: string | null,
  state: ViewerSessionState
): void {
  if (!activeSessionId) {
    return;
  }

  const session = sessions.find((item) => item.id === activeSessionId);
  if (!session) {
    return;
  }

  session.state = cloneViewerSessionState(state);
}

export function cloneViewerSessionState(state: ViewerSessionState): ViewerSessionState {
  return {
    exposureEv: state.exposureEv,
    channelThumbnailExposureEv: state.channelThumbnailExposureEv,
    displayGamma: state.displayGamma,
    channelThumbnailDisplayGamma: state.channelThumbnailDisplayGamma,
    viewerMode: state.viewerMode,
    visualizationMode: state.visualizationMode,
    activeColormapId: state.activeColormapId,
    colormapExposureEv: state.colormapExposureEv,
    colormapGamma: state.colormapGamma,
    colormapRange: cloneDisplayLuminanceRange(state.colormapRange),
    colormapRangeMode: state.colormapRangeMode,
    colormapZeroCentered: state.colormapZeroCentered,
    colormapReversed: state.colormapReversed,
    stokesDegreeModulation: { ...state.stokesDegreeModulation },
    stokesAolpDegreeModulationMode: state.stokesAolpDegreeModulationMode,
    zoom: state.zoom,
    panX: state.panX,
    panY: state.panY,
    panoramaYawDeg: state.panoramaYawDeg,
    panoramaPitchDeg: state.panoramaPitchDeg,
    panoramaHfovDeg: state.panoramaHfovDeg,
    depthYawDeg: normalizeDepthYawForSource(state.depthYawDeg, state.depthChannel),
    depthPitchDeg: normalizeDepthPitchForSource(state.depthPitchDeg, state.depthChannel),
    depthZoom: clampDepthZoom(state.depthZoom),
    depthTargetX: normalizeDepthTarget(state.depthTargetX),
    depthTargetY: normalizeDepthTarget(state.depthTargetY),
    depthTargetZ: normalizeDepthTarget(state.depthTargetZ),
    activeLayer: state.activeLayer,
    displaySelection: cloneDisplaySelection(state.displaySelection),
    depthChannel: state.depthChannel,
    depthFocalLengthPx: state.depthFocalLengthPx,
    depthPointSizePx: state.depthPointSizePx,
    lockedPixel: state.lockedPixel ? { ...state.lockedPixel } : null,
    roi: cloneImageRoi(state.roi)
  };
}
