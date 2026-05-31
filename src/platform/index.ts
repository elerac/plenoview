import { tauriHost } from './tauri-host';
import { webHost } from './web-host';
import type { ViewerHost } from './types';

export function createViewerHost(): ViewerHost {
  return import.meta.env.MODE === 'desktop' ? tauriHost : webHost;
}

export type {
  AppFullscreenHost,
  DesktopCommandCallbacks,
  DesktopCommandError,
  DesktopCommandId,
  DesktopErrorCode,
  DesktopFileBytes,
  DesktopFileEntry,
  DesktopRecentFile,
  ExportFileSaveOptions,
  ExportSaveResult,
  ExportSink,
  PathFileProvider,
  ViewerHost
} from './types';

export {
  isStaleDesktopPathError,
  normalizeDesktopError
} from './desktop-errors';
