import { describe, expect, it } from 'vitest';
import { resolveExrRuntimeWasmUrl } from '../src/exr-runtime';

describe('exr runtime', () => {
  it('resolves root-relative wasm asset URLs against the page origin', () => {
    expect(
      resolveExrRuntimeWasmUrl(
        '/assets/tinyexr_wasm.wasm',
        'http://127.0.0.1:4173/assets/app.js'
      )
    ).toBe('http://127.0.0.1:4173/assets/tinyexr_wasm.wasm');
  });

  it('resolves relative wasm asset URLs beside the importing module', () => {
    expect(
      resolveExrRuntimeWasmUrl(
        'tinyexr_wasm.wasm',
        'http://127.0.0.1:4173/assets/app.js'
      )
    ).toBe('http://127.0.0.1:4173/assets/tinyexr_wasm.wasm');
  });

  it('leaves absolute wasm asset URLs unchanged', () => {
    expect(
      resolveExrRuntimeWasmUrl(
        'https://example.com/plenoview/assets/tinyexr_wasm.wasm',
        'http://127.0.0.1:4173/assets/app.js'
      )
    ).toBe('https://example.com/plenoview/assets/tinyexr_wasm.wasm');
  });
});
