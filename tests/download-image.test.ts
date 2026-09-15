import { afterEach, describe, expect, it, vi } from 'vitest';
import { downloadImageBytes } from '../src/download-image';

describe('image download', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('reports streamed progress before completion and preserves all bytes', async () => {
    let stream!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({ start(controller) { stream = controller; } });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { headers: { 'Content-Length': '4' } })));
    const progress = vi.fn();
    const pending = downloadImageBytes('/image.exr', new AbortController().signal, progress);
    expect(progress).toHaveBeenLastCalledWith({ downloadedBytes: 0, totalBytes: null });
    await vi.waitFor(() => expect(progress).toHaveBeenLastCalledWith({ downloadedBytes: 0, totalBytes: 4 }));
    stream.enqueue(new Uint8Array([1, 2]));
    await vi.waitFor(() => expect(progress).toHaveBeenLastCalledWith({ downloadedBytes: 2, totalBytes: 4 }));
    stream.enqueue(new Uint8Array([3, 4]));
    stream.close();
    expect(await pending).toEqual(new Uint8Array([1, 2, 3, 4]));
    expect(progress).toHaveBeenLastCalledWith({ downloadedBytes: 4, totalBytes: 4 });
    expect(body.locked).toBe(false);
  });

  it.each<Record<string, string>>([
    {},
    { 'Content-Length': 'invalid' },
    { 'Content-Length': '0' },
    { 'Content-Length': '-1' },
    { 'Content-Length': '1' },
    { 'Content-Length': '4', 'Content-Encoding': 'gzip' }
  ])('keeps progress indeterminate for unavailable or unreliable lengths: %j', async (headers) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([1, 2]), { headers })));
    const progress = vi.fn();
    await downloadImageBytes('/image.exr', new AbortController().signal, progress);
    expect(progress).toHaveBeenCalledWith({ downloadedBytes: 2, totalBytes: null });
  });

  it('throttles chunk updates while always reporting completion', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let index = 0; index < 50; index += 1) {
          controller.enqueue(new Uint8Array([index]));
        }
        controller.close();
      }
    });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body)));
    vi.spyOn(performance, 'now').mockReturnValue(0);
    const progress = vi.fn();
    expect(await downloadImageBytes('/image.exr', new AbortController().signal, progress)).toHaveLength(50);
    expect(progress).toHaveBeenCalledTimes(4);
    expect(progress).toHaveBeenLastCalledWith({ downloadedBytes: 50, totalBytes: 50 });
  });

  it('reports the latest bytes even when the connection pauses between chunks', async () => {
    let stream!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({ start(controller) { stream = controller; } });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body)));
    const progress = vi.fn();
    const pending = downloadImageBytes('/image.exr', new AbortController().signal, progress);
    stream.enqueue(new Uint8Array([1]));
    await vi.waitFor(() => expect(progress).toHaveBeenLastCalledWith({ downloadedBytes: 1, totalBytes: null }));
    stream.enqueue(new Uint8Array([2]));
    await vi.waitFor(() => expect(progress).toHaveBeenLastCalledWith({ downloadedBytes: 2, totalBytes: null }));
    stream.close();
    await pending;
  });

  it('cancels an in-flight read and releases its stream', async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ cancel });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body)));
    const abort = new AbortController();
    const pending = downloadImageBytes('/image.exr', abort.signal, vi.fn());
    const rejection = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(body.locked).toBe(true));
    abort.abort();
    await rejection;
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(body.locked).toBe(false);
  });

  it('propagates HTTP and interrupted stream errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })));
    await expect(downloadImageBytes('/missing.exr', new AbortController().signal, vi.fn()))
      .rejects.toThrow('Failed to load /missing.exr (404)');
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.error(new Error('Disconnected')); } });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body)));
    await expect(downloadImageBytes('/image.exr', new AbortController().signal, vi.fn())).rejects.toThrow('Disconnected');
    expect(body.locked).toBe(false);
  });
});
