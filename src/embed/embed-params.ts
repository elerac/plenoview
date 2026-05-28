import {
  decodeEmbedViewerState,
  encodeEmbedViewerState,
  type EmbedViewerStateSnapshot
} from './embed-state';
import type { ViewerSessionState } from '../types';

export interface ViewerBootstrapParams {
  uiMode: 'full' | 'embed';
  src: string | null;
  gallery: string | null;
  name: string | null;
  view: ViewerSessionState['viewerMode'] | null;
  handoffId: string | null;
  state: EmbedViewerStateSnapshot | null;
}

export interface FullViewerUrlOptions {
  baseUrl: string;
  src?: string | null;
  gallery?: string | null;
  name?: string | null;
  handoffId?: string | null;
  state?: EmbedViewerStateSnapshot | null;
}

export function parseViewerBootstrapParams(location: Pick<Location, 'search' | 'hash'>): ViewerBootstrapParams {
  const params = mergeParams(parseSearchParams(location.search), parseHashParams(location.hash));
  return {
    uiMode: params.get('ui') === 'embed' || params.get('embed') === '1' ? 'embed' : 'full',
    src: normalizeNonEmpty(params.get('src')),
    gallery: normalizeNonEmpty(params.get('gallery')),
    name: normalizeNonEmpty(params.get('name')),
    view: parseViewerMode(params.get('view')),
    handoffId: normalizeNonEmpty(params.get('handoff')),
    state: decodeEmbedViewerState(params.get('state'))
  };
}

export function buildFullViewerUrl({
  baseUrl,
  src,
  gallery,
  name,
  handoffId,
  state
}: FullViewerUrlOptions): string {
  const url = new URL(baseUrl, window.location.href);
  const params = url.searchParams;
  if (src) {
    params.set('src', src);
  }
  if (gallery) {
    params.set('gallery', gallery);
  }
  if (name) {
    params.set('name', name);
  }
  const encodedState = encodeEmbedViewerState(state);
  if (encodedState) {
    params.set('state', encodedState);
  }
  if (handoffId) {
    url.hash = `handoff=${encodeURIComponent(handoffId)}`;
  }
  return url.toString();
}

function parseSearchParams(search: string): URLSearchParams {
  return new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
}

function parseHashParams(hash: string): URLSearchParams {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  const query = raw.startsWith('?') ? raw.slice(1) : raw;
  return new URLSearchParams(query);
}

function mergeParams(primary: URLSearchParams, secondary: URLSearchParams): URLSearchParams {
  const merged = new URLSearchParams(primary);
  for (const [key, value] of secondary) {
    if (!merged.has(key)) {
      merged.set(key, value);
    }
  }
  return merged;
}

function normalizeNonEmpty(value: string | null): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : null;
}

function parseViewerMode(value: string | null): ViewerSessionState['viewerMode'] | null {
  return value === 'image' || value === 'panorama' || value === 'depth' ? value : null;
}
