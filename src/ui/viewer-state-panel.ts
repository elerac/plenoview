import { clampZoom } from '../interaction/image-geometry';
import {
  type DepthRotationSource,
  clampDepthZoom,
  normalizeDepthFocalLengthPx,
  normalizeDepthPointSize,
  normalizeDepthPitchForSource,
  normalizeDepthYawForSource
} from '../depth';
import {
  clampPanoramaHfov,
  clampPanoramaPitch,
  normalizePanoramaYaw
} from '../interaction/panorama-geometry';
import { DisposableBag, type Disposable } from '../lifecycle';
import type { ViewerStateReadoutModel } from '../app/viewer-app-types';
import type { ViewerSessionState, ViewerViewState } from '../types';
import type { ViewerStatePanelElements } from './elements';

type ViewerStateField = keyof ViewerViewState;

interface ViewerStatePanelCallbacks {
  onViewerViewStateChange: (patch: Partial<ViewerViewState>) => void;
  onDepthSettingsChange: (
    patch: Partial<Pick<ViewerSessionState, 'depthChannel' | 'depthFocalLengthPx' | 'depthPointSizePx'>>
  ) => void;
}

export class ViewerStatePanel implements Disposable {
  private readonly disposables = new DisposableBag();
  private readout: ViewerStateReadoutModel = {
    hasActiveImage: false,
    viewerMode: 'image',
    view: {
      zoom: 1,
      panX: 0,
      panY: 0,
      panoramaYawDeg: 0,
      panoramaPitchDeg: 0,
      panoramaHfovDeg: 100,
      depthYawDeg: 0,
      depthPitchDeg: 0,
      depthZoom: 1
    },
    depth: {
      channel: null,
      sourceKind: null,
      channelOptions: [],
      focalLengthPx: null,
      resolvedFocalLengthPx: null,
      pointSizePx: 2
    }
  };
  private disposed = false;

  constructor(
    private readonly elements: ViewerStatePanelElements,
    private readonly callbacks: ViewerStatePanelCallbacks
  ) {
    this.bindInput(this.elements.viewerStateZoomInput, 'zoom');
    this.bindInput(this.elements.viewerStatePanXInput, 'panX');
    this.bindInput(this.elements.viewerStatePanYInput, 'panY');
    this.bindInput(this.elements.viewerStateYawInput, 'panoramaYawDeg');
    this.bindInput(this.elements.viewerStatePitchInput, 'panoramaPitchDeg');
    this.bindInput(this.elements.viewerStateHfovInput, 'panoramaHfovDeg');
    this.bindInput(this.elements.viewerStateDepthYawInput, 'depthYawDeg');
    this.bindInput(this.elements.viewerStateDepthPitchInput, 'depthPitchDeg');
    this.bindInput(this.elements.viewerStateDepthZoomInput, 'depthZoom');
    this.bindDepthChannelSelect();
    this.bindDepthFocalInput();
    this.bindDepthPointSizeInput();
    this.setReadout(this.readout);
  }

  setReadout(readout: ViewerStateReadoutModel): void {
    if (this.disposed) {
      return;
    }

    const normalizedDepth = normalizeDepthReadout(readout.depth);
    this.readout = {
      hasActiveImage: readout.hasActiveImage,
      viewerMode: readout.viewerMode,
      view: normalizeViewReadout(readout.view, getDepthReadoutRotationSource(normalizedDepth)),
      depth: normalizedDepth
    };

    const imageFieldsActive = readout.hasActiveImage && readout.viewerMode === 'image';
    const panoramaFieldsActive = readout.hasActiveImage && readout.viewerMode === 'panorama';
    const depthFieldsActive = readout.hasActiveImage && readout.viewerMode === 'depth';
    this.elements.viewerStateEmptyState.classList.toggle('hidden', readout.hasActiveImage);
    this.elements.viewerStateImageFields.classList.toggle(
      'hidden',
      !imageFieldsActive
    );
    this.elements.viewerStatePanoramaFields.classList.toggle(
      'hidden',
      !panoramaFieldsActive
    );
    this.elements.viewerStateDepthFields.classList.toggle(
      'hidden',
      !depthFieldsActive
    );

    for (const input of this.getInputs()) {
      input.removeAttribute('aria-invalid');
    }
    this.elements.viewerStateZoomInput.disabled = !imageFieldsActive;
    this.elements.viewerStatePanXInput.disabled = !imageFieldsActive;
    this.elements.viewerStatePanYInput.disabled = !imageFieldsActive;
    this.elements.viewerStateYawInput.disabled = !panoramaFieldsActive;
    this.elements.viewerStatePitchInput.disabled = !panoramaFieldsActive;
    this.elements.viewerStateHfovInput.disabled = !panoramaFieldsActive;
    this.elements.viewerStateDepthChannelSelect.disabled = !depthFieldsActive || normalizedDepth.channelOptions.length === 0;
    const depthFocalInputActive = depthFieldsActive && normalizedDepth.sourceKind !== 'xyzPosition';
    this.elements.viewerStateDepthFocalInput.disabled = !depthFocalInputActive;
    this.elements.viewerStateDepthYawInput.disabled = !depthFieldsActive;
    this.elements.viewerStateDepthPitchInput.disabled = !depthFieldsActive;
    this.elements.viewerStateDepthZoomInput.disabled = !depthFieldsActive;
    this.elements.viewerStateDepthPointSizeInput.disabled = !depthFieldsActive;

    this.elements.viewerStateZoomInput.value = formatViewerStateNumber(readout.view.zoom, 'zoom');
    this.elements.viewerStatePanXInput.value = formatViewerStateNumber(readout.view.panX, 'panX');
    this.elements.viewerStatePanYInput.value = formatViewerStateNumber(readout.view.panY, 'panY');
    this.elements.viewerStateYawInput.value = formatViewerStateNumber(readout.view.panoramaYawDeg, 'panoramaYawDeg');
    this.elements.viewerStatePitchInput.value = formatViewerStateNumber(readout.view.panoramaPitchDeg, 'panoramaPitchDeg');
    this.elements.viewerStateHfovInput.value = formatViewerStateNumber(readout.view.panoramaHfovDeg, 'panoramaHfovDeg');
    const depth = normalizedDepth;
    this.setDepthChannelOptions(depth.channelOptions, depth.channel);
    const focalDisplayValue = formatDepthFocalInputValue(depth);
    this.elements.viewerStateDepthFocalInput.value = focalDisplayValue;
    this.elements.viewerStateDepthFocalInput.placeholder = '';
    this.elements.viewerStateDepthFocalInput.title = depth.sourceKind === 'xyzPosition'
      ? 'Focal length applies to scalar depth sources.'
      : focalDisplayValue;
    const view = normalizeViewReadout(readout.view, getDepthReadoutRotationSource(depth));
    this.elements.viewerStateDepthYawInput.value = formatViewerStateNumber(view.depthYawDeg, 'depthYawDeg');
    this.elements.viewerStateDepthPitchInput.value = formatViewerStateNumber(view.depthPitchDeg, 'depthPitchDeg');
    this.elements.viewerStateDepthZoomInput.value = formatViewerStateNumber(view.depthZoom, 'depthZoom');
    this.elements.viewerStateDepthPointSizeInput.value = formatCompactNumber(depth.pointSizePx, 2);
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.disposables.dispose();
  }

  private bindInput(input: HTMLInputElement, field: ViewerStateField): void {
    this.disposables.addEventListener(input, 'keydown', (event) => {
      if (event.key !== 'Enter') {
        return;
      }

      event.preventDefault();
      this.commitField(input, field);
    });
    this.disposables.addEventListener(input, 'blur', () => {
      this.commitField(input, field);
    });
  }

  private commitField(input: HTMLInputElement, field: ViewerStateField): void {
    if (this.disposed || input.disabled || !this.readout.hasActiveImage) {
      return;
    }

    const text = input.value.trim();
    const value = Number(text);
    if (!text || !Number.isFinite(value)) {
      input.setAttribute('aria-invalid', 'true');
      return;
    }

    const normalized = normalizeViewerStateField(
      field,
      value,
      getDepthReadoutRotationSource(normalizeDepthReadout(this.readout.depth))
    );
    input.removeAttribute('aria-invalid');
    input.value = formatViewerStateNumber(normalized, field);

    if (this.readout.view[field] === normalized) {
      return;
    }

    const patch: Partial<ViewerViewState> = {};
    patch[field] = normalized;
    this.callbacks.onViewerViewStateChange(patch);
  }

  private bindDepthChannelSelect(): void {
    this.disposables.addEventListener(this.elements.viewerStateDepthChannelSelect, 'change', () => {
      const select = this.elements.viewerStateDepthChannelSelect;
      if (this.disposed || select.disabled || !this.readout.hasActiveImage) {
        return;
      }

      this.callbacks.onDepthSettingsChange({
        depthChannel: select.value || null
      });
    });
  }

  private bindDepthFocalInput(): void {
    const input = this.elements.viewerStateDepthFocalInput;
    this.disposables.addEventListener(input, 'keydown', (event) => {
      if (event.key !== 'Enter') {
        return;
      }

      event.preventDefault();
      this.commitDepthFocalInput();
    });
    this.disposables.addEventListener(input, 'blur', () => {
      this.commitDepthFocalInput();
    });
  }

  private commitDepthFocalInput(): void {
    const input = this.elements.viewerStateDepthFocalInput;
    if (this.disposed || input.disabled || !this.readout.hasActiveImage) {
      return;
    }

    const text = input.value.trim();
    if (!text) {
      input.removeAttribute('aria-invalid');
      input.value = '';
      input.title = '';
      if (normalizeDepthReadout(this.readout.depth).focalLengthPx !== null) {
        this.callbacks.onDepthSettingsChange({ depthFocalLengthPx: null });
      }
      return;
    }

    const value = Number(text);
    const normalized = normalizeDepthFocalLengthPx(value);
    if (normalized === null) {
      input.setAttribute('aria-invalid', 'true');
      return;
    }

    input.removeAttribute('aria-invalid');
    input.value = formatCompactNumber(normalized, 2);
    input.title = input.value;
    const depth = normalizeDepthReadout(this.readout.depth);
    if (depth.focalLengthPx === null && normalized === depth.resolvedFocalLengthPx) {
      return;
    }

    if (depth.focalLengthPx !== normalized) {
      this.callbacks.onDepthSettingsChange({ depthFocalLengthPx: normalized });
    }
  }

  private bindDepthPointSizeInput(): void {
    const input = this.elements.viewerStateDepthPointSizeInput;
    this.disposables.addEventListener(input, 'keydown', (event) => {
      if (event.key !== 'Enter') {
        return;
      }

      event.preventDefault();
      this.commitDepthPointSizeInput();
    });
    this.disposables.addEventListener(input, 'blur', () => {
      this.commitDepthPointSizeInput();
    });
  }

  private commitDepthPointSizeInput(): void {
    const input = this.elements.viewerStateDepthPointSizeInput;
    if (this.disposed || input.disabled || !this.readout.hasActiveImage) {
      return;
    }

    const value = Number(input.value.trim());
    if (!Number.isFinite(value)) {
      input.setAttribute('aria-invalid', 'true');
      return;
    }

    const normalized = normalizeDepthPointSize(value);
    input.removeAttribute('aria-invalid');
    input.value = formatCompactNumber(normalized, 2);
    if (normalizeDepthReadout(this.readout.depth).pointSizePx !== normalized) {
      this.callbacks.onDepthSettingsChange({ depthPointSizePx: normalized });
    }
  }

  private getInputs(): HTMLInputElement[] {
    return [
      this.elements.viewerStateZoomInput,
      this.elements.viewerStatePanXInput,
      this.elements.viewerStatePanYInput,
      this.elements.viewerStateYawInput,
      this.elements.viewerStatePitchInput,
      this.elements.viewerStateHfovInput,
      this.elements.viewerStateDepthFocalInput,
      this.elements.viewerStateDepthYawInput,
      this.elements.viewerStateDepthPitchInput,
      this.elements.viewerStateDepthZoomInput,
      this.elements.viewerStateDepthPointSizeInput
    ];
  }

  private setDepthChannelOptions(
    options: NonNullable<ViewerStateReadoutModel['depth']>['channelOptions'],
    activeChannel: string | null
  ): void {
    const select = this.elements.viewerStateDepthChannelSelect;
    const nextKey = options.map((option) => `${option.value}\n${option.label}`).join('\n\n');
    if (select.dataset.optionsKey !== nextKey) {
      select.replaceChildren(
        ...options.map((option) => {
          const item = document.createElement('option');
          item.value = option.value;
          item.textContent = option.label;
          return item;
        })
      );
      select.dataset.optionsKey = nextKey;
    }

    select.value = activeChannel ?? options[0]?.value ?? '';
  }
}

function normalizeViewerStateField(
  field: ViewerStateField,
  value: number,
  depthSource: DepthRotationSource = null
): number {
  switch (field) {
    case 'zoom':
      return clampZoom(value);
    case 'panX':
    case 'panY':
      return value;
    case 'panoramaYawDeg':
      return normalizePanoramaYaw(value);
    case 'panoramaPitchDeg':
      return clampPanoramaPitch(value);
    case 'panoramaHfovDeg':
      return clampPanoramaHfov(value);
    case 'depthYawDeg':
      return normalizeDepthYawForSource(value, depthSource);
    case 'depthPitchDeg':
      return normalizeDepthPitchForSource(value, depthSource);
    case 'depthZoom':
      return clampDepthZoom(value);
    default:
      throw new Error(`Unknown viewer state field: ${field satisfies never}`);
  }
}

function formatViewerStateNumber(value: number, field: ViewerStateField): string {
  if (!Number.isFinite(value)) {
    return '0';
  }

  switch (field) {
    case 'zoom':
      return formatCompactNumber(value, Math.abs(value) < 1 ? 3 : 2);
    case 'panX':
    case 'panY':
    case 'panoramaYawDeg':
    case 'panoramaPitchDeg':
    case 'panoramaHfovDeg':
    case 'depthYawDeg':
    case 'depthPitchDeg':
      return formatCompactNumber(value, 2);
    case 'depthZoom':
      return formatCompactNumber(value, 2);
    default:
      throw new Error(`Unknown viewer state field: ${field satisfies never}`);
  }
}

function normalizeDepthReadout(
  depth: ViewerStateReadoutModel['depth']
): NonNullable<ViewerStateReadoutModel['depth']> {
  return {
    channel: depth?.channel ?? null,
    sourceKind: depth?.sourceKind ?? null,
    channelOptions: [...(depth?.channelOptions ?? [])],
    focalLengthPx: depth?.focalLengthPx ?? null,
    resolvedFocalLengthPx: depth?.resolvedFocalLengthPx ?? null,
    pointSizePx: depth?.pointSizePx ?? 2
  };
}

function getDepthReadoutRotationSource(
  depth: NonNullable<ViewerStateReadoutModel['depth']>
): DepthRotationSource {
  return depth.sourceKind ?? depth.channel;
}

function formatDepthFocalInputValue(depth: NonNullable<ViewerStateReadoutModel['depth']>): string {
  const value = depth.focalLengthPx ?? depth.resolvedFocalLengthPx;
  return value === null ? '' : formatCompactNumber(value, 2);
}

function normalizeViewReadout(
  view: ViewerStateReadoutModel['view'],
  depthSource: DepthRotationSource = null
): ViewerViewState {
  return {
    zoom: view.zoom,
    panX: view.panX,
    panY: view.panY,
    panoramaYawDeg: view.panoramaYawDeg,
    panoramaPitchDeg: view.panoramaPitchDeg,
    panoramaHfovDeg: view.panoramaHfovDeg,
    depthYawDeg: normalizeDepthYawForSource(view.depthYawDeg ?? 0, depthSource),
    depthPitchDeg: normalizeDepthPitchForSource(view.depthPitchDeg ?? 0, depthSource),
    depthZoom: clampDepthZoom(view.depthZoom ?? 1)
  };
}

function formatCompactNumber(value: number, fractionDigits: number): string {
  const rounded = Number(value.toFixed(fractionDigits));
  return Object.is(rounded, -0) ? '0' : rounded.toString();
}
