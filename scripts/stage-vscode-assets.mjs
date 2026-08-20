import { cp, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const distDir = resolve(rootDir, 'vscode-extension', 'media', 'plenoview');
const colormapOutputDir = resolve(distDir, 'app', 'colormaps');
const colormapSourceDir = resolve(rootDir, 'public', 'colormaps');
const licenseOutputDir = resolve(distDir, 'app', 'licenses');
const licenseSourceDir = resolve(rootDir, 'public', 'licenses');

await mkdir(distDir, { recursive: true });
await Promise.all([
  cp(colormapSourceDir, colormapOutputDir, {
    recursive: true,
    force: true
  }),
  cp(licenseSourceDir, licenseOutputDir, {
    recursive: true,
    force: true
  })
]);

console.log('Staged VS Code assets: public/colormaps and public/licenses -> vscode-extension/media/plenoview/app');
