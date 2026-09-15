import { DisposableBag, type Disposable } from '../lifecycle';
import type { TopMenuControllerElements } from './elements';

interface TopMenuElements {
  button: HTMLButtonElement;
  menu: HTMLElement;
}

interface SubmenuElements {
  root: HTMLElement;
  button: HTMLButtonElement;
  menu: HTMLElement;
}

type TopMenuTrackingMode = 'inactive' | 'pointer';

interface TopMenuControllerCallbacks {
  onBeforeOpenMenu: () => void;
}

export class TopMenuController implements Disposable {
  private readonly disposables = new DisposableBag();
  private topMenuTrackingMode: TopMenuTrackingMode = 'inactive';
  private hoverOpenedTopMenuButton: HTMLButtonElement | null = null;
  private disposed = false;

  constructor(
    private readonly elements: TopMenuControllerElements,
    private readonly callbacks: TopMenuControllerCallbacks
  ) {
    for (const menu of this.getTopMenus()) {
      this.bindTopMenu(menu);
    }
    for (const submenu of this.getSubmenus()) {
      this.bindSubmenu(submenu);
    }

    this.disposables.addEventListener(this.elements.appMenuBar, 'pointerover', (event) => {
      if (event.pointerType !== 'mouse' || this.topMenuTrackingMode !== 'pointer') {
        return;
      }

      if (
        this.getTopMenus().every((menu) => !this.isTopMenuOpen(menu)) ||
        !(event.target instanceof Node) ||
        this.isPointerWithinTopMenuRegion(event.target)
      ) {
        return;
      }

      this.suspendTopMenusForTopBarHover();
    });

    this.disposables.addEventListener(document, 'click', (event) => {
      const target = event.target;
      if (
        !(target instanceof Node) ||
        this.getTopMenus().some((menu) => menu.button.parentElement?.contains(target))
      ) {
        return;
      }

      this.closeAll();
    });
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.disposables.dispose();
  }

  closeAll(restoreFocus = false): void {
    this.closeAllTopMenus(restoreFocus);
  }

  hasOpenMenu(): boolean {
    return this.getTopMenus().some((menu) => this.isTopMenuOpen(menu));
  }

  private getTopMenus(): TopMenuElements[] {
    return [
      { button: this.elements.fileMenuButton, menu: this.elements.fileMenu },
      { button: this.elements.viewMenuButton, menu: this.elements.viewMenu },
      { button: this.elements.windowMenuButton, menu: this.elements.windowMenu },
      { button: this.elements.galleryMenuButton, menu: this.elements.galleryMenu }
    ];
  }

  private isTopMenuOpen(menu: TopMenuElements): boolean {
    return !menu.menu.classList.contains('hidden');
  }

  private getSubmenus(root: ParentNode = this.elements.appMenuBar): SubmenuElements[] {
    return Array.from(root.querySelectorAll<HTMLElement>('.app-menu-submenu'))
      .map((submenuRoot) => {
        const button = submenuRoot.querySelector<HTMLButtonElement>('.app-menu-submenu-trigger');
        const submenuId = button?.getAttribute('aria-controls');
        const submenu = submenuId ? document.getElementById(submenuId) : null;
        return button && submenu instanceof HTMLElement
          ? { root: submenuRoot, button, menu: submenu }
          : null;
      })
      .filter((submenu): submenu is SubmenuElements => submenu !== null);
  }

  private isSubmenuOpen(submenu: SubmenuElements): boolean {
    return !submenu.menu.classList.contains('hidden');
  }

  private usesInlineSubmenus(): boolean {
    // Keep this in sync with the mobile menu layout in style.css.
    return window.matchMedia?.('(max-width: 620px), (hover: none) and (pointer: coarse)').matches ?? false;
  }

  private openTopMenu(
    menu: TopMenuElements,
    focusTarget: 'first' | 'last' | null = null,
    trackingMode: TopMenuTrackingMode | null = null
  ): void {
    this.callbacks.onBeforeOpenMenu();
    this.closeAllTopMenus(false, menu);
    menu.menu.classList.remove('hidden');
    menu.button.setAttribute('aria-expanded', 'true');
    this.topMenuTrackingMode = trackingMode ?? this.topMenuTrackingMode;

    if (focusTarget) {
      this.focusTopMenuItem(menu, focusTarget);
    }
  }

  private closeTopMenu(menu: TopMenuElements, restoreFocus = false): void {
    this.closeSubmenusWithin(menu.menu);
    menu.menu.classList.add('hidden');
    menu.button.setAttribute('aria-expanded', 'false');
    if (this.hoverOpenedTopMenuButton === menu.button) {
      this.hoverOpenedTopMenuButton = null;
    }
    if (!this.getTopMenus().some((item) => item.menu !== menu.menu && this.isTopMenuOpen(item))) {
      this.topMenuTrackingMode = 'inactive';
    }

    if (restoreFocus) {
      menu.button.focus();
    }
  }

  private suspendTopMenusForTopBarHover(): void {
    for (const menu of this.getTopMenus()) {
      if (!this.isTopMenuOpen(menu)) {
        continue;
      }
      this.closeTopMenu(menu);
    }
    this.topMenuTrackingMode = 'pointer';
  }

  private isPointerWithinTopMenuRegion(target: Node): boolean {
    return this.getTopMenus().some((menu) => menu.button.parentElement?.contains(target));
  }

  private closeAllTopMenus(restoreFocus = false, exceptMenu: TopMenuElements | null = null): void {
    for (const menu of this.getTopMenus()) {
      if (menu.menu === exceptMenu?.menu) {
        continue;
      }
      this.closeTopMenu(menu, restoreFocus && this.isTopMenuOpen(menu));
    }
  }

  private openSubmenu(
    submenu: SubmenuElements,
    focusTarget: 'first' | null = null
  ): void {
    this.closeSiblingSubmenus(submenu);
    submenu.menu.classList.remove('hidden');
    submenu.button.setAttribute('aria-expanded', 'true');
    if (focusTarget === 'first') {
      this.getEnabledMenuItems(submenu.menu).at(0)?.focus();
    }
  }

  private closeSubmenu(submenu: SubmenuElements, restoreFocus = false): void {
    this.closeSubmenusWithin(submenu.menu);
    submenu.menu.classList.add('hidden');
    submenu.button.setAttribute('aria-expanded', 'false');
    if (restoreFocus) {
      submenu.button.focus();
    }
  }

  private closeSiblingSubmenus(submenu: SubmenuElements): void {
    const parentMenu = submenu.root.parentElement?.closest<HTMLElement>('[role="menu"]');
    if (!parentMenu) {
      return;
    }

    for (const sibling of this.getSubmenus(parentMenu)) {
      if (sibling.root !== submenu.root) {
        this.closeSubmenu(sibling);
      }
    }
  }

  private closeSubmenusWithin(root: HTMLElement): void {
    for (const submenu of this.getSubmenus(root)) {
      submenu.menu.classList.add('hidden');
      submenu.button.setAttribute('aria-expanded', 'false');
    }
  }

  private toggleTopMenu(menu: TopMenuElements): void {
    if (this.isTopMenuOpen(menu)) {
      this.closeTopMenu(menu);
      return;
    }

    this.openTopMenu(menu, null, 'pointer');
  }

  private getEnabledMenuItems(menu: HTMLElement): HTMLElement[] {
    return Array.from(menu.querySelectorAll<HTMLElement>('button, input, select, textarea')).filter((element) => {
      const hiddenAncestor = element.closest('.hidden');
      return (
        (!hiddenAncestor || !menu.contains(hiddenAncestor)) &&
        (!('disabled' in element) || !element.disabled)
      );
    });
  }

  private getEnabledTopMenuItems(menu: TopMenuElements): HTMLElement[] {
    return this.getEnabledMenuItems(menu.menu);
  }

  private focusTopMenuItem(menu: TopMenuElements, target: 'first' | 'last'): void {
    const items = this.getEnabledTopMenuItems(menu);
    const item = target === 'first' ? items.at(0) : items.at(-1);
    item?.focus();
  }

  private focusNextTopMenuItem(menu: TopMenuElements, delta: -1 | 1): void {
    const items = this.getEnabledTopMenuItems(menu);
    if (items.length === 0) {
      return;
    }

    const currentIndex = items.indexOf(document.activeElement as HTMLElement);
    const nextIndex =
      currentIndex === -1
        ? delta > 0
          ? 0
          : items.length - 1
        : (currentIndex + delta + items.length) % items.length;
    items[nextIndex]?.focus();
  }

  private bindTopMenu(menu: TopMenuElements): void {
    this.disposables.addEventListener(menu.button, 'click', () => {
      if (this.hoverOpenedTopMenuButton === menu.button && this.isTopMenuOpen(menu)) {
        this.hoverOpenedTopMenuButton = null;
        return;
      }

      this.hoverOpenedTopMenuButton = null;
      this.toggleTopMenu(menu);
    });

    this.disposables.addEventListener(menu.button, 'pointerenter', (event) => {
      if (event.pointerType !== 'mouse' || this.topMenuTrackingMode !== 'pointer' || this.isTopMenuOpen(menu)) {
        return;
      }

      menu.button.focus();
      this.openTopMenu(menu, null, 'pointer');
      this.hoverOpenedTopMenuButton = menu.button;
    });

    this.disposables.addEventListener(menu.button, 'keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        this.toggleTopMenu(menu);
        return;
      }

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        this.openTopMenu(menu, 'first', 'inactive');
        return;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        this.openTopMenu(menu, 'last', 'inactive');
        return;
      }

      if (event.key === 'Escape' && this.isTopMenuOpen(menu)) {
        event.preventDefault();
        this.closeTopMenu(menu, true);
        return;
      }

      if (event.key === 'Tab' && this.isTopMenuOpen(menu)) {
        this.closeTopMenu(menu);
      }
    });

    this.disposables.addEventListener(menu.menu, 'keydown', (event) => {
      const target = event.target;
      const shouldPreserveFieldArrowKeys =
        (event.key === 'ArrowDown' || event.key === 'ArrowUp') &&
        (target instanceof HTMLInputElement ||
          target instanceof HTMLTextAreaElement ||
          target instanceof HTMLSelectElement);

      if (event.key === 'Escape') {
        event.preventDefault();
        this.closeTopMenu(menu, true);
        return;
      }

      if (event.key === 'Tab') {
        this.closeTopMenu(menu);
        return;
      }

      if (event.key === 'ArrowDown' && !shouldPreserveFieldArrowKeys) {
        event.preventDefault();
        this.focusNextTopMenuItem(menu, 1);
        return;
      }

      if (event.key === 'ArrowUp' && !shouldPreserveFieldArrowKeys) {
        event.preventDefault();
        this.focusNextTopMenuItem(menu, -1);
      }
    });
  }

  private bindSubmenu(submenu: SubmenuElements): void {
    this.disposables.addEventListener(submenu.button, 'click', (event) => {
      event.preventDefault();
      if (this.usesInlineSubmenus() && this.isSubmenuOpen(submenu)) {
        this.closeSubmenu(submenu);
        return;
      }
      this.openSubmenu(submenu);
    });

    this.disposables.addEventListener(submenu.root, 'pointerenter', (event) => {
      if (event.pointerType !== 'mouse' || this.usesInlineSubmenus()) {
        return;
      }
      this.openSubmenu(submenu);
    });

    this.disposables.addEventListener(submenu.root, 'pointerleave', (event) => {
      if (event.pointerType !== 'mouse' || this.usesInlineSubmenus()) {
        return;
      }
      if (event.relatedTarget instanceof Node && submenu.root.contains(event.relatedTarget)) {
        return;
      }

      this.closeSubmenu(submenu);
    });

    this.disposables.addEventListener(submenu.button, 'keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowRight') {
        event.preventDefault();
        this.openSubmenu(submenu, event.key === 'ArrowRight' ? 'first' : null);
        return;
      }

      if (event.key === 'Escape' && this.isSubmenuOpen(submenu)) {
        event.preventDefault();
        event.stopPropagation();
        this.closeSubmenu(submenu, true);
      }
    });

    this.disposables.addEventListener(submenu.menu, 'keydown', (event) => {
      if (event.key !== 'ArrowLeft') {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      this.closeSubmenu(submenu, true);
    });
  }
}
