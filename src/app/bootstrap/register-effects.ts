import { applyRenderEffects } from '../viewer-app-render-effects';
import {
  applyActiveColormapLutEffects,
  applyChannelThumbnailEffects,
  applySessionResourceEffects,
  syncInteractionCoordinator
} from '../viewer-app-state-effects';
import { applyUiEffects } from '../viewer-app-ui-effects';
import { ViewerAppCore } from '../viewer-app-core';
import type { BootstrapServices } from './create-services';
import type { ViewerRuntimeUi } from '../../ui/viewer-runtime-ui';

interface RegisterBootstrapEffectsArgs {
  core: ViewerAppCore;
  ui: ViewerRuntimeUi;
  services: BootstrapServices;
  isDisposed: () => boolean;
}

export function registerBootstrapEffects({
  core,
  ui,
  services,
  isDisposed
}: RegisterBootstrapEffectsArgs): Array<() => void> {
  const unsubscribers: Array<() => void> = [];
  let renderEffectRevision = 0;

  unsubscribers.push(core.subscribeState((transition) => {
    if (isDisposed()) {
      return;
    }

    syncInteractionCoordinator(services.interactionCoordinator, transition);
    applySessionResourceEffects(transition, core, services.renderCache, services.thumbnailService);
    applyChannelThumbnailEffects(transition, core, services.channelThumbnailService);
    applyActiveColormapLutEffects(transition, services.displayController);
  }));
  unsubscribers.push(core.subscribeUi((transition) => {
    if (isDisposed()) {
      return;
    }

    applyUiEffects(ui, transition);
  }));
  unsubscribers.push(core.subscribeRender((transition) => {
    if (isDisposed()) {
      return;
    }

    const revision = ++renderEffectRevision;
    applyRenderEffects(core, ui, services.renderer, services.renderCache, transition);
    // Cached/preview exposure can synchronously dispatch a newer render here.
    // Its loop sources must survive when this older callback resumes.
    if (revision !== renderEffectRevision) return;
    services.invalidValueWarningRenderLoop.sync(transition.snapshot.paneRenderSources);
    services.pathTracingRenderLoop.sync(transition.snapshot.paneRenderSources);
  }));

  return unsubscribers;
}
