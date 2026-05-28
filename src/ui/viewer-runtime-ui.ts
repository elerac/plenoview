import type { ChannelThumbnailOptionItem } from './viewer-ui';
import type { ColormapLut } from '../colormaps';
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
  VisualizationMode,
  ViewerMode,
  ViewportRect
} from '../types';
import type { ProbeColorPreview } from '../probe';
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
import type {
  ViewerPaneLayoutState,
  ViewerPaneRenderInfo
} from '../viewer-pane-layout';
import type { ViewportClientRect } from '../interaction/image-geometry';
import type {
  ScreenshotSelectionHandle,
  ScreenshotSelectionSnapGuide
} from '../interaction/screenshot-selection';
import type { Disposable } from '../lifecycle';

export interface ScreenshotSelectionInteractionState {
  active: boolean;
  rect: ViewportRect | null;
  activeRegionId: string | null;
  regions: Array<{ id: string; rect: ViewportRect }>;
}

export interface ViewerRuntimeUi extends Disposable {
  readonly viewerContainer: HTMLElement;
  readonly glCanvas: HTMLCanvasElement;
  readonly overlayCanvas: HTMLCanvasElement;
  readonly probeOverlayCanvas: HTMLCanvasElement;
  readonly rulerOverlaySvg: SVGSVGElement;
  readonly rulerLabelOverlay: HTMLElement;

  setError(message: string | null): void;
  setLoading(loading: boolean, viewerBlocked?: boolean): void;
  setRgbViewLoading(displayBusy: boolean, overlayLoading?: boolean): void;
  setDisplayCacheBudget(mb: number): void;
  setDisplayCacheUsage(usedBytes: number, budgetBytes: number): void;

  setViewerViewportRect(rect: ViewportClientRect): void;
  setViewerPaneLayout(layout: ViewerPaneLayoutState): void;
  getViewerPaneRenderInfos(): ViewerPaneRenderInfo[];
  getActiveViewerPane(): ViewerPaneRenderInfo;
  resolveViewerPaneAtPoint(point: { x: number; y: number }): ViewerPaneRenderInfo | null;

  getScreenshotSelectionInteractionState(): ScreenshotSelectionInteractionState;
  setScreenshotSelectionRect(
    rect: ViewportRect,
    options?: { squareSnapped?: boolean; snapGuide?: ScreenshotSelectionSnapGuide }
  ): void;
  setScreenshotSelectionActiveRegion(regionId: string): void;
  setScreenshotSelectionSnapGuide(guide: ScreenshotSelectionSnapGuide): void;
  setScreenshotSelectionHandle(handle: ScreenshotSelectionHandle | null): void;
  setScreenshotSelectionResizeActive(active: boolean): void;
  setScreenshotSelectionSquareSnapActive(active: boolean): void;

  setAutoFitImageOnSelect(enabled: boolean, persist?: boolean): void;
  setAutoExposureEnabled(enabled: boolean, persist?: boolean): void;
  setRulersVisible(enabled: boolean, persist?: boolean): void;
  setOpenedImageOptions(items: ViewerOpenedImageOption[], activeId: string | null): void;
  setExportTarget(target: ExportImageTarget | null): void;
  setExportBatchTarget(target: ExportImageBatchTarget | null): void;
  setExposure(exposureEv: number): void;
  setDisplayGamma(displayGamma: number): void;
  setColormapExposure(exposureEv: number): void;
  setColormapGamma(gamma: number): void;
  setViewerMode(mode: ViewerMode): void;
  setDepthModeAvailable(available: boolean): void;
  setVisualizationMode(mode: VisualizationMode): void;
  setStokesDegreeModulationControl(
    label: string | null,
    enabled?: boolean,
    showAolpMode?: boolean,
    aolpMode?: StokesAolpDegreeModulationMode
  ): void;
  setActiveColormap(activeId: string | null): void;
  setColormapOptions(items: Array<{ id: string; label: string }>, activeId: string | null): void;
  setStokesDefaultSettingsOptions(
    items: Array<{ id: string; label: string }>,
    defaults: StokesColormapDefaultSettings,
    visibility?: StokesParameterVisibilitySettings
  ): void;
  setMaskInvalidStokesVectors(enabled: boolean): void;
  setSpectralRgbGroupingEnabled(enabled: boolean, persist?: boolean): void;
  setInvalidValueWarningEnabled(enabled: boolean): void;
  setColormapGradient(lut: ColormapLut | null, reversed?: boolean): void;
  setColormapReversed(reversed: boolean): void;
  setColormapRange(
    range: DisplayLuminanceRange | null,
    autoRange: DisplayLuminanceRange | null,
    alwaysAuto?: boolean,
    zeroCentered?: boolean
  ): void;
  setLayerOptions(items: ViewerLayerOption[], activeIndex: number): void;
  setMetadata(metadata: ExrMetadataEntry[] | null): void;
  setRgbGroupOptions(
    channelNames: string[],
    selected: DisplaySelection | null,
    channelThumbnailItems?: ChannelThumbnailOptionItem[],
    channelStackScopeKey?: string
  ): void;
  clearImageBrowserPanels(): void;

  setProbeReadout(
    mode: 'Hover' | 'Locked',
    sample: PixelSample | null,
    colorPreview: ProbeColorPreview | null,
    imageSize?: { width: number; height: number } | null
  ): void;
  setSpectralReadout(readout: SpectralPlotReadoutModel): void;
  setRoiReadout(readout: { roi: ImageRoi | null; stats: RoiStats | null }): void;
  setViewerStateReadout(readout: ViewerStateReadoutModel): void;
  setImageStats(readout: ImageStatsReadoutModel): void;
}
