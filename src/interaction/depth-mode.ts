import {
  clampDepthZoom,
  normalizeDepthPitchForSource,
  normalizeDepthYawForSource
} from '../depth';
import type {
  DepthKeyboardOrbitDirection,
  DepthKeyboardOrbitInput,
  ViewerKeyboardZoomDirection,
  ViewerState,
  ViewportInfo
} from '../types';
import type {
  InteractionCallbacks,
  InteractionDependencies,
  PointerPosition
} from './shared';
import { resolveHoverPixel } from './probe-mode';

const DEPTH_KEYBOARD_ORBIT_STEP_RATIO = 0.05;
const DEPTH_KEYBOARD_ORBIT_SPEED_PER_SECOND = 1.5;
const DEPTH_KEYBOARD_ORBIT_MAX_FRAME_MS = 50;
const DEPTH_KEYBOARD_ZOOM_STEP = 1.25;

type DepthViewChange = Pick<
  ViewerState,
  'depthYawDeg' | 'depthPitchDeg' | 'depthZoom'
>;

type DepthKeyboardOrbitCallbacks = Pick<
  InteractionCallbacks,
  'getState' | 'getViewport' | 'getImageSize' | 'resolveDepthProbePixel' | 'onViewChange' | 'onHoverPixel'
> & {
  getLastPointerInElement: () => PointerPosition | null;
};

export function orbitDepthFromDrag(
  state: ViewerState,
  viewport: ViewportInfo,
  deltaX: number,
  deltaY: number
): DepthViewChange {
  const depthSource = state.depthChannel;
  if (viewport.width <= 0 || viewport.height <= 0) {
    return {
      depthYawDeg: normalizeDepthYawForSource(state.depthYawDeg, depthSource),
      depthPitchDeg: normalizeDepthPitchForSource(state.depthPitchDeg, depthSource),
      depthZoom: clampDepthZoom(state.depthZoom)
    };
  }

  return {
    depthYawDeg: normalizeDepthYawForSource(
      state.depthYawDeg + (deltaX / viewport.width) * 180,
      depthSource
    ),
    depthPitchDeg: normalizeDepthPitchForSource(
      state.depthPitchDeg + (deltaY / viewport.height) * 180,
      depthSource
    ),
    depthZoom: state.depthZoom
  };
}

export function zoomDepthFromWheel(
  state: ViewerState,
  deltaY: number
): DepthViewChange {
  const zoomFactor = Math.exp(-deltaY * 0.0015);
  return {
    depthYawDeg: normalizeDepthYawForSource(state.depthYawDeg, state.depthChannel),
    depthPitchDeg: normalizeDepthPitchForSource(state.depthPitchDeg, state.depthChannel),
    depthZoom: clampDepthZoom(state.depthZoom * zoomFactor)
  };
}

export function zoomDepthFromKeyboard(
  state: ViewerState,
  direction: ViewerKeyboardZoomDirection
): DepthViewChange {
  return zoomDepthByKeyboardStep(state, direction === 'in' ? 1 : -1);
}

export function zoomDepthByKeyboardStep(
  state: ViewerState,
  signedStep: number
): DepthViewChange {
  return {
    depthYawDeg: normalizeDepthYawForSource(state.depthYawDeg, state.depthChannel),
    depthPitchDeg: normalizeDepthPitchForSource(state.depthPitchDeg, state.depthChannel),
    depthZoom: clampDepthZoom(state.depthZoom * (DEPTH_KEYBOARD_ZOOM_STEP ** signedStep))
  };
}

export class DepthKeyboardOrbitController {
  private readonly callbacks: DepthKeyboardOrbitCallbacks;
  private readonly scheduleFrame: NonNullable<InteractionDependencies['scheduleFrame']>;
  private readonly cancelFrame: NonNullable<InteractionDependencies['cancelFrame']>;
  private input = createDepthKeyboardOrbitInput();
  private frameId: number | null = null;
  private lastFrameTime: number | null = null;

  constructor(
    callbacks: DepthKeyboardOrbitCallbacks,
    dependencies: InteractionDependencies = {}
  ) {
    this.callbacks = callbacks;
    this.scheduleFrame = dependencies.scheduleFrame ?? window.requestAnimationFrame.bind(window);
    this.cancelFrame = dependencies.cancelFrame ?? window.cancelAnimationFrame.bind(window);
  }

  destroy(): void {
    this.cancelScheduledFrame();
    this.input = createDepthKeyboardOrbitInput();
    this.lastFrameTime = null;
  }

  handle(direction: DepthKeyboardOrbitDirection): void {
    this.applyInput(createDepthKeyboardOrbitInput(direction), DEPTH_KEYBOARD_ORBIT_STEP_RATIO);
  }

  setInput(input: DepthKeyboardOrbitInput): void {
    const previousInput = this.input;
    const nextInput = cloneDepthKeyboardOrbitInput(input);
    if (sameDepthKeyboardOrbitInput(previousInput, nextInput)) {
      if (hasDepthKeyboardOrbitInput(nextInput)) {
        this.ensureScheduledFrame();
      } else {
        this.cancelScheduledFrame();
        this.lastFrameTime = null;
      }
      return;
    }

    this.input = nextInput;
    const newlyPressedInput = getNewlyPressedDepthKeyboardOrbitInput(previousInput, nextInput);
    if (hasDepthKeyboardOrbitInput(newlyPressedInput)) {
      this.applyInput(newlyPressedInput, DEPTH_KEYBOARD_ORBIT_STEP_RATIO);
    }

    if (hasDepthKeyboardOrbitInput(nextInput)) {
      if (!hasDepthKeyboardOrbitInput(previousInput)) {
        this.lastFrameTime = null;
      }
      this.ensureScheduledFrame();
      return;
    }

    this.cancelScheduledFrame();
    this.lastFrameTime = null;
  }

  private applyInput(input: DepthKeyboardOrbitInput, viewportStepRatio: number): void {
    const imageSize = this.callbacks.getImageSize();
    if (!imageSize) {
      return;
    }

    const state = this.callbacks.getState();
    if (state.viewerMode !== 'depth') {
      return;
    }

    const viewport = this.callbacks.getViewport();
    if (viewport.width <= 0 || viewport.height <= 0) {
      return;
    }

    const horizontalDirection = (input.left ? 1 : 0) - (input.right ? 1 : 0);
    const verticalDirection = (input.down ? 1 : 0) - (input.up ? 1 : 0);
    const nextView = orbitDepthFromDrag(
      state,
      viewport,
      viewport.width * viewportStepRatio * horizontalDirection,
      viewport.height * viewportStepRatio * verticalDirection
    );
    if (
      nextView.depthYawDeg === state.depthYawDeg &&
      nextView.depthPitchDeg === state.depthPitchDeg &&
      nextView.depthZoom === state.depthZoom
    ) {
      return;
    }

    const nextState = { ...state, ...nextView };
    this.callbacks.onViewChange(nextView);
    this.callbacks.onHoverPixel(
      resolveHoverPixel(
        this.callbacks.getLastPointerInElement(),
        nextState,
        viewport,
        imageSize,
        this.callbacks.resolveDepthProbePixel
      )
    );
  }

  private ensureScheduledFrame(): void {
    if (this.frameId !== null || !hasDepthKeyboardOrbitInput(this.input)) {
      return;
    }

    this.frameId = this.scheduleFrame(this.onFrame);
  }

  private cancelScheduledFrame(): void {
    if (this.frameId === null) {
      return;
    }

    this.cancelFrame(this.frameId);
    this.frameId = null;
  }

  private readonly onFrame = (timestamp: number): void => {
    this.frameId = null;
    if (!hasDepthKeyboardOrbitInput(this.input)) {
      this.lastFrameTime = null;
      return;
    }

    if (this.lastFrameTime !== null) {
      const elapsedMs = Math.min(
        DEPTH_KEYBOARD_ORBIT_MAX_FRAME_MS,
        Math.max(0, timestamp - this.lastFrameTime)
      );
      if (elapsedMs > 0) {
        this.applyInput(
          this.input,
          DEPTH_KEYBOARD_ORBIT_SPEED_PER_SECOND * (elapsedMs / 1000)
        );
      }
    }

    this.lastFrameTime = timestamp;
    this.ensureScheduledFrame();
  };
}

function createDepthKeyboardOrbitInput(
  direction: DepthKeyboardOrbitDirection | null = null
): DepthKeyboardOrbitInput {
  return {
    up: direction === 'up',
    left: direction === 'left',
    down: direction === 'down',
    right: direction === 'right'
  };
}

function cloneDepthKeyboardOrbitInput(input: DepthKeyboardOrbitInput): DepthKeyboardOrbitInput {
  return {
    up: input.up,
    left: input.left,
    down: input.down,
    right: input.right
  };
}

function getNewlyPressedDepthKeyboardOrbitInput(
  previousInput: DepthKeyboardOrbitInput,
  nextInput: DepthKeyboardOrbitInput
): DepthKeyboardOrbitInput {
  return {
    up: nextInput.up && !previousInput.up,
    left: nextInput.left && !previousInput.left,
    down: nextInput.down && !previousInput.down,
    right: nextInput.right && !previousInput.right
  };
}

function hasDepthKeyboardOrbitInput(input: DepthKeyboardOrbitInput): boolean {
  return input.up || input.left || input.down || input.right;
}

function sameDepthKeyboardOrbitInput(
  a: DepthKeyboardOrbitInput,
  b: DepthKeyboardOrbitInput
): boolean {
  return a.up === b.up && a.left === b.left && a.down === b.down && a.right === b.right;
}
