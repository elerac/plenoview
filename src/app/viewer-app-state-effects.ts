import { buildChannelViewItems, type ChannelViewItem } from '../channel-view-items';
import {
  serializeChannelThumbnailContextKey,
  serializeChannelThumbnailRequestKey
} from '../channel-thumbnail-keys';
import { sameDisplaySelection, type DisplaySelection } from '../display-model';
import { samePixel, sameRoi, sameViewState } from '../view-state';
import { ViewerInteractionCoordinator } from '../interaction-coordinator';
import { ChannelThumbnailService } from '../services/channel-thumbnail-service';
import { ThumbnailService } from '../services/thumbnail-service';
import { RenderCacheService } from '../services/render-cache-service';
import type { DisplayController } from '../controllers/display-controller';
import { ViewerAppCore } from './viewer-app-core';
import type { ViewerStateTransition } from './viewer-app-types';
import { selectActiveSession } from './viewer-app-selectors';
import type { ViewerSessionState } from '../types';

export function applySessionResourceEffects(
  transition: ViewerStateTransition,
  core: ViewerAppCore,
  renderCache: RenderCacheService,
  thumbnailService: ThumbnailService
): void {
  switch (transition.intent.type) {
    case 'sessionLoaded': {
      renderCache.trackSession(transition.intent.session);
      scheduleThumbnailGeneration(core, thumbnailService, transition.intent.session.id, transition.intent.session.state);
      return;
    }
    case 'sessionReloaded': {
      renderCache.discard(transition.intent.sessionId);
      renderCache.trackSession(transition.intent.session);
      thumbnailService.discard(transition.intent.sessionId);
      scheduleThumbnailGeneration(core, thumbnailService, transition.intent.sessionId, transition.intent.session.state);
      return;
    }
    case 'sessionClosed': {
      renderCache.discard(transition.intent.sessionId);
      thumbnailService.discard(transition.intent.sessionId);
      return;
    }
    case 'allSessionsClosed': {
      renderCache.clear();
      thumbnailService.clear();
      return;
    }
    default:
      break;
  }

  if (!shouldRefreshOpenedImageThumbnails(transition)) {
    return;
  }

  scheduleAllOpenedThumbnailGeneration(core, thumbnailService);
}

export function syncInteractionCoordinator(
  interactionCoordinator: ViewerInteractionCoordinator,
  transition: ViewerStateTransition
): void {
  const coordinatorState = interactionCoordinator.getState();
  const nextInteractionState = transition.state.interactionState;
  if (
    sameViewState(coordinatorState.view, nextInteractionState.view) &&
    samePixel(coordinatorState.hoveredPixel, nextInteractionState.hoveredPixel) &&
    sameRoi(coordinatorState.draftRoi, nextInteractionState.draftRoi)
  ) {
    return;
  }

  interactionCoordinator.syncSessionState(transition.state.sessionState, {
    clearHover: nextInteractionState.hoveredPixel === null
  });
}

export function applyChannelThumbnailEffects(
  transition: ViewerStateTransition,
  core: ViewerAppCore,
  channelThumbnailService: ChannelThumbnailService
): void {
  switch (transition.intent.type) {
    case 'sessionReloaded': {
      channelThumbnailService.discardSession(transition.intent.sessionId);
      if (transition.state.activeSessionId === transition.intent.sessionId) {
        scheduleActiveChannelThumbnailGeneration(core, channelThumbnailService);
      }
      return;
    }
    case 'sessionClosed': {
      channelThumbnailService.discardSession(transition.intent.sessionId);
      if (transition.state.activeSessionId) {
        scheduleActiveChannelThumbnailGeneration(core, channelThumbnailService);
      }
      return;
    }
    case 'allSessionsClosed': {
      channelThumbnailService.clear();
      return;
    }
    case 'sessionLoaded': {
      scheduleActiveChannelThumbnailGeneration(core, channelThumbnailService);
      return;
    }
    default:
      break;
  }

  if (!shouldRefreshActiveChannelThumbnails(transition)) {
    return;
  }

  scheduleActiveChannelThumbnailGeneration(core, channelThumbnailService);
}

export function applyActiveColormapLutEffects(
  transition: ViewerStateTransition,
  displayController: Pick<DisplayController, 'ensureActiveColormapLutLoaded'>
): void {
  if (!shouldEnsureActiveColormapLut(transition)) {
    return;
  }

  void displayController.ensureActiveColormapLutLoaded();
}

function scheduleThumbnailGeneration(
  core: ViewerAppCore,
  thumbnailService: ThumbnailService,
  sessionId: string,
  stateSnapshot: ViewerStateTransition['state']['sessionState']
): void {
  const token = core.issueRequestId();
  const state = core.getState();
  core.dispatch({
    type: 'thumbnailRequested',
    sessionId,
    token
  });
  void thumbnailService.enqueue(
    sessionId,
    stateSnapshot,
    token,
    {
      autoExposureEnabled: state.autoExposureEnabled,
      autoExposurePercentile: state.autoExposurePercentile,
      maskInvalidStokesVectors: state.maskInvalidStokesVectors,
      spectralRgbGroupingEnabled: state.spectralRgbGroupingEnabled
    }
  ).catch(() => undefined);
}

function scheduleAllOpenedThumbnailGeneration(
  core: ViewerAppCore,
  thumbnailService: ThumbnailService
): void {
  const state = core.getState();
  for (const session of state.sessions) {
    scheduleThumbnailGeneration(
      core,
      thumbnailService,
      session.id,
      resolveSessionStateSnapshot(state.activeSessionId, state.sessionState, session.id, session.state)
    );
  }
}

function resolveSessionStateSnapshot(
  activeSessionId: string | null,
  activeState: ViewerSessionState,
  sessionId: string,
  storedState: ViewerSessionState
): ViewerSessionState {
  return activeSessionId === sessionId ? activeState : storedState;
}

function scheduleActiveChannelThumbnailGeneration(
  core: ViewerAppCore,
  channelThumbnailService: ChannelThumbnailService
): void {
  const state = core.getState();
  const activeSession = selectActiveSession(state);
  if (!activeSession) {
    return;
  }

  const layer = activeSession.decoded.layers[state.sessionState.activeLayer] ?? null;
  if (!layer) {
    return;
  }

  const stateSnapshot: ViewerSessionState = {
    ...state.sessionState,
    exposureEv: state.sessionState.channelThumbnailExposureEv,
    displayGamma: state.sessionState.channelThumbnailDisplayGamma
  };

  for (const item of prioritizeSelectedChannelViewItem(
    buildChannelViewItems(layer.channelNames, {
      stokesParameterVisibility: state.stokesParameterVisibility,
      spectralRgbGroupingEnabled: state.spectralRgbGroupingEnabled
    }),
    state.sessionState.displaySelection
  )) {
    const requestKey = serializeChannelThumbnailRequestKey({
      sessionId: activeSession.id,
      activeLayer: state.sessionState.activeLayer,
      selection: item.selection,
      exposureEv: state.sessionState.channelThumbnailExposureEv,
      displayGamma: state.sessionState.channelThumbnailDisplayGamma,
      stokesDegreeModulation: state.sessionState.stokesDegreeModulation,
      stokesAolpDegreeModulationMode: state.sessionState.stokesAolpDegreeModulationMode,
      maskInvalidStokesVectors: state.maskInvalidStokesVectors
    });
    if (
      Object.prototype.hasOwnProperty.call(state.channelThumbnailsByRequestKey, requestKey)
    ) {
      continue;
    }

    const token = core.issueRequestId();
    core.dispatch({
      type: 'channelThumbnailRequested',
      requestKey,
      token
    });
    void channelThumbnailService.enqueue({
      sessionId: activeSession.id,
      requestKey,
      contextKey: serializeChannelThumbnailContextKey(
        activeSession.id,
        state.sessionState.activeLayer,
        item.selectionKey
      ),
      token,
      stateSnapshot,
      selection: item.selection,
      maskInvalidStokesVectors: state.maskInvalidStokesVectors,
      spectralRgbGroupingEnabled: state.spectralRgbGroupingEnabled
    }).catch(() => undefined);
  }
}

function prioritizeSelectedChannelViewItem(
  items: ChannelViewItem[],
  selected: DisplaySelection | null
): ChannelViewItem[] {
  if (!selected || items.length <= 1) {
    return items;
  }

  const selectedIndex = items.findIndex((item) => sameDisplaySelection(item.selection, selected));
  if (selectedIndex <= 0) {
    return items;
  }

  const selectedItem = items[selectedIndex];
  return selectedItem
    ? [
        selectedItem,
        ...items.slice(0, selectedIndex),
        ...items.slice(selectedIndex + 1)
      ]
    : items;
}

function shouldRefreshActiveChannelThumbnails(transition: ViewerStateTransition): boolean {
  if (!transition.state.activeSessionId) {
    return false;
  }

  return (
    transition.previousState.activeSessionId !== transition.state.activeSessionId ||
    transition.previousState.sessionState.activeLayer !== transition.state.sessionState.activeLayer ||
    transition.previousState.sessionState.channelThumbnailExposureEv !== transition.state.sessionState.channelThumbnailExposureEv ||
    transition.previousState.sessionState.channelThumbnailDisplayGamma !== transition.state.sessionState.channelThumbnailDisplayGamma ||
    transition.previousState.sessionState.stokesDegreeModulation.aolp !== transition.state.sessionState.stokesDegreeModulation.aolp ||
    transition.previousState.sessionState.stokesDegreeModulation.cop !== transition.state.sessionState.stokesDegreeModulation.cop ||
    transition.previousState.sessionState.stokesDegreeModulation.top !== transition.state.sessionState.stokesDegreeModulation.top ||
    transition.previousState.sessionState.stokesAolpDegreeModulationMode !== transition.state.sessionState.stokesAolpDegreeModulationMode ||
    transition.previousState.maskInvalidStokesVectors !== transition.state.maskInvalidStokesVectors ||
    transition.previousState.spectralRgbGroupingEnabled !== transition.state.spectralRgbGroupingEnabled
  );
}

function shouldRefreshOpenedImageThumbnails(transition: ViewerStateTransition): boolean {
  if (transition.state.sessions.length === 0) {
    return false;
  }

  if (transition.intent.type === 'autoExposureSet') {
    return transition.previousState.autoExposureEnabled !== transition.state.autoExposureEnabled;
  }

  if (transition.intent.type === 'autoExposurePercentileSet') {
    return (
      transition.state.autoExposureEnabled &&
      transition.previousState.autoExposurePercentile !== transition.state.autoExposurePercentile
    );
  }

  if (transition.intent.type === 'maskInvalidStokesVectorsSet') {
    return transition.previousState.maskInvalidStokesVectors !== transition.state.maskInvalidStokesVectors;
  }

  if (transition.intent.type === 'spectralRgbGroupingSet') {
    return transition.previousState.spectralRgbGroupingEnabled !== transition.state.spectralRgbGroupingEnabled;
  }

  return false;
}

function shouldEnsureActiveColormapLut(transition: ViewerStateTransition): boolean {
  if (!transition.state.activeSessionId) {
    return false;
  }

  switch (transition.intent.type) {
    case 'sessionLoaded':
      return transition.state.activeSessionId === transition.intent.session.id;
    case 'sessionReloaded':
      return transition.state.activeSessionId === transition.intent.sessionId;
    case 'activeSessionSwitched':
      return transition.state.activeSessionId === transition.intent.sessionId;
    case 'sessionClosed':
      return transition.previousState.activeSessionId === transition.intent.sessionId;
    case 'activeLayerSet':
    case 'activeSessionReset':
      return true;
    default:
      return false;
  }
}
