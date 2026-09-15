import { EnvironmentRadianceCache } from '../../src/rendering/gl-image-renderer/environment-radiance-cache';
import { ENVIRONMENT_RADIANCE_TEXTURE_UNIT, PanoramaPrograms } from '../../src/rendering/gl-image-renderer/panorama-program';
import type { PanoramaUniforms, ProgramBundle } from '../../src/rendering/gl-image-renderer/types';

const output = document.querySelector<HTMLPreElement>('#results')!;
const canvas = document.querySelector<HTMLCanvasElement>('#gpu')!;
const lines: string[] = [];
let checks = 0;

function log(message: string): void {
  lines.push(message);
  output.textContent = lines.join('\n');
}

function check(condition: boolean, description: string): void {
  if (!condition) throw new Error(description);
  checks += 1;
  log(`PASS ${description}`);
}

function checkPixels(actual: Float32Array, expected: number[], description: string): void {
  const mismatch = expected.findIndex((value, index) =>
    !Number.isFinite(actual[index]) || Math.abs(actual[index] - value) > 2e-5 * Math.max(1, Math.abs(value))
  );
  if (actual.length !== expected.length || mismatch !== -1) {
    throw new Error(`${description}: expected ${expected.join(', ')}, got ${Array.from(actual).join(', ')}`);
  }
  check(true, description);
}

async function run(): Promise<void> {
  const gl = canvas.getContext('webgl2', { antialias: false });
  if (!gl) throw new Error('WebGL 2 is unavailable.');
  const debug = gl.getExtension('WEBGL_debug_renderer_info');
  log(`GPU: ${debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)}`);
  log(`KHR_parallel_shader_compile: ${Boolean(gl.getExtension('KHR_parallel_shader_compile'))}`);
  if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('EXT_color_buffer_float is unavailable.');
  const linearFiltering = Boolean(gl.getExtension('OES_texture_float_linear'));
  log(`Float linear filtering: ${linearFiltering}`);

  const programs = new PanoramaPrograms(gl);
  const cache = new EnvironmentRadianceCache(gl, linearFiltering);
  const vao = gl.createVertexArray();
  const sources: WebGLTexture[] = [];
  gl.bindVertexArray(vao);

  async function prepare(kind: 'radiance' | 'image' | 'sphericalHarmonics' | 'pathTracing'): Promise<ProgramBundle<PanoramaUniforms>> {
    const start = performance.now();
    for (;;) {
      const bundle = programs.get(kind);
      if (bundle) {
        log(`${kind} program ready in ${(performance.now() - start).toFixed(1)} ms`);
        return bundle;
      }
      if (performance.now() - start > 60000) throw new Error(`${kind} compilation timed out.`);
      await new Promise<void>((resolve) => setTimeout(resolve, 16));
    }
  }

  function upload(slot: number, values: number[]): void {
    gl!.activeTexture(gl!.TEXTURE0 + slot);
    let texture = sources[slot];
    if (!texture) {
      texture = gl!.createTexture()!;
      sources[slot] = texture;
    }
    gl!.bindTexture(gl!.TEXTURE_2D, texture);
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MIN_FILTER, gl!.NEAREST);
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MAG_FILTER, gl!.NEAREST);
    gl!.texImage2D(gl!.TEXTURE_2D, 0, gl!.R32F, 2, 2, 0, gl!.RED, gl!.FLOAT, new Float32Array(values));
  }

  function read(texture: WebGLTexture, level = 0): Float32Array {
    const framebuffer = gl!.createFramebuffer();
    gl!.bindFramebuffer(gl!.FRAMEBUFFER, framebuffer);
    try {
      gl!.framebufferTexture2D(gl!.FRAMEBUFFER, gl!.COLOR_ATTACHMENT0, gl!.TEXTURE_2D, texture, level);
      if (gl!.checkFramebufferStatus(gl!.FRAMEBUFFER) !== gl!.FRAMEBUFFER_COMPLETE) {
        throw new Error('Float readback framebuffer is incomplete.');
      }
      const size = level === 0 ? 2 : 1;
      const pixels = new Float32Array(size * size * 4);
      gl!.readPixels(0, 0, size, size, gl!.RGBA, gl!.FLOAT, pixels);
      const error = gl!.getError();
      if (error !== gl!.NO_ERROR) throw new Error(`WebGL error during readback: 0x${error.toString(16)}`);
      return pixels;
    } finally {
      gl!.bindFramebuffer(gl!.FRAMEBUFFER, null);
      gl!.deleteFramebuffer(framebuffer);
    }
  }

  try {
    const bake = await prepare('radiance');
    gl.useProgram(bake.program);
    for (let slot = 0; slot < 12; slot += 1) upload(slot, [0, 0, 0, 0]);
    let bakeDraws = 0;
    const get = (key: string) => cache.getOrCreate(key, 2, 2, () => {
      bakeDraws += 1;
      gl.useProgram(bake.program);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    });
    const u = bake.uniforms;
    gl.uniform1i(u.displayMode, 1); // RGB
    gl.uniform1i(u.useImageAlpha, 1);
    gl.uniform1f(u.exposure, 5);
    gl.uniform1f(u.displayGamma, 2.2);
    gl.uniform1i(u.useColormap, 1);
    gl.uniform1i(u.warnInvalidValues, 1);
    upload(0, [8, -2, NaN, Infinity]);
    upload(1, [0.25, 4, 2, -Infinity]);
    upload(2, [2, 0, 3, 5]);
    upload(3, [0.25, 1.5, NaN, -0.5]);
    const rgb = get('fixture:rgb:alpha');
    const expectedRgb = [8, 0.25, 2, 0.25, -2, 4, 0, 1, 0, 2, 3, 0, 0, 0, 5, 0];
    checkPixels(read(rgb.texture), expectedRgb,
      'RGB bake preserves HDR and negative values; sanitizes NaN/infinity; clamps alpha');
    check(u.exposure === null && u.displayGamma === null && u.useColormap === null && u.warnInvalidValues === null,
      'Exposure, gamma, palettes, and warning uniforms are absent from the bake program');
    gl.uniform1f(u.exposure, -6);
    gl.uniform1f(u.displayGamma, 1);
    gl.uniform1i(u.useColormap, 0);
    const reused = get('fixture:rgb:alpha');
    check(reused.texture === rgb.texture && bakeDraws === 1,
      'Same selected-source key reuses the HDR texture without another draw after display changes');
    checkPixels(read(reused.texture), expectedRgb, 'Reused texture retains untransformed linear values');
    if (linearFiltering) {
      checkPixels(read(rgb.texture, 1), [1.5, 1.5625, 2.5, 0.3125],
        'HDR mip averages stay finite when source channels contain invalid components');
    }

    gl.uniform1i(u.useImageAlpha, 0);
    const opaque = get('fixture:rgb:opaque');
    check(opaque.texture !== rgb.texture && bakeDraws === 2, 'Changed selection key creates a fresh HDR bake');
    checkPixels(read(opaque.texture), [8, 0.25, 2, 1, -2, 4, 0, 1, 0, 2, 3, 1, 0, 0, 5, 1],
      'Disabling image alpha yields opaque cached pixels');

    gl.uniform1i(u.displayMode, 2); // Mono
    gl.uniform1i(u.useImageAlpha, 1);
    checkPixels(read(get('fixture:mono').texture), [8, 8, 8, 0.25, -2, -2, -2, 1, 0, 0, 0, 0, 0, 0, 0, 0],
      'Mono selection expands the selected scalar channel to linear RGB');

    upload(0, [2, 2, 1, 0]);
    upload(1, [0.6, 3, 0, 0]);
    upload(2, [0.8, 0, 0, 0]);
    upload(3, [0, 0, 1, 0]);
    gl.uniform1i(u.displayMode, 3); // Direct Stokes
    gl.uniform1i(u.stokesParameter, 1); // DoLP = sqrt(S1² + S2²) / S0
    gl.uniform1i(u.maskInvalidStokesVectors, 1);
    checkPixels(read(get('fixture:stokes:dolp:masked').texture), [0.5, 0.5, 0.5, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1],
      'Stokes DoLP evaluates selected channels and masks nonphysical and undefined values');
    gl.uniform1i(u.maskInvalidStokesVectors, 0);
    checkPixels(read(get('fixture:stokes:dolp:unmasked').texture), [0.5, 0.5, 0.5, 1, 1.5, 1.5, 1.5, 1, 0, 0, 0, 1, 0, 0, 0, 1],
      'Unmasked Stokes values above one remain HDR values');
    gl.uniform1i(u.maskInvalidStokesVectors, 1);
    gl.uniform1i(u.stokesParameter, 3); // DoCP = abs(S3) / S0
    checkPixels(read(get('fixture:stokes:docp:masked').texture), [0, 0, 0, 1, 0, 0, 0, 1, 1, 1, 1, 1, 0, 0, 0, 1],
      'Changing the selected Stokes parameter changes cached radiance correctly');

    const image = await prepare('image');
    gl.useProgram(image.program);
    upload(0, [4, 4, 4, 4]);
    upload(1, [1, 1, 1, 1]);
    upload(2, [9, 9, 9, 9]);
    upload(3, [0.25, 0.25, 0.25, 0.25]);
    const imageUniforms = image.uniforms;
    gl.uniform2f(imageUniforms.viewport, 2, 2);
    gl.uniform2f(imageUniforms.outputSize, 2, 2);
    gl.uniform2f(imageUniforms.outputPixelScale, 1, 1);
    gl.uniform2f(imageUniforms.imageSize, 2, 2);
    gl.uniform1f(imageUniforms.panoramaHfovDeg, 90);
    gl.uniform1f(imageUniforms.exposure, 1);
    gl.uniform1f(imageUniforms.displayGamma, 2);
    gl.uniform1i(imageUniforms.displayMode, 1);
    gl.uniform1i(imageUniforms.useImageAlpha, 1);
    gl.uniform1i(imageUniforms.alphaOutputMode, 1); // Straight alpha
    const displayed = cache.getOrCreate('display-check', 2, 2, () => gl.drawArrays(gl.TRIANGLES, 0, 3));
    checkPixels(read(displayed.texture), Array.from({ length: 4 }, () => [Math.sqrt(8), Math.sqrt(2), Math.sqrt(18), 0.25]).flat(),
      'Ordinary panorama applies exposure and display gamma after source sampling and preserves straight alpha');

    gl.useProgram(bake.program);
    gl.uniform1i(u.displayMode, 1);
    gl.uniform1i(u.useImageAlpha, 0);
    const constantEnvironment = get('fixture:constant-hdr');
    const sh = await prepare('sphericalHarmonics');
    gl.useProgram(sh.program);
    const shUniforms = sh.uniforms;
    gl.uniform2f(shUniforms.viewport, 2, 2);
    gl.uniform2f(shUniforms.outputSize, 2, 2);
    gl.uniform2f(shUniforms.outputPixelScale, 1, 1);
    gl.uniform2f(shUniforms.imageSize, 2, 2);
    gl.uniform1f(shUniforms.panoramaHfovDeg, 10);
    gl.uniform1f(shUniforms.displayGamma, 1);
    gl.uniform2i(shUniforms.environmentSampleCounts, 1, 1);
    gl.uniform1i(shUniforms.sourceTextureMipmapsAvailable, constantEnvironment.mipmapsAvailable ? 1 : 0);
    gl.uniform3f(shUniforms.environmentSphereDiffuseReflectance, 0.25, 0.5, 0.75);
    gl.uniform1f(shUniforms.environmentSphereAlpha, 0.1);
    gl.uniform1f(shUniforms.environmentSphereIntIor, 1);
    gl.uniform1f(shUniforms.environmentSphereExtIor, 1);
    // Equal IOR eliminates Fresnel reflection and transmission losses. With a
    // constant environment the quadrature reduces exactly to radiance * albedo.
    const shaded = cache.getOrCreate('sh-display-check', 2, 2, () => {
      gl.activeTexture(gl.TEXTURE0 + ENVIRONMENT_RADIANCE_TEXTURE_UNIT);
      gl.bindTexture(gl.TEXTURE_2D, constantEnvironment.texture);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    });
    checkPixels(read(shaded.texture), Array.from({ length: 4 }, () => [1, 0.5, 6.75, 1]).flat(),
      'SH lighting samples the baked HDR texture with the expected diffuse response');

    // At near-normal incidence, low-roughness silver in a constant environment
    // returns radiance * 0.96 in both renderers, with no plastic diffuse term.
    // One bounce also checks that the terminal reflection can reach the sky.
    for (const kind of ['sphericalHarmonics', 'pathTracing'] as const) {
      const silver = await prepare(kind);
      gl.useProgram(silver.program);
      const uniforms = silver.uniforms;
      gl.uniform2f(uniforms.viewport, 2000, 2000);
      gl.uniform2f(uniforms.screenOrigin, 999, 999);
      gl.uniform2f(uniforms.outputSize, 2, 2);
      gl.uniform2f(uniforms.outputPixelScale, 1, 1);
      gl.uniform2f(uniforms.imageSize, 2, 2);
      gl.uniform1f(uniforms.panoramaHfovDeg, 1);
      gl.uniform1f(uniforms.displayGamma, 1);
      gl.uniform1i(uniforms.environmentSphereSmoothSilver, 1);
      gl.uniform3f(uniforms.environmentSphereDiffuseReflectance, 0, 0, 0);
      gl.uniform1f(uniforms.environmentSphereAlpha, 0.02);
      gl.uniform1i(uniforms.sourceTextureMipmapsAvailable, constantEnvironment.mipmapsAvailable ? 1 : 0);
      for (const bounces of kind === 'pathTracing' ? [1, 6] : [1]) {
        gl.uniform1i(uniforms.pathTracingMaxBounces, bounces);
        const reflection = cache.getOrCreate(`silver:${kind}:${bounces}`, 2, 2, () => {
          gl.activeTexture(gl.TEXTURE0 + ENVIRONMENT_RADIANCE_TEXTURE_UNIT);
          gl.bindTexture(gl.TEXTURE_2D, constantEnvironment.texture);
          gl.drawArrays(gl.TRIANGLES, 0, 3);
        });
        checkPixels(read(reflection.texture), Array.from({ length: 4 }, () => [3.84, 0.96, 8.64, 1]).flat(),
          `${kind} polished silver reflects HDR radiance without diffuse loss or MIS dimming (${bounces} bounce limit)`);
      }
    }

    cache.deleteByPrefix('fixture:');
    check(!gl.isTexture(rgb.texture) && gl.isTexture(displayed.texture),
      'Session-prefix eviction frees its GPU textures and preserves other entries');
    log(`\nALL ${checks} CHECKS PASSED`);
    output.dataset.status = 'passed';
  } finally {
    cache.dispose();
    programs.dispose();
    sources.forEach((texture) => gl.deleteTexture(texture));
    gl.deleteVertexArray(vao);
  }
}

void run().catch((error: unknown) => {
  output.dataset.status = 'failed';
  log(`\nFAIL ${error instanceof Error ? error.message : String(error)}`);
});
