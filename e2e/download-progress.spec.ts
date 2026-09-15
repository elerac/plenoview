import { readFile } from 'node:fs/promises';
import { createServer, type ServerResponse } from 'node:http';
import { expect, test } from './helpers/test';
import { gotoViewerApp, openGalleryCbox, waitForE2ERenderIdle } from './helpers/app';

const sampleUrl = 'https://huggingface.co/datasets/elerac/polanalyser/resolve/main/data/stokes/imx250mzr/stokes/spoons.exr';

for (const embedded of [false, true]) {
  for (const knownLength of [true, false]) {
    test(`shows ${knownLength ? 'percentage' : 'byte count'} during a streamed ${embedded ? 'embedded' : 'gallery'} download`, async ({ page }, testInfo) => {
      const bytes = await readFile('public/cbox_rgb.exr');
      const split = Math.ceil(bytes.length / 2);
      let response: ServerResponse | undefined;
      const server = createServer((_request, res) => {
        response = res;
        res.writeHead(200, {
          'Content-Type': 'application/octet-stream',
          'Access-Control-Allow-Origin': '*',
          ...(knownLength ? { 'Content-Length': String(bytes.length) } : {})
        });
        res.write(bytes.subarray(0, split));
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const address = server.address();
      if (!address || typeof address === 'string') {
        throw new Error('Download server did not bind a port.');
      }
      const downloadUrl = `http://127.0.0.1:${address.port}/download`;

      try {
        // Keep the gallery's real URL while serving controlled, local network chunks.
        await page.addInitScript(({ sampleUrl, downloadUrl }) => {
          const originalFetch = window.fetch.bind(window);
          window.fetch = (input, init) => originalFetch(input === sampleUrl ? downloadUrl : input, init);
        }, { sampleUrl, downloadUrl });
        if (embedded) {
          await page.setViewportSize({ width: 400, height: 300 });
          await page.goto(`/app/?ui=embed&src=${encodeURIComponent(sampleUrl)}`);
        } else {
          await gotoViewerApp(page);
          // Downloads should also be visible while another image is already open.
          await openGalleryCbox(page);
          await page.getByRole('button', { name: 'Gallery', exact: true }).click();
          await page.locator('#gallery-polanalyser-menu-button').hover();
          await page.getByRole('menuitem', { name: 'spoons.exr', exact: true }).click();
        }

        const progress = page.getByRole('progressbar', { name: 'Downloading spoons.exr...' });
        await expect(progress).toBeVisible();
        if (knownLength) {
          await expect(progress).toHaveAttribute('aria-valuenow', '50');
          await expect(page.locator('.download-progress-detail')).toContainText('50%');
        } else {
          await expect(progress).not.toHaveAttribute('aria-valuenow');
          await expect(page.locator('.download-progress-detail')).toContainText('downloaded');
        }
        await page.screenshot({ path: testInfo.outputPath('download-progress.png') });
        response!.end(bytes.subarray(split));
        await expect(progress).toBeHidden();
        if (embedded) {
          await expect(page.locator('.embed-status')).toBeHidden();
        } else {
          await expect(page.locator('#opened-images-select option:checked')).toContainText('spoons.exr');
          await expect(page.locator('#error-banner')).toBeHidden();
          await waitForE2ERenderIdle(page);
        }
      } finally {
        server.closeAllConnections();
        await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      }
    });
  }
}
