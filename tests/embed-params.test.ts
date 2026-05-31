// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { buildFullViewerUrl, parseViewerBootstrapParams } from '../src/embed/embed-params';
import { encodeEmbedViewerState } from '../src/embed/embed-state';

describe('embed params', () => {
  it('parses embed source, handoff, view, and serialized state', () => {
    const state = {
      viewerMode: 'panorama' as const,
      view: {
        panoramaYawDeg: 20,
        panoramaPitchDeg: -4
      }
    };
    const encodedState = encodeEmbedViewerState(state);

    const parsed = parseViewerBootstrapParams({
      search: `?ui=embed&src=${encodeURIComponent('https://example.com/a.exr')}&view=image&state=${encodedState}`,
      hash: '#handoff=local-1'
    });

    expect(parsed).toMatchObject({
      uiMode: 'embed',
      src: 'https://example.com/a.exr',
      view: 'image',
      handoffId: 'local-1',
      state
    });
  });

  it('builds static-hosting friendly full viewer URLs', () => {
    const url = buildFullViewerUrl({
      baseUrl: '/openexr_viewer/app/',
      src: 'https://example.com/render.exr',
      name: 'render',
      handoffId: 'abc',
      state: {
        viewerMode: 'image',
        view: { zoom: 2, panX: 5, panY: 6 }
      }
    });

    const parsed = new URL(url);
    expect(parsed.pathname).toBe('/openexr_viewer/app/');
    expect(parsed.searchParams.get('src')).toBe('https://example.com/render.exr');
    expect(parsed.searchParams.get('name')).toBe('render');
    expect(parsed.searchParams.get('state')).toBeTruthy();
    expect(parsed.hash).toBe('#handoff=abc');
  });
});
