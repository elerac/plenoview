import { readExrHeaders, type ParsedExrHeader } from './exr-metadata';

// Match the supported scanline codecs in third_party/tinyexr/src/exr_core.c.
// DWAA/DWAB stay unsupported, as do deep parts and tiled offset recovery.
const LINES_PER_BLOCK = [1, 1, 1, 16, 32, 16, 32, 32, 0, 0, 256, 32, 32];
const SCANLINE_VERSION_FLAGS = 0x0400 | 0x1000; // long names and multipart

interface ScanlinePart {
  minY: number;
  maxY: number;
  linesPerBlock: number;
  chunkCount: number;
  firstChunk: number;
}

interface RecoveredOffsets {
  tableOffset: number;
  offsets: Uint32Array;
}

/**
 * Recover zero offset-table entries left by an unfinished EXR writer. TinyEXR
 * does not perform this recovery itself. Scan complete chunks without touching
 * their compressed payloads; the decoder still validates those payloads.
 *
 * Return a small replacement table only after finding every expected chunk
 * exactly once and checking all existing nonzero offsets. The caller applies
 * it to its private WASM input copy, leaving the original bytes unchanged.
 */
export function recoverExrScanlineOffsets(bytes: Uint8Array): RecoveredOffsets | null {
  try {
    return scanOffsets(bytes);
  } catch {
    // Malformed headers retain the normal TinyEXR error and unsupported-feature
    // reporting. Recovery must never turn partial pixel data into a valid image.
    return null;
  }
}

function scanOffsets(bytes: Uint8Array): RecoveredOffsets | null {
  // The runtime accepts at most 2 GiB, so recovered offsets fit in uint32.
  if (bytes.byteLength > 0x7fff_ffff) return null;
  const { headers, versionField, isMultipart, offsetTableStart } = readExrHeaders(bytes);
  if ((versionField & ~SCANLINE_VERSION_FLAGS) !== 2 || headers.length === 0) return null;

  const parts: ScanlinePart[] = [];
  const chunkHeaderSize = isMultipart ? 12 : 8;
  const maxChunks = Math.floor((bytes.byteLength - offsetTableStart) / (8 + chunkHeaderSize));
  let totalChunks = 0;
  for (const header of headers) {
    const part = readScanlinePart(header, isMultipart, totalChunks);
    if (!part) return null;
    totalChunks += part.chunkCount;
    if (totalChunks > maxChunks) return null;
    parts.push(part);
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let hasMissingOffset = false;
  for (let i = 0; i < totalChunks; i += 1) {
    const entry = offsetTableStart + i * 8;
    if (view.getUint32(entry + 4, true) !== 0) return null;
    if (view.getUint32(entry, true) === 0) hasMissingOffset = true;
  }
  if (!hasMissingOffset) return null;

  const offsets = new Uint32Array(totalChunks);
  let position = offsetTableStart + totalChunks * 8;
  for (let i = 0; i < totalChunks; i += 1) {
    if (position + chunkHeaderSize > bytes.byteLength) return null;
    const partIndex = isMultipart ? view.getInt32(position, true) : 0;
    const part = parts[partIndex];
    if (!part) return null;
    const rowOffset = position + (isMultipart ? 4 : 0);
    const y = view.getInt32(rowOffset, true);
    const size = view.getInt32(rowOffset + 4, true);
    if (y < part.minY || y > part.maxY || (y - part.minY) % part.linesPerBlock !== 0 ||
        size < 0 || size > bytes.byteLength - position - chunkHeaderSize) return null;

    // Table order is increasing y regardless of the order chunks were written.
    const index = part.firstChunk + (y - part.minY) / part.linesPerBlock;
    const existing = view.getUint32(offsetTableStart + index * 8, true);
    if (offsets[index] !== 0 || (existing !== 0 && existing !== position)) return null;
    offsets[index] = position;
    position += chunkHeaderSize + size;
  }
  if (position !== bytes.byteLength) return null;
  return { tableOffset: offsetTableStart, offsets };
}

function readScanlinePart(
  header: ParsedExrHeader,
  isMultipart: boolean,
  firstChunk: number
): ScanlinePart | null {
  const attributes = new Map(header.attributes.map((attribute) => [attribute.name, attribute]));
  if (attributes.size !== header.attributes.length || attributes.has('tiles')) return null;
  const type = attributes.get('type');
  if (type) {
    if (type.type !== 'string' || new TextDecoder().decode(type.value) !== 'scanlineimage') return null;
  } else if (isMultipart) {
    return null;
  }
  const compression = attributes.get('compression');
  const window = attributes.get('dataWindow');
  if (compression?.type !== 'compression' || compression.value.length !== 1 ||
      window?.type !== 'box2i' || window.value.length !== 16) return null;
  const linesPerBlock = LINES_PER_BLOCK[compression.value[0]];
  if (!linesPerBlock) return null;

  const view = new DataView(window.value.buffer, window.value.byteOffset, window.value.byteLength);
  const minY = view.getInt32(4, true);
  const maxY = view.getInt32(12, true);
  if (maxY < minY || view.getInt32(8, true) < view.getInt32(0, true)) return null;
  const chunkCount = Math.ceil((maxY - minY + 1) / linesPerBlock);
  const declaredCount = attributes.get('chunkCount');
  if (declaredCount) {
    if (declaredCount.type !== 'int' || declaredCount.value.length !== 4) return null;
    const countView = new DataView(declaredCount.value.buffer, declaredCount.value.byteOffset, 4);
    if (countView.getInt32(0, true) !== chunkCount) return null;
  } else if (isMultipart) {
    return null;
  }
  return { minY, maxY, linesPerBlock, chunkCount, firstChunk };
}
