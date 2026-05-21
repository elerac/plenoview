import { AUTO_EXPOSURE_PERCENTILE } from '../analysis/auto-exposure';
import { idleResource } from '../async-resource';
import { DEFAULT_COLORMAP_ID } from '../colormaps';
import { DEFAULT_INVALID_VALUE_WARNING_ENABLED } from '../invalid-value-warning-settings';
import {
  DEFAULT_MASK_INVALID_STOKES_VECTORS,
  createDefaultStokesColormapDefaultSettings,
  createDefaultStokesParameterVisibilitySettings
} from '../stokes';
import { DEFAULT_SPECTRAL_RGB_GROUPING_ENABLED } from '../spectral-default-settings';
import { createInteractionState } from '../view-state';
import { createSinglePaneLayout } from '../viewer-pane-layout';
import { createInitialState } from '../viewer-store';
import { analysisReducer } from './reducers/analysis-reducer';
import { displayReducer } from './reducers/display-reducer';
import { resourceReducer } from './reducers/resource-reducer';
import { sessionReducer } from './reducers/session-reducer';
import type { ViewerDomainReducer, ViewerReducerContext } from './reducers/shared';
import { stokesReducer } from './reducers/stokes-reducer';
import { thumbnailReducer } from './reducers/thumbnail-reducer';
import { uiPreferencesReducer } from './reducers/ui-preferences-reducer';
import type {
  ViewerAppState,
  ViewerIntent
} from './viewer-app-types';

const DOMAIN_REDUCERS: ViewerDomainReducer[] = [
  uiPreferencesReducer,
  resourceReducer,
  stokesReducer,
  displayReducer,
  analysisReducer,
  thumbnailReducer,
  sessionReducer
];

export function createInitialViewerAppState(): ViewerAppState {
  const sessionState = createInitialState();
  return {
    sessionState,
    interactionState: createInteractionState(sessionState),
    sessions: [],
    pendingOpenedImages: [],
    activeSessionId: null,
    errorMessage: null,
    isLoading: false,
    colormapRegistry: null,
    defaultColormapId: DEFAULT_COLORMAP_ID,
    colormapLutResource: idleResource(),
    colormapLutsById: {},
    displayRangeResource: idleResource(),
    imageStatsResource: idleResource(),
    autoExposureResource: idleResource(),
    pendingColormapActivation: null,
    pendingSelectionTransitionRequestId: null,
    thumbnailsBySessionId: {},
    channelThumbnailsByRequestKey: {},
    channelThumbnailLatestRequestKeyByContextKey: {},
    stokesDisplayRestoreStates: {},
    stokesColormapDefaults: createDefaultStokesColormapDefaultSettings(),
    stokesParameterVisibility: createDefaultStokesParameterVisibilitySettings(),
    maskInvalidStokesVectors: DEFAULT_MASK_INVALID_STOKES_VECTORS,
    spectralRgbGroupingEnabled: DEFAULT_SPECTRAL_RGB_GROUPING_ENABLED,
    invalidValueWarningEnabled: DEFAULT_INVALID_VALUE_WARNING_ENABLED,
    autoFitImageOnSelect: false,
    autoExposureEnabled: false,
    autoExposurePercentile: AUTO_EXPOSURE_PERCENTILE,
    rulersVisible: false,
    viewerPaneLayout: createSinglePaneLayout()
  };
}

export function reduceViewerAppState(state: ViewerAppState, intent: ViewerIntent): ViewerAppState {
  const context: ViewerReducerContext = { initialState: state };
  return DOMAIN_REDUCERS.reduce(
    (nextState, reducer) => reducer(nextState, intent, context),
    state
  );
}
