import { describe, expect, it, vi } from 'vitest';
import {
  ENVIRONMENT_LIGHTING_INTERACTION_SETTLE_MS,
  ViewerInteractionCoordinator
} from '../src/interaction-coordinator';
import { createEmptyRoiInteractionState, createInteractionState } from '../src/view-state';
import { createInitialState } from '../src/viewer-store';
import type { ViewerSessionState, ViewerViewState } from '../src/types';

function createExpectedView(overrides: Partial<ViewerViewState> = {}): ViewerViewState {
  return {
    ...createInteractionState(createInitialState()).view,
    ...overrides
  };
}

function createHarness(initialSessionState: Partial<ViewerSessionState> = {}) {
  let sessionState = {
    ...createInitialState(),
    ...initialSessionState
  };
  let frameCallback: FrameRequestCallback | null = null;
  let delayCallback: (() => void) | null = null;
  const onInteractionChange = vi.fn();
  const commitViewState = vi.fn((view) => {
    sessionState = {
      ...sessionState,
      ...view
    };
  });
  const cancelFrame = vi.fn(() => {
    frameCallback = null;
  });
  const cancelDelay = vi.fn(() => {
    delayCallback = null;
  });

  const coordinator = new ViewerInteractionCoordinator({
    initialSessionState: sessionState,
    getSessionState: () => sessionState,
    commitViewState,
    onInteractionChange,
    scheduleFrame: (callback) => {
      frameCallback = callback;
      return 1;
    },
    cancelFrame,
    scheduleDelay: (callback, delayMs) => {
      expect(delayMs).toBe(ENVIRONMENT_LIGHTING_INTERACTION_SETTLE_MS);
      delayCallback = callback;
      return 2;
    },
    cancelDelay
  });

  return {
    coordinator,
    onInteractionChange,
    commitViewState,
    cancelFrame,
    cancelDelay,
    getSessionState: () => sessionState,
    setSessionState: (next: typeof sessionState) => {
      sessionState = next;
    },
    flush: () => {
      const callback = frameCallback;
      frameCallback = null;
      callback?.(0);
    },
    settleEnvironmentLighting: () => {
      const callback = delayCallback;
      delayCallback = null;
      callback?.();
    },
    hasScheduledFrame: () => frameCallback !== null,
    hasScheduledEnvironmentLightingSettle: () => delayCallback !== null
  };
}

describe('interaction coordinator', () => {
  it('coalesces multiple view and hover updates into one frame publish', () => {
    const harness = createHarness();

    harness.coordinator.enqueueViewPatch({ zoom: 2 });
    harness.coordinator.enqueueHoverPixel({ ix: 1, iy: 0 });
    harness.coordinator.enqueueViewPatch({ panX: 4, panY: 5 });
    harness.coordinator.enqueueHoverPixel({ ix: 2, iy: 1 });

    expect(harness.hasScheduledFrame()).toBe(true);

    harness.flush();

    expect(harness.onInteractionChange).toHaveBeenCalledTimes(1);
    expect(harness.onInteractionChange).toHaveBeenCalledWith(
      {
        view: createExpectedView({
          zoom: 2,
          panX: 4,
          panY: 5
        }),
        hoveredPixel: { ix: 2, iy: 1 },
        draftRoi: null,
        roiInteraction: createEmptyRoiInteractionState()
      },
      {
        view: createExpectedView(),
        hoveredPixel: null,
        draftRoi: null,
        roiInteraction: createEmptyRoiInteractionState()
      }
    );
    expect(harness.commitViewState).toHaveBeenCalledTimes(1);
    expect(harness.commitViewState).toHaveBeenCalledWith(createExpectedView({
      zoom: 2,
      panX: 4,
      panY: 5
    }));
  });

  it('ignores same-pixel hover updates even when object identity changes', () => {
    const harness = createHarness();

    harness.coordinator.enqueueHoverPixel({ ix: 3, iy: 2 });
    harness.flush();
    harness.onInteractionChange.mockClear();
    harness.commitViewState.mockClear();

    harness.coordinator.enqueueHoverPixel({ ix: 3, iy: 2 });

    expect(harness.hasScheduledFrame()).toBe(false);
    expect(harness.onInteractionChange).not.toHaveBeenCalled();
    expect(harness.commitViewState).not.toHaveBeenCalled();
  });

  it('ignores numerically identical view patches', () => {
    const harness = createHarness();

    harness.coordinator.enqueueViewPatch({
      zoom: 1,
      panX: 0,
      panY: 0,
      panoramaYawDeg: 0,
      panoramaPitchDeg: 0,
      panoramaHfovDeg: 100
    });

    expect(harness.hasScheduledFrame()).toBe(false);
    expect(harness.onInteractionChange).not.toHaveBeenCalled();
    expect(harness.commitViewState).not.toHaveBeenCalled();
  });

  it('uses interactive SH lighting while panorama view updates are active and settles at full quality', () => {
    const harness = createHarness({
      viewerMode: 'panorama',
      panoramaDisplayMode: 'environmentLighting',
      panoramaLightingMethod: 'sphericalHarmonics'
    });

    harness.coordinator.enqueueViewPatch({ panoramaYawDeg: 12 });

    expect(harness.hasScheduledEnvironmentLightingSettle()).toBe(true);
    harness.flush();
    expect(harness.onInteractionChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        environmentLightingInteractive: true,
        view: expect.objectContaining({ panoramaYawDeg: 12 })
      }),
      expect.anything()
    );

    harness.settleEnvironmentLighting();
    expect(harness.hasScheduledFrame()).toBe(true);
    harness.flush();

    const settledState = harness.onInteractionChange.mock.calls.at(-1)?.[0];
    expect(settledState.environmentLightingInteractive).toBeUndefined();
    expect(settledState.view.panoramaYawDeg).toBe(12);
    expect(harness.commitViewState).toHaveBeenCalledTimes(1);
  });

  it('keeps path-traced panorama view updates out of the SH interaction quality path', () => {
    const harness = createHarness({
      viewerMode: 'panorama',
      panoramaDisplayMode: 'environmentLighting',
      panoramaLightingMethod: 'pathTracing'
    });

    harness.coordinator.enqueueViewPatch({ panoramaYawDeg: 12 });
    harness.flush();

    expect(harness.hasScheduledEnvironmentLightingSettle()).toBe(false);
    const publishedState = harness.onInteractionChange.mock.calls.at(-1)?.[0];
    expect(publishedState.environmentLightingInteractive).toBeUndefined();
  });

  it('rehydrates from session state and clears transient hover on session switches', () => {
    const harness = createHarness();

    harness.coordinator.enqueueViewPatch({ zoom: 3, panX: 6 });
    harness.coordinator.enqueueHoverPixel({ ix: 4, iy: 4 });
    harness.flush();

    const nextSessionState = {
      ...harness.getSessionState(),
      zoom: 7,
      panX: 8,
      panY: 9,
      panoramaYawDeg: 15,
      panoramaPitchDeg: 10,
      panoramaHfovDeg: 70
    };
    harness.setSessionState(nextSessionState);

    const sync = harness.coordinator.syncSessionState(nextSessionState, { clearHover: true });

    expect(sync.changed).toBe(true);
    expect(sync.state).toEqual({
      view: createExpectedView({
        zoom: 7,
        panX: 8,
        panY: 9,
        panoramaYawDeg: 15,
        panoramaPitchDeg: 10,
        panoramaHfovDeg: 70
      }),
      hoveredPixel: null,
      draftRoi: null,
      roiInteraction: createEmptyRoiInteractionState()
    });
    expect(sync.previous.hoveredPixel).toEqual({ ix: 4, iy: 4 });
    expect(harness.cancelFrame).toHaveBeenCalledTimes(0);
  });

  it('clamps 3D view patches before publishing and committing interaction state', () => {
    const harness = createHarness();

    harness.coordinator.enqueueViewPatch({
      depthYawDeg: 180,
      depthPitchDeg: -120,
      depthZoom: 100
    });
    harness.flush();

    expect(harness.onInteractionChange).toHaveBeenCalledWith(
      expect.objectContaining({
        view: expect.objectContaining({
          depthYawDeg: 89.9,
          depthPitchDeg: -89.9,
          depthZoom: 50
        })
      }),
      expect.anything()
    );
    expect(harness.commitViewState).toHaveBeenCalledWith(
      expect.objectContaining({
        depthYawDeg: 89.9,
        depthPitchDeg: -89.9,
        depthZoom: 50
      })
    );
  });

  it('preserves position 3D view patches before publishing and committing interaction state', () => {
    const harness = createHarness({
      depthChannel: '__position:P'
    });

    harness.coordinator.enqueueViewPatch({
      depthYawDeg: 120,
      depthPitchDeg: -120,
      depthZoom: 100
    });
    harness.flush();

    expect(harness.onInteractionChange).toHaveBeenCalledWith(
      expect.objectContaining({
        view: expect.objectContaining({
          depthYawDeg: 120,
          depthPitchDeg: -120,
          depthZoom: 50
        })
      }),
      expect.anything()
    );
    expect(harness.commitViewState).toHaveBeenCalledWith(
      expect.objectContaining({
        depthYawDeg: 120,
        depthPitchDeg: -120,
        depthZoom: 50
      })
    );
  });
});
