import { samplePixelValues } from '../sampling/probe';
import { buildSpectralPlotPoints, detectSpectralChannels } from '../spectral';
import {
  resolveActiveProbePixel,
  resolveProbeMode
} from '../probe';
import type { SpectralPlotReadoutModel } from './viewer-app-types';
import type {
  DecodedLayer,
  OpenedImageSession,
  ViewerInteractionState,
  ViewerSessionState
} from '../types';

export interface BuildSpectralPresentationArgs {
  activeSession: OpenedImageSession | null;
  activeLayer: DecodedLayer | null;
  sessionState: ViewerSessionState;
  interactionState: ViewerInteractionState;
}

export function buildSpectralPlotReadoutModel(args: BuildSpectralPresentationArgs): SpectralPlotReadoutModel {
  const mode = resolveProbeMode(args.sessionState.lockedPixel);
  const imageSize = args.activeSession
    ? {
        width: args.activeSession.decoded.width,
        height: args.activeSession.decoded.height
      }
    : null;

  if (!args.activeSession || !args.activeLayer) {
    return {
      visible: false,
      mode,
      pixel: null,
      imageSize,
      channels: [],
      points: []
    };
  }

  const preferredSpectralChannelName = args.sessionState.displaySelection?.kind === 'channelMono'
    ? args.sessionState.displaySelection.channel
    : null;
  const spectralChannels = detectSpectralChannels(args.activeLayer.channelNames, preferredSpectralChannelName);
  if (spectralChannels.length === 0) {
    return {
      visible: false,
      mode,
      pixel: null,
      imageSize,
      channels: [],
      points: []
    };
  }

  const targetPixel = resolveActiveProbePixel(
    args.sessionState.lockedPixel,
    args.interactionState.hoveredPixel
  );
  if (!targetPixel) {
    return {
      visible: true,
      mode,
      pixel: null,
      imageSize,
      channels: spectralChannels,
      points: []
    };
  }

  const sample = samplePixelValues(
    args.activeLayer,
    args.activeSession.decoded.width,
    args.activeSession.decoded.height,
    targetPixel
  );

  return {
    visible: true,
    mode,
    pixel: sample ? { x: sample.x, y: sample.y } : null,
    imageSize,
    channels: spectralChannels,
    points: buildSpectralPlotPoints(sample, spectralChannels)
  };
}
