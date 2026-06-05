import { loadExr } from './exr';
import {
  configureExrRuntime,
  resolveExrRuntimeWasmUrl
} from './exr-runtime';
import ExrDecodeWorker from './exr-worker.ts?worker&inline';
import {
  createAbortError,
  isAbortError,
  throwIfAborted
} from './lifecycle';
import {
  createDecodeErrorContext,
  type DecodeAdmissionState,
  createDecodeErrorFromPayload,
  createDecodeErrorPayload,
  type DecodeBytesOptions,
  type DecodeErrorContext,
  type DecodeErrorPayload
} from './exr-decode-context';
import {
  DecodeMemoryReservationManager,
  type DecodeMemoryReservation,
  type DecodeMemoryReservationEstimate,
  type DecodeMemoryReservationReason
} from './memory/memory-manager';
import {
  errorResource,
  isPendingMatch,
  pendingResource,
  successResource,
  type AsyncResource
} from './async-resource';
import {
  getDefaultImageLoadWorkers,
  normalizeImageLoadWorkers
} from './image-load-workers';
import type { DecodedExrImage } from './types';

interface DecodeWorkerRequest {
  id: number;
  bytes: Uint8Array;
  filename: string | null;
  context: DecodeErrorContext;
  wasmUrl: string;
}

type DecodeWorkerResponse =
  | {
      id: number;
      ok: true;
      image: DecodedExrImage;
    }
  | {
      id: number;
      ok: false;
      error: DecodeErrorPayload | string;
    };

type DecodeWorkerErrorPayload = Extract<DecodeWorkerResponse, { ok: false }>['error'];

interface DecodeRequest {
  id: number;
  key: string;
  resource: AsyncResource<DecodedExrImage>;
  bytes: Uint8Array;
  filename: string | null;
  context: DecodeErrorContext;
  reservationReason: DecodeMemoryReservationReason;
  reservation: DecodeMemoryReservation | null;
  admissionState: 'ready' | 'waiting' | 'paused' | 'started';
  pauseTimer: ReturnType<typeof setTimeout> | null;
  onDecodeAdmissionState?: (state: DecodeAdmissionState) => void;
  resolve: (image: DecodedExrImage) => void;
  reject: (error: Error) => void;
  signal?: AbortSignal;
  abortListener?: () => void;
}

interface DecodeWorkerSlot {
  id: number;
  worker: Worker;
  active: DecodeRequest | null;
  retireWhenIdle: boolean;
  onMessage: (event: MessageEvent<DecodeWorkerResponse>) => void;
  onError: (event: ErrorEvent) => void;
  onMessageError: () => void;
}

let nextRequestId = 1;
let nextWorkerSlotId = 1;
let maxDecodeWorkers = getDefaultImageLoadWorkers();
let decodeWorkersUnavailable = false;
let decodeMemoryReservationManager = new DecodeMemoryReservationManager();
const decodeWorkersSupported = import.meta.env.MODE !== 'vscode';
const queuedDecodes: DecodeRequest[] = [];
const workerSlots: DecodeWorkerSlot[] = [];
const exrWasmUrl = resolveExrRuntimeWasmUrl();
export const DECODE_MEMORY_PRESSURE_RETRY_DELAY_MS = 5000;

configureExrRuntime({ wasmUrl: exrWasmUrl });

export function setDecodeMemoryReservationManager(manager: DecodeMemoryReservationManager): void {
  decodeMemoryReservationManager = manager;
  pumpDecodeQueue();
}

export function getDecodeMemoryReservationManager(): DecodeMemoryReservationManager {
  return decodeMemoryReservationManager;
}

export function retryDecodeMemoryAdmission(): void {
  for (const request of queuedDecodes) {
    if (request.admissionState === 'paused') {
      emitDecodeAdmissionState(request, 'retrying');
      request.admissionState = 'waiting';
      scheduleDecodeMemoryPressurePause(request);
    }
  }
  pumpDecodeQueue();
}

export async function loadExrOffMainThread(
  bytes: Uint8Array,
  options: DecodeBytesOptions = {}
): Promise<DecodedExrImage> {
  const context = createDecodeErrorContext(bytes, options.filename);
  if (options.signal) {
    throwIfAborted(options.signal, 'EXR decode was aborted.');
  }

  if (!decodeWorkersSupported || typeof Worker === 'undefined' || decodeWorkersUnavailable) {
    return await decodeOnMainThread(bytes, options, context);
  }

  try {
    ensureInitialDecodeWorkerSlot();
  } catch {
    decodeWorkersUnavailable = true;
    return await decodeOnMainThread(bytes, options, context);
  }

  const id = nextRequestId++;

  return await new Promise<DecodedExrImage>((resolve, reject) => {
    const request: DecodeRequest = {
      id,
      key: buildDecodeResourceKey(id),
      resource: pendingResource(buildDecodeResourceKey(id), id),
      bytes,
      filename: context.filename,
      context,
      reservationReason: options.reservationReason ?? 'active-open',
      reservation: null,
      admissionState: 'ready',
      pauseTimer: null,
      onDecodeAdmissionState: options.onDecodeAdmissionState,
      resolve,
      reject,
      signal: options.signal
    };

    attachAbortListener(request);
    queuedDecodes.push(request);
    pumpDecodeQueue();
  });
}

export function setMaxDecodeWorkers(workerCount: number): void {
  const normalized = normalizeImageLoadWorkers(workerCount);
  if (maxDecodeWorkers === normalized) {
    return;
  }

  maxDecodeWorkers = normalized;
  enforceDecodeWorkerLimit();
  pumpDecodeQueue();
}

export function disposeDecodeWorker(error: Error = createAbortError('EXR decode worker was terminated.')): void {
  for (const request of queuedDecodes.splice(0)) {
    rejectDecodeRequest(request, error);
  }

  for (const slot of [...workerSlots]) {
    if (slot.active) {
      const request = slot.active;
      slot.active = null;
      rejectDecodeRequest(request, error);
    }
    terminateDecodeWorkerSlot(slot);
  }

  decodeWorkersUnavailable = false;
}

async function decodeOnMainThread(
  bytes: Uint8Array,
  options: DecodeBytesOptions,
  context: DecodeErrorContext
): Promise<DecodedExrImage> {
  const signal = options.signal;
  const request = createMainThreadDecodeRequest(bytes, options, context);
  try {
    if (signal) {
      throwIfAborted(signal, 'EXR decode was aborted.');
    }
    await reserveMainThreadDecode(request);
    const image = await loadExr(bytes);
    if (signal) {
      throwIfAborted(signal, 'EXR decode was aborted.');
    }
    return image;
  } catch (error) {
    emitDecodeAdmissionState(
      request,
      'failed',
      error instanceof Error ? error : new Error('Failed to decode EXR.')
    );
    if (isAbortError(error)) {
      throw error;
    }
    throw createDecodeErrorFromPayload(createDecodeErrorPayload(error, context));
  } finally {
    cleanupDecodeRequest(request);
    pumpDecodeQueue();
  }
}

function ensureInitialDecodeWorkerSlot(): void {
  if (workerSlots.length > 0) {
    return;
  }

  workerSlots.push(createDecodeWorkerSlot());
}

function createDecodeWorkerSlot(): DecodeWorkerSlot {
  const worker = new ExrDecodeWorker();
  const slot: DecodeWorkerSlot = {
    id: nextWorkerSlotId++,
    worker,
    active: null,
    retireWhenIdle: false,
    onMessage: (event) => {
      handleWorkerMessage(slot, event.data);
    },
    onError: (event) => {
      handleWorkerFailure(
        slot,
        createDecodeErrorPayload(
          new Error(event.message || 'EXR decode worker failed.'),
          slot.active?.context ?? createEmptyDecodeContext()
        )
      );
    },
    onMessageError: () => {
      handleWorkerFailure(
        slot,
        createDecodeErrorPayload(
          new Error('EXR decode worker returned an unreadable response.'),
          slot.active?.context ?? createEmptyDecodeContext()
        )
      );
    }
  };

  worker.addEventListener('message', slot.onMessage);
  worker.addEventListener('error', slot.onError);
  worker.addEventListener('messageerror', slot.onMessageError);
  return slot;
}

function createMainThreadDecodeRequest(
  bytes: Uint8Array,
  options: DecodeBytesOptions,
  context: DecodeErrorContext
): DecodeRequest {
  const id = nextRequestId++;
  const key = buildDecodeResourceKey(id);
  return {
    id,
    key,
    resource: pendingResource(key, id),
    bytes,
    filename: context.filename,
    context,
    reservationReason: options.reservationReason ?? 'active-open',
    reservation: null,
    admissionState: 'ready',
    pauseTimer: null,
    onDecodeAdmissionState: options.onDecodeAdmissionState,
    resolve: () => {},
    reject: () => {},
    signal: options.signal
  };
}

async function reserveMainThreadDecode(request: DecodeRequest): Promise<void> {
  while (true) {
    const reservation = decodeMemoryReservationManager.reserveDecode(estimateDecodeMemoryReservation(request));
    if (reservation) {
      request.reservation = reservation;
      clearDecodeMemoryPressurePause(request);
      request.admissionState = 'started';
      emitDecodeAdmissionState(request, 'started');
      return;
    }

    markDecodeRequestWaitingForMemory(request);
    await waitForDecodeAdmissionRetryInterval(request.signal);
  }
}

function waitForDecodeAdmissionRetryInterval(signal: AbortSignal | undefined): Promise<void> {
  if (signal) {
    throwIfAborted(signal, 'EXR decode was aborted.');
  }

  let onAbort: (() => void) | null = null;
  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(resolve, 100);
    onAbort = (): void => {
      clearTimeout(timeout);
      reject(getAbortReason(signal));
    };

    signal?.addEventListener('abort', onAbort, { once: true });
  }).finally(() => {
    if (onAbort) {
      signal?.removeEventListener('abort', onAbort);
    }
    if (signal) {
      throwIfAborted(signal, 'EXR decode was aborted.');
    }
  });
}

function handleWorkerMessage(slot: DecodeWorkerSlot, response: DecodeWorkerResponse): void {
  const request = slot.active;
  if (!request || request.id !== response.id) {
    return;
  }

  slot.active = null;
  if (response.ok) {
    request.resource = successResource(request.key, response.image);
    cleanupDecodeRequest(request);
    request.resolve(response.image);
  } else {
    rejectDecodeRequest(
      request,
      createDecodeErrorFromPayload(normalizeWorkerErrorPayload(response.error, request.context))
    );
  }

  releaseDecodeWorkerSlot(slot);
  pumpDecodeQueue();
}

function handleWorkerFailure(slot: DecodeWorkerSlot, payload: DecodeErrorPayload): void {
  const request = slot.active;
  if (request) {
    slot.active = null;
    rejectDecodeRequest(request, createDecodeErrorFromPayload(payload));
  }

  terminateDecodeWorkerSlot(slot);
  pumpDecodeQueue();
}

function terminateDecodeWorkerSlot(slot: DecodeWorkerSlot): void {
  const index = workerSlots.indexOf(slot);
  if (index >= 0) {
    workerSlots.splice(index, 1);
  }

  slot.worker.removeEventListener('message', slot.onMessage);
  slot.worker.removeEventListener('error', slot.onError);
  slot.worker.removeEventListener('messageerror', slot.onMessageError);
  slot.worker.terminate();
}

function releaseDecodeWorkerSlot(slot: DecodeWorkerSlot): void {
  if (slot.retireWhenIdle || workerSlots.length > maxDecodeWorkers) {
    terminateDecodeWorkerSlot(slot);
  }
}

function enforceDecodeWorkerLimit(): void {
  for (const slot of [...workerSlots]) {
    if (workerSlots.length <= maxDecodeWorkers) {
      break;
    }
    if (!slot.active) {
      terminateDecodeWorkerSlot(slot);
    }
  }

  let excessActiveWorkers = Math.max(0, workerSlots.length - maxDecodeWorkers);
  for (let index = workerSlots.length - 1; index >= 0 && excessActiveWorkers > 0; index -= 1) {
    const slot = workerSlots[index];
    if (!slot || !slot.active) {
      continue;
    }

    slot.retireWhenIdle = true;
    excessActiveWorkers -= 1;
  }
}

function pumpDecodeQueue(): void {
  if (queuedDecodes.length === 0) {
    return;
  }

  while (queuedDecodes.length > 0 && getActiveDecodeCount() < maxDecodeWorkers) {
    markMemoryBlockedDecodeRequests();
    const reservation = reserveNextAdmissibleDecode();
    if (!reservation) {
      return;
    }
    const { request, reservation: decodeReservation } = reservation;

    if (request.signal?.aborted) {
      rejectDecodeRequest(request, getAbortReason(request.signal));
      continue;
    }

    const slot = takeDecodeWorkerSlot();
    if (!slot) {
      decodeMemoryReservationManager.releaseReservation(decodeReservation.id);
      request.reservation = null;
      queuedDecodes.unshift(request);
      return;
    }

    startDecodeRequest(slot, request);
  }
}

function reserveNextAdmissibleDecode(): { request: DecodeRequest; reservation: DecodeMemoryReservation } | null {
  for (let index = 0; index < queuedDecodes.length; index += 1) {
    const request = queuedDecodes[index];
    if (!request) {
      continue;
    }

    if (request.signal?.aborted) {
      queuedDecodes.splice(index, 1);
      rejectDecodeRequest(request, getAbortReason(request.signal));
      index -= 1;
      continue;
    }

    const estimate = estimateDecodeMemoryReservation(request);
    const reservation = decodeMemoryReservationManager.reserveDecode(estimate);
    if (!reservation) {
      markDecodeRequestWaitingForMemory(request);
      continue;
    }

    queuedDecodes.splice(index, 1);
    request.reservation = reservation;
    clearDecodeMemoryPressurePause(request);
    return { request, reservation };
  }

  return null;
}

function markMemoryBlockedDecodeRequests(): void {
  for (const request of queuedDecodes) {
    if (request.signal?.aborted) {
      continue;
    }
    if (!decodeMemoryReservationManager.canAdmitDecode(estimateDecodeMemoryReservation(request))) {
      markDecodeRequestWaitingForMemory(request);
    }
  }
}

function takeDecodeWorkerSlot(): DecodeWorkerSlot | null {
  const idleSlot = workerSlots.find((slot) => !slot.active && !slot.retireWhenIdle);
  if (idleSlot) {
    return idleSlot;
  }

  if (workerSlots.length >= maxDecodeWorkers) {
    return null;
  }

  try {
    const slot = createDecodeWorkerSlot();
    workerSlots.push(slot);
    return slot;
  } catch {
    return null;
  }
}

function getActiveDecodeCount(): number {
  return workerSlots.reduce((count, slot) => count + (slot.active ? 1 : 0), 0);
}

function startDecodeRequest(slot: DecodeWorkerSlot, request: DecodeRequest): void {
  slot.active = request;
  try {
    request.admissionState = 'started';
    emitDecodeAdmissionState(request, 'started');
    const transferableBytes = prepareTransferableBytes(request.bytes);
    slot.worker.postMessage(
      {
        id: request.id,
        bytes: transferableBytes.bytes,
        filename: request.filename,
        context: request.context,
        wasmUrl: exrWasmUrl
      } satisfies DecodeWorkerRequest,
      transferableBytes.transferables
    );
  } catch (error) {
    slot.active = null;
    rejectDecodeRequest(
      request,
      createDecodeErrorFromPayload(createDecodeErrorPayload(
        error instanceof Error ? error : new Error('Failed to start EXR decode worker.'),
        request.context
      ))
    );
    releaseDecodeWorkerSlot(slot);
    pumpDecodeQueue();
  }
}

function attachAbortListener(request: DecodeRequest): void {
  const signal = request.signal;
  if (!signal) {
    return;
  }

  request.abortListener = () => {
    abortDecodeRequest(request);
  };
  signal.addEventListener('abort', request.abortListener, { once: true });
}

function abortDecodeRequest(request: DecodeRequest): void {
  const error = getAbortReason(request.signal);
  const activeSlot = workerSlots.find((slot) => slot.active === request);
  if (activeSlot) {
    activeSlot.active = null;
    rejectDecodeRequest(request, error);
    terminateDecodeWorkerSlot(activeSlot);
    pumpDecodeQueue();
    return;
  }

  const queuedIndex = queuedDecodes.indexOf(request);
  if (queuedIndex < 0) {
    return;
  }
  queuedDecodes.splice(queuedIndex, 1);
  rejectDecodeRequest(request, error);
}

function rejectDecodeRequest(request: DecodeRequest, error: Error): void {
  if (isPendingMatch(request.resource, request.key, request.id)) {
    request.resource = errorResource(request.key, error);
  }
  emitDecodeAdmissionState(request, 'failed', error);
  cleanupDecodeRequest(request);
  request.reject(error);
}

function cleanupDecodeRequest(request: DecodeRequest): void {
  releaseDecodeReservation(request);
  clearDecodeMemoryPressurePause(request);
  if (request.signal && request.abortListener) {
    request.signal.removeEventListener('abort', request.abortListener);
    request.abortListener = undefined;
  }
}

function normalizeWorkerErrorPayload(
  error: DecodeWorkerErrorPayload,
  context: DecodeErrorContext
): DecodeErrorPayload {
  return typeof error === 'string'
    ? createDecodeErrorPayload(new Error(error), context)
    : error;
}

function getAbortReason(signal: AbortSignal | undefined): Error {
  return signal?.reason instanceof Error ? signal.reason : createAbortError('EXR decode was aborted.');
}

function createEmptyDecodeContext(): DecodeErrorContext {
  return {
    filename: null,
    byteSize: 0,
    headerSummary: null,
    unsupportedFeatureReason: null
  };
}

function buildDecodeResourceKey(id: number): string {
  return `decode:${id}`;
}

function estimateDecodeMemoryReservation(request: DecodeRequest): DecodeMemoryReservationEstimate {
  const sourceBytes = request.bytes.byteLength;
  const dimensions = estimateDecodeDimensions(request.context, sourceBytes);
  const estimatedDecodedBytes = dimensions
    ? dimensions.width * dimensions.height * dimensions.channelCount * 4
    : sourceBytes * 12;
  const estimatedScratchBytes = Math.max(sourceBytes, Math.ceil(estimatedDecodedBytes * 0.5));
  const estimatedFirstDisplayBytes = dimensions
    ? dimensions.width * dimensions.height * 4 * 2
    : Math.max(sourceBytes * 2, Math.ceil(estimatedDecodedBytes * 0.25));

  return {
    sourceBytes,
    estimatedDecodedBytes,
    estimatedScratchBytes,
    estimatedFirstDisplayBytes,
    reason: request.reservationReason
  };
}

function estimateDecodeDimensions(
  context: DecodeErrorContext,
  sourceBytes: number
): { width: number; height: number; channelCount: number } | null {
  const parts = context.headerSummary?.parts ?? [];
  let totalDecodedSamples = 0;
  let maxWidth = 0;
  let maxHeight = 0;

  for (const part of parts) {
    const box = parseExrBox2i(part.displayWindow ?? part.dataWindow);
    const channelCount = parseChannelCount(part.channels);
    if (!box || channelCount <= 0) {
      continue;
    }

    const width = Math.max(0, box.maxX - box.minX + 1);
    const height = Math.max(0, box.maxY - box.minY + 1);
    if (width <= 0 || height <= 0) {
      continue;
    }

    maxWidth = Math.max(maxWidth, width);
    maxHeight = Math.max(maxHeight, height);
    totalDecodedSamples += width * height * channelCount;
  }

  if (totalDecodedSamples <= 0 || maxWidth <= 0 || maxHeight <= 0) {
    return null;
  }

  const estimatedChannelCount = Math.max(1, Math.ceil(totalDecodedSamples / (maxWidth * maxHeight)));
  const sourceWeightedChannelCount = Math.max(estimatedChannelCount, Math.ceil(sourceBytes / (maxWidth * maxHeight * 4)));
  return {
    width: maxWidth,
    height: maxHeight,
    channelCount: sourceWeightedChannelCount
  };
}

function parseExrBox2i(value: string | null | undefined): { minX: number; minY: number; maxX: number; maxY: number } | null {
  const match = /^\[(-?\d+),(-?\d+)\]-\[(-?\d+),(-?\d+)\]$/u.exec(value?.trim() ?? '');
  if (!match) {
    return null;
  }

  const minX = Number(match[1]);
  const minY = Number(match[2]);
  const maxX = Number(match[3]);
  const maxY = Number(match[4]);
  return Number.isFinite(minX) && Number.isFinite(minY) && Number.isFinite(maxX) && Number.isFinite(maxY)
    ? { minX, minY, maxX, maxY }
    : null;
}

function parseChannelCount(value: string | null | undefined): number {
  const match = /^(\d+)/u.exec(value?.trim() ?? '');
  if (!match) {
    return 0;
  }

  const channelCount = Number(match[1]);
  return Number.isFinite(channelCount) ? Math.max(0, Math.floor(channelCount)) : 0;
}

function markDecodeRequestWaitingForMemory(request: DecodeRequest): void {
  if (request.admissionState === 'waiting' || request.admissionState === 'paused') {
    return;
  }

  request.admissionState = 'waiting';
  emitDecodeAdmissionState(request, 'waitingForMemory');
  scheduleDecodeMemoryPressurePause(request);
}

function scheduleDecodeMemoryPressurePause(request: DecodeRequest): void {
  clearDecodeMemoryPressurePause(request);
  request.pauseTimer = setTimeout(() => {
    if (queuedDecodes.includes(request) && request.admissionState === 'waiting') {
      request.admissionState = 'paused';
      emitDecodeAdmissionState(request, 'pausedMemoryPressure');
    }
  }, DECODE_MEMORY_PRESSURE_RETRY_DELAY_MS);
}

function clearDecodeMemoryPressurePause(request: DecodeRequest): void {
  if (!request.pauseTimer) {
    return;
  }

  clearTimeout(request.pauseTimer);
  request.pauseTimer = null;
}

function releaseDecodeReservation(request: DecodeRequest): void {
  const reservationId = request.reservation?.id ?? null;
  if (!reservationId) {
    return;
  }

  request.reservation = null;
  decodeMemoryReservationManager.releaseReservation(reservationId);
  emitDecodeAdmissionState(request, 'released');
}

function emitDecodeAdmissionState(
  request: DecodeRequest,
  phase: DecodeAdmissionState['phase'],
  error?: Error
): void {
  if (!request.onDecodeAdmissionState) {
    return;
  }

  if (phase === 'failed') {
    request.onDecodeAdmissionState({
      phase,
      filename: request.filename,
      error: error ?? new Error('EXR decode failed.')
    });
    return;
  }

  request.onDecodeAdmissionState({
    phase,
    filename: request.filename
  });
}

function prepareTransferableBytes(bytes: Uint8Array): { bytes: Uint8Array; transferables: Transferable[] } {
  if (bytes.buffer instanceof ArrayBuffer && bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength) {
    return {
      bytes,
      transferables: [bytes.buffer]
    };
  }

  const copy = new Uint8Array(bytes);
  return {
    bytes: copy,
    transferables: [copy.buffer]
  };
}
