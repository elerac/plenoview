import './project-page.css';

interface PrismifoldController {
  element: HTMLElement;
  loadUrl(src: string, options?: { name?: string; view?: string; sourceOrigin?: string }): Promise<void>;
  loadFile(file: File, options?: { name?: string; view?: string }): Promise<void>;
  setView(view: string): PrismifoldController;
  destroy(): void;
}

interface PrismifoldApi {
  create(target: string | HTMLElement, options?: {
    src?: string;
    file?: File;
    name?: string;
    view?: string;
    width?: number | string;
    height?: number | string;
    viewerUrl?: string;
    sourceOrigin?: string;
    bottomPanel?: string;
    autoLoad?: boolean | string;
  }): PrismifoldController;
}

declare global {
  interface Window {
    Prismifold?: PrismifoldApi;
  }
}

const mobileEmbedHeightQuery = window.matchMedia('(max-width: 620px)');
const responsiveEmbeds = document.querySelectorAll<HTMLElement>('[data-embed-page-responsive-height]');
const jsViewerHost = document.getElementById('embed-js-viewer');
const loadSampleButton = document.getElementById('embed-js-load-sample-button') as HTMLButtonElement | null;
const fileInput = document.getElementById('embed-js-file-input') as HTMLInputElement | null;
const status = document.getElementById('embed-js-status');

function syncEmbedViewerHeights(): void {
  const compactHeight = mobileEmbedHeightQuery.matches ? '280' : null;
  for (const embed of responsiveEmbeds) {
    const defaultHeight = embed.dataset.defaultHeight ?? embed.getAttribute('height') ?? '340';
    embed.dataset.defaultHeight = defaultHeight;
    embed.setAttribute('height', compactHeight ?? defaultHeight);
  }
}

function setStatus(message: string): void {
  if (status) {
    status.textContent = message;
  }
}

syncEmbedViewerHeights();
mobileEmbedHeightQuery.addEventListener('change', syncEmbedViewerHeights);

if (jsViewerHost && loadSampleButton && fileInput) {
  const controller = window.Prismifold?.create(jsViewerHost, {
    height: mobileEmbedHeightQuery.matches ? 280 : 360,
    bottomPanel: 'channels'
  });

  const syncJsViewerHeight = (): void => {
    controller?.element.setAttribute('height', mobileEmbedHeightQuery.matches ? '280' : '360');
  };
  mobileEmbedHeightQuery.addEventListener('change', syncJsViewerHeight);

  const loadSample = (): void => {
    if (!controller) {
      return;
    }
    setStatus('Loading sample EXR...');
    void controller.loadUrl('../cbox_rgb.exr', {
      name: 'Cornell Box RGB'
    }).then(() => {
      setStatus('Loaded Cornell Box RGB.');
    }).catch((error: unknown) => {
      setStatus(error instanceof Error ? error.message : 'Failed to load sample EXR.');
    });
  };

  if (controller) {
    loadSampleButton.addEventListener('click', loadSample);
    fileInput.addEventListener('change', () => {
      const file = fileInput.files?.[0];
      if (!file) {
        return;
      }
      setStatus(`Loading ${file.name}...`);
      void controller.loadFile(file, {
        name: file.name
      }).then(() => {
        setStatus(`Loaded ${file.name}.`);
      }).catch((error: unknown) => {
        setStatus(error instanceof Error ? error.message : `Failed to load ${file.name}.`);
      });
    });
    loadSample();
  } else {
    loadSampleButton.disabled = true;
    fileInput.disabled = true;
    setStatus('Prismifold embed script was not available.');
  }
}
