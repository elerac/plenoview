import { expect, test } from './helpers/test';
import { gotoViewerApp, openGalleryCbox } from './helpers/app';

test('explains shader preparation until ready and clears the message on mode exit', async ({ page }, testInfo) => {
  // Keep completion pending even when the browser's shader cache is warm.
  await page.addInitScript(() => {
    const getProgramParameter = WebGL2RenderingContext.prototype.getProgramParameter;
    WebGL2RenderingContext.prototype.getProgramParameter = function (program, parameter) {
      if (parameter === 0x91b1 && document.documentElement.hasAttribute('data-test-hold-shaders')) {
        return false;
      }
      return getProgramParameter.call(this, program, parameter);
    };
  });
  await gotoViewerApp(page);
  await openGalleryCbox(page);
  await page.evaluate(() => document.documentElement.setAttribute('data-test-hold-shaders', ''));
  await page.locator('#view-menu-button').click();
  await page.locator('#panorama-viewer-menu-item').click();
  await page.locator('#panorama-image-menu-item').click();

  const message = page.locator('.panorama-preparing');
  await expect(message).toBeVisible();
  await expect(message).toContainText('Preparing graphics shaders and material lighting. Controls remain available.');
  await page.locator('#exposure-slider').press('ArrowRight');
  await expect(page.locator('#exposure-value')).toHaveValue('0.1');
  await expect(message).toBeVisible();
  await testInfo.attach('compilation-message', {
    body: await page.screenshot(), contentType: 'image/png'
  });

  // The user can leave a preparing view without waiting for its program.
  await page.locator('#view-menu-button').click();
  await page.locator('#image-viewer-menu-item').click();
  await expect(message).toBeHidden();
  await page.locator('#view-menu-button').click();
  await page.locator('#panorama-viewer-menu-item').click();
  await page.locator('#panorama-image-menu-item').click();
  await expect(message).toBeVisible();
  await page.evaluate(() => document.documentElement.removeAttribute('data-test-hold-shaders'));
  await expect(message).toBeHidden({ timeout: 30_000 });
  await expect(page.locator('#gl-canvas')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('#error-banner')).toBeHidden();
});

test('renders each panorama program and keeps exposure controls usable @smoke', async ({ page }, testInfo) => {
  test.slow();
  await gotoViewerApp(page);
  await openGalleryCbox(page);
  const gpu = await page.evaluate(() => {
    const gl = (document.querySelector('#gl-canvas') as HTMLCanvasElement).getContext('webgl2')!;
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    return String(gl.getParameter(debug?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER));
  });
  await testInfo.attach('gpu-backend', { body: gpu, contentType: 'text/plain' });
  if (process.env.PLAYWRIGHT_GPU === 'hardware') {
    expect(gpu).not.toMatch(/swiftshader|llvmpipe|software/i);
    if (process.platform === 'win32') expect(gpu).toContain('D3D11');
  }
  for (const [index, id] of [
    'panorama-image-menu-item',
    'environment-path-tracing-menu-item'
  ].entries()) {
    await page.evaluate(() => {
      const probe = { last: performance.now(), maximumGap: 0, timer: 0 };
      probe.timer = window.setInterval(() => {
        const now = performance.now();
        probe.maximumGap = Math.max(probe.maximumGap, now - probe.last);
        probe.last = now;
      }, 16);
      Object.assign(window, { panoramaResponsivenessProbe: probe });
    });
    await page.locator('#view-menu-button').click();
    await page.locator('#panorama-viewer-menu-item').click();
    await page.locator(`#${id}`).click();
    // This edit is submitted while first-use compilation may still be pending.
    await page.locator('#exposure-slider').press('ArrowRight');
    await expect.poll(async () => Number(await page.locator('#exposure-value').inputValue()))
      .toBe((index + 1) / 10);
    await expect(page.locator('#gl-canvas')).toHaveAttribute('aria-busy', 'false', { timeout: 30_000 });
    const maximumGap = await page.evaluate(async () => {
      // Include the last render task even if it finishes just before this read.
      await new Promise(resolve => setTimeout(resolve, 32));
      const probe = (window as unknown as {
        panoramaResponsivenessProbe: { timer: number; maximumGap: number };
      }).panoramaResponsivenessProbe;
      clearInterval(probe.timer);
      return probe.maximumGap;
    });
    await testInfo.attach(`${id}-event-loop`, {
      body: JSON.stringify({ maximumGapMs: maximumGap }), contentType: 'application/json'
    });
    // Catch the former multi-second material integration in a single render task.
    // Leave headroom for loaded CI machines and graphics-driver scheduling.
    expect(maximumGap).toBeLessThan(1000);
    await expect(page.locator('#error-banner')).toBeHidden();
    const state = await page.evaluate(() => {
      const gl = (document.querySelector('#gl-canvas') as HTMLCanvasElement).getContext('webgl2')!;
      return { lost: gl.isContextLost(), error: gl.getError() };
    });
    expect(state).toEqual({ lost: false, error: 0 });
    await testInfo.attach(id, { body: await page.locator('#gl-canvas').screenshot(), contentType: 'image/png' });
  }
});
