#!/usr/bin/env node

import { chromium } from '@playwright/test';
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const distDir = resolve(repoRoot, 'dist');
const distIndex = resolve(distDir, 'index.html');
const distAppIndex = resolve(distDir, 'app', 'index.html');
const defaultOutputDir = resolve(repoRoot, 'public', 'project-page');
const host = '127.0.0.1';
const port = Number(process.env.PROJECT_PAGE_CAPTURE_PORT ?? 4175);
const appPath = normalizePath(process.env.PLAYWRIGHT_APP_PATH ?? '/plenoview/app/');
const siteBasePath = resolveSiteBasePath(appPath);
const appUrl = `http://${host}:${port}${appPath}`;
const siteBaseUrl = `http://${host}:${port}${siteBasePath}`;
const viewerTimeoutMs = Number(process.env.PROJECT_PAGE_CAPTURE_TIMEOUT_MS ?? 120000);
const renderSettleMs = Number(process.env.PROJECT_PAGE_CAPTURE_SETTLE_MS ?? 250);
const args = parseArgs(process.argv.slice(2));
const outputDir = resolve(repoRoot, args.outDir ?? defaultOutputDir);
const colormapIdsByLabel = readColormapIdsByLabel();
const scenes = createScenes();
const selectedScenes = filterScenes(scenes, args.only);

if (args.help) {
  printHelp();
  process.exit(0);
}
if (!existsSync(distIndex)) {
  throw new Error('dist/index.html was not found. Run `npm run build:e2e` before capturing project-page screenshots.');
}
if (!existsSync(distAppIndex)) {
  throw new Error('dist/app/index.html was not found. Run `npm run build:e2e` before capturing project-page screenshots.');
}

mkdirSync(outputDir, { recursive: true });

const server = createStaticServer();

try {
  await startServer(server);
  console.log(`Serving ${distDir} at http://${host}:${port}${siteBasePath}`);
  console.log(`Capturing ${selectedScenes.length} project-page screenshot(s) into ${outputDir}`);
  await captureScenes(selectedScenes);
} finally {
  await stopServer(server);
}

function createScenes() {
  const hsvColormapId = requireColormapId('HSV');
  const rdBuColormapId = requireColormapId('RdBu');
  const heroState = {
    viewerMode: 'image',
    view: { zoom: 2.8, panX: 128, panY: 128 }
  };
  const rgbState = {
    viewerMode: 'image',
    view: { zoom: 180, panX: 195.5, panY: 169.5 },
    lockedPixel: { ix: 195, iy: 169 }
  };
  const spoonsState = {
    viewerMode: 'image',
    visualizationMode: 'colormap',
    activeColormapId: rdBuColormapId,
    displaySelection: {
      kind: 'stokesScalar',
      parameter: 's2_over_s0',
      source: { kind: 'scalar', suffix: 'Y' }
    },
    colormapRange: { min: -1, max: 1 },
    colormapZeroCentered: true,
    view: { zoom: 0.378, panX: 1224, panY: 1024 }
  };
  const stokesState = {
    viewerMode: 'image',
    visualizationMode: 'colormap',
    activeColormapId: hsvColormapId,
    displaySelection: {
      kind: 'stokesAngle',
      parameter: 'aolp',
      source: { kind: 'scalar', suffix: 'Y' }
    },
    colormapRange: { min: 0, max: Math.PI },
    colormapZeroCentered: false
  };
  const hyperspectralState = {
    viewerMode: 'image',
    lockedPixel: { ix: 2216, iy: 1189 }
  };
  const depthState = {
    viewerMode: '3d',
    depthChannel: '__position:P',
    depthPointSizePx: 2,
    view: { depthYawDeg: -5.3, depthPitchDeg: 0.65, depthZoom: 2 },
    lockedPixel: { ix: 406, iy: 300 }
  };
  const panoramaState = {
    viewerMode: 'panorama',
    view: { panoramaYawDeg: 5.37, panoramaPitchDeg: -34, panoramaHfovDeg: 180 }
  };

  return [
    {
      id: 'hero',
      aliases: ['app-preview', 'preview'],
      output: 'app-preview.jpg',
      viewport: { width: 1440, height: 900 },
      expectedImageName: 'cbox_rgb.exr',
      src: localAssetUrl('cbox_rgb.exr'),
      state: heroState,
      screenshot: { type: 'jpeg', quality: 88 }
    },
    {
      id: 'rgb',
      aliases: ['cbox', 'source'],
      output: 'cbox-rgb-inspection.png',
      viewport: { width: 1440, height: 900 },
      expectedImageName: 'cbox_rgb.exr',
      src: localAssetUrl('cbox_rgb.exr'),
      state: rgbState,
      initStorage: { rulers: true },
      prepare: async (page) => {
        await setPanelCollapsed(page, '#image-panel-collapse-button', true);
        await setPanelCollapsed(page, '#bottom-panel-collapse-button', true);
        await setPanelCollapsed(page, '#right-panel-collapse-button', false);
      }
    },
    {
      id: 'spoons',
      aliases: ['screenshot', 'export'],
      output: 'spoons-screenshot-export.png',
      viewport: { width: 2048, height: 1024 },
      expectedImageName: 'spoons.exr',
      src: 'https://huggingface.co/datasets/elerac/polanalyser/resolve/main/data/stokes/imx250mzr/stokes/spoons.exr',
      state: spoonsState,
      waitAfterPrepare: false,
      prepare: async (page) => {
        await reselectColormap(page, rdBuColormapId);
        await openScreenshotSelection(page);
        await waitForRenderIdle(page);
        await positionScreenshotRegions(page, {
          active: { x: 875, y: 205, width: 122, height: 124 },
          inactive: { x: 913, y: 525, width: 363, height: 315 },
          controls: { x: 573, y: 340 }
        });
        await assertScreenshotRegionLayout(page, {
          active: { x: 875, y: 205, width: 122, height: 124 },
          inactive: { x: 913, y: 525, width: 363, height: 315 },
          controls: { x: 573, y: 340 }
        });
      }
    },
    {
      id: 'stokes',
      aliases: ['polarization'],
      output: 'polanalyser-stokes-aolp-y.png',
      viewport: { width: 1440, height: 900 },
      expectedImageName: 'owl_spheres.exr',
      src: 'https://huggingface.co/datasets/elerac/polanalyser/resolve/main/data/stokes/imx250mzr/stokes/owl_spheres.exr',
      state: stokesState,
      prepare: async (page) => {
        await reselectColormap(page, hsvColormapId);
        await page.mouse.move(24, 24);
      }
    },
    {
      id: 'hyperspectral',
      aliases: ['kaist'],
      output: 'kaist-hyperspectral-inspection.png',
      viewport: { width: 1440, height: 900 },
      expectedImageName: 'scene27_reflectance.exr',
      src: 'https://huggingface.co/datasets/danaroth/kaist-hyperspectral/resolve/main/exr/scene27_reflectance.exr',
      state: hyperspectralState,
      prepare: async (page) => {
        await setCollapsibleExpanded(page, '#display-control-toggle', false);
        await expandSpectralThumbnailStack(page);
      }
    },
    {
      id: 'depth',
      aliases: ['middlebury'],
      output: 'middlebury-position-inspection.png',
      viewport: { width: 1440, height: 900 },
      expectedImageName: 'middlebury_chess1_rgb_p.exr',
      src: localAssetUrl('middlebury_chess1_rgb_p.exr'),
      state: depthState
    },
    {
      id: 'panorama',
      aliases: ['polyhaven'],
      output: 'polyhaven-panorama-inspection.png',
      viewport: { width: 1440, height: 900 },
      expectedImageName: 'brown_photostudio_02_1k.exr',
      src: 'https://dl.polyhaven.org/file/ph-assets/HDRIs/exr/1k/brown_photostudio_02_1k.exr',
      state: panoramaState
    }
  ];
}

async function captureScenes(sceneList) {
  const browser = await chromium.launch({
    args: [
      '--enable-webgl',
      '--enable-unsafe-swiftshader',
      '--ignore-gpu-blocklist',
      '--use-angle=swiftshader'
    ]
  });

  try {
    for (const scene of sceneList) {
      await captureScene(browser, scene);
    }
  } finally {
    await browser.close();
  }
}

async function captureScene(browser, scene) {
  const outputPath = resolve(outputDir, scene.output);
  const pageErrors = [];
  const consoleErrors = [];
  const page = await browser.newPage({
    viewport: scene.viewport,
    deviceScaleFactor: 1
  });

  page.on('pageerror', (error) => {
    if (!error.message.includes('Viewer application has not finished initializing.')) {
      pageErrors.push(error.message);
    }
  });
  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text());
    }
  });

  try {
    await page.addInitScript((storage) => {
      window.localStorage.clear();
      window.sessionStorage.clear();
      if (storage.rulers) {
        window.localStorage.setItem('plenoview:rulers-visible:v1', 'true');
      }
    }, scene.initStorage ?? {});

    const url = buildViewerUrl(scene.src, scene.state);
    console.log(`Capturing ${scene.id}: ${url}`);
    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: viewerTimeoutMs
    });

    await waitForAppReady(page);
    await waitForViewerReady(page, scene.expectedImageName);
    await waitForRenderIdle(page);
    if (scene.prepare) {
      await scene.prepare(page);
      if (scene.waitAfterPrepare !== false) {
        await waitForRenderIdle(page);
      }
    }
    await waitForNextPaint(page);
    await page.waitForTimeout(renderSettleMs);

    await assertNoAppErrors(page, scene.id);
    if (pageErrors.length > 0) {
      throw new Error(`Page error while capturing ${scene.id}:\n${pageErrors.join('\n')}`);
    }
    if (consoleErrors.length > 0) {
      throw new Error(`Console error while capturing ${scene.id}:\n${consoleErrors.join('\n')}`);
    }

    await page.screenshot({
      path: outputPath,
      type: 'png',
      fullPage: false,
      ...(scene.screenshot ?? {})
    });

    const dimensions = readImageDimensions(outputPath);
    if (dimensions.width !== scene.viewport.width || dimensions.height !== scene.viewport.height) {
      throw new Error(
        `Expected ${scene.output} to be ${scene.viewport.width}x${scene.viewport.height}, ` +
        `got ${dimensions.width}x${dimensions.height}.`
      );
    }
    const { size } = statSync(outputPath);
    console.log(`Saved ${outputPath} (${dimensions.width}x${dimensions.height}, ${size} bytes)`);
  } finally {
    await page.close();
  }
}

async function waitForAppReady(page) {
  const usedHook = await page.evaluate(async () => {
    const hooks = window.__openExrViewerE2E;
    if (!hooks) {
      return false;
    }
    await hooks.waitForAppReady();
    return true;
  });
  if (usedHook) {
    return;
  }

  const deadline = Date.now() + viewerTimeoutMs;
  let lastState = null;
  while (Date.now() < deadline) {
    const state = await readViewerState(page);
    if (state.errorText) {
      throw new Error(`The viewer failed before capture: ${state.errorText}`);
    }
    if (state.hasGalleryButton && state.canvasWidth > 0 && state.canvasHeight > 0) {
      return;
    }
    lastState = state;
    await waitMs(250);
  }

  throw new Error(`Timed out waiting for the app shell. Last state: ${JSON.stringify(lastState)}`);
}

async function waitForViewerReady(page, expectedImageName) {
  const deadline = Date.now() + viewerTimeoutMs;
  let lastState = null;
  while (Date.now() < deadline) {
    const state = await readViewerState(page);
    if (state.errorText) {
      throw new Error(`The viewer failed before capture: ${state.errorText}`);
    }
    const hasImage = state.options.some((option) => option.includes(expectedImageName));
    if (!state.loading && hasImage && state.canvasWidth > 0 && state.canvasHeight > 0) {
      return;
    }
    lastState = state;
    await waitMs(250);
  }

  throw new Error(`Timed out waiting for ${expectedImageName}. Last state: ${JSON.stringify(lastState)}`);
}

async function waitForRenderIdle(page) {
  const usedHook = await page.evaluate(async () => {
    const hooks = window.__openExrViewerE2E;
    if (!hooks) {
      return false;
    }
    await hooks.waitForRenderIdle();
    await hooks.waitForThumbnailIdle();
    await hooks.waitForFrames(2);
    return true;
  });
  if (!usedHook) {
    await waitForNextPaint(page);
  }
}

async function readViewerState(page) {
  return await page.evaluate(() => {
    const errorBanner = document.querySelector('#error-banner');
    const errorText =
      errorBanner instanceof HTMLElement && !errorBanner.classList.contains('hidden')
        ? (errorBanner.textContent ?? '').trim()
        : '';
    const galleryButton = document.querySelector('#gallery-menu-button');
    const loadingOverlay = document.querySelector('#loading-overlay');
    const canvas = document.querySelector('#gl-canvas');
    const options = Array.from(document.querySelectorAll('#opened-images-select option')).map((option) =>
      (option.textContent ?? '').trim()
    );

    return {
      errorText,
      hasGalleryButton: galleryButton instanceof HTMLButtonElement,
      loading: loadingOverlay ? !loadingOverlay.classList.contains('hidden') : true,
      canvasWidth: canvas instanceof HTMLCanvasElement ? canvas.width : 0,
      canvasHeight: canvas instanceof HTMLCanvasElement ? canvas.height : 0,
      options
    };
  });
}

async function assertNoAppErrors(page, sceneId) {
  const errorText = await page.evaluate(() => {
    const errorBanner = document.querySelector('#error-banner');
    return errorBanner instanceof HTMLElement && !errorBanner.classList.contains('hidden')
      ? (errorBanner.textContent ?? '').trim()
      : '';
  });
  if (errorText) {
    throw new Error(`The viewer reported an error while capturing ${sceneId}: ${errorText}`);
  }
}

async function setPanelCollapsed(page, buttonSelector, collapsed) {
  const button = page.locator(buttonSelector);
  await button.waitFor({ state: 'visible', timeout: 30000 });
  const expanded = await button.getAttribute('aria-expanded');
  const isCollapsed = expanded === 'false';
  if (isCollapsed !== collapsed) {
    await button.click();
    await waitForNextPaint(page);
  }
}

async function setCollapsibleExpanded(page, toggleSelector, expanded) {
  const toggle = page.locator(toggleSelector);
  await toggle.waitFor({ state: 'visible', timeout: 30000 });
  const isExpanded = (await toggle.getAttribute('aria-expanded')) === 'true';
  if (isExpanded !== expanded) {
    await toggle.click();
    await waitForNextPaint(page);
  }
}

async function reselectColormap(page, colormapId) {
  const select = page.locator('#colormap-select');
  await select.waitFor({ state: 'visible', timeout: 30000 });
  const optionValues = await select.evaluate((element) => {
    if (!(element instanceof HTMLSelectElement)) {
      throw new Error('The colormap select was not ready.');
    }
    if (element.disabled) {
      throw new Error('The colormap select was disabled.');
    }
    return Array.from(element.options).map((option) => ({
      label: (option.textContent ?? '').trim(),
      value: option.value
    }));
  });
  const noneValue = optionValues.find((option) => option.label === 'None')?.value;
  if (!noneValue) {
    throw new Error('Could not find the None colormap option.');
  }
  if (!optionValues.some((option) => option.value === colormapId)) {
    throw new Error(`Could not find colormap option "${colormapId}".`);
  }

  await select.selectOption(noneValue);
  await waitForRenderIdle(page);
  await select.selectOption(colormapId);
  await waitForRenderIdle(page);
}

async function openScreenshotSelection(page) {
  await page.getByRole('button', { name: 'File', exact: true }).click();
  await page.locator('#export-screenshot-button').click();
  await page.locator('#screenshot-selection-overlay').waitFor({ state: 'visible', timeout: 30000 });
  await page.locator('#screenshot-selection-add-button').click();
  await page.locator('.screenshot-selection-region-box').waitFor({ state: 'visible', timeout: 30000 });
  await page.locator('#screenshot-selection-box').waitFor({ state: 'visible', timeout: 30000 });
}

async function positionScreenshotRegions(page, layout) {
  await page.evaluate(({ active, inactive, controls }) => {
    const overlay = document.querySelector('#screenshot-selection-overlay');
    if (!(overlay instanceof HTMLElement)) {
      throw new Error('Screenshot selection overlay was not ready for deterministic positioning.');
    }
    const hooks = window.__openExrViewerE2E;
    if (!hooks?.setScreenshotSelectionRegions) {
      throw new Error('Plenoview E2E screenshot selection hooks were not available.');
    }

    const overlayRect = overlay.getBoundingClientRect();
    const activeLocal = toLocalRect(active);
    const inactiveLocal = toLocalRect(inactive);
    hooks.setScreenshotSelectionRegions([activeLocal, inactiveLocal], 0);

    const controlsElement = document.querySelector('#screenshot-selection-controls');
    if (!(controlsElement instanceof HTMLElement)) {
      throw new Error('Screenshot selection controls were not ready for deterministic positioning.');
    }

    const controlsLocal = {
      x: controls.x - overlayRect.left,
      y: controls.y - overlayRect.top
    };
    const styleId = 'project-page-capture-screenshot-selection-layout';
    document.getElementById(styleId)?.remove();
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      #screenshot-selection-controls {
        left: ${controlsLocal.x}px !important;
        top: ${controlsLocal.y}px !important;
      }
    `;
    document.head.append(style);

    controlsElement.style.left = `${controlsLocal.x}px`;
    controlsElement.style.top = `${controlsLocal.y}px`;

    function toLocalRect(rect) {
      return {
        x: rect.x - overlayRect.left,
        y: rect.y - overlayRect.top,
        width: rect.width,
        height: rect.height
      };
    }
  }, layout);
  await waitForNextPaint(page);
}

async function assertScreenshotRegionLayout(page, expected) {
  const actual = await page.evaluate(() => {
    const activeBox = document.querySelector('#screenshot-selection-box');
    const inactiveBoxes = Array.from(document.querySelectorAll('.screenshot-selection-region-box'));
    const controls = document.querySelector('#screenshot-selection-controls');
    if (
      !(activeBox instanceof HTMLElement) ||
      inactiveBoxes.length !== 1 ||
      !(inactiveBoxes[0] instanceof HTMLElement) ||
      !(controls instanceof HTMLElement)
    ) {
      throw new Error('Screenshot selection overlay did not render the expected two-region layout.');
    }

    return {
      active: readRect(activeBox),
      inactive: readRect(inactiveBoxes[0]),
      controls: readRect(controls),
      activeBadge: (activeBox.querySelector('.screenshot-selection-region-badge')?.textContent ?? '').trim(),
      inactiveBadge: (inactiveBoxes[0].querySelector('.screenshot-selection-region-badge')?.textContent ?? '').trim()
    };

    function readRect(element) {
      const rect = element.getBoundingClientRect();
      return {
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height
      };
    }
  });

  if (actual.activeBadge !== '1' || actual.inactiveBadge !== '2') {
    throw new Error(
      `Expected screenshot region badges 1 and 2, got ${actual.activeBadge} and ${actual.inactiveBadge}.`
    );
  }
  assertRectClose('active screenshot region', actual.active, expected.active, 2);
  assertRectClose('inactive screenshot region', actual.inactive, expected.inactive, 2);
  assertPointClose('screenshot selection controls', actual.controls, expected.controls, 2);
}

function assertRectClose(name, actual, expected, tolerance) {
  for (const key of ['x', 'y', 'width', 'height']) {
    assertClose(`${name} ${key}`, actual[key], expected[key], tolerance);
  }
}

function assertPointClose(name, actual, expected, tolerance) {
  for (const key of ['x', 'y']) {
    assertClose(`${name} ${key}`, actual[key], expected[key], tolerance);
  }
}

function assertClose(name, actual, expected, tolerance) {
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(`Expected ${name} to be ${expected} +/- ${tolerance}, got ${actual}.`);
  }
}

async function expandSpectralThumbnailStack(page) {
  const expanded = await page.evaluate(() => {
    const toggles = Array.from(document.querySelectorAll('.channel-thumbnail-stack-toggle'));
    const toggle = toggles.find((candidate) => {
      const text = (candidate.textContent ?? '').trim();
      const stack = candidate.closest('.channel-thumbnail-stack');
      const stackText = stack?.textContent ?? '';
      return text === '31' || /Spectral/i.test(stackText);
    });
    if (!(toggle instanceof HTMLElement)) {
      return false;
    }
    if (toggle.getAttribute('aria-expanded') !== 'true') {
      toggle.click();
    }
    return true;
  });
  if (!expanded) {
    throw new Error('Could not find the hyperspectral Spectral thumbnail stack toggle.');
  }
  await waitForRenderIdle(page);
}

async function waitForNextPaint(page) {
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(resolve);
        });
      })
  );
}

function buildViewerUrl(src, state) {
  const url = new URL(appUrl);
  url.searchParams.set('src', src);
  const encodedState = encodeViewerState(state);
  if (encodedState) {
    url.searchParams.set('state', encodedState);
  }
  return url.toString();
}

function encodeViewerState(state) {
  if (!state) {
    return null;
  }
  return encodeURIComponent(JSON.stringify(state));
}

function localAssetUrl(path) {
  return new URL(path, siteBaseUrl).toString();
}

function createStaticServer() {
  return createServer((request, response) => {
    if (!request.url) {
      sendText(response, 400, 'Missing request URL');
      return;
    }

    const url = new URL(request.url, appUrl);
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.setHeader('Allow', 'GET, HEAD');
      sendText(response, 405, 'Method not allowed');
      return;
    }

    const filePath = resolveStaticPath(url.pathname);
    if (!filePath) {
      sendText(response, 403, `Forbidden: ${url.pathname}`);
      return;
    }

    if (!existsSync(filePath) || !statSync(filePath).isFile()) {
      sendText(response, 404, `Not found: ${url.pathname}`);
      return;
    }

    response.statusCode = 200;
    response.setHeader('Content-Type', contentTypeFor(filePath));

    if (request.method === 'HEAD') {
      response.end();
      return;
    }

    createReadStream(filePath).pipe(response);
  });
}

function resolveStaticPath(pathname) {
  const decodedPath = decodeURIComponent(pathname);
  const pathWithinDist = toDistRelativePath(decodedPath);
  const normalizedRelativePath = pathWithinDist === '' ? 'index.html' : pathWithinDist;
  const filePath = resolve(distDir, normalizedRelativePath);

  if (filePath !== distDir && !filePath.startsWith(`${distDir}${sep}`)) {
    return null;
  }

  return filePath;
}

function toDistRelativePath(pathname) {
  if (pathname === appPath.slice(0, -1) || pathname === appPath) {
    return 'app/index.html';
  }

  if (pathname.startsWith(siteBasePath)) {
    return pathname.slice(siteBasePath.length);
  }

  return pathname.replace(/^\/+/, '');
}

function startServer(server) {
  return new Promise((resolveStart, reject) => {
    const onError = (error) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolveStart();
    };

    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
}

async function stopServer(server) {
  server.closeAllConnections?.();

  await new Promise((resolveStop, reject) => {
    server.close((error) => {
      if (error && error.code !== 'ERR_SERVER_NOT_RUNNING') {
        reject(error);
        return;
      }
      resolveStop();
    });
  });
}

function sendText(response, statusCode, message) {
  response.statusCode = statusCode;
  response.setHeader('Content-Type', 'text/plain; charset=utf-8');
  response.end(message);
}

function contentTypeFor(filePath) {
  switch (extname(filePath)) {
    case '.html':
      return 'text/html; charset=utf-8';
    case '.js':
      return 'text/javascript; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.wasm':
      return 'application/wasm';
    case '.exr':
      return 'image/aces';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.png':
      return 'image/png';
    case '.svg':
      return 'image/svg+xml';
    case '.json':
      return 'application/json; charset=utf-8';
    case '.npy':
      return 'application/octet-stream';
    default:
      return 'application/octet-stream';
  }
}

function readColormapIdsByLabel() {
  const manifestPath = resolve(repoRoot, 'public', 'colormaps', 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const colormaps = manifest?.colormaps;
  if (!Array.isArray(colormaps)) {
    throw new Error(`${manifestPath} does not contain a colormaps array.`);
  }

  return new Map(colormaps.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || typeof entry.label !== 'string') {
      throw new Error(`${manifestPath} contains an invalid colormap entry at index ${index}.`);
    }
    return [entry.label.toLocaleLowerCase(), String(index)];
  }));
}

function requireColormapId(label) {
  const id = colormapIdsByLabel.get(label.toLocaleLowerCase());
  if (!id) {
    throw new Error(`Could not find colormap "${label}" in public/colormaps/manifest.json.`);
  }
  return id;
}

function readImageDimensions(path) {
  const bytes = readFileSync(path);
  if (
    bytes.length >= 24 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return {
      width: bytes.readUInt32BE(16),
      height: bytes.readUInt32BE(20)
    };
  }

  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    return readJpegDimensions(path, bytes);
  }

  throw new Error(`${path} is not a supported PNG or JPEG file.`);
}

function readJpegDimensions(path, bytes) {
  let offset = 2;
  while (offset < bytes.length) {
    while (bytes[offset] === 0xff) {
      offset += 1;
    }

    const marker = bytes[offset];
    offset += 1;
    if (marker === undefined) {
      break;
    }
    if (marker === 0xd9 || marker === 0xda) {
      break;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      continue;
    }
    if (offset + 2 > bytes.length) {
      break;
    }

    const segmentLength = bytes.readUInt16BE(offset);
    const segmentStart = offset + 2;
    const segmentEnd = offset + segmentLength;
    if (segmentLength < 2 || segmentEnd > bytes.length) {
      break;
    }

    if (isJpegStartOfFrameMarker(marker)) {
      if (segmentLength < 7) {
        break;
      }
      return {
        width: bytes.readUInt16BE(segmentStart + 3),
        height: bytes.readUInt16BE(segmentStart + 1)
      };
    }

    offset = segmentEnd;
  }

  throw new Error(`${path} does not contain a JPEG size marker.`);
}

function isJpegStartOfFrameMarker(marker) {
  return (
    (marker >= 0xc0 && marker <= 0xc3) ||
    (marker >= 0xc5 && marker <= 0xc7) ||
    (marker >= 0xc9 && marker <= 0xcb) ||
    (marker >= 0xcd && marker <= 0xcf)
  );
}

function parseArgs(argv) {
  const parsed = {
    help: false,
    only: null,
    outDir: null
  };

  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') {
      parsed.help = true;
      continue;
    }
    if (arg.startsWith('--only=')) {
      parsed.only = arg.slice('--only='.length);
      continue;
    }
    if (arg.startsWith('--out-dir=')) {
      parsed.outDir = arg.slice('--out-dir='.length);
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return parsed;
}

function filterScenes(sceneList, only) {
  if (!only) {
    return sceneList;
  }
  const wanted = new Set(only.split(',').map((item) => item.trim()).filter(Boolean));
  const selected = sceneList.filter((scene) => (
    wanted.has(scene.id) || scene.aliases.some((alias) => wanted.has(alias))
  ));
  if (selected.length !== wanted.size) {
    const known = sceneList.flatMap((scene) => [scene.id, ...scene.aliases]).sort().join(', ');
    throw new Error(`Unknown --only scene in "${only}". Known scene ids/aliases: ${known}`);
  }
  return selected;
}

function printHelp() {
  console.log(`Usage: node scripts/capture-project-page-screenshots.mjs [options]

Options:
  --only=<ids>       Comma-separated scene ids or aliases.
                     Known ids: ${scenes.map((scene) => scene.id).join(', ')}
                     Known aliases: ${scenes.flatMap((scene) => scene.aliases).sort().join(', ')}
  --out-dir=<path>   Output directory. Defaults to public/project-page.
  --help             Show this help.

Examples:
  npm run capture:project-page
  npm run capture:project-page -- --only=hero
  npm run capture:project-page -- --only=rgb
  npm run capture:project-page -- --only=rgb,depth --out-dir=/tmp/plenoview-shots
`);
}

function normalizePath(value) {
  const path = value.startsWith('/') ? value : `/${value}`;
  return path.endsWith('/') ? path : `${path}/`;
}

function resolveSiteBasePath(normalizedAppPath) {
  const segments = normalizedAppPath.split('/').filter(Boolean);
  if (segments.at(-1) === 'app') {
    segments.pop();
  }

  return segments.length > 0 ? `/${segments.join('/')}/` : '/';
}

function waitMs(durationMs) {
  return new Promise((resolveWait) => {
    setTimeout(resolveWait, durationMs);
  });
}
