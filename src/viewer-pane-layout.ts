import type { ViewportInfo, ViewportRect } from './types';

export type ViewerPaneSplitOrientation = 'vertical' | 'horizontal';
export type ViewerPanePath = number[];

export type ViewerPaneNode =
  | { type: 'leaf' }
  | {
      type: 'split';
      orientation: ViewerPaneSplitOrientation;
      children: [ViewerPaneNode, ViewerPaneNode];
    };

export interface ViewerPaneLayoutState {
  root: ViewerPaneNode;
  activePanePath: ViewerPanePath;
}

export interface ViewerPaneRenderInfo {
  path: ViewerPanePath;
  rect: ViewportRect;
  viewport: ViewportInfo;
  active: boolean;
}

export function createSinglePaneLayout(): ViewerPaneLayoutState {
  return {
    root: { type: 'leaf' },
    activePanePath: []
  };
}

export function resetViewerPaneLayout(): ViewerPaneLayoutState {
  return createSinglePaneLayout();
}

export function activateViewerPane(
  layout: ViewerPaneLayoutState,
  path: ViewerPanePath
): ViewerPaneLayoutState {
  const activePanePath = normalizeActivePanePath(layout.root, path);
  return samePanePath(layout.activePanePath, activePanePath)
    ? layout
    : {
        root: layout.root,
        activePanePath
      };
}

export function splitActiveViewerPane(
  layout: ViewerPaneLayoutState,
  orientation: ViewerPaneSplitOrientation
): ViewerPaneLayoutState {
  const activePanePath = normalizeActivePanePath(layout.root, layout.activePanePath);
  const root = splitPaneAtPath(layout.root, activePanePath, orientation);
  return {
    root,
    activePanePath: [...activePanePath, 1]
  };
}

export function normalizeViewerPaneLayout(layout: ViewerPaneLayoutState): ViewerPaneLayoutState {
  const activePanePath = normalizeActivePanePath(layout.root, layout.activePanePath);
  return samePanePath(activePanePath, layout.activePanePath)
    ? layout
    : {
        root: layout.root,
        activePanePath
      };
}

export function normalizeActivePanePath(root: ViewerPaneNode, path: ViewerPanePath): ViewerPanePath {
  const node = getPaneNode(root, path);
  return node?.type === 'leaf' ? [...path] : findFirstLeafPath(root);
}

export function countViewerPaneLeaves(node: ViewerPaneNode): number {
  if (node.type === 'leaf') {
    return 1;
  }

  return countViewerPaneLeaves(node.children[0]) + countViewerPaneLeaves(node.children[1]);
}

export function isSingleViewerPaneLayout(layout: ViewerPaneLayoutState): boolean {
  return countViewerPaneLeaves(layout.root) === 1;
}

export function computeViewerPaneRects(
  layout: ViewerPaneLayoutState,
  viewport: ViewportInfo
): ViewerPaneRenderInfo[] {
  const normalizedViewport = {
    width: Math.max(1, Math.floor(viewport.width)),
    height: Math.max(1, Math.floor(viewport.height))
  };
  const activePanePath = normalizeActivePanePath(layout.root, layout.activePanePath);
  const panes: ViewerPaneRenderInfo[] = [];
  collectPaneRects(
    layout.root,
    [],
    {
      x: 0,
      y: 0,
      width: normalizedViewport.width,
      height: normalizedViewport.height
    },
    activePanePath,
    panes
  );
  return panes.length > 0
    ? panes
    : [
        {
          path: [],
          rect: {
            x: 0,
            y: 0,
            width: normalizedViewport.width,
            height: normalizedViewport.height
          },
          viewport: normalizedViewport,
          active: true
        }
      ];
}

export function findViewerPaneAtPoint(
  panes: readonly ViewerPaneRenderInfo[],
  point: { x: number; y: number }
): ViewerPaneRenderInfo | null {
  for (const pane of panes) {
    if (
      point.x >= pane.rect.x &&
      point.x <= pane.rect.x + pane.rect.width &&
      point.y >= pane.rect.y &&
      point.y <= pane.rect.y + pane.rect.height
    ) {
      return pane;
    }
  }

  return null;
}

export function sameViewerPaneLayout(a: ViewerPaneLayoutState, b: ViewerPaneLayoutState): boolean {
  return samePanePath(a.activePanePath, b.activePanePath) && samePaneNode(a.root, b.root);
}

export function samePanePath(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((entry, index) => entry === b[index]);
}

function splitPaneAtPath(
  node: ViewerPaneNode,
  path: ViewerPanePath,
  orientation: ViewerPaneSplitOrientation
): ViewerPaneNode {
  if (path.length === 0) {
    return {
      type: 'split',
      orientation,
      children: [{ type: 'leaf' }, { type: 'leaf' }]
    };
  }

  if (node.type === 'leaf') {
    return node;
  }

  const [childIndex, ...rest] = path;
  if (childIndex !== 0 && childIndex !== 1) {
    return node;
  }

  const children: [ViewerPaneNode, ViewerPaneNode] = [...node.children];
  children[childIndex] = splitPaneAtPath(children[childIndex], rest, orientation);
  return {
    ...node,
    children
  };
}

function getPaneNode(node: ViewerPaneNode, path: ViewerPanePath): ViewerPaneNode | null {
  if (path.length === 0) {
    return node;
  }

  if (node.type === 'leaf') {
    return null;
  }

  const [childIndex, ...rest] = path;
  if (childIndex !== 0 && childIndex !== 1) {
    return null;
  }

  return getPaneNode(node.children[childIndex], rest);
}

function findFirstLeafPath(node: ViewerPaneNode, prefix: ViewerPanePath = []): ViewerPanePath {
  if (node.type === 'leaf') {
    return [...prefix];
  }

  return findFirstLeafPath(node.children[0], [...prefix, 0]);
}

function collectPaneRects(
  node: ViewerPaneNode,
  path: ViewerPanePath,
  rect: ViewportRect,
  activePanePath: ViewerPanePath,
  panes: ViewerPaneRenderInfo[]
): void {
  if (node.type === 'leaf') {
    const viewport = {
      width: Math.max(1, Math.floor(rect.width)),
      height: Math.max(1, Math.floor(rect.height))
    };
    panes.push({
      path: [...path],
      rect: { ...rect },
      viewport,
      active: samePanePath(path, activePanePath)
    });
    return;
  }

  if (node.orientation === 'vertical') {
    const firstWidth = Math.floor(rect.width * 0.5);
    const secondWidth = rect.width - firstWidth;
    collectPaneRects(
      node.children[0],
      [...path, 0],
      {
        x: rect.x,
        y: rect.y,
        width: firstWidth,
        height: rect.height
      },
      activePanePath,
      panes
    );
    collectPaneRects(
      node.children[1],
      [...path, 1],
      {
        x: rect.x + firstWidth,
        y: rect.y,
        width: secondWidth,
        height: rect.height
      },
      activePanePath,
      panes
    );
    return;
  }

  const firstHeight = Math.floor(rect.height * 0.5);
  const secondHeight = rect.height - firstHeight;
  collectPaneRects(
    node.children[0],
    [...path, 0],
    {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: firstHeight
    },
    activePanePath,
    panes
  );
  collectPaneRects(
    node.children[1],
    [...path, 1],
    {
      x: rect.x,
      y: rect.y + firstHeight,
      width: rect.width,
      height: secondHeight
    },
    activePanePath,
    panes
  );
}

function samePaneNode(a: ViewerPaneNode, b: ViewerPaneNode): boolean {
  if (a.type !== b.type) {
    return false;
  }

  if (a.type === 'leaf' || b.type === 'leaf') {
    return true;
  }

  return (
    a.orientation === b.orientation &&
    samePaneNode(a.children[0], b.children[0]) &&
    samePaneNode(a.children[1], b.children[1])
  );
}
