import { readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  verifyTinyExrLicenseAssets,
  verifyTinyExrWasmAssets
} from './verify-tinyexr-wasm-assets.mjs';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const distDir = resolve(rootDir, 'dist');
const distFiles = await listFiles(distDir);

await verifyTinyExrWasmAssets(distFiles, 'Web dist');
await verifyTinyExrLicenseAssets(distFiles, 'Web dist');
console.log('Verified web TinyEXR WASM asset.');

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFiles(path));
    } else if (entry.isFile()) {
      files.push(path);
    }
  }
  return files;
}
