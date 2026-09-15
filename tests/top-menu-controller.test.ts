// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { resolveElements } from '../src/ui/elements';
import { TopMenuController } from '../src/ui/top-menu-controller';

let controller: TopMenuController;

beforeEach(() => {
  const html = readFileSync(resolve(process.cwd(), 'app/index.html'), 'utf8');
  document.body.innerHTML = html.match(/<body[^>]*>([\s\S]*)<\/body>/i)![1];
  controller = new TopMenuController(resolveElements(), { onBeforeOpenMenu: () => {} });
});

afterEach(() => {
  controller.dispose();
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

function button(id: string): HTMLButtonElement {
  return document.getElementById(id) as HTMLButtonElement;
}

it.each(['touch', 'pen'])('ignores %s pointer boundaries while tapping through menus', (pointerType) => {
  const gallery = button('gallery-menu-button');
  const view = button('view-menu-button');
  const trigger = button('gallery-polyhaven-menu-button');
  const root = trigger.closest('.app-menu-submenu') as HTMLElement;
  const submenu = document.getElementById('gallery-polyhaven-menu')!;

  gallery.click();
  view.dispatchEvent(new PointerEvent('pointerenter', { pointerType }));
  expect(gallery.getAttribute('aria-expanded')).toBe('true');
  expect(view.getAttribute('aria-expanded')).toBe('false');
  root.dispatchEvent(new PointerEvent('pointerenter', { pointerType }));
  expect(submenu.classList.contains('hidden')).toBe(true);

  trigger.click();
  root.dispatchEvent(new PointerEvent('pointerleave', { pointerType, relatedTarget: document.body }));
  document.querySelector('.app-menu-title')!.dispatchEvent(new PointerEvent('pointerover', {
    pointerType, bubbles: true
  }));
  expect(submenu.classList.contains('hidden')).toBe(false);
  expect(trigger.getAttribute('aria-expanded')).toBe('true');
  expect(gallery.getAttribute('aria-expanded')).toBe('true');

  view.click();
  expect(submenu.classList.contains('hidden')).toBe(true);
  expect(gallery.getAttribute('aria-expanded')).toBe('false');
  expect(view.getAttribute('aria-expanded')).toBe('true');
});

it('opens inline submenus by click, collapses them on a second click, and supports arrow navigation', () => {
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })));
  const trigger = button('gallery-polyhaven-menu-button');
  const root = trigger.closest('.app-menu-submenu') as HTMLElement;
  const firstItem = button('gallery-polyhaven-artist-workshop-1k-button');

  button('gallery-menu-button').click();
  root.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse' }));
  expect(trigger.getAttribute('aria-expanded')).toBe('false');
  trigger.click();
  root.dispatchEvent(new PointerEvent('pointerleave', { pointerType: 'mouse', relatedTarget: document.body }));
  expect(trigger.getAttribute('aria-expanded')).toBe('true');
  trigger.click();
  expect(trigger.getAttribute('aria-expanded')).toBe('false');

  trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  expect(trigger.getAttribute('aria-expanded')).toBe('true');
  expect(document.activeElement).toBe(firstItem);
  firstItem.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
  expect(trigger.getAttribute('aria-expanded')).toBe('false');
  expect(document.activeElement).toBe(trigger);
});
