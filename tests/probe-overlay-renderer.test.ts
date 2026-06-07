// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProbeOverlayRenderer } from '../src/rendering/probe-overlay-renderer';
import { createLayerFromChannels, createViewerState } from './helpers/state-fixtures';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('probe overlay renderer', () => {
  it('renders the probe marker on its dedicated canvas layer', () => {
    const { renderer, context } = createProbeOverlayHarness();

    renderer.resize(128, 64);
    renderer.setImagePresent(true);
    renderer.render(createViewerState({
      zoom: 32,
      panX: 1,
      panY: 0.5,
      hoveredPixel: { ix: 0, iy: 0 }
    }));

    expect(context.strokeRect).toHaveBeenCalledTimes(1);
  });

  it('clears without drawing when there is no active probe target', () => {
    const { renderer, context } = createProbeOverlayHarness();

    renderer.resize(128, 64);
    renderer.setImagePresent(true);
    renderer.render(createViewerState());

    expect(context.strokeRect).not.toHaveBeenCalled();
  });

  it('renders committed and draft ROI rectangles on the shared overlay', () => {
    const { renderer, context } = createProbeOverlayHarness();

    renderer.resize(128, 64);
    renderer.setImagePresent(true);
    renderer.render(createViewerState({
      zoom: 16,
      roi: { x0: 1, y0: 1, x1: 2, y1: 2 },
      draftRoi: { x0: 0, y0: 0, x1: 1, y1: 1 }
    }));

    expect(context.strokeRect).toHaveBeenCalledTimes(2);
  });

  it('skips probe markers while keeping ROI drawing when probe markers are disabled', () => {
    const { renderer, context } = createProbeOverlayHarness();

    renderer.resize(128, 64);
    renderer.setImagePresent(true);
    renderer.setProbeMarkerEnabled(false);
    renderer.render(createViewerState({
      zoom: 16,
      hoveredPixel: { ix: 0, iy: 0 },
      roi: { x0: 1, y0: 1, x1: 2, y1: 2 }
    }));

    expect(context.strokeRect).toHaveBeenCalledTimes(1);
  });

  it('suppresses ROI drawing in panorama mode', () => {
    const { renderer, context } = createProbeOverlayHarness();

    renderer.resize(128, 64);
    renderer.setImagePresent(true);
    renderer.render(createViewerState({
      viewerMode: 'panorama',
      roi: { x0: 0, y0: 0, x1: 1, y1: 1 }
    }));

    expect(context.strokeRect).not.toHaveBeenCalled();
  });

  it('renders the probe marker in 3D mode using depth projection', () => {
    const { renderer, context } = createProbeOverlayHarness();
    const layer = createLayerFromChannels({
      Z: [2]
    });

    renderer.resize(128, 64);
    renderer.setImagePresent(true);
    renderer.setSourceContext(1, 1, layer);
    renderer.setDepthSourceContext(
      { kind: 'scalarDepth', channelName: 'Z' },
      { kind: 'scalarDepth', range: { min: 2, max: 2 } }
    );
    renderer.render(createViewerState({
      viewerMode: '3d',
      depthChannel: 'Z',
      hoveredPixel: { ix: 0, iy: 0 }
    }));

    expect(context.strokeRect).toHaveBeenCalledTimes(1);
  });

  it('renders the 3D probe marker with the current depth target translation', () => {
    const { renderer, context } = createProbeOverlayHarness();
    const layer = createLayerFromChannels({
      Z: [1]
    });

    renderer.resize(100, 100);
    renderer.setImagePresent(true);
    renderer.setSourceContext(1, 1, layer);
    renderer.setDepthSourceContext(
      { kind: 'scalarDepth', channelName: 'Z' },
      { kind: 'scalarDepth', range: { min: 1, max: 1 } }
    );
    renderer.render(createViewerState({
      viewerMode: '3d',
      depthChannel: 'Z',
      depthTargetX: -0.1,
      depthTargetY: 0.2,
      depthTargetZ: 0,
      depthPointSizePx: 6,
      hoveredPixel: { ix: 0, iy: 0 }
    }));

    expect(context.strokeRect).toHaveBeenCalledTimes(1);
    const [[x, y, width, height]] = context.strokeRect.mock.calls as Array<[number, number, number, number]>;
    expect(x).toBeCloseTo(57);
    expect(y).toBeCloseTo(67);
    expect(width).toBeCloseTo(6);
    expect(height).toBeCloseTo(6);
  });

  it('renders the probe marker in 3D mode using position projection', () => {
    const { renderer, context } = createProbeOverlayHarness();
    const layer = createLayerFromChannels({
      'P.X': [0],
      'P.Y': [0],
      'P.Z': [0]
    });

    renderer.resize(128, 64);
    renderer.setImagePresent(true);
    renderer.setSourceContext(1, 1, layer);
    renderer.setDepthSourceContext(
      {
        kind: 'xyzPosition',
        base: 'P',
        xChannel: 'P.X',
        yChannel: 'P.Y',
        zChannel: 'P.Z'
      },
      {
        kind: 'xyzPosition',
        bounds: {
          minX: 0,
          maxX: 0,
          minY: 0,
          maxY: 0,
          minZ: 0,
          maxZ: 0
        }
      }
    );
    renderer.render(createViewerState({
      viewerMode: '3d',
      depthChannel: '__position:P',
      hoveredPixel: { ix: 0, iy: 0 }
    }));

    expect(context.strokeRect).toHaveBeenCalledTimes(1);
  });

  it('does not render a depth probe marker for invalid depth', () => {
    const { renderer, context } = createProbeOverlayHarness();
    const layer = createLayerFromChannels({
      Z: [0]
    });

    renderer.resize(128, 64);
    renderer.setImagePresent(true);
    renderer.setSourceContext(1, 1, layer);
    renderer.setDepthSourceContext(
      { kind: 'scalarDepth', channelName: 'Z' },
      { kind: 'scalarDepth', range: { min: 1, max: 1 } }
    );
    renderer.render(createViewerState({
      viewerMode: '3d',
      depthChannel: 'Z',
      hoveredPixel: { ix: 0, iy: 0 }
    }));

    expect(context.strokeRect).not.toHaveBeenCalled();
  });

  it('does not render a depth probe marker for invalid position samples', () => {
    const { renderer, context } = createProbeOverlayHarness();
    const layer = createLayerFromChannels({
      'P.X': [0],
      'P.Y': [Number.NaN],
      'P.Z': [0]
    });

    renderer.resize(128, 64);
    renderer.setImagePresent(true);
    renderer.setSourceContext(1, 1, layer);
    renderer.setDepthSourceContext(
      {
        kind: 'xyzPosition',
        base: 'P',
        xChannel: 'P.X',
        yChannel: 'P.Y',
        zChannel: 'P.Z'
      },
      {
        kind: 'xyzPosition',
        bounds: {
          minX: 0,
          maxX: 0,
          minY: 0,
          maxY: 0,
          minZ: 0,
          maxZ: 0
        }
      }
    );
    renderer.render(createViewerState({
      viewerMode: '3d',
      depthChannel: '__position:P',
      hoveredPixel: { ix: 0, iy: 0 }
    }));

    expect(context.strokeRect).not.toHaveBeenCalled();
  });

  it('keeps ROI drawing suppressed in 3D mode', () => {
    const { renderer, context } = createProbeOverlayHarness();

    renderer.resize(128, 64);
    renderer.setImagePresent(true);
    renderer.render(createViewerState({
      viewerMode: '3d',
      roi: { x0: 0, y0: 0, x1: 1, y1: 1 }
    }));

    expect(context.strokeRect).not.toHaveBeenCalled();
  });

  it('renders ROI adjustment handles while editing', () => {
    const { renderer, context } = createProbeOverlayHarness();

    renderer.resize(128, 64);
    renderer.setImagePresent(true);
    renderer.render(createViewerState({
      zoom: 16,
      roi: { x0: 1, y0: 1, x1: 2, y1: 2 },
      draftRoi: { x0: 1, y0: 1, x1: 3, y1: 3 },
      roiInteraction: {
        hoverHandle: 'edge-e',
        activeHandle: 'edge-e'
      }
    }));

    expect(context.fillRect).toHaveBeenCalled();
    expect(context.strokeRect).toHaveBeenCalledTimes(10);
  });

  it('clears the full backing store when the image is cleared or disposed', () => {
    const { canvas, renderer, context } = createProbeOverlayHarness();

    renderer.resize(128, 64);
    renderer.setImagePresent(true);
    renderer.render(createViewerState({
      zoom: 32,
      panX: 1,
      panY: 0.5,
      hoveredPixel: { ix: 0, iy: 0 }
    }));

    canvas.width = 256;
    canvas.height = 128;
    const widthAssignments = trackCanvasWidthAssignments(canvas);

    renderer.clearImage();

    expect(widthAssignments).toEqual([256]);
    expect(canvas.width).toBe(256);
    expect(canvas.height).toBe(128);
    expect(context.clearRect).not.toHaveBeenCalled();

    widthAssignments.length = 0;
    canvas.width = 512;
    canvas.height = 256;
    widthAssignments.length = 0;

    renderer.dispose();

    expect(widthAssignments).toEqual([512]);
    expect(canvas.width).toBe(512);
    expect(canvas.height).toBe(256);
    expect(context.clearRect).not.toHaveBeenCalled();
  });
});

function createProbeOverlayHarness(): {
  canvas: HTMLCanvasElement;
  renderer: ProbeOverlayRenderer;
  context: CanvasRenderingContext2D & {
    clearRect: ReturnType<typeof vi.fn>;
    fillRect: ReturnType<typeof vi.fn>;
    strokeRect: ReturnType<typeof vi.fn>;
  };
} {
  const context = {
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    fillStyle: '',
    lineWidth: 1,
    strokeStyle: ''
  } as unknown as CanvasRenderingContext2D & {
    clearRect: ReturnType<typeof vi.fn>;
    fillRect: ReturnType<typeof vi.fn>;
    strokeRect: ReturnType<typeof vi.fn>;
  };

  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((contextId) => {
    if (contextId === '2d') {
      return context;
    }
    return null;
  });

  const canvas = document.createElement('canvas');
  return {
    canvas,
    renderer: new ProbeOverlayRenderer(canvas),
    context
  };
}

function trackCanvasWidthAssignments(canvas: HTMLCanvasElement): number[] {
  let trackedWidth = canvas.width;
  const assignments: number[] = [];
  Object.defineProperty(canvas, 'width', {
    configurable: true,
    get: () => trackedWidth,
    set: (value: number) => {
      trackedWidth = value;
      assignments.push(value);
    }
  });
  return assignments;
}
