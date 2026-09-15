import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from './helpers/test';
import { gotoViewerApp } from './helpers/app';
import { buildRgbStokesExr } from './helpers/exr-fixtures';

declare global {
  interface Window {
    __polarizedFrames?: {
      index: number; stokes: number[][]; error: number; pplastic: boolean;
      alpha: number; distribution: number; diffuse: number[]; conductor: boolean;
    }[];
    __polarizedPresentation?: { exposure: number; color: number[]; uniforms: Record<string, unknown> };
    __polarizedExposureHistory?: number[];
  }
}

for (const realFile of [false, true]) {
  test(`path traces ${realFile ? 'public/penvmap.exr' : 'RGB Stokes fixture'} through all accumulation attachments`, async ({ page }, testInfo) => {
    test.setTimeout(120000);
    test.skip(realFile && !existsSync(resolve('public/penvmap.exr')), 'Local polarized EXR is not distributed with the repository.');
    await page.setViewportSize({ width: 1000, height: 700 });
    // Read the production floating-point accumulation attachments immediately
    // after a draw, before presentation can overwrite GL state.
    await page.addInitScript(() => {
      window.__polarizedFrames = [];
      window.__polarizedExposureHistory = [];
      const draw = WebGL2RenderingContext.prototype.drawArrays;
      WebGL2RenderingContext.prototype.drawArrays = function (mode, first, count) {
        draw.call(this, mode, first, count);
        const program = this.getParameter(this.CURRENT_PROGRAM) as WebGLProgram | null;
        if (!program) return;
        if (this.getUniformLocation(program, 'uAccumulationTexture')) {
          const viewport = this.getParameter(this.VIEWPORT) as Int32Array;
          const color = new Uint8Array(4);
          this.readPixels(viewport[0] + Math.floor(viewport[2] / 2), viewport[1] + Math.floor(viewport[3] / 2), 1, 1, this.RGBA, this.UNSIGNED_BYTE, color);
          const names = ['uExposure', 'uDisplayGamma', 'uUseColormap', 'uStokesParameter', 'uPathTracingOutputComponent', 'uEnvironmentPolarized'];
          const uniforms = Object.fromEntries(names.map(name => {
            const location = this.getUniformLocation(program, name);
            return [name, location ? this.getUniform(program, location) : null];
          }));
          window.__polarizedPresentation = { exposure: Number(uniforms.uExposure), color: Array.from(color), uniforms };
          window.__polarizedExposureHistory!.push(Number(uniforms.uExposure));
          if (window.__polarizedExposureHistory!.length > 10) window.__polarizedExposureHistory!.shift();
        }
        if (!this.getParameter(this.FRAMEBUFFER_BINDING)) return;
        const polarized = this.getUniformLocation(program, 'uEnvironmentStokesS1Texture');
        const pass = this.getUniformLocation(program, 'uPathTracingPass');
        if (!polarized || !pass || this.getUniform(program, pass) !== 1) return;
        const sample = this.getUniformLocation(program, 'uPathTracingSampleIndex');
        const index = Number(this.getUniform(program, sample!));
        if (index > 10 && index % 32 !== 0 && index !== 63) return;
        const viewport = this.getParameter(this.VIEWPORT) as Int32Array;
        const stokes: number[][] = [];
        for (let component = 0; component < 4; component += 1) {
          this.readBuffer(this.COLOR_ATTACHMENT0 + component);
          const pixel = new Float32Array(4);
          this.readPixels(Math.floor(viewport[2] / 2), Math.floor(viewport[3] / 2), 1, 1, this.RGBA, this.FLOAT, pixel);
          stokes.push(Array.from(pixel));
        }
        this.readBuffer(this.COLOR_ATTACHMENT0);
        const plastic = this.getUniformLocation(program, 'uEnvironmentSpherePolarizedPlastic');
        window.__polarizedFrames!.push({
          index, stokes, error: this.getError(), pplastic: Boolean(plastic && this.getUniform(program, plastic)),
          alpha: Number(this.getUniform(program, this.getUniformLocation(program, 'uEnvironmentSphereAlpha')!)),
          distribution: Number(this.getUniform(program, this.getUniformLocation(program, 'uEnvironmentSphereDistribution')!)),
          diffuse: Array.from(this.getUniform(program, this.getUniformLocation(program, 'uEnvironmentSphereDiffuseReflectance')!) as Float32Array),
          conductor: Boolean(this.getUniform(program, this.getUniformLocation(program, 'uEnvironmentSphereRoughSilver')!))
        });
      };
    });
    await gotoViewerApp(page);
    await page.setInputFiles('#file-input', realFile ? resolve('public/penvmap.exr') : {
      name: 'polarized-env.exr', mimeType: 'image/exr', buffer: buildRgbStokesExr()
    });
    await expect(page.locator('#opened-images-select option:checked')).toContainText(realFile ? 'penvmap.exr' : 'polarized-env.exr', { timeout: 45000 });
    await page.locator('#view-menu-button').click();
    await page.locator('#panorama-viewer-menu-item').click();
    await page.locator('#environment-path-tracing-menu-item').click();
    await expect.poll(() => page.evaluate(() => window.__polarizedFrames?.length ?? 0), { timeout: 60000 }).toBeGreaterThan(3);
    const frame = await page.evaluate(() => window.__polarizedFrames!.at(-1)!);
    expect(frame.conductor).toBe(true);
    expect(frame.alpha).toBeCloseTo(0.01);
    expect(frame.distribution).toBe(0);
    await expect(page.locator('#environment-material-select option')).toHaveText([
      'Rough Conductor', 'Rough Plastic (White)', 'Rough Plastic (Black)'
    ]);
    await expect(page.locator('#environment-roughness-input')).toHaveValue('0.01');
    await expect(page.locator('#environment-distribution-select')).toHaveCount(0);
    expect(frame.error).toBe(0);
    expect(frame.stokes.flat().every(Number.isFinite)).toBe(true);
    expect(frame.stokes[0].slice(0, 3).some(value => value > 0)).toBe(true);
    expect(frame.stokes.slice(1).flatMap(value => value.slice(0, 3)).some(value => Math.abs(value) > 1e-5)).toBe(true);
    for (const component of frame.stokes) expect(component[3]).toBeCloseTo(1);
    await testInfo.attach('stokes-float-readback', { body: JSON.stringify(frame), contentType: 'application/json' });
    await testInfo.attach('initial-exposure', { body: await page.locator('#exposure-value').inputValue(), contentType: 'text/plain' });
    if (realFile) {
      // S0 is HDR radiance; use the viewer's normal automatic exposure.
      await page.locator('#app-auto-exposure-button').click();
      await expect.poll(async () => Number(await page.locator('#exposure-value').inputValue())).toBeLessThan(-5);
      await expect.poll(() => page.evaluate(() => {
        const recent = window.__polarizedExposureHistory!.slice(-5);
        return recent.length === 5 && recent.every(exposure => exposure < -5);
      })).toBe(true);
    }
    await testInfo.attach('intensity-presentation', { body: JSON.stringify(await page.evaluate(() => window.__polarizedPresentation)), contentType: 'application/json' });
    const intensityPath = testInfo.outputPath('polarized-intensity.png');
    await page.locator('#gl-canvas').screenshot({ path: intensityPath });
    await testInfo.attach('polarized-intensity', { path: intensityPath, contentType: 'image/png' });

    // Display selection reuses all four accumulated Stokes images.
    const derived = page.locator('#channel-thumbnail-strip .channel-thumbnail-tile').filter({ hasText: /^DoLP\.RGB$/ });
    await derived.click();
    await expect(page.locator('#error-banner')).toBeHidden();
    await expect(page.locator('#gl-canvas')).toHaveAttribute('aria-busy', 'false');
    const dolpPath = testInfo.outputPath('rendered-dolp.png');
    await page.locator('#gl-canvas').screenshot({ path: dolpPath });
    await testInfo.attach('rendered-dolp', { path: dolpPath, contentType: 'image/png' });

    // Screenshot export derives DoLP from its own 64-sample Stokes average.
    await page.getByRole('button', { name: 'File', exact: true }).click();
    await page.locator('#export-screenshot-button').click();
    await expect(page.locator('#screenshot-selection-overlay')).toBeVisible();
    await page.locator('#screenshot-selection-export-button').click();
    await expect(page.locator('#export-dialog-form')).toBeVisible();
    const beforeExport = await page.evaluate(() => window.__polarizedFrames!.length);
    const downloadPromise = page.waitForEvent('download');
    await page.locator('#export-dialog-submit-button').click();
    const download = await downloadPromise;
    const exportedPath = testInfo.outputPath('exported-dolp.png');
    await download.saveAs(exportedPath);
    expect(Array.from(readFileSync(exportedPath).subarray(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    await testInfo.attach('exported-dolp', { path: exportedPath, contentType: 'image/png' });
    const exportFrames = await page.evaluate(start => window.__polarizedFrames!.slice(start), beforeExport);
    expect(exportFrames.some(value => value.index === 63)).toBe(true);
    expect(exportFrames.every(value => value.error === 0 && value.stokes.flat().every(Number.isFinite))).toBe(true);
    await expect(page.locator('#export-dialog-form')).toBeHidden();
    await expect(page.locator('#screenshot-selection-overlay')).toBeHidden();
    await page.locator('#environment-material-select').selectOption('roughPlasticWhite');
    await expect(page.locator('#environment-roughness-input')).toBeEnabled();
    await expect(page.locator('#environment-roughness-input')).toHaveValue('0.1');
    await expect.poll(() => page.evaluate(() => window.__polarizedFrames!.some(value => value.pplastic && value.index >= 3)), { timeout: 30000 }).toBe(true);
    const plasticFrame = await page.evaluate(() => window.__polarizedFrames!.filter(value => value.pplastic && value.index >= 3).at(-1)!);
    expect(plasticFrame.error).toBe(0);
    expect(plasticFrame.alpha).toBeCloseTo(0.1);
    expect(plasticFrame.diffuse).toEqual([1, 1, 1]);
    expect(plasticFrame.distribution).toBe(0);
    expect(plasticFrame.stokes.flat().every(Number.isFinite)).toBe(true);
    expect(plasticFrame.stokes.slice(1).flatMap(value => value.slice(0, 3)).some(value => Math.abs(value) > 1e-6)).toBe(true);
    await testInfo.attach('pplastic-stokes-readback', { body: JSON.stringify(plasticFrame), contentType: 'application/json' });
    const plasticPath = testInfo.outputPath('pplastic-rendered-dolp.png');
    await page.locator('#gl-canvas').screenshot({ path: plasticPath });
    await testInfo.attach('pplastic-rendered-dolp', { path: plasticPath, contentType: 'image/png' });
    await page.locator('#environment-roughness-input').fill('0.035');
    await page.locator('#environment-roughness-input').press('Tab');
    await expect.poll(() => page.evaluate(() => window.__polarizedFrames!.at(-1)?.alpha)).toBeCloseTo(0.035);
    await page.locator('#environment-material-select').selectOption('roughPlasticBlack');
    await expect(page.locator('#environment-roughness-input')).toHaveValue('0.1');
    await expect.poll(() => page.evaluate(() => window.__polarizedFrames!.at(-1)?.diffuse)).toEqual([0, 0, 0]);
    const blackFrame = await page.evaluate(() => window.__polarizedFrames!.at(-1)!);
    expect(blackFrame.pplastic).toBe(true);
    expect(blackFrame.alpha).toBeCloseTo(0.1);
    expect(blackFrame.distribution).toBe(0);
    expect(blackFrame.stokes.flat().every(Number.isFinite)).toBe(true);
    await page.locator('#environment-material-select').selectOption('roughConductor');
    await expect(page.locator('#environment-roughness-input')).toHaveValue('0.01');
    await expect.poll(() => page.evaluate(() => window.__polarizedFrames!.at(-1)?.conductor)).toBe(true);
    const conductorFrame = await page.evaluate(() => window.__polarizedFrames!.at(-1)!);
    expect(conductorFrame.alpha).toBeCloseTo(0.01);
    expect(conductorFrame.distribution).toBe(0);
    await expect.poll(() => page.evaluate(() => window.__polarizedFrames!.at(-1)?.error), { timeout: 15000 }).toBe(0);

    // Returning to an ordinary image restores raw source texture bindings.
    await page.locator('#view-menu-button').click();
    await page.locator('#image-viewer-menu-item').click();
    await expect(page.locator('#error-banner')).toBeHidden();
    expect(await page.evaluate(() => (document.querySelector('#gl-canvas') as HTMLCanvasElement).getContext('webgl2')!.getError())).toBe(0);
  });
}
