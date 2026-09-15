import { expect, test, type Locator, type Page } from './helpers/test';
import { gotoViewerApp } from './helpers/app';
import { buildSizedRgbExr } from './helpers/exr-fixtures';

test.use({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true });

async function expectTapTarget(page: Page, item: Locator): Promise<void> {
  await item.scrollIntoViewIfNeeded();
  const target = await item.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      left: rect.left,
      right: rect.right,
      height: rect.height,
      receivesTap: element.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2))
    };
  });
  expect(target.left).toBeGreaterThanOrEqual(0);
  expect(target.right).toBeLessThanOrEqual(page.viewportSize()!.width);
  expect(target.height).toBeGreaterThanOrEqual(44);
  expect(target.receivesTap).toBe(true);
}

test('expands mobile Gallery folders without covering other items @smoke', async ({ page }) => {
  await gotoViewerApp(page);
  await page.locator('#gallery-menu-button').tap();
  const trigger = page.locator('#gallery-polyhaven-menu-button');
  const submenu = page.locator('#gallery-polyhaven-menu');
  const nextFolder = page.locator('#gallery-kaist-menu-button');

  await trigger.tap();
  await expect(submenu).toBeVisible();
  const submenuBox = (await submenu.boundingBox())!;
  const nextFolderBox = (await nextFolder.boundingBox())!;
  expect(nextFolderBox.y).toBeGreaterThanOrEqual(submenuBox.y + submenuBox.height);
  for (const item of await submenu.getByRole('menuitem').all()) {
    await expectTapTarget(page, item);
  }

  await trigger.tap();
  await expect(submenu).toBeHidden();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await trigger.tap();
  await expect(submenu).toBeVisible();
  await nextFolder.tap();
  await expect(submenu).toBeHidden();
  await expect(page.locator('#gallery-kaist-menu')).toBeVisible();

  await page.locator('#view-menu-button').tap();
  await expect(page.locator('#gallery-menu')).toBeHidden();
  await expect(page.locator('#view-menu')).toBeVisible();
  await page.locator('.app-menu-title').tap();
  await expect(page.locator('#view-menu')).toBeHidden();
});

for (const [itemId, filename] of [
  ['gallery-polyhaven-artist-workshop-1k-button', 'artist_workshop_1k.exr'],
  ['gallery-brown-photostudio-02-1k-button', 'brown_photostudio_02_1k.exr'],
  ['gallery-polyhaven-symmetrical-garden-02-1k-button', 'symmetrical_garden_02_1k.exr']
]) {
  test(`loads ${filename} on the first mobile tap`, async ({ page }) => {
    await page.route('**/*.exr', (route) => route.fulfill({
      contentType: 'image/exr', body: buildSizedRgbExr(4, 2)
    }));
    await gotoViewerApp(page);
    await page.locator('#gallery-menu-button').tap();
    await page.locator('#gallery-polyhaven-menu-button').tap();
    const item = page.locator(`#${itemId}`);
    await expectTapTarget(page, item);
    await item.tap();
    await expect(page.locator('#gallery-menu')).toBeHidden();
    await expect(page.locator('#opened-images-select option:checked')).toContainText(filename);
    await expect(page.locator('#opened-images-select option')).toHaveCount(1);
  });
}

test('keeps long mobile Gallery lists scrollable and selects their last item', async ({ page }) => {
  await page.route('**/*.exr', (route) => route.fulfill({
    contentType: 'image/exr', body: buildSizedRgbExr(4, 2)
  }));
  await gotoViewerApp(page);
  await page.locator('#gallery-menu-button').tap();
  await page.locator('#gallery-kaist-menu-button').tap();
  const lastItem = page.locator('#gallery-kaist-scene30-reflectance-button');
  await expectTapTarget(page, lastItem);
  const menuBox = (await page.locator('#gallery-menu').boundingBox())!;
  expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  await lastItem.tap();
  await expect(page.locator('#opened-images-select option:checked')).toContainText('scene30_reflectance.exr');
  await expect(page.locator('#gallery-menu')).toBeHidden();
});

for (const viewport of [{ width: 320, height: 640 }, { width: 844, height: 390 }]) {
  test(`fits the mobile View submenu at ${viewport.width}px and selects Panorama image`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await gotoViewerApp(page);
    await page.setInputFiles('#file-input', {
      name: 'panorama.exr', mimeType: 'image/exr', buffer: buildSizedRgbExr(4, 2)
    });
    await expect(page.locator('#opened-images-select option:checked')).toContainText('panorama.exr');
    await page.locator('#view-menu-button').tap();
    const trigger = page.locator('#panorama-viewer-menu-item');
    const submenu = page.locator('#panorama-viewer-menu');
    await trigger.tap();
    await expect(submenu).toBeVisible();
    const submenuBox = (await submenu.boundingBox())!;
    const nextItemBox = (await page.locator('#three-d-viewer-menu-item').boundingBox())!;
    expect(nextItemBox.y).toBeGreaterThanOrEqual(submenuBox.y + submenuBox.height);
    await expectTapTarget(page, page.locator('#environment-path-tracing-menu-item'));
    const item = page.locator('#panorama-image-menu-item');
    await expectTapTarget(page, item);
    await item.tap();
    await expect(page.locator('#view-menu')).toBeHidden();
    await expect(item).toHaveAttribute('aria-checked', 'true');
  });
}
