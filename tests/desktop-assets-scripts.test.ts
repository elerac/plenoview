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
    expect(stageScript).toContain("'app', 'licenses'");
    expect(verifyScript).toContain("'dist-desktop'");
    expect(verifyScript).toContain("'app'");
    expect(verifyScript).toContain('verifyTinyExrLicenseAssets');
    expect(tauriConfig).toContain('"frontendDist": "../dist-desktop"');
    expect(tauriConfig).toContain('"devUrl": "http://localhost:5173/app/"');
    expect(tauriConfig).toContain('"url": "app/index.html"');
  });

  it('does not verify stale web dist assets during desktop verification', async () => {
    const verifyScript = await readFile(resolve(rootDir, 'scripts/verify-desktop-assets.mjs'), 'utf8');

    expect(verifyScript).toContain("resolve(rootDir, 'dist-desktop')");
    expect(verifyScript).not.toContain("resolve(rootDir, 'dist')");
  });

  it('allows desktop gallery downloads from Hugging Face and HF storage redirects', async () => {
    const tauriConfig = JSON.parse(await readFile(resolve(rootDir, 'src-tauri/tauri.conf.json'), 'utf8')) as {
      app?: {
        security?: {
          csp?: string;
          devCsp?: string;
        };
      };
    };
    const csp = tauriConfig.app?.security?.csp;
    const devCsp = tauriConfig.app?.security?.devCsp;

    expect(typeof csp).toBe('string');
    expect(typeof devCsp).toBe('string');
    for (const policy of [csp, devCsp]) {
      const connectSrc = extractCspDirective(policy ?? '', 'connect-src');

      expect(connectSrc).toContain('https://huggingface.co');
      expect(connectSrc).toContain('https://*.hf.co');
    }
  });

  it('configures platform-specific desktop window chrome', async () => {
    const [macosConfig, windowsConfig, capabilitiesConfig] = await Promise.all([
      readFile(resolve(rootDir, 'src-tauri/tauri.macos.conf.json'), 'utf8'),
      readFile(resolve(rootDir, 'src-tauri/tauri.windows.conf.json'), 'utf8'),
      readFile(resolve(rootDir, 'src-tauri/capabilities/default.json'), 'utf8')
    ]);
    const macos = JSON.parse(macosConfig) as {
      app?: { windows?: Array<{ titleBarStyle?: string; hiddenTitle?: boolean; decorations?: boolean }> };
    };
    const windows = JSON.parse(windowsConfig) as {
      app?: { windows?: Array<{ titleBarStyle?: string; decorations?: boolean }> };
    };
    const capabilities = JSON.parse(capabilitiesConfig) as {
      permissions?: string[];
    };

    expect(macos.app?.windows?.[0]?.titleBarStyle).toBe('Overlay');
    expect(macos.app?.windows?.[0]?.hiddenTitle).toBe(true);
    expect(macos.app?.windows?.[0]?.decorations).toBeUndefined();
    expect(windows.app?.windows?.[0]?.decorations).toBe(false);
    expect(windows.app?.windows?.[0]?.titleBarStyle).toBeUndefined();
    expect(capabilities.permissions).toEqual(expect.arrayContaining([
      'core:window:allow-close',
      'core:window:allow-is-maximized',
      'core:window:allow-minimize',
      'core:window:allow-start-dragging',
      'core:window:allow-toggle-maximize'
    ]));
  });
});

function extractCspDirective(policy: string, directiveName: string): string[] {
  const directive = policy
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${directiveName} `));

  return directive?.split(/\s+/).slice(1) ?? [];
}
