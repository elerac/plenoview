import { readFileSync } from 'node:fs';
import { expect, test, type Page } from './helpers/test';

const EXPECTED_BOOTSTRAP_ABORT = 'Viewer application has not finished initializing.';
const EMBED_GUIDE_TITLE = 'Prismifold Embed Guide | OpenEXR Image Viewer';
const EMBED_GUIDE_DESCRIPTION =
  'Embed Prismifold OpenEXR viewers in HTML pages with the prismifold-viewer web component, declarative attributes, deferred loading, channel panels, and the JavaScript API.';
const EMBED_GUIDE_URL = 'https://elerac.github.io/prismifold/embed/';
const POLYHAVEN_BROWN_PHOTOSTUDIO_URL =
  'https://dl.polyhaven.org/file/ph-assets/HDRIs/exr/1k/brown_photostudio_02_1k.exr';
const POLYHAVEN_BROWN_PHOTOSTUDIO_NAME = 'Poly Haven Brown Photostudio 02';
const CBOX_RGB_EXR_FIXTURE = readFileSync(new URL('../public/cbox_rgb.exr', import.meta.url));
const EMPTY_EMBED_SCRIPT_ROUTE = '**/prismifold.js';
const LIVE_EMBED_TIMEOUT = 60000;

const EXAMPLE_TITLE_IDS = {
  basic: 'basic-embed-title',
  channels: 'channels-embed-title',
  panorama: 'panorama-embed-title',
  threeD: 'three-d-embed-title',
  deferred: 'deferred-embed-title',
  javascriptApi: 'javascript-api-title'
} as const;

const EXPECTED_NAV_LINKS = [
  { text: 'Project', href: '../' },
  { text: 'Examples', href: '#examples' },
  { text: 'Attributes', href: '#attributes' },
  { text: 'API', href: '#javascript-api' },
  { text: 'GitHub', href: 'https://github.com/elerac/prismifold' }
] as const;

const ATTRIBUTE_LABELS = [
  'src',
  'name',
  'width',
  'height',
  'view',
  'bottom-panel',
  'panorama-auto-rotate',
  'panorama-rotation-speed',
  'three-d-auto-orbit',
  'three-d-orbit-speed',
  'three-d-orbit-yaw',
  'three-d-orbit-pitch',
  'auto-load',
  'viewer-url',
  'source-origin'
] as const;

const METHOD_LABELS = [
  'loadUrl(src, options)',
  'loadFile(file, options)',
  'setView(view)',
  'setPanoramaAutoRotate(enabled)',
  'setPanoramaRotationSpeed(speed)',
  'setThreeDAutoOrbit(enabled)',
  'setThreeDOrbitSpeed(speed)',
  'setThreeDOrbitYaw(yaw)',
  'setThreeDOrbitPitch(pitch)',
  'destroy()'
] as const;

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

function embedExample(page: Page, titleId: string) {
  return page.locator(`section[aria-labelledby="${titleId}"]`);
}

function embedExampleCode(page: Page, titleId: string) {
  return embedExample(page, titleId).locator('.gallery-code-frame code');
}

function embedExampleFrame(page: Page, titleId: string) {
  return embedExample(page, titleId).frameLocator('prismifold-viewer iframe');
}

async function expectSiteNavLinks(page: Page): Promise<void> {
  const navLinks = page.locator('.site-nav a');
  await expect(navLinks).toHaveCount(EXPECTED_NAV_LINKS.length);
  const actualLinks = await navLinks.evaluateAll((links) => links.map((link) => ({
    text: link.textContent?.trim() ?? '',
    href: link.getAttribute('href') ?? ''
  })));
  expect(actualLinks).toEqual(EXPECTED_NAV_LINKS);
}

async function expectReferenceLabels(page: Page, tableSelector: string, expectedLabels: readonly string[]): Promise<void> {
  const table = page.locator(tableSelector);
  await expect(table).toBeVisible();
  const cellTexts = await table.locator('[role="cell"]').evaluateAll((cells) => (
    cells.map((cell) => cell.textContent?.trim() ?? '')
  ));
  for (const label of expectedLabels) {
    expect(cellTexts).toContain(label);
  }
}

async function expectEmbedIframeUiMode(page: Page, titleId: string): Promise<URL> {
  const example = embedExample(page, titleId);
  await expect(example).toHaveCount(1);
  const iframe = example.locator('prismifold-viewer iframe');
  await expect(iframe).toBeVisible({ timeout: LIVE_EMBED_TIMEOUT });
  const src = await iframe.getAttribute('src');
  if (!src) {
    throw new Error(`Expected iframe src for ${titleId}.`);
  }
  const url = new URL(src, page.url());
  expect(url.searchParams.get('ui')).toBe('embed');
  return url;
}

test('serves the embed guide static content and reference docs @smoke', async ({ page }) => {
  await page.route(EMPTY_EMBED_SCRIPT_ROUTE, async (route) => {
    await route.fulfill({
      contentType: 'application/javascript',
      body: ''
    });
  });
  await page.goto('/embed/', { waitUntil: 'domcontentloaded' });

  await expect(page).toHaveTitle(EMBED_GUIDE_TITLE);
  await expect(page.locator('head meta[name="description"]')).toHaveAttribute('content', EMBED_GUIDE_DESCRIPTION);
  await expect(page.locator('head meta[name="robots"]')).toHaveAttribute('content', 'index,follow');
  await expect(page.locator('head link[rel="canonical"]')).toHaveAttribute('href', EMBED_GUIDE_URL);
  await expect(page.locator('head link[rel="icon"]')).toHaveAttribute('href', '../project-page/app-icon.png');
  await expect(page.locator('head meta[property="og:url"]')).toHaveAttribute('content', EMBED_GUIDE_URL);

  await expect(page.locator('#embed-hero-title')).toHaveText('Embed Prismifold');
  await expectSiteNavLinks(page);
  await expect(page.locator('.hero-lede')).toContainText(
    'Publish interactive OpenEXR inspection directly inside documentation, papers, datasets, and project pages.',
  );
  await expectNoHorizontalOverflow(page);

  await expect(page.locator('#examples-title')).toHaveText('Embed examples');
  await expect(page.locator(`#${EXAMPLE_TITLE_IDS.basic}`)).toHaveText('Basic custom element');
  await expect(page.locator(`#${EXAMPLE_TITLE_IDS.channels}`)).toHaveText('Named source with channel panel');
  await expect(page.locator(`#${EXAMPLE_TITLE_IDS.panorama}`)).toHaveText('Panorama view');
  await expect(page.locator(`#${EXAMPLE_TITLE_IDS.threeD}`)).toHaveText('3D view');
  await expect(page.locator(`#${EXAMPLE_TITLE_IDS.deferred}`)).toHaveText('Deferred loading');
  await expect(page.locator(`#${EXAMPLE_TITLE_IDS.javascriptApi}`)).toHaveText('JavaScript API and local files');

  const basicCode = embedExampleCode(page, EXAMPLE_TITLE_IDS.basic);
  await expect(basicCode).toContainText(
    '<script src="https://elerac.github.io/prismifold/embed/prismifold.js"></script>'
  );
  await expect(basicCode).toContainText('<prismifold-viewer');
  await expect(basicCode).toContainText('src="../cbox_rgb.exr"');
  await expect(basicCode).toContainText('height="340"');

  const channelsCode = embedExampleCode(page, EXAMPLE_TITLE_IDS.channels);
  await expect(channelsCode).toContainText('name="Cornell Box RGB"');
  await expect(channelsCode).toContainText('bottom-panel="channels"');

  const panoramaCode = embedExampleCode(page, EXAMPLE_TITLE_IDS.panorama);
  await expect(panoramaCode).toContainText(`src="${POLYHAVEN_BROWN_PHOTOSTUDIO_URL}"`);
  await expect(panoramaCode).toContainText(`name="${POLYHAVEN_BROWN_PHOTOSTUDIO_NAME}"`);
  await expect(panoramaCode).toContainText('view="panorama"');
  await expect(panoramaCode).toContainText('panorama-auto-rotate="true"');
  await expect(panoramaCode).toContainText('panorama-rotation-speed="6"');
  await expect(panoramaCode).toContainText('bottom-panel="none"');
  await expect(panoramaCode).toContainText('source-origin="viewer"');

  const threeDCode = embedExampleCode(page, EXAMPLE_TITLE_IDS.threeD);
  await expect(threeDCode).toContainText('src="../middlebury_chess1_rgb_p.exr"');
  await expect(threeDCode).toContainText('name="Middlebury RGB + Position"');
  await expect(threeDCode).toContainText('view="3d"');
  await expect(threeDCode).toContainText('three-d-auto-orbit="true"');
  await expect(threeDCode).toContainText('bottom-panel="none"');
  await expect(threeDCode).toContainText('source-origin="viewer"');

  const deferredCode = embedExampleCode(page, EXAMPLE_TITLE_IDS.deferred);
  await expect(deferredCode).toContainText('auto-load="false"');
  await expect(deferredCode).toContainText('name="Deferred Cornell Box"');

  const apiCode = embedExampleCode(page, EXAMPLE_TITLE_IDS.javascriptApi);
  await expect(apiCode).toContainText('window.Prismifold.create("#prismifold-js-example"');
  await expect(apiCode).toContainText('controller.loadUrl("../cbox_rgb.exr"');
  await expect(apiCode).toContainText('controller.loadFile(file');

  await expect(page.locator('#attributes-title')).toHaveText('Element attributes');
  await expectReferenceLabels(page, '[role="table"][aria-label="prismifold-viewer attributes"]', ATTRIBUTE_LABELS);
  await expect(page.locator('#methods-title')).toHaveText('JavaScript methods');
  const methodsTableSelector = '[role="table"][aria-label="Prismifold JavaScript methods"]';
  await expectReferenceLabels(page, methodsTableSelector, METHOD_LABELS);
  await expect(page.locator(methodsTableSelector).locator('.feature-card')).toHaveCount(0);
  await expect(page.locator('prismifold-viewer iframe')).toHaveCount(0);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#examples').scrollIntoViewIfNeeded();
  await expectNoHorizontalOverflow(page);
  const mobileExampleLayout = await page.evaluate(() => {
    const firstExample = document.querySelector('.embed-example');
    const copy = firstExample?.querySelector('.embed-example-copy');
    const view = firstExample?.querySelector('.embed-example-view');
    if (
      !(firstExample instanceof HTMLElement) ||
      !(copy instanceof HTMLElement) ||
      !(view instanceof HTMLElement)
    ) {
      return false;
    }
    const itemRect = firstExample.getBoundingClientRect();
    const copyRect = copy.getBoundingClientRect();
    const viewRect = view.getBoundingClientRect();
    return (
      Math.abs(copyRect.left - itemRect.left) < 1 &&
      Math.abs(viewRect.left - itemRect.left) < 1 &&
      copyRect.bottom <= viewRect.top
    );
  });
  expect(mobileExampleLayout).toBe(true);
  await expectNoHorizontalOverflow(page);
});

test('renders the embed guide live examples @smoke', async ({ page }) => {
  test.setTimeout(180000);
  const unexpectedErrors = watchUnexpectedErrors(page);
  await page.route(POLYHAVEN_BROWN_PHOTOSTUDIO_URL, async (route) => {
    await route.fulfill({
      contentType: 'application/octet-stream',
      body: CBOX_RGB_EXR_FIXTURE
    });
  });
  await page.goto('/embed/', { waitUntil: 'domcontentloaded' });

  await expect(page.locator('prismifold-viewer')).toHaveCount(6, { timeout: LIVE_EMBED_TIMEOUT });
  await expect(page.locator('prismifold-viewer iframe')).toHaveCount(6, { timeout: LIVE_EMBED_TIMEOUT });
  await expectEmbedIframeUiMode(page, EXAMPLE_TITLE_IDS.basic);
  const channelsUrl = await expectEmbedIframeUiMode(page, EXAMPLE_TITLE_IDS.channels);
  expect(channelsUrl.searchParams.get('bottomPanel')).toBe('channels');
  expect(channelsUrl.searchParams.get('name')).toBe('Cornell Box RGB');
  const panoramaUrl = await expectEmbedIframeUiMode(page, EXAMPLE_TITLE_IDS.panorama);
  expect(panoramaUrl.searchParams.get('src')).toBe(POLYHAVEN_BROWN_PHOTOSTUDIO_URL);
  expect(panoramaUrl.searchParams.get('view')).toBe('panorama');
  expect(panoramaUrl.searchParams.get('panoramaAutoRotate')).toBe('true');
  expect(panoramaUrl.searchParams.get('panoramaRotationSpeed')).toBe('6');
  expect(panoramaUrl.searchParams.get('bottomPanel')).toBe('none');
  expect(panoramaUrl.searchParams.get('name')).toBe(POLYHAVEN_BROWN_PHOTOSTUDIO_NAME);
  const threeDUrl = await expectEmbedIframeUiMode(page, EXAMPLE_TITLE_IDS.threeD);
  expect(threeDUrl.searchParams.get('src')).toBe('../middlebury_chess1_rgb_p.exr');
  expect(threeDUrl.searchParams.get('view')).toBe('3d');
  expect(threeDUrl.searchParams.get('threeDAutoOrbit')).toBe('true');
  expect(threeDUrl.searchParams.get('threeDOrbitSpeed')).toBe('6');
  expect(threeDUrl.searchParams.get('threeDOrbitYaw')).toBe('12');
  expect(threeDUrl.searchParams.get('threeDOrbitPitch')).toBe('2');
  expect(threeDUrl.searchParams.get('bottomPanel')).toBe('none');
  expect(threeDUrl.searchParams.get('name')).toBe('Middlebury RGB + Position');
  const deferredUrl = await expectEmbedIframeUiMode(page, EXAMPLE_TITLE_IDS.deferred);
  expect(deferredUrl.searchParams.get('autoLoad')).toBe('false');
  expect(deferredUrl.searchParams.get('name')).toBe('Deferred Cornell Box');

  await expect(embedExampleFrame(page, EXAMPLE_TITLE_IDS.panorama).locator('.embed-shell')).toBeVisible({
    timeout: LIVE_EMBED_TIMEOUT
  });
  await expect(embedExampleFrame(page, EXAMPLE_TITLE_IDS.threeD).locator('.embed-shell')).toBeVisible({
    timeout: LIVE_EMBED_TIMEOUT
  });

  const channelsFrame = embedExampleFrame(page, EXAMPLE_TITLE_IDS.channels);
  await expect(channelsFrame.locator('.embed-channel-panel [role="option"]').first()).toBeVisible({
    timeout: LIVE_EMBED_TIMEOUT
  });

  const deferredFrame = embedExampleFrame(page, EXAMPLE_TITLE_IDS.deferred);
  const deferredLoadButton = deferredFrame.locator('.embed-deferred-load-button');
  await expect(deferredLoadButton).toBeVisible({
    timeout: LIVE_EMBED_TIMEOUT
  });
  await deferredLoadButton.click();
  await expect(deferredFrame.locator('.embed-source-label')).toContainText('Deferred Cornell Box', {
    timeout: LIVE_EMBED_TIMEOUT
  });

  await expect(page.locator('#embed-js-load-sample-button')).toBeVisible();
  await expect(page.locator('#embed-js-file-input')).toBeAttached();
  await expect(page.locator('#embed-js-status')).toContainText('Loaded Cornell Box RGB.', {
    timeout: LIVE_EMBED_TIMEOUT
  });
  const jsApiFrame = embedExampleFrame(page, EXAMPLE_TITLE_IDS.javascriptApi);
  await expect(jsApiFrame.locator('.embed-channel-panel [role="option"]').first()).toBeVisible({
    timeout: LIVE_EMBED_TIMEOUT
  });
  await page.locator('#embed-js-load-sample-button').click();
  await expect(page.locator('#embed-js-status')).toContainText('Loaded Cornell Box RGB.', {
    timeout: LIVE_EMBED_TIMEOUT
  });

  expect(unexpectedErrors).toEqual([]);
});
