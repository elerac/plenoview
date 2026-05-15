import { serializeDisplaySelectionKey } from './display-model';
import type { DisplaySelection } from './display-model';
import type { ViewerIntent } from './app/viewer-app-types';

export type ViewerInteractionTraceEvent =
  | {
      type: 'channelThumbnailPointerDown' | 'channelThumbnailPointerUp' | 'channelThumbnailClick';
      value: string;
      time: number;
    }
  | {
      type: 'channelThumbnailReady';
      requestKey: string;
      time: number;
    }
  | {
      type: 'displaySelectionSet';
      selectionKey: string | null;
      time: number;
    }
  | {
      type: 'displayChannelPrepareStart';
      sessionId: string;
      missingChannelCount: number;
      time: number;
    }
  | {
      type: 'displayChannelPrepareEnd';
      sessionId: string;
      missingChannelCount: number;
      textureBytes: number;
      materializedBytes: number;
      durationMs: number;
      time: number;
    };

type ViewerInteractionTraceEventInput = ViewerInteractionTraceEvent extends infer Event
  ? Event extends { time: number }
    ? Omit<Event, 'time'>
    : never
  : never;

declare global {
  interface Window {
    __openExrViewerInteractionTrace?: (event: ViewerInteractionTraceEvent) => void;
  }
}

export function traceViewerInteraction(
  event: ViewerInteractionTraceEventInput
): void {
  if (typeof window === 'undefined') {
    return;
  }

  const trace = window.__openExrViewerInteractionTrace;
  if (typeof trace !== 'function') {
    return;
  }

  try {
    trace({
      ...event,
      time: performance.now()
    } as ViewerInteractionTraceEvent);
  } catch {
    // Test-only tracing should never affect production interaction behavior.
  }
}

export function traceViewerIntent(intent: ViewerIntent): void {
  if (intent.type === 'channelThumbnailReady') {
    traceViewerInteraction({
      type: 'channelThumbnailReady',
      requestKey: intent.requestKey
    });
    return;
  }

  if (intent.type === 'displaySelectionSet') {
    traceViewerInteraction({
      type: 'displaySelectionSet',
      selectionKey: serializeNullableDisplaySelection(intent.displaySelection)
    });
  }
}

function serializeNullableDisplaySelection(selection: DisplaySelection | null): string | null {
  return selection ? serializeDisplaySelectionKey(selection) : null;
}
