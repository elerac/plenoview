# Polarized environment path tracing

## Use

1. Open `public/penvmap.exr` through **File > Open** (or drop the file into the viewer).
2. Choose **View > Panorama viewer > Environment lighting (path tracing)**.
3. Select **Rough Conductor**, **Rough Plastic (White)**, or **Rough Plastic (Black)** in the right-hand **View** panel. Selecting a material sets microfacet roughness `alpha` to **0.01** for the conductor or **0.1** for either plastic. The Roughness field stays editable and reflects the active value. All three use Beckmann; there is no distribution menu. Both plastic presets use the polarized `pplastic` implementation.
4. Select `S0.RGB`, `S1.RGB`, `S2.RGB`, `S3.RGB`, or a derived Stokes channel such as `DoLP.RGB` or `AoLP.RGB` in the channel strip. Selecting a channel shows its rendered Stokes result in the main viewport. Root RGB shows rendered S0. The small thumbnail images preview the source EXR. The source-pixel Probe panel is hidden during path tracing.

Enable **Auto exposure** for an intensity preview of the supplied HDR map (roughly −8.3 EV). The initial 0 EV display clips much of its high radiance to white.

The emitter is recognized from complete RGB `S0`, `S1`, `S2` layers; `S3` can be omitted and defaults to zero. A partially supplied RGB S3 is not treated as a penvmap. The supplied EXR also contains root RGB, so its initial RGB selection automatically activates polarized lighting. Ordinary RGB environments remain unpolarized.

Signed S1–S3 values remain linear throughout light transport. Four RGBA32F images accumulate S0–S3 before ratios, angles, exposure, gamma, masking or colormaps are evaluated. Display changes reuse the accumulated result; source, camera, viewport and material changes restart it. A small FP32 tolerance is used when validating rendered fully polarized vectors. Source-image validation keeps its original tolerance.

Each camera path applies its ordered Mueller-matrix throughput to the emitter Stokes vector and rotates the result into the sensor frame. The viewport displays the average of those rendered vectors. `S1/S0`, `S2/S0`, and `S3/S0` divide the averaged components; `DoLP = sqrt(S1² + S2²) / S0`, `DoP = sqrt(S1² + S2² + S3²) / S0`, and `AoLP = atan2(S2, S1) / 2` are likewise computed from the average. Selecting a component never replaces the illumination with that component's EXR texture.

## Reference implementation

The emitter follows [`public/penvmap.cpp`](../public/penvmap.cpp). Optics and materials are ported from [Mitsuba 3 at `f2f30d101bbd5ee07b6e54643c7fef6949924b8f`](https://github.com/mitsuba-renderer/mitsuba3/tree/f2f30d101bbd5ee07b6e54643c7fef6949924b8f):

- `include/mitsuba/render/{mueller,fresnel,microfacet}.h`
- `src/bsdfs/{conductor,roughconductor,pplastic,roughplastic}.cpp`
- `src/integrators/{path,stokes}.cpp`
- `include/mitsuba/render/ior.h` and `src/core/spectrum.cpp`

The [Mitsuba license](../public/licenses/mitsuba.txt) is included in the built site's `licenses/` directory.

### Environment and coordinates

For the emitter-local scene-to-map direction `d`, penvmap uses:

```
u = atan2(d.x, -d.z) / (2 pi)
v = acos(d.y) / pi
pixel.x = fract(u - 0.5 / W) * W
pixel.y = clamp(v, 0, 1) * (H - 1)
```

Interpolation wraps the last longitude column back to the first; latitude includes both poles. Every component uses the same bilinear interpolation, including negative values. Minimum 2×3 dimensions are obtained by repeating edge pixels.

Input Stokes vectors use `stokes_basis(-d)` because light propagates toward the scene. The viewer converts directions and bases together with `R = diag(-1, -1, 1)`, a proper 180° rotation around Z. This preserves the viewer's existing equirectangular orientation and circular-polarization handedness. In a Mitsuba reproduction using the viewer's scene coordinates, set the emitter's `to_world` to this rotation. Camera orbit rotates the sensor, not the emitter. Output Stokes vectors use the Mitsuba sensor reference axis `cross(ray.d, camera_vertical)`.

The sampling distribution is the bilinear density of `max(luminance(S0), 0) * sin(theta)`, using Mitsuba's RGB luminance coefficients. A cell alias table and conditional linear-density inversion sample the same continuous distribution as penvmap's hierarchical sampler. Random sample sequences differ. MIS compensation is disabled, matching the plugin default.

### Materials and paths

- **Rough Conductor** uses silver optical constants with the rough conductor's Beckmann visible-normal distribution, Smith masking, reflection Jacobian, and full Mueller matrix.
- **Rough Plastic (White/Black)** follows Mitsuba's polarized `pplastic`: microfacet dielectric reflection plus smooth-interface transmission into and out of a diffuse substrate. The diffuse reflectance is RGB `(1, 1, 1)` for white and `(0, 0, 0)` for black; both retain the dielectric specular reflection. The diffuse Mueller matrix is `T_exit * depolarizer(albedo) * T_entry`; exit transmission generates polarization, even though the substrate depolarizes. Both lobes use their scattering-plane basis rotations, and sampling mixes Beckmann visible microfacet normals with cosine-weighted diffuse directions using Mitsuba's reflectance-only probability. This material does not use roughplastic's transmittance LUT, nonlinear correction, or eta-squared factor. The comparison spheres and floor use pplastic under polarized environment lighting.
- Legacy serialized materials can still use the conductor's delta reflection or depolarizing `roughplastic`, but these are no longer menu choices. Restored center-sphere materials use Beckmann. Legacy roughplastic uses Mitsuba's 64-entry rough-interface transmittance table and integrated internal reflectance; its entire BSDF depolarizes as upstream specifies.
- Silver eta/k values come from Mitsuba's Ag spectra, projected using its RGB conversion: `node scripts/generate-silver-ior.mjs` reproduces the constants offline.
- Path throughput is a Mueller matrix per RGB channel. Camera-to-emitter path extension right-multiplies each world-basis BSDF. Contributions apply `throughput * BSDF * emitter_Stokes`.
- Direct environment and BSDF samples use power-heuristic MIS. Russian roulette starts after five scattering events, using the maximum RGB M00 throughput and a 0.95 survival cap.

The viewer traces six surface scattering events and then evaluates an escaping environment ray. This corresponds to Mitsuba `max_depth=7`, since Mitsuba includes the emitter vertex. Progressive rendering defaults to 65,536 samples per pixel. Edit **View > Panorama viewer > Maximum SPP…** or **Max SPP** in the View panel to choose an integer from 1 to 1,048,576. Raising the limit resumes the existing accumulation; lowering it pauses once the current sample count reaches or exceeds the limit, without discarding samples. This setting carries across image sessions and is included in shared viewer state and screenshot reproduction metadata. Screenshot exports retain their separate 64-sample budget. Geometry remains the viewer's procedural sphere/floor scene. This implements RGB polarized rendering, consistent with the supplied plugin's unsupported spectral variants.

Polarized screenshot exports use a separate 64-sample accumulation surface before computing derived Stokes views, and preserve the live viewport's progress. They can remain noisier than a fully converged viewport. Full-image export continues to export the source image selection.

This is a GLSL/FP32 port, not a Mitsuba runtime embedded in the browser. Random sequences, floating-point math and inverse-error-function approximations differ. Validation checks the source-derived physics numerically; it does not establish pixel-identical full-image parity with Mitsuba.

## Validation

```
npm run typecheck
npm run lint
npm test
npm run build:e2e
npx playwright test e2e/polarization-numerics.spec.ts e2e/penvmap-rendering.spec.ts --workers=1
```

The numerical browser tests compare production GLSL with independent Jones/Mueller calculations, including complex phase, reflection basis conversions, noncommuting matrix chains, sensor rotation, signed environment interpolation, visible-normal PDFs and a complete mirror path. Integration tests read every production accumulation attachment and switch display/material/view modes. The real EXR integration case runs when the local `public/penvmap.exr` exists; a generated RGB Stokes fixture always runs.

On Windows, set `PLAYWRIGHT_GPU=hardware` to test installed Chrome/ANGLE D3D11; the default test backend uses SwiftShader. `PLAYWRIGHT_PREBUILT=true` uses an existing E2E build.

The supplied 2048×1024 EXR needs about 192 MiB for four environment textures and its full-resolution importance table, in addition to decoded channels and viewport accumulation. A single active environment may exceed the cache's usual 128 MiB budget; closing its session frees these resources.
