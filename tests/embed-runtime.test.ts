// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import {
  registerEmbedMessageBridge,
  runInitialBootstrapLoad
} from '../src/embed/embed-runtime';
import { EMBED_LOAD_FILE_MESSAGE } from '../src/embed/local-file-handoff';
import type { AppHandle } from '../src/app/bootstrap';

function createAppHandle(): AppHandle {
  return {
    loadUrl: vi.fn(async () => undefined),
    loadGallery: vi.fn(async () => undefined),
    loadFile: vi.fn(async () => undefined),
    applyState: vi.fn(),
    openFullViewer: vi.fn(),
    dispose: vi.fn()
  };
}

describe('embed runtime', () => {
  it('passes explicit names through initial URL and gallery loads', () => {
    const urlApp = createAppHandle();
    runInitialBootstrapLoad({
      uiMode: 'embed',
      src: 'https://example.com/beauty.exr',
      gallery: null,
      name: 'Beauty pass',
      view: null,
      handoffId: null,
      state: null
    }, urlApp);

    expect(urlApp.loadUrl).toHaveBeenCalledWith('https://example.com/beauty.exr', {
      name: 'Beauty pass',
      state: null
    });

    const galleryApp = createAppHandle();
    runInitialBootstrapLoad({
      uiMode: 'embed',
      src: null,
      gallery: 'cbox-rgb',
      name: 'Gallery plate',
      view: null,
      handoffId: null,
      state: null
    }, galleryApp);

    expect(galleryApp.loadGallery).toHaveBeenCalledWith('cbox-rgb', {
      name: 'Gallery plate',
      state: null
    });
  });

  it('passes wrapper-provided local file names to app file loads', () => {
    const app = createAppHandle();
    const cleanup = registerEmbedMessageBridge(app);
    const file = new File(['pixels'], 'beauty.exr');

    window.dispatchEvent(new MessageEvent('message', {
      source: window,
      data: {
        type: EMBED_LOAD_FILE_MESSAGE,
        file,
        name: 'Beauty local'
      }
    }));

    expect(app.loadFile).toHaveBeenCalledWith(file, {
      name: 'Beauty local',
      state: null
    });
    cleanup();
  });
});
