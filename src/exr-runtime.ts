import createTinyExrWasm, {
  type TinyExrWasmModule
} from './vendor/tinyexr_wasm.js';
import type { FiniteValueRange } from './channel-storage';
import { recoverExrScanlineOffsets } from './exr-offset-recovery';

const MAX_EXR_INPUT_BYTES = 0x7fff_ffff;
const MAX_EXR_NAME_BYTES = 256;
const STRING_DECODER = new TextDecoder('utf-8');

export interface RawDecodedExrLayer {
  name: string | null;
  width: number;
  height: number;
  channelNames: string[];
  pixelsByChannel: Record<string, Float32Array>;
  finiteRangeByChannel: Record<string, FiniteValueRange | null>;
}

export interface RawDecodedExr {
  width: number;
  height: number;
  layers: RawDecodedExrLayer[];
}

let serialWasm: TinyExrWasmModule | null = null;
let threadedWasm: TinyExrWasmModule | null = null;
let serialInitializing: Promise<TinyExrWasmModule> | null = null;
let threadedInitializing: Promise<TinyExrWasmModule> | null = null;
let configuredWasmUrl: string | null = null;
let configuredThreadedWasmUrl: string | null = null;
let configuredThreadedModuleUrl: string | null = null;
let configuredThreadCount = 1;
let threadedRuntimeUnavailable = false;

export function configureExrRuntime(options: {
  wasmUrl?: string | null;
  threadedWasmUrl?: string | null;
  threadedModuleUrl?: string | null;
  threadCount?: number | null;
}): void {
  configuredWasmUrl = normalizeConfiguredWasmUrl(options.wasmUrl);
  configuredThreadedWasmUrl = normalizeConfiguredWasmUrl(options.threadedWasmUrl);
  configuredThreadedModuleUrl = normalizeConfiguredWasmUrl(options.threadedModuleUrl);
  configuredThreadCount = normalizeThreadCount(options.threadCount);
}

export function resolveExrRuntimeWasmUrl(
  assetUrl: string = getDefaultWasmAssetUrl(),
  baseUrl: string = import.meta.url
): string {
  return new URL(assetUrl, baseUrl).href;
}

export function resolveThreadedExrRuntimeWasmUrl(
  assetUrl: string = getDefaultThreadedWasmAssetUrl(),
  baseUrl: string = import.meta.url
): string {
  return new URL(assetUrl, baseUrl).href;
}

export function resolveThreadedExrRuntimeModuleUrl(
  assetUrl: string,
  baseUrl: string = import.meta.url
): string {
  return new URL(assetUrl, baseUrl).href;
}

export async function decodeRawExr(bytes: Uint8Array): Promise<RawDecodedExr> {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_EXR_INPUT_BYTES) {
    throw new Error(`TinyEXR input size is invalid: ${bytes.byteLength} bytes.`);
  }

  let threaded = canUseThreadedDecoder() &&
    configuredThreadCount > 1 &&
    !threadedRuntimeUnavailable;
  let module: TinyExrWasmModule;
  try {
    module = await ensureInitialized(threaded);
  } catch (error) {
    if (!threaded) throw error;
    threadedRuntimeUnavailable = true;
    threaded = false;
    module = await ensureInitialized(false);
  }
  module._pexr_set_num_threads(threaded ? configuredThreadCount : 1);
  const inputPointer = module._malloc(bytes.byteLength);
  if (!inputPointer) {
    throw new Error(`TinyEXR could not allocate ${bytes.byteLength} input bytes.`);
  }

  let imagePointer = 0;
  try {
    module.HEAPU8.set(bytes, inputPointer);
    const recovered = recoverExrScanlineOffsets(bytes);
    if (recovered) {
      const table = new DataView(
        module.HEAPU8.buffer,
        inputPointer + recovered.tableOffset,
        recovered.offsets.length * 8
      );
      recovered.offsets.forEach((offset, index) => {
        table.setUint32(index * 8, offset, true);
        table.setUint32(index * 8 + 4, 0, true);
      });
    }
    imagePointer = module._pexr_decode(inputPointer, bytes.byteLength);
  } finally {
    module._free(inputPointer);
  }

  if (!imagePointer) {
    throw createDecodeError(module);
  }

  try {
    return copyDecodedImage(module, imagePointer);
  } finally {
    module._pexr_free(imagePointer);
  }
}

async function ensureInitialized(threaded: boolean): Promise<TinyExrWasmModule> {
  if (threaded) {
    if (threadedWasm) return threadedWasm;
    if (!threadedInitializing) {
      const wasmUrl = configuredThreadedWasmUrl ?? resolveThreadedExrRuntimeWasmUrl();
      const moduleUrl = configuredThreadedModuleUrl;
      threadedInitializing = initializeBrowserWasm(true, wasmUrl, moduleUrl);
    }
    try {
      threadedWasm = await threadedInitializing;
      return threadedWasm;
    } finally {
      threadedInitializing = null;
    }
  }

  if (serialWasm) return serialWasm;
  if (!serialInitializing) {
    const wasmUrl = configuredWasmUrl ?? resolveExrRuntimeWasmUrl();
    serialInitializing = isBrowserRuntime()
      ? initializeBrowserWasm(false, wasmUrl, null)
      : initializeNodeWasm(wasmUrl);
  }
  try {
    serialWasm = await serialInitializing;
    return serialWasm;
  } finally {
    serialInitializing = null;
  }
}

async function initializeBrowserWasm(
  threaded: boolean,
  wasmUrl: string,
  threadedModuleUrl: string | null
): Promise<TinyExrWasmModule> {
  if (!threaded) {
    return await createTinyExrWasm({
      locateFile: (path) => path.endsWith('.wasm') ? wasmUrl : path
    });
  }

  if (!threadedModuleUrl) {
    throw new Error('TinyEXR threaded module URL is unavailable.');
  }
  const { default: createTinyExrWasmThreaded } = await import(
    /* @vite-ignore */ threadedModuleUrl
  ) as typeof import('./vendor/tinyexr_wasm_threaded.js');
  return await createTinyExrWasmThreaded({
    locateFile: (path) => path.endsWith('.wasm') ? wasmUrl : path,
    mainScriptUrlOrBlob: threadedModuleUrl
  });
}

async function initializeNodeWasm(wasmUrl: string): Promise<TinyExrWasmModule> {
  const bytes = await loadNodeWasmBytes(wasmUrl);
  const compiledModule = await WebAssembly.compile(Uint8Array.from(bytes));
  return await createTinyExrWasm({
    instantiateWasm: (imports, receiveInstance) => {
      const instance = new WebAssembly.Instance(compiledModule, imports);
      receiveInstance(instance);
      return instance.exports;
    }
  });
}

function copyDecodedImage(module: TinyExrWasmModule, imagePointer: number): RawDecodedExr {
  const width = module._pexr_width(imagePointer);
  const height = module._pexr_height(imagePointer);
  const partCount = module._pexr_num_parts(imagePointer);
  if (width <= 0 || height <= 0 || partCount <= 0) {
    throw new Error(
      `TinyEXR returned an invalid image layout (${width}x${height}, ${partCount} parts).`
    );
  }

  const layers: RawDecodedExrLayer[] = [];
  for (let partIndex = 0; partIndex < partCount; partIndex += 1) {
    layers.push(copyDecodedLayer(module, imagePointer, partIndex));
  }

  return { width, height, layers };
}

function copyDecodedLayer(
  module: TinyExrWasmModule,
  imagePointer: number,
  partIndex: number
): RawDecodedExrLayer {
  const width = module._pexr_part_width(imagePointer, partIndex);
  const height = module._pexr_part_height(imagePointer, partIndex);
  const channelCount = module._pexr_num_channels(imagePointer, partIndex);
  const expectedLength = width * height;
  if (!Number.isSafeInteger(expectedLength) || expectedLength <= 0 || channelCount <= 0) {
    throw new Error(
      `TinyEXR returned an invalid part layout for part ${partIndex} (${width}x${height}, ${channelCount} channels).`
    );
  }

  const rawName = readWasmString(module, module._pexr_part_name(imagePointer, partIndex));
  const channelNames: string[] = [];
  const pixelsByChannel: Record<string, Float32Array> = {};
  const finiteRangeByChannel: Record<string, FiniteValueRange | null> = {};

  for (let channelIndex = 0; channelIndex < channelCount; channelIndex += 1) {
    const channelName = readWasmString(
      module,
      module._pexr_channel_name(imagePointer, partIndex, channelIndex)
    );
    const length = module._pexr_channel_length(imagePointer, partIndex, channelIndex);
    const pixelsPointer = module._pexr_channel_pixels(imagePointer, partIndex, channelIndex);
    if (!channelName || channelName in pixelsByChannel) {
      throw new Error(`TinyEXR returned an invalid channel name in part ${partIndex}.`);
    }
    if (length !== expectedLength || !pixelsPointer) {
      throw new Error(
        `TinyEXR returned ${length} pixels for part ${partIndex} channel ${channelName}; expected ${expectedLength}.`
      );
    }

    const start = pixelsPointer >>> 2;
    const end = start + length;
    if (end > module.HEAPF32.length) {
      throw new Error(`TinyEXR returned an out-of-bounds channel buffer for ${channelName}.`);
    }

    channelNames.push(channelName);
    pixelsByChannel[channelName] = module.HEAPF32.slice(start, end);
    finiteRangeByChannel[channelName] = module._pexr_channel_finite_count(
      imagePointer,
      partIndex,
      channelIndex
    ) > 0
      ? {
          min: module._pexr_channel_finite_min(imagePointer, partIndex, channelIndex),
          max: module._pexr_channel_finite_max(imagePointer, partIndex, channelIndex)
        }
      : null;
  }

  return {
    name: rawName || null,
    width,
    height,
    channelNames,
    pixelsByChannel,
    finiteRangeByChannel
  };
}

function createDecodeError(module: TinyExrWasmModule): Error {
  const code = module._pexr_last_error();
  const stage = module._pexr_last_stage();
  const reason = module._pexr_last_reason();
  const part = module._pexr_last_part();
  const block = module._pexr_last_block();
  const result = readWasmString(module, module._pexr_last_error_string()) || `error ${code}`;
  const reasonText = reason === 1
    ? 'deep EXR parts are not supported by the viewer'
    : reason === 2
      ? 'DWAA/DWAB compression is not supported by TinyEXR'
      : reason === 3
        ? 'the EXR layout is invalid or too large'
        : null;
  const location = [
    part >= 0 ? `part ${part}` : null,
    block >= 0 ? `block ${block}` : null
  ].filter(Boolean).join(', ');
  const details = [reasonText, location || null, `stage ${stage}`, `code ${code}`]
    .filter(Boolean)
    .join('; ');
  return new Error(`TinyEXR decode failed: ${result}${details ? ` (${details})` : ''}.`);
}

function readWasmString(module: TinyExrWasmModule, pointer: number): string {
  if (!pointer || pointer >= module.HEAPU8.length) {
    return '';
  }
  const limit = Math.min(pointer + MAX_EXR_NAME_BYTES, module.HEAPU8.length);
  let end = pointer;
  while (end < limit && module.HEAPU8[end] !== 0) {
    end += 1;
  }
  // TextDecoder rejects views backed by SharedArrayBuffer in Chromium. Names
  // are capped above, so copy only this tiny slice out of threaded WASM memory.
  return STRING_DECODER.decode(Uint8Array.from(module.HEAPU8.subarray(pointer, end)));
}

function getDefaultWasmAssetUrl(): string {
  return new URL('./vendor/tinyexr_wasm.wasm', import.meta.url).href;
}

function getDefaultThreadedWasmAssetUrl(): string {
  return new URL('./vendor/tinyexr_wasm_threaded.wasm', import.meta.url).href;
}

function canUseThreadedDecoder(): boolean {
  if (typeof window !== 'undefined' || typeof self === 'undefined') {
    return false;
  }
  const workerGlobal = self as unknown as {
    crossOriginIsolated?: unknown;
    importScripts?: unknown;
  };
  return typeof workerGlobal.importScripts === 'function' &&
    workerGlobal.crossOriginIsolated === true &&
    typeof SharedArrayBuffer !== 'undefined';
}

function isBrowserRuntime(): boolean {
  if (typeof window !== 'undefined') {
    return true;
  }

  if (typeof self === 'undefined') {
    return false;
  }

  const workerLikeSelf = self as unknown as {
    fetch?: unknown;
    location?: { href?: unknown };
    navigator?: unknown;
  };
  return typeof workerLikeSelf.fetch === 'function' &&
    typeof workerLikeSelf.location?.href === 'string' &&
    typeof workerLikeSelf.navigator !== 'undefined';
}

async function loadNodeWasmBytes(wasmUrl: string): Promise<Uint8Array> {
  const fsModuleSpecifier = 'node:fs/promises';
  const { readFile } = await import(/* @vite-ignore */ fsModuleSpecifier);
  return await readFile(new URL(wasmUrl));
}

function normalizeConfiguredWasmUrl(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeThreadCount(value: number | null | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 1;
  }
  return Math.min(16, Math.max(1, Math.floor(value)));
}
