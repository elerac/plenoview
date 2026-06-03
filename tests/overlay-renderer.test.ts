// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { OverlayRenderer } from '../src/rendering/overlay-renderer';
import {
  createChannelRgbSelection,
  createLayerFromChannels,
  createStokesSelection,
  createViewerState
} from './helpers/state-fixtures';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('overlay renderer', () => {
  it('does not render value labels in panorama mode', () => {
    const { renderer, context } = createOverlayHarness();
    const layer = createDisplayLayer(1);

    renderer.resize(800, 400);
    renderer.setDisplaySelectionContext(1000, 500, layer, createChannelRgbSelection('R', 'G', 'B'), 'rgb');
    renderer.render(createViewerState({
      viewerMode: 'panorama',
      panoramaHfovDeg: 2,
      displaySelection: createChannelRgbSelection('R', 'G', 'B')
    }));

    expect(context.fillText).not.toHaveBeenCalled();
  });

  it('does not render value labels below the fade start zoom', () => {
    const { renderer, context } = createOverlayHarness();
    const layer = createDisplayLayer(2);

    renderer.resize(128, 64);
    renderer.setDisplaySelectionContext(2, 1, layer, createChannelRgbSelection('R', 'G', 'B'), 'rgb');
    renderer.render(createViewerState({
      viewerMode: 'image',
      zoom: 24,
      panX: 1,
      panY: 0.5,
      displaySelection: createChannelRgbSelection('R', 'G', 'B')
    }));

    expect(context.fillText).not.toHaveBeenCalled();
    expect(context.alphaHistory).toEqual([]);
    expect(context.globalAlpha).toBe(1);
  });

  it('fades value labels in with partial transparency inside the zoom ramp', () => {
    const { renderer, context } = createOverlayHarness();
    const layer = createDisplayLayer(2);

    renderer.resize(128, 64);
    renderer.setDisplaySelectionContext(2, 1, layer, createChannelRgbSelection('R', 'G', 'B'), 'rgb');
    renderer.render(createViewerState({
      viewerMode: 'image',
      zoom: 28,
      panX: 1,
      panY: 0.5,
      displaySelection: createChannelRgbSelection('R', 'G', 'B')
    }));

    expect(context.fillText).toHaveBeenCalled();
    expect(context.alphaHistory).toEqual([0.5, 1]);
    expect(context.globalAlpha).toBe(1);
  });

  it('renders value labels at full opacity at and above the full-opacity zoom', () => {
    const { renderer, context } = createOverlayHarness();
    const layer = createDisplayLayer(2);

    renderer.resize(128, 64);
    renderer.setDisplaySelectionContext(2, 1, layer, createChannelRgbSelection('R', 'G', 'B'), 'rgb');
    renderer.render(createViewerState({
      viewerMode: 'image',
      zoom: 32,
      panX: 1,
      panY: 0.5,
      displaySelection: createChannelRgbSelection('R', 'G', 'B')
    }));

    expect(context.fillText).toHaveBeenCalled();
    expect(context.alphaHistory).toEqual([1, 1]);
    expect(context.globalAlpha).toBe(1);
  });

  it('renders non-finite channel values without normalizing them', () => {
    const { renderer, context } = createOverlayHarness();
    const selection = createChannelRgbSelection('R', 'G', 'B', 'A');
    const layer = createLayerFromChannels({
      R: [Number.NaN],
      G: [Number.POSITIVE_INFINITY],
      B: [Number.NEGATIVE_INFINITY],
      A: [Number.NEGATIVE_INFINITY]
    });

    renderer.resize(128, 128);
    renderer.setDisplaySelectionContext(1, 1, layer, selection, 'rgb');
    renderer.render(createViewerState({
      viewerMode: 'image',
      zoom: 32,
      panX: 0.5,
      panY: 0.5,
      displaySelection: selection
    }));

    expect(context.fillText.mock.calls.map(([text]) => text)).toEqual([
      'nan',
      '+inf',
      '-inf',
      '-inf'
    ]);
  });

  it('renders invalid Stokes derived values as nan', () => {
    const { renderer, context } = createOverlayHarness();
    const selection = createStokesSelection('dolp');
    const layer = createLayerFromChannels({
      S0: [1],
      S1: [Number.NaN],
      S2: [0],
      S3: [0]
    });

    renderer.resize(128, 128);
    renderer.setDisplaySelectionContext(1, 1, layer, selection, 'rgb');
    renderer.render(createViewerState({
      viewerMode: 'image',
      zoom: 32,
      panX: 0.5,
      panY: 0.5,
      displaySelection: selection
    }));

    expect(context.fillText.mock.calls.map(([text]) => text)).toEqual([
      'nan',
      'nan',
      'nan'
    ]);
  });

  it('clears the full backing store when the image is cleared or disposed', () => {
    const { canvas, renderer, context } = createOverlayHarness();
    const layer = createDisplayLayer(2);

    renderer.resize(128, 64);
    renderer.setDisplaySelectionContext(2, 1, layer, createChannelRgbSelection('R', 'G', 'B'), 'rgb');
    renderer.render(createViewerState({
      viewerMode: 'image',
      zoom: 32,
      panX: 1,
      panY: 0.5,
      displaySelection: createChannelRgbSelection('R', 'G', 'B')
    }));

    expect(context.fillText).toHaveBeenCalled();
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

function createOverlayHarness(): {
  canvas: HTMLCanvasElement;
  renderer: OverlayRenderer;
  context: CanvasRenderingContext2D & {
    alphaHistory: number[];
    clearRect: ReturnType<typeof vi.fn>;
    measureText: ReturnType<typeof vi.fn>;
    strokeText: ReturnType<typeof vi.fn>;
    fillText: ReturnType<typeof vi.fn>;
    strokeRect: ReturnType<typeof vi.fn>;
  };
} {
  let globalAlpha = 1;
  const alphaHistory: number[] = [];
  const context = {
    alphaHistory,
    clearRect: vi.fn(),
    measureText: vi.fn(() => ({ width: 40 })),
    strokeText: vi.fn(),
    fillText: vi.fn(),
    strokeRect: vi.fn(),
    font: '',
    textAlign: 'center',
    textBaseline: 'middle',
    lineJoin: 'round',
    lineWidth: 1,
    strokeStyle: '',
    fillStyle: ''
  } as unknown as CanvasRenderingContext2D & {
    alphaHistory: number[];
    clearRect: ReturnType<typeof vi.fn>;
    measureText: ReturnType<typeof vi.fn>;
    strokeText: ReturnType<typeof vi.fn>;
    fillText: ReturnType<typeof vi.fn>;
    strokeRect: ReturnType<typeof vi.fn>;
  };

  Object.defineProperty(context, 'globalAlpha', {
    configurable: true,
    enumerable: true,
    get: () => globalAlpha,
    set: (value: number) => {
      globalAlpha = value;
      alphaHistory.push(value);
    }
  });

  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((contextId) => {
    if (contextId === '2d') {
      return context;
    }
    return null;
  });

  const canvas = document.createElement('canvas');
  return {
    canvas,
    renderer: new OverlayRenderer(canvas),
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

function createDisplayLayer(pixelCount: number) {
  return createLayerFromChannels({
    R: new Float32Array(pixelCount).fill(1),
    G: new Float32Array(pixelCount).fill(0.5),
    B: new Float32Array(pixelCount).fill(0.25)
  });
}
