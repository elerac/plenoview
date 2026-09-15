# Shader compilation measurements

## Polarized EXR startup follow-up

The timer-only check below missed a GPU/compositor stall. With
`public/penvmap.exr`, JavaScript timers could keep running while the first native
draw stopped animation frames for about nine seconds. `public/s0.exr` was not
available in this checkout; the full-app measurements use `penvmap.exr` in
installed Chrome, not VS Code's embedded browser.

The retained changes specialize polarized programs for two independent facts:

- Whether the central sphere uses the legacy depolarizing roughplastic BSDF.
  The other supported materials share a program that omits that unused branch.
- Whether a draw accumulates floating-point Stokes samples. Progressive draws
  use the existing separate presentation shader for display processing.
  Direct-output rendering and float-allocation fallback retain a separate program.

Programs are cached by these choices. Material parameters, sampling, transport
equations, and screenshot sample counts remain unchanged.

### Measured results

Same RTX 4060 / Chrome 152 / ANGLE D3D11 configuration as below. Three alternating
baseline/candidate runs, each in a fresh headless browser with Chrome's shader
disk cache disabled. Baseline includes the earlier CPU time-slicing fix. No
other GPU tests ran during these measurements. OS/driver caches are not cleared.

| Measurement | Baseline median | Retained change median | Reduction |
| --- | ---: | ---: | ---: |
| Isolated polarized compile/link + first draw/readback | 18.16 s | 9.77 s | 46.2% |
| Loaded `penvmap.exr`: request to first completed GPU frame | 19.27 s | 10.91 s | 43.4% |
| Longest animation-frame gap during that preparation | 9.20 s | 5.42 s | 41.1% |
| Seven CPU material-lighting tables | 3.74 s | 0.397 s | 89.4% |

The full-app first-frame ranges were 19.03–20.37 s before and 10.45–11.05 s
after; repaint-gap ranges were 9.12–9.52 s before and 4.98–5.50 s after. A further
pair with instrumentation restricted to the path-tracing program measured
19.08 → 10.39 s to the first frame and 9.32 → 4.90 s for the repaint gap.

**The driver still pauses repainting on first use.** This is a measured reduction,
not a guarantee of uninterrupted interaction. The benchmark uses a GPU fence
and animation-frame timing; shader readiness and timer latency alone do not
measure when the image becomes visible.

The CPU optimization reuses each Beckmann X slope across all Y quadrature nodes,
removing repeated inverse-error-function solves. It retains the same nodes,
summation order, and precision. All 455 table values matched the baseline
exactly in the browser comparisons. These tables serve ordinary RGB lighting
and legacy roughplastic; they are not part of the default polarized-conductor
startup time.

Two additional shader experiments (runtime microfacet-iteration bounds and
runtime scene-sphere loop bounds) showed no speedup and were reverted. An
intermediate material-only specialization reached 13.57 s; adding accumulation
specialization produced the retained improvement above.

### Reproduce the retained comparison

Capture the baseline before changing shader sources, then the candidate after.
The shader benchmark snapshots assembled source and its hash. The full-app
benchmark snapshots the CPU module and can disable both shader specializations
for a baseline while retaining the same renderer, scene, and framebuffer setup.
Its reports include shader hashes, GPU identity, individual timings, and all
material-table values.

```powershell
# Before editing:
node scripts/benchmark-shader-compilation.mjs snapshot output/before-shader.json true
node scripts/benchmark-panorama-preparation.mjs snapshot output/before-cpu.json baseline
# After editing:
node scripts/benchmark-shader-compilation.mjs snapshot output/after-shader.json true false accumulate
node scripts/benchmark-panorama-preparation.mjs snapshot output/after-cpu.json
$env:SHADER_BENCHMARK_WARM = 'false'
node scripts/benchmark-shader-compilation.mjs run output/shader-comparison.json 3 output/before-shader.json output/after-shader.json
$env:PANORAMA_BENCHMARK_IMAGE = 'public/penvmap.exr'
node scripts/benchmark-panorama-preparation.mjs run output/app-comparison.json 3 output/before-cpu.json output/after-cpu.json
```

## UI responsiveness during preparation

The "Preparing panorama" stage also builds rough-plastic lighting tables. CPU
profiling of ordinary RGB environment lighting in Chrome on September 15, 2026
found a 3.84-second event-loop pause in this calculation, even though shader
completion was already polled asynchronously. Most CPU time was in the
visible-normal integration's error functions; no instrumented WebGL call took
more than 10 ms in that run.

The material cache now advances the same angular integrals in approximately
6 ms slices, yielding between integrals. Live rendering prepares these tables
alongside shader compilation and keeps the preparation indicator active until
both finish. Leaving panorama pauses material preparation; cached work resumes
on return. Screenshot preparation also yields and checks cancellation between
slices. The quadrature orders, table resolution, equations, and output are
unchanged.

Repeating the cold-browser diagnostic after this change recorded no event-loop
gaps over 100 ms during the 30-second observation window, and panorama reached
the ready state. This removes the measured CPU stall; it does not reduce the
driver compilation times below. The panorama browser regression now records
event-loop delays throughout preparation and rejects pauses of one second or
more, in addition to checking controls and rendering.

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
