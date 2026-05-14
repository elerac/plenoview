import { describe, expect, it } from 'vitest';
import {
  activateViewerPane,
  computeViewerPaneRects,
  countViewerPaneLeaves,
  createSinglePaneLayout,
  normalizeActivePanePath,
  resetViewerPaneLayout,
  splitActiveViewerPane
} from '../src/viewer-pane-layout';

describe('viewer pane layout', () => {
  it('starts as one active leaf and resets to a single pane', () => {
    const split = splitActiveViewerPane(createSinglePaneLayout(), 'vertical');

    expect(countViewerPaneLeaves(split.root)).toBe(2);
    expect(resetViewerPaneLayout()).toEqual(createSinglePaneLayout());
  });

  it('splits the active pane and focuses the new right or bottom child', () => {
    const vertical = splitActiveViewerPane(createSinglePaneLayout(), 'vertical');
    expect(vertical.activePanePath).toEqual([1]);

    const horizontal = splitActiveViewerPane(vertical, 'horizontal');
    expect(horizontal.activePanePath).toEqual([1, 1]);
    expect(countViewerPaneLeaves(horizontal.root)).toBe(3);
  });

  it('normalizes invalid active paths to the first leaf', () => {
    const layout = splitActiveViewerPane(createSinglePaneLayout(), 'vertical');

    expect(normalizeActivePanePath(layout.root, [9])).toEqual([0]);
    expect(activateViewerPane(layout, [9]).activePanePath).toEqual([0]);
  });

  it('computes equal pane rects for vertical and nested horizontal splits', () => {
    const vertical = splitActiveViewerPane(createSinglePaneLayout(), 'vertical');
    const nested = splitActiveViewerPane(vertical, 'horizontal');

    expect(computeViewerPaneRects(nested, { width: 800, height: 600 })).toEqual([
      {
        path: [0],
        rect: { x: 0, y: 0, width: 400, height: 600 },
        viewport: { width: 400, height: 600 },
        active: false
      },
      {
        path: [1, 0],
        rect: { x: 400, y: 0, width: 400, height: 300 },
        viewport: { width: 400, height: 300 },
        active: false
      },
      {
        path: [1, 1],
        rect: { x: 400, y: 300, width: 400, height: 300 },
        viewport: { width: 400, height: 300 },
        active: true
      }
    ]);
  });
});
