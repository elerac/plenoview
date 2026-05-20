import { normalizeAutoExposurePercentile } from '../../analysis/auto-exposure';
import { idleResource } from '../../async-resource';
import {
  activateViewerPane,
  resetViewerPaneLayout,
  splitActiveViewerPane,
  sameViewerPaneLayout
} from '../../viewer-pane-layout';
import type { ViewerAppState, ViewerIntent } from '../viewer-app-types';
import type { ViewerReducerContext } from './shared';

export function uiPreferencesReducer(
  state: ViewerAppState,
  intent: ViewerIntent,
  _context: ViewerReducerContext
): ViewerAppState {
  switch (intent.type) {
    case 'autoFitImageOnSelectSet':
      return state.autoFitImageOnSelect === intent.enabled ? state : {
        ...state,
        autoFitImageOnSelect: intent.enabled
      };
    case 'autoExposureSet':
      return state.autoExposureEnabled === intent.enabled ? state : {
        ...state,
        autoExposureEnabled: intent.enabled,
        autoExposureResource: intent.enabled ? state.autoExposureResource : idleResource()
      };
    case 'autoExposurePercentileSet': {
      const percentile = normalizeAutoExposurePercentile(intent.percentile);
      return state.autoExposurePercentile === percentile ? state : {
        ...state,
        autoExposurePercentile: percentile,
        autoExposureResource: idleResource()
      };
    }
    case 'rulersVisibleSet':
      return state.rulersVisible === intent.enabled ? state : {
        ...state,
        rulersVisible: intent.enabled
      };
    case 'maskInvalidStokesVectorsSet':
      return state.maskInvalidStokesVectors === intent.enabled ? state : {
        ...state,
        maskInvalidStokesVectors: intent.enabled,
        displayRangeResource: idleResource(),
        imageStatsResource: idleResource(),
        autoExposureResource: idleResource()
      };
    case 'viewerPaneReset': {
      const viewerPaneLayout = resetViewerPaneLayout(state.activeSessionId);
      return sameViewerPaneLayout(state.viewerPaneLayout, viewerPaneLayout) ? state : {
        ...state,
        viewerPaneLayout
      };
    }
    case 'viewerPaneActivated': {
      const viewerPaneLayout = activateViewerPane(state.viewerPaneLayout, intent.path);
      return viewerPaneLayout === state.viewerPaneLayout ? state : {
        ...state,
        viewerPaneLayout
      };
    }
    case 'viewerPaneSplit': {
      const viewerPaneLayout = splitActiveViewerPane(state.viewerPaneLayout, intent.orientation);
      return {
        ...state,
        viewerPaneLayout
      };
    }
    default:
      return state;
  }
}
