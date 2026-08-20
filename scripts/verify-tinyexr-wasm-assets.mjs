import { readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';

const WASM_MAGIC = [0x00, 0x61, 0x73, 0x6d];
const MAX_TINYEXR_WASM_BYTES = 250_000;

export async function verifyTinyExrWasmAssets(files, label) {
  const wasmFiles = files.filter((file) => extname(file).toLowerCase() === '.wasm');
  const exrsFiles = files.filter((file) => /exrs(?:_|-)/iu.test(basename(file)));
  if (exrsFiles.length > 0) {
    throw new Error(`${label} still contains retired exrs assets: ${exrsFiles.join(', ')}`);
  }
  if (wasmFiles.length !== 1) {
    throw new Error(`${label} must contain exactly one WASM asset; found ${wasmFiles.length}.`);
  }

  const [wasmPath] = wasmFiles;
  if (!wasmPath || !/^tinyexr_wasm-[A-Za-z0-9_-]+\.wasm$/u.test(basename(wasmPath))) {
    throw new Error(`${label} does not contain the expected hashed TinyEXR WASM asset.`);
  }

  const bytes = await readFile(wasmPath);
  if (bytes.byteLength > MAX_TINYEXR_WASM_BYTES) {
    throw new Error(
      `${label} TinyEXR WASM is unexpectedly large: ${bytes.byteLength} bytes.`
    );
  }
  if (!WASM_MAGIC.every((value, index) => bytes[index] === value)) {
    throw new Error(`${label} TinyEXR asset does not have the WebAssembly magic header.`);
  }
  await WebAssembly.compile(bytes);
}

export async function verifyTinyExrLicenseAssets(files, label) {
  const requiredLicenses = [
    ['LICENSE', ['BSD 3-Clause License', 'Syoyo Fujita']],
    ['NOTICE', ['TinyEXR', 'Copyright']],
    ['zstd-LICENSE', ['For Zstandard software', 'Meta Platforms']]
  ];

  for (const [name, markers] of requiredLicenses) {
    const suffix = `/licenses/tinyexr/${name}`;
    const path = files.find((file) => file.replaceAll('\\', '/').endsWith(suffix));
    if (!path) {
      throw new Error(`${label} is missing TinyEXR license asset: ${name}.`);
    }

    const contents = await readFile(path, 'utf8');
    if (!markers.every((marker) => contents.includes(marker))) {
      throw new Error(`${label} contains an invalid TinyEXR license asset: ${name}.`);
    }
  }
}
