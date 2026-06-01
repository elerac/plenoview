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
      search: `?ui=embed&src=${encodeURIComponent('https://example.com/a.exr')}&gallery=cbox-rgb&view=image&state=${encodedState}`,
      hash: '#handoff=local-1'
    });

    expect(parsed).toMatchObject({
      uiMode: 'embed',
      src: 'https://example.com/a.exr',
      view: 'image',
      autoLoad: true,
      bottomPanel: 'probe',
      handoffId: 'local-1',
      state
    });
    expect('gallery' in parsed).toBe(false);
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

  it('parses autoLoad as true by default and for true-ish values', () => {
    expect(parseViewerBootstrapParams({ search: '', hash: '' }).autoLoad).toBe(true);

    for (const value of ['', 'true', '1', 'yes', 'on', 'unexpected']) {
      expect(parseViewerBootstrapParams({
        search: `?autoLoad=${encodeURIComponent(value)}`,
        hash: ''
      }).autoLoad).toBe(true);
    }
  });

  it('parses autoLoad false-ish values', () => {
    for (const value of ['false', '0', 'no', 'off']) {
      expect(parseViewerBootstrapParams({
        search: `?autoLoad=${encodeURIComponent(value)}`,
        hash: ''
      }).autoLoad).toBe(false);
    }
  });

  it('parses embed bottom panel modes', () => {
    expect(parseViewerBootstrapParams({ search: '', hash: '' }).bottomPanel).toBe('probe');

    for (const value of ['probe', 'channels', 'none']) {
      expect(parseViewerBootstrapParams({
        search: `?bottomPanel=${encodeURIComponent(value)}`,
        hash: ''
      }).bottomPanel).toBe(value);
    }

    expect(parseViewerBootstrapParams({
      search: '?bottomPanel=unexpected',
      hash: ''
    }).bottomPanel).toBe('probe');
  });
});
