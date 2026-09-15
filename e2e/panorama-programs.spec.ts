import { expect, test } from './helpers/test';
import { gotoViewerApp, openGalleryCbox } from './helpers/app';

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
    'environment-lighting-menu-item',
    'environment-path-tracing-menu-item'
  ].entries()) {
    await page.locator('#view-menu-button').click();
    await page.locator('#panorama-viewer-menu-item').click();
    await page.locator(`#${id}`).click();
    // This edit is submitted while first-use compilation may still be pending.
    await page.locator('#exposure-slider').press('ArrowRight');
    await expect.poll(async () => Number(await page.locator('#exposure-value').inputValue()))
      .toBe((index + 1) / 10);
    await expect(page.locator('#gl-canvas')).toHaveAttribute('aria-busy', 'false', { timeout: 30_000 });
    await expect(page.locator('#error-banner')).toBeHidden();
    const state = await page.evaluate(() => {
      const gl = (document.querySelector('#gl-canvas') as HTMLCanvasElement).getContext('webgl2')!;
      return { lost: gl.isContextLost(), error: gl.getError() };
    });
    expect(state).toEqual({ lost: false, error: 0 });
    await testInfo.attach(id, { body: await page.locator('#gl-canvas').screenshot(), contentType: 'image/png' });
  }
});
