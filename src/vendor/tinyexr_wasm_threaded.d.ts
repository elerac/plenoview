import type {
  TinyExrWasmModule,
  TinyExrWasmOptions
} from './tinyexr_wasm.js';

export default function createTinyExrWasmThreaded(
  options?: TinyExrWasmOptions
): Promise<TinyExrWasmModule>;
