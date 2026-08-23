#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tinyexr_root="$repo_root/third_party/tinyexr"
output_root="$repo_root/src/vendor"
required_emscripten_version="6.0.7"

(cd "$tinyexr_root" && shasum -a 256 --check VENDORED_FILES.sha256)

if ! command -v emcc >/dev/null 2>&1; then
  echo "emcc is required. Activate Emscripten ${required_emscripten_version} first." >&2
  exit 1
fi

emcc_version="$(emcc --version | head -n 1)"
if [[ "$emcc_version" != *" ${required_emscripten_version} "* ]]; then
  echo "Expected Emscripten ${required_emscripten_version}, got: ${emcc_version}" >&2
  exit 1
fi

tinyexr_sources=(
  "$tinyexr_root/src/exr_attr.c"
  "$tinyexr_root/src/exr_b44.c"
  "$tinyexr_root/src/exr_codec.c"
  "$tinyexr_root/src/exr_color.c"
  "$tinyexr_root/src/exr_convert.c"
  "$tinyexr_root/src/exr_core.c"
  "$tinyexr_root/src/exr_cpu.c"
  "$tinyexr_root/src/exr_deep.c"
  "$tinyexr_root/src/exr_deflate.c"
  "$tinyexr_root/src/exr_half.c"
  "$tinyexr_root/src/exr_jph.c"
  "$tinyexr_root/src/exr_piz.c"
  "$tinyexr_root/src/exr_pxr24.c"
  "$tinyexr_root/src/exr_reader.c"
  "$tinyexr_root/src/exr_resize.c"
  "$tinyexr_root/src/exr_rle.c"
  "$tinyexr_root/src/exr_thread.c"
  "$tinyexr_root/src/exr_zip.c"
  "$tinyexr_root/src/exr_zstd.c"
)

mkdir -p "$output_root"

exported_functions='["_pexr_set_num_threads","_pexr_decode","_pexr_width","_pexr_height","_pexr_num_parts","_pexr_part_name","_pexr_part_width","_pexr_part_height","_pexr_num_channels","_pexr_channel_name","_pexr_channel_pixels","_pexr_channel_length","_pexr_channel_finite_count","_pexr_channel_finite_min","_pexr_channel_finite_max","_pexr_last_error","_pexr_last_stage","_pexr_last_reason","_pexr_last_part","_pexr_last_block","_pexr_last_error_string","_pexr_free","_malloc","_free"]'

common_args=(
  -O3
  -I"$tinyexr_root/include"
  -I"$tinyexr_root/src"
  -I"$tinyexr_root/deps/zstd"
  -w
  "${tinyexr_sources[@]}"
  "$tinyexr_root/deps/zstd/tinyexr_zstd.c"
  "$repo_root/wasm/tinyexr_decoder.c"
  -s FILESYSTEM=0
  -s ALLOW_MEMORY_GROWTH=1
  -s STACK_SIZE=8388608
  -s MODULARIZE=1
  -s EXPORT_ES6=1
  -s ENVIRONMENT=web,worker
  -s "EXPORTED_FUNCTIONS=$exported_functions"
  -s 'EXPORTED_RUNTIME_METHODS=["HEAPU8","HEAPF32"]'
)

emcc "${common_args[@]}" \
  -o "$output_root/tinyexr_wasm.js"

emcc -pthread -DEXR_USE_THREADS "${common_args[@]}" \
  -s 'PTHREAD_POOL_SIZE=Math.max(0,Math.min(16,navigator.hardwareConcurrency||1)-1)' \
  -s PTHREAD_POOL_SIZE_STRICT=2 \
  -s EXPORT_NAME=createTinyExrWasmThreaded \
  -s 'INCOMING_MODULE_JS_API=["locateFile","mainScriptUrlOrBlob","print","printErr"]' \
  -o "$output_root/tinyexr_wasm_threaded.js"

chmod 0644 \
  "$output_root/tinyexr_wasm.js" \
  "$output_root/tinyexr_wasm.wasm" \
  "$output_root/tinyexr_wasm_threaded.js" \
  "$output_root/tinyexr_wasm_threaded.wasm"

echo "Built serial and threaded TinyEXR v3.2.0 WASM with Emscripten ${required_emscripten_version}:"
wc -c \
  "$output_root/tinyexr_wasm.js" \
  "$output_root/tinyexr_wasm.wasm" \
  "$output_root/tinyexr_wasm_threaded.js" \
  "$output_root/tinyexr_wasm_threaded.wasm"
