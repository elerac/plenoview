import { expect, test, type Page } from './helpers/test';
import { expectViewerAppReady } from './helpers/app';
import { readProbeCoords } from './helpers/viewer';

const CBOX_RGB_URL = 'cbox_rgb.exr';
const MIDDLEBURY_CHESS1_RGB_P_URL = 'middlebury_chess1_rgb_p.exr';
const MIDDLEBURY_SCENES2021_URL = 'https://vision.middlebury.edu/stereo/data/scenes2021/';
const KAIST_DATASET_URL = 'https://vclab.kaist.ac.kr/siggraphasia2017p1/kaistdataset.html';
const POLYHAVEN_BROWN_PHOTOSTUDIO_PAGE_URL = 'https://polyhaven.com/a/brown_photostudio_02';
const SPOONS_LINEAR_STOKES_URL =
  'https://huggingface.co/datasets/elerac/polanalyser/resolve/main/data/stokes/imx250mzr/stokes/spoons.exr';
const BROWN_PHOTOSTUDIO_PANORAMA_URL =
  'https://dl.polyhaven.org/file/ph-assets/HDRIs/exr/1k/brown_photostudio_02_1k.exr';
const OWL_SPHERES_LINEAR_STOKES_URL =
  'https://huggingface.co/datasets/elerac/polanalyser/resolve/main/data/stokes/imx250mzr/stokes/owl_spheres.exr';
const KAIST_SCENE27_REFLECTANCE_URL =
  'https://huggingface.co/datasets/danaroth/kaist-hyperspectral/resolve/main/exr/scene27_reflectance.exr';
const WINDOWS_DESKTOP_URL =
  'https://github.com/elerac/plenoview/releases/latest/download/Plenoview-windows-x64-setup.exe';
const MACOS_DESKTOP_URL =
  'https://github.com/elerac/plenoview/releases/latest/download/Plenoview-macos-arm64.dmg';
const VSCODE_MARKETPLACE_URL = 'https://marketplace.visualstudio.com/items?itemName=elerac.plenoview-vscode';
const OPENEXR_IO_SKILL_URL = 'skills/openexr-io/SKILL.md';
const EXPECTED_BOOTSTRAP_ABORT = 'Viewer application has not finished initializing.';
const PROJECT_PAGE_TITLE = 'Plenoview | OpenEXR Image Viewer';
const PROJECT_PAGE_DESCRIPTION =
  'Plenoview is an OpenEXR image viewer for computational imaging, rendering, and vision workflows, with spectral, polarization, panorama, depth, and AOV inspection.';
const PROJECT_PAGE_URL = 'https://elerac.github.io/plenoview/';
const PROJECT_PAGE_IMAGE_URL = 'https://elerac.github.io/plenoview/project-page/social-preview.jpg';
const PROJECT_PAGE_IMAGE_ALT =
  'Luminous glass prism splitting RGB light beams on a dark technical viewer backdrop';

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

function decodeLaunchState(url: URL): Record<string, unknown> {
  const state = url.searchParams.get('state');
  if (!state) {
    throw new Error(`Expected launch URL state param in ${url.toString()}`);
  }

  return JSON.parse(decodeURIComponent(state)) as Record<string, unknown>;
}

async function expectGalleryCardLaunch(
  page: Page,
  title: string,
  image: { accessibleName: RegExp; src: string },
  launch: { src: string | RegExp; state?: Record<string, unknown> | null }
): Promise<void> {
  const item = page.locator('.gallery-item').filter({ hasText: title });
  await expect(item).toHaveCount(1);
  await expect(item.locator('plenoview-viewer')).toHaveCount(0);

  const screenshot = item.getByRole('img', { name: image.accessibleName });
  await expect(screenshot).toBeVisible();
  await expect(screenshot).toHaveAttribute('src', image.src);
  await expect(screenshot).toHaveAttribute('loading', 'lazy');
  await expect(screenshot).toHaveAttribute('decoding', 'async');
  await expect.poll(async () => (
    await screenshot.evaluate((node) => (
      node instanceof HTMLImageElement && node.complete && node.naturalWidth > 0 && node.naturalHeight > 0
    ))
  )).toBe(true);

  const launchLink = item.getByRole('link', { name: 'Try Web App', exact: true });
  await expect(launchLink).toBeVisible();
  await expect(launchLink).toHaveAttribute('target', '_blank');
  await expect(launchLink).toHaveAttribute('rel', 'noopener');
  const href = await launchLink.getAttribute('href');
  if (!href) {
    throw new Error(`Expected launch link href for ${title}.`);
  }

  const launchUrl = new URL(href, page.url());
  expect(launchUrl.pathname).toBe('/app/');
  const src = launchUrl.searchParams.get('src');
  if (launch.src instanceof RegExp) {
    expect(src).toMatch(launch.src);
  } else {
    expect(src).toBe(launch.src);
  }
  if (launch.state === null) {
    expect(launchUrl.searchParams.has('state')).toBe(false);
  } else if (launch.state !== undefined) {
    expect(decodeLaunchState(launchUrl)).toMatchObject(launch.state);
  }
}

test('serves the project page with app, desktop, and VS Code download calls to action @smoke', async ({ page }) => {
  const unexpectedErrors = watchUnexpectedErrors(page);
  await page.goto('/');

  await expect(page).toHaveTitle(PROJECT_PAGE_TITLE);
  await expect(page.locator('head meta[name="description"]')).toHaveAttribute('content', PROJECT_PAGE_DESCRIPTION);
  await expect(page.locator('head meta[name="robots"]')).toHaveAttribute('content', 'index,follow');
  await expect(page.locator('head meta[name="theme-color"]')).toHaveAttribute('content', '#0b0f14');
  await expect(page.locator('head meta[name="application-name"]')).toHaveAttribute('content', 'Plenoview');
  await expect(page.locator('head link[rel="canonical"]')).toHaveAttribute('href', PROJECT_PAGE_URL);
  await expect(page.locator('head link[rel="icon"]')).toHaveAttribute('href', 'project-page/app-icon.png');
  await expect(page.locator('head link[rel="apple-touch-icon"]')).toHaveAttribute(
    'href',
    'project-page/app-icon.png'
  );
  await expect(page.locator('head meta[property="og:type"]')).toHaveAttribute('content', 'website');
  await expect(page.locator('head meta[property="og:site_name"]')).toHaveAttribute('content', 'Plenoview');
  await expect(page.locator('head meta[property="og:title"]')).toHaveAttribute('content', PROJECT_PAGE_TITLE);
  await expect(page.locator('head meta[property="og:description"]')).toHaveAttribute(
    'content',
    PROJECT_PAGE_DESCRIPTION
  );
  await expect(page.locator('head meta[property="og:url"]')).toHaveAttribute('content', PROJECT_PAGE_URL);
  await expect(page.locator('head meta[property="og:image"]')).toHaveAttribute('content', PROJECT_PAGE_IMAGE_URL);
  await expect(page.locator('head meta[property="og:image:width"]')).toHaveAttribute('content', '1200');
  await expect(page.locator('head meta[property="og:image:height"]')).toHaveAttribute('content', '630');
  await expect(page.locator('head meta[property="og:image:alt"]')).toHaveAttribute(
    'content',
    PROJECT_PAGE_IMAGE_ALT
  );
  await expect(page.locator('head meta[name="twitter:card"]')).toHaveAttribute('content', 'summary_large_image');
  await expect(page.locator('head meta[name="twitter:title"]')).toHaveAttribute('content', PROJECT_PAGE_TITLE);
  await expect(page.locator('head meta[name="twitter:description"]')).toHaveAttribute(
    'content',
    PROJECT_PAGE_DESCRIPTION
  );
  await expect(page.locator('head meta[name="twitter:image"]')).toHaveAttribute('content', PROJECT_PAGE_IMAGE_URL);
  await expect(page.locator('head meta[name="twitter:image:alt"]')).toHaveAttribute(
    'content',
    PROJECT_PAGE_IMAGE_ALT
  );
  const structuredDataText = await page.locator('head script[type="application/ld+json"]').textContent();
  expect(JSON.parse(structuredDataText ?? '{}')).toMatchObject({
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'Plenoview',
    applicationCategory: 'MultimediaApplication',
    operatingSystem: 'Web, Windows, macOS',
    url: PROJECT_PAGE_URL,
    image: PROJECT_PAGE_IMAGE_URL,
    description: PROJECT_PAGE_DESCRIPTION,
    downloadUrl: 'https://github.com/elerac/plenoview/releases/latest',
    softwareVersion: '0.1.0',
    license: 'https://github.com/elerac/plenoview/blob/main/LICENSE',
    sameAs: [
      'https://github.com/elerac/plenoview',
      'https://marketplace.visualstudio.com/items?itemName=elerac.plenoview-vscode'
    ],
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'USD'
    }
  });
  const socialPreviewDimensions = await page.evaluate(async () => {
    const image = new Image();
    image.src = new URL('project-page/social-preview.jpg', window.location.href).href;
    await image.decode();
    return {
      width: image.naturalWidth,
      height: image.naturalHeight
    };
  });
  expect(socialPreviewDimensions).toEqual({ width: 1200, height: 630 });
  const sitemapResponse = await page.request.get('/sitemap.xml');
  expect(sitemapResponse.ok()).toBe(true);
  const sitemapXml = await sitemapResponse.text();
  expect(sitemapXml).toContain(`<loc>${PROJECT_PAGE_URL}</loc>`);
  expect(sitemapXml).toContain('<loc>https://elerac.github.io/plenoview/embed/</loc>');
  expect(sitemapXml).not.toContain('/app/');

  const brandIcon = page.locator('.brand-mark');
  await expect(brandIcon).toHaveAttribute('src', 'project-page/app-icon.png');
  await expect.poll(async () => (
    await brandIcon.evaluate((image) => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0)
  )).toBe(true);

  await expect(page.getByRole('heading', { name: 'Plenoview', level: 1 })).toBeVisible();
  await expect(page.getByText('A reader for folded light.', { exact: true })).toHaveCount(0);
  await expect(page.getByText(
    'Plenoview is an OpenEXR image viewer for computational imaging, rendering, and vision workflows. It reveals the rich structure of images that contain more than color, including polarization, spectral, panoramas, depth, and AOVs.',
    { exact: true }
  )).toBeVisible();
  await expect(page.getByText(
    'The name evokes a prism not merely as a symbol of color, but as a way of unfolding the manifold structure hidden inside high-dimensional image data.',
    { exact: true }
  )).toHaveCount(0);

  const heroAppLink = page.getByRole('link', { name: 'Open Web App', exact: true }).first();
  await expect(heroAppLink).toBeVisible();
  await expect(heroAppLink).toHaveAttribute('href', 'app/');
  await expect(heroAppLink).toHaveAttribute('target', '_blank');
  await expect(heroAppLink).toHaveAttribute('rel', 'noopener');
  await expect(page.getByRole('link', { name: 'Download Desktop', exact: true })).toHaveCount(0);
  const heroEmbedLink = page.locator('.hero-actions').getByRole('link', { name: 'Embed', exact: true });
  await expect(heroEmbedLink).toBeVisible();
  await expect(heroEmbedLink).toHaveAttribute('href', 'embed/');
  await expect(page.getByRole('link', { name: 'Downloads', exact: true }).first()).toHaveAttribute(
    'href',
    '#downloads'
  );
  await expect(page.getByRole('link', { name: 'Gallery', exact: true })).toHaveAttribute('href', '#gallery');
  await expect(page.locator('.site-nav').getByRole('link', { name: 'Embed', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Guidance', exact: true })).toHaveAttribute('href', '#openexr-io');

  const preview = page.getByRole('img', { name: /Plenoview interface/ });
  await expect(preview).toBeVisible();
  await expect(preview).toHaveAttribute('src', 'project-page/app-preview.jpg');
  await expect(preview).toHaveAttribute('width', '1440');
  await expect(preview).toHaveAttribute('height', '900');
  await expect(preview).toHaveAttribute('decoding', 'async');
  await expect(preview).toHaveAttribute('fetchpriority', 'high');
  await expect.poll(async () => (
    await preview.evaluate((image) => {
      if (!(image instanceof HTMLImageElement) || !image.complete) {
        return null;
      }
      return {
        width: image.naturalWidth,
        height: image.naturalHeight
      };
    })
  )).toEqual({ width: 1440, height: 900 });
  await expectNoHorizontalOverflow(page);

  await expect(page.getByRole('heading', { name: 'Downloads', level: 2 })).toBeVisible();
  await expect(page.getByText(
    'Desktop installers are published from the latest GitHub Release, and the VS Code extension is available from the Visual Studio Marketplace. Unsigned desktop builds may show Windows or macOS security prompts.',
    { exact: true }
  )).toBeVisible();
  await expect(page.getByRole('link', { name: 'Download Plenoview for Windows x64', exact: true })).toHaveAttribute(
    'href',
    WINDOWS_DESKTOP_URL
  );
  await expect(page.getByRole('link', { name: 'Download Plenoview for macOS ARM64', exact: true })).toHaveAttribute(
    'href',
    MACOS_DESKTOP_URL
  );
  await expect(page.getByRole('link', { name: 'Install Plenoview VS Code extension', exact: true })).toHaveAttribute(
    'href',
    VSCODE_MARKETPLACE_URL
  );
  await expect(page.getByText('VS Code', { exact: true })).toBeVisible();
  await expect(page.getByText('Marketplace extension', { exact: true })).toBeVisible();
  await expect(page.getByText('Open Marketplace', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Release notes and checksums', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Features', level: 2 })).toBeVisible();
  await expect(page.getByText(
    'Tools for inspecting, visualizing, exporting, and embedding channel-heavy EXR data.',
    { exact: true }
  )).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Inspect', level: 3 })).toBeVisible();
  await expect(page.locator('.feature-card').filter({ hasText: 'Inspect' }).locator('.feature-list li')).toHaveCount(3);
  await expect(page.getByText(
    'Open files and sample scenes; review metadata and channels.',
    { exact: true }
  )).toBeVisible();
  await expect(page.getByText(
    'Probe exact source values with zoom and rulers.',
    { exact: true }
  )).toBeVisible();
  await expect(page.getByText(
    'Inspect ROIs, valid samples, and image statistics.',
    { exact: true }
  )).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Visualize', level: 3 })).toBeVisible();
  await expect(page.getByText(
    'Browse RGB, alpha, AOV, spectral, polarization, and grouped channels.',
    { exact: true }
  )).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Measure', level: 3 })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Export', level: 3 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Embed', level: 3 })).toBeVisible();
  await expect(page.getByText('Add <plenoview-viewer> to HTML pages.', { exact: true })).toBeVisible();
  await expect(page.getByText(
    'Load the viewer with the hosted JavaScript web component.',
    { exact: true }
  )).toBeVisible();
  await expect(page.getByText('OpenEXR 2.x scanline', { exact: true })).toHaveCount(0);
  await expect(page.getByText('half / float / uint', { exact: true })).toHaveCount(0);
  await expect(page.getByText('WebGL2', { exact: true })).toHaveCount(0);
  await expect(page.getByText('exrs WASM', { exact: true })).toHaveCount(0);
  await expect(page.getByText('local files stay local', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Gallery', level: 2 })).toBeVisible();
  await expect(page.getByText(
    'Gallery examples highlight source-value inspection, screenshot export, visualization across RGB, depth, hyperspectral, polarization, and panorama EXR data, plus an embeddable HTML viewer demo.',
    { exact: true }
  )).toBeVisible();
  await expect(page.getByText(
    'Zoom into image data with pixel rulers and lock a probe to read exact source channel values directly from the OpenEXR pixels.',
    { exact: true }
  )).toBeVisible();
  await expect(page.getByText('Source value inspection', { exact: true })).toBeVisible();
  await expect(page.getByText('Screenshot export', { exact: true })).toBeVisible();
  await expect(page.getByText(
    'Select and crop multiple regions from the current view, keep a region active for adjustment, and export pixel exact screenshot crops without interpolation.',
    { exact: true }
  )).toBeVisible();
  await expect(page.getByText('3D view', { exact: true })).toBeVisible();
  await expect(page.locator('.gallery-item').filter({
    hasText: /Switch RGB plus position data into a 3D point-cloud view, tune camera angles\s+and point size/
  })).toHaveCount(1);
  await expect(page.getByRole('link', { name: 'Middlebury Stereo Datasets', exact: true })).toHaveAttribute(
    'href',
    MIDDLEBURY_SCENES2021_URL
  );
  await expect(page.locator('.gallery-item').filter({
    hasText: /Spectral channels are automatically computed into RGB for visualization/
  })).toHaveCount(1);
  await expect(page.getByText('Spectral visualization', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'KAIST Hyperspectral Image Dataset', exact: true })).toHaveAttribute(
    'href',
    KAIST_DATASET_URL
  );
  await expect(page.locator('.gallery-item').filter({ hasText: /AoLP/ })).toHaveCount(1);
  await expect(page.getByText(/angle of linear polarization/)).toHaveCount(0);
  await expect(page.getByText('Stokes vector visualization', { exact: true })).toBeVisible();
  await expect(page.locator('.gallery-item').filter({
    hasText: /Full-Stokes vector\s+images that include the circular/
  }).filter({
    hasText: 'S3'
  }).filter({
    hasText: /CoP[\s\S]*ToP/
  })).toHaveCount(1);
  await expect(page.getByText(/Navigate HDRI data in equirectangular format with panorama mode and a wide fov/)).toBeVisible();
  await expect(page.getByText('Panorama view', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Poly Haven HDRIs', exact: true })).toHaveAttribute(
    'href',
    POLYHAVEN_BROWN_PHOTOSTUDIO_PAGE_URL
  );
  await expect.poll(async () => (
    await page.locator('.gallery-source-link').evaluateAll((links) => links.every((link) => {
      const style = getComputedStyle(link);
      return Number(style.fontWeight) <= 500 && style.color === getComputedStyle(link.parentElement!).color;
    }))
  )).toBe(true);
  await expect(page.getByRole('link', { name: 'cbox_rgb.exr', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'owl_spheres.exr', exact: true })).toHaveCount(0);
  await expect(page.getByText('Middlebury chess1', { exact: true })).toHaveCount(0);
  await expect(page.getByText('KAIST scene 27', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Brown Photostudio', { exact: true })).toHaveCount(0);
  await expect(page.getByText(MIDDLEBURY_SCENES2021_URL, { exact: true })).toHaveCount(0);
  await expect(page.getByText(KAIST_DATASET_URL, { exact: true })).toHaveCount(0);
  await expect(page.getByText(POLYHAVEN_BROWN_PHOTOSTUDIO_PAGE_URL, { exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'OpenEXR I/O guidance', level: 2 })).toBeVisible();
  await expect(page.getByText(
    'This viewer groups OpenEXR channels by exact names inside each decoded layer. Use conventional names and complete sets so the viewer can infer color, spectral series, and Stokes-derived polarization views without custom rules.',
    { exact: true }
  )).toBeVisible();
  await expect(page.getByText('R/G/B or R/G/B/A for color and alpha.', { exact: true })).toBeVisible();
  await expect(page.getByText(
    'Spectral channels should end in nm, such as 400nm, 500nm, or reflectance.500nm, so wavelength series can be sorted and grouped.',
    { exact: true }
  )).toBeVisible();
  await expect(page.getByText(
    'Stokes data should use complete matching S0/S1/S2 sets, with optional S3; suffixes and wavelengths should match across components.',
    { exact: true }
  )).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open OpenEXR I/O guidance', exact: true })).toHaveAttribute(
    'href',
    OPENEXR_IO_SKILL_URL
  );
  await expect(page.getByText('Open SKILL.md', { exact: true })).toBeVisible();

  const sectionOrder = await page.evaluate(() => {
    const downloads = document.querySelector('#downloads');
    const features = document.querySelector('#features');
    const gallery = document.querySelector('#gallery');
    const skill = document.querySelector('#openexr-io');
    if (!downloads || !features || !gallery || !skill) {
      return false;
    }
    return (
      Boolean(downloads.compareDocumentPosition(features) & Node.DOCUMENT_POSITION_FOLLOWING) &&
      Boolean(features.compareDocumentPosition(gallery) & Node.DOCUMENT_POSITION_FOLLOWING) &&
      Boolean(gallery.compareDocumentPosition(skill) & Node.DOCUMENT_POSITION_FOLLOWING)
    );
  });
  expect(sectionOrder).toBe(true);

  await page.locator('#gallery').scrollIntoViewIfNeeded();
  await expectNoHorizontalOverflow(page);
  const desktopGalleryLayout = await page.evaluate(() => {
    const galleryInner = document.querySelector('#gallery .section-inner');
    const galleryGrid = document.querySelector('.gallery-grid');
    const firstItem = document.querySelector('.gallery-item');
    const caption = firstItem?.querySelector('figcaption');
    const copy = firstItem?.querySelector('.gallery-caption-copy');
    const actions = firstItem?.querySelector('.gallery-actions');
    const frame = firstItem?.querySelector('.exr-embed-frame');
    if (
      !(galleryInner instanceof HTMLElement) ||
      !(galleryGrid instanceof HTMLElement) ||
      !(firstItem instanceof HTMLElement) ||
      !(caption instanceof HTMLElement) ||
      !(copy instanceof HTMLElement) ||
      !(actions instanceof HTMLElement) ||
      !(frame instanceof HTMLElement)
    ) {
      return false;
    }
    const innerRect = galleryInner.getBoundingClientRect();
    const gridRect = galleryGrid.getBoundingClientRect();
    const captionRect = caption.getBoundingClientRect();
    const copyRect = copy.getBoundingClientRect();
    const actionsRect = actions.getBoundingClientRect();
    const frameRect = frame.getBoundingClientRect();
    return (
      Math.abs(gridRect.width - innerRect.width) < 1 &&
      captionRect.right < frameRect.left &&
      Math.abs(captionRect.top - frameRect.top) < 12 &&
      actionsRect.top > copyRect.bottom &&
      actionsRect.right < frameRect.left &&
      frameRect.width > 760
    );
  });
  expect(desktopGalleryLayout).toBe(true);
  const embeds = page.locator('plenoview-viewer');
  await expect(embeds).toHaveCount(1);
  await expect(page.getByRole('link', { name: 'Try Web App', exact: true })).toHaveCount(6);
  await expect.poll(async () => (
    await page.locator('.gallery-item strong').evaluateAll((titles) => (
      titles.map((title) => title.textContent?.trim())
    ))
  )).toEqual([
    'Source value inspection',
    'Screenshot export',
    'Stokes vector visualization',
    'Spectral visualization',
    '3D view',
    'Panorama view',
    'HTML embed'
  ]);

  const htmlEmbedItem = page.locator('.gallery-item').filter({ hasText: 'HTML embed' });
  await expect(htmlEmbedItem).toHaveCount(1);
  await expect(htmlEmbedItem.locator('img')).toHaveCount(0);
  await expect(htmlEmbedItem.getByText(
    'Add the hosted JavaScript file and an HTML tag to publish an interactive viewer directly inside HTML pages.',
    { exact: true }
  )).toBeVisible();
  await expect(htmlEmbedItem.locator('figcaption .gallery-code-frame')).toHaveCount(1);
  await expect(htmlEmbedItem.locator('figcaption plenoview-viewer')).toHaveCount(0);
  expect(await htmlEmbedItem.evaluate((item) => {
    const caption = item.querySelector('figcaption');
    const copy = caption?.querySelector('.gallery-caption-copy');
    const code = caption?.querySelector('.gallery-code-frame');
    return Boolean(
      copy &&
      code &&
      (copy.compareDocumentPosition(code) & Node.DOCUMENT_POSITION_FOLLOWING)
    );
  })).toBe(true);
  const embedCode = htmlEmbedItem.locator('figcaption .gallery-code-frame code');
  await expect(embedCode).toContainText(
    '<script src="https://elerac.github.io/plenoview/embed/plenoview.js"></script>'
  );
  await expect(embedCode).toContainText('<plenoview-viewer');
  await expect(embedCode).toContainText('src="cbox_rgb.exr"');
  await expect(embedCode).not.toContainText('name=');
  await expect(embedCode).toContainText('height="360"');
  await expect(embedCode.locator('.syntax-tag')).toHaveCount(4);
  await expect(embedCode.locator('.syntax-attribute')).toHaveCount(3);
  await expect(embedCode.locator('.syntax-string')).toHaveCount(3);
  const liveEmbed = htmlEmbedItem.locator('.gallery-live-embed-frame plenoview-viewer');
  await expect(liveEmbed).toHaveAttribute('src', 'cbox_rgb.exr');
  await expect(liveEmbed).not.toHaveAttribute('name');
  await expect(liveEmbed).toHaveAttribute('height', '360');
  await expect(htmlEmbedItem.getByRole('link', { name: 'Open Embed Guide', exact: true })).toHaveAttribute(
    'href',
    'embed/'
  );
  await htmlEmbedItem.scrollIntoViewIfNeeded();
  const liveEmbedFrame = htmlEmbedItem.locator('plenoview-viewer iframe');
  await expect(liveEmbedFrame).toBeVisible({ timeout: 30000 });
  await expect.poll(async () => {
    const iframeSrc = await liveEmbedFrame.getAttribute('src');
    return iframeSrc ? new URL(iframeSrc, page.url()).searchParams.get('ui') : null;
  }).toBe('embed');
  const embedFrame = htmlEmbedItem.frameLocator('plenoview-viewer iframe');
  await expect(embedFrame.locator('.embed-shell')).toBeVisible({ timeout: 30000 });
  await expect(embedFrame.locator('.embed-source-label')).toBeHidden({ timeout: 30000 });

  await expectGalleryCardLaunch(page, 'Source value inspection', {
    accessibleName: /RGB OpenEXR image with a locked pixel probe and pixel rulers/,
    src: 'project-page/cbox-rgb-inspection.png'
  }, {
    src: new RegExp(`/${CBOX_RGB_URL}$`),
    state: {
      viewerMode: 'image',
      view: { zoom: 180, panX: 195.5, panY: 169.5 },
      lockedPixel: { ix: 195, iy: 169 }
    }
  });

  await expectGalleryCardLaunch(page, 'Screenshot export', {
    accessibleName: /two selected screenshot regions and R1 active/,
    src: 'project-page/spoons-screenshot-export.png'
  }, {
    src: SPOONS_LINEAR_STOKES_URL,
    state: null
  });

  await expectGalleryCardLaunch(page, 'Stokes vector visualization', {
    accessibleName: /Stokes vector image with computed AoLP and an automatically applied dedicated colormap/,
    src: 'project-page/polanalyser-stokes-aolp-y.png'
  }, {
    src: OWL_SPHERES_LINEAR_STOKES_URL,
    state: null
  });

  await expectGalleryCardLaunch(page, 'Spectral visualization', {
    accessibleName: /hyperspectral EXR data with a locked pixel probe.*spectral channel thumbnails expanded/,
    src: 'project-page/kaist-hyperspectral-inspection.png'
  }, {
    src: KAIST_SCENE27_REFLECTANCE_URL,
    state: {
      viewerMode: 'image',
      lockedPixel: { ix: 2216, iy: 1189 }
    }
  });

  await expectGalleryCardLaunch(page, '3D view', {
    accessibleName: /Plenoview 3D viewer with a position-map source/,
    src: 'project-page/middlebury-position-inspection.png'
  }, {
    src: new RegExp(`/${MIDDLEBURY_CHESS1_RGB_P_URL}$`),
    state: {
      viewerMode: '3d',
      depthChannel: '__position:P',
      depthPointSizePx: 2,
      view: { depthYawDeg: -5.3, depthPitchDeg: 0.65, depthZoom: 2 },
      lockedPixel: { ix: 406, iy: 300 }
    }
  });

  await expectGalleryCardLaunch(page, 'Panorama view', {
    accessibleName: /Plenoview panorama view with yaw 5\.37 pitch -34 and fov 180/,
    src: 'project-page/polyhaven-panorama-inspection.png'
  }, {
    src: BROWN_PHOTOSTUDIO_PANORAMA_URL,
    state: {
      viewerMode: 'panorama',
      view: { panoramaYawDeg: 5.37, panoramaPitchDeg: -34, panoramaHfovDeg: 180 }
    }
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#gallery').scrollIntoViewIfNeeded();
  const mobileGalleryOrder = await page.evaluate(() => {
    const firstItem = document.querySelector('.gallery-item:not(.gallery-item--embed-demo)');
    const copy = firstItem?.querySelector('.gallery-caption-copy');
    const frame = firstItem?.querySelector('.gallery-screenshot-frame');
    const actions = firstItem?.querySelector('.gallery-actions');
    if (
      !(firstItem instanceof HTMLElement) ||
      !(copy instanceof HTMLElement) ||
      !(frame instanceof HTMLElement) ||
      !(actions instanceof HTMLElement)
    ) {
      return false;
    }
    const itemRect = firstItem.getBoundingClientRect();
    const copyRect = copy.getBoundingClientRect();
    const frameRect = frame.getBoundingClientRect();
    const actionsRect = actions.getBoundingClientRect();
    return (
      Math.abs(copyRect.left - itemRect.left) < 1 &&
      Math.abs(frameRect.left - itemRect.left) < 1 &&
      Math.abs(actionsRect.left - itemRect.left) < 1 &&
      copyRect.bottom <= frameRect.top &&
      frameRect.bottom <= actionsRect.top
    );
  });
  expect(mobileGalleryOrder).toBe(true);
  await expect.poll(async () => (
    await preview.evaluate((image) => {
      if (!(image instanceof HTMLImageElement) || image.naturalWidth === 0 || image.naturalHeight === 0) {
        return false;
      }
      const rect = image.getBoundingClientRect();
      const naturalRatio = image.naturalWidth / image.naturalHeight;
      const renderedRatio = rect.width / rect.height;
      return getComputedStyle(image).objectFit === 'contain' && Math.abs(renderedRatio - naturalRatio) < 0.01;
    })
  )).toBe(true);
  await expectNoHorizontalOverflow(page);
  expect(unexpectedErrors).toEqual([]);
});

test('opens the RGB gallery screenshot state in the web app', async ({ page }) => {
  const unexpectedErrors = watchUnexpectedErrors(page);
  await page.goto('/');

  const rgbAppLink = page.locator('.gallery-item').first().getByRole('link', { name: 'Try Web App', exact: true });
  const popupPromise = page.waitForEvent('popup');
  await rgbAppLink.click();
  const appPage = await popupPromise;
  const appUnexpectedErrors = watchUnexpectedErrors(appPage);

  await appPage.waitForURL(/\/app\/\?/, { waitUntil: 'domcontentloaded' });
  await expect(appPage).toHaveURL(/\/app\/\?/);
  await expectViewerAppReady(appPage);

  await expect(appPage.locator('#opened-images-select option')).toHaveCount(1, { timeout: 30000 });
  await expect(appPage.locator('#opened-images-select option:checked')).toContainText('cbox_rgb.exr', {
    timeout: 30000
  });
  await expect(appPage.locator('#loading-overlay')).toBeHidden({ timeout: 30000 });
  await expect(appPage.locator('#probe-mode')).toHaveText('Locked', { timeout: 30000 });
  await expect.poll(async () => await readProbeCoords(appPage.locator('#probe-coords'))).toEqual({
    x: 195,
    y: 169
  });
  await expect(appPage.locator('#viewer-state-zoom-input')).toHaveValue('180');
  await expect(appPage.locator('#viewer-state-pan-x-input')).toHaveValue('195.5');
  await expect(appPage.locator('#viewer-state-pan-y-input')).toHaveValue('169.5');

  expect([...unexpectedErrors, ...appUnexpectedErrors]).toEqual([]);
});

test('opens the viewer app from the project page hero @smoke', async ({ page }) => {
  const unexpectedErrors = watchUnexpectedErrors(page);
  await page.goto('/');

  const heroAppLink = page.getByRole('link', { name: 'Open Web App', exact: true }).first();
  const popupPromise = page.waitForEvent('popup');
  await heroAppLink.click();
  const appPage = await popupPromise;
  const appUnexpectedErrors = watchUnexpectedErrors(appPage);

  await expect(page).toHaveURL(/\/$/);
  await expect(appPage).toHaveURL(/\/app\/$/);
  await expect(appPage.locator('head meta[name="robots"]')).toHaveAttribute('content', 'noindex,follow');
  await expectViewerAppReady(appPage);
  expect([...unexpectedErrors, ...appUnexpectedErrors]).toEqual([]);
});
