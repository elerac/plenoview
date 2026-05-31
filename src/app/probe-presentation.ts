import { samplePixelValuesForDisplay } from '../sampling/probe';
import { resolveDisplayImageSize } from '../display-size';
import {
  isValidDepthProbePixel,
  resolveDepthChannelForLayer
} from '../depth';
import {
  buildProbeColorPreview,
  resolveActiveProbePixel,
  resolveProbeMode
} from '../probe';
import type { ColormapLut } from '../colormaps';
import type { ChannelRecognitionSettings } from '../channel-recognition-settings';
import type { ChannelRecognitionNameRules } from '../channel-recognition-name-rules';
import type { ProbeReadoutModel } from './viewer-app-types';
import type {
  DecodedLayer,
  DisplayLuminanceRange,
  OpenedImageSession,
  ViewerInteractionState,
  ViewerSessionState
} from '../types';

export interface BuildProbePresentationArgs {
  activeSession: OpenedImageSession | null;
  activeLayer: DecodedLayer | null;
  sessionState: ViewerSessionState;
  interactionState: ViewerInteractionState;
  activeColormapLut: ColormapLut | null;
  activeDisplayLuminanceRange: DisplayLuminanceRange | null;
  maskInvalidStokesVectors?: boolean;
  spectralRgbGroupingEnabled?: boolean;
  channelRecognitionSettings?: ChannelRecognitionSettings;
  channelRecognitionNameRules?: ChannelRecognitionNameRules;
}

export function buildProbeReadoutModel(args: BuildProbePresentationArgs): ProbeReadoutModel {
  const mode = resolveProbeMode(args.sessionState.lockedPixel);
  const imageSize = args.activeSession
    ? args.sessionState.viewerMode === 'depth'
      ? {
          width: args.activeSession.decoded.width,
          height: args.activeSession.decoded.height
        }
      : resolveDisplayImageSize(
          args.activeSession.decoded.width,
          args.activeSession.decoded.height,
          args.sessionState.displaySelection
        )
    : null;

  if (!args.activeSession || !args.activeLayer) {
    return {
      mode,
      sample: null,
      colorPreview: null,
      imageSize
    };
  }

  const targetPixel = resolveActiveProbePixel(
    args.sessionState.lockedPixel,
    args.interactionState.hoveredPixel
  );
  if (!targetPixel) {
    return {
      mode,
      sample: null,
      colorPreview: null,
      imageSize
    };
  }

  if (args.sessionState.viewerMode === 'depth') {
    const depthChannel = resolveDepthChannelForLayer(
      args.activeLayer.channelNames,
      args.sessionState.depthChannel,
      {
        allowArbitraryZSuffix: true,
        channelRecognitionSettings: args.channelRecognitionSettings,
        channelRecognitionNameRules: args.channelRecognitionNameRules
      }
    );
    if (!isValidDepthProbePixel(targetPixel, {
      layer: args.activeLayer,
      width: args.activeSession.decoded.width,
      height: args.activeSession.decoded.height,
      channelName: depthChannel
    })) {
      return {
        mode,
        sample: null,
        colorPreview: null,
        imageSize
      };
    }
  }

  const sample = samplePixelValuesForDisplay(
    args.activeLayer,
    args.activeSession.decoded.width,
    args.activeSession.decoded.height,
    targetPixel,
    args.sessionState.displaySelection,
    args.sessionState.visualizationMode,
    {
      maskInvalidStokesVectors: args.maskInvalidStokesVectors,
      spectralRgbGroupingEnabled: args.spectralRgbGroupingEnabled,
      channelRecognitionNameRules: args.channelRecognitionNameRules
    }
  );

  return {
    mode,
    sample,
    colorPreview: buildProbeColorPreview(
      sample,
      args.sessionState.displaySelection,
      args.sessionState.exposureEv,
      args.sessionState.displayGamma,
      {
        mode: args.sessionState.visualizationMode,
        colormapRange: args.sessionState.colormapRange ?? args.activeDisplayLuminanceRange,
        colormapLut: args.activeColormapLut,
        colormapExposureEv: args.sessionState.colormapExposureEv,
        colormapGamma: args.sessionState.colormapGamma,
        colormapZeroCentered: args.sessionState.colormapZeroCentered,
        colormapReversed: args.sessionState.colormapReversed,
        stokesDegreeModulation: args.sessionState.stokesDegreeModulation,
        stokesAolpDegreeModulationMode: args.sessionState.stokesAolpDegreeModulationMode
      }
    ),
    imageSize
  };
}
