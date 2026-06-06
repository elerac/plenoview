import { expect, test, type Page } from './helpers/test';

const EMBED_RIGHT_INSET_PX = 8;

test('keeps the embed open-full button right-aligned without a custom name', async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 360 });
  await gotoEmbed(page, '/app/?ui=embed&src=%2Fcbox_rgb.exr');

  const sourceLabel = page.locator('.embed-source-label');
  const openFullButton = page.getByRole('button', { name: 'Open full viewer', exact: true });

  await expect(page.locator('#app-menu-bar')).toBeHidden();
  await expect(page.locator('.embed-shell')).toBeVisible();
  await expect(page.locator('#gl-canvas')).toBeVisible();
  await expect(sourceLabel).toBeHidden();
  await expect(sourceLabel).toHaveText('');
  await expect(openFullButton).toBeEnabled();
  await expectButtonRightAligned(page);
});

test('keeps the embed open-full button right-aligned with a custom name @smoke', async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 360 });
  await gotoEmbed(page, '/app/?ui=embed&src=%2Fcbox_rgb.exr&name=Beauty%20pass');

  const sourceLabel = page.locator('.embed-source-label');
  const openFullButton = page.getByRole('button', { name: 'Open full viewer', exact: true });

  await expect(sourceLabel).toBeVisible();
  await expect(sourceLabel).toHaveText('Beauty pass');
  await expect(openFullButton).toBeEnabled();
  await expectButtonRightAligned(page);
  await expectNoToolbarOverlap(page);
});

test('defers embed URL loads when autoLoad is false', async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 360 });
  await page.goto('/app/?ui=embed&src=%2Fcbox_rgb.exr&autoLoad=false');

  await expect(page.locator('#gl-canvas')).toBeVisible();
  const openFullButton = page.getByRole('button', { name: 'Open full viewer', exact: true });
  const loadButton = page.getByRole('button', { name: 'Click to load image', exact: true });

  await expect(openFullButton).toBeDisabled();
  await expect(loadButton).toBeVisible();

  await loadButton.click();

  await expect(loadButton).toBeHidden();
  await expect(openFullButton).toBeEnabled({
    timeout: 30000
  });
});

test('lets the parent page scroll over an unloaded deferred embed', async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 480 });
  await page.goto('/');
  await page.setContent(`
    <style>
      html,
      body {
        margin: 0;
        min-height: 1800px;
        overflow: auto;
      }

      .spacer {
        height: 220px;
      }

      iframe {
        display: block;
        width: 520px;
        height: 280px;
        border: 0;
      }
    </style>
    <div class="spacer"></div>
    <iframe
      id="deferred-embed"
      title="Deferred Plenoview embed"
      src="/app/?ui=embed&src=%2Fcbox_rgb.exr&autoLoad=false"
    ></iframe>
    <div class="spacer"></div>
  `);

  const embed = page.locator('#deferred-embed');
  const frame = page.frameLocator('#deferred-embed');
  const loadButton = frame.getByRole('button', { name: 'Click to load image', exact: true });
  const openFullButton = frame.getByRole('button', { name: 'Open full viewer', exact: true });

  await expect(frame.locator('#gl-canvas')).toBeVisible();
  await expect(openFullButton).toBeDisabled();
  await expect(loadButton).toBeVisible();

  const box = await embed.boundingBox();
  if (!box) {
    throw new Error('Deferred embed iframe was not visible.');
  }

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, 260);

  await expect.poll(async () => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);

  await loadButton.click();
  await expect(loadButton).toBeHidden();
  await expect(openFullButton).toBeEnabled({
    timeout: 30000
  });
});

test('shows compact channel selection in the embed bottom panel', async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 360 });
  await gotoEmbed(page, '/app/?ui=embed&src=%2Fcbox_rgb.exr&bottomPanel=channels');

  await expect(page.locator('.embed-probe')).toBeHidden();
  await expect(page.locator('.embed-channel-panel')).toBeVisible();
  await expect(page.locator('.embed-channel-panel [role="option"]').first()).toBeVisible();
});

test('auto-rotates panorama embeds and ramps resume after user interaction', async ({ page }) => {
  const rotationSpeedDegPerSecond = 30;
  await page.setViewportSize({ width: 640, height: 360 });
  await gotoEmbed(
    page,
    `/app/?ui=embed&src=%2Fcbox_rgb.exr&view=panorama&panoramaAutoRotate=true&panoramaRotationSpeed=${rotationSpeedDegPerSecond}`
  );

  const initialYaw = await readEmbedPanoramaYaw(page);
  await expect.poll(async () => {
    return Math.abs(normalizeYawDelta((await readEmbedPanoramaYaw(page)) - initialYaw));
  }, { timeout: 5000 }).toBeGreaterThan(1);

  const viewer = page.locator('#viewer-container');
  const box = await viewer.boundingBox();
  if (!box) {
    throw new Error('Embed viewer was not visible.');
  }
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, 120);

  const resumeStartYaw = await readEmbedPanoramaYaw(page);
  const resumeStartTime = await page.evaluate(() => performance.now());
  await page.waitForTimeout(450);
  const earlyResumeYaw = await readEmbedPanoramaYaw(page);
  const earlyResumeTime = await page.evaluate(() => performance.now());
  const earlyResumeDelta = Math.abs(normalizeYawDelta(earlyResumeYaw - resumeStartYaw));
  const fullSpeedDelta = rotationSpeedDegPerSecond * ((earlyResumeTime - resumeStartTime) / 1000);

  expect(earlyResumeDelta).toBeGreaterThan(0.1);
  expect(earlyResumeDelta).toBeLessThan(fullSpeedDelta * 0.75);

  await expect.poll(async () => {
    return Math.abs(normalizeYawDelta((await readEmbedPanoramaYaw(page)) - resumeStartYaw));
  }, { timeout: 2000 }).toBeGreaterThan(1);
});

test('auto-orbits 3D embeds and ramps resume after mouse release', async ({ page }) => {
  const orbitSpeedDegPerSecond = 30;
  const centeredThreeDState = encodeURIComponent(JSON.stringify({
    viewerMode: '3d',
    depthChannel: '__position:P',
    view: {
      depthYawDeg: 0,
      depthPitchDeg: 0
    }
  }));
  await page.setViewportSize({ width: 640, height: 360 });
  await gotoEmbed(
    page,
    `/app/?ui=embed&src=%2Fmiddlebury_chess1_rgb_p.exr&view=3d&threeDAutoOrbit=true&threeDOrbitSpeed=${orbitSpeedDegPerSecond}&state=${centeredThreeDState}`
  );

  const initialView = await readEmbedDepthView(page);
  await expect.poll(async () => {
    return depthViewDelta(await readEmbedDepthView(page), initialView);
  }, { timeout: 5000 }).toBeGreaterThan(1);

  const viewer = page.locator('#viewer-container');
  const box = await viewer.boundingBox();
  if (!box) {
    throw new Error('Embed viewer was not visible.');
  }
  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;
  await page.mouse.move(centerX, centerY);
  await page.mouse.down();
  await page.mouse.move(centerX + 32, centerY, { steps: 4 });
  await page.mouse.up();

  const resumeStartView = await readEmbedDepthView(page);
  await expect.poll(async () => {
    return depthViewDelta(await readEmbedDepthView(page), resumeStartView);
  }, {
    intervals: [100, 200, 300, 400, 500],
    timeout: 2500
  }).toBeGreaterThan(0.1);

  await expect.poll(async () => {
    return depthViewDelta(await readEmbedDepthView(page), resumeStartView);
  }, { timeout: 2000 }).toBeGreaterThan(1);
});

async function gotoEmbed(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await expect(page.locator('#gl-canvas')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open full viewer', exact: true })).toBeEnabled({
    timeout: 30000
  });
}

async function expectButtonRightAligned(page: Page): Promise<void> {
  const alignment = await page.evaluate(() => {
    const button = document.querySelector('.embed-open-full-button');
    if (!(button instanceof HTMLElement)) {
      throw new Error('Embed open-full button was not found.');
    }

    const buttonRect = button.getBoundingClientRect();
    return {
      buttonRight: buttonRect.right,
      viewportRight: window.innerWidth
    };
  });

  expect(Math.abs(alignment.viewportRight - EMBED_RIGHT_INSET_PX - alignment.buttonRight)).toBeLessThanOrEqual(1);
}

async function expectNoToolbarOverlap(page: Page): Promise<void> {
  const layout = await page.evaluate(() => {
    const sourceLabel = document.querySelector('.embed-source-label');
    const button = document.querySelector('.embed-open-full-button');
    if (!(sourceLabel instanceof HTMLElement) || !(button instanceof HTMLElement)) {
      throw new Error('Embed toolbar elements were not found.');
    }

    const sourceRect = sourceLabel.getBoundingClientRect();
    const buttonRect = button.getBoundingClientRect();
    return {
      sourceLeft: sourceRect.left,
      sourceRight: sourceRect.right,
      buttonLeft: buttonRect.left,
      buttonRight: buttonRect.right,
      viewportRight: window.innerWidth
    };
  });

  expect(layout.sourceLeft).toBeGreaterThanOrEqual(EMBED_RIGHT_INSET_PX - 1);
  expect(layout.sourceRight).toBeLessThanOrEqual(layout.buttonLeft - EMBED_RIGHT_INSET_PX + 1);
  expect(layout.buttonRight).toBeLessThanOrEqual(layout.viewportRight - EMBED_RIGHT_INSET_PX + 1);
}

async function readEmbedPanoramaYaw(page: Page): Promise<number> {
  return await page.evaluate(() => {
    const hooks = (window as unknown as {
      __openExrViewerE2E?: {
        snapshot(): { panoramaYawDeg: number };
      };
    }).__openExrViewerE2E;
    if (!hooks) {
      throw new Error('Plenoview E2E hooks are not available.');
    }
    return hooks.snapshot().panoramaYawDeg;
  });
}

async function readEmbedDepthView(page: Page): Promise<{ depthYawDeg: number; depthPitchDeg: number }> {
  return await page.evaluate(() => {
    const hooks = (window as unknown as {
      __openExrViewerE2E?: {
        snapshot(): { depthYawDeg: number; depthPitchDeg: number };
      };
    }).__openExrViewerE2E;
    if (!hooks) {
      throw new Error('Plenoview E2E hooks are not available.');
    }
    const snapshot = hooks.snapshot();
    return {
      depthYawDeg: snapshot.depthYawDeg,
      depthPitchDeg: snapshot.depthPitchDeg
    };
  });
}

function depthViewDelta(
  a: { depthYawDeg: number; depthPitchDeg: number },
  b: { depthYawDeg: number; depthPitchDeg: number }
): number {
  return Math.abs(a.depthYawDeg - b.depthYawDeg) + Math.abs(a.depthPitchDeg - b.depthPitchDeg);
}

function normalizeYawDelta(deltaDeg: number): number {
  return ((deltaDeg + 180) % 360 + 360) % 360 - 180;
}
