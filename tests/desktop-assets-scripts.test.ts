import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');

describe('desktop asset scripts', () => {
  it('targets dist-desktop for desktop builds and staged assets', async () => {
    const [viteConfig, stageScript, verifyScript, tauriConfig] = await Promise.all([
      readFile(resolve(rootDir, 'vite.config.ts'), 'utf8'),
      readFile(resolve(rootDir, 'scripts/stage-desktop-assets.mjs'), 'utf8'),
      readFile(resolve(rootDir, 'scripts/verify-desktop-assets.mjs'), 'utf8'),
      readFile(resolve(rootDir, 'src-tauri/tauri.conf.json'), 'utf8')
    ]);

    expect(viteConfig).toContain("outDir: 'dist-desktop'");
    expect(stageScript).toContain("'dist-desktop'");
    expect(stageScript).toContain("'app', 'colormaps'");
    expect(verifyScript).toContain("'dist-desktop'");
    expect(verifyScript).toContain("'app'");
    expect(tauriConfig).toContain('"frontendDist": "../dist-desktop"');
    expect(tauriConfig).toContain('"devUrl": "http://localhost:5173/app/"');
    expect(tauriConfig).toContain('"url": "app/index.html"');
  });

  it('does not verify stale web dist assets during desktop verification', async () => {
    const verifyScript = await readFile(resolve(rootDir, 'scripts/verify-desktop-assets.mjs'), 'utf8');

    expect(verifyScript).toContain("resolve(rootDir, 'dist-desktop')");
    expect(verifyScript).not.toContain("resolve(rootDir, 'dist')");
  });
});
