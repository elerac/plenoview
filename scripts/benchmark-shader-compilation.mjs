import { createServer } from 'vite';
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';

// Snapshot production GLSL before/after a change, then alternate fresh hardware
// Chrome processes. Includes a first-draw readback: ANGLE can defer native shader
// compilation until it sees the floating-point MRT framebuffer configuration.
// Browser startup and texture allocation are outside the measured interval.
// See docs/shader-compilation-performance.md for usage and measurement limits.
function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2));
}

const [mode, ...args] = process.argv.slice(2);
if (mode === 'snapshot') {
  if (!args[0] || args.slice(1, 3).some(arg => !['true', 'false'].includes(arg)) ||
    (args[3] !== undefined && args[3] !== 'accumulate')) {
    throw new Error('Use snapshot <file> [polarized true|false] [depolarizing true|false] [accumulate]');
  }
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
  try {
    const sourceModule = await vite.ssrLoadModule('/src/rendering/gl-image-renderer/panorama-shader-source.ts');
    const pendingModule = await vite.ssrLoadModule('/src/rendering/gl-image-renderer/pending-program.ts');
    const snapshot = {
      vertex: readFileSync('src/rendering/shaders/fullscreen-triangle.vert.glsl', 'utf8'),
      fragment: sourceModule.createPanoramaFragmentSource('pathTracing', args[1] === undefined ? undefined : args[1] === 'true', args[2] === undefined ? undefined : args[2] === 'true', args[3] === 'accumulate'),
      pending: pendingModule.createPendingProgram.toString()
    };
    snapshot.hash = createHash('sha256').update(snapshot.fragment).digest('hex');
    writeJson(args[0], snapshot);
    console.log(JSON.stringify({ file: args[0], hash: snapshot.hash, bytes: snapshot.fragment.length }));
  } finally { await vite.close(); }
} else if (mode === 'run') {
  const [resultFile, roundsText, ...files] = args;
  const rounds = Number(roundsText);
  if (!resultFile || !Number.isInteger(rounds) || rounds < 1 || !files.length) {
    throw new Error('Use run <results> <positive rounds> <snapshot...>');
  }
  const results = [];
  for (let round = 0; round < rounds; round++) {
    const order = round % 2 ? [...files].reverse() : files;
    for (const file of order) {
      const snapshot = JSON.parse(readFileSync(file, 'utf8'));
      // Fresh process/profile for every measurement; disable Chrome's on-disk
      // shader cache. OS/driver caches cannot be cleared by this benchmark.
      const browser = await chromium.launch({ channel: 'chrome', headless: true,
        args: ['--disable-gpu-shader-disk-cache'] });
      try {
        const page = await browser.newPage();
        const measurement = await page.evaluate(async ({ vertex, fragment, pending, measureWarm }) => {
          const canvas = document.createElement('canvas');
          canvas.width = canvas.height = 2;
          const gl = canvas.getContext('webgl2', { antialias: false });
          if (!gl) throw new Error('WebGL2 unavailable');
          if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('Float framebuffer unavailable');
          const debug = gl.getExtension('WEBGL_debug_renderer_info');
          const backend = debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
          const parallel = Boolean(gl.getExtension('KHR_parallel_shader_compile'));
          const createPending = (0, eval)(`(${pending})`);
          async function measure() {
            const start = performance.now();
            const handle = createPending(gl, vertex, fragment);
            const submitted = performance.now();
            let program;
            while (!(program = handle.poll())) {
              if (performance.now() - start > 180000) throw new Error('Compilation timed out');
              await new Promise(resolve => setTimeout(resolve, 4));
            }
            const linked = performance.now();
            gl.useProgram(program);
            // Exercise first use separately to expose native work deferred past link.
            gl.drawArrays(gl.TRIANGLES, 0, 3);
            gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, new Float32Array(4));
            const drawn = performance.now();
            const error = gl.getError();
            handle.dispose();
            if (error) throw new Error(`First-draw WebGL error ${error}`);
            return { submitMs: submitted - start, readyMs: linked - start,
              firstDrawMs: drawn - linked, usableMs: drawn - start };
          }
          const framebuffer = gl.createFramebuffer();
          gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
          const attachments = [];
          for (let i = 0; i < 4; i++) {
            const texture = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, texture);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 2, 2, 0, gl.RGBA, gl.FLOAT, null);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, texture, 0);
            attachments.push(gl.COLOR_ATTACHMENT0 + i);
          }
          gl.drawBuffers(attachments);
          gl.bindTexture(gl.TEXTURE_2D, null);
          // Samplers use a separate complete texture, avoiding framebuffer feedback.
          const source = gl.createTexture();
          gl.bindTexture(gl.TEXTURE_2D, source);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 1, 1, 0, gl.RGBA, gl.FLOAT, new Float32Array([1, 0, 0, 1]));
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
          gl.bindVertexArray(gl.createVertexArray());
          gl.viewport(0, 0, 2, 2);
          const cold = await measure();
          const warm = measureWarm ? await measure() : null;
          return { backend, parallel, cold, warm };
        }, { ...snapshot, measureWarm: process.env.SHADER_BENCHMARK_WARM !== 'false' });
        const result = { round, file, hash: snapshot.hash, browser: browser.version(), ...measurement };
        results.push(result);
        writeJson(resultFile, results);
        console.log(JSON.stringify(result));
      } finally { await browser.close(); }
    }
  }
} else throw new Error('Use snapshot <file> or run <results> <rounds> <snapshot...>');
