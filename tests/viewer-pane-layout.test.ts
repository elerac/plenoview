import { describe, expect, it } from 'vitest';
import {
  assignActiveViewerPaneSession,
  assignViewerPaneSession,
  activateViewerPane,
  collectViewerPaneLeaves,
  computeViewerPaneRects,
  countViewerPaneLeaves,
  createSinglePaneLayout,
  getActiveViewerPaneSessionId,
  normalizeActivePanePath,
  pruneViewerPaneSessions,
  resetViewerPaneLayout,
  splitActiveViewerPane
} from '../src/viewer-pane-layout';

describe('viewer pane layout', () => {
  it('starts as one active leaf and resets to a single pane', () => {
    const split = splitActiveViewerPane(createSinglePaneLayout(), 'vertical');

    expect(countViewerPaneLeaves(split.root)).toBe(2);
    expect(resetViewerPaneLayout()).toEqual(createSinglePaneLayout());
  });

  it('assigns sessions to active panes and copies the assignment when splitting', () => {
    const assigned = assignActiveViewerPaneSession(createSinglePaneLayout(), 'session-1');
    const split = splitActiveViewerPane(assigned, 'vertical');

    expect(getActiveViewerPaneSessionId(split)).toBe('session-1');
    expect(collectViewerPaneLeaves(split)).toEqual([
      { path: [0], sessionId: 'session-1', active: false },
      { path: [1], sessionId: 'session-1', active: true }
    ]);
  });

  it('assigns a target pane session and activates that pane', () => {
    const split = splitActiveViewerPane(createSinglePaneLayout('session-1'), 'vertical');
    const assigned = assignViewerPaneSession(split, [0], 'session-2');

    expect(assigned.activePanePath).toEqual([0]);
    expect(getActiveViewerPaneSessionId(assigned)).toBe('session-2');
    expect(collectViewerPaneLeaves(assigned)).toEqual([
      { path: [0], sessionId: 'session-2', active: true },
      { path: [1], sessionId: 'session-1', active: false }
    ]);
  });

  it('prunes closed session assignments to the fallback session', () => {
    const split = splitActiveViewerPane(createSinglePaneLayout('session-1'), 'vertical');
    const assigned = assignViewerPaneSession(split, [0], 'session-2');

    expect(collectViewerPaneLeaves(pruneViewerPaneSessions(
      assigned,
      new Set(['session-1']),
      'session-1'
    ))).toEqual([
      { path: [0], sessionId: 'session-1', active: true },
      { path: [1], sessionId: 'session-1', active: false }
    ]);
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
