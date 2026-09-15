// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { buildFullViewerUrl, parseViewerBootstrapParams } from '../src/embed/embed-params';
import { decodeEmbedViewerState, encodeEmbedViewerState } from '../src/embed/embed-state';

describe('embed params', () => {
  it('parses embed source, handoff, view, and serialized state', () => {
    const state = {
      viewerMode: 'panorama' as const,
      lockedPixel: { ix: 195, iy: 169 },
      depthChannel: 'Z',
      depthFocalLengthPx: 960,
      depthPointSizePx: 2,
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
      panoramaAnimation: {
        autoRotate: false,
        rotationSpeedDegPerSecond: 6
      },
      threeDAnimation: {
        autoOrbit: false,
        orbitSpeedDegPerSecond: 6,
        orbitYawAmplitudeDeg: 12,
        orbitPitchAmplitudeDeg: 2
      },
      handoffId: 'local-1',
      state
    });
    expect('gallery' in parsed).toBe(false);
  });

  it('round-trips locked pixels and depth inspection settings through serialized state', () => {
    const state = {
      viewerMode: '3d' as const,
      depthChannel: 'Z',
      depthFocalLengthPx: 960,
      depthPointSizePx: 2,
      lockedPixel: { ix: 406, iy: 300 },
      view: {
        depthYawDeg: -5.3,
        depthPitchDeg: 0.65,
        depthZoom: 2,
        depthTargetX: 0.1,
        depthTargetY: -0.2,
        depthTargetZ: 0.3
      }
    };

    const encodedState = encodeEmbedViewerState(state);
    expect(decodeEmbedViewerState(encodedState)).toEqual(state);
    expect(decodeEmbedViewerState(encodeEmbedViewerState({
      lockedPixel: null,
      depthChannel: null,
      depthFocalLengthPx: null
    }))).toEqual({
      lockedPixel: null,
      depthChannel: null,
      depthFocalLengthPx: null,
      view: {}
    });
  });

  it.each(['roughplastic', 'smoothSilver'] as const)('round-trips and normalizes %s sphere material state', (type) => {
    const state = {
      panoramaDisplayMode: 'environmentLighting' as const,
      panoramaLightingMethod: 'pathTracing' as const,
      environmentSphereMaterial: {
        type,
        diffuseReflectance: { r: 0.2, g: 0.3, b: 0.4 },
        alpha: 0.25,
        intIor: 1.6,
        extIor: 1,
        distribution: 'ggx' as const,
        nonlinear: true
      }
    };

    expect(decodeEmbedViewerState(encodeEmbedViewerState(state))).toMatchObject({
      ...state,
      environmentSphereMaterial: { ...state.environmentSphereMaterial, distribution: 'beckmann' }
    });
    expect(decodeEmbedViewerState(encodeEmbedViewerState({
      environmentSphereMaterial: {
        ...state.environmentSphereMaterial,
        diffuseReflectance: { r: -1, g: 0.3, b: 2 },
        alpha: 0,
        intIor: 8
      }
    }))?.environmentSphereMaterial).toMatchObject({
      diffuseReflectance: { r: 0, g: 0.3, b: 1 },
      alpha: 0.001,
      intIor: 4
    });
  });

  it('builds static-hosting friendly full viewer URLs', () => {
    const url = buildFullViewerUrl({
      baseUrl: '/plenoview/app/',
      src: 'https://example.com/render.exr',
      name: 'render',
      handoffId: 'abc',
      state: {
        viewerMode: 'image',
        view: { zoom: 2, panX: 5, panY: 6 }
      }
    });

    const parsed = new URL(url);
    expect(parsed.pathname).toBe('/plenoview/app/');
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

  it('parses panorama auto-rotation as false by default and for false-ish values', () => {
    expect(parseViewerBootstrapParams({ search: '', hash: '' }).panoramaAnimation).toEqual({
      autoRotate: false,
      rotationSpeedDegPerSecond: 6
    });

    for (const value of ['false', '0', 'no', 'off']) {
      expect(parseViewerBootstrapParams({
        search: `?panoramaAutoRotate=${encodeURIComponent(value)}`,
        hash: ''
      }).panoramaAnimation.autoRotate).toBe(false);
    }
  });

  it('parses panorama auto-rotation true-ish values and signed clamped speeds', () => {
    for (const value of ['', 'true', '1', 'yes', 'on', 'unexpected']) {
      expect(parseViewerBootstrapParams({
        search: `?panoramaAutoRotate=${encodeURIComponent(value)}`,
        hash: ''
      }).panoramaAnimation.autoRotate).toBe(true);
    }

    expect(parseViewerBootstrapParams({
      search: '?panoramaAutoRotate=true&panoramaRotationSpeed=12.5',
      hash: ''
    }).panoramaAnimation).toEqual({
      autoRotate: true,
      rotationSpeedDegPerSecond: 12.5
    });
    expect(parseViewerBootstrapParams({
      search: '?panoramaRotationSpeed=100',
      hash: ''
    }).panoramaAnimation.rotationSpeedDegPerSecond).toBe(60);
    expect(parseViewerBootstrapParams({
      search: '?panoramaRotationSpeed=-100',
      hash: ''
    }).panoramaAnimation.rotationSpeedDegPerSecond).toBe(-60);
    expect(parseViewerBootstrapParams({
      search: '?panoramaRotationSpeed=not-a-number',
      hash: ''
    }).panoramaAnimation.rotationSpeedDegPerSecond).toBe(6);
  });

  it('parses 3D auto-orbit config with clamped speed and amplitudes', () => {
    expect(parseViewerBootstrapParams({ search: '', hash: '' }).threeDAnimation).toEqual({
      autoOrbit: false,
      orbitSpeedDegPerSecond: 6,
      orbitYawAmplitudeDeg: 12,
      orbitPitchAmplitudeDeg: 2
    });

    for (const value of ['false', '0', 'no', 'off']) {
      expect(parseViewerBootstrapParams({
        search: `?threeDAutoOrbit=${encodeURIComponent(value)}`,
        hash: ''
      }).threeDAnimation.autoOrbit).toBe(false);
    }

    for (const value of ['', 'true', '1', 'yes', 'on', 'unexpected']) {
      expect(parseViewerBootstrapParams({
        search: `?threeDAutoOrbit=${encodeURIComponent(value)}`,
        hash: ''
      }).threeDAnimation.autoOrbit).toBe(true);
    }

    expect(parseViewerBootstrapParams({
      search: '?three-d-auto-orbit=true&three-d-orbit-speed=9&three-d-orbit-yaw=14&three-d-orbit-pitch=3',
      hash: ''
    }).threeDAnimation).toEqual({
      autoOrbit: true,
      orbitSpeedDegPerSecond: 9,
      orbitYawAmplitudeDeg: 14,
      orbitPitchAmplitudeDeg: 3
    });
    expect(parseViewerBootstrapParams({
      search: '?threeDOrbitSpeed=100&threeDOrbitYaw=100&threeDOrbitPitch=100',
      hash: ''
    }).threeDAnimation).toEqual({
      autoOrbit: false,
      orbitSpeedDegPerSecond: 30,
      orbitYawAmplitudeDeg: 30,
      orbitPitchAmplitudeDeg: 8
    });
    expect(parseViewerBootstrapParams({
      search: '?threeDOrbitSpeed=-1&threeDOrbitYaw=-1&threeDOrbitPitch=-1',
      hash: ''
    }).threeDAnimation).toEqual({
      autoOrbit: false,
      orbitSpeedDegPerSecond: 0,
      orbitYawAmplitudeDeg: 0,
      orbitPitchAmplitudeDeg: 0
    });
    expect(parseViewerBootstrapParams({
      search: '?threeDOrbitSpeed=nan&threeDOrbitYaw=nan&threeDOrbitPitch=nan',
      hash: ''
    }).threeDAnimation).toEqual({
      autoOrbit: false,
      orbitSpeedDegPerSecond: 6,
      orbitYawAmplitudeDeg: 12,
      orbitPitchAmplitudeDeg: 2
    });
  });
});
