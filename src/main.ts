import { bootstrapApp } from './app/bootstrap';
import { parseViewerBootstrapParams } from './embed/embed-params';
import {
  initializeFullViewerHandoffReceiver,
  registerEmbedMessageBridge,
  runInitialBootstrapLoad
} from './embed/embed-runtime';

const params = parseViewerBootstrapParams(window.location);
void bootstrapApp({
  mode: params.uiMode,
  embedBottomPanel: params.bottomPanel
}).then((app) => {
  const cleanupHandoffReceiver = initializeFullViewerHandoffReceiver(params.handoffId, app, params.state);
  const cleanupEmbedBridge = params.uiMode === 'embed'
    ? registerEmbedMessageBridge(app)
    : () => {};
  const originalDispose = app.dispose;
  app.dispose = () => {
    cleanupEmbedBridge();
    cleanupHandoffReceiver();
    originalDispose();
  };
  runInitialBootstrapLoad(params, app);
});
