import { expect, test, type Page } from '@playwright/test';
import { gotoViewerApp, openGalleryCbox } from './helpers/app';
import { resolveViewerPoint } from './helpers/viewer';

test('splits the viewer with Cmd+D shortcuts and resets to a single pane', async ({ page }) => {
  await gotoViewerApp(page);
  await openGalleryCbox(page);

  const viewer = page.locator('#viewer-container');
  const exportScreenshot = page.locator('#export-screenshot-button');
  const appScreenshot = page.locator('#app-screenshot-button');
  const panX = page.getByRole('spinbutton', { name: 'Pan X' });

  await expect(exportScreenshot).toBeEnabled();

  await page.keyboard.press('Meta+D');
  await expectPaneCount(page, 2);
  await expect(exportScreenshot).toBeDisabled();
  await expect(appScreenshot).toBeDisabled();

  const rightPanePoint = await resolveViewerPoint(viewer, 0.75, 0.5);
  await page.mouse.move(rightPanePoint.x, rightPanePoint.y);
  await page.keyboard.press('Meta+Shift+D');
  await expectPaneCount(page, 3);

  const initialPanX = await readNumberInput(panX);
  await page.mouse.click(rightPanePoint.x, rightPanePoint.y);
  await page.keyboard.down('d');
  try {
    await expect.poll(async () => await readNumberInput(panX)).not.toBe(initialPanX);
  } finally {
    await page.keyboard.up('d');
  }

  await expectPaneCount(page, 3);

  await page.getByRole('button', { name: 'Window', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Single Pane', exact: true }).click();

  await expectPaneCount(page, 0);
  await expect(exportScreenshot).toBeEnabled();
});

async function expectPaneCount(page: Page, count: number): Promise<void> {
  await expect.poll(async () => {
    return page.locator('.viewer-pane-frame').count();
  }).toBe(count);
}

async function readNumberInput(locator: ReturnType<Page['getByRole']>): Promise<number> {
  return Number(await locator.inputValue());
}
