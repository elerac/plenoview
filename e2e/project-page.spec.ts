import { expect, test } from '@playwright/test';

test('serves the project page with app and desktop download calls to action @smoke', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'OpenEXR Viewer', level: 1 })).toBeVisible();

  const heroAppLink = page.getByRole('link', { name: 'Open Web App', exact: true }).first();
  await expect(heroAppLink).toBeVisible();
  await expect(heroAppLink).toHaveAttribute('href', 'app/');

  const desktopButton = page.getByRole('button', { name: 'Desktop App Coming Later', exact: true }).first();
  await expect(desktopButton).toBeDisabled();

  const preview = page.getByRole('img', { name: /OpenEXR Viewer interface/ });
  await expect(preview).toBeVisible();
  await expect.poll(async () => (
    await preview.evaluate((image) => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0)
  )).toBe(true);
});
