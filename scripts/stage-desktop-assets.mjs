import { cp, mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const distDir = resolve(rootDir, 'dist-desktop');
const colormapSourceDir = resolve(rootDir, 'public', 'colormaps');
const colormapOutputDir = resolve(distDir, 'app', 'colormaps');
const licenseSourceDir = resolve(rootDir, 'public', 'licenses');
const licenseOutputDir = resolve(distDir, 'app', 'licenses');

await mkdir(distDir, { recursive: true });
await Promise.all([
  rm(colormapOutputDir, { recursive: true, force: true }),
  rm(licenseOutputDir, { recursive: true, force: true })
]);
await Promise.all([
  cp(colormapSourceDir, colormapOutputDir, {
    recursive: true,
    filter: (source) => !source.endsWith('.DS_Store')
  }),
  cp(licenseSourceDir, licenseOutputDir, { recursive: true })
]);

console.log('Staged desktop assets: public/colormaps and public/licenses -> dist-desktop/app');
