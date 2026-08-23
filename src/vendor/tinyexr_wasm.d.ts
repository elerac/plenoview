export interface TinyExrWasmModule {
  HEAPU8: Uint8Array;
  HEAPF32: Float32Array;
  _malloc(size: number): number;
  _free(pointer: number): void;
  _pexr_set_num_threads(threads: number): void;
  _pexr_decode(data: number, size: number): number;
  _pexr_width(image: number): number;
  _pexr_height(image: number): number;
  _pexr_num_parts(image: number): number;
  _pexr_part_name(image: number, part: number): number;
  _pexr_part_width(image: number, part: number): number;
  _pexr_part_height(image: number, part: number): number;
  _pexr_num_channels(image: number, part: number): number;
  _pexr_channel_name(image: number, part: number, channel: number): number;
  _pexr_channel_pixels(image: number, part: number, channel: number): number;
  _pexr_channel_length(image: number, part: number, channel: number): number;
  _pexr_channel_finite_count(image: number, part: number, channel: number): number;
  _pexr_channel_finite_min(image: number, part: number, channel: number): number;
  _pexr_channel_finite_max(image: number, part: number, channel: number): number;
  _pexr_last_error(): number;
  _pexr_last_stage(): number;
  _pexr_last_reason(): number;
  _pexr_last_part(): number;
  _pexr_last_block(): number;
  _pexr_last_error_string(): number;
  _pexr_free(image: number): void;
}

export interface TinyExrWasmOptions {
  locateFile?: (path: string, scriptDirectory: string) => string;
  mainScriptUrlOrBlob?: string | Blob;
  instantiateWasm?: (
    imports: WebAssembly.Imports,
    receiveInstance: (instance: WebAssembly.Instance) => void
  ) => unknown;
  print?: (...values: unknown[]) => void;
  printErr?: (...values: unknown[]) => void;
}

export default function createTinyExrWasm(
  options?: TinyExrWasmOptions
): Promise<TinyExrWasmModule>;
