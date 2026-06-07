import {
  clampDepthZoom,
  isXyzPositionDepthSourceValue,
  normalizeDepthTarget,
  normalizeDepthPitchForSource,
  normalizeDepthYawForSource
} from '../depth';
import type {
  ThreeDKeyboardOrbitDirection,
  ThreeDKeyboardOrbitInput,
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

const THREE_D_KEYBOARD_ORBIT_STEP_RATIO = 0.05;
const THREE_D_KEYBOARD_ORBIT_SPEED_PER_SECOND = 1.5;
const THREE_D_KEYBOARD_ORBIT_MAX_FRAME_MS = 50;
const THREE_D_KEYBOARD_ZOOM_STEP = 1.25;
const THREE_D_AUTO_ORBIT_MAX_FRAME_MS = 50;
const THREE_D_AUTO_ORBIT_RESUME_DELAY_MS = 0;
const THREE_D_AUTO_ORBIT_RAMP_DURATION_MS = 1200;
const THREE_D_AUTO_ORBIT_INITIAL_PHASE_RAD = -Math.PI / 2;
const THREE_D_FRONT_SAFE_YAW_DEG = 45;
const THREE_D_FRONT_SAFE_PITCH_DEG = 15;
const THREE_D_ORBIT_CENTER_DEADBAND_DEG = 1.0e-6;

type DepthViewChange = Pick<
  ViewerState,
  'depthYawDeg' | 'depthPitchDeg' | 'depthZoom' | 'depthTargetX' | 'depthTargetY' | 'depthTargetZ'
>;

export interface ThreeDAutoOrbitConfig {
  autoOrbit: boolean;
  orbitSpeedDegPerSecond: number;
  orbitYawAmplitudeDeg: number;
  orbitPitchAmplitudeDeg: number;
}

type ThreeDAutoOrbitCallbacks = Pick<
  InteractionCallbacks,
  'getState' | 'getViewport' | 'getImageSize' | 'onViewChange'
>;

interface ThreeDAutoOrbitDependencies extends InteractionDependencies {
  now?: () => number;
  getVisibilityState?: () => DocumentVisibilityState;
  prefersReducedMotion?: () => boolean;
  resumeDelayMs?: number;
  rampDurationMs?: number;
  scheduleTimeout?: (callback: () => void, delayMs: number) => number;
  cancelTimeout?: (id: number) => void;
}

interface ThreeDAutoOrbitPath {
  depthSource: string | null;
  centerYawDeg: number;
  centerPitchDeg: number;
  yawAmplitudeDeg: number;
  pitchAmplitudeDeg: number;
  yawOffsetDeg: number;
  pitchOffsetDeg: number;
}

interface ThreeDAutoOrbitAmplitudes {
  yawDeg: number;
  pitchDeg: number;
}

interface ThreeDAutoOrbitPoint {
  yawDeg: number;
  pitchDeg: number;
}

type ThreeDKeyboardOrbitCallbacks = Pick<
  InteractionCallbacks,
  | 'getState'
  | 'getViewport'
  | 'getImageSize'
  | 'resolveDepthProbePixel'
  | 'onViewChange'
  | 'onHoverPixel'
  | 'isProbeEnabled'
> & {
  getLastPointerInElement: () => PointerPosition | null;
};

export function orbitThreeDFromDrag(
  state: ViewerState,
  viewport: ViewportInfo,
  deltaX: number,
  deltaY: number
): DepthViewChange {
  const depthSource = state.depthChannel;
  if (viewport.width <= 0 || viewport.height <= 0) {
    return normalizeDepthViewChange(state);
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
    depthZoom: clampDepthZoom(state.depthZoom),
    depthTargetX: normalizeDepthTarget(state.depthTargetX),
    depthTargetY: normalizeDepthTarget(state.depthTargetY),
    depthTargetZ: normalizeDepthTarget(state.depthTargetZ)
  };
}

export function panThreeDFromDrag(
  state: ViewerState,
  viewport: ViewportInfo,
  deltaX: number,
  deltaY: number
): DepthViewChange {
  const current = normalizeDepthViewChange(state);
  if (viewport.width <= 0 || viewport.height <= 0) {
    return current;
  }

  const zoom = clampDepthZoom(state.depthZoom);
  const aspect = Math.max(viewport.width / Math.max(viewport.height, 1), 1.0e-6);
  const screenScaleX = viewport.width * zoom / aspect;
  const screenScaleY = viewport.height * zoom;
  if (screenScaleX <= 0 || screenScaleY <= 0) {
    return current;
  }

  const worldDelta = inverseRotateDepthCameraVector(
    {
      x: -deltaX / screenScaleX,
      y: deltaY / screenScaleY,
      z: 0
    },
    state
  );

  return {
    ...current,
    depthTargetX: current.depthTargetX + worldDelta.x,
    depthTargetY: current.depthTargetY + worldDelta.y,
    depthTargetZ: current.depthTargetZ + worldDelta.z
  };
}

export function zoomThreeDFromWheel(
  state: ViewerState,
  deltaY: number
): DepthViewChange {
  const zoomFactor = Math.exp(-deltaY * 0.0015);
  return {
    depthYawDeg: normalizeDepthYawForSource(state.depthYawDeg, state.depthChannel),
    depthPitchDeg: normalizeDepthPitchForSource(state.depthPitchDeg, state.depthChannel),
    depthZoom: clampDepthZoom(state.depthZoom * zoomFactor),
    depthTargetX: normalizeDepthTarget(state.depthTargetX),
    depthTargetY: normalizeDepthTarget(state.depthTargetY),
    depthTargetZ: normalizeDepthTarget(state.depthTargetZ)
  };
}

export function zoomThreeDFromKeyboard(
  state: ViewerState,
  direction: ViewerKeyboardZoomDirection
): DepthViewChange {
  return zoomThreeDByKeyboardStep(state, direction === 'in' ? 1 : -1);
}

export function zoomThreeDByKeyboardStep(
  state: ViewerState,
  signedStep: number
): DepthViewChange {
  return {
    depthYawDeg: normalizeDepthYawForSource(state.depthYawDeg, state.depthChannel),
    depthPitchDeg: normalizeDepthPitchForSource(state.depthPitchDeg, state.depthChannel),
    depthZoom: clampDepthZoom(state.depthZoom * (THREE_D_KEYBOARD_ZOOM_STEP ** signedStep)),
    depthTargetX: normalizeDepthTarget(state.depthTargetX),
    depthTargetY: normalizeDepthTarget(state.depthTargetY),
    depthTargetZ: normalizeDepthTarget(state.depthTargetZ)
  };
}

export class ThreeDAutoOrbitController {
  private readonly callbacks: ThreeDAutoOrbitCallbacks;
  private readonly scheduleFrame: NonNullable<InteractionDependencies['scheduleFrame']>;
  private readonly cancelFrame: NonNullable<InteractionDependencies['cancelFrame']>;
  private readonly now: NonNullable<ThreeDAutoOrbitDependencies['now']>;
  private readonly getVisibilityState: NonNullable<ThreeDAutoOrbitDependencies['getVisibilityState']>;
  private readonly prefersReducedMotion: NonNullable<ThreeDAutoOrbitDependencies['prefersReducedMotion']>;
  private readonly scheduleTimeout: NonNullable<ThreeDAutoOrbitDependencies['scheduleTimeout']>;
  private readonly cancelTimeout: NonNullable<ThreeDAutoOrbitDependencies['cancelTimeout']>;
  private readonly resumeDelayMs: number;
  private readonly rampDurationMs: number;
  private config: ThreeDAutoOrbitConfig = {
    autoOrbit: false,
    orbitSpeedDegPerSecond: 0,
    orbitYawAmplitudeDeg: 0,
    orbitPitchAmplitudeDeg: 0
  };
  private frameId: number | null = null;
  private resumeTimeoutId: number | null = null;
  private lastFrameTime: number | null = null;
  private rampStartTime: number | null = null;
  private orbitPath: ThreeDAutoOrbitPath | null = null;
  private phaseRad = THREE_D_AUTO_ORBIT_INITIAL_PHASE_RAD;
  private userInteracting = false;
  private disposed = false;

  constructor(
    callbacks: ThreeDAutoOrbitCallbacks,
    dependencies: ThreeDAutoOrbitDependencies = {}
  ) {
    this.callbacks = callbacks;
    this.scheduleFrame = dependencies.scheduleFrame ?? window.requestAnimationFrame.bind(window);
    this.cancelFrame = dependencies.cancelFrame ?? window.cancelAnimationFrame.bind(window);
    this.now = dependencies.now ?? defaultNow;
    this.getVisibilityState = dependencies.getVisibilityState ?? defaultVisibilityState;
    this.prefersReducedMotion = dependencies.prefersReducedMotion ?? defaultPrefersReducedMotion;
    this.scheduleTimeout = dependencies.scheduleTimeout ?? defaultScheduleTimeout;
    this.cancelTimeout = dependencies.cancelTimeout ?? defaultCancelTimeout;
    this.resumeDelayMs = dependencies.resumeDelayMs ?? THREE_D_AUTO_ORBIT_RESUME_DELAY_MS;
    this.rampDurationMs = dependencies.rampDurationMs ?? THREE_D_AUTO_ORBIT_RAMP_DURATION_MS;
  }

  destroy(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.cancelScheduledFrame();
    this.cancelResumeTimeout();
    this.lastFrameTime = null;
    this.rampStartTime = null;
    this.orbitPath = null;
  }

  setConfig(config: ThreeDAutoOrbitConfig): void {
    this.config = {
      autoOrbit: config.autoOrbit,
      orbitSpeedDegPerSecond: Number.isFinite(config.orbitSpeedDegPerSecond)
        ? Math.max(0, config.orbitSpeedDegPerSecond)
        : 0,
      orbitYawAmplitudeDeg: Number.isFinite(config.orbitYawAmplitudeDeg)
        ? Math.max(0, config.orbitYawAmplitudeDeg)
        : 0,
      orbitPitchAmplitudeDeg: Number.isFinite(config.orbitPitchAmplitudeDeg)
        ? Math.max(0, config.orbitPitchAmplitudeDeg)
        : 0
    };
    this.resetOrbit();
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
      this.cancelResumeTimeout();
      this.resetOrbit();
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
    this.resetOrbit();
    this.rampStartTime = null;
    this.cancelScheduledFrame();
    this.cancelResumeTimeout();
    if (!this.canRun()) {
      return;
    }

    const resumeDelayMs = Math.max(0, this.resumeDelayMs);
    if (resumeDelayMs > 0) {
      this.resumeTimeoutId = this.scheduleTimeout(() => {
        this.resumeTimeoutId = null;
        this.rampStartTime = this.now();
        this.sync();
      }, resumeDelayMs);
      return;
    }

    this.rampStartTime = this.now();
    this.sync();
  }

  sync(): void {
    if (this.disposed) {
      return;
    }

    if (!this.canRun()) {
      this.cancelScheduledFrame();
      this.cancelResumeTimeout();
      this.lastFrameTime = null;
      this.rampStartTime = null;
      this.resetOrbit();
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
    if (
      !this.config.autoOrbit ||
      this.config.orbitSpeedDegPerSecond <= 0 ||
      this.getVisibilityState() !== 'visible' ||
      this.prefersReducedMotion()
    ) {
      return false;
    }

    const state = this.callbacks.getState();
    const imageSize = this.callbacks.getImageSize();
    const viewport = this.callbacks.getViewport();
    if (
      state.viewerMode !== '3d' ||
      !state.depthChannel ||
      !imageSize ||
      imageSize.width <= 0 ||
      imageSize.height <= 0 ||
      viewport.width <= 0 ||
      viewport.height <= 0
    ) {
      return false;
    }

    const amplitudes = this.resolveConfiguredAmplitudes();
    return amplitudes.yawDeg > 0 || amplitudes.pitchDeg > 0;
  }

  private isPaused(): boolean {
    return this.userInteracting || this.resumeTimeoutId !== null;
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

  private cancelResumeTimeout(): void {
    if (this.resumeTimeoutId === null) {
      return;
    }

    this.cancelTimeout(this.resumeTimeoutId);
    this.resumeTimeoutId = null;
  }

  private readonly onFrame = (timestamp: number): void => {
    this.frameId = null;
    if (!this.canRun() || this.isPaused()) {
      this.lastFrameTime = null;
      this.sync();
      return;
    }

    const state = this.callbacks.getState();
    if (!this.orbitPath || this.orbitPath.depthSource !== state.depthChannel) {
      this.orbitPath = this.createOrbitPath(state);
      if (this.rampStartTime === null) {
        this.rampStartTime = timestamp;
      }
    }

    const orbitPath = this.orbitPath;
    const rampFactor = this.getRampFactor(timestamp);
    if (this.lastFrameTime !== null) {
      const elapsedMs = Math.min(
        THREE_D_AUTO_ORBIT_MAX_FRAME_MS,
        Math.max(0, timestamp - this.lastFrameTime)
      );
      if (elapsedMs > 0) {
        this.phaseRad += this.resolvePhaseRateRadPerSecond(orbitPath) * rampFactor * (elapsedMs / 1000);
      }
    }

    const orbitPoint = resolveOrbitPoint(orbitPath, this.phaseRad);
    const offsetFactor = 1 - rampFactor;
    const nextYawDeg = normalizeDepthYawForSource(
      orbitPoint.yawDeg + orbitPath.yawOffsetDeg * offsetFactor,
      orbitPath.depthSource
    );
    const nextPitchDeg = normalizeDepthPitchForSource(
      orbitPoint.pitchDeg + orbitPath.pitchOffsetDeg * offsetFactor,
      orbitPath.depthSource
    );
    if (nextYawDeg !== state.depthYawDeg || nextPitchDeg !== state.depthPitchDeg) {
      this.callbacks.onViewChange({
        depthYawDeg: nextYawDeg,
        depthPitchDeg: nextPitchDeg
      });
    }

    this.lastFrameTime = timestamp;
    this.ensureScheduledFrame();
  };

  private createOrbitPath(state: ViewerState): ThreeDAutoOrbitPath {
    const depthSource = state.depthChannel;
    const startYawDeg = normalizeDepthYawForSource(state.depthYawDeg, depthSource);
    const startPitchDeg = normalizeDepthPitchForSource(state.depthPitchDeg, depthSource);
    const amplitudes = this.resolveConfiguredAmplitudes();
    const centerYawDeg = clampOrbitCenter(
      startYawDeg,
      amplitudes.yawDeg,
      THREE_D_FRONT_SAFE_YAW_DEG
    );
    const centerPitchDeg = clampOrbitCenter(
      startPitchDeg,
      amplitudes.pitchDeg,
      THREE_D_FRONT_SAFE_PITCH_DEG
    );
    this.phaseRad = resolveInitialOrbitPhase(
      startYawDeg,
      startPitchDeg,
      centerYawDeg,
      centerPitchDeg,
      amplitudes
    );
    const orbitPoint = resolveOrbitPoint({
      centerYawDeg,
      centerPitchDeg,
      yawAmplitudeDeg: amplitudes.yawDeg,
      pitchAmplitudeDeg: amplitudes.pitchDeg
    }, this.phaseRad);
    return {
      depthSource,
      centerYawDeg,
      centerPitchDeg,
      yawAmplitudeDeg: amplitudes.yawDeg,
      pitchAmplitudeDeg: amplitudes.pitchDeg,
      yawOffsetDeg: resolveAngularOffset(startYawDeg, orbitPoint.yawDeg, depthSource, 'yaw'),
      pitchOffsetDeg: resolveAngularOffset(startPitchDeg, orbitPoint.pitchDeg, depthSource, 'pitch')
    };
  }

  private resolveConfiguredAmplitudes(): ThreeDAutoOrbitAmplitudes {
    return {
      yawDeg: Math.min(this.config.orbitYawAmplitudeDeg, THREE_D_FRONT_SAFE_YAW_DEG),
      pitchDeg: Math.min(this.config.orbitPitchAmplitudeDeg, THREE_D_FRONT_SAFE_PITCH_DEG)
    };
  }

  private resolvePhaseRateRadPerSecond(orbitPath: ThreeDAutoOrbitPath): number {
    const primaryAmplitude = orbitPath.yawAmplitudeDeg > 0
      ? orbitPath.yawAmplitudeDeg
      : orbitPath.pitchAmplitudeDeg;
    return primaryAmplitude > 0 ? this.config.orbitSpeedDegPerSecond / primaryAmplitude : 0;
  }

  private getRampFactor(timestamp: number): number {
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

  private resetOrbit(): void {
    this.orbitPath = null;
    this.phaseRad = THREE_D_AUTO_ORBIT_INITIAL_PHASE_RAD;
  }
}

export class ThreeDKeyboardOrbitController {
  private readonly callbacks: ThreeDKeyboardOrbitCallbacks;
  private readonly scheduleFrame: NonNullable<InteractionDependencies['scheduleFrame']>;
  private readonly cancelFrame: NonNullable<InteractionDependencies['cancelFrame']>;
  private input = createThreeDKeyboardOrbitInput();
  private frameId: number | null = null;
  private lastFrameTime: number | null = null;

  constructor(
    callbacks: ThreeDKeyboardOrbitCallbacks,
    dependencies: InteractionDependencies = {}
  ) {
    this.callbacks = callbacks;
    this.scheduleFrame = dependencies.scheduleFrame ?? window.requestAnimationFrame.bind(window);
    this.cancelFrame = dependencies.cancelFrame ?? window.cancelAnimationFrame.bind(window);
  }

  destroy(): void {
    this.cancelScheduledFrame();
    this.input = createThreeDKeyboardOrbitInput();
    this.lastFrameTime = null;
  }

  handle(direction: ThreeDKeyboardOrbitDirection): void {
    this.applyInput(createThreeDKeyboardOrbitInput(direction), THREE_D_KEYBOARD_ORBIT_STEP_RATIO);
  }

  setInput(input: ThreeDKeyboardOrbitInput): void {
    const previousInput = this.input;
    const nextInput = cloneThreeDKeyboardOrbitInput(input);
    if (sameThreeDKeyboardOrbitInput(previousInput, nextInput)) {
      if (hasThreeDKeyboardOrbitInput(nextInput)) {
        this.ensureScheduledFrame();
      } else {
        this.cancelScheduledFrame();
        this.lastFrameTime = null;
      }
      return;
    }

    this.input = nextInput;
    const newlyPressedInput = getNewlyPressedThreeDKeyboardOrbitInput(previousInput, nextInput);
    if (hasThreeDKeyboardOrbitInput(newlyPressedInput)) {
      this.applyInput(newlyPressedInput, THREE_D_KEYBOARD_ORBIT_STEP_RATIO);
    }

    if (hasThreeDKeyboardOrbitInput(nextInput)) {
      if (!hasThreeDKeyboardOrbitInput(previousInput)) {
        this.lastFrameTime = null;
      }
      this.ensureScheduledFrame();
      return;
    }

    this.cancelScheduledFrame();
    this.lastFrameTime = null;
  }

  private applyInput(input: ThreeDKeyboardOrbitInput, viewportStepRatio: number): void {
    const imageSize = this.callbacks.getImageSize();
    if (!imageSize) {
      return;
    }

    const state = this.callbacks.getState();
    if (state.viewerMode !== '3d') {
      return;
    }

    const viewport = this.callbacks.getViewport();
    if (viewport.width <= 0 || viewport.height <= 0) {
      return;
    }

    const horizontalDirection = (input.left ? 1 : 0) - (input.right ? 1 : 0);
    const verticalDirection = (input.down ? 1 : 0) - (input.up ? 1 : 0);
    const nextView = orbitThreeDFromDrag(
      state,
      viewport,
      viewport.width * viewportStepRatio * horizontalDirection,
      viewport.height * viewportStepRatio * verticalDirection
    );
    if (
      nextView.depthYawDeg === state.depthYawDeg &&
      nextView.depthPitchDeg === state.depthPitchDeg &&
      nextView.depthZoom === state.depthZoom &&
      nextView.depthTargetX === state.depthTargetX &&
      nextView.depthTargetY === state.depthTargetY &&
      nextView.depthTargetZ === state.depthTargetZ
    ) {
      return;
    }

    const nextState = { ...state, ...nextView };
    this.callbacks.onViewChange(nextView);
    if (this.callbacks.isProbeEnabled?.() === false) {
      return;
    }
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
    if (this.frameId !== null || !hasThreeDKeyboardOrbitInput(this.input)) {
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
    if (!hasThreeDKeyboardOrbitInput(this.input)) {
      this.lastFrameTime = null;
      return;
    }

    if (this.lastFrameTime !== null) {
      const elapsedMs = Math.min(
        THREE_D_KEYBOARD_ORBIT_MAX_FRAME_MS,
        Math.max(0, timestamp - this.lastFrameTime)
      );
      if (elapsedMs > 0) {
        this.applyInput(
          this.input,
          THREE_D_KEYBOARD_ORBIT_SPEED_PER_SECOND * (elapsedMs / 1000)
        );
      }
    }

    this.lastFrameTime = timestamp;
    this.ensureScheduledFrame();
  };
}

function normalizeDepthViewChange(state: ViewerState): DepthViewChange {
  return {
    depthYawDeg: normalizeDepthYawForSource(state.depthYawDeg, state.depthChannel),
    depthPitchDeg: normalizeDepthPitchForSource(state.depthPitchDeg, state.depthChannel),
    depthZoom: clampDepthZoom(state.depthZoom),
    depthTargetX: normalizeDepthTarget(state.depthTargetX),
    depthTargetY: normalizeDepthTarget(state.depthTargetY),
    depthTargetZ: normalizeDepthTarget(state.depthTargetZ)
  };
}

function inverseRotateDepthCameraVector(
  vector: { x: number; y: number; z: number },
  state: ViewerState
): { x: number; y: number; z: number } {
  const yawRad = -normalizeDepthYawForSource(state.depthYawDeg, state.depthChannel) * Math.PI / 180;
  const pitchRad = -normalizeDepthPitchForSource(state.depthPitchDeg, state.depthChannel) * Math.PI / 180;
  return rotateYaw(rotatePitch(vector, -pitchRad), -yawRad);
}

function rotateYaw(
  vector: { x: number; y: number; z: number },
  angleRad: number
): { x: number; y: number; z: number } {
  const c = Math.cos(angleRad);
  const s = Math.sin(angleRad);
  return {
    x: c * vector.x + s * vector.z,
    y: vector.y,
    z: -s * vector.x + c * vector.z
  };
}

function rotatePitch(
  vector: { x: number; y: number; z: number },
  angleRad: number
): { x: number; y: number; z: number } {
  const c = Math.cos(angleRad);
  const s = Math.sin(angleRad);
  return {
    x: vector.x,
    y: c * vector.y - s * vector.z,
    z: s * vector.y + c * vector.z
  };
}

function createThreeDKeyboardOrbitInput(
  direction: ThreeDKeyboardOrbitDirection | null = null
): ThreeDKeyboardOrbitInput {
  return {
    up: direction === 'up',
    left: direction === 'left',
    down: direction === 'down',
    right: direction === 'right'
  };
}

function cloneThreeDKeyboardOrbitInput(input: ThreeDKeyboardOrbitInput): ThreeDKeyboardOrbitInput {
  return {
    up: input.up,
    left: input.left,
    down: input.down,
    right: input.right
  };
}

function getNewlyPressedThreeDKeyboardOrbitInput(
  previousInput: ThreeDKeyboardOrbitInput,
  nextInput: ThreeDKeyboardOrbitInput
): ThreeDKeyboardOrbitInput {
  return {
    up: nextInput.up && !previousInput.up,
    left: nextInput.left && !previousInput.left,
    down: nextInput.down && !previousInput.down,
    right: nextInput.right && !previousInput.right
  };
}

function hasThreeDKeyboardOrbitInput(input: ThreeDKeyboardOrbitInput): boolean {
  return input.up || input.left || input.down || input.right;
}

function sameThreeDKeyboardOrbitInput(
  a: ThreeDKeyboardOrbitInput,
  b: ThreeDKeyboardOrbitInput
): boolean {
  return a.up === b.up && a.left === b.left && a.down === b.down && a.right === b.right;
}

function isFreeThreeDRotationSource(depthSource: string | null): boolean {
  return depthSource === 'xyzPosition' || isXyzPositionDepthSourceValue(depthSource);
}

function resolveOrbitPoint(
  orbitPath: Pick<
    ThreeDAutoOrbitPath,
    'centerYawDeg' | 'centerPitchDeg' | 'yawAmplitudeDeg' | 'pitchAmplitudeDeg'
  >,
  phaseRad: number
): ThreeDAutoOrbitPoint {
  return {
    yawDeg: orbitPath.centerYawDeg + Math.sin(phaseRad) * orbitPath.yawAmplitudeDeg,
    pitchDeg: orbitPath.centerPitchDeg + Math.cos(phaseRad) * orbitPath.pitchAmplitudeDeg
  };
}

function resolveInitialOrbitPhase(
  startYawDeg: number,
  startPitchDeg: number,
  centerYawDeg: number,
  centerPitchDeg: number,
  amplitudes: ThreeDAutoOrbitAmplitudes
): number {
  if (amplitudes.yawDeg > 0) {
    return phaseForSinValue(
      clampUnit((startYawDeg - centerYawDeg) / amplitudes.yawDeg),
      resolvePreferredOrbitVelocity(startYawDeg)
    );
  }

  if (amplitudes.pitchDeg > 0) {
    return phaseForCosValue(
      clampUnit((startPitchDeg - centerPitchDeg) / amplitudes.pitchDeg),
      resolvePreferredOrbitVelocity(startPitchDeg)
    );
  }

  return THREE_D_AUTO_ORBIT_INITIAL_PHASE_RAD;
}

function resolvePreferredOrbitVelocity(valueDeg: number): number {
  if (valueDeg > THREE_D_ORBIT_CENTER_DEADBAND_DEG) {
    return -1;
  }
  if (valueDeg < -THREE_D_ORBIT_CENTER_DEADBAND_DEG) {
    return 1;
  }
  return -1;
}

function phaseForSinValue(sinValue: number, desiredVelocitySign: number): number {
  const basePhase = Math.asin(sinValue);
  return desiredVelocitySign >= 0 ? basePhase : Math.PI - basePhase;
}

function phaseForCosValue(cosValue: number, desiredVelocitySign: number): number {
  const basePhase = Math.acos(cosValue);
  return desiredVelocitySign >= 0 ? -basePhase : basePhase;
}

function clampOrbitCenter(
  startDeg: number,
  amplitudeDeg: number,
  safeLimitDeg: number
): number {
  if (!Number.isFinite(startDeg)) {
    return 0;
  }

  const lower = -safeLimitDeg + amplitudeDeg;
  const upper = safeLimitDeg - amplitudeDeg;
  return lower <= upper ? clampNumber(startDeg, lower, upper) : 0;
}

function resolveAngularOffset(
  startDeg: number,
  orbitDeg: number,
  depthSource: string | null,
  axis: 'yaw' | 'pitch'
): number {
  const offset = startDeg - orbitDeg;
  if (!isFreeThreeDRotationSource(depthSource)) {
    return offset;
  }

  return axis === 'yaw'
    ? normalizeDepthYawForSource(offset, depthSource)
    : normalizeDepthPitchForSource(offset, depthSource);
}

function clampUnit(value: number): number {
  return clampNumber(value, -1, 1);
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.min(max, Math.max(min, value));
}

function defaultNow(): number {
  return performance.now();
}

function defaultVisibilityState(): DocumentVisibilityState {
  return document.visibilityState;
}

function defaultPrefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

function defaultScheduleTimeout(callback: () => void, delayMs: number): number {
  return window.setTimeout(callback, delayMs);
}

function defaultCancelTimeout(id: number): void {
  window.clearTimeout(id);
}
