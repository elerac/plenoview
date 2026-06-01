// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import { EmbedViewerUi } from '../src/embed/embed-viewer-ui';

describe('EmbedViewerUi', () => {
  it('creates a single-pane viewer surface with inactive screenshot selection', () => {
    const ui = new EmbedViewerUi({ onOpenFull: vi.fn() });

    ui.setViewerViewportRect({
      left: 10,
      top: 20,
      width: 320,
      height: 180
    });

    expect(ui.viewerContainer).toBeInstanceOf(HTMLElement);
    expect(ui.glCanvas).toBeInstanceOf(HTMLCanvasElement);
    expect(ui.getActiveViewerPane()).toMatchObject({
      path: [],
      rect: { x: 0, y: 0, width: 320, height: 180 },
      viewport: { width: 320, height: 180 },
      active: true
    });
    expect(ui.resolveViewerPaneAtPoint({ x: 12, y: 8 })).toMatchObject({
      viewport: { width: 320, height: 180 }
    });
    expect(ui.getScreenshotSelectionInteractionState()).toEqual({
      active: false,
      rect: null,
      activeRegionId: null,
      regions: []
    });
    expect(document.querySelector('.embed-source-label')?.classList.contains('hidden')).toBe(true);
    expect(document.querySelector('.embed-source-label')?.textContent).toBe('');
    expect(ui.viewerContainer.style.getPropertyValue('--viewer-checker-offset-x')).toBe('-10px');
    expect(ui.viewerContainer.style.getPropertyValue('--viewer-checker-offset-y')).toBe('-20px');

    ui.dispose();
  });

  it('renders and cleans up the deferred load button', () => {
    const onDeferredLoad = vi.fn();
    const ui = new EmbedViewerUi({ onOpenFull: vi.fn() });
    const button = document.querySelector<HTMLButtonElement>('.embed-deferred-load-button');

    expect(button).toBeInstanceOf(HTMLButtonElement);
    expect(button?.classList.contains('hidden')).toBe(true);

    ui.setDeferredLoad(onDeferredLoad);
    expect(button?.classList.contains('hidden')).toBe(false);
    expect(button?.disabled).toBe(false);

    button?.click();
    expect(onDeferredLoad).toHaveBeenCalledTimes(1);
    expect(button?.disabled).toBe(true);

    ui.setDeferredLoad(onDeferredLoad);
    ui.setLoading(true);
    expect(button?.classList.contains('hidden')).toBe(true);
    expect(button?.disabled).toBe(true);

    ui.setDeferredLoad(null);
    expect(button?.classList.contains('hidden')).toBe(true);
    expect(button?.disabled).toBe(false);

    const onDisposedDeferredLoad = vi.fn();
    ui.setDeferredLoad(onDisposedDeferredLoad);
    ui.dispose();
    button?.click();
    expect(onDisposedDeferredLoad).not.toHaveBeenCalled();
  });

  it('renders minimal loading, error, open-full, and probe states', () => {
    const onOpenFull = vi.fn();
    const ui = new EmbedViewerUi({ onOpenFull });

    ui.setLoading(true);
    expect(document.querySelector('.embed-status')?.textContent).toBe('Loading image...');

    ui.setError('Failed');
    expect(document.querySelector('.embed-status')?.classList.contains('is-error')).toBe(true);
    expect(document.querySelector('.embed-status')?.textContent).toBe('Failed');

    ui.setOpenedImageOptions([
      {
        id: 'session-1',
        label: 'beauty.exr',
        sizeBytes: 12,
        sourceDetail: 'Local file',
        metadata: null,
        thumbnailDataUrl: null,
        thumbnailAspectRatio: null,
        thumbnailLoading: false,
        selectable: true
      }
    ], 'session-1');
    expect(document.querySelector('.embed-source-label')?.classList.contains('hidden')).toBe(true);
    expect(document.querySelector('.embed-source-label')?.textContent).toBe('');

    ui.setOpenedImageOptions([
      {
        id: 'session-1',
        label: 'Beauty pass',
        displayNameIsCustom: true,
        sizeBytes: 12,
        sourceDetail: 'Local file',
        metadata: null,
        thumbnailDataUrl: null,
        thumbnailAspectRatio: null,
        thumbnailLoading: false,
        selectable: true
      }
    ], 'session-1');
    expect(document.querySelector('.embed-source-label')?.classList.contains('hidden')).toBe(false);
    expect(document.querySelector('.embed-source-label')?.textContent).toBe('Beauty pass');

    const button = document.querySelector<HTMLButtonElement>('.embed-open-full-button');
    expect(button?.disabled).toBe(false);
    button?.click();
    expect(onOpenFull).toHaveBeenCalledTimes(1);

    ui.setProbeReadout(
      'Hover',
      { x: 2, y: 3, values: { R: 1 } },
      {
        cssColor: 'rgb(255, 0, 0)',
        displayValues: [{ label: 'R', value: '1.00' }]
      },
      { width: 10, height: 10 }
    );
    expect(document.querySelector('.embed-probe')?.classList.contains('is-empty')).toBe(false);
    expect(document.querySelector<HTMLElement>('.embed-probe-swatch')?.style.backgroundColor).toBe('rgb(255, 0, 0)');
    expect(document.querySelector('.embed-probe-values')?.textContent).toContain('R 1.00');

    ui.dispose();
  });
});
