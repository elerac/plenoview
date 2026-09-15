# Panorama GPU checks

The renderer compiles separate ordinary-panorama, spherical-harmonics (SH), and
path-tracing programs on first use, with separate cached path-tracing variants
for polarized and ordinary RGB environments. `KHR_parallel_shader_compile` keeps the
render loop polling without synchronously querying link status. A small status
message stays visible while a requested program is preparing. Screenshot exports
await readiness and then restore their source and palette before readback.

Lighting samples a cached RGBA32F texture of the selected channels' linear values.
Exposure, gamma, palettes, and warning overlays are applied later. The cache uses
a 128 MiB LRU budget, including mip levels; one larger active image can exceed the
budget. Session/layer disposal frees its entries. Float rendering requires
`EXT_color_buffer_float`; mip filtering additionally requires
`OES_texture_float_linear`. Without parallel compilation support, the smaller
programs use a synchronous readiness check.

## Real GPU correctness

Run `npm run dev -- --host 127.0.0.1`, then open
`http://127.0.0.1:5173/tests/browser/panorama-gpu-check.html` in Chrome.
The page uses production shader programs and float framebuffer readbacks. It
checks HDR and negative values, non-finite values, alpha, Stokes selection and
masking, mip averages, cache reuse/eviction, the SH diffuse response, and polished
silver reflection in SH and path tracing (including a one-bounce limit).
All checks should pass. The GPU backend and compilation times are printed.
Reload timings may be much faster because the browser/driver caches programs.
For controlled cold comparisons and first-draw timing, see
[shader compilation measurements](../../docs/shader-compilation-performance.md).

## Browser regression tests on Windows

The default Playwright configuration uses SwiftShader. To test installed Chrome
and require a real GPU (D3D11 on Windows), run in PowerShell:

```powershell
npm run build:e2e
$env:PLAYWRIGHT_PREBUILT = 'true'
$env:PLAYWRIGHT_GPU = 'hardware'
npx playwright test e2e/panorama-programs.spec.ts --workers=1
```

The test verifies all three modes, exposure controls, compilation readiness,
context health, and WebGL errors, and attaches the backend name and screenshots.
Use `Remove-Item Env:PLAYWRIGHT_GPU` to return to the default software backend.
The build and test npm scripts work in Windows shells.

## Local validation, September 2026

On NVIDIA RTX 4060 / Chrome ANGLE D3D11, the first split-program timing run linked
ordinary panorama in 1.7 s, the HDR bake in 1.3 s, SH in 3.2 s, and path tracing in
1.0 s. Submitting each program took less than 1 ms and compilation was polled
asynchronously. The previous combined shader took about 38 s after preliminary
loop simplification. These are local measurements, not portable performance
thresholds. The real-GPU pixel harness also caught a NaN surviving floating-point
conditional sanitization on this backend; selecting finite IEEE-754 integer bits
before converting back to float fixes it and prevents poisoned HDR mip levels.
