/*
 * Small independent OpenEXR writer used only by tests. It intentionally emits
 * uncompressed FLOAT scanline files so decoder tests do not depend on the
 * production TinyEXR implementation or the retired exrs WASM encoder.
 */

const OPENEXR_MAGIC = 0x01312f76;
const OPENEXR_VERSION = 2;
const LONG_NAMES_FLAG = 0x0400;
const MULTIPART_FLAG = 0x1000;
const TEXT_ENCODER = new TextEncoder();

export const SamplePrecision = {
  F32: 'f32'
} as const;

export const CompressionMethod = {
  None: 0,
  Zip16: 3
} as const;

interface FixturePart {
  name: string | null;
  channelNames: string[];
  pixels: Float32Array;
}

interface EncodedChunk {
  part: number;
  row: number;
  bytes: Uint8Array;
}

export class ExrEncoder {
  private readonly parts: FixturePart[] = [];

  constructor(
    private readonly width: number,
    private readonly height: number
  ) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
      throw new Error(`Invalid fixture EXR dimensions: ${width}x${height}.`);
    }
  }

  addLayer(
    name: string | null,
    channelNames: string[],
    pixels: Float32Array,
    precision: typeof SamplePrecision.F32,
    _compression: number
  ): void {
    if (precision !== SamplePrecision.F32) {
      throw new Error('The fixture EXR writer only supports FLOAT channels.');
    }
    if (channelNames.length === 0 || new Set(channelNames).size !== channelNames.length) {
      throw new Error('Fixture EXR channel names must be non-empty and unique.');
    }
    const expectedLength = this.width * this.height * channelNames.length;
    if (pixels.length !== expectedLength) {
      throw new Error(`Expected ${expectedLength} fixture values, got ${pixels.length}.`);
    }
    this.parts.push({
      name,
      channelNames: [...channelNames],
      pixels: new Float32Array(pixels)
    });
  }

  encode(): Uint8Array {
    if (this.parts.length === 0) {
      throw new Error('Fixture EXR has no parts.');
    }
    return encodeFixtureExr(this.width, this.height, this.parts);
  }

  free(): void {
    this.parts.length = 0;
  }
}

function encodeFixtureExr(width: number, height: number, parts: FixturePart[]): Uint8Array {
  const multipart = parts.length > 1;
  const preamble = concatBytes([
    uint32(OPENEXR_MAGIC),
    uint32(OPENEXR_VERSION | LONG_NAMES_FLAG | (multipart ? MULTIPART_FLAG : 0))
  ]);
  const headers = parts.map((part, index) => encodeHeader(width, height, part, multipart, index));
  const headerBlock = concatBytes(multipart ? [...headers, new Uint8Array([0])] : headers);
  const chunks = parts.flatMap((part, partIndex) =>
    encodePartChunks(width, height, part, partIndex, multipart)
  );
  const offsetTableLength = chunks.length * 8;
  let chunkOffset = preamble.length + headerBlock.length + offsetTableLength;
  const offsets: Uint8Array[] = [];
  for (const chunk of chunks) {
    offsets.push(uint64(chunkOffset));
    chunkOffset += chunk.bytes.length;
  }

  return concatBytes([
    preamble,
    headerBlock,
    ...offsets,
    ...chunks.map((chunk) => chunk.bytes)
  ]);
}

function encodeHeader(
  width: number,
  height: number,
  part: FixturePart,
  multipart: boolean,
  partIndex: number
): Uint8Array {
  const attributes = [
    attribute('channels', 'chlist', encodeChannelList(part.channelNames)),
    attribute('compression', 'compression', new Uint8Array([0])),
    attribute('dataWindow', 'box2i', box2i(width, height)),
    attribute('displayWindow', 'box2i', box2i(width, height)),
    attribute('lineOrder', 'lineOrder', new Uint8Array([0])),
    attribute('pixelAspectRatio', 'float', float32(1)),
    attribute('screenWindowCenter', 'v2f', concatBytes([float32(0), float32(0)])),
    attribute('screenWindowWidth', 'float', float32(1))
  ];

  if (multipart) {
    attributes.push(
      attribute('name', 'string', ascii(part.name || `part${partIndex}`)),
      attribute('type', 'string', ascii('scanlineimage')),
      attribute('version', 'int', int32(1)),
      attribute('chunkCount', 'int', int32(height))
    );
  }

  return concatBytes([...attributes, new Uint8Array([0])]);
}

function encodeChannelList(channelNames: string[]): Uint8Array {
  const entries = [...channelNames]
    .sort(compareNames)
    .map((name) => concatBytes([
      cString(name),
      int32(2),
      new Uint8Array([0, 0, 0, 0]),
      int32(1),
      int32(1)
    ]));
  return concatBytes([...entries, new Uint8Array([0])]);
}

function encodePartChunks(
  width: number,
  height: number,
  part: FixturePart,
  partIndex: number,
  multipart: boolean
): EncodedChunk[] {
  const sortedChannels = part.channelNames
    .map((name, originalIndex) => ({ name, originalIndex }))
    .sort((left, right) => compareNames(left.name, right.name));
  const channelCount = part.channelNames.length;
  const chunks: EncodedChunk[] = [];

  for (let row = 0; row < height; row += 1) {
    const pixelBytes = new Uint8Array(width * channelCount * 4);
    const view = new DataView(pixelBytes.buffer);
    let offset = 0;
    for (const channel of sortedChannels) {
      for (let column = 0; column < width; column += 1) {
        const pixelIndex = row * width + column;
        const value = part.pixels[pixelIndex * channelCount + channel.originalIndex] ?? 0;
        view.setFloat32(offset, value, true);
        offset += 4;
      }
    }
    const header = multipart
      ? concatBytes([int32(partIndex), int32(row), int32(pixelBytes.length)])
      : concatBytes([int32(row), int32(pixelBytes.length)]);
    chunks.push({ part: partIndex, row, bytes: concatBytes([header, pixelBytes]) });
  }
  return chunks;
}

function attribute(name: string, type: string, value: Uint8Array): Uint8Array {
  return concatBytes([cString(name), cString(type), int32(value.length), value]);
}

function box2i(width: number, height: number): Uint8Array {
  return concatBytes([int32(0), int32(0), int32(width - 1), int32(height - 1)]);
}

function cString(value: string): Uint8Array {
  return concatBytes([ascii(value), new Uint8Array([0])]);
}

function ascii(value: string): Uint8Array {
  return TEXT_ENCODER.encode(value);
}

function int32(value: number): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setInt32(0, value, true);
  return bytes;
}

function uint32(value: number): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, true);
  return bytes;
}

function uint64(value: number): Uint8Array {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, BigInt(value), true);
  return bytes;
}

function float32(value: number): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setFloat32(0, value, true);
  return bytes;
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const length = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

function compareNames(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
