import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PATH_TRACING_MAX_SAMPLES,
  MAX_PATH_TRACING_MAX_SAMPLES,
  normalizePathTracingMaxSamples
} from '../src/path-tracing-settings';

describe('path tracing sample limit', () => {
  it('uses 65,536 for absent or invalid saved values', () => {
    expect(DEFAULT_PATH_TRACING_MAX_SAMPLES).toBe(65_536);
    for (const value of [undefined, null, Number.NaN, Infinity, '65536']) {
      expect(normalizePathTracingMaxSamples(value)).toBe(DEFAULT_PATH_TRACING_MAX_SAMPLES);
    }
  });

  it('accepts integer targets above the previous limit and bounds numeric input', () => {
    expect(normalizePathTracingMaxSamples(131_072)).toBe(131_072);
    expect(normalizePathTracingMaxSamples(42.9)).toBe(42);
    expect(normalizePathTracingMaxSamples(0)).toBe(1);
    expect(normalizePathTracingMaxSamples(-100)).toBe(1);
    expect(normalizePathTracingMaxSamples(Number.MAX_SAFE_INTEGER)).toBe(MAX_PATH_TRACING_MAX_SAMPLES);
  });
});
