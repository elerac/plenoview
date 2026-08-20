# TinyEXR source pin

This directory contains the source needed by Plenoview's WebAssembly EXR
decoder. It is vendored from the upstream TinyEXR repository without source
modification.

- Release: `v3.2.0`
- Commit: `6f470c9ab24bf3992bc512ce07e8ecb00d9bf105`
- Tree: `05372f58437dc11c70c88343716760373b37b3f0`
- Upstream: <https://github.com/syoyo/tinyexr>
- Retrieved: 2026-08-20

The authoritative pin is the full commit hash above. The upstream v3.2.0
headers still report an older minor version, so do not infer the vendored
release from `EXR_VERSION_MINOR`. `VENDORED_FILES.sha256` records every
unmodified upstream file in this snapshot.

Licensing is preserved in `LICENSE`, `NOTICE`, and `deps/zstd/LICENSE`.
Plenoview's project-specific WASM wrapper lives at
`wasm/tinyexr_decoder.c`.

To regenerate the committed module, activate Emscripten 6.0.7 from emsdk
commit `e3a0604c3d130d6ab2c40e14a1861accd939a255` and run:

```sh
npm run build:tinyexr-wasm
```

Every source or toolchain upgrade must regenerate the module and pass the EXR
compatibility corpus before the pin is changed.
