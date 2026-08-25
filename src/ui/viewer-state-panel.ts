import { clampZoom } from '../interaction/image-geometry';
import {
  type DepthRotationSource,
  clampDepthZoom,
  normalizeDepthTarget,
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
import {
  createDefaultEnvironmentSphereMaterial,
  normalizeEnvironmentSphereMaterial,
  type EnvironmentSphereDiffuseReflectance,
  type EnvironmentSphereMaterialPatch
} from '../environment-sphere-material';
import type { ViewerStateReadoutModel } from '../app/viewer-app-types';
import type { ViewerSessionState, ViewerViewState } from '../types';
import type { ViewerStatePanelElements } from './elements';

type ViewerStateField = keyof ViewerViewState;
type EnvironmentDiffuseField = keyof EnvironmentSphereDiffuseReflectance;
type EnvironmentMaterialNumberField = 'alpha' | 'intIor' | 'extIor';

interface ViewerStatePanelCallbacks {
  onViewerViewStateChange: (patch: Partial<ViewerViewState>) => void;
  onDepthSettingsChange: (
    patch: Partial<Pick<ViewerSessionState, 'depthChannel' | 'depthFocalLengthPx' | 'depthPointSizePx'>>
  ) => void;
  onEnvironmentSphereMaterialChange: (patch: EnvironmentSphereMaterialPatch) => void;
}

export class ViewerStatePanel implements Disposable {
  private readonly disposables = new DisposableBag();
  private readout: ViewerStateReadoutModel = {
    hasActiveImage: false,
    viewerMode: 'image',
    panoramaDisplayMode: 'image',
    panoramaLightingMethod: 'sphericalHarmonics',
    environmentSphereMaterial: createDefaultEnvironmentSphereMaterial(),
    view: {
      zoom: 1,
      panX: 0,
      panY: 0,
      panoramaYawDeg: 0,
      panoramaPitchDeg: 0,
      panoramaHfovDeg: 100,
      depthYawDeg: 0,
      depthPitchDeg: 0,
      depthZoom: 1,
      depthTargetX: 0,
      depthTargetY: 0,
      depthTargetZ: 0
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
    this.bindEnvironmentDiffuseInput(this.elements.viewerStateEnvironmentDiffuseRInput, 'r');
    this.bindEnvironmentDiffuseInput(this.elements.viewerStateEnvironmentDiffuseGInput, 'g');
    this.bindEnvironmentDiffuseInput(this.elements.viewerStateEnvironmentDiffuseBInput, 'b');
    this.bindEnvironmentMaterialNumberInput(this.elements.viewerStateEnvironmentAlphaInput, 'alpha');
    this.bindEnvironmentMaterialNumberInput(this.elements.viewerStateEnvironmentIntIorInput, 'intIor');
    this.bindEnvironmentMaterialNumberInput(this.elements.viewerStateEnvironmentExtIorInput, 'extIor');
    this.bindEnvironmentDistributionSelect();
    this.bindEnvironmentNonlinearCheckbox();
    this.bindInput(this.elements.viewerStateDepthYawInput, 'depthYawDeg');
    this.bindInput(this.elements.viewerStateDepthPitchInput, 'depthPitchDeg');
    this.bindInput(this.elements.viewerStateDepthZoomInput, 'depthZoom');
    this.bindInput(this.elements.viewerStateDepthTargetXInput, 'depthTargetX');
    this.bindInput(this.elements.viewerStateDepthTargetYInput, 'depthTargetY');
    this.bindInput(this.elements.viewerStateDepthTargetZInput, 'depthTargetZ');
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
    const panoramaDisplayMode = readout.panoramaDisplayMode ?? 'image';
    const panoramaLightingMethod = readout.panoramaLightingMethod ?? 'sphericalHarmonics';
    const environmentSphereMaterial = normalizeEnvironmentSphereMaterial(readout.environmentSphereMaterial);
    this.readout = {
      hasActiveImage: readout.hasActiveImage,
      viewerMode: readout.viewerMode,
      panoramaDisplayMode,
      panoramaLightingMethod,
      environmentSphereMaterial,
      view: normalizeViewReadout(readout.view, getDepthReadoutRotationSource(normalizedDepth)),
      depth: normalizedDepth
    };

    const imageFieldsActive = readout.hasActiveImage && readout.viewerMode === 'image';
    const panoramaFieldsActive = readout.hasActiveImage && readout.viewerMode === 'panorama';
    const environmentMaterialFieldsActive = panoramaFieldsActive && panoramaDisplayMode === 'environmentLighting';
    const depthFieldsActive = readout.hasActiveImage && readout.viewerMode === '3d';
    this.elements.viewerStateEmptyState.classList.toggle('hidden', readout.hasActiveImage);
    this.elements.viewerStateImageFields.classList.toggle(
      'hidden',
      !imageFieldsActive
    );
    this.elements.viewerStatePanoramaFields.classList.toggle(
      'hidden',
      !panoramaFieldsActive
    );
    this.elements.viewerStateEnvironmentMaterialFields.classList.toggle(
      'hidden',
      !environmentMaterialFieldsActive
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
    this.elements.viewerStateEnvironmentDiffuseRInput.disabled = !environmentMaterialFieldsActive;
    this.elements.viewerStateEnvironmentDiffuseGInput.disabled = !environmentMaterialFieldsActive;
    this.elements.viewerStateEnvironmentDiffuseBInput.disabled = !environmentMaterialFieldsActive;
    this.elements.viewerStateEnvironmentAlphaInput.disabled = !environmentMaterialFieldsActive;
    this.elements.viewerStateEnvironmentIntIorInput.disabled = !environmentMaterialFieldsActive;
    this.elements.viewerStateEnvironmentExtIorInput.disabled = !environmentMaterialFieldsActive;
    this.elements.viewerStateEnvironmentDistributionSelect.disabled = !environmentMaterialFieldsActive;
    this.elements.viewerStateEnvironmentNonlinearCheckbox.disabled = !environmentMaterialFieldsActive;
    this.elements.viewerStateDepthChannelSelect.disabled = !depthFieldsActive || normalizedDepth.channelOptions.length === 0;
    const depthFocalVisible = depthFieldsActive && normalizedDepth.sourceKind !== 'xyzPosition';
    this.elements.viewerStateDepthFocalLabel.classList.toggle('hidden', !depthFocalVisible);
    this.elements.viewerStateDepthFocalInput.classList.toggle('hidden', !depthFocalVisible);
    this.elements.viewerStateDepthFocalInput.disabled = !depthFocalVisible;
    this.elements.viewerStateDepthYawInput.disabled = !depthFieldsActive;
    this.elements.viewerStateDepthPitchInput.disabled = !depthFieldsActive;
    this.elements.viewerStateDepthZoomInput.disabled = !depthFieldsActive;
    this.elements.viewerStateDepthTargetXInput.disabled = !depthFieldsActive;
    this.elements.viewerStateDepthTargetYInput.disabled = !depthFieldsActive;
    this.elements.viewerStateDepthTargetZInput.disabled = !depthFieldsActive;
    this.elements.viewerStateDepthPointSizeInput.disabled = !depthFieldsActive;

    this.elements.viewerStateZoomInput.value = formatViewerStateNumber(readout.view.zoom, 'zoom');
    this.elements.viewerStatePanXInput.value = formatViewerStateNumber(readout.view.panX, 'panX');
    this.elements.viewerStatePanYInput.value = formatViewerStateNumber(readout.view.panY, 'panY');
    this.elements.viewerStateYawInput.value = formatViewerStateNumber(readout.view.panoramaYawDeg, 'panoramaYawDeg');
    this.elements.viewerStatePitchInput.value = formatViewerStateNumber(readout.view.panoramaPitchDeg, 'panoramaPitchDeg');
    this.elements.viewerStateHfovInput.value = formatViewerStateNumber(readout.view.panoramaHfovDeg, 'panoramaHfovDeg');
    this.elements.viewerStateEnvironmentDiffuseRInput.value = formatEnvironmentMaterialNumber(
      environmentSphereMaterial.diffuseReflectance.r,
      'diffuse'
    );
    this.elements.viewerStateEnvironmentDiffuseGInput.value = formatEnvironmentMaterialNumber(
      environmentSphereMaterial.diffuseReflectance.g,
      'diffuse'
    );
    this.elements.viewerStateEnvironmentDiffuseBInput.value = formatEnvironmentMaterialNumber(
      environmentSphereMaterial.diffuseReflectance.b,
      'diffuse'
    );
    this.elements.viewerStateEnvironmentAlphaInput.value = formatEnvironmentMaterialNumber(
      environmentSphereMaterial.alpha,
      'alpha'
    );
    this.elements.viewerStateEnvironmentIntIorInput.value = formatEnvironmentMaterialNumber(
      environmentSphereMaterial.intIor,
      'ior'
    );
    this.elements.viewerStateEnvironmentExtIorInput.value = formatEnvironmentMaterialNumber(
      environmentSphereMaterial.extIor,
      'ior'
    );
    this.elements.viewerStateEnvironmentDistributionSelect.value = environmentSphereMaterial.distribution;
    this.elements.viewerStateEnvironmentNonlinearCheckbox.checked = environmentSphereMaterial.nonlinear;
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
    this.elements.viewerStateDepthTargetXInput.value = formatViewerStateNumber(view.depthTargetX, 'depthTargetX');
    this.elements.viewerStateDepthTargetYInput.value = formatViewerStateNumber(view.depthTargetY, 'depthTargetY');
    this.elements.viewerStateDepthTargetZInput.value = formatViewerStateNumber(view.depthTargetZ, 'depthTargetZ');
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

  private bindEnvironmentDiffuseInput(input: HTMLInputElement, field: EnvironmentDiffuseField): void {
    this.bindEnvironmentNumberInput(input, () => this.commitEnvironmentDiffuseInput(input, field));
  }

  private bindEnvironmentMaterialNumberInput(
    input: HTMLInputElement,
    field: EnvironmentMaterialNumberField
  ): void {
    this.bindEnvironmentNumberInput(input, () => this.commitEnvironmentMaterialNumberInput(input, field));
  }

  private bindEnvironmentNumberInput(input: HTMLInputElement, commit: () => void): void {
    this.disposables.addEventListener(input, 'keydown', (event) => {
      if (event.key !== 'Enter') {
        return;
      }

      event.preventDefault();
      commit();
    });
    this.disposables.addEventListener(input, 'blur', commit);
  }

  private commitEnvironmentDiffuseInput(input: HTMLInputElement, field: EnvironmentDiffuseField): void {
    const value = this.readEnvironmentNumberInput(input);
    if (value === null) {
      return;
    }

    const material = normalizeEnvironmentSphereMaterial(this.readout.environmentSphereMaterial);
    const normalized = normalizeEnvironmentSphereMaterial({
      diffuseReflectance: { [field]: value }
    }, material).diffuseReflectance[field];
    input.removeAttribute('aria-invalid');
    input.value = formatEnvironmentMaterialNumber(normalized, 'diffuse');
    if (material.diffuseReflectance[field] !== normalized) {
      this.callbacks.onEnvironmentSphereMaterialChange({
        diffuseReflectance: { [field]: normalized }
      });
    }
  }

  private commitEnvironmentMaterialNumberInput(
    input: HTMLInputElement,
    field: EnvironmentMaterialNumberField
  ): void {
    const value = this.readEnvironmentNumberInput(input);
    if (value === null) {
      return;
    }

    const material = normalizeEnvironmentSphereMaterial(this.readout.environmentSphereMaterial);
    const normalizedMaterial = normalizeEnvironmentSphereMaterial({ [field]: value }, material);
    const normalized = normalizedMaterial[field];
    input.removeAttribute('aria-invalid');
    input.value = formatEnvironmentMaterialNumber(normalized, field === 'alpha' ? 'alpha' : 'ior');
    if (material[field] !== normalized) {
      this.callbacks.onEnvironmentSphereMaterialChange({ [field]: normalized });
    }
  }

  private readEnvironmentNumberInput(input: HTMLInputElement): number | null {
    if (this.disposed || input.disabled || !this.readout.hasActiveImage) {
      return null;
    }

    const text = input.value.trim();
    const value = Number(text);
    if (!text || !Number.isFinite(value)) {
      input.setAttribute('aria-invalid', 'true');
      return null;
    }
    return value;
  }

  private bindEnvironmentDistributionSelect(): void {
    this.disposables.addEventListener(this.elements.viewerStateEnvironmentDistributionSelect, 'change', () => {
      const select = this.elements.viewerStateEnvironmentDistributionSelect;
      if (this.disposed || select.disabled || !this.readout.hasActiveImage) {
        return;
      }

      const distribution = select.value === 'ggx' ? 'ggx' : 'beckmann';
      const material = normalizeEnvironmentSphereMaterial(this.readout.environmentSphereMaterial);
      if (material.distribution !== distribution) {
        this.callbacks.onEnvironmentSphereMaterialChange({ distribution });
      }
    });
  }

  private bindEnvironmentNonlinearCheckbox(): void {
    this.disposables.addEventListener(this.elements.viewerStateEnvironmentNonlinearCheckbox, 'change', () => {
      const checkbox = this.elements.viewerStateEnvironmentNonlinearCheckbox;
      if (this.disposed || checkbox.disabled || !this.readout.hasActiveImage) {
        return;
      }

      const material = normalizeEnvironmentSphereMaterial(this.readout.environmentSphereMaterial);
      if (material.nonlinear !== checkbox.checked) {
        this.callbacks.onEnvironmentSphereMaterialChange({ nonlinear: checkbox.checked });
      }
    });
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
      this.elements.viewerStateEnvironmentDiffuseRInput,
      this.elements.viewerStateEnvironmentDiffuseGInput,
      this.elements.viewerStateEnvironmentDiffuseBInput,
      this.elements.viewerStateEnvironmentAlphaInput,
      this.elements.viewerStateEnvironmentIntIorInput,
      this.elements.viewerStateEnvironmentExtIorInput,
      this.elements.viewerStateEnvironmentNonlinearCheckbox,
      this.elements.viewerStateDepthFocalInput,
      this.elements.viewerStateDepthYawInput,
      this.elements.viewerStateDepthPitchInput,
      this.elements.viewerStateDepthZoomInput,
      this.elements.viewerStateDepthTargetXInput,
      this.elements.viewerStateDepthTargetYInput,
      this.elements.viewerStateDepthTargetZInput,
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
    case 'depthTargetX':
    case 'depthTargetY':
    case 'depthTargetZ':
      return normalizeDepthTarget(value);
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
    case 'depthTargetX':
    case 'depthTargetY':
    case 'depthTargetZ':
      return formatCompactNumber(value, 2);
    case 'depthZoom':
      return formatCompactNumber(value, 2);
    default:
      throw new Error(`Unknown viewer state field: ${field satisfies never}`);
  }
}

function formatEnvironmentMaterialNumber(
  value: number,
  field: 'diffuse' | 'alpha' | 'ior'
): string {
  return formatCompactNumber(value, field === 'ior' ? 6 : 3);
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
    depthZoom: clampDepthZoom(view.depthZoom ?? 1),
    depthTargetX: normalizeDepthTarget(view.depthTargetX ?? 0),
    depthTargetY: normalizeDepthTarget(view.depthTargetY ?? 0),
    depthTargetZ: normalizeDepthTarget(view.depthTargetZ ?? 0)
  };
}

function formatCompactNumber(value: number, fractionDigits: number): string {
  const rounded = Number(value.toFixed(fractionDigits));
  return Object.is(rounded, -0) ? '0' : rounded.toString();
}
