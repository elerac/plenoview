import { expect, test } from '@playwright/test';

const CBOX_RGB_URL = 'https://elerac.github.io/openexr_viewer/cbox_rgb.exr';
const OWL_SPHERES_LINEAR_STOKES_URL =
  'https://huggingface.co/datasets/elerac/polanalyser/resolve/main/data/stokes/imx250mzr/stokes/owl_spheres.exr';

test('serves the project page with app and desktop download calls to action @smoke', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'OpenEXR Viewer', level: 1 })).toBeVisible();

  const heroAppLink = page.getByRole('link', { name: 'Open Web App', exact: true }).first();
  await expect(heroAppLink).toBeVisible();
  await expect(heroAppLink).toHaveAttribute('href', 'app/');
  await expect(page.getByRole('link', { name: 'Gallery', exact: true })).toHaveAttribute('href', '#gallery');

  const desktopButton = page.getByRole('button', { name: 'Desktop App Coming Later', exact: true }).first();
  await expect(desktopButton).toBeDisabled();

  const preview = page.getByRole('img', { name: /OpenEXR Viewer interface/ });
  await expect(preview).toBeVisible();
  await expect.poll(async () => (
    await preview.evaluate((image) => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0)
  )).toBe(true);

  await expect(page.getByRole('heading', { name: 'Features', level: 2 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Gallery', level: 2 })).toBeVisible();
  await expect(page.getByRole('link', { name: 'cbox_rgb.exr', exact: true })).toHaveAttribute(
    'href',
    CBOX_RGB_URL
  );
  await expect(page.getByText('Linear Stokes vector image', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'owl_spheres.exr', exact: true })).toHaveAttribute(
    'href',
    OWL_SPHERES_LINEAR_STOKES_URL
  );

  const sectionOrder = await page.evaluate(() => {
    const features = document.querySelector('#features');
    const gallery = document.querySelector('#gallery');
    if (!features || !gallery) {
      return false;
    }
    return Boolean(features.compareDocumentPosition(gallery) & Node.DOCUMENT_POSITION_FOLLOWING);
  });
  expect(sectionOrder).toBe(true);

  await page.locator('#gallery').scrollIntoViewIfNeeded();
  const embeds = page.locator('openexr-viewer');
  await expect(embeds).toHaveCount(2);

  const cornellEmbed = embeds.first();
  await expect(cornellEmbed).toHaveAttribute('src', CBOX_RGB_URL);
  await expect(cornellEmbed).toHaveAttribute('name', 'Cornell Box');
  await expect(cornellEmbed).toHaveAttribute('width', '100%');
  await expect(cornellEmbed).toHaveAttribute('height', '420');

  const stokesEmbed = embeds.nth(1);
  await expect(stokesEmbed).toHaveAttribute('src', OWL_SPHERES_LINEAR_STOKES_URL);
  await expect(stokesEmbed).toHaveAttribute('name', 'Owl Spheres Linear Stokes');
  await expect(stokesEmbed).toHaveAttribute('width', '100%');
  await expect(stokesEmbed).toHaveAttribute('height', '420');
  await expect(stokesEmbed).toHaveAttribute('bottom-panel', 'channels');
  await expect(stokesEmbed).toHaveAttribute('auto-load', 'false');

  const iframeSrc = await cornellEmbed.evaluate((element) => {
    const iframe = element.shadowRoot?.querySelector('iframe');
    return iframe instanceof HTMLIFrameElement ? iframe.src : '';
  });
  expect(iframeSrc).toContain('/app/?ui=embed');
  expect(iframeSrc).toContain(`src=${encodeURIComponent(CBOX_RGB_URL)}`);
  expect(iframeSrc).toContain('name=Cornell+Box');

  const stokesIframeSrc = await stokesEmbed.evaluate((element) => {
    const iframe = element.shadowRoot?.querySelector('iframe');
    return iframe instanceof HTMLIFrameElement ? iframe.src : '';
  });
  expect(stokesIframeSrc).toContain('/app/?ui=embed');
  expect(stokesIframeSrc).toContain(`src=${encodeURIComponent(OWL_SPHERES_LINEAR_STOKES_URL)}`);
  expect(stokesIframeSrc).toContain('name=Owl+Spheres+Linear+Stokes');
  expect(stokesIframeSrc).toContain('bottomPanel=channels');
  expect(stokesIframeSrc).toContain('autoLoad=false');

  const embeddedViewer = cornellEmbed.frameLocator('iframe');
  await expect(embeddedViewer.locator('#gl-canvas')).toBeVisible({
    timeout: 30000
  });
  await expect(embeddedViewer.getByRole('button', { name: 'Open full viewer', exact: true })).toBeEnabled();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(cornellEmbed).toHaveAttribute('height', '320');
  await expect(stokesEmbed).toHaveAttribute('height', '320');
  await expect.poll(async () => (
    await cornellEmbed.evaluate((element) => {
      const iframe = element.shadowRoot?.querySelector('iframe');
      return iframe instanceof HTMLIFrameElement ? iframe.style.height : '';
    })
  )).toBe('320px');
  await expect.poll(async () => (
    await stokesEmbed.evaluate((element) => {
      const iframe = element.shadowRoot?.querySelector('iframe');
      return iframe instanceof HTMLIFrameElement ? iframe.style.height : '';
    })
  )).toBe('320px');
});
