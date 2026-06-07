import type {
  ImagePixel,
  PanoramaKeyboardOrbitDirection,
  PanoramaKeyboardOrbitInput,
  RoiAdjustmentHandle,
  ViewerKeyboardNavigationDirection,
  ViewerKeyboardNavigationInput,
  ViewerKeyboardZoomDirection,
  ViewerKeyboardZoomInput,
  ViewerRoiInteractionState,
  ViewportInfo,
  ViewportRect,
  ViewerState
} from '../types';
import { clampDepthZoom } from '../depth';
import {
  samePanePath,
  type ViewerPanePath,
  type ViewerPaneRenderInfo
} from '../viewer-pane-layout';
import { imageToScreen, zoomAroundPoint } from './image-geometry';
import {
  ThreeDAutoOrbitController,
  ThreeDKeyboardOrbitController,
  orbitThreeDFromDrag,
  panThreeDFromDrag,
  type ThreeDAutoOrbitConfig,
  zoomThreeDByKeyboardStep,
  zoomThreeDFromKeyboard,
  zoomThreeDFromWheel
} from './three-d-mode';
import {
  ImageKeyboardPanController,
  panImageFromDrag,
  zoomImageByKeyboardStep,
  zoomImageFromKeyboard,
  zoomImageFromWheel
} from './image-mode';
import {
  PanoramaAutoRotateController,
  orbitPanoramaFromDrag,
  PanoramaKeyboardOrbitController,
  type PanoramaAutoRotateConfig,
  zoomPanoramaByKeyboardStep,
  zoomPanoramaFromKeyboard,
  zoomPanoramaFromWheel
} from './panorama-mode';
import { clampPanoramaHfov, getPanoramaProjectionDiameter } from './panorama-geometry';
import { resolveHoverPixel, resolveProbePixel } from './probe-mode';
import {
  commitRoiFromDrag,
  createRoiAdjustmentDrag,
  createDraftRoiFromAnchor,
  createRoiInteractionState,
  resolveRoiAnchorPixel,
  resolveRoiAdjustmentHandle,
  type RoiAdjustmentDrag,
  updateRoiFromAdjustmentDrag,
  updateDraftRoiFromDrag
} from './roi-mode';
import {
  createEmptySnapGuide,
  resolveScreenshotSelectionHandle,
  updateScreenshotSelectionRectFromDrag,
  type ScreenshotSelectionDrag,
  type ScreenshotSelectionEdgeSnapTargets,
  type ScreenshotSelectionHandle
} from './screenshot-selection';
import type {
  InteractionCallbacks,
  InteractionDependencies,
  ImageSize,
  PointerPosition,
  ScreenshotSelectionInteractionState
} from './shared';

export type { InteractionCallbacks, InteractionDependencies } from './shared';

type DragMode = 'pan' | 'depth-pan' | 'roi' | 'roi-adjust' | 'screenshot' | null;
type PanePoint = {
  pane: ViewerPaneRenderInfo;
  point: PointerPosition;
  inside: boolean;
};
interface ActiveTouchPointer {
  pointerId: number;
  elementPoint: PointerPosition;
  pane: ViewerPaneRenderInfo;
}

interface TouchGestureState {
  pointerIds: [number, number];
  pane: ViewerPaneRenderInfo;
  previousMidpoint: PointerPosition;
  previousDistance: number;
}

const KEYBOARD_ZOOM_SPEED_STEPS_PER_SECOND = 3;
const KEYBOARD_ZOOM_MAX_FRAME_MS = 50;

export class ViewerInteraction {
  private readonly element: HTMLElement;
  private readonly callbacks: InteractionCallbacks;
  private readonly imageKeyboardPan: ImageKeyboardPanController;
  private readonly panoramaKeyboardOrbit: PanoramaKeyboardOrbitController;
  private readonly panoramaAutoRotate: PanoramaAutoRotateController;
  private readonly threeDAutoOrbit: ThreeDAutoOrbitController;
  private readonly threeDKeyboardOrbit: ThreeDKeyboardOrbitController;
  private readonly keyboardZoom: ViewerKeyboardZoomController;
  private dragging = false;
  private movedDuringDrag = false;
  private dragPointerId: number | null = null;
  private dragMode: DragMode = null;
  private previousPointer: PointerPosition | null = null;
  private lastPointerInElement: PointerPosition | null = null;
  private lastRequestedActivePanePath: ViewerPanePath | null = null;
  private dragPane: ViewerPaneRenderInfo | null = null;
  private pendingDepthDragProbeState: ViewerState | null = null;
  private roiAnchorPixel: ImagePixel | null = null;
  private roiAdjustmentDrag: RoiAdjustmentDrag | null = null;
  private screenshotDrag: ScreenshotSelectionDrag | null = null;
  private touchPointers = new Map<number, ActiveTouchPointer>();
  private touchGesture: TouchGestureState | null = null;

  constructor(
    element: HTMLElement,
    callbacks: InteractionCallbacks,
    dependencies: InteractionDependencies = {}
  ) {
    this.element = element;
    this.callbacks = callbacks;
    this.imageKeyboardPan = new ImageKeyboardPanController({
      getState: callbacks.getState,
      getViewport: () => this.getActiveViewport(),
      getImageSize: callbacks.getImageSize,
      onViewChange: callbacks.onViewChange,
      onHoverPixel: this.emitHoverPixel,
      isProbeEnabled: () => this.isProbeEnabled(),
      getLastPointerInElement: () => this.lastPointerInElement
    }, dependencies);
    this.panoramaKeyboardOrbit = new PanoramaKeyboardOrbitController({
      getState: callbacks.getState,
      getViewport: () => this.getActiveViewport(),
      getImageSize: callbacks.getImageSize,
      onViewChange: callbacks.onViewChange,
      onHoverPixel: this.emitHoverPixel,
      isProbeEnabled: () => this.isProbeEnabled(),
      getLastPointerInElement: () => this.lastPointerInElement
    }, dependencies);
    this.panoramaAutoRotate = new PanoramaAutoRotateController({
      getState: callbacks.getState,
      getImageSize: callbacks.getImageSize,
      onViewChange: callbacks.onViewChange
    }, dependencies);
    this.threeDAutoOrbit = new ThreeDAutoOrbitController({
      getState: callbacks.getState,
      getViewport: () => this.getActiveViewport(),
      getImageSize: callbacks.getImageSize,
      onViewChange: callbacks.onViewChange
    }, dependencies);
    this.threeDKeyboardOrbit = new ThreeDKeyboardOrbitController({
      getState: callbacks.getState,
      getViewport: () => this.getActiveViewport(),
      getImageSize: callbacks.getImageSize,
      resolveDepthProbePixel: this.resolveDepthProbePixel,
      onViewChange: callbacks.onViewChange,
      onHoverPixel: this.emitHoverPixel,
      isProbeEnabled: () => this.isProbeEnabled(),
      getLastPointerInElement: () => this.lastPointerInElement
    }, dependencies);
    this.keyboardZoom = new ViewerKeyboardZoomController({
      getState: callbacks.getState,
      getViewport: () => this.getActiveViewport(),
      getImageSize: callbacks.getImageSize,
      resolveDepthProbePixel: this.resolveDepthProbePixel,
      onViewChange: callbacks.onViewChange,
      onHoverPixel: this.emitHoverPixel,
      isProbeEnabled: () => this.isProbeEnabled(),
      getLastPointerInElement: () => this.lastPointerInElement,
      isBlocked: () => this.getScreenshotSelection().active
    }, dependencies);

    this.element.addEventListener('wheel', this.onWheel, { passive: false });
    this.element.addEventListener('pointerdown', this.onPointerDown);
    this.element.addEventListener('pointermove', this.onPointerMove);
    this.element.addEventListener('pointerup', this.onPointerUp);
    this.element.addEventListener('pointercancel', this.onPointerCancel);
    this.element.addEventListener('pointerleave', this.onPointerLeave);
    this.element.addEventListener('contextmenu', this.onContextMenu);
    document.addEventListener('visibilitychange', this.onDocumentVisibilityChange);
  }

  destroy(): void {
    this.element.removeEventListener('wheel', this.onWheel);
    this.element.removeEventListener('pointerdown', this.onPointerDown);
    this.element.removeEventListener('pointermove', this.onPointerMove);
    this.element.removeEventListener('pointerup', this.onPointerUp);
    this.element.removeEventListener('pointercancel', this.onPointerCancel);
    this.element.removeEventListener('pointerleave', this.onPointerLeave);
    this.element.removeEventListener('contextmenu', this.onContextMenu);
    document.removeEventListener('visibilitychange', this.onDocumentVisibilityChange);
    this.imageKeyboardPan.destroy();
    this.panoramaKeyboardOrbit.destroy();
    this.panoramaAutoRotate.destroy();
    this.threeDAutoOrbit.destroy();
    this.threeDKeyboardOrbit.destroy();
    this.keyboardZoom.destroy();
  }

  private isProbeEnabled(): boolean {
    return this.callbacks.isProbeEnabled?.() !== false;
  }

  private readonly emitHoverPixel = (pixel: ImagePixel | null): void => {
    if (!this.isProbeEnabled()) {
      return;
    }

    this.callbacks.onHoverPixel(pixel);
  };

  private readonly emitToggleLockPixel = (pixel: ImagePixel | null): void => {
    if (!this.isProbeEnabled()) {
      return;
    }

    this.callbacks.onToggleLockPixel(pixel);
  };

  private readonly resolveDepthProbePixel = (
    point: PointerPosition,
    state: ViewerState,
    viewport: ViewportInfo
  ): ImagePixel | null => {
    if (!this.isProbeEnabled()) {
      return null;
    }

    return this.callbacks.resolveDepthProbePixel?.(point, state, viewport) ?? null;
  };

  private resolveProbeTarget(
    point: PointerPosition,
    state: ViewerState,
    viewport: ViewportInfo,
    imageSize: ImageSize
  ): ImagePixel | null {
    if (!this.isProbeEnabled()) {
      return null;
    }

    return resolveProbePixel(point, state, viewport, imageSize, this.resolveDepthProbePixel);
  }

  private resolveHoverProbeTarget(
    state: ViewerState,
    viewport: ViewportInfo,
    imageSize: ImageSize
  ): ImagePixel | null {
    if (!this.isProbeEnabled()) {
      return null;
    }

    return resolveHoverPixel(
      this.lastPointerInElement,
      state,
      viewport,
      imageSize,
      this.resolveDepthProbePixel
    );
  }

  setPanoramaAutoRotateConfig(config: PanoramaAutoRotateConfig): void {
    this.panoramaAutoRotate.setConfig(config);
  }

  refreshPanoramaAutoRotate(): void {
    this.panoramaAutoRotate.sync();
  }

  pausePanoramaAutoRotateForUserInput(): void {
    if (this.callbacks.getState().viewerMode === 'panorama') {
      this.panoramaAutoRotate.pauseForUserInteraction();
    }
  }

  setThreeDAutoOrbitConfig(config: ThreeDAutoOrbitConfig): void {
    this.threeDAutoOrbit.setConfig(config);
  }

  refreshThreeDAutoOrbit(): void {
    this.threeDAutoOrbit.sync();
  }

  pauseThreeDAutoOrbitForUserInput(): void {
    if (this.callbacks.getState().viewerMode === '3d') {
      this.threeDAutoOrbit.pauseForUserInteraction();
    }
  }

  handlePanoramaKeyboardOrbit(direction: PanoramaKeyboardOrbitDirection): void {
    this.pausePanoramaAutoRotateForUserInput();
    this.panoramaKeyboardOrbit.handle(direction);
  }

  setPanoramaKeyboardOrbitInput(input: PanoramaKeyboardOrbitInput): void {
    this.panoramaAutoRotate.setUserInteracting(
      this.callbacks.getState().viewerMode === 'panorama' && hasViewerKeyboardNavigationInput(input)
    );
    this.panoramaKeyboardOrbit.setInput(input);
  }

  handleViewerKeyboardNavigation(direction: ViewerKeyboardNavigationDirection): void {
    const state = this.callbacks.getState();
    if (state.viewerMode === 'image') {
      this.imageKeyboardPan.handle(direction);
      return;
    }

    if (state.viewerMode === 'panorama') {
      this.panoramaAutoRotate.pauseForUserInteraction();
      this.panoramaKeyboardOrbit.handle(direction);
      return;
    }

    if (state.viewerMode === '3d') {
      this.threeDAutoOrbit.pauseForUserInteraction();
      this.threeDKeyboardOrbit.handle(direction);
    }
  }

  handleViewerKeyboardZoom(direction: ViewerKeyboardZoomDirection): void {
    if (this.getScreenshotSelection().active) {
      return;
    }

    const imageSize = this.callbacks.getImageSize();
    if (!imageSize) {
      return;
    }

    const state = this.callbacks.getState();
    const viewport = this.getActiveViewport();
    if (viewport.width <= 0 || viewport.height <= 0) {
      return;
    }

    if (state.viewerMode === 'panorama') {
      this.panoramaAutoRotate.pauseForUserInteraction();
      const nextView = zoomPanoramaFromKeyboard(state, direction);
      const nextState = { ...state, ...nextView };
      this.callbacks.onViewChange(nextView);
      this.emitHoverPixel(this.resolveHoverProbeTarget(nextState, viewport, imageSize));
      return;
    }

    if (state.viewerMode === '3d') {
      this.threeDAutoOrbit.pauseForUserInteraction();
      const nextView = zoomThreeDFromKeyboard(state, direction);
      const nextState = { ...state, ...nextView };
      this.callbacks.onViewChange(nextView);
      this.emitHoverPixel(this.resolveHoverProbeTarget(nextState, viewport, imageSize));
      return;
    }

    if (state.viewerMode !== 'image') {
      return;
    }

    const point = this.lastPointerInElement ?? {
      x: viewport.width * 0.5,
      y: viewport.height * 0.5
    };
    const nextView = zoomImageFromKeyboard(state, viewport, point, direction);
    const nextState = { ...state, ...nextView };
    this.callbacks.onViewChange(nextView);
    this.emitHoverPixel(this.resolveProbeTarget(point, nextState, viewport, imageSize));
  }

  setViewerKeyboardZoomInput(input: ViewerKeyboardZoomInput): void {
    this.panoramaAutoRotate.setUserInteracting(
      this.callbacks.getState().viewerMode === 'panorama' && hasViewerKeyboardZoomInput(input)
    );
    this.threeDAutoOrbit.setUserInteracting(
      this.callbacks.getState().viewerMode === '3d' && hasViewerKeyboardZoomInput(input)
    );
    this.keyboardZoom.setInput(input);
  }

  setViewerKeyboardNavigationInput(input: ViewerKeyboardNavigationInput): void {
    const state = this.callbacks.getState();
    if (state.viewerMode === 'image') {
      this.panoramaAutoRotate.setUserInteracting(false);
      this.threeDAutoOrbit.setUserInteracting(false);
      this.panoramaKeyboardOrbit.setInput(createViewerKeyboardNavigationInput());
      this.threeDKeyboardOrbit.setInput(createViewerKeyboardNavigationInput());
      this.imageKeyboardPan.setInput(input);
      return;
    }

    if (state.viewerMode === 'panorama') {
      this.panoramaAutoRotate.setUserInteracting(hasViewerKeyboardNavigationInput(input));
      this.threeDAutoOrbit.setUserInteracting(false);
      this.imageKeyboardPan.setInput(createViewerKeyboardNavigationInput());
      this.threeDKeyboardOrbit.setInput(createViewerKeyboardNavigationInput());
      this.panoramaKeyboardOrbit.setInput(input);
      return;
    }

    if (state.viewerMode === '3d') {
      this.panoramaAutoRotate.setUserInteracting(false);
      this.threeDAutoOrbit.setUserInteracting(hasViewerKeyboardNavigationInput(input));
      this.imageKeyboardPan.setInput(createViewerKeyboardNavigationInput());
      this.panoramaKeyboardOrbit.setInput(createViewerKeyboardNavigationInput());
      this.threeDKeyboardOrbit.setInput(input);
      return;
    }

    this.panoramaAutoRotate.setUserInteracting(false);
    this.threeDAutoOrbit.setUserInteracting(false);
    this.imageKeyboardPan.setInput(createViewerKeyboardNavigationInput());
    this.panoramaKeyboardOrbit.setInput(createViewerKeyboardNavigationInput());
    this.threeDKeyboardOrbit.setInput(createViewerKeyboardNavigationInput());
  }

  private readonly onWheel = (event: WheelEvent): void => {
    if (this.getScreenshotSelection().active) {
      event.preventDefault();
      return;
    }

    const imageSize = this.callbacks.getImageSize();
    if (!imageSize) {
      return;
    }

    event.preventDefault();

    const panePoint = this.resolveActivePanePoint(event);
    if (!panePoint.inside) {
      this.lastPointerInElement = null;
      this.emitHoverPixel(null);
      return;
    }

    const point = panePoint.point;
    const state = this.callbacks.getState();
    const viewport = panePoint.pane.viewport;

    if (state.viewerMode === 'panorama') {
      this.panoramaAutoRotate.pauseForUserInteraction();
      const nextView = zoomPanoramaFromWheel(state, event.deltaY);
      const nextState = { ...state, ...nextView };
      this.callbacks.onViewChange(nextView);
      this.emitHoverPixel(this.resolveProbeTarget(point, nextState, viewport, imageSize));
      return;
    }

    if (state.viewerMode === '3d') {
      this.threeDAutoOrbit.pauseForUserInteraction();
      const nextView = zoomThreeDFromWheel(state, event.deltaY);
      const nextState = { ...state, ...nextView };
      this.callbacks.onViewChange(nextView);
      this.emitHoverPixel(this.resolveProbeTarget(point, nextState, viewport, imageSize));
      return;
    }

    const nextView = zoomImageFromWheel(state, viewport, point, event.deltaY);
    const nextState = { ...state, ...nextView };
    this.callbacks.onViewChange(nextView);
    this.emitHoverPixel(this.resolveProbeTarget(point, nextState, viewport, imageSize));
  };

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (isViewerContextMenuTarget(event.target)) {
      return;
    }

    if (event.pointerType === 'touch' && this.touchPointers.size > 0) {
      const panePoint = this.resolvePanePoint(event, {
        activate: false,
        preferDragPane: this.dragging
      });
      this.rememberTouchPointerFromPanePoint(event.pointerId, panePoint);
      this.capturePointer(event.pointerId);
      if (this.dragging) {
        this.cancelDragForTouchGesture();
      }
      if (!this.getScreenshotSelection().active) {
        this.startTouchGesture();
      }
      event.preventDefault();
      return;
    }

    const screenshotSelection = this.getScreenshotSelection();
    if (screenshotSelection.active) {
      if (!isScreenshotSelectionDragButton(event)) {
        return;
      }

      const panePoint = this.resolvePanePoint(event, { activate: false });
      const point = panePoint.point;
      if (event.pointerType === 'touch') {
        this.rememberTouchPointerFromPanePoint(event.pointerId, panePoint);
      }
      this.lastPointerInElement = point;
      if (event.target instanceof Element && event.target.closest('.screenshot-selection-controls')) {
        return;
      }
      this.emitHoverPixel(null);
      const hit = resolveScreenshotSelectionHit(point, screenshotSelection);
      this.callbacks.onScreenshotSelectionHandleHover?.(hit?.handle ?? null);
      if (!hit) {
        return;
      }

      if (hit.regionId) {
        this.callbacks.onScreenshotSelectionActiveRegionChange?.(hit.regionId);
      }
      this.startDrag(event.pointerId);
      this.dragMode = 'screenshot';
      this.movedDuringDrag = false;
      this.previousPointer = point;
      this.screenshotDrag = {
        handle: hit.handle,
        startPoint: point,
        startRect: hit.rect
      };
      this.callbacks.onScreenshotSelectionResizeActiveChange?.(hit.handle !== 'move');
      if (hit.handle === 'move') {
        this.callbacks.onScreenshotSelectionSquareSnapChange?.(false);
      }
      this.capturePointer(event.pointerId);
      return;
    }

    const imageSize = this.callbacks.getImageSize();
    if (!imageSize) {
      return;
    }

    const state = this.callbacks.getState();
    const depthPanDrag = isThreeDPanDragStart(event, state);
    if (event.button !== 0 && !depthPanDrag) {
      return;
    }

    const panePoint = this.resolvePanePoint(event, { activate: true });
    const point = panePoint.point;
    if (event.pointerType === 'touch') {
      this.rememberTouchPointerFromPanePoint(event.pointerId, panePoint);
    }
    this.dragPane = panePoint.pane;
    this.lastPointerInElement = point;

    const viewport = panePoint.pane.viewport;
    if (state.viewerMode === 'panorama') {
      this.panoramaAutoRotate.setUserInteracting(true);
    }
    if (state.viewerMode === '3d') {
      this.threeDAutoOrbit.setUserInteracting(true);
    }
    if (state.viewerMode === 'image') {
      const handle = state.roi ? resolveRoiAdjustmentHandle(point, state.roi, state, viewport) : null;
      this.setRoiInteractionState(createRoiInteractionState({ hoverHandle: handle }));
      if (handle) {
        this.startDrag(event.pointerId);
        this.dragMode = 'roi-adjust';
        this.movedDuringDrag = false;
        this.roiAdjustmentDrag = createRoiAdjustmentDrag(handle, point, state.roi!);
        this.previousPointer = point;
        this.emitHoverPixel(this.resolveProbeTarget(point, state, viewport, imageSize));
        this.setRoiInteractionState(createRoiInteractionState({
          hoverHandle: handle,
          activeHandle: handle
        }));
        this.capturePointer(event.pointerId);
        return;
      }
    } else {
      this.setRoiInteractionState(createRoiInteractionState());
    }

    if (state.viewerMode === 'image' && event.shiftKey) {
      const anchorPixel = resolveRoiAnchorPixel(point, state, viewport, imageSize);
      if (!anchorPixel) {
        return;
      }

      this.startDrag(event.pointerId);
      this.dragMode = 'roi';
      this.movedDuringDrag = false;
      this.roiAnchorPixel = anchorPixel;
      this.previousPointer = point;
      this.callbacks.onDraftRoi(createDraftRoiFromAnchor(anchorPixel));
      this.setRoiInteractionState(createRoiInteractionState());
      this.capturePointer(event.pointerId);
      return;
    }

    this.startDrag(event.pointerId);
    this.dragMode = depthPanDrag ? 'depth-pan' : 'pan';
    this.movedDuringDrag = false;
    this.previousPointer = point;
    if (depthPanDrag) {
      event.preventDefault();
    }
    this.capturePointer(event.pointerId);
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (event.pointerType === 'touch') {
      this.updateTouchPointer(event);
      if (this.touchGesture) {
        if (this.isTouchGesturePointer(event.pointerId)) {
          this.updateTouchGesture();
        }
        event.preventDefault();
        return;
      }
    }

    if (this.dragging && this.dragPointerId !== null && event.pointerId !== this.dragPointerId) {
      return;
    }

    const screenshotSelection = this.getScreenshotSelection();
    const panePoint = screenshotSelection.active || this.dragging
      ? this.resolvePanePoint(event, {
        activate: false,
        preferDragPane: this.dragging
      })
      : this.resolveActivePanePoint(event);
    const point = panePoint.point;
    this.lastPointerInElement = panePoint.inside ? point : null;
    if (screenshotSelection.active) {
      this.emitHoverPixel(null);
      if (this.dragging && this.dragMode === 'screenshot' && this.screenshotDrag) {
        const deltaX = point.x - this.previousPointer!.x;
        const deltaY = point.y - this.previousPointer!.y;
        if (Math.abs(deltaX) > 1 || Math.abs(deltaY) > 1) {
          this.movedDuringDrag = true;
        }
        const update = updateScreenshotSelectionRectFromDrag(
          this.screenshotDrag,
          point,
          panePoint.pane.viewport,
          {
            preserveAspectRatio: event.shiftKey,
            resizeFromCenter: this.screenshotDrag.handle !== 'move' && event.ctrlKey,
            ...this.resolveScreenshotSelectionSnapTargets()
          }
        );
        this.callbacks.onScreenshotSelectionRectChange?.(update);
        this.callbacks.onScreenshotSelectionSquareSnapChange?.(update.squareSnapped);
        this.callbacks.onScreenshotSelectionHandleHover?.(this.screenshotDrag.handle);
        this.previousPointer = point;
        return;
      }

      const hit = resolveScreenshotSelectionHit(point, screenshotSelection);
      this.callbacks.onScreenshotSelectionHandleHover?.(hit?.handle ?? null);
      return;
    }

    const imageSize = this.callbacks.getImageSize();
    if (!imageSize) {
      this.emitHoverPixel(null);
      return;
    }

    if (!this.dragging && !panePoint.inside) {
      this.emitHoverPixel(null);
      this.setRoiInteractionState(createRoiInteractionState());
      return;
    }

    const state = this.callbacks.getState();
    const viewport = panePoint.pane.viewport;
    let hoverState: ViewerState = state;
    let skipProbeResolution = false;

    if (this.dragging && this.previousPointer) {
      const deltaX = point.x - this.previousPointer.x;
      const deltaY = point.y - this.previousPointer.y;

      if (Math.abs(deltaX) > 1 || Math.abs(deltaY) > 1) {
        this.movedDuringDrag = true;
      }

      if (this.dragMode === 'roi' && this.roiAnchorPixel) {
        this.callbacks.onDraftRoi(
          updateDraftRoiFromDrag(this.roiAnchorPixel, point, state, viewport, imageSize)
        );
      } else if (this.dragMode === 'roi-adjust' && this.roiAdjustmentDrag) {
        const roi = updateRoiFromAdjustmentDrag(
          this.roiAdjustmentDrag,
          point,
          state,
          imageSize,
          {
            preserveAspectRatio: event.shiftKey,
            resizeFromCenter: this.roiAdjustmentDrag.handle !== 'move' && event.ctrlKey
          }
        );
        this.callbacks.onDraftRoi(roi);
        this.setRoiInteractionState(createRoiInteractionState({
          hoverHandle: this.roiAdjustmentDrag.handle,
          activeHandle: this.roiAdjustmentDrag.handle
        }));
      } else if (state.viewerMode === 'panorama') {
        this.panoramaAutoRotate.setUserInteracting(true);
        const nextView = orbitPanoramaFromDrag(state, viewport, deltaX, deltaY);
        hoverState = { ...state, ...nextView };
        this.callbacks.onViewChange(nextView);
      } else if (state.viewerMode === '3d') {
        const nextView = this.dragMode === 'depth-pan'
          ? panThreeDFromDrag(state, viewport, deltaX, deltaY)
          : orbitThreeDFromDrag(state, viewport, deltaX, deltaY);
        hoverState = { ...state, ...nextView };
        this.callbacks.onViewChange(nextView);
        if ((this.dragMode === 'pan' || this.dragMode === 'depth-pan') && this.movedDuringDrag) {
          this.pendingDepthDragProbeState = hoverState;
          skipProbeResolution = true;
        }
      } else {
        const nextView = panImageFromDrag(state, deltaX, deltaY);
        hoverState = { ...state, ...nextView };
        this.callbacks.onViewChange(nextView);
      }

      this.previousPointer = point;
    }

    if (!this.dragging) {
      this.updateRoiHover(point, state, viewport);
    }
    if (skipProbeResolution) {
      return;
    }
    this.emitHoverPixel(this.resolveProbeTarget(point, hoverState, viewport, imageSize));
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (event.pointerType === 'touch') {
      this.updateTouchPointer(event);
      if (this.touchGesture) {
        if (this.isTouchGesturePointer(event.pointerId)) {
          this.finishTouchGesture();
        }
        this.forgetTouchPointer(event.pointerId);
        this.releasePointerCapture(event.pointerId);
        event.preventDefault();
        return;
      }
      this.forgetTouchPointer(event.pointerId);
      if (this.dragging && this.dragPointerId !== null && event.pointerId !== this.dragPointerId) {
        this.releasePointerCapture(event.pointerId);
        return;
      }
    } else if (this.dragging && this.dragPointerId !== null && event.pointerId !== this.dragPointerId) {
      return;
    }

    const screenshotSelection = this.getScreenshotSelection();
    if (screenshotSelection.active) {
      const panePoint = this.resolvePanePoint(event, {
        activate: false,
        preferDragPane: this.dragging
      });
      const point = panePoint.point;
      this.lastPointerInElement = point;
      if (this.dragging && this.dragMode === 'screenshot') {
        const rect = this.getScreenshotSelection().rect;
        this.clearDrag(event.pointerId);
        this.callbacks.onScreenshotSelectionHandleHover?.(
          rect ? resolveScreenshotSelectionHandle(point, rect) : null
        );
        return;
      }

      if (event.button !== 0) {
        return;
      }

      this.emitHoverPixel(null);
      this.callbacks.onScreenshotSelectionHandleHover?.(
        resolveScreenshotSelectionHit(point, screenshotSelection)?.handle ?? null
      );
      return;
    }

    if (event.button !== 0 && !(this.dragging && this.dragMode === 'depth-pan' && event.button === 1)) {
      return;
    }

    const imageSize = this.callbacks.getImageSize();
    if (!imageSize) {
      this.panoramaAutoRotate.setUserInteracting(false);
      this.threeDAutoOrbit.setUserInteracting(false);
      this.clearDrag(event.pointerId);
      return;
    }

    const panePoint = this.resolvePanePoint(event, {
      activate: !this.dragging,
      preferDragPane: this.dragging
    });
    const point = panePoint.point;
    this.lastPointerInElement = point;

    if (this.dragging && this.dragMode === 'roi' && this.roiAnchorPixel) {
      const state = this.callbacks.getState();
      const viewport = panePoint.pane.viewport;
      this.callbacks.onDraftRoi(null);
      this.callbacks.onCommitRoi(
        commitRoiFromDrag(this.roiAnchorPixel, point, state, viewport, imageSize)
      );
      this.clearDrag(event.pointerId);
      return;
    }

    if (this.dragging && this.dragMode === 'roi-adjust' && this.roiAdjustmentDrag) {
      const state = this.callbacks.getState();
      const viewport = panePoint.pane.viewport;
      this.callbacks.onDraftRoi(null);
      if (this.movedDuringDrag) {
        const roi = updateRoiFromAdjustmentDrag(
          this.roiAdjustmentDrag,
          point,
          state,
          imageSize,
          {
            preserveAspectRatio: event.shiftKey,
            resizeFromCenter: this.roiAdjustmentDrag.handle !== 'move' && event.ctrlKey
          }
        );
        this.callbacks.onCommitRoi(roi);
        this.clearDrag(event.pointerId);
        this.setRoiInteractionState(createRoiInteractionState({
          hoverHandle: resolveRoiAdjustmentHandle(point, roi, state, viewport)
        }));
        return;
      }

      this.emitToggleLockPixel(this.resolveProbeTarget(point, state, viewport, imageSize));
      const startRoi = this.roiAdjustmentDrag.startRoi;
      this.clearDrag(event.pointerId);
      this.setRoiInteractionState(createRoiInteractionState({
        hoverHandle: resolveRoiAdjustmentHandle(point, startRoi, state, viewport)
      }));
      return;
    }

    if (this.dragging && !this.movedDuringDrag && this.dragMode !== 'depth-pan') {
      const state = this.callbacks.getState();
      const viewport = panePoint.pane.viewport;
      this.emitToggleLockPixel(this.resolveProbeTarget(point, state, viewport, imageSize));
    }

    if (
      this.dragging &&
      this.movedDuringDrag &&
      (this.dragMode === 'pan' || this.dragMode === 'depth-pan') &&
      this.pendingDepthDragProbeState
    ) {
      const viewport = panePoint.pane.viewport;
      this.emitHoverPixel(this.resolveProbeTarget(point, this.pendingDepthDragProbeState, viewport, imageSize));
    }

    this.clearDrag(event.pointerId);
  };

  private readonly onPointerCancel = (event: PointerEvent): void => {
    if (event.pointerType === 'touch') {
      this.updateTouchPointer(event);
      if (this.touchGesture && this.isTouchGesturePointer(event.pointerId)) {
        this.finishTouchGesture();
      }
      this.forgetTouchPointer(event.pointerId);
    }

    if (this.dragging && this.dragPointerId === event.pointerId) {
      this.cancelDrag(event.pointerId);
    } else {
      this.releasePointerCapture(event.pointerId);
    }
  };

  private readonly onPointerLeave = (): void => {
    this.lastPointerInElement = null;
    this.emitHoverPixel(null);
    if (this.getScreenshotSelection().active && !this.dragging) {
      this.callbacks.onScreenshotSelectionHandleHover?.(null);
    }
    if (!this.dragging) {
      this.setRoiInteractionState(createRoiInteractionState());
    }
  };

  private readonly onContextMenu = (event: MouseEvent): void => {
    if (
      !this.getScreenshotSelection().active ||
      (event.target instanceof Element && event.target.closest('.screenshot-selection-controls'))
    ) {
      return;
    }

    event.preventDefault();
  };

  private startDrag(pointerId: number): void {
    this.dragging = true;
    this.dragPointerId = pointerId;
  }

  private clearDrag(pointerId: number | null, options: { releasePointerCapture?: boolean } = {}): void {
    const wasDragging = this.dragging;
    const wasScreenshotResize = this.dragMode === 'screenshot' && this.screenshotDrag?.handle !== 'move';
    const wasScreenshotDrag = this.dragMode === 'screenshot';
    if (options.releasePointerCapture !== false && pointerId !== null) {
      this.releasePointerCapture(pointerId);
    }
    this.dragging = false;
    this.dragPointerId = null;
    this.dragMode = null;
    this.movedDuringDrag = false;
    this.previousPointer = null;
    this.dragPane = null;
    this.pendingDepthDragProbeState = null;
    this.roiAnchorPixel = null;
    this.roiAdjustmentDrag = null;
    this.screenshotDrag = null;
    if (wasScreenshotDrag) {
      this.callbacks.onScreenshotSelectionSquareSnapChange?.(false);
      this.callbacks.onScreenshotSelectionSnapGuideChange?.(createEmptySnapGuide());
    }
    if (wasScreenshotResize) {
      this.callbacks.onScreenshotSelectionResizeActiveChange?.(false);
    }
    if (wasDragging) {
      this.panoramaAutoRotate.setUserInteracting(false);
      this.threeDAutoOrbit.setUserInteracting(false);
    }
  }

  private cancelDrag(pointerId: number | null, options: { releasePointerCapture?: boolean } = {}): void {
    const dragMode = this.dragMode;
    if (dragMode === 'roi' || dragMode === 'roi-adjust') {
      this.callbacks.onDraftRoi(null);
    }
    this.clearDrag(pointerId, options);
    if (dragMode === 'roi' || dragMode === 'roi-adjust') {
      this.setRoiInteractionState(createRoiInteractionState());
    }
  }

  private cancelDragForTouchGesture(): void {
    this.cancelDrag(this.dragPointerId, { releasePointerCapture: false });
  }

  private capturePointer(pointerId: number): void {
    this.element.setPointerCapture(pointerId);
  }

  private releasePointerCapture(pointerId: number): void {
    if (this.element.hasPointerCapture(pointerId)) {
      this.element.releasePointerCapture(pointerId);
    }
  }

  private rememberTouchPointerFromPanePoint(pointerId: number, panePoint: PanePoint): void {
    this.touchPointers.set(pointerId, {
      pointerId,
      elementPoint: {
        x: panePoint.point.x + panePoint.pane.rect.x,
        y: panePoint.point.y + panePoint.pane.rect.y
      },
      pane: panePoint.pane
    });
  }

  private updateTouchPointer(event: PointerEvent): void {
    const pointer = this.touchPointers.get(event.pointerId);
    if (!pointer) {
      return;
    }

    pointer.elementPoint = this.getElementPoint(event);
    if (!this.touchGesture) {
      pointer.pane = this.resolvePaneAtElementPoint(pointer.elementPoint);
    }
  }

  private forgetTouchPointer(pointerId: number): void {
    this.touchPointers.delete(pointerId);
    if (this.touchGesture?.pointerIds.includes(pointerId)) {
      this.touchGesture = null;
    }
  }

  private startTouchGesture(): void {
    if (this.touchGesture || this.touchPointers.size < 2 || !this.callbacks.getImageSize()) {
      return;
    }

    const pointers = [...this.touchPointers.values()].slice(0, 2);
    const pane = this.dragPane ?? pointers[0]!.pane;
    const sample = resolveTouchGestureSample(pointers[0]!, pointers[1]!, pane);
    this.touchGesture = {
      pointerIds: [pointers[0]!.pointerId, pointers[1]!.pointerId],
      pane,
      previousMidpoint: sample.midpoint,
      previousDistance: sample.distance
    };
    this.lastPointerInElement = sample.midpoint;
    this.emitHoverPixel(null);

    const state = this.callbacks.getState();
    if (state.viewerMode === 'panorama') {
      this.panoramaAutoRotate.setUserInteracting(true);
    }
    if (state.viewerMode === '3d') {
      this.threeDAutoOrbit.setUserInteracting(true);
    }
  }

  private isTouchGesturePointer(pointerId: number): boolean {
    return this.touchGesture?.pointerIds.includes(pointerId) ?? false;
  }

  private updateTouchGesture(): void {
    const gesture = this.touchGesture;
    const imageSize = this.callbacks.getImageSize();
    if (!gesture || !imageSize) {
      return;
    }

    const first = this.touchPointers.get(gesture.pointerIds[0]);
    const second = this.touchPointers.get(gesture.pointerIds[1]);
    if (!first || !second) {
      this.finishTouchGesture();
      return;
    }

    const previousMidpoint = gesture.previousMidpoint;
    const previousDistance = gesture.previousDistance;
    const sample = resolveTouchGestureSample(first, second, gesture.pane);
    const deltaX = sample.midpoint.x - previousMidpoint.x;
    const deltaY = sample.midpoint.y - previousMidpoint.y;
    const scale = previousDistance > 0 && sample.distance > 0
      ? sample.distance / previousDistance
      : 1;
    gesture.previousMidpoint = sample.midpoint;
    gesture.previousDistance = sample.distance;
    this.lastPointerInElement = sample.midpoint;

    if (
      Math.abs(deltaX) <= Number.EPSILON &&
      Math.abs(deltaY) <= Number.EPSILON &&
      Math.abs(scale - 1) <= Number.EPSILON
    ) {
      return;
    }

    const state = this.callbacks.getState();
    const viewport = gesture.pane.viewport;
    let nextView: Partial<ViewerState> | null = null;
    let hoverState: ViewerState = state;
    let shouldResolveHover = true;

    if (state.viewerMode === 'image') {
      const zoomedView = zoomAroundPoint(
        state,
        viewport,
        previousMidpoint.x,
        previousMidpoint.y,
        state.zoom * scale
      );
      nextView = panImageFromDrag({ ...state, ...zoomedView }, deltaX, deltaY);
      hoverState = { ...state, ...nextView };
    } else if (state.viewerMode === 'panorama') {
      this.panoramaAutoRotate.setUserInteracting(true);
      const orbitView = orbitPanoramaFromDrag(state, viewport, deltaX, deltaY);
      nextView = {
        ...orbitView,
        panoramaHfovDeg: clampPanoramaHfov(orbitView.panoramaHfovDeg / scale)
      };
      hoverState = { ...state, ...nextView };
    } else if (state.viewerMode === '3d') {
      this.threeDAutoOrbit.setUserInteracting(true);
      const panView = panThreeDFromDrag(state, viewport, deltaX, deltaY);
      nextView = {
        ...panView,
        depthZoom: clampDepthZoom(panView.depthZoom * scale)
      };
      hoverState = { ...state, ...nextView };
      this.pendingDepthDragProbeState = hoverState;
      shouldResolveHover = false;
    }

    if (!nextView) {
      return;
    }

    this.movedDuringDrag = true;
    this.callbacks.onViewChange(nextView);
    if (shouldResolveHover) {
      this.emitHoverPixel(this.resolveProbeTarget(sample.midpoint, hoverState, viewport, imageSize));
    }
  }

  private finishTouchGesture(): void {
    const gesture = this.touchGesture;
    if (!gesture) {
      return;
    }

    const imageSize = this.callbacks.getImageSize();
    if (imageSize && this.pendingDepthDragProbeState) {
      this.emitHoverPixel(
        this.resolveProbeTarget(
          gesture.previousMidpoint,
          this.pendingDepthDragProbeState,
          gesture.pane.viewport,
          imageSize
        )
      );
    }

    this.touchGesture = null;
    this.pendingDepthDragProbeState = null;
    this.movedDuringDrag = false;
    this.panoramaAutoRotate.setUserInteracting(false);
    this.threeDAutoOrbit.setUserInteracting(false);
  }

  private updateRoiHover(point: PointerPosition, state: ViewerState, viewport: ViewportInfo): void {
    if (state.viewerMode !== 'image' || !state.roi) {
      this.setRoiInteractionState(createRoiInteractionState());
      return;
    }

    this.setRoiInteractionState(createRoiInteractionState({
      hoverHandle: resolveRoiAdjustmentHandle(point, state.roi, state, viewport)
    }));
  }

  private setRoiInteractionState(state: ViewerRoiInteractionState): void {
    this.callbacks.onRoiInteractionState?.(state);
    this.renderRoiAdjustmentCursor(state.activeHandle ?? state.hoverHandle);
  }

  private renderRoiAdjustmentCursor(handle: RoiAdjustmentHandle | null): void {
    const handleClassNames = [
      'is-roi-handle-move',
      'is-roi-handle-edge-n',
      'is-roi-handle-edge-e',
      'is-roi-handle-edge-s',
      'is-roi-handle-edge-w',
      'is-roi-handle-corner-nw',
      'is-roi-handle-corner-ne',
      'is-roi-handle-corner-se',
      'is-roi-handle-corner-sw'
    ];

    this.element.classList.remove(...handleClassNames);
    if (handle && !this.getScreenshotSelection().active) {
      this.element.classList.add(`is-roi-handle-${handle}`);
    }
  }

  private getElementPoint(event: MouseEvent): PointerPosition {
    const rect = this.element.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    };
  }

  private resolvePanePoint(
    event: MouseEvent,
    options: { activate?: boolean; preferDragPane?: boolean } = {}
  ): PanePoint {
    const elementPoint = this.getElementPoint(event);
    const pane = options.preferDragPane && this.dragPane
      ? this.dragPane
      : this.resolvePaneAtElementPoint(elementPoint);
    if (options.activate !== false) {
      this.activatePane(pane);
    }

    return this.createPanePoint(elementPoint, pane);
  }

  private resolveActivePanePoint(event: MouseEvent): PanePoint {
    const elementPoint = this.getElementPoint(event);
    const pane = this.callbacks.getActivePane?.() ?? this.resolvePaneAtElementPoint(elementPoint);
    return this.createPanePoint(elementPoint, pane);
  }

  private createPanePoint(elementPoint: PointerPosition, pane: ViewerPaneRenderInfo): PanePoint {
    return {
      pane,
      point: {
        x: elementPoint.x - pane.rect.x,
        y: elementPoint.y - pane.rect.y
      },
      inside: isPointInsideRect(elementPoint, pane.rect)
    };
  }

  private resolvePaneAtElementPoint(point: PointerPosition): ViewerPaneRenderInfo {
    return this.callbacks.resolvePaneAtPoint?.(point)
      ?? this.callbacks.getActivePane?.()
      ?? createFallbackPane(this.callbacks.getViewport());
  }

  private activatePane(pane: ViewerPaneRenderInfo): void {
    const activePath = this.callbacks.getActivePane?.().path ?? [];
    if (samePanePath(pane.path, activePath)) {
      this.lastRequestedActivePanePath = null;
      return;
    }

    if (this.lastRequestedActivePanePath && samePanePath(this.lastRequestedActivePanePath, pane.path)) {
      return;
    }

    this.lastRequestedActivePanePath = [...pane.path];
    this.callbacks.onActivePaneChange?.([...pane.path]);
  }

  private getActiveViewport(): ViewportInfo {
    return this.callbacks.getActivePane?.().viewport ?? this.callbacks.getViewport();
  }

  private resolveScreenshotSelectionSnapTargets(): {
    centerSnapTarget: PointerPosition | null;
    edgeSnapTargets: ScreenshotSelectionEdgeSnapTargets | null;
  } {
    const viewport = this.getActiveViewport();
    if (!isValidViewport(viewport)) {
      return { centerSnapTarget: null, edgeSnapTargets: null };
    }

    const state = this.callbacks.getState();
    if (state.viewerMode === 'panorama') {
      const projectionDiameter = getPanoramaProjectionDiameter(viewport, state.panoramaHfovDeg);
      const halfProjectionDiameter = projectionDiameter * 0.5;
      return withScreenshotRegionSnapTargets({
        centerSnapTarget: {
          x: viewport.width * 0.5,
          y: viewport.height * 0.5
        },
        edgeSnapTargets: {
          x: filterViewportCoordinates([
            viewport.width * 0.5 - halfProjectionDiameter,
            viewport.width * 0.5 + halfProjectionDiameter
          ], viewport.width),
          y: filterViewportCoordinates([
            viewport.height * 0.5 - halfProjectionDiameter,
            viewport.height * 0.5 + halfProjectionDiameter
          ], viewport.height)
        }
      }, this.getScreenshotSelection(), viewport);
    }

    if (state.viewerMode !== 'image') {
      return { centerSnapTarget: null, edgeSnapTargets: null };
    }

    const imageSize = this.callbacks.getImageSize();
    if (!imageSize || imageSize.width <= 0 || imageSize.height <= 0) {
      return { centerSnapTarget: null, edgeSnapTargets: null };
    }

    const centerTarget = imageToScreen(imageSize.width * 0.5, imageSize.height * 0.5, state, viewport);
    const topLeft = imageToScreen(0, 0, state, viewport);
    const bottomRight = imageToScreen(imageSize.width, imageSize.height, state, viewport);
    return withScreenshotRegionSnapTargets({
      centerSnapTarget: isPointInsideViewport(centerTarget, viewport) ? centerTarget : null,
      edgeSnapTargets: {
        x: filterViewportCoordinates([topLeft.x, bottomRight.x], viewport.width),
        y: filterViewportCoordinates([topLeft.y, bottomRight.y], viewport.height)
      }
    }, this.getScreenshotSelection(), viewport);
  }

  private getScreenshotSelection() {
    return this.callbacks.getScreenshotSelection?.() ?? { active: false, rect: null };
  }

  private readonly onDocumentVisibilityChange = (): void => {
    this.panoramaAutoRotate.sync();
    this.threeDAutoOrbit.sync();
  };
}

function resolveTouchGestureSample(
  first: ActiveTouchPointer,
  second: ActiveTouchPointer,
  pane: ViewerPaneRenderInfo
): { midpoint: PointerPosition; distance: number } {
  const firstPoint = touchPointerToPanePoint(first, pane);
  const secondPoint = touchPointerToPanePoint(second, pane);

  return {
    midpoint: {
      x: (firstPoint.x + secondPoint.x) * 0.5,
      y: (firstPoint.y + secondPoint.y) * 0.5
    },
    distance: Math.hypot(secondPoint.x - firstPoint.x, secondPoint.y - firstPoint.y)
  };
}

function touchPointerToPanePoint(pointer: ActiveTouchPointer, pane: ViewerPaneRenderInfo): PointerPosition {
  return {
    x: pointer.elementPoint.x - pane.rect.x,
    y: pointer.elementPoint.y - pane.rect.y
  };
}

function resolveScreenshotSelectionHit(
  point: PointerPosition,
  selection: ScreenshotSelectionInteractionState
): { regionId: string | null; rect: ViewportRect; handle: ScreenshotSelectionHandle } | null {
  const regions = selection.regions?.length
    ? selection.regions
    : selection.rect
      ? [{ id: '', rect: selection.rect }]
      : [];
  const activeRegionIndex = selection.activeRegionId
    ? regions.findIndex((region) => region.id === selection.activeRegionId)
    : -1;
  const hitOrder = activeRegionIndex >= 0
    ? [
      regions[activeRegionIndex]!,
      ...regions.filter((_, index) => index !== activeRegionIndex).reverse()
    ]
    : [...regions].reverse();
  for (const region of hitOrder) {

    const handle = resolveScreenshotSelectionHandle(point, region.rect);
    if (handle) {
      return {
        regionId: region.id || null,
        rect: region.rect,
        handle
      };
    }
  }

  return null;
}

function withScreenshotRegionSnapTargets(
  targets: {
    centerSnapTarget: PointerPosition | null;
    edgeSnapTargets: ScreenshotSelectionEdgeSnapTargets | null;
  },
  selection: ScreenshotSelectionInteractionState,
  viewport: ViewportInfo
): {
  centerSnapTarget: PointerPosition | null;
  edgeSnapTargets: ScreenshotSelectionEdgeSnapTargets | null;
} {
  const regions = selection.regions ?? [];
  if (regions.length <= 1) {
    return targets;
  }

  const xTargets = [...(targets.edgeSnapTargets?.x ?? [])];
  const yTargets = [...(targets.edgeSnapTargets?.y ?? [])];
  for (const region of regions) {
    if (region.id === selection.activeRegionId) {
      continue;
    }

    xTargets.push(region.rect.x, region.rect.x + region.rect.width * 0.5, region.rect.x + region.rect.width);
    yTargets.push(region.rect.y, region.rect.y + region.rect.height * 0.5, region.rect.y + region.rect.height);
  }

  return {
    centerSnapTarget: targets.centerSnapTarget,
    edgeSnapTargets: {
      x: filterViewportCoordinates(xTargets, viewport.width),
      y: filterViewportCoordinates(yTargets, viewport.height)
    }
  };
}

type ViewerKeyboardZoomCallbacks = Pick<
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
  isBlocked: () => boolean;
};

class ViewerKeyboardZoomController {
  private readonly callbacks: ViewerKeyboardZoomCallbacks;
  private readonly scheduleFrame: NonNullable<InteractionDependencies['scheduleFrame']>;
  private readonly cancelFrame: NonNullable<InteractionDependencies['cancelFrame']>;
  private input = createViewerKeyboardZoomInput();
  private frameId: number | null = null;
  private lastFrameTime: number | null = null;

  constructor(
    callbacks: ViewerKeyboardZoomCallbacks,
    dependencies: InteractionDependencies = {}
  ) {
    this.callbacks = callbacks;
    this.scheduleFrame = dependencies.scheduleFrame ?? window.requestAnimationFrame.bind(window);
    this.cancelFrame = dependencies.cancelFrame ?? window.cancelAnimationFrame.bind(window);
  }

  destroy(): void {
    this.cancelScheduledFrame();
    this.input = createViewerKeyboardZoomInput();
    this.lastFrameTime = null;
  }

  setInput(input: ViewerKeyboardZoomInput): void {
    const previousInput = this.input;
    const nextInput = cloneViewerKeyboardZoomInput(input);
    if (sameViewerKeyboardZoomInput(previousInput, nextInput)) {
      if (hasViewerKeyboardZoomInput(nextInput)) {
        this.ensureScheduledFrame();
      } else {
        this.cancelScheduledFrame();
        this.lastFrameTime = null;
      }
      return;
    }

    this.input = nextInput;
    const newlyPressedInput = getNewlyPressedViewerKeyboardZoomInput(previousInput, nextInput);
    if (hasViewerKeyboardZoomInput(newlyPressedInput)) {
      this.applyInput(newlyPressedInput, 1);
    }

    if (hasViewerKeyboardZoomInput(nextInput)) {
      if (!hasViewerKeyboardZoomInput(previousInput)) {
        this.lastFrameTime = null;
      }
      this.ensureScheduledFrame();
      return;
    }

    this.cancelScheduledFrame();
    this.lastFrameTime = null;
  }

  private applyInput(input: ViewerKeyboardZoomInput, stepRatio: number): void {
    if (this.callbacks.isBlocked()) {
      return;
    }

    const signedDirection = (input.zoomIn ? 1 : 0) - (input.zoomOut ? 1 : 0);
    if (signedDirection === 0) {
      return;
    }

    const imageSize = this.callbacks.getImageSize();
    if (!imageSize) {
      return;
    }

    const state = this.callbacks.getState();
    const viewport = this.callbacks.getViewport();
    if (viewport.width <= 0 || viewport.height <= 0) {
      return;
    }

    if (state.viewerMode === 'panorama') {
      const nextView = zoomPanoramaByKeyboardStep(state, signedDirection * stepRatio);
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
      return;
    }

    if (state.viewerMode === '3d') {
      const nextView = zoomThreeDByKeyboardStep(state, signedDirection * stepRatio);
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
      return;
    }

    if (state.viewerMode !== 'image') {
      return;
    }

    const point = this.callbacks.getLastPointerInElement() ?? {
      x: viewport.width * 0.5,
      y: viewport.height * 0.5
    };
    const nextView = zoomImageByKeyboardStep(state, viewport, point, signedDirection * stepRatio);
    const nextState = { ...state, ...nextView };
    this.callbacks.onViewChange(nextView);
    if (this.callbacks.isProbeEnabled?.() === false) {
      return;
    }
    this.callbacks.onHoverPixel(
      resolveProbePixel(point, nextState, viewport, imageSize, this.callbacks.resolveDepthProbePixel)
    );
  }

  private ensureScheduledFrame(): void {
    if (this.frameId !== null || !hasViewerKeyboardZoomInput(this.input)) {
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
    if (!hasViewerKeyboardZoomInput(this.input)) {
      this.lastFrameTime = null;
      return;
    }

    if (this.lastFrameTime !== null) {
      const elapsedMs = Math.min(
        KEYBOARD_ZOOM_MAX_FRAME_MS,
        Math.max(0, timestamp - this.lastFrameTime)
      );
      if (elapsedMs > 0) {
        this.applyInput(
          this.input,
          KEYBOARD_ZOOM_SPEED_STEPS_PER_SECOND * (elapsedMs / 1000)
        );
      }
    }

    this.lastFrameTime = timestamp;
    this.ensureScheduledFrame();
  };
}

function createViewerKeyboardZoomInput(): ViewerKeyboardZoomInput {
  return {
    zoomIn: false,
    zoomOut: false
  };
}

function cloneViewerKeyboardZoomInput(input: ViewerKeyboardZoomInput): ViewerKeyboardZoomInput {
  return {
    zoomIn: input.zoomIn,
    zoomOut: input.zoomOut
  };
}

function getNewlyPressedViewerKeyboardZoomInput(
  previousInput: ViewerKeyboardZoomInput,
  nextInput: ViewerKeyboardZoomInput
): ViewerKeyboardZoomInput {
  return {
    zoomIn: nextInput.zoomIn && !previousInput.zoomIn,
    zoomOut: nextInput.zoomOut && !previousInput.zoomOut
  };
}

function hasViewerKeyboardZoomInput(input: ViewerKeyboardZoomInput): boolean {
  return input.zoomIn || input.zoomOut;
}

function hasViewerKeyboardNavigationInput(input: ViewerKeyboardNavigationInput): boolean {
  return input.up || input.left || input.down || input.right;
}

function sameViewerKeyboardZoomInput(
  a: ViewerKeyboardZoomInput,
  b: ViewerKeyboardZoomInput
): boolean {
  return a.zoomIn === b.zoomIn && a.zoomOut === b.zoomOut;
}

function isScreenshotSelectionDragButton(event: PointerEvent): boolean {
  return event.button === 0 || (event.button === 2 && event.ctrlKey);
}

function isThreeDPanDragStart(event: PointerEvent, state: ViewerState): boolean {
  return state.viewerMode === '3d' && (
    event.button === 1 ||
    (event.button === 0 && (event.ctrlKey || event.metaKey))
  );
}

function isViewerContextMenuTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('.viewer-context-menu') !== null;
}

function isValidViewport(viewport: ViewportInfo): boolean {
  return viewport.width > 0 && viewport.height > 0;
}

function isPointInsideViewport(point: PointerPosition, viewport: ViewportInfo): boolean {
  return (
    Number.isFinite(point.x) &&
    Number.isFinite(point.y) &&
    point.x >= 0 &&
    point.x <= viewport.width &&
    point.y >= 0 &&
    point.y <= viewport.height
  );
}

function isPointInsideRect(point: PointerPosition, rect: ViewportRect): boolean {
  return (
    Number.isFinite(point.x) &&
    Number.isFinite(point.y) &&
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  );
}

function filterViewportCoordinates(values: number[], max: number): number[] {
  return values.filter((value) => Number.isFinite(value) && value >= 0 && value <= max);
}

function createViewerKeyboardNavigationInput(): ViewerKeyboardNavigationInput {
  return {
    up: false,
    left: false,
    down: false,
    right: false
  };
}

function createFallbackPane(viewport: ViewportInfo): ViewerPaneRenderInfo {
  return {
    path: [],
    rect: {
      x: 0,
      y: 0,
      width: viewport.width,
      height: viewport.height
    },
    viewport: { ...viewport },
    active: true
  };
}
