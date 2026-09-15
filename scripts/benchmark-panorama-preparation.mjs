import { createServer } from 'vite';
import { transform } from 'esbuild';
import { chromium } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { resolve } from 'node:path';

const writeJson = (file, value) => {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(value, null, 2));
};
const [mode, ...args] = process.argv.slice(2);
if (mode === 'snapshot') {
  if (!args[0] || (args[1] !== undefined && args[1] !== 'baseline')) {
    throw new Error('Use snapshot <file> [baseline]');
  }
  const source = readFileSync('src/roughplastic-transmittance.ts', 'utf8');
  const { code } = await transform(source, { loader: 'ts', format: 'esm', target: 'es2022' });
  writeJson(args[0], { code, hash: createHash('sha256').update(source).digest('hex'), specializeShaders: args[1] !== 'baseline' });
} else if (mode === 'run') {
  const [resultFile, count, ...files] = args;
  if (!files.length || !Number.isInteger(Number(count)) || Number(count) < 1) {
    throw new Error('Use run <report> <positive integer rounds> <snapshots...>');
  }
  const server = await createServer({ server: { port: 5191, strictPort: true } });
  await server.listen();
  const results = [];
  try {
    for (let round = 0; round < Number(count); round++) {
      for (const file of round % 2 ? [...files].reverse() : files) {
        const snapshot = JSON.parse(readFileSync(file, 'utf8'));
        const browser = await chromium.launch({ channel: 'chrome', headless: true,
          args: ['--disable-gpu-shader-disk-cache'] });
        try {
          const context = await browser.newContext({ viewport: { width: 1100, height: 740 } });
          await context.route(/\/src\/roughplastic-transmittance\.ts(?:\?.*)?$/, route =>
            route.fulfill({ contentType: 'text/javascript', body: snapshot.code }));
          await context.route('**/benchmark.html', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html></html>' }));
          const page = await context.newPage();
          await page.goto('http://localhost:5191/benchmark.html');
          const tables = await page.evaluate(async () => {
            const { computeRoughPlasticTransmittance } = await import('/src/roughplastic-transmittance.ts');
            const start = performance.now();
            const values = [0.01, 0.7, 0.02, 0.05, 0.1, 0.2, 0.4].map(alpha => {
              const table = computeRoughPlasticTransmittance({ alpha, eta: 1.49 / 1.000277, distribution: 'beckmann' });
              return [...table.externalTransmittance, table.internalReflectance];
            });
            return { cpuMs: performance.now() - start, values };
          });
          await page.close();
          const app = await context.newPage();
          app.on('pageerror', error => console.error(error));
          await app.addInitScript(({ specializeShaders }) => {
            const stats = { start: 0, linked: 0, submitted: 0, gpuReady: 0, painted: 0, maxTimerGap: 0, maxFrameGap: 0, error: 0, calls: [], gaps: [], fragment: '' };
            window.panoramaBenchmark = stats;
            let lastTimer = performance.now(), lastFrame = lastTimer;
            setInterval(() => {
              const now = performance.now();
              if (stats.start && !stats.gpuReady) {
                stats.maxTimerGap = Math.max(stats.maxTimerGap, now - lastTimer);
                if (now - lastTimer > 100) stats.gaps.push({ at: now - stats.start, ms: now - lastTimer });
              }
              lastTimer = now;
            }, 16);
            function frame(now) {
              if (stats.start && !stats.painted) stats.maxFrameGap = Math.max(stats.maxFrameGap, now - lastFrame);
              lastFrame = now;
              requestAnimationFrame(frame);
            }
            requestAnimationFrame(frame);
            const shaders = new WeakMap(), programs = new WeakMap(), current = new WeakMap();
            const proto = WebGL2RenderingContext.prototype;
            for (let p = proto; p && p !== Object.prototype; p = Object.getPrototypeOf(p)) {
              for (const name of Object.getOwnPropertyNames(p)) {
                const fn = Object.getOwnPropertyDescriptor(p, name)?.value;
                if (typeof fn !== 'function' || name === 'constructor') continue;
                proto[name] = function(...args) {
                  const start = performance.now();
                  try { return fn.apply(this, args); }
                  finally { const ms = performance.now() - start;
                    if (stats.start && !stats.gpuReady && ms > 20) stats.calls.push({ name, ms, at: start - stats.start }); }
                };
              }
            }
            const wrap = (name, run) => {
              const original = proto[name];
              proto[name] = function (...args) { return run.call(this, original, args); };
            };
            wrap('shaderSource', function (fn, args) {
              const path = args[1].includes('#define PATH_TRACED_STOKES') &&
                args[1].includes('tracePolarizedEnvironmentPath');
              if (path && !specializeShaders) args[1] = args[1]
                .replace(/^#define PATH_TRACING_DEPOLARIZING_SPHERE.*$/m, '')
                .replace(/^#define PATH_TRACING_ACCUMULATE_ONLY.*$/m, '');
              if (path) stats.fragment = args[1];
              shaders.set(args[0], path);
              return fn.apply(this, args);
            });
            wrap('attachShader', function (fn, args) {
              if (shaders.get(args[1])) programs.set(args[0], true);
              return fn.apply(this, args);
            });
            wrap('linkProgram', function (fn, args) {
              if (programs.has(args[0])) {
                stats.start = performance.now();
                lastTimer = lastFrame = stats.start;
              }
              return fn.apply(this, args);
            });
            wrap('getProgramParameter', function (fn, args) {
              const result = fn.apply(this, args);
              if (programs.has(args[0]) && args[1] === 0x91b1 && result && !stats.linked) stats.linked = performance.now();
              return result;
            });
            wrap('useProgram', function (fn, args) {
              current.set(this, args[0]);
              return fn.apply(this, args);
            });
            wrap('drawArrays', function (fn, args) {
              const result = fn.apply(this, args);
              if (programs.has(current.get(this)) && !stats.submitted) {
                stats.submitted = performance.now();
                const fence = this.fenceSync(this.SYNC_GPU_COMMANDS_COMPLETE, 0);
                this.flush();
                const poll = () => {
                  const status = this.clientWaitSync(fence, 0, 0);
                  if (status === this.TIMEOUT_EXPIRED) return setTimeout(poll, 16);
                  stats.gpuReady = performance.now();
                  stats.error = this.getError();
                  this.deleteSync(fence);
                  requestAnimationFrame(() => { stats.painted = performance.now(); });
                };
                setTimeout(poll, 16);
              }
              return result;
            });
          }, { specializeShaders: snapshot.specializeShaders ?? false });
          await app.goto('http://localhost:5191/app/');
          if (process.env.PANORAMA_BENCHMARK_IMAGE) {
            await app.setInputFiles('#file-input', resolve(process.env.PANORAMA_BENCHMARK_IMAGE));
            await app.waitForFunction(() => document.querySelector('#opened-images-select option:checked'), null, { timeout: 90000 });
          } else {
            await app.getByRole('button', { name: 'Gallery', exact: true }).click();
            await app.getByRole('menuitem', { name: 'cbox_rgb.exr', exact: true }).click();
            await app.waitForFunction(() => document.querySelector('#opened-images-select option:checked')?.textContent.includes('cbox_rgb'));
          }
          await app.waitForTimeout(1000);
          await app.locator('#view-menu-button').click();
          await app.locator('#panorama-viewer-menu-item').click();
          await app.locator('#environment-path-tracing-menu-item').click();
          await app.waitForFunction(() => window.panoramaBenchmark.painted > 0, null, { timeout: 90000 });
          const timing = await app.evaluate(() => {
            const s = window.panoramaBenchmark;
            const gl = document.querySelector('#gl-canvas').getContext('webgl2');
            const debug = gl.getExtension('WEBGL_debug_renderer_info');
            return { linkMs: s.linked - s.start, submitMs: s.submitted - s.start,
              firstFrameMs: s.gpuReady - s.start, maxTimerGapMs: s.maxTimerGap,
              maxAnimationFrameGapMs: s.maxFrameGap, error: s.error, calls: s.calls, gaps: s.gaps, fragment: s.fragment,
              backend: String(gl.getParameter(debug?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER)) };
          });
          const fragmentHash = createHash('sha256').update(timing.fragment).digest('hex');
          delete timing.fragment;
          const result = { round, file, hash: snapshot.hash, fragmentHash, browser: browser.version(), ...tables, ...timing };
          results.push(result);
          writeJson(resultFile, results);
          console.log(JSON.stringify({ ...result, values: undefined }));
        } finally { await browser.close(); }
      }
    }
  } finally { await server.close(); }
} else throw new Error('Use snapshot <file> or run <report> <rounds> <snapshots...>');
