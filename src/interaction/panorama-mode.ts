import type {
  PanoramaKeyboardOrbitDirection,
  PanoramaKeyboardOrbitInput,
  ViewerKeyboardZoomDirection,
  ViewerState,
  ViewportInfo
} from '../types';
import {
  getPanoramaProjectionDiameter,
  getPanoramaVerticalFovDeg,
  clampPanoramaHfov,
  normalizePanoramaYaw,
  orbitPanorama,
  zoomPanorama
} from './panorama-geometry';
import { resolveHoverPixel } from './probe-mode';
import type {
  InteractionCallbacks,
  InteractionDependencies,
  PointerPosition
} from './shared';

const PANORAMA_KEYBOARD_ORBIT_STEP_RATIO = 0.05;
const PANORAMA_KEYBOARD_ORBIT_SPEED_PER_SECOND = 1.5;
const PANORAMA_KEYBOARD_ORBIT_MAX_FRAME_MS = 50;
const PANORAMA_KEYBOARD_ZOOM_STEP = 1.25;
const PANORAMA_AUTO_ROTATE_MAX_FRAME_MS = 50;
const PANORAMA_AUTO_ROTATE_RAMP_DURATION_MS = 1200;

type PanoramaViewChange = Pick<
  ViewerState,
  'panoramaYawDeg' | 'panoramaPitchDeg' | 'panoramaHfovDeg'
>;

export interface PanoramaAutoRotateConfig {
  autoRotate: boolean;
  rotationSpeedDegPerSecond: number;
}

type PanoramaAutoRotateCallbacks = Pick<
  InteractionCallbacks,
  'getState' | 'getImageSize' | 'onViewChange'
>;

interface PanoramaAutoRotateDependencies extends InteractionDependencies {
  now?: () => number;
  getVisibilityState?: () => DocumentVisibilityState;
  prefersReducedMotion?: () => boolean;
  rampDurationMs?: number;
}

type PanoramaKeyboardOrbitCallbacks = Pick<
  InteractionCallbacks,
  'getState' | 'getViewport' | 'getImageSize' | 'onViewChange' | 'onHoverPixel' | 'isProbeEnabled'
> & {
  getLastPointerInElement: () => PointerPosition | null;
};

export function orbitPanoramaFromDrag(
  state: ViewerState,
  viewport: ViewportInfo,
  deltaX: number,
  deltaY: number
): PanoramaViewChange {
  return orbitPanorama(state, viewport, deltaX, deltaY);
}

export function zoomPanoramaFromWheel(
  state: ViewerState,
  deltaY: number
): PanoramaViewChange {
  return zoomPanorama(state, deltaY);
}

export function zoomPanoramaFromKeyboard(
  state: ViewerState,
  direction: ViewerKeyboardZoomDirection
): PanoramaViewChange {
  return zoomPanoramaByKeyboardStep(state, direction === 'in' ? 1 : -1);
}

export function zoomPanoramaByKeyboardStep(
  state: ViewerState,
  signedStep: number
): PanoramaViewChange {
  const zoomFactor = PANORAMA_KEYBOARD_ZOOM_STEP ** signedStep;
  return {
    panoramaYawDeg: state.panoramaYawDeg,
    panoramaPitchDeg: state.panoramaPitchDeg,
    panoramaHfovDeg: clampPanoramaHfov(state.panoramaHfovDeg / zoomFactor)
  };
}

export class PanoramaAutoRotateController {
  private readonly callbacks: PanoramaAutoRotateCallbacks;
  private readonly scheduleFrame: NonNullable<InteractionDependencies['scheduleFrame']>;
  private readonly cancelFrame: NonNullable<InteractionDependencies['cancelFrame']>;
  private readonly now: NonNullable<PanoramaAutoRotateDependencies['now']>;
  private readonly getVisibilityState: NonNullable<PanoramaAutoRotateDependencies['getVisibilityState']>;
  private readonly prefersReducedMotion: NonNullable<PanoramaAutoRotateDependencies['prefersReducedMotion']>;
  private readonly rampDurationMs: number;
  private config: PanoramaAutoRotateConfig = {
    autoRotate: false,
    rotationSpeedDegPerSecond: 0
  };
  private frameId: number | null = null;
  private lastFrameTime: number | null = null;
  private rampStartTime: number | null = null;
  private userInteracting = false;
  private disposed = false;

  constructor(
    callbacks: PanoramaAutoRotateCallbacks,
    dependencies: PanoramaAutoRotateDependencies = {}
  ) {
    this.callbacks = callbacks;
    this.scheduleFrame = dependencies.scheduleFrame ?? window.requestAnimationFrame.bind(window);
    this.cancelFrame = dependencies.cancelFrame ?? window.cancelAnimationFrame.bind(window);
    this.now = dependencies.now ?? defaultNow;
    this.getVisibilityState = dependencies.getVisibilityState ?? defaultVisibilityState;
    this.prefersReducedMotion = dependencies.prefersReducedMotion ?? defaultPrefersReducedMotion;
    this.rampDurationMs = dependencies.rampDurationMs ?? PANORAMA_AUTO_ROTATE_RAMP_DURATION_MS;
  }

  destroy(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.cancelScheduledFrame();
    this.lastFrameTime = null;
    this.rampStartTime = null;
  }

  setConfig(config: PanoramaAutoRotateConfig): void {
    this.config = {
      autoRotate: config.autoRotate,
      rotationSpeedDegPerSecond: Number.isFinite(config.rotationSpeedDegPerSecond)
        ? config.rotationSpeedDegPerSecond
        : 0
    };
    this.lastFrameTime = null;
    this.rampStartTime = null;
    this.sync();
  }

  setUserInteracting(interacting: boolean): void {
    if (this.disposed || this.userInteracting === interacting) {
      return;
    }

    this.userInteracting = interacting;
    this.lastFrameTime = null;
    if (interacting) {
      this.cancelScheduledFrame();
      this.rampStartTime = null;
      return;
    }

    this.pauseForUserInteraction();
  }

  pauseForUserInteraction(): void {
    if (this.disposed) {
      return;
    }

    this.lastFrameTime = null;
    this.rampStartTime = this.now();
    this.sync();
  }

  sync(): void {
    if (this.disposed) {
      return;
    }

    if (!this.canRun()) {
      this.cancelScheduledFrame();
      this.lastFrameTime = null;
      this.rampStartTime = null;
      return;
    }

    if (this.isPaused()) {
      this.cancelScheduledFrame();
      this.lastFrameTime = null;
      return;
    }

    this.ensureScheduledFrame();
  }

  private canRun(): boolean {
    const imageSize = this.callbacks.getImageSize();
    return (
      this.config.autoRotate &&
      this.config.rotationSpeedDegPerSecond !== 0 &&
      this.callbacks.getState().viewerMode === 'panorama' &&
      !!imageSize &&
      imageSize.width > 0 &&
      imageSize.height > 0 &&
      this.getVisibilityState() === 'visible' &&
      !this.prefersReducedMotion()
    );
  }

  private isPaused(): boolean {
    return this.userInteracting;
  }

  private ensureScheduledFrame(): void {
    if (this.frameId !== null) {
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
    if (!this.canRun() || this.isPaused()) {
      this.lastFrameTime = null;
      this.sync();
      return;
    }

    if (this.lastFrameTime !== null) {
      const elapsedMs = Math.min(
        PANORAMA_AUTO_ROTATE_MAX_FRAME_MS,
        Math.max(0, timestamp - this.lastFrameTime)
      );
      if (elapsedMs > 0) {
        const state = this.callbacks.getState();
        const speedFactor = this.getRampSpeedFactor(timestamp);
        const nextYawDeg = normalizePanoramaYaw(
          state.panoramaYawDeg +
          this.config.rotationSpeedDegPerSecond * speedFactor * (elapsedMs / 1000)
        );
        if (nextYawDeg !== state.panoramaYawDeg) {
          this.callbacks.onViewChange({ panoramaYawDeg: nextYawDeg });
        }
      }
    }

    this.lastFrameTime = timestamp;
    this.ensureScheduledFrame();
  };

  private getRampSpeedFactor(timestamp: number): number {
    if (this.rampStartTime === null) {
      return 1;
    }

    if (this.rampDurationMs <= 0) {
      this.rampStartTime = null;
      return 1;
    }

    const progress = Math.min(1, Math.max(0, (timestamp - this.rampStartTime) / this.rampDurationMs));
    if (progress >= 1) {
      this.rampStartTime = null;
      return 1;
    }

    return progress * progress * (3 - 2 * progress);
  }
}

export class PanoramaKeyboardOrbitController {
  private readonly callbacks: PanoramaKeyboardOrbitCallbacks;
  private readonly scheduleFrame: NonNullable<InteractionDependencies['scheduleFrame']>;
  private readonly cancelFrame: NonNullable<InteractionDependencies['cancelFrame']>;
  private input = createPanoramaKeyboardOrbitInput();
  private frameId: number | null = null;
  private lastFrameTime: number | null = null;

  constructor(
    callbacks: PanoramaKeyboardOrbitCallbacks,
    dependencies: InteractionDependencies = {}
  ) {
    this.callbacks = callbacks;
    this.scheduleFrame = dependencies.scheduleFrame ?? window.requestAnimationFrame.bind(window);
    this.cancelFrame = dependencies.cancelFrame ?? window.cancelAnimationFrame.bind(window);
  }

  destroy(): void {
    this.cancelScheduledFrame();
    this.input = createPanoramaKeyboardOrbitInput();
    this.lastFrameTime = null;
  }

  handle(direction: PanoramaKeyboardOrbitDirection): void {
    this.applyInput(createPanoramaKeyboardOrbitInput(direction), PANORAMA_KEYBOARD_ORBIT_STEP_RATIO);
  }

  setInput(input: PanoramaKeyboardOrbitInput): void {
    const previousInput = this.input;
    const nextInput = clonePanoramaKeyboardOrbitInput(input);
    if (samePanoramaKeyboardOrbitInput(previousInput, nextInput)) {
      if (hasPanoramaKeyboardOrbitInput(nextInput)) {
        this.ensureScheduledFrame();
      } else {
        this.cancelScheduledFrame();
        this.lastFrameTime = null;
      }
      return;
    }

    this.input = nextInput;
    const newlyPressedInput = getNewlyPressedPanoramaKeyboardOrbitInput(previousInput, nextInput);
    if (hasPanoramaKeyboardOrbitInput(newlyPressedInput)) {
      this.applyInput(newlyPressedInput, PANORAMA_KEYBOARD_ORBIT_STEP_RATIO);
    }

    if (hasPanoramaKeyboardOrbitInput(nextInput)) {
      if (!hasPanoramaKeyboardOrbitInput(previousInput)) {
        this.lastFrameTime = null;
      }
      this.ensureScheduledFrame();
      return;
    }

    this.cancelScheduledFrame();
    this.lastFrameTime = null;
  }

  private applyInput(input: PanoramaKeyboardOrbitInput, viewportStepRatio: number): void {
    const imageSize = this.callbacks.getImageSize();
    if (!imageSize) {
      return;
    }

    const state = this.callbacks.getState();
    if (state.viewerMode !== 'panorama') {
      return;
    }

    const viewport = this.callbacks.getViewport();
    if (viewport.width <= 0 || viewport.height <= 0) {
      return;
    }

    const { horizontalStep, verticalStep } = getPanoramaKeyboardOrbitStepSizes(
      state.panoramaHfovDeg,
      viewport,
      viewportStepRatio
    );
    const { deltaScreenX, deltaScreenY } = getPanoramaKeyboardOrbitDeltaForInput(
      input,
      horizontalStep,
      verticalStep
    );
    if (deltaScreenX === 0 && deltaScreenY === 0) {
      return;
    }

    const nextView = orbitPanorama(state, viewport, deltaScreenX, deltaScreenY);
    if (
      nextView.panoramaYawDeg === state.panoramaYawDeg &&
      nextView.panoramaPitchDeg === state.panoramaPitchDeg &&
      nextView.panoramaHfovDeg === state.panoramaHfovDeg
    ) {
      return;
    }

    const nextState = { ...state, ...nextView };
    this.callbacks.onViewChange(nextView);
    if (this.callbacks.isProbeEnabled?.() === false) {
      return;
    }
    this.callbacks.onHoverPixel(
      resolveHoverPixel(this.callbacks.getLastPointerInElement(), nextState, viewport, imageSize)
    );
  }

  private ensureScheduledFrame(): void {
    if (this.frameId !== null || !hasPanoramaKeyboardOrbitInput(this.input)) {
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
    if (!hasPanoramaKeyboardOrbitInput(this.input)) {
      this.lastFrameTime = null;
      return;
    }

    if (this.lastFrameTime !== null) {
      const elapsedMs = Math.min(
        PANORAMA_KEYBOARD_ORBIT_MAX_FRAME_MS,
        Math.max(0, timestamp - this.lastFrameTime)
      );
      if (elapsedMs > 0) {
        this.applyInput(
          this.input,
          PANORAMA_KEYBOARD_ORBIT_SPEED_PER_SECOND * (elapsedMs / 1000)
        );
      }
    }

    this.lastFrameTime = timestamp;
    this.ensureScheduledFrame();
  };
}

function defaultNow(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function defaultVisibilityState(): DocumentVisibilityState {
  return typeof document === 'undefined' ? 'visible' : document.visibilityState;
}

function defaultPrefersReducedMotion(): boolean {
  return typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function getPanoramaKeyboardOrbitDeltaForInput(
  input: PanoramaKeyboardOrbitInput,
  horizontalStep: number,
  verticalStep: number
): { deltaScreenX: number; deltaScreenY: number } {
  const horizontalDirection = (input.left ? 1 : 0) - (input.right ? 1 : 0);
  const verticalDirection = (input.down ? 1 : 0) - (input.up ? 1 : 0);

  return {
    deltaScreenX: horizontalStep * horizontalDirection,
    deltaScreenY: verticalStep * verticalDirection
  };
}

function getPanoramaKeyboardOrbitStepSizes(
  horizontalFovDeg: number,
  viewport: ViewportInfo,
  viewportStepRatio: number
): { horizontalStep: number; verticalStep: number } {
  const verticalFovDeg = getPanoramaVerticalFovDeg(horizontalFovDeg, viewport);
  const projectionDiameter = getPanoramaProjectionDiameter(viewport, horizontalFovDeg);
  return {
    horizontalStep: horizontalFovDeg === 0
      ? 0
      : projectionDiameter * viewportStepRatio * (verticalFovDeg / horizontalFovDeg),
    verticalStep: viewport.height * viewportStepRatio
  };
}

function createPanoramaKeyboardOrbitInput(
  direction: PanoramaKeyboardOrbitDirection | null = null
): PanoramaKeyboardOrbitInput {
  return {
    up: direction === 'up',
    left: direction === 'left',
    down: direction === 'down',
    right: direction === 'right'
  };
}

function clonePanoramaKeyboardOrbitInput(
  input: PanoramaKeyboardOrbitInput
): PanoramaKeyboardOrbitInput {
  return {
    up: input.up,
    left: input.left,
    down: input.down,
    right: input.right
  };
}

function getNewlyPressedPanoramaKeyboardOrbitInput(
  previousInput: PanoramaKeyboardOrbitInput,
  nextInput: PanoramaKeyboardOrbitInput
): PanoramaKeyboardOrbitInput {
  return {
    up: nextInput.up && !previousInput.up,
    left: nextInput.left && !previousInput.left,
    down: nextInput.down && !previousInput.down,
    right: nextInput.right && !previousInput.right
  };
}

function hasPanoramaKeyboardOrbitInput(input: PanoramaKeyboardOrbitInput): boolean {
  return input.up || input.left || input.down || input.right;
}

function samePanoramaKeyboardOrbitInput(
  a: PanoramaKeyboardOrbitInput,
  b: PanoramaKeyboardOrbitInput
): boolean {
  return a.up === b.up && a.left === b.left && a.down === b.down && a.right === b.right;
}
