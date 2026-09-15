# Shader compilation measurements

## Kept change

Path tracing now compiles separate polarized and ordinary RGB programs on demand.
The environment's polarization mode becomes a compile-time constant, allowing
ANGLE to remove unused transport branches. Each variant is cached and reused
when sources change. Material selection, roughness, sample counts, Stokes basis
rotations, and Mueller/Fresnel equations are unchanged.

Screenshot preparation captures the source's variant before awaiting compilation
and skips the radiance-bake program for polarized environments, matching the live
render path. The image panorama program retains its existing behavior.

## Results: September 15, 2026

Windows, NVIDIA GeForce RTX 4060, Chrome 152.0.7977.83, ANGLE Direct3D11.
Baseline: commit `de3cb57`. Three measurements per variant, alternating order,
with a fresh browser process/profile per measurement and Chrome's shader disk
cache disabled. No other GPU tests ran during measurement.

| Program | Compile/link ready, median | First draw/readback, median | Combined median | Combined improvement |
| --- | ---: | ---: | ---: | ---: |
| Previous dynamic shader | 11.83 s | 11.74 s | 23.52 s | — |
| Polarized variant | 9.18 s | 9.03 s | 18.24 s | 22.5% |
| Ordinary RGB variant | 5.17 s | 5.24 s | 10.40 s | 55.8% |

Combined measurements in seconds:

| Round | Previous | Polarized | Ordinary RGB |
| --- | ---: | ---: | ---: |
| 1 | 23.5741 | 18.1536 | 10.5151 |
| 2 | 23.4961 | 18.2812 | 10.3818 |
| 3 | 23.5226 | 18.2418 | 10.3999 |

The ranges do not overlap. Shader submission itself remained below 1 ms.

The first draw matters: on this driver, link completion does not include all
native compilation for the floating-point framebuffer. Measuring only cached
link readiness produced misleadingly small values around 25 ms, while a
synchronous first-draw readback still took approximately 12 seconds.

This benchmark isolates shader startup using the same 2×2 framebuffer with four
RGBA32F attachments for every variant. It performs a minimal draw, with no scene
work, followed by readback. It excludes browser startup, EXR decoding, texture
allocation/upload, and actual path-tracing throughput. Ordinary RGB rendering
normally uses one accumulation attachment; its four-attachment result above is
the controlled comparison, not a full application startup measurement. Browser
cache behavior and other GPUs/drivers can produce different timings; the test
does not clear OS or driver caches.

### Discarded experiments

- Explicit sparse Stokes matrix rotations and a rank-one plastic transmission
  product: three paired runs gave only about 1.9% combined improvement, with
  overlapping ranges. Reverted.
- Compile-time Beckmann distribution: the first controlled trial was 23.39 s
  versus 23.40 s for the baseline. No clear improvement; reverted.

## Reproduce

The benchmark uses production shader assembly and the production asynchronous
compilation helper. Snapshot sources before and after editing so the comparison
cannot accidentally measure the same shader twice. The optional snapshot flag
selects the production variant; omitting it retains the dynamic diagnostic form.

```powershell
node scripts/benchmark-shader-compilation.mjs snapshot output/baseline.json
node scripts/benchmark-shader-compilation.mjs snapshot output/polarized.json true
node scripts/benchmark-shader-compilation.mjs snapshot output/rgb.json false
$env:SHADER_BENCHMARK_WARM = 'false'
node scripts/benchmark-shader-compilation.mjs run output/comparison.json 3 output/baseline.json output/polarized.json output/rgb.json
```

Without `SHADER_BENCHMARK_WARM=false`, each fresh process also measures a second
program using the same source and context. Results include source SHA-256 hashes,
browser/GPU identification, submission time, asynchronous completion time, and
first-draw/readback time. Installed Google Chrome and development dependencies
are required.

## Correctness checks

Renderer regressions cover variant reuse after source switching and screenshot
preparation when another pane changes the active source while compilation is
pending. GPU numerical tests exercise both dynamic and specialized polarized
code against the same independent optics references. Real-EXR integration checks
exercise all four Stokes attachments, all three materials, and screenshot export.

```powershell
npm run typecheck
npm run lint
npm test
npm run build:e2e
$env:PLAYWRIGHT_PREBUILT = 'true'
$env:PLAYWRIGHT_GPU = 'hardware'
npx playwright test e2e/polarization-numerics.spec.ts e2e/penvmap-rendering.spec.ts e2e/panorama-programs.spec.ts --workers=1
```
