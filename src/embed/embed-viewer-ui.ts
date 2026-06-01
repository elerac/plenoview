import { formatProbeCoordinates } from '../ui/probe-readout';
import type { ViewerRuntimeUi, ScreenshotSelectionInteractionState } from '../ui/viewer-runtime-ui';
import type { ViewportClientRect } from '../interaction/image-geometry';
import type {
  ScreenshotSelectionHandle,
  ScreenshotSelectionSnapGuide
} from '../interaction/screenshot-selection';
import type { ProbeColorPreview } from '../probe';
import type {
  DisplayLuminanceRange,
  DisplaySelection,
  ExrMetadataEntry,
  ExportImageBatchTarget,
  ExportImageTarget,
  ImageRoi,
  PixelSample,
  RoiStats,
  StokesAolpDegreeModulationMode,
  ViewerMode,
  ViewportRect,
  VisualizationMode
} from '../types';
import type { ColormapLut } from '../colormaps';
import type {
  ImageStatsReadoutModel,
  SpectralPlotReadoutModel,
  ViewerLayerOption,
  ViewerOpenedImageOption,
  ViewerStateReadoutModel
} from '../app/viewer-app-types';
import type {
  StokesColormapDefaultSettings,
  StokesParameterVisibilitySettings
} from '../stokes';
import type { ChannelRecognitionSettings } from '../channel-recognition-settings';
import type { ChannelRecognitionNameRules } from '../channel-recognition-name-rules';
import type {
  ViewerPaneLayoutState,
  ViewerPaneRenderInfo
} from '../viewer-pane-layout';
import type { ChannelThumbnailOptionItem } from '../ui/viewer-ui';

interface EmbedViewerUiCallbacks {
  onOpenFull: () => void;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

export class EmbedViewerUi implements ViewerRuntimeUi {
  readonly viewerContainer: HTMLElement;
  readonly glCanvas: HTMLCanvasElement;
  readonly overlayCanvas: HTMLCanvasElement;
  readonly probeOverlayCanvas: HTMLCanvasElement;
  readonly rulerOverlaySvg: SVGSVGElement;
  readonly rulerLabelOverlay: HTMLElement;

  private readonly root: HTMLElement;
  private readonly status: HTMLElement;
  private readonly sourceLabel: HTMLElement;
  private readonly probe: HTMLElement;
  private readonly probeSwatch: HTMLElement;
  private readonly probeCoords: HTMLElement;
  private readonly probeValues: HTMLElement;
  private readonly deferredLoadButton: HTMLButtonElement;
  private readonly openFullButton: HTMLButtonElement;
  private deferredLoadHandler: (() => void | Promise<void>) | null = null;
  private viewport = { width: 1, height: 1 };
  private disposed = false;

  constructor(private readonly callbacks: EmbedViewerUiCallbacks) {
    document.body.replaceChildren();
    document.body.classList.add('embed-body');

    this.root = document.createElement('main');
    this.root.className = 'embed-shell';

    this.viewerContainer = document.createElement('section');
    this.viewerContainer.id = 'viewer-container';
    this.viewerContainer.className = 'viewer-container embed-viewer-container';
    this.viewerContainer.setAttribute('aria-label', 'OpenEXR image viewer');
    this.viewerContainer.tabIndex = 0;

    this.glCanvas = document.createElement('canvas');
    this.glCanvas.id = 'gl-canvas';
    this.overlayCanvas = document.createElement('canvas');
    this.overlayCanvas.id = 'overlay-canvas';
    this.probeOverlayCanvas = document.createElement('canvas');
    this.probeOverlayCanvas.id = 'probe-overlay-canvas';
    this.rulerOverlaySvg = document.createElementNS(SVG_NS, 'svg');
    this.rulerOverlaySvg.id = 'ruler-overlay-svg';
    this.rulerLabelOverlay = document.createElement('div');
    this.rulerLabelOverlay.id = 'ruler-label-overlay';
    this.rulerLabelOverlay.className = 'ruler-label-overlay';

    this.status = document.createElement('div');
    this.status.className = 'embed-status hidden';
    this.status.setAttribute('role', 'status');
    this.status.setAttribute('aria-live', 'polite');

    this.deferredLoadButton = document.createElement('button');
    this.deferredLoadButton.className = 'embed-deferred-load-button hidden';
    this.deferredLoadButton.type = 'button';
    this.deferredLoadButton.textContent = 'Load image';
    this.deferredLoadButton.addEventListener('pointerdown', stopViewerInteractionEvent);
    this.deferredLoadButton.addEventListener('click', this.handleDeferredLoadClick);

    const toolbar = document.createElement('div');
    toolbar.className = 'embed-toolbar';
    this.sourceLabel = document.createElement('div');
    this.sourceLabel.className = 'embed-source-label hidden';
    this.openFullButton = document.createElement('button');
    this.openFullButton.className = 'embed-open-full-button';
    this.openFullButton.type = 'button';
    this.openFullButton.textContent = 'Open full viewer';
    this.openFullButton.disabled = true;
    this.openFullButton.addEventListener('pointerdown', stopViewerInteractionEvent);
    this.openFullButton.addEventListener('click', this.handleOpenFullClick);
    toolbar.append(this.sourceLabel, this.openFullButton);

    this.probe = document.createElement('aside');
    this.probe.className = 'embed-probe is-empty';
    this.probe.setAttribute('aria-label', 'Pixel probe');
    this.probeSwatch = document.createElement('span');
    this.probeSwatch.className = 'embed-probe-swatch';
    this.probeCoords = document.createElement('span');
    this.probeCoords.className = 'embed-probe-coords';
    this.probeCoords.textContent = formatProbeCoordinates(null);
    this.probeValues = document.createElement('span');
    this.probeValues.className = 'embed-probe-values';
    this.probe.append(this.probeSwatch, this.probeCoords, this.probeValues);

    this.viewerContainer.append(
      this.glCanvas,
      this.overlayCanvas,
      this.probeOverlayCanvas,
      this.rulerOverlaySvg,
      this.rulerLabelOverlay,
      toolbar,
      this.deferredLoadButton,
      this.status,
      this.probe
    );
    this.root.append(this.viewerContainer);
    document.body.append(this.root);
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.deferredLoadHandler = null;
    this.deferredLoadButton.removeEventListener('pointerdown', stopViewerInteractionEvent);
    this.deferredLoadButton.removeEventListener('click', this.handleDeferredLoadClick);
    this.openFullButton.removeEventListener('pointerdown', stopViewerInteractionEvent);
    this.openFullButton.removeEventListener('click', this.handleOpenFullClick);
    document.body.classList.remove('embed-body');
  }

  setError(message: string | null): void {
    if (this.disposed) {
      return;
    }

    if (!message) {
      this.status.classList.add('hidden');
      this.status.classList.remove('is-error');
      this.status.textContent = '';
      return;
    }

    this.status.classList.remove('hidden');
    this.status.classList.add('is-error');
    this.status.textContent = message;
  }

  setLoading(loading: boolean): void {
    if (this.disposed) {
      return;
    }

    if (loading) {
      this.deferredLoadButton.classList.add('hidden');
      this.deferredLoadButton.disabled = true;
    }

    if (!loading) {
      if (!this.status.classList.contains('is-error')) {
        this.status.classList.add('hidden');
        this.status.textContent = '';
      }
      return;
    }

    this.status.classList.remove('hidden', 'is-error');
    this.status.textContent = 'Loading image...';
  }

  setDeferredLoad(handler: (() => void | Promise<void>) | null): void {
    if (this.disposed) {
      return;
    }

    this.deferredLoadHandler = handler;
    this.deferredLoadButton.disabled = false;
    this.deferredLoadButton.classList.toggle('hidden', !handler);
  }

  setRgbViewLoading(displayBusy: boolean, overlayLoading = displayBusy): void {
    if (this.disposed) {
      return;
    }
    if (!overlayLoading) {
      if (this.status.textContent === 'Updating display...' && !this.status.classList.contains('is-error')) {
        this.status.classList.add('hidden');
        this.status.textContent = '';
      }
      return;
    }

    this.status.classList.remove('hidden', 'is-error');
    this.status.textContent = 'Updating display...';
  }

  setDisplayCacheBudget(_mb: number): void {}
  setDisplayCacheUsage(_usedBytes: number, _budgetBytes: number): void {}

  setViewerViewportRect(rect: ViewportClientRect): void {
    this.viewport = {
      width: Math.max(1, Math.floor(rect.width)),
      height: Math.max(1, Math.floor(rect.height))
    };
    this.viewerContainer.style.setProperty('--viewer-checker-offset-x', `${-rect.left}px`);
    this.viewerContainer.style.setProperty('--viewer-checker-offset-y', `${-rect.top}px`);
  }

  setViewerPaneLayout(_layout: ViewerPaneLayoutState): void {}

  getViewerPaneRenderInfos(): ViewerPaneRenderInfo[] {
    return [this.getActiveViewerPane()];
  }

  getActiveViewerPane(): ViewerPaneRenderInfo {
    return {
      path: [],
      rect: {
        x: 0,
        y: 0,
        width: this.viewport.width,
        height: this.viewport.height
      },
      viewport: { ...this.viewport },
      active: true
    };
  }

  resolveViewerPaneAtPoint(_point: { x: number; y: number }): ViewerPaneRenderInfo | null {
    return this.getActiveViewerPane();
  }

  getScreenshotSelectionInteractionState(): ScreenshotSelectionInteractionState {
    return {
      active: false,
      rect: null,
      activeRegionId: null,
      regions: []
    };
  }

  setScreenshotSelectionRect(
    _rect: ViewportRect,
    _options: { squareSnapped?: boolean; snapGuide?: ScreenshotSelectionSnapGuide } = {}
  ): void {}
  setScreenshotSelectionActiveRegion(_regionId: string): void {}
  setScreenshotSelectionSnapGuide(_guide: ScreenshotSelectionSnapGuide): void {}
  setScreenshotSelectionHandle(_handle: ScreenshotSelectionHandle | null): void {}
  setScreenshotSelectionResizeActive(_active: boolean): void {}
  setScreenshotSelectionSquareSnapActive(_active: boolean): void {}

  setAutoFitImageOnSelect(_enabled: boolean): void {}
  setAutoExposureEnabled(_enabled: boolean): void {}
  setRulersVisible(_enabled: boolean): void {}

  setOpenedImageOptions(items: ViewerOpenedImageOption[], activeId: string | null): void {
    const active = items.find((item) => item.id === activeId) ?? items[0] ?? null;
    this.openFullButton.disabled = !active;
    const showSourceLabel = Boolean(active?.displayNameIsCustom && active.label.trim());
    this.sourceLabel.classList.toggle('hidden', !showSourceLabel);
    this.sourceLabel.textContent = showSourceLabel ? active?.label ?? '' : '';
  }

  setExportTarget(_target: ExportImageTarget | null): void {}
  setExportBatchTarget(_target: ExportImageBatchTarget | null): void {}
  setExposure(_exposureEv: number): void {}
  setDisplayGamma(_displayGamma: number): void {}
  setColormapExposure(_exposureEv: number): void {}
  setColormapGamma(_gamma: number): void {}
  setViewerMode(_mode: ViewerMode): void {}
  setDepthModeAvailable(_available: boolean): void {}
  setVisualizationMode(_mode: VisualizationMode): void {}
  setStokesDegreeModulationControl(
    _label: string | null,
    _enabled = false,
    _showAolpMode = false,
    _aolpMode: StokesAolpDegreeModulationMode = 'value'
  ): void {}
  setActiveColormap(_activeId: string | null): void {}
  setColormapOptions(_items: Array<{ id: string; label: string }>, _activeId: string | null): void {}
  setStokesDefaultSettingsOptions(
    _items: Array<{ id: string; label: string }>,
    _defaults: StokesColormapDefaultSettings,
    _visibility?: StokesParameterVisibilitySettings
  ): void {}
  setMaskInvalidStokesVectors(_enabled: boolean): void {}
  setChannelRecognitionSettings(_settings: ChannelRecognitionSettings): void {}
  setChannelRecognitionNameRules(_rules: ChannelRecognitionNameRules): void {}
  setSpectralRgbGroupingEnabled(_enabled: boolean): void {}
  setInvalidValueWarningEnabled(_enabled: boolean): void {}
  setColormapGradient(_lut: ColormapLut | null, _reversed = false): void {}
  setColormapReversed(_reversed: boolean): void {}
  setColormapRange(
    _range: DisplayLuminanceRange | null,
    _autoRange: DisplayLuminanceRange | null,
    _alwaysAuto = false,
    _zeroCentered = false
  ): void {}
  setLayerOptions(_items: ViewerLayerOption[], _activeIndex: number): void {}
  setMetadata(_metadata: ExrMetadataEntry[] | null): void {}
  setRgbGroupOptions(
    _channelNames: string[],
    _selected: DisplaySelection | null,
    _channelThumbnailItems: ChannelThumbnailOptionItem[] = [],
    _channelStackScopeKey = 'default'
  ): void {}
  clearImageBrowserPanels(): void {}

  setProbeReadout(
    mode: 'Hover' | 'Locked',
    sample: PixelSample | null,
    colorPreview: ProbeColorPreview | null,
    imageSize: { width: number; height: number } | null = null
  ): void {
    this.probe.classList.toggle('is-empty', !sample);
    this.probe.dataset.mode = mode;
    this.probeCoords.textContent = formatProbeCoordinates(sample, imageSize);
    this.probeSwatch.style.backgroundColor = colorPreview?.cssColor ?? 'transparent';
    this.probeValues.textContent = colorPreview
      ? colorPreview.displayValues.map((item) => `${item.label} ${item.value}`).join('  ')
      : '';
  }

  setSpectralReadout(_readout: SpectralPlotReadoutModel): void {}
  setRoiReadout(_readout: { roi: ImageRoi | null; stats: RoiStats | null }): void {}
  setViewerStateReadout(_readout: ViewerStateReadoutModel): void {}
  setImageStats(_readout: ImageStatsReadoutModel): void {}

  private readonly handleOpenFullClick = (event: MouseEvent): void => {
    event.preventDefault();
    event.stopPropagation();
    this.callbacks.onOpenFull();
  };

  private readonly handleDeferredLoadClick = (event: MouseEvent): void => {
    event.preventDefault();
    event.stopPropagation();
    const handler = this.deferredLoadHandler;
    if (!handler) {
      return;
    }

    this.deferredLoadButton.disabled = true;
    void Promise.resolve(handler()).catch(() => {
      if (this.disposed || this.deferredLoadHandler !== handler) {
        return;
      }
      this.deferredLoadButton.disabled = false;
      this.deferredLoadButton.classList.remove('hidden');
    });
  };
}

function stopViewerInteractionEvent(event: Event): void {
  event.stopPropagation();
}
