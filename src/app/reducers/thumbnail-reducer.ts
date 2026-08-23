import {
  getSuccessValue,
  idleResource,
  isPendingMatch,
  pendingResource,
  staleResource,
  successResource
} from '../../async-resource';
import { buildChannelThumbnailSessionPrefix } from '../../channel-thumbnail-keys';
import type { ViewerAppState, ViewerIntent } from '../viewer-app-types';
import { sessionExists, type ViewerReducerContext } from './shared';

export function thumbnailReducer(
  state: ViewerAppState,
  intent: ViewerIntent,
  context: ViewerReducerContext
): ViewerAppState {
  switch (intent.type) {
    case 'sessionLoaded':
      return {
        ...state,
        thumbnailsBySessionId: {
          ...state.thumbnailsBySessionId,
          [intent.session.id]: staleResource(intent.session.id)
        }
      };
    case 'thumbnailRequested': {
      const currentThumbnail = state.thumbnailsBySessionId[intent.sessionId] ?? idleResource<string | null>();
      return {
        ...state,
        thumbnailsBySessionId: {
          ...state.thumbnailsBySessionId,
          [intent.sessionId]: pendingResource(intent.sessionId, intent.token, getSuccessValue(currentThumbnail))
        }
      };
    }
    case 'thumbnailReady':
      if (!isPendingMatch(
        state.thumbnailsBySessionId[intent.sessionId] ?? idleResource(),
        intent.sessionId,
        intent.token
      )) {
        return state;
      }
      return {
        ...state,
        thumbnailsBySessionId: {
          ...state.thumbnailsBySessionId,
          [intent.sessionId]: successResource(intent.sessionId, intent.thumbnailDataUrl)
        }
      };
    case 'channelThumbnailsRequested': {
      if (intent.requests.length === 0) {
        return state;
      }
      const channelThumbnailsByRequestKey = {
        ...state.channelThumbnailsByRequestKey
      };
      for (const request of intent.requests) {
        channelThumbnailsByRequestKey[request.requestKey] = pendingResource(
          request.requestKey,
          request.token
        );
      }
      return {
        ...state,
        channelThumbnailsByRequestKey
      };
    }
    case 'channelThumbnailReady':
      if (!isPendingMatch(
        state.channelThumbnailsByRequestKey[intent.requestKey] ?? idleResource(),
        intent.requestKey,
        intent.token
      )) {
        return state;
      }
      return {
        ...state,
        channelThumbnailsByRequestKey: {
          ...state.channelThumbnailsByRequestKey,
          [intent.requestKey]: successResource(intent.requestKey, intent.thumbnailDataUrl)
        },
        channelThumbnailLatestRequestKeyByContextKey: {
          ...state.channelThumbnailLatestRequestKeyByContextKey,
          [intent.contextKey]: intent.requestKey
        }
      };
    case 'sessionReloaded':
      if (!sessionExists(context.initialState, intent.sessionId)) {
        return state;
      }
      {
        const currentThumbnail = state.thumbnailsBySessionId[intent.sessionId] ?? idleResource<string | null>();
        return {
          ...state,
          thumbnailsBySessionId: {
            ...state.thumbnailsBySessionId,
            [intent.sessionId]: staleResource(intent.sessionId, getSuccessValue(currentThumbnail))
          },
          ...pruneChannelThumbnailStateForSession(state, intent.sessionId)
        };
      }
    case 'sessionClosed':
      return sessionExists(context.initialState, intent.sessionId)
        ? removeThumbnailStateForSession(state, intent.sessionId)
        : state;
    case 'allSessionsClosed':
      return {
        ...state,
        thumbnailsBySessionId: {},
        channelThumbnailsByRequestKey: {},
        channelThumbnailLatestRequestKeyByContextKey: {}
      };
    default:
      return state;
  }
}

function removeThumbnailStateForSession(state: ViewerAppState, sessionId: string): ViewerAppState {
  const {
    [sessionId]: _removedThumb,
    ...thumbnailsBySessionId
  } = state.thumbnailsBySessionId;

  return {
    ...state,
    thumbnailsBySessionId,
    ...pruneChannelThumbnailStateForSession(state, sessionId)
  };
}

function pruneChannelThumbnailStateForSession(
  state: Pick<
    ViewerAppState,
    | 'channelThumbnailsByRequestKey'
    | 'channelThumbnailLatestRequestKeyByContextKey'
  >,
  sessionId: string
): Pick<
  ViewerAppState,
  | 'channelThumbnailsByRequestKey'
  | 'channelThumbnailLatestRequestKeyByContextKey'
> {
  const sessionPrefix = buildChannelThumbnailSessionPrefix(sessionId);
  const channelThumbnailsByRequestKey = Object.fromEntries(
    Object.entries(state.channelThumbnailsByRequestKey)
      .filter(([requestKey]) => !requestKey.startsWith(sessionPrefix))
  );
  const channelThumbnailLatestRequestKeyByContextKey = Object.fromEntries(
    Object.entries(state.channelThumbnailLatestRequestKeyByContextKey)
      .filter(([contextKey]) => !contextKey.startsWith(sessionPrefix))
      .filter(([, requestKey]) => !requestKey.startsWith(sessionPrefix))
  );

  return {
    channelThumbnailsByRequestKey,
    channelThumbnailLatestRequestKeyByContextKey
  };
}
