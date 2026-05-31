import { normalizeAutoExposurePercentile } from '../../analysis/auto-exposure';
import { idleResource } from '../../async-resource';
import {
  createDefaultChannelRecognitionSettings,
  deriveSpectralRgbGroupingEnabled,
  normalizeChannelRecognitionSettings,
  sameChannelRecognitionSettings,
  withChannelRecognitionSetting,
  type ChannelRecognitionSettings
} from '../../channel-recognition-settings';
import {
  createDefaultChannelRecognitionNameRules,
  normalizeChannelRecognitionNameRules,
  sameChannelRecognitionNameRules,
  type ChannelRecognitionNameRules
} from '../../channel-recognition-name-rules';
import { resolveDepthChannelForLayer } from '../../depth';
import { sameDisplaySelection } from '../../display-model';
import { resolveDisplaySelectionForLayer } from '../../display-selection';
import {
  activateViewerPane,
  resetViewerPaneLayout,
  splitActiveViewerPane,
  sameViewerPaneLayout
} from '../../viewer-pane-layout';
import { selectActiveSession } from '../viewer-app-selectors';
import type { ViewerAppState, ViewerIntent } from '../viewer-app-types';
import { patchSessionState, type ViewerReducerContext } from './shared';

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
    case 'spectralRgbGroupingSet':
      return reduceSpectralRgbGroupingSet(state, intent.enabled);
    case 'channelRecognitionSettingsSet':
      return reduceChannelRecognitionSettingsSet(state, intent.settings);
    case 'channelRecognitionSettingsGroupSet':
      return reduceChannelRecognitionSettingsSet(
        state,
        withChannelRecognitionSetting(state.channelRecognitionSettings, intent.id, intent.enabled)
      );
    case 'channelRecognitionSettingsReset':
      return reduceChannelRecognitionSettingsSet(state, createDefaultChannelRecognitionSettings());
    case 'channelRecognitionNameRulesSet':
      return reduceChannelRecognitionNameRulesSet(state, intent.rules);
    case 'channelRecognitionNameRulesReset':
      return reduceChannelRecognitionNameRulesSet(state, createDefaultChannelRecognitionNameRules());
    case 'invalidValueWarningSet':
      return state.invalidValueWarningEnabled === intent.enabled ? state : {
        ...state,
        invalidValueWarningEnabled: intent.enabled
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

function reduceChannelRecognitionNameRulesSet(
  state: ViewerAppState,
  rules: ChannelRecognitionNameRules
): ViewerAppState {
  const nextRules = normalizeChannelRecognitionNameRules(rules);
  if (sameChannelRecognitionNameRules(state.channelRecognitionNameRules, nextRules)) {
    return state;
  }

  const nextState: ViewerAppState = {
    ...state,
    channelRecognitionNameRules: nextRules,
    displayRangeResource: idleResource(),
    imageStatsResource: idleResource(),
    autoExposureResource: idleResource()
  };
  const activeSession = selectActiveSession(nextState);
  const layer = activeSession?.decoded.layers[nextState.sessionState.activeLayer] ?? null;
  if (!layer) {
    return nextState;
  }

  return applyRecognitionDependentSessionState(nextState, layer.channelNames, {
    channelRecognitionNameRules: nextRules
  });
}

function reduceChannelRecognitionSettingsSet(
  state: ViewerAppState,
  settings: ChannelRecognitionSettings
): ViewerAppState {
  const nextSettings = normalizeChannelRecognitionSettings(settings);
  if (sameChannelRecognitionSettings(state.channelRecognitionSettings, nextSettings)) {
    return state;
  }

  const nextState: ViewerAppState = {
    ...state,
    channelRecognitionSettings: nextSettings,
    spectralRgbGroupingEnabled: deriveSpectralRgbGroupingEnabled(nextSettings),
    displayRangeResource: idleResource(),
    imageStatsResource: idleResource(),
    autoExposureResource: idleResource()
  };
  const activeSession = selectActiveSession(nextState);
  const layer = activeSession?.decoded.layers[nextState.sessionState.activeLayer] ?? null;
  if (!layer) {
    return nextState;
  }

  return applyRecognitionDependentSessionState(nextState, layer.channelNames, {
    channelRecognitionSettings: nextSettings
  });
}

function reduceSpectralRgbGroupingSet(state: ViewerAppState, enabled: boolean): ViewerAppState {
  const channelRecognitionSettings = normalizeChannelRecognitionSettings({
    ...state.channelRecognitionSettings,
    'spectral.series': enabled,
    'stokes.spectral': enabled
  });
  if (
    state.spectralRgbGroupingEnabled === enabled &&
    sameChannelRecognitionSettings(state.channelRecognitionSettings, channelRecognitionSettings)
  ) {
    return state;
  }

  const nextState: ViewerAppState = {
    ...state,
    channelRecognitionSettings,
    spectralRgbGroupingEnabled: enabled,
    displayRangeResource: idleResource(),
    imageStatsResource: idleResource(),
    autoExposureResource: idleResource()
  };
  const activeSession = selectActiveSession(nextState);
  const layer = activeSession?.decoded.layers[nextState.sessionState.activeLayer] ?? null;
  if (!layer) {
    return nextState;
  }

  return applyRecognitionDependentSessionState(nextState, layer.channelNames, {
    spectralRgbGroupingEnabled: enabled,
    channelRecognitionSettings
  });
}

function applyRecognitionDependentSessionState(
  state: ViewerAppState,
  channelNames: string[],
  overrides: {
    spectralRgbGroupingEnabled?: boolean;
    channelRecognitionSettings?: ChannelRecognitionSettings;
    channelRecognitionNameRules?: ChannelRecognitionNameRules;
  } = {}
): ViewerAppState {
  const spectralRgbGroupingEnabled = overrides.spectralRgbGroupingEnabled ?? state.spectralRgbGroupingEnabled;
  const channelRecognitionSettings = overrides.channelRecognitionSettings ?? state.channelRecognitionSettings;
  const channelRecognitionNameRules = overrides.channelRecognitionNameRules ?? state.channelRecognitionNameRules;
  const displaySelection = resolveDisplaySelectionForLayer(
    channelNames,
    state.sessionState.displaySelection,
    {
      stokesParameterVisibility: state.stokesParameterVisibility,
      spectralRgbGroupingEnabled,
      channelRecognitionSettings,
      channelRecognitionNameRules
    }
  );
  const patch: Partial<ViewerAppState['sessionState']> = {};
  if (!sameDisplaySelection(displaySelection, state.sessionState.displaySelection)) {
    patch.displaySelection = displaySelection;
  }

  if (state.sessionState.viewerMode === 'depth') {
    const depthChannel = resolveDepthChannelForLayer(
      channelNames,
      state.sessionState.depthChannel,
      {
        allowArbitraryZSuffix: true,
        channelRecognitionSettings,
        channelRecognitionNameRules
      }
    );
    if (depthChannel !== state.sessionState.depthChannel) {
      patch.depthChannel = depthChannel;
    }
    if (!depthChannel) {
      patch.viewerMode = 'image';
    }
  }

  if (Object.keys(patch).length === 0) {
    return state;
  }

  return patchSessionState(state, patch, {
    clearHover: true,
    resetDisplayRangeContext: patch.displaySelection !== undefined
  });
}
