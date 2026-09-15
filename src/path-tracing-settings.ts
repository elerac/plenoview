export const DEFAULT_PATH_TRACING_MAX_SAMPLES = 65_536;
export const MIN_PATH_TRACING_MAX_SAMPLES = 1;
export const MAX_PATH_TRACING_MAX_SAMPLES = 1_048_576;

export function normalizePathTracingMaxSamples(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(MAX_PATH_TRACING_MAX_SAMPLES, Math.max(MIN_PATH_TRACING_MAX_SAMPLES, Math.floor(value)))
    : DEFAULT_PATH_TRACING_MAX_SAMPLES;
}
