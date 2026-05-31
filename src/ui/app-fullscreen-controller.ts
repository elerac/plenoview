import { DisposableBag, type Disposable } from '../lifecycle';
import type { AppFullscreenHost } from '../platform';
import type { AppFullscreenElements } from './elements';

const ENTER_FULLSCREEN_LABEL = 'Enter app fullscreen';
const EXIT_FULLSCREEN_LABEL = 'Exit app fullscreen';
const FULLSCREEN_UNAVAILABLE_LABEL = 'App fullscreen unavailable';
const ENTER_FULLSCREEN_TOOLTIP = 'Enter fullscreen';
const EXIT_FULLSCREEN_TOOLTIP = 'Exit fullscreen';
const FULLSCREEN_UNAVAILABLE_TOOLTIP = 'Fullscreen unavailable';

interface AppFullscreenControllerCallbacks {
  onBeforeToggle: () => void;
}

export class AppFullscreenController implements Disposable {
  private readonly disposables = new DisposableBag();
  private disposed = false;

  constructor(
    private readonly elements: AppFullscreenElements,
    private readonly callbacks: AppFullscreenControllerCallbacks,
    private readonly host: AppFullscreenHost
  ) {
    this.disposables.addEventListener(this.elements.appFullscreenButton, 'click', () => {
      void this.toggle();
    });
    void this.host.onChange(() => {
      this.syncState();
    }).then((disposable) => {
      if (this.disposed) {
        disposable.dispose();
        return;
      }
      this.disposables.addDisposable(disposable);
    });
    this.syncState();
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.disposables.dispose();
  }

  private async toggle(): Promise<void> {
    if (this.disposed || !this.isSupported() || this.elements.appFullscreenButton.disabled) {
      return;
    }

    this.callbacks.onBeforeToggle();

    try {
      const active = await this.host.isActive();
      await this.host.setActive(!active);
    } catch {
      // Host/user-agent rejection is reflected by the next state sync.
    } finally {
      this.syncState();
    }
  }

  private syncState(): void {
    if (this.disposed) {
      return;
    }

    const supported = this.isSupported();
    try {
      const active = supported ? this.host.isActive() : false;
      if (active instanceof Promise) {
        void active.then((resolvedActive) => {
          this.applyState(supported, resolvedActive);
        }).catch(() => {
          this.applyState(supported, false);
        });
        return;
      }
      this.applyState(supported, active);
    } catch {
      this.applyState(supported, false);
    }
  }

  private applyState(supported: boolean, active: boolean): void {
    if (this.disposed) {
      return;
    }

    const label = supported ? (active ? EXIT_FULLSCREEN_LABEL : ENTER_FULLSCREEN_LABEL) : FULLSCREEN_UNAVAILABLE_LABEL;
    const tooltip = supported
      ? (active ? EXIT_FULLSCREEN_TOOLTIP : ENTER_FULLSCREEN_TOOLTIP)
      : FULLSCREEN_UNAVAILABLE_TOOLTIP;

    this.elements.appFullscreenButton.disabled = !supported;
    this.elements.appFullscreenButton.setAttribute('aria-pressed', active ? 'true' : 'false');
    this.elements.appFullscreenButton.setAttribute('aria-label', label);
    this.elements.appFullscreenButton.dataset.tooltip = tooltip;
    this.elements.appFullscreenButton.title = label;
    window.dispatchEvent(new Event('openexr-viewer:desktop-command-state-changed'));
  }

  private isSupported(): boolean {
    return this.host.isSupported();
  }
}
