# Plenoview

Plenoview is a multichannel image viewer for computational imaging, rendering, and vision workflows. It reveals the rich structure of images that contain more than color, including polarization, spectral, panoramas, depth, and AOVs.

[![Plenoview thumbnail](https://elerac.github.io/plenoview/thumbnail.jpg)](https://elerac.github.io/plenoview/app/)

## Features

- OpenEXR decode via a browser-safe TinyEXR v3.2.0 WASM adapter with multipart, arbitrary-channel, cropped-window, subsampled-channel, scanline, and tiled image support.
- Local EXR load via `File > Open...` or drag/drop (drag-and-drop supports multiple files and recursive folder drops in one action).
- Recursive folder EXR load via `File > Open Folder...`; all `.exr` files under the selected folder are appended as sessions.
- `File > Export...` exports the full active display to PNG at display image size with configurable PNG compression and current channel/stokes, exposure/gamma, colormap, and alpha settings applied.
- `File > Export Screenshot...` exports an image-viewer or panorama-viewer screenshot region to PNG; multiple screenshot regions export as a ZIP, with optional reproduction JSON.
- `File > Export Batch...` exports selected file/channel combinations as a ZIP of PNG images.
- `File > Export Colormap...` exports any registered colormap as a standalone PNG gradient with configurable colormap, size, orientation, and filename.
- Right-click `Copy Image` copies the current display image to the clipboard at 1×, 4×, 2×, 0.5×, or 0.25× scale; the menu labels every scale explicitly and aligns the resulting pixel dimensions for easy comparison.
- `View > Image viewer` / `Panorama viewer` / `3D viewer` switches between the existing 2D image view, panorama tools for equirectangular and horizontal-cross cubemap environment maps, and a point-cloud view for RGB plus depth or position data. The `Panorama viewer` submenu offers the source `Panorama image`, `Environment lighting (SH)`, and `Environment lighting (path tracing)`.
- `View > Rulers` toggles pixel rulers in `Image viewer`.
- `Window` controls include normal/full-screen preview plus single-pane, vertical split, and horizontal split viewer layouts.
- Top-bar quick actions include Auto Fit, Auto Exposure, invalid-value warning, screenshot export, Metadata, app fullscreen, and the Settings gear.
- `Shift` + left-drag in `Image viewer` creates or replaces a persistent rectangular ROI for measurement; drag an existing ROI body or handles to edit it. ROI creation/editing is disabled in `Panorama viewer`.
- Multi-image sessions:
  - New image opens as active while previously opened images are kept in memory.
  - `Open Files` list allows switching active image by filename; rows show thumbnails/status and support filtering, inline rename, drag reorder, and drag-to-viewer-pane assignment.
  - Multi-layer EXR state is preserved per opened session. Display channel mapping, the active probe position, and the committed ROI carry across session switches when valid for the target image. The active viewer mode is preserved across session switches, and each session remembers separate image-view, panorama-view, and 3D-view camera state.
  - When Auto Fit selected images is enabled, image-mode session switches and new loads fit to the viewer instead of carrying previous pan/zoom; this does not apply in `Panorama viewer`. Colormap state carries only when the display selection remains compatible.
  - Decoded CPU pixels are included in the displayed memory usage. The display cache budget evicts retained display textures and materialized display buffers, so decoded pixels and browser/GPU overhead can exceed the selected cap. `Settings` dialog > `Display Cache Budget` defaults to `Automatic` and also supports fixed presets (`64`, `128`, `256`, `512`, `1024` MB).
  - Per-file row `Reload` action re-decodes the selected session from its original source.
  - `File > Reload All` re-decodes all opened sessions from their original sources.
  - Per-file row `Close` action closes the selected filename entry.
  - `File > Close All` closes all opened sessions at once.
  - Duplicate filenames are disambiguated as `name.exr (2)`, `name.exr (3)`, etc.
- Visible loading indicator while large EXR files are decoding/loading.
- ROI inspector:
  - Shows bounds, size, total pixels, per-channel valid sample counts, and `min` / `mean` / `max` for the active display selection.
  - ROI survives view-mode switches, carries across image switches and new loads, clamps to the target image bounds when needed, and can be cleared from the Inspector.
- Display controls:
  - `None` is the default RGB display path and exposes Exposure and Gamma controls. Exposure uses slider + numeric input (`-10` to `+10` EV, step `0.1`).
  - `Colormap` maps current display luminance over the full active image through the selected NumPy LUT palette.
  - Built-in palettes are listed in `public/colormaps/manifest.json` and stored as static `.npy` files in the same directory.
  - The app accepts LUT arrays with shape `(N, 3)` or `(N, 4)` and dtype `float32`, `float64`, or `uint8`.
  - RGB Exposure/Gamma controls are hidden in `Colormap` mode; colormap mode exposes separate EV/Gamma controls that affect LUT mapping.
  - `Palette` selects the active LUT without rebuilding the EXR display texture.
  - `vmin`/`vmax` can be adjusted with one dual-handle slider or numeric inputs.
  - `Auto Range` has two modes: highlighted always-auto mode follows each image/layer/channel, while one-time/manual mode preserves the current min/max across targets. Dynamic auto ranges use `v=max(abs(min), abs(max))` and map to `[-v, v]`.
  - Selecting a diverging palette auto-enables `Zero Center`, which keeps manual ranges symmetric around zero (`min=-v`, `max=v`) and also applies to fixed Stokes colormap defaults.
  - `Reverse` flips the active colormap ramp.
  - Angle Stokes colormaps expose a paired degree modulation toggle: AoLP can be modulated by DoLP, CoP by DoCP, and ToP by DoP. AoLP also lets the modulation target be `V` (HSV value) or `S` (HSV saturation), defaulting to `V`. CoP and ToP modulation default to on; AoLP defaults to off.
  - Leaves raw numeric probe values unchanged.
- Nearest-neighbor rendering at all zoom levels (no interpolation).
- Zoom range: `0.03125x` to `512x`, wheel zoom anchored to cursor.
- Pan with left mouse drag.
- Panorama viewer:
  - `Panorama image` projects the current display texture onto a sphere using equirectangular sampling for 2:1 images or horizontal-cross cubemap sampling for 4:3 images.
  - `Environment lighting (SH)` projects the active linear RGB display into fifth-degree (`L=5`, 36 coefficients per channel) spherical harmonics and uses the resulting diffuse irradiance to light a user-controlled center sphere and six smaller color/roughness comparison spheres above a circular floor. Rays that miss the scene retain the panorama as a background.
  - `Environment lighting (path tracing)` renders the same camera, analytic sphere/floor geometry, panorama, and material controls with a progressive six-bounce WebGL2 path tracer. It uses HDR luminance/solid-angle importance sampling, direct environment sampling with multiple importance sampling, and Russian roulette. Float ping-pong accumulation advances to 1024 samples per pixel, resumes across exposure/gamma changes, and resets when the source, camera, viewport, or material changes.
  - The sphere uses a Mitsuba-inspired `roughplastic` material. In SH mode, its coated diffuse and Beckmann/GGX dielectric reflection sample the original HDR environment directly with deterministic quadrature while the floor uses lower-cost SH diffuse lighting. Path-tracing mode samples that same rough-plastic BSDF and the floor's Lambertian BSDF stochastically. Material controls expose diffuse RGB, microfacet `alpha`, interior/exterior IOR, distribution, and nonlinear internal-scattering compensation.
  - Left drag orbits the camera; `W/A/S/D` also orbit yaw/pitch; mouse wheel changes horizontal FOV from `1` to `180` degrees, with the widest range transitioning to a hemispherical projection. In `Environment lighting`, these controls orbit the camera around the sphere while keeping it centered; the scene, environment map, and SH lighting remain fixed in world space, and the lower pitch is limited before the camera can pass beneath the floor.
  - The Inspector probe remains available through panorama ray-to-pixel lookup in `Panorama image`; scene geometry disables image-pixel probing in `Environment lighting`.
  - Existing ROIs remain stored but cannot be created or edited until you return to `Image viewer`.
  - Panorama mode does not draw on-canvas pixel value overlays.
  - On-canvas probe rectangles remain hidden in panorama mode.
- Probe:
  - Hover pixel readout in the Inspector.
  - Click to lock/unlock probe pixel.
  - Values are raw linear EXR channel values (pre-exposure, pre-display transform).
- Metadata:
  - The top-bar Metadata dialog shows EXR header metadata for the active image/layer, including common attributes such as compression, data/display windows, line order, channels, type, capture date, renderer/integrator, and compatible custom attributes.
- On-image pixel labels at high zoom:
  - RGB values shown inside image pixels.
  - 3-channel values stacked vertically.
  - Label colors follow channel mapping (`R`, `G`, `B`).
  - Panorama mode reuses the same value formatting, but only draws labels for source pixels with a stable, sufficiently large projected footprint.
- Channel controls:
  - Bottom channel thumbnail strip selects grouped channels such as `HOGE.R/G/B`, `FUGA.R/G/B`, `normal.X/Y/Z`, and `motion.U/V`; grouped RGB remains the default display when available, while XYZ and UV groups are used when no RGB group is available. XYZ maps `X/Y/Z` to display red/green/blue, and UV maps `U/V` to display red/green with blue fixed at zero.
  - Alpha is applied to normal channel displays when a matching companion exists: bare `R/G/B` and bare scalar channels use bare `A`, while namespaced channels such as `beauty.R` or `depth.Z` use `beauty.A` or `depth.A`. Collapsed channel choices group alpha into labels such as `RGBA`, `mask,A`, and `beauty.RGBA` instead of showing the companion alpha separately.
  - Auxiliary channels such as `Z`, masks, and custom AOVs are selectable directly and display as grayscale by mapping that source channel into all three display channels, which makes `Colormap` operate on that channel directly.
  - Expandable channel stacks expose split component entries for RGB, XYZ, and UV groups plus `A` when alpha exists. Scalar alpha pairs such as `mask,A` expose separate `mask` and `A` entries in expanded stacks.
  - Spectral wavelength series are grouped into a `Spectral RGB` entry by default using the built-in spectral-to-RGB conversion; expandable stacks expose individual wavelength channels.
  - Stokes layers with `S0/S1/S2/S3` expose derived `Stokes S1/S0`, `Stokes S2/S0`, `Stokes S3/S0`, `Stokes AoLP`, `Stokes DoP`, `Stokes DoLP`, `Stokes DoCP`, `Stokes CoP`, and `Stokes ToP` entries. Complete non-RGB suffixed sets such as `S0.Y/S1.Y/S2.Y/S3.Y` are also exposed as scalar Stokes entries with suffixed labels such as `Stokes AoLP.Y`, while spectral Stokes sets such as `S0.500nm/S1.500nm/S2.500nm/S3.500nm` are grouped into entries such as `S1/S0 Spectral RGB` and expanded into per-wavelength entries such as `S1/S0.500nm`. Scalar AoLP uses HSV over `[0, pi]`; degree parameters use Black-Red over `[0, 1]`; CoP and ToP use signed ellipticity angle over `[-pi/4, pi/4]`. CoP enables `Zero Center` by default. Switching within the same Stokes colormap group, such as DoP/DoLP/DoCP or S1/S0/S2/S0/S3/S0, preserves the current palette, `vmin`/`vmax`, auto/manual mode, and zero-center setting.
  - RGB Stokes layers with `S0.R/G/B` through `S3.R/G/B` expose grouped `S1/S0.RGB`, `S2/S0.RGB`, `S3/S0.RGB`, `AoLP.RGB`, `DoP.RGB`, `DoLP.RGB`, `DoCP.RGB`, `CoP.RGB`, and `ToP.RGB` entries. In `None`, grouped entries derive the selected Stokes parameter independently for `R`, `G`, and `B`; in `Colormap`, grouped entries keep the Rec.709 mono-derived visualization. Expanded stacks expose per-component entries such as `S1/S0.R`, `AoLP.G`, and `DoP.B`.
  - Mueller matrix layers with complete `M00` through `M33` channel sets expose a `Mueller Matrix` entry rendered as a row-major 4x4 grayscale grid with no separator pixels. Complete non-RGB suffixed sets such as `M00.Y` through `M33.Y` expose suffixed entries such as `Mueller Matrix.Y`. RGB Mueller sets with `M00.R/G/B` through `M33.R/G/B` expose a grouped `Mueller Matrix.RGB` entry, and expanded stacks expose per-component entries such as `Mueller Matrix.R`.
  - When a selected layer does not expose the previous channel mapping, the viewer falls back to the first non-Mueller RGB group, then RGB Mueller, then the first RGB group, then normal maps and UV groups, then spectral RGB when available, then XYZ/Position groups, then exact `Y`, then grayscale, then a complete Mueller matrix grid, then the first non-alpha channel.
- Double-clicking the Display heading resets visualization mode/palette, RGB exposure/gamma, colormap EV/gamma/range/zero-center/reverse, without changing channel selection or view.

## Sample data attribution

`public/middlebury_chess1_rgb_p.exr` is a half-resolution OpenEXR conversion of RGB plus metric camera-space position from the `chess1` scene in the Middlebury 2021 mobile stereo datasets.

## UI Layout

- Left panel: `Open Files`.
- Center: image viewer canvas.
- Bottom panel: channel thumbnails.
- Right side: Display, Probe, Spectral, ROI, View, and Image Stats panels.

## Tech Stack

- Vite + Vanilla TypeScript
- WebGL2 renderer
- TinyEXR v3.2.0 (vendored WASM OpenEXR decoder)
- Vitest (unit/integration-style tests)
- Playwright (workflow E2E)

## Requirements

- Node.js 22+
- npm
- Modern browser with WebGL2

## Local Development

```bash
npm install
npm run dev
```

Open the local Vite URL (usually `http://localhost:5173`) for the project page, or `http://localhost:5173/app/` for the viewer app.

## Build

```bash
npm run build
npm run preview
```

Output is generated in `dist/` and is static-hosting ready.

## VS Code Extension

Plenoview is available as a Visual Studio Code extension for opening `.exr` files directly inside VS Code as readonly custom editors.

Marketplace: https://marketplace.visualstudio.com/items?itemName=elerac.plenoview-vscode

The extension reuses the Plenoview viewer UI and supports local EXR file/folder loading, metadata inspection, viewer modes, rulers, pane layouts, and derived PNG/ZIP exports. Source `.exr` files are not modified.

## Desktop App

Prerequisites:

- Node.js 22+ and npm 10+
- Rust stable (`rustc` and `cargo`)
- Tauri platform prerequisites for your OS

Build the desktop app locally:

```bash
npm install
npm run desktop:build
```

On macOS, the local unsigned app and DMG are generated under `src-tauri/target/release/bundle/`. Generated desktop bundles and build outputs should stay uncommitted.

On Windows, the installed executable is `Plenoview.exe`. The installer registers Plenoview as an OpenEXR `.exr` handler candidate, but Windows requires the user to choose the default app: open **Settings > Apps > Default apps > Choose defaults by file type > .exr** and select Plenoview, or right-click an `.exr` file and use **Open with**. Older builds may not appear automatically; browse to the installed `Plenoview.exe` if needed.

Stable desktop installers are published from tagged GitHub Releases. Push a tag named `vX.Y.Z` where `X.Y.Z` matches `package.json`, `src-tauri/tauri.conf.json`, and `src-tauri/Cargo.toml`; the desktop workflow builds the Windows x64 NSIS installer and macOS Apple Silicon DMG, attaches checksums, and publishes the release.

Latest desktop download URLs:

```text
Windows x64: https://github.com/elerac/plenoview/releases/latest/download/Plenoview-windows-x64-setup.exe
macOS arm64: https://github.com/elerac/plenoview/releases/latest/download/Plenoview-macos-arm64.dmg
Releases:    https://github.com/elerac/plenoview/releases/latest
```

## GitHub Pages

This project is prepared for GitHub Pages with a project page and app route:

```text
Project page: https://elerac.github.io/plenoview/
Viewer app:   https://elerac.github.io/plenoview/app/
```

Open a remote EXR directly with `?src=<exr-url>`, for example `https://elerac.github.io/plenoview/app/?src=https://elerac.github.io/plenoview/cbox_rgb.exr`. The EXR host must allow browser CORS requests.

GitHub Pages should use GitHub Actions as the publishing source. The repository now uses a dedicated `CI` workflow for lint, typecheck, coverage, Playwright, and build checks on pushes, and the Pages workflow deploys only after `CI` succeeds on `main` or when triggered manually. The Pages build runs with `GITHUB_PAGES=true`, which sets the Vite base path to `/plenoview/`, builds the landing page at the project root and the viewer at `/app/`, uploads the generated `dist/` directory as the Pages artifact, and deploys it. Keep `dist/` uncommitted; it is generated by the action.

## Tests

Run the local quality gates:

```bash
npm run lint
npm run typecheck
npm run test
npm run test:coverage
```

Run Playwright E2E tests:

```bash
npx playwright install
npm run test:e2e
```

## HTML and JS Embeds

The embed wrapper registers `<plenoview-viewer>` and `window.Plenoview`.

### HTML custom element

Load the deployed wrapper script, then add the custom element:

```html
<script src="https://elerac.github.io/plenoview/embed/plenoview.js"></script>

<plenoview-viewer
  src="https://elerac.github.io/plenoview/cbox_rgb.exr"
  name="Cornell Box"
  width="640"
  height="420">
</plenoview-viewer>
```

Common attributes:

| Attribute | Description |
| --- | --- |
| `src` | EXR URL to load. |
| `name` | Embedded source label and opened file name when applicable. |
| `view` | Initial mode: `image`, `panorama`, or `depth`. |
| `auto-load` | Set to `false` to defer loading until the embedded `Click to load image` button is clicked. Defaults to `true`. |
| `width` / `height` | CSS sizes; numeric values become pixels. Defaults: `100%` / `320px`. |
| `viewer-url` | Viewer deployment URL, needed if the wrapper script is served from another location. |
| `source-origin` | Loading policy: `auto`, `parent`, or `viewer`. |
| `bottom-panel` | Embed bottom content: `probe`, `channels`, or `none`. Defaults to `probe`. |
| `panorama-auto-rotate` | Set to `true` on panorama embeds to rotate the yaw automatically. Defaults to `false`. |
| `panorama-rotation-speed` | Signed panorama rotation speed in degrees per second. Defaults to `6`; values are clamped to `-60` to `60`. |
| `three-d-auto-orbit` | Set to `true` on 3D embeds to animate a front-biased point-cloud orbit. Defaults to `false`. |
| `three-d-orbit-speed` | Maximum center yaw speed in degrees per second. Defaults to `6`; values are clamped to `0` to `30`. |
| `three-d-orbit-yaw` | 3D orbit yaw amplitude in degrees. Defaults to `12`; values are clamped to `0` to `30`. |
| `three-d-orbit-pitch` | 3D orbit pitch amplitude in degrees. Defaults to `2`; values are clamped to `0` to `8`. |

The embed supports pan, zoom, hover probe or compact channel selection, panorama auto-rotation, 3D point-cloud orbit, and an `Open full viewer` button.

### JavaScript API

Use `Plenoview.create(target, options)` for dynamic sources:

```html
<div id="viewer"></div>
<script src="https://elerac.github.io/plenoview/embed/plenoview.js"></script>
<script>
  const viewer = Plenoview.create('#viewer', {
    src: './public/cbox_rgb.exr',
    name: 'Cornell Box',
    width: 640,
    height: 420,
    bottomPanel: 'channels',
    autoLoad: true,
    viewerUrl: 'https://elerac.github.io/plenoview/app/'
  });
</script>
```

Controller methods:

| Method | Description |
| --- | --- |
| `loadUrl(src, options)` | Load an EXR URL; options include `name`, `view`, `sourceOrigin`, panorama animation fields, and 3D orbit fields. |
| `loadFile(file, options)` | Load a browser `File`; options include `name`, `view`, panorama animation fields, and 3D orbit fields. |
| `setView(view)` | Switch to `image`, `panorama`, or `3d`. |
| `setPanoramaAutoRotate(enabled)` | Enable or disable panorama auto-rotation without replacing the iframe. |
| `setPanoramaRotationSpeed(speedDegPerSecond)` | Set signed panorama rotation speed in degrees per second without replacing the iframe. |
| `setThreeDAutoOrbit(enabled)` | Enable or disable 3D point-cloud orbit without replacing the iframe. |
| `setThreeDOrbitSpeed(speedDegPerSecond)` | Set 3D orbit speed without replacing the iframe. |
| `setThreeDOrbitYaw(yawAmplitudeDeg)` | Set 3D orbit yaw amplitude without replacing the iframe. |
| `setThreeDOrbitPitch(pitchAmplitudeDeg)` | Set 3D orbit pitch amplitude without replacing the iframe. |
| `destroy()` | Remove the embedded viewer. |

### Source loading and CORS

- In `auto` mode, relative and `blob:` URLs are fetched by the embedding page; absolute remote URLs load in the viewer.
- Use `source-origin="parent"` / `sourceOrigin: 'parent'` or `source-origin="viewer"` / `sourceOrigin: 'viewer'` to force
  either side.
- Remote viewer-loaded files must be CORS-readable by the viewer origin, such as `https://elerac.github.io`.
- Direct `file://` relative EXR loading is not browser-portable. Use a local HTTP server for URL-based examples, or
  `loadFile(file)` for local files.

## Controls

- `Open Files` list: switch active image session by filename, filter rows, rename rows inline, or drag rows to reorder/assign to a split pane.
- `Alt/Option+Up/Down`: reorder the active `Open Files` row.
- `Gallery > cbox_rgb.exr` / `Middlebury Stereo > middlebury_chess1_rgb_p.exr` / `Beachball > multipart.0001.exr` / `Poly Haven` / `KAIST Hyperspectral` / `Polanalyser`: open a gallery sample and append it as a new session. Remote samples require network access.
- `File > Open...`: open one EXR file and append it as a new session.
- `File > Open Folder...`: recursively open every `.exr` file under the selected folder and append them as new sessions.
- Drag/drop: drop one or more `.exr` files, or drop a folder to recursively load every `.exr` under it.
- `File > Export...`: export the active full display to PNG at display image size, with configurable PNG compression.
- `File > Export Screenshot...`: select and export screenshot regions from Image or Panorama viewer; multiple regions export as a ZIP.
- `File > Export Batch...`: export selected file/channel combinations as a ZIP of PNG images; the batch dialog has its own `Split RGB` option.
- `File > Export Colormap...`: export a registered colormap to a PNG gradient with selectable colormap, `width`, `height`, `orientation`, and filename.
- Right-click viewer menu > `Copy Image`: copy the current display image at 1×, 4×, 2×, 0.5×, or 0.25× scale. Enlarged copies use nearest-neighbor sampling; reduced copies use the viewer's smooth minification sampling.
- Settings dialog > `Display Cache Budget`: use `Automatic` or choose a fixed retained display residency budget from `64`, `128`, `256`, `512`, or `1024` MB. The memory breakdown also shows decoded pixels, GPU textures, CPU materialized buffers, analysis cache, and total tracked memory. The value persists in `localStorage`.
- Settings dialog: configure theme, spectrum lattice motion, spectral grouping default, Stokes defaults/visibility, invalid Stokes masking, auto exposure percentile, and image load workers.
- `View > Image viewer` / `Panorama viewer > Panorama image`: switch between planar image viewing and spherical panorama viewing.
- `View > Panorama viewer > Environment lighting (SH)`: preview the panorama's spherical-harmonics lighting on a sphere and circular floor.
- `View > Panorama viewer > Environment lighting (path tracing)`: progressively path trace the same scene and controls with indirect light and environment shadows.
- `View > Rulers`: toggle pixel rulers in Image viewer.
- `Window > Full Screen Preview`: show the viewer in browser fullscreen/fallback preview mode.
- `Window > Single Pane` / `Split Vertically` / `Split Horizontally`: reset or split the viewer panes. `Cmd+D` splits vertically, and `Cmd+Shift+D` splits horizontally.
- Per-file row `Reload` action: reload and re-decode that entry in `Open Files`.
- `File > Reload All`: reload and re-decode all opened image entries.
- Per-file row `Close` action: close that entry in `Open Files`.
- `File > Close All`: close all opened image entries.
- Mouse wheel: zoom around cursor.
- `+` / `-`: zoom in/out.
- Left drag: pan in Image viewer.
- `W/A/S/D`: pan in Image viewer.
- In `Panorama viewer`, mouse wheel changes horizontal FOV, left drag orbits yaw/pitch, and `W/A/S/D` also orbit yaw/pitch.
- `Ctrl/Cmd+S`: open `File > Export...`.
- Hover: live probe sample.
- Left click: lock/unlock probe.
- `Shift` + left drag in `Image viewer`: create or replace the current ROI; drag the existing ROI body/handles to edit it.

## Implementation Notes

- Display path: normal RGB uses `linear * 2^EV`, then display-gamma encode for screen; colormap mode maps display luminance through the selected `.npy` LUT after colormap EV/gamma, range, zero-center, and reverse settings. Channel-display alpha is composited over the viewer checkerboard on screen in both RGB and colormap modes; exports preserve image alpha when present. When split component entries are selected, separate `R`, `G`, and `B` channel choices duplicate the selected source into RGB, so display luminance equals that channel value. Grouped XYZ uses the same direct component display path as RGB, and grouped UV binds `U` and `V` to red and green while leaving blue at zero. Split component Stokes entries derive the selected parameter from only the chosen component's Stokes channels before duplicating the scalar into RGB. Grouped RGB Stokes entries derive `R`, `G`, and `B` independently in `None`, but collapse to the existing Rec.709-derived mono path in `Colormap`. For angle Stokes modulation, the LUT color is converted to HSV, its value component is multiplied by the clamped paired degree value, and the result is converted back to RGB; AoLP can instead multiply HSV saturation when `S` modulation is selected.
- Panorama path: the same display texture is reused. The image aspect ratio selects equirectangular sampling (the default, normally 2:1) or a 4x3 horizontal-cross cubemap (4:3); the fragment shader casts a view ray from yaw/pitch/HFOV and fetches the matching source pixel with nearest-neighbor sampling before applying the normal RGB or colormap display transform. SH environment lighting solid-angle samples that source into 36 RGB real-SH coefficients (`L=5`), applies the Lambertian band convolution, and evaluates the irradiance over analytic sphere and disk intersections. Path-traced environment lighting keeps those analytic intersections, builds a compact CPU-side HDR alias table, and accumulates unbiased RGBA32F samples on the GPU when `EXT_color_buffer_float` is available; unsupported or failed float targets fall back to a stable direct path sample.
- Colormap authoring in Python:
  ```python
  import numpy as np

  lut = np.array([
      [1.0, 0.0, 0.0],
      [0.0, 0.0, 0.0],
      [0.0, 1.0, 0.0],
  ], dtype=np.float32)

  np.save("public/colormaps/red_black_green.npy", lut)
  loaded = np.load("public/colormaps/red_black_green.npy")
  ```
  Register the file in `public/colormaps/manifest.json`:
  ```json
  {
    "colormaps": [
      {
        "label": "Red / Black / Green",
        "file": "red_black_green.npy"
      }
    ]
  }
  ```
- The 2D image view renders at the display's native pixel density and uses derivative-selected trilinear mipmapped minification with exact nearest-neighbor magnification, matching tev's sharp pixel-inspection behavior. Browsers without `OES_texture_float_linear` fall back to nearest sampling for 32-bit float textures.
- EXR WASM is initialized through a local adapter backed by the pinned TinyEXR v3.2.0 source snapshot. `npm run build:tinyexr-wasm` reproduces the committed module with Emscripten 6.0.7, and CI rejects stale generated artifacts.
- EXR metadata is parsed directly from header bytes before pixel decode because the current WASM decoder only exposes dimensions, layers, channels, and pixel data. Metadata parse failures do not block image loading.
- Performance path for large images/channel sets:
  - channel thumbnail DOM updates are throttled to selection/image changes only,
  - decoded CPU pixels are tracked in displayed memory usage, while the configurable display cache budget evicts retained display textures and materialized display buffers with eviction protection limited to the currently bound display channels,
  - the active display texture buffer is reused across channel and layer switches,
  - GPU upload uses `texSubImage2D` for same-size updates.
