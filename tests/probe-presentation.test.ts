import { describe, expect, it } from 'vitest';
import { buildProbeReadoutModel } from '../src/app/probe-presentation';
import { DEFAULT_DISPLAY_GAMMA } from '../src/color';
import {
  createChannelRgbSelection,
  createLayerFromChannels,
  createViewerInteractionState,
  createViewerSessionState
} from './helpers/state-fixtures';
import type { OpenedImageSession } from '../src/types';

describe('probe presentation', () => {
  it('shows color-only probe values in depth mode for the picked source pixel', () => {
    const layer = createLayerFromChannels({
      R: [0.1, 0.2],
      G: [0.3, 0.4],
      B: [0.5, 0.6],
      Z: [1, 2]
    });
    const sessionState = createViewerSessionState({
      viewerMode: 'depth',
      displayGamma: DEFAULT_DISPLAY_GAMMA,
      displaySelection: createChannelRgbSelection('R', 'G', 'B'),
      depthChannel: 'Z'
    });
    const session: OpenedImageSession = {
      id: 'session-1',
      filename: 'depth.exr',
      displayName: 'depth.exr',
      fileSizeBytes: 1,
      source: { kind: 'url', url: '/depth.exr' },
      decoded: {
        width: 2,
        height: 1,
        layers: [layer]
      },
      state: sessionState
    };

    const readout = buildProbeReadoutModel({
      activeSession: session,
      activeLayer: layer,
      sessionState,
      interactionState: createViewerInteractionState({
        hoveredPixel: { ix: 1, iy: 0 }
      }, sessionState),
      activeColormapLut: null,
      activeDisplayLuminanceRange: null
    });

    expect(readout.sample).not.toBeNull();
    if (!readout.sample) {
      throw new Error('Expected probe readout sample.');
    }

    expect(readout.sample).toMatchObject({
      x: 1,
      y: 0,
      values: {
        Z: 2
      }
    });
    expect(readout.sample.values.R).toBeCloseTo(0.2, 6);
    expect(readout.sample.values.G).toBeCloseTo(0.4, 6);
    expect(readout.sample.values.B).toBeCloseTo(0.6, 6);
    expect(readout.imageSize).toEqual({ width: 2, height: 1 });
    expect(readout.colorPreview?.displayValues.map((item) => item.label)).toEqual(['R', 'G', 'B']);
  });

  it('suppresses depth mode probe readout for pixels outside the visible point cloud', () => {
    const layer = createLayerFromChannels({
      R: [0.1],
      G: [0.2],
      B: [0.3],
      Z: [0]
    });
    const sessionState = createViewerSessionState({
      viewerMode: 'depth',
      displayGamma: DEFAULT_DISPLAY_GAMMA,
      displaySelection: createChannelRgbSelection('R', 'G', 'B'),
      depthChannel: 'Z'
    });
    const session: OpenedImageSession = {
      id: 'session-1',
      filename: 'depth.exr',
      displayName: 'depth.exr',
      fileSizeBytes: 1,
      source: { kind: 'url', url: '/depth.exr' },
      decoded: {
        width: 1,
        height: 1,
        layers: [layer]
      },
      state: sessionState
    };

    const readout = buildProbeReadoutModel({
      activeSession: session,
      activeLayer: layer,
      sessionState,
      interactionState: createViewerInteractionState({
        hoveredPixel: { ix: 0, iy: 0 }
      }, sessionState),
      activeColormapLut: null,
      activeDisplayLuminanceRange: null
    });

    expect(readout.sample).toBeNull();
    expect(readout.colorPreview).toBeNull();
    expect(readout.imageSize).toEqual({ width: 1, height: 1 });
  });
});
