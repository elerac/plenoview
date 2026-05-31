import { tauriHost } from './tauri-host';
import { webHost } from './web-host';
import type { ViewerHost } from './types';

export function createViewerHost(): ViewerHost {
  return import.meta.env.MODE === 'desktop' ? tauriHost : webHost;
}

export type {
  DesktopFileBytes,
  DesktopFileEntry,
  ExportFileSaveOptions,
  ExportSink,
  PathFileProvider,
  ViewerHost
} from './types';
