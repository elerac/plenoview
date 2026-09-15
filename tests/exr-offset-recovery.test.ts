import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readExrHeaders } from '../src/exr-metadata';
import { recoverExrScanlineOffsets } from '../src/exr-offset-recovery';
import { decodeRawExr } from '../src/exr-runtime';
import { CompressionMethod, ExrEncoder, SamplePrecision } from './helpers/exr-fixture-encoder';

describe('EXR scanline offset recovery', () => {
  it('leaves complete offset tables alone', () => {
    const bytes = makeFixture();
    expect(recoverExrScanlineOffsets(bytes)).toBeNull();
  });

  it.each([false, true])('recovers missing offsets (partial table: %s) without modifying input', async (partial) => {
    const original = makeFixture();
    const bytes = Uint8Array.from(original);
    clearOffsets(bytes, partial);
    const before = Uint8Array.from(bytes);

    expect(applyRecovery(bytes)).toEqual(original);
    expect(await decodeRawExr(bytes)).toEqual(await decodeRawExr(original));
    expect(bytes).toEqual(before);
  });

  it('handles an input view with a nonzero byte offset', async () => {
    const original = makeFixture();
    const storage = new Uint8Array(original.length + 30).fill(0xab);
    const bytes = storage.subarray(13, 13 + original.length);
    bytes.set(original);
    clearOffsets(bytes);
    const before = Uint8Array.from(storage);

    expect(applyRecovery(bytes)).toEqual(original);
    expect(await decodeRawExr(bytes)).toEqual(await decodeRawExr(original));
    expect(storage).toEqual(before);
  });

  it('uses chunk coordinates for descending scanlines with a negative data-window origin', async () => {
    const original = makeFixture();
    const { headers } = readExrHeaders(original);
    for (const name of ['dataWindow', 'displayWindow']) {
      const value = headers[0].attributes.find((attribute) => attribute.name === name)!.value;
      const view = toView(value);
      view.setInt32(4, -9, true);
      view.setInt32(12, -7, true);
    }
    headers[0].attributes.find((attribute) => attribute.name === 'lineOrder')!.value[0] = 1;
    const view = toView(original);
    const { offsets } = inspectFixture(original);
    offsets.forEach((offset, row) => view.setInt32(offset, row - 9, true));
    const reordered = reorderChunks(original, [2, 1, 0]);
    const bytes = Uint8Array.from(reordered);
    clearOffsets(bytes);

    expect(applyRecovery(bytes)).toEqual(reordered);
    expect(await decodeRawExr(bytes)).toEqual(await decodeRawExr(original));
  });

  it('recovers interleaved multipart chunks in their own header and row order', async () => {
    const original = makeFixture(true);
    const reordered = reorderChunks(original, [5, 2, 4, 1, 3, 0]);
    const bytes = Uint8Array.from(reordered);
    clearOffsets(bytes, true);

    expect(applyRecovery(bytes)).toEqual(reordered);
    const decoded = await decodeRawExr(bytes);
    expect(decoded).toEqual(await decodeRawExr(original));
    expect(decoded.layers.map((layer) => layer.name)).toEqual(['beauty', 'depth']);
  });

  it('recovers real PIZ blocks with exactly the same decoded channel values', async () => {
    const original = new Uint8Array(readFileSync(new URL('../public/cbox_rgb.exr', import.meta.url)));
    const { offsetTableStart } = readExrHeaders(original);
    const bytes = Uint8Array.from(original);
    bytes.fill(0, offsetTableStart, offsetTableStart + 8 * 8); // 256 rows / 32 rows per PIZ block
    const before = Uint8Array.from(bytes);

    expect(applyRecovery(bytes)).toEqual(original);
    const expected = await decodeRawExr(original);
    const actual = await decodeRawExr(bytes);
    expect([actual.width, actual.height]).toEqual([256, 256]);
    expect(actual.layers[0].channelNames).toEqual(expected.layers[0].channelNames);
    for (const channel of expected.layers[0].channelNames) {
      expect(Buffer.from(actual.layers[0].pixelsByChannel[channel].buffer).equals(
        Buffer.from(expected.layers[0].pixelsByChannel[channel].buffer)
      )).toBe(true);
    }
    expect(bytes).toEqual(before);
  });

  it.each([
    ['truncated payload', (bytes: Uint8Array) => bytes.subarray(0, bytes.length - 1)],
    ['missing whole block', (bytes: Uint8Array, offsets: number[]) => bytes.subarray(0, offsets[2])],
    ['duplicate row', (bytes: Uint8Array, offsets: number[]) => {
      toView(bytes).setInt32(offsets[1], 0, true);
      return bytes;
    }],
    ['out-of-range row', (bytes: Uint8Array, offsets: number[]) => {
      toView(bytes).setInt32(offsets[1], 3, true);
      return bytes;
    }],
    ['negative size', (bytes: Uint8Array, offsets: number[]) => {
      toView(bytes).setInt32(offsets[1] + 4, -1, true);
      return bytes;
    }],
    ['oversized payload', (bytes: Uint8Array, offsets: number[]) => {
      toView(bytes).setInt32(offsets[1] + 4, 0x7fff_ffff, true);
      return bytes;
    }],
    ['conflicting existing offset', (bytes: Uint8Array, offsets: number[], table: number) => {
      toView(bytes).setBigUint64(table + 8, BigInt(offsets[1] + 1), true);
      return bytes;
    }],
    ['offset above uint32', (bytes: Uint8Array, _offsets: number[], table: number) => {
      toView(bytes).setBigUint64(table + 8, 0x1_0000_0000n, true);
      return bytes;
    }]
  ] as const)('rejects %s and preserves normal decode failures', async (_name, damage) => {
    const bytes = makeFixture();
    const { offsets, table } = inspectFixture(bytes);
    clearOffsets(bytes);
    const damaged = damage(bytes, offsets, table);
    const before = Uint8Array.from(damaged);

    expect(recoverExrScanlineOffsets(damaged)).toBeNull();
    await expect(decodeRawExr(damaged)).rejects.toThrow(/TinyEXR decode failed/u);
    expect(damaged).toEqual(before);
  });

  it('does not conceal corrupt compressed pixel data behind a recovered table', async () => {
    const bytes = new Uint8Array(readFileSync(new URL('../public/cbox_rgb.exr', import.meta.url)));
    const { offsetTableStart } = readExrHeaders(bytes);
    const firstChunk = Number(toView(bytes).getBigUint64(offsetTableStart, true));
    const size = toView(bytes).getInt32(firstChunk + 4, true);
    bytes.fill(0, offsetTableStart, offsetTableStart + 8 * 8);
    bytes.fill(0xff, firstChunk + 8, firstChunk + 8 + size);

    expect(recoverExrScanlineOffsets(bytes)).not.toBeNull();
    await expect(decodeRawExr(bytes)).rejects.toThrow(/TinyEXR decode failed/u);
    expect((await decodeRawExr(makeFixture())).width).toBe(2);
  });

  it.each([-1, 2])('rejects invalid multipart chunk part number %s', (part) => {
    const bytes = makeFixture(true);
    const { offsets } = inspectFixture(bytes);
    clearOffsets(bytes);
    toView(bytes).setInt32(offsets[0], part, true);
    expect(recoverExrScanlineOffsets(bytes)).toBeNull();
  });

  it('rejects a chunk count inconsistent with the data window', () => {
    const bytes = makeFixture(true);
    clearOffsets(bytes);
    const { headers } = readExrHeaders(bytes);
    const count = headers[0].attributes.find((attribute) => attribute.name === 'chunkCount')!.value;
    toView(count).setInt32(0, 2, true);
    expect(recoverExrScanlineOffsets(bytes)).toBeNull();
  });

  it.each([0x0200, 0x0800, 0x2000])('does not repair tiled, deep, or unknown flags: %s', (flag) => {
    const bytes = makeFixture();
    clearOffsets(bytes);
    toView(bytes).setUint32(4, 2 | flag, true);
    expect(recoverExrScanlineOffsets(bytes)).toBeNull();
  });

  it('bounds recovery for huge declared image dimensions', () => {
    const bytes = makeFixture();
    clearOffsets(bytes);
    const { headers } = readExrHeaders(bytes);
    const window = headers[0].attributes.find((attribute) => attribute.name === 'dataWindow')!.value;
    toView(window).setInt32(4, -0x8000_0000, true);
    toView(window).setInt32(12, 0x7fff_ffff, true);
    expect(recoverExrScanlineOffsets(bytes)).toBeNull();
  });

  it('does not recover truncated headers or tables', () => {
    const bytes = makeFixture();
    const { table } = inspectFixture(bytes);
    clearOffsets(bytes);
    for (const end of [0, 7, table - 1, table + 1, table + 23]) {
      expect(recoverExrScanlineOffsets(bytes.subarray(0, end))).toBeNull();
    }
  });
});

function makeFixture(multipart = false): Uint8Array {
  const encoder = new ExrEncoder(2, 3);
  encoder.addLayer('beauty', ['R', 'S1.R'], new Float32Array([
    1, -1, 2, -2, 3, -3, 4, -4, 5, -5, 6, -6
  ]), SamplePrecision.F32, CompressionMethod.None);
  if (multipart) {
    encoder.addLayer('depth', ['Z'], new Float32Array([10, 20, 30, 40, 50, 60]),
      SamplePrecision.F32, CompressionMethod.None);
  }
  return encoder.encode();
}

function inspectFixture(bytes: Uint8Array): { table: number; offsets: number[] } {
  const { offsetTableStart: table, headers } = readExrHeaders(bytes);
  const view = toView(bytes);
  const offsets = Array.from({ length: headers.length * 3 }, (_, i) => Number(view.getBigUint64(table + i * 8, true)));
  return { table, offsets };
}

function clearOffsets(bytes: Uint8Array, partial = false): void {
  const { table, offsets } = inspectFixture(bytes);
  offsets.forEach((_offset, i) => {
    if (!partial || i % 2 === 0) bytes.fill(0, table + i * 8, table + (i + 1) * 8);
  });
}

function reorderChunks(bytes: Uint8Array, order: number[]): Uint8Array {
  const { table, offsets } = inspectFixture(bytes);
  const result = Uint8Array.from(bytes);
  let position = offsets[0];
  for (const index of order) {
    const chunk = bytes.subarray(offsets[index], offsets[index + 1] ?? bytes.length);
    result.set(chunk, position);
    toView(result).setBigUint64(table + index * 8, BigInt(position), true);
    position += chunk.length;
  }
  return result;
}

function applyRecovery(bytes: Uint8Array): Uint8Array {
  const recovered = recoverExrScanlineOffsets(bytes);
  expect(recovered).not.toBeNull();
  const result = Uint8Array.from(bytes);
  const view = toView(result);
  recovered!.offsets.forEach((offset, index) => {
    view.setBigUint64(recovered!.tableOffset + index * 8, BigInt(offset), true);
  });
  return result;
}

function toView(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}
