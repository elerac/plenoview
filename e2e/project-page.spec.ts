import { expect, test, type Page } from '@playwright/test';
import { expectViewerAppReady } from './helpers/app';

const CBOX_RGB_URL = 'cbox_rgb.exr';
const OWL_SPHERES_LINEAR_STOKES_URL =
  'https://huggingface.co/datasets/elerac/polanalyser/resolve/main/data/stokes/imx250mzr/stokes/owl_spheres.exr';
const RELEASES_URL = 'https://github.com/elerac/prismifold/releases/latest';
const WINDOWS_DESKTOP_URL =
  'https://github.com/elerac/prismifold/releases/latest/download/Prismifold-windows-x64-setup.exe';
const MACOS_DESKTOP_URL =
  'https://github.com/elerac/prismifold/releases/latest/download/Prismifold-macos-arm64.dmg';
const EXPECTED_BOOTSTRAP_ABORT = 'Viewer application has not finished initializing.';

function watchUnexpectedErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') {
      errors.push(`console: ${message.text()}`);
    }
  });
  page.on('pageerror', (error) => {
    if (!error.message.includes(EXPECTED_BOOTSTRAP_ABORT)) {
      errors.push(`pageerror: ${error.message}`);
    }
  });
  return errors;
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  await expect.poll(async () => (
    await page.evaluate(() => {
      const width = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
      return width <= document.documentElement.clientWidth + 1;
    })
  )).toBe(true);
}

test('serves the project page with app and desktop download calls to action @smoke', async ({ page }) => {
  const unexpectedErrors = watchUnexpectedErrors(page);
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Prismifold', level: 1 })).toBeVisible();
  await expect(page.getByText(
    'OpenEXR viewer for channel-heavy computational images. Inspect local files with raw probes, channel views, ROI statistics, panoramas, and PNG export.',
    { exact: true }
  )).toBeVisible();

  const heroAppLink = page.getByRole('link', { name: 'Open Web App', exact: true }).first();
  await expect(heroAppLink).toBeVisible();
  await expect(heroAppLink).toHaveAttribute('href', 'app/');
  const heroDownloadLink = page.getByRole('link', { name: 'Download Desktop', exact: true }).first();
  await expect(heroDownloadLink).toBeVisible();
  await expect(heroDownloadLink).toHaveAttribute('href', '#downloads');
  await expect(page.getByRole('link', { name: 'Downloads', exact: true }).first()).toHaveAttribute(
    'href',
    '#downloads'
  );
  await expect(page.getByRole('link', { name: 'Gallery', exact: true })).toHaveAttribute('href', '#gallery');

  const preview = page.getByRole('img', { name: /Prismifold interface/ });
  await expect(preview).toBeVisible();
  await expect.poll(async () => (
    await preview.evaluate((image) => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0)
  )).toBe(true);
  await expectNoHorizontalOverflow(page);

  await expect(page.getByRole('heading', { name: 'Downloads', level: 2 })).toBeVisible();
  await expect(page.getByText(
    'Desktop installers are published from the latest GitHub Release. These unsigned builds may show Windows or macOS security prompts.',
    { exact: true }
  )).toBeVisible();
  await expect(page.getByRole('link', { name: 'Download Prismifold for Windows x64', exact: true })).toHaveAttribute(
    'href',
    WINDOWS_DESKTOP_URL
  );
  await expect(page.getByRole('link', { name: 'Download Prismifold for macOS ARM64', exact: true })).toHaveAttribute(
    'href',
    MACOS_DESKTOP_URL
  );
  await expect(page.getByRole('link', { name: 'Release notes and checksums', exact: true })).toHaveAttribute(
    'href',
    RELEASES_URL
  );
  await expect(page.getByRole('heading', { name: 'Features', level: 2 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Inspect', level: 3 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Visualize', level: 3 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Measure', level: 3 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Export', level: 3 })).toBeVisible();
  await expect(page.getByText('OpenEXR 2.x scanline', { exact: true })).toBeVisible();
  await expect(page.getByText('half / float / uint', { exact: true })).toBeVisible();
  await expect(page.getByText('WebGL2', { exact: true })).toBeVisible();
  await expect(page.getByText('exrs WASM', { exact: true })).toBeVisible();
  await expect(page.getByText('local files stay local', { exact: true })).toBeVisible();
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
    const downloads = document.querySelector('#downloads');
    const features = document.querySelector('#features');
    const gallery = document.querySelector('#gallery');
    if (!downloads || !features || !gallery) {
      return false;
    }
    return (
      Boolean(downloads.compareDocumentPosition(features) & Node.DOCUMENT_POSITION_FOLLOWING) &&
      Boolean(features.compareDocumentPosition(gallery) & Node.DOCUMENT_POSITION_FOLLOWING)
    );
  });
  expect(sectionOrder).toBe(true);

  await page.locator('#gallery').scrollIntoViewIfNeeded();
  await expectNoHorizontalOverflow(page);
  const embeds = page.locator('prismifold-viewer');
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
  expect(iframeSrc).not.toContain('src=');
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

  const deferredStokesViewer = stokesEmbed.frameLocator('iframe');
  await expect(deferredStokesViewer.getByRole('button', { name: 'Load image', exact: true })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoHorizontalOverflow(page);
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
  expect(unexpectedErrors).toEqual([]);
});

test('opens the viewer app from the project page hero @smoke', async ({ page }) => {
  const unexpectedErrors = watchUnexpectedErrors(page);
  await page.goto('/');

  const heroAppLink = page.getByRole('link', { name: 'Open Web App', exact: true }).first();
  await heroAppLink.click();

  await expect(page).toHaveURL(/\/app\/$/);
  await expectViewerAppReady(page);
  expect(unexpectedErrors).toEqual([]);
});
