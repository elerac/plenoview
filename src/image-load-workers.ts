export const IMAGE_LOAD_WORKERS_STORAGE_KEY = 'prismifold:image-load-workers:v1';
export const MIN_IMAGE_LOAD_WORKERS = 1;
export const SYSTEM_MAX_IMAGE_LOAD_WORKERS_FALLBACK = 2;

export function getDefaultImageLoadWorkers(): number {
  return getSystemMaxImageLoadWorkers();
}

export function getSystemMaxImageLoadWorkers(): number {
  const hardwareConcurrency = typeof navigator !== 'undefined' && typeof navigator.hardwareConcurrency === 'number'
    ? navigator.hardwareConcurrency
    : null;
  if (hardwareConcurrency === null || !Number.isFinite(hardwareConcurrency) || hardwareConcurrency <= 0) {
    return SYSTEM_MAX_IMAGE_LOAD_WORKERS_FALLBACK;
  }

  return Math.max(MIN_IMAGE_LOAD_WORKERS, Math.floor(hardwareConcurrency));
}

export function normalizeImageLoadWorkers(
  value: unknown,
  options: { maxWorkers?: number; fallback?: number } = {}
): number {
  const maxWorkers = normalizeMaxWorkers(options.maxWorkers);
  const fallback = clampWorkerCount(
    normalizeFiniteNumber(options.fallback) ?? getDefaultImageLoadWorkers(),
    maxWorkers
  );
  const numericValue = normalizeFiniteNumber(value);
  if (numericValue === null) {
    return fallback;
  }

  return clampWorkerCount(Math.round(numericValue), maxWorkers);
}

export function readStoredImageLoadWorkers(): number {
  if (typeof window === 'undefined') {
    return getDefaultImageLoadWorkers();
  }

  try {
    return normalizeImageLoadWorkers(
      window.localStorage.getItem(IMAGE_LOAD_WORKERS_STORAGE_KEY)
    );
  } catch {
    return getDefaultImageLoadWorkers();
  }
}

export function saveStoredImageLoadWorkers(workerCount: number): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    const normalized = normalizeImageLoadWorkers(workerCount);
    if (normalized === getDefaultImageLoadWorkers()) {
      window.localStorage.removeItem(IMAGE_LOAD_WORKERS_STORAGE_KEY);
      return;
    }

    window.localStorage.setItem(IMAGE_LOAD_WORKERS_STORAGE_KEY, String(normalized));
  } catch {
    // Storage can be unavailable in private contexts; keep the runtime setting anyway.
  }
}

function normalizeMaxWorkers(maxWorkers: number | undefined): number {
  return Math.max(
    MIN_IMAGE_LOAD_WORKERS,
    Math.floor(normalizeFiniteNumber(maxWorkers) ?? getSystemMaxImageLoadWorkers())
  );
}

function clampWorkerCount(value: number, maxWorkers: number): number {
  return Math.min(maxWorkers, Math.max(MIN_IMAGE_LOAD_WORKERS, value));
}

function normalizeFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}
