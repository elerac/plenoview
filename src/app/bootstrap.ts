import { createAbortError } from '../lifecycle';
import { ViewerInteraction } from '../interaction/viewer-interaction';
import { LoadQueueService } from '../services/load-queue';
import { readStoredImageLoadWorkers } from '../image-load-workers';
import { setMaxDecodeWorkers } from '../exr-worker-client';
import { EmbedViewerUi } from '../embed/embed-viewer-ui';
import {
  applyEmbedViewerStateSnapshot,
  createEmbedViewerStateSnapshot,
  type EmbedViewerStateSnapshot
} from '../embed/embed-state';
import {
  DEFAULT_PANORAMA_ROTATION_SPEED_DEG_PER_SECOND,
  DEFAULT_THREE_D_ORBIT_PITCH_AMPLITUDE_DEG,
  DEFAULT_THREE_D_ORBIT_SPEED_DEG_PER_SECOND,
  DEFAULT_THREE_D_ORBIT_YAW_AMPLITUDE_DEG,
  buildFullViewerUrl,
  parsePanoramaRotationSpeed,
  parseThreeDOrbitPitchAmplitude,
  parseThreeDOrbitSpeed,
  parseThreeDOrbitYawAmplitude,
  type EmbedBottomPanelMode,
  type EmbedPanoramaAnimationConfig,
  type EmbedThreeDAnimationConfig
} from '../embed/embed-params';
import {
  createLocalFileHandoffId,
  startLocalFileHandoffSender
} from '../embed/local-file-handoff';
import { ViewerAppCore } from './viewer-app-core';
import { createViewerUi, promoteActiveChannelThumbnail } from './bootstrap/create-ui';
import {
  createBootstrapServices,
  disposeBootstrapServices,
  type BootstrapServices
} from './bootstrap/create-services';
import {
  createColormapExportPixelsResolver,
  createImageExportPixelsResolver
} from './bootstrap/export-actions';
import { registerBootstrapEffects } from './bootstrap/register-effects';
import { createViewerInteraction, initializeViewportLifecycle } from './bootstrap/viewport-lifecycle';
import { installE2EHooks } from './e2e-hooks';
import { selectActiveSession } from './viewer-app-selectors';
import { createViewerHost, presentDesktopError } from '../platform';
import type { DesktopPlatform, DesktopWindowChromeHost, ViewerHost } from '../platform';
import type { ViewerRuntimeUi } from '../ui/viewer-runtime-ui';

export interface BootstrapAppOptions {
  mode?: 'full' | 'embed';
  embedBottomPanel?: EmbedBottomPanelMode;
  embedPanoramaAnimation?: EmbedPanoramaAnimationConfig;
  embedThreeDAnimation?: EmbedThreeDAnimationConfig;
}

export interface AppHandle {
  loadUrl(url: string, options?: { name?: string; state?: EmbedViewerStateSnapshot | null }): Promise<void>;
  loadGallery(galleryId: string, options?: { name?: string; state?: EmbedViewerStateSnapshot | null }): Promise<void>;
  loadFile(file: File, options?: { name?: string; state?: EmbedViewerStateSnapshot | null }): Promise<void>;
  applyState(state: EmbedViewerStateSnapshot | null | undefined): void;
  setError(message: string | null): void;
  setEmbedPanoramaAnimationConfig(config: EmbedPanoramaAnimationConfig): void;
  setEmbedThreeDAnimationConfig(config: EmbedThreeDAnimationConfig): void;
  deferInitialLoad(load: () => void | Promise<void>): void;
  openFullViewer(): void;
  dispose(): void;
}

interface DesktopChromeSetupOptions {
  onDispose(dispose: () => void): void;
  onError(error: unknown, fallbackMessage: string): void;
}

const DESKTOP_CHROME_ERROR_MESSAGE = 'Failed to control desktop window.';

export async function bootstrapApp(options: BootstrapAppOptions = {}): Promise<AppHandle> {
  const core = new ViewerAppCore();

  let services: BootstrapServices | null = null;
  let interaction: ViewerInteraction | null = null;
  const embedBottomPanelMode = options.embedBottomPanel ?? 'probe';
  const probeEnabled = options.mode !== 'embed' || embedBottomPanelMode === 'probe';
  let embedPanoramaAnimationConfig = normalizeEmbedPanoramaAnimationConfig(options.embedPanoramaAnimation);
  let embedThreeDAnimationConfig = normalizeEmbedThreeDAnimationConfig(options.embedThreeDAnimation);
  let resizeObserver: ResizeObserver | null = null;
  let cleanupE2EHooks: () => void = () => {};
  const unsubscribers: Array<() => void> = [];
  let disposed = false;
  const isDisposed = () => disposed;
  const onBeforeUnload = () => {
    app.dispose();
  };

  const initialImageLoadWorkers = readStoredImageLoadWorkers();
  setMaxDecodeWorkers(initialImageLoadWorkers);
  const loadQueue = new LoadQueueService({ maxWorkers: initialImageLoadWorkers });
  const host = createViewerHost();
  const reportDesktopError = (error: unknown, fallbackMessage: string): void => {
    const { message } = presentDesktopError(error, fallbackMessage);
    if (!message) {
      return;
    }
    core.dispatch({ type: 'errorSet', message });
  };
  await configureDesktopChrome(host, {
    onDispose: (dispose) => {
      unsubscribers.push(dispose);
    },
    onError: reportDesktopError
  });
  const resolveColormapExportPixels = createColormapExportPixelsResolver({
    core,
    isDisposed
  });
  const resolveImageExportPixels = createImageExportPixelsResolver({
    core,
    getRenderCache: () => {
      if (!services) {
        throw createAbortError('Viewer application has not finished initializing.');
      }
      return services.renderCache;
    },
    getRenderer: () => {
      if (!services) {
        throw createAbortError('Viewer application has not finished initializing.');
      }
      return services.renderer;
    },
    getDisplayController: () => {
      if (!services) {
        throw createAbortError('Viewer application has not finished initializing.');
      }
      return services.displayController;
    },
    isDisposed
  });
  const getServices = (): BootstrapServices => {
    if (!services) {
      throw createAbortError('Viewer application has not finished initializing.');
    }
    return services;
  };
  const ui: ViewerRuntimeUi = options.mode === 'embed'
    ? new EmbedViewerUi({
        bottomPanel: embedBottomPanelMode,
        onChannelSelection: (selection) => {
          promoteActiveChannelThumbnail(core, () => getServices().channelThumbnailService, selection);
          void getServices().displayController.applyDisplaySelection(selection);
        },
        onOpenFull: () => {
          app.openFullViewer();
        }
      })
    : createViewerUi({
        core,
        getSessionController: () => getServices().sessionController,
        getDisplayController: () => getServices().displayController,
        getChannelThumbnailService: () => getServices().channelThumbnailService,
        getRenderCache: () => getServices().renderCache,
        getRenderer: () => getServices().renderer,
        getInteraction: () => interaction,
        host,
        resolveColormapExportPixels,
        resolveImageExportPixels,
        onImageLoadWorkersChange: (workerCount) => {
          loadQueue.setMaxWorkers(workerCount);
          setMaxDecodeWorkers(workerCount);
        },
        isDisposed
      });
  const app: AppHandle = {
    loadUrl: async (url, loadOptions = {}) => {
      await getServices().sessionController.enqueueUrl(url, {
        displayName: loadOptions.name
      });
      applyViewerStateSnapshot(core, loadOptions.state, probeEnabled);
    },
    loadGallery: async (galleryId, loadOptions = {}) => {
      await getServices().sessionController.enqueueGalleryImage(galleryId, {
        displayName: loadOptions.name
      });
      applyViewerStateSnapshot(core, loadOptions.state, probeEnabled);
    },
    loadFile: async (file, loadOptions = {}) => {
      await getServices().sessionController.enqueueFiles([file], {
        displayName: loadOptions.name
      });
      applyViewerStateSnapshot(core, loadOptions.state, probeEnabled);
    },
    applyState: (state) => {
      applyViewerStateSnapshot(core, state, probeEnabled);
    },
    setError: (message) => {
      core.dispatch({ type: 'errorSet', message });
    },
    setEmbedPanoramaAnimationConfig: (config) => {
      embedPanoramaAnimationConfig = normalizeEmbedPanoramaAnimationConfig(config);
      interaction?.setPanoramaAutoRotateConfig(embedPanoramaAnimationConfig);
    },
    setEmbedThreeDAnimationConfig: (config) => {
      embedThreeDAnimationConfig = normalizeEmbedThreeDAnimationConfig(config);
      interaction?.setThreeDAutoOrbitConfig(embedThreeDAnimationConfig);
    },
    deferInitialLoad: (load) => {
      if (!ui.setDeferredLoad) {
        void load();
        return;
      }

      let started = false;
      ui.setDeferredLoad(async () => {
        if (started) {
          return;
        }
        started = true;
        ui.setDeferredLoad?.(null);
        await load();
      });
    },
    openFullViewer: () => {
      openFullViewer(core);
    },
    dispose: () => {
      if (disposed) {
        return;
      }

      disposed = true;
      window.removeEventListener('beforeunload', onBeforeUnload);
      cleanupE2EHooks();
      cleanupE2EHooks = () => {};
      while (unsubscribers.length > 0) {
        unsubscribers.pop()?.();
      }
      interaction?.destroy();
      interaction = null;
      resizeObserver?.disconnect();
      resizeObserver = null;
      loadQueue.dispose();
      disposeBootstrapServices(services ?? {});
      services = null;
      ui.dispose();
    }
  };

  try {
    services = createBootstrapServices({
      core,
      ui,
      loadQueue,
      probeEnabled,
      hostKind: host.kind,
      pathFileProvider: host.pathFileProvider,
      onPathSessionLoaded: (entry) => {
        host.recordRecentFile(entry);
      },
      onPathSessionLoadFailed: (entry, error) => {
        host.recordPathLoadFailure(entry, error);
      },
      isDisposed
    });
    if (host.kind !== 'web') {
      const recentMenu = host.installRecentFilesMenu({
        onOpenEntry: (entry) => {
          void getServices().sessionController.enqueuePathEntries([entry]);
        },
        onError: (error) => {
          reportDesktopError(error, 'Failed to open recent file.');
        }
      });
      unsubscribers.push(() => recentMenu.dispose());

      void host.setupDesktopEvents({
        onEntries: (entries) => {
          void getServices().sessionController.enqueuePathEntries(entries);
        },
        onDragStateChange: (active) => {
          ui.showDropOverlay?.(active);
        },
        onError: (error) => {
          reportDesktopError(error, 'Failed to open dropped file.');
        }
      }).then((events) => {
        if (disposed) {
          events.dispose();
          return;
        }
        unsubscribers.push(() => events.dispose());
      }).catch((error) => {
        const message = error instanceof Error ? error.message : 'Failed to initialize desktop file events.';
        core.dispatch({ type: 'errorSet', message });
      });

      void host.setupDesktopCommands({
        onCommand: (commandId) => {
          if (commandId === 'clearRecentFiles') {
            void host.clearRecentFiles();
            return;
          }
          ui.executeDesktopCommand?.(commandId);
        },
        onOpenRecent: (entry) => {
          void getServices().sessionController.enqueuePathEntries([entry]);
        },
        onGalleryImageSelected: (galleryId) => {
          void getServices().sessionController.enqueueGalleryImage(galleryId);
        },
        onError: (error) => {
          reportDesktopError(error, 'Failed to open recent file.');
        },
        getCommandState: () => ui.getDesktopCommandState?.() ?? {}
      }).then((commands) => {
        if (disposed) {
          commands.dispose();
          return;
        }
        unsubscribers.push(() => commands.dispose());
      }).catch((error) => {
        const message = error instanceof Error ? error.message : 'Failed to initialize desktop menus.';
        core.dispatch({ type: 'errorSet', message });
      });
    }
    unsubscribers.push(...registerBootstrapEffects({
      core,
      ui,
      services,
      isDisposed
    }));

    interaction = createViewerInteraction({
      core,
      ui,
      interactionCoordinator: services.interactionCoordinator,
      depthPointBudgetResolver: services.depthPointBudgetResolver
    });
    interaction.setPanoramaAutoRotateConfig(embedPanoramaAnimationConfig);
    interaction.setThreeDAutoOrbitConfig(embedThreeDAnimationConfig);
    unsubscribers.push(core.subscribeState((transition) => {
      if (disposed) {
        return;
      }
      if (transition.intent.type === 'viewerStateEdited') {
        interaction?.pausePanoramaAutoRotateForUserInput();
        interaction?.pauseThreeDAutoOrbitForUserInput();
      }
      interaction?.refreshPanoramaAutoRotate();
      interaction?.refreshThreeDAutoOrbit();
    }));
    resizeObserver = initializeViewportLifecycle({
      core,
      ui,
      renderer: services.renderer,
      interactionCoordinator: services.interactionCoordinator,
      isDisposed
    });

    await services.displayController.initialize();
    cleanupE2EHooks = installE2EHooks(core, ui);

    window.addEventListener('beforeunload', onBeforeUnload);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to initialize WebGL2 renderer.';
    if (!disposed) {
      core.dispatch({ type: 'errorSet', message });
      core.dispatch({ type: 'loadingSet', loading: false });
    }
  }

  return app;
}

function normalizeEmbedPanoramaAnimationConfig(
  config: EmbedPanoramaAnimationConfig | null | undefined
): EmbedPanoramaAnimationConfig {
  return {
    autoRotate: config?.autoRotate === true,
    rotationSpeedDegPerSecond: parsePanoramaRotationSpeed(
      config?.rotationSpeedDegPerSecond ?? DEFAULT_PANORAMA_ROTATION_SPEED_DEG_PER_SECOND
    )
  };
}

function normalizeEmbedThreeDAnimationConfig(
  config: EmbedThreeDAnimationConfig | null | undefined
): EmbedThreeDAnimationConfig {
  return {
    autoOrbit: config?.autoOrbit === true,
    orbitSpeedDegPerSecond: parseThreeDOrbitSpeed(
      config?.orbitSpeedDegPerSecond ?? DEFAULT_THREE_D_ORBIT_SPEED_DEG_PER_SECOND
    ),
    orbitYawAmplitudeDeg: parseThreeDOrbitYawAmplitude(
      config?.orbitYawAmplitudeDeg ?? DEFAULT_THREE_D_ORBIT_YAW_AMPLITUDE_DEG
    ),
    orbitPitchAmplitudeDeg: parseThreeDOrbitPitchAmplitude(
      config?.orbitPitchAmplitudeDeg ?? DEFAULT_THREE_D_ORBIT_PITCH_AMPLITUDE_DEG
    )
  };
}

function applyViewerStateSnapshot(
  core: ViewerAppCore,
  state: EmbedViewerStateSnapshot | null | undefined,
  probeEnabled: boolean
): void {
  applyEmbedViewerStateSnapshot(core, normalizeViewerStateSnapshotForProbeCapability(state, probeEnabled));
}

function normalizeViewerStateSnapshotForProbeCapability(
  state: EmbedViewerStateSnapshot | null | undefined,
  probeEnabled: boolean
): EmbedViewerStateSnapshot | null | undefined {
  if (probeEnabled || !state) {
    return state;
  }

  return {
    ...state,
    lockedPixel: null
  };
}

async function configureDesktopChrome(host: ViewerHost, options: DesktopChromeSetupOptions): Promise<void> {
  if (host.kind !== 'tauri') {
    return;
  }

  const appShell = document.getElementById('app');
  if (!appShell) {
    return;
  }

  const chrome = host.desktopWindowChrome;
  if (!chrome) {
    appShell.classList.add('is-desktop-native-menu');
    return;
  }

  const platform = await readDesktopPlatform(chrome);
  appShell.dataset.desktopPlatform = platform;
  if (platform === 'windows') {
    appShell.classList.add('is-desktop-custom-chrome');
    installDesktopWindowDragRegion(chrome, {
      ...options,
      enableDoubleClickMaximize: true
    });
    installDesktopWindowControls(appShell, chrome, options);
    return;
  }

  appShell.classList.add('is-desktop-native-menu');
  if (platform === 'macos') {
    appShell.classList.add('is-desktop-titlebar-overlay');
    installDesktopWindowDragRegion(chrome, {
      ...options,
      enableDoubleClickMaximize: false
    });
  }
}

async function readDesktopPlatform(chrome: DesktopWindowChromeHost): Promise<DesktopPlatform> {
  try {
    return await chrome.getPlatform();
  } catch {
    return 'unknown';
  }
}

function installDesktopWindowDragRegion(
  chrome: DesktopWindowChromeHost,
  options: DesktopChromeSetupOptions & { enableDoubleClickMaximize: boolean }
): void {
  const menuBar = document.getElementById('app-menu-bar');
  if (!menuBar) {
    return;
  }

  const onMouseDown = (event: MouseEvent) => {
    if (event.button !== 0 || isDesktopChromeInteractiveTarget(event.target)) {
      return;
    }
    event.preventDefault();
    runDesktopChromeAction(() => chrome.startDragging(), options);
  };
  const onDoubleClick = (event: MouseEvent) => {
    if (!options.enableDoubleClickMaximize || event.button !== 0 || isDesktopChromeInteractiveTarget(event.target)) {
      return;
    }
    event.preventDefault();
    runDesktopChromeAction(() => chrome.toggleMaximize(), options);
  };

  menuBar.addEventListener('mousedown', onMouseDown);
  menuBar.addEventListener('dblclick', onDoubleClick);
  options.onDispose(() => {
    menuBar.removeEventListener('mousedown', onMouseDown);
    menuBar.removeEventListener('dblclick', onDoubleClick);
  });
}

function installDesktopWindowControls(
  appShell: HTMLElement,
  chrome: DesktopWindowChromeHost,
  options: DesktopChromeSetupOptions
): void {
  const minimizeButton = document.getElementById('desktop-window-minimize-button') as HTMLButtonElement | null;
  const maximizeButton = document.getElementById('desktop-window-maximize-button') as HTMLButtonElement | null;
  const closeButton = document.getElementById('desktop-window-close-button') as HTMLButtonElement | null;
  if (!minimizeButton || !maximizeButton || !closeButton) {
    return;
  }

  const onMinimize = () => {
    runDesktopChromeAction(() => chrome.minimize(), options);
  };
  const onMaximize = () => {
    runDesktopChromeAction(async () => {
      await chrome.toggleMaximize();
      await refreshDesktopWindowMaximizedState(appShell, maximizeButton, chrome);
    }, options);
  };
  const onClose = () => {
    runDesktopChromeAction(() => chrome.close(), options);
  };

  minimizeButton.addEventListener('click', onMinimize);
  maximizeButton.addEventListener('click', onMaximize);
  closeButton.addEventListener('click', onClose);
  options.onDispose(() => {
    minimizeButton.removeEventListener('click', onMinimize);
    maximizeButton.removeEventListener('click', onMaximize);
    closeButton.removeEventListener('click', onClose);
  });

  void refreshDesktopWindowMaximizedState(appShell, maximizeButton, chrome)
    .catch((error) => {
      options.onError(error, DESKTOP_CHROME_ERROR_MESSAGE);
    });

  let subscription: { dispose(): void } | null = null;
  let disposed = false;
  void chrome.onMaximizedChange((maximized) => {
    applyDesktopWindowMaximizedState(appShell, maximizeButton, maximized);
  }).then((nextSubscription) => {
    if (disposed) {
      nextSubscription.dispose();
      return;
    }
    subscription = nextSubscription;
  }).catch((error) => {
    options.onError(error, DESKTOP_CHROME_ERROR_MESSAGE);
  });
  options.onDispose(() => {
    disposed = true;
    subscription?.dispose();
    subscription = null;
  });
}

async function refreshDesktopWindowMaximizedState(
  appShell: HTMLElement,
  maximizeButton: HTMLButtonElement,
  chrome: DesktopWindowChromeHost
): Promise<void> {
  applyDesktopWindowMaximizedState(appShell, maximizeButton, await chrome.isMaximized());
}

function applyDesktopWindowMaximizedState(
  appShell: HTMLElement,
  maximizeButton: HTMLButtonElement,
  maximized: boolean
): void {
  appShell.classList.toggle('is-desktop-window-maximized', maximized);
  const label = maximized ? 'Restore window' : 'Maximize window';
  maximizeButton.setAttribute('aria-label', label);
  maximizeButton.title = label;
}

function isDesktopChromeInteractiveTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest([
    'button',
    'input',
    'select',
    'textarea',
    'a',
    '[role="menu"]',
    '.app-menu-actions',
    '.desktop-window-controls',
    '.app-menu-dropdown',
    '.app-icon-tooltip'
  ].join(',')) !== null;
}

function runDesktopChromeAction(
  action: () => Promise<void>,
  options: DesktopChromeSetupOptions
): void {
  void action().catch((error) => {
    options.onError(error, DESKTOP_CHROME_ERROR_MESSAGE);
  });
}

function openFullViewer(core: ViewerAppCore): void {
  const activeSession = selectActiveSession(core.getState());
  if (!activeSession) {
    return;
  }

  const state = createEmbedViewerStateSnapshot(core.getState());
  const source = activeSession.source;
  const explicitName = activeSession.displayNameIsCustom ? activeSession.displayName : undefined;
  if (source.kind === 'url') {
    window.open(buildFullViewerUrl({
      baseUrl: getViewerAppBaseUrl(),
      src: source.url,
      name: explicitName,
      state
    }), '_blank');
    return;
  }
  if (source.kind === 'path') {
    core.dispatch({
      type: 'errorSet',
      message: 'Opening a desktop path file in a separate browser viewer is not supported.'
    });
    return;
  }

  const handoffId = createLocalFileHandoffId();
  const fullWindow = window.open(buildFullViewerUrl({
    baseUrl: getViewerAppBaseUrl(),
    handoffId,
    name: explicitName,
    state
  }), '_blank');
  if (!fullWindow) {
    core.dispatch({
      type: 'errorSet',
      message: 'Popup blocked. Allow popups to open the full viewer.'
    });
    return;
  }

  startLocalFileHandoffSender({
    targetWindow: fullWindow,
    handoffId,
    file: source.file,
    name: explicitName,
    state,
    targetOrigin: window.location.origin,
    onTimeout: () => {
      core.dispatch({
        type: 'errorSet',
        message: 'Timed out while opening the local file in the full viewer.'
      });
    }
  });
}

function getViewerAppBaseUrl(): string {
  const baseUrl = import.meta.env.BASE_URL || '/';
  if (baseUrl === './') {
    return new URL('./', window.location.href).toString();
  }

  const normalizedBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return `${normalizedBase}app/`;
}
