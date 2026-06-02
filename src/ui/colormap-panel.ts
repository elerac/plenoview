import { buildZeroCenteredColormapRange } from '../colormap-range';
import { DEFAULT_DISPLAY_GAMMA, normalizeDisplayGamma } from '../color';
import { ColormapLut, sampleColormapRgbBytes } from '../colormaps';
import { DisposableBag, type Disposable } from '../lifecycle';
import type { DisplayLuminanceRange, StokesAolpDegreeModulationMode, VisualizationMode } from '../types';
import type { ColormapPanelElements } from './elements';
import { syncSelectOptions } from './render-helpers';

const COLORMAP_ZERO_CENTER_SLIDER_MIN_MAGNITUDE = 1e-16;
const COLORMAP_GRADIENT_STOP_COUNT = 16;
const NONE_COLORMAP_OPTION_VALUE = '__prismifold-none__';
const DEFAULT_COLORMAP_GRADIENT = 'linear-gradient(90deg, #d95656 0%, #05070a 50%, #59d884 100%)';
const DEFAULT_COLORMAP_GRADIENT_REVERSED = 'linear-gradient(90deg, #59d884 0%, #05070a 50%, #d95656 100%)';
const DISPLAY_GAMMA_MAGNET_TARGET = DEFAULT_DISPLAY_GAMMA;
const DISPLAY_GAMMA_MAGNET_RADIUS = 0.05;
const DISPLAY_GAMMA_MAGNET_EPSILON = 1e-12;
const DEFAULT_EXPOSURE_EV = 0;
const DEFAULT_COLORMAP_EXPOSURE_EV = 0;
const DEFAULT_COLORMAP_GAMMA = 1;
const COLORMAP_GAMMA_MIN = 0.2;
const COLORMAP_GAMMA_MAX = 5;
const COLORMAP_INPUT_MIN_SIGNIFICANT_DIGITS = 4;
const COLORMAP_INPUT_MAX_SIGNIFICANT_DIGITS = 7;
const COLORMAP_INPUT_FALLBACK_CHARACTER_BUDGET = 9;
const COLORMAP_INPUT_RESERVED_INLINE_PX = 16;

interface ColormapPanelCallbacks {
  onExposureChange: (value: number) => void;
  onExposureCommit: () => void;
  onDisplayGammaChange: (value: number) => void;
  onDisplayGammaCommit: () => void;
  onColormapChange: (colormapId: string | null) => void;
  onColormapExposureChange: (value: number) => void;
  onColormapGammaChange: (value: number) => void;
  onColormapRangeChange: (range: DisplayLuminanceRange) => void;
  onColormapRangeReset: () => void;
  onColormapZeroCenterToggle: () => void;
  onColormapReverseToggle: () => void;
  onStokesDegreeModulationToggle: () => void;
  onStokesAolpDegreeModulationModeChange: (mode: StokesAolpDegreeModulationMode) => void;
}

export class ColormapPanel implements Disposable {
  private readonly disposables = new DisposableBag();
  private isLoading = false;
  private openedImageCount = 0;
  private currentColormapRange: DisplayLuminanceRange | null = null;
  private currentAutoColormapRange: DisplayLuminanceRange | null = null;
  private currentColormapLut: ColormapLut | null = null;
  private currentColormapZeroCentered = false;
  private currentColormapReversed = false;
  private isColormapEnabled = false;
  private hasColormapOptions = false;
  private disposed = false;

  constructor(
    private readonly elements: ColormapPanelElements,
    private readonly callbacks: ColormapPanelCallbacks
  ) {
    this.elements.colormapSelect.disabled = true;
    this.elements.stokesDegreeModulationButton.disabled = true;
    this.setStokesAolpModulationModeButtonsDisabled(true);
    this.updateDisabledStates();

    this.disposables.addEventListener(this.elements.colormapSelect, 'change', (event) => {
      if (this.elements.colormapSelect.disabled) {
        return;
      }

      const target = event.currentTarget as HTMLSelectElement;
      this.callbacks.onColormapChange(target.value === NONE_COLORMAP_OPTION_VALUE ? null : target.value);
    });

    this.disposables.addEventListener(this.elements.colormapRangeResetLabel, 'dblclick', () => {
      if (this.elements.colormapRangeResetLabel.getAttribute('aria-disabled') === 'true') {
        return;
      }

      this.callbacks.onColormapRangeReset();
    });

    this.disposables.addEventListener(this.elements.colormapZeroCenterButton, 'change', () => {
      if (this.elements.colormapZeroCenterButton.disabled) {
        return;
      }

      this.callbacks.onColormapZeroCenterToggle();
    });

    this.disposables.addEventListener(this.elements.colormapReverseButton, 'change', () => {
      if (this.elements.colormapReverseButton.disabled) {
        return;
      }

      this.callbacks.onColormapReverseToggle();
    });

    this.disposables.addEventListener(this.elements.stokesDegreeModulationButton, 'click', () => {
      if (this.elements.stokesDegreeModulationButton.disabled) {
        return;
      }

      this.callbacks.onStokesDegreeModulationToggle();
    });
    this.bindStokesAolpModulationModeButton(this.elements.stokesAolpModulationValueButton, 'value');
    this.bindStokesAolpModulationModeButton(this.elements.stokesAolpModulationSaturationButton, 'saturation');

    this.disposables.addEventListener(this.elements.colormapVminSlider, 'input', () => {
      this.commitColormapMin(Number(this.elements.colormapVminSlider.value));
    });

    this.disposables.addEventListener(this.elements.colormapVmaxSlider, 'input', () => {
      this.commitColormapMax(Number(this.elements.colormapVmaxSlider.value));
    });

    this.disposables.addEventListener(this.elements.colormapVminInput, 'change', () => {
      this.commitColormapMin(Number(this.elements.colormapVminInput.value));
    });
    this.disposables.addEventListener(this.elements.colormapVminInput, 'blur', () => {
      this.syncColormapRangeInputValues();
    });

    this.disposables.addEventListener(this.elements.colormapVmaxInput, 'change', () => {
      this.commitColormapMax(Number(this.elements.colormapVmaxInput.value));
    });
    this.disposables.addEventListener(this.elements.colormapVmaxInput, 'blur', () => {
      this.syncColormapRangeInputValues();
    });

    this.bindExposureControl(this.elements.exposureSlider, this.elements.exposureValue);
    this.bindGammaControl(this.elements.gammaSlider, this.elements.gammaValue);
    this.bindColormapExposureControl(this.elements.colormapExposureSlider, this.elements.colormapExposureValue);
    this.bindColormapGammaControl(this.elements.colormapGammaSlider, this.elements.colormapGammaValue);
    this.bindResettableControlLabel(this.elements.exposureSlider, () => {
      this.setExposure(DEFAULT_EXPOSURE_EV);
      this.callbacks.onExposureChange(DEFAULT_EXPOSURE_EV);
      this.callbacks.onExposureCommit();
    }, 'Double-click to reset exposure');
    this.bindResettableControlLabel(this.elements.gammaSlider, () => {
      this.setDisplayGamma(DEFAULT_DISPLAY_GAMMA);
      this.callbacks.onDisplayGammaChange(DEFAULT_DISPLAY_GAMMA);
      this.callbacks.onDisplayGammaCommit();
    }, 'Double-click to reset gamma');
    this.bindResettableControlLabel(this.elements.colormapExposureSlider, () => {
      this.setColormapExposure(DEFAULT_COLORMAP_EXPOSURE_EV);
      this.callbacks.onColormapExposureChange(DEFAULT_COLORMAP_EXPOSURE_EV);
    }, 'Double-click to reset EV');
    this.bindResettableControlLabel(this.elements.colormapGammaSlider, () => {
      this.setColormapGamma(DEFAULT_COLORMAP_GAMMA);
      this.callbacks.onColormapGammaChange(DEFAULT_COLORMAP_GAMMA);
    }, 'Double-click to reset Gamma');
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.disposables.dispose();
  }

  setLoading(loading: boolean): void {
    if (this.disposed) {
      return;
    }

    this.isLoading = loading;
    this.updateDisabledStates();
    this.updateStokesDegreeModulationDisabled();
  }

  setOpenedImageCount(count: number): void {
    if (this.disposed) {
      return;
    }

    this.openedImageCount = count;
    this.updateDisabledStates();
    this.updateStokesDegreeModulationDisabled();
  }

  setExposure(exposureEv: number): void {
    if (this.disposed) {
      return;
    }

    for (const control of this.getExposureControls()) {
      control.slider.value = exposureEv.toFixed(1);
      control.value.value = exposureEv.toFixed(1);
    }
  }

  setDisplayGamma(displayGamma: number): void {
    if (this.disposed) {
      return;
    }

    const value = formatDisplayGammaInputValue(displayGamma);
    this.elements.gammaSlider.value = value;
    this.elements.gammaValue.value = value;
  }

  setColormapExposure(exposureEv: number): void {
    if (this.disposed) {
      return;
    }

    const value = formatColormapExposureInputValue(exposureEv);
    this.elements.colormapExposureSlider.value = value;
    this.elements.colormapExposureValue.value = value;
  }

  setColormapGamma(gamma: number): void {
    if (this.disposed) {
      return;
    }

    const value = formatColormapGammaInputValue(gamma);
    this.elements.colormapGammaSlider.value = value;
    this.elements.colormapGammaValue.value = value;
  }

  setVisualizationMode(mode: VisualizationMode): void {
    if (this.disposed) {
      return;
    }

    this.isColormapEnabled = mode === 'colormap';
    this.elements.colormapRangeControl.classList.toggle('hidden', !this.isColormapEnabled);
    this.elements.exposureControl.classList.toggle('hidden', this.isColormapEnabled);
    this.updateDisabledStates();
    this.updateStokesDegreeModulationDisabled();
  }

  setColormapOptions(items: Array<{ id: string; label: string }>, activeId: string | null): void {
    if (this.disposed) {
      return;
    }

    this.hasColormapOptions = true;
    const hadFocus = document.activeElement === this.elements.colormapSelect;
    syncSelectOptions(
      this.elements.colormapSelect,
      [
        {
          value: NONE_COLORMAP_OPTION_VALUE,
          label: 'None'
        },
        ...items.map((item) => ({
          value: item.id,
          label: item.label
        }))
      ]
    );

    this.setActiveColormap(activeId);
    this.updateDisabledStates();

    if (hadFocus && !this.elements.colormapSelect.disabled) {
      this.elements.colormapSelect.focus();
    }
  }

  setActiveColormap(activeId: string | null): void {
    if (this.disposed) {
      return;
    }

    if (!this.hasColormapOptions) {
      this.elements.colormapSelect.value = '';
      return;
    }

    const optionValue = activeId ?? NONE_COLORMAP_OPTION_VALUE;
    const hasOption = Array.from(this.elements.colormapSelect.options).some(
      (option) => option.value === optionValue
    );
    this.elements.colormapSelect.value = hasOption ? optionValue : this.elements.colormapSelect.options[0]?.value ?? '';
  }

  setColormapGradient(lut: ColormapLut | null, reversed = this.currentColormapReversed): void {
    if (this.disposed) {
      return;
    }

    this.currentColormapLut = lut;
    this.elements.colormapRangeSlider.style.setProperty(
      '--colormap-gradient',
      lut
        ? buildColormapCssGradient(lut, reversed)
        : (reversed ? DEFAULT_COLORMAP_GRADIENT_REVERSED : DEFAULT_COLORMAP_GRADIENT)
    );
  }

  setColormapReversed(reversed: boolean): void {
    if (this.disposed) {
      return;
    }

    this.currentColormapReversed = reversed;
    this.elements.colormapReverseButton.checked = reversed;
    this.setColormapGradient(this.currentColormapLut, reversed);
  }

  setColormapRange(
    range: DisplayLuminanceRange | null,
    autoRange: DisplayLuminanceRange | null,
    alwaysAuto = false,
    zeroCentered = false
  ): void {
    if (this.disposed) {
      return;
    }

    this.currentColormapRange = cloneRange(range);
    this.currentAutoColormapRange = cloneRange(autoRange);
    this.currentColormapZeroCentered = zeroCentered;
    this.elements.colormapRangeResetLabel.dataset.rangeMode = alwaysAuto ? 'alwaysAuto' : 'manual';
    this.elements.colormapZeroCenterButton.checked = zeroCentered;

    this.updateDisabledStates();

    if (!range) {
      this.setColormapRangeValues({ min: 0, max: 1 }, { min: 0, max: 1 });
      return;
    }

    this.setColormapRangeValues(range, autoRange ?? range);
  }

  setStokesDegreeModulationControl(
    label: string | null,
    enabled = false,
    showAolpMode = false,
    aolpMode: StokesAolpDegreeModulationMode = 'value'
  ): void {
    if (this.disposed) {
      return;
    }

    const visible = Boolean(label);
    this.elements.stokesDegreeModulationControl.classList.toggle('hidden', !visible);
    this.elements.stokesAolpModulationModeControl.classList.toggle('hidden', !visible || !showAolpMode);
    if (label) {
      this.elements.stokesDegreeModulationButton.textContent = `${label} Modulation`;
    }
    this.elements.stokesDegreeModulationButton.setAttribute('aria-pressed', enabled ? 'true' : 'false');
    this.setStokesAolpModulationMode(aolpMode);
    this.updateStokesDegreeModulationDisabled();
  }

  private bindStokesAolpModulationModeButton(
    button: HTMLButtonElement,
    mode: StokesAolpDegreeModulationMode
  ): void {
    this.disposables.addEventListener(button, 'click', () => {
      if (button.disabled) {
        return;
      }

      this.callbacks.onStokesAolpDegreeModulationModeChange(mode);
    });
  }

  private bindExposureControl(slider: HTMLInputElement, valueInput: HTMLInputElement): void {
    this.disposables.addEventListener(slider, 'input', (event) => {
      const target = event.currentTarget as HTMLInputElement;
      this.callbacks.onExposureChange(Number(target.value));
    });

    this.disposables.addEventListener(slider, 'change', () => {
      this.callbacks.onExposureCommit();
    });

    this.disposables.addEventListener(valueInput, 'change', (event) => {
      const target = event.currentTarget as HTMLInputElement;
      const value = Number(target.value);
      if (!Number.isFinite(value)) {
        return;
      }

      const min = Number(slider.min);
      const max = Number(slider.max);
      const clamped = Math.min(max, Math.max(min, value));
      this.callbacks.onExposureChange(clamped);
      this.callbacks.onExposureCommit();
    });
  }

  private bindGammaControl(slider: HTMLInputElement, valueInput: HTMLInputElement): void {
    this.disposables.addEventListener(slider, 'input', (event) => {
      const target = event.currentTarget as HTMLInputElement;
      const displayGamma = magnetizeDisplayGammaSliderValue(Number(target.value));
      if (displayGamma === DISPLAY_GAMMA_MAGNET_TARGET) {
        target.value = formatDisplayGammaInputValue(displayGamma);
      }

      this.callbacks.onDisplayGammaChange(displayGamma);
    });

    this.disposables.addEventListener(slider, 'change', () => {
      this.callbacks.onDisplayGammaCommit();
    });

    this.disposables.addEventListener(valueInput, 'change', (event) => {
      const target = event.currentTarget as HTMLInputElement;
      const value = Number(target.value);
      if (!Number.isFinite(value)) {
        return;
      }

      const min = Number(slider.min);
      const max = Number(slider.max);
      const clamped = normalizeDisplayGamma(Math.min(max, Math.max(min, value)));
      this.callbacks.onDisplayGammaChange(clamped);
      this.callbacks.onDisplayGammaCommit();
    });
  }

  private bindColormapExposureControl(slider: HTMLInputElement, valueInput: HTMLInputElement): void {
    this.disposables.addEventListener(slider, 'input', (event) => {
      const target = event.currentTarget as HTMLInputElement;
      this.callbacks.onColormapExposureChange(Number(target.value));
    });

    this.disposables.addEventListener(valueInput, 'change', (event) => {
      const target = event.currentTarget as HTMLInputElement;
      const value = Number(target.value);
      if (!Number.isFinite(value)) {
        return;
      }

      const min = Number(slider.min);
      const max = Number(slider.max);
      this.callbacks.onColormapExposureChange(Math.min(max, Math.max(min, value)));
    });
  }

  private bindColormapGammaControl(slider: HTMLInputElement, valueInput: HTMLInputElement): void {
    this.disposables.addEventListener(slider, 'input', (event) => {
      const target = event.currentTarget as HTMLInputElement;
      this.callbacks.onColormapGammaChange(normalizeColormapGamma(Number(target.value)));
    });

    this.disposables.addEventListener(valueInput, 'change', (event) => {
      const target = event.currentTarget as HTMLInputElement;
      const value = Number(target.value);
      if (!Number.isFinite(value)) {
        return;
      }

      this.callbacks.onColormapGammaChange(normalizeColormapGamma(value));
    });
  }

  private bindResettableControlLabel(
    control: HTMLInputElement,
    reset: () => void,
    title: string
  ): void {
    for (const label of Array.from(control.labels ?? [])) {
      label.classList.add('resettable-control-label');
      label.title = title;
      this.disposables.addEventListener(label, 'dblclick', () => {
        if (control.disabled) {
          return;
        }

        reset();
      });
    }
  }

  private getExposureControls(): Array<{ slider: HTMLInputElement; value: HTMLInputElement }> {
    return [
      { slider: this.elements.exposureSlider, value: this.elements.exposureValue }
    ];
  }

  private updateStokesDegreeModulationDisabled(): void {
    const visible = !this.elements.stokesDegreeModulationControl.classList.contains('hidden');
    const disabled = !visible || this.isLoading || this.openedImageCount === 0 || !this.isColormapEnabled;
    this.elements.stokesDegreeModulationButton.disabled = disabled;
    this.setStokesAolpModulationModeButtonsDisabled(
      disabled || this.elements.stokesAolpModulationModeControl.classList.contains('hidden')
    );
  }

  private setStokesAolpModulationMode(mode: StokesAolpDegreeModulationMode): void {
    this.elements.stokesAolpModulationValueButton.setAttribute('aria-pressed', mode === 'value' ? 'true' : 'false');
    this.elements.stokesAolpModulationSaturationButton.setAttribute(
      'aria-pressed',
      mode === 'saturation' ? 'true' : 'false'
    );
  }

  private setStokesAolpModulationModeButtonsDisabled(disabled: boolean): void {
    this.elements.stokesAolpModulationValueButton.disabled = disabled;
    this.elements.stokesAolpModulationSaturationButton.disabled = disabled;
  }

  private updateDisabledStates(): void {
    const unavailable = this.isLoading || this.openedImageCount === 0;
    const colormapDisabled = unavailable || !this.isColormapEnabled;
    const advancedDisabled = colormapDisabled || !this.currentColormapRange;

    this.elements.colormapSelect.disabled = unavailable || !this.hasColormapOptions;
    this.setRgbControlsDisabled(unavailable || this.isColormapEnabled);
    this.setColormapTransferControlsDisabled(colormapDisabled);
    this.elements.colormapRangeResetLabel.setAttribute(
      'aria-disabled',
      advancedDisabled || !this.currentAutoColormapRange ? 'true' : 'false'
    );
    this.elements.colormapZeroCenterButton.disabled = advancedDisabled;
    this.elements.colormapReverseButton.disabled = colormapDisabled;
    this.elements.colormapVminSlider.disabled = advancedDisabled;
    this.elements.colormapVmaxSlider.disabled = advancedDisabled;
    this.elements.colormapVminInput.disabled = advancedDisabled;
    this.elements.colormapVmaxInput.disabled = advancedDisabled;
  }

  private setRgbControlsDisabled(disabled: boolean): void {
    this.elements.exposureSlider.disabled = disabled;
    this.elements.exposureValue.disabled = disabled;
    this.elements.gammaSlider.disabled = disabled;
    this.elements.gammaValue.disabled = disabled;
  }

  private setColormapTransferControlsDisabled(disabled: boolean): void {
    this.elements.colormapExposureSlider.disabled = disabled;
    this.elements.colormapExposureValue.disabled = disabled;
    this.elements.colormapGammaSlider.disabled = disabled;
    this.elements.colormapGammaValue.disabled = disabled;
  }

  private setColormapRangeValues(range: DisplayLuminanceRange, autoRange: DisplayLuminanceRange): void {
    const bounds = buildColormapSliderBounds(range, autoRange, this.currentColormapZeroCentered);
    const zeroCenteredFloor = this.currentColormapZeroCentered
      ? Math.min(COLORMAP_ZERO_CENTER_SLIDER_MIN_MAGNITUDE, bounds.max)
      : 0;
    const step = this.currentColormapZeroCentered
      ? 'any'
      : formatColormapRangeStep(bounds.min, bounds.max);
    const vminSliderMax = this.currentColormapZeroCentered ? -zeroCenteredFloor : bounds.max;
    const vmaxSliderMin = this.currentColormapZeroCentered ? zeroCenteredFloor : bounds.min;
    const vmin = clamp(range.min, bounds.min, vminSliderMax);
    const vmax = clamp(range.max, vmaxSliderMin, bounds.max);
    const span = Math.max(Number.EPSILON, bounds.max - bounds.min);
    const minPct = ((vmin - bounds.min) / span) * 100;
    const maxPct = ((vmax - bounds.min) / span) * 100;

    this.elements.colormapRangeSlider.classList.toggle('zero-centered', this.currentColormapZeroCentered);
    this.elements.colormapVminSlider.min = formatColormapInputValue(bounds.min);
    this.elements.colormapVminSlider.max = formatColormapInputValue(vminSliderMax);
    this.elements.colormapVminSlider.step = step;
    this.elements.colormapVminSlider.value = formatColormapInputValue(vmin);

    this.elements.colormapVmaxSlider.min = formatColormapInputValue(vmaxSliderMin);
    this.elements.colormapVmaxSlider.max = formatColormapInputValue(bounds.max);
    this.elements.colormapVmaxSlider.step = step;
    this.elements.colormapVmaxSlider.value = formatColormapInputValue(vmax);
    this.elements.colormapRangeSlider.style.setProperty('--colormap-vmin-pct', `${minPct}%`);
    this.elements.colormapRangeSlider.style.setProperty('--colormap-vmax-pct', `${maxPct}%`);

    if (document.activeElement !== this.elements.colormapVminInput) {
      this.elements.colormapVminInput.value = formatColormapInputDisplayValue(
        range.min,
        this.elements.colormapVminInput
      );
    }
    if (document.activeElement !== this.elements.colormapVmaxInput) {
      this.elements.colormapVmaxInput.value = formatColormapInputDisplayValue(
        range.max,
        this.elements.colormapVmaxInput
      );
    }
  }

  private syncColormapRangeInputValues(): void {
    if (!this.currentColormapRange || !this.currentAutoColormapRange) {
      return;
    }

    this.setColormapRangeValues(this.currentColormapRange, this.currentAutoColormapRange);
  }

  private commitColormapMin(value: number): void {
    const current = this.currentColormapRange;
    if (!current || !Number.isFinite(value)) {
      this.setColormapRangeValues(
        current ?? { min: 0, max: 1 },
        this.currentAutoColormapRange ?? current ?? { min: 0, max: 1 }
      );
      return;
    }

    if (this.currentColormapZeroCentered) {
      this.callbacks.onColormapRangeChange(
        buildZeroCenteredColormapRange(
          { min: value, max: value },
          COLORMAP_ZERO_CENTER_SLIDER_MIN_MAGNITUDE
        ) ?? current
      );
      return;
    }

    this.callbacks.onColormapRangeChange({
      min: value,
      max: Math.max(value, current.max)
    });
  }

  private commitColormapMax(value: number): void {
    const current = this.currentColormapRange;
    if (!current || !Number.isFinite(value)) {
      this.setColormapRangeValues(
        current ?? { min: 0, max: 1 },
        this.currentAutoColormapRange ?? current ?? { min: 0, max: 1 }
      );
      return;
    }

    if (this.currentColormapZeroCentered) {
      this.callbacks.onColormapRangeChange(
        buildZeroCenteredColormapRange(
          { min: value, max: value },
          COLORMAP_ZERO_CENTER_SLIDER_MIN_MAGNITUDE
        ) ?? current
      );
      return;
    }

    this.callbacks.onColormapRangeChange({
      min: Math.min(current.min, value),
      max: value
    });
  }
}

function cloneRange(range: DisplayLuminanceRange | null): DisplayLuminanceRange | null {
  return range ? { min: range.min, max: range.max } : null;
}

function buildColormapCssGradient(lut: ColormapLut, reversed = false): string {
  const stopCount = Math.min(COLORMAP_GRADIENT_STOP_COUNT, Math.max(2, lut.entryCount));
  const stops: string[] = [];

  for (let index = 0; index < stopCount; index += 1) {
    const t = stopCount === 1 ? 0 : index / (stopCount - 1);
    const [r, g, b] = sampleColormapRgbBytes(lut, t, { reverse: reversed });
    stops.push(`rgb(${r}, ${g}, ${b}) ${(t * 100).toFixed(2)}%`);
  }

  return `linear-gradient(90deg, ${stops.join(', ')})`;
}

function buildColormapSliderBounds(
  range: DisplayLuminanceRange,
  autoRange: DisplayLuminanceRange,
  zeroCentered = false
): DisplayLuminanceRange {
  if (zeroCentered) {
    return buildZeroCenteredColormapRange({
      min: Math.min(range.min, range.max, autoRange.min, autoRange.max),
      max: Math.max(range.min, range.max, autoRange.min, autoRange.max)
    }) ?? { min: -1, max: 1 };
  }

  let min = Math.min(range.min, range.max, autoRange.min, autoRange.max);
  let max = Math.max(range.min, range.max, autoRange.min, autoRange.max);

  if (max <= min) {
    const margin = Math.max(1, Math.abs(min) * 0.1);
    min -= margin;
    max += margin;
  }

  return { min, max };
}

function formatColormapInputValue(
  value: number,
  maxSignificantDigits = COLORMAP_INPUT_MAX_SIGNIFICANT_DIGITS,
  maxCharacters = Number.POSITIVE_INFINITY
): string {
  if (!Number.isFinite(value)) {
    return '0';
  }

  const significantDigits = Math.max(
    COLORMAP_INPUT_MIN_SIGNIFICANT_DIGITS,
    Math.min(COLORMAP_INPUT_MAX_SIGNIFICANT_DIGITS, Math.floor(maxSignificantDigits))
  );

  for (let digits = significantDigits; digits >= COLORMAP_INPUT_MIN_SIGNIFICANT_DIGITS; digits -= 1) {
    const candidate = formatSignificantNumber(value, digits);
    if (candidate.length <= maxCharacters || digits === COLORMAP_INPUT_MIN_SIGNIFICANT_DIGITS) {
      if (candidate.length <= maxCharacters || !Number.isFinite(maxCharacters)) {
        return candidate;
      }
      break;
    }
  }

  for (let fractionDigits = significantDigits - 1; fractionDigits >= 0; fractionDigits -= 1) {
    const candidate = formatExponentialNumber(value, fractionDigits);
    if (candidate.length <= maxCharacters || fractionDigits === 0) {
      return candidate;
    }
  }

  return formatExponentialNumber(value, 0);
}

function formatColormapInputDisplayValue(value: number, input: HTMLInputElement): string {
  return formatColormapInputValue(
    value,
    COLORMAP_INPUT_MAX_SIGNIFICANT_DIGITS,
    getColormapInputCharacterBudget(input)
  );
}

function getColormapInputCharacterBudget(input: HTMLInputElement): number {
  const width = input.clientWidth;
  if (!Number.isFinite(width) || width <= 0) {
    return COLORMAP_INPUT_FALLBACK_CHARACTER_BUDGET;
  }

  const style = window.getComputedStyle(input);
  const fontSize = Number.parseFloat(style.fontSize);
  const paddingLeft = Number.parseFloat(style.paddingLeft);
  const paddingRight = Number.parseFloat(style.paddingRight);
  const averageCharacterWidth = Number.isFinite(fontSize) && fontSize > 0 ? fontSize * 0.58 : 7;
  const padding =
    (Number.isFinite(paddingLeft) ? paddingLeft : 0) +
    (Number.isFinite(paddingRight) ? paddingRight : 0);
  const availableWidth = Math.max(0, width - padding - COLORMAP_INPUT_RESERVED_INLINE_PX);

  return Math.max(
    7,
    Math.min(12, Math.floor(availableWidth / averageCharacterWidth))
  );
}

function formatSignificantNumber(value: number, significantDigits: number): string {
  return Number(value.toPrecision(significantDigits)).toString();
}

function formatExponentialNumber(value: number, fractionDigits: number): string {
  return value
    .toExponential(Math.max(0, fractionDigits))
    .replace(/(\.\d*?)0+e/, '$1e')
    .replace(/\.e/, 'e')
    .replace('e+', 'e');
}

function formatDisplayGammaInputValue(value: number): string {
  return Number(normalizeDisplayGamma(value).toFixed(2)).toString();
}

function formatColormapExposureInputValue(value: number): string {
  if (!Number.isFinite(value)) {
    return '0';
  }

  return Number(value.toFixed(1)).toString();
}

function formatColormapGammaInputValue(value: number): string {
  return Number(normalizeColormapGamma(value).toFixed(2)).toString();
}

function normalizeColormapGamma(value: number): number {
  if (!Number.isFinite(value)) {
    return 1;
  }

  return Math.min(COLORMAP_GAMMA_MAX, Math.max(COLORMAP_GAMMA_MIN, value));
}

function magnetizeDisplayGammaSliderValue(value: number): number {
  const displayGamma = normalizeDisplayGamma(value);
  if (
    Math.abs(displayGamma - DISPLAY_GAMMA_MAGNET_TARGET) <=
    DISPLAY_GAMMA_MAGNET_RADIUS + DISPLAY_GAMMA_MAGNET_EPSILON
  ) {
    return DISPLAY_GAMMA_MAGNET_TARGET;
  }

  return displayGamma;
}

function formatColormapRangeStep(min: number, max: number): string {
  const span = Math.abs(max - min);
  if (!Number.isFinite(span) || span <= 0) {
    return 'any';
  }

  return Number((span / 1000).toPrecision(4)).toString();
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
