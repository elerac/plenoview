import {
  discardMaterializedChannel,
  getChannelDenseArray,
  getChannelReadView,
  readChannelValue
} from '../../channel-storage';
import {
  DISPLAY_SOURCE_SLOT_COUNT,
  type DisplaySourceBinding
} from '../../display/bindings';
import { buildSelectedDisplayTexture } from '../../display/materialize-cpu';
import {
  buildSpectralStokesComponentChannels,
  detectSpectralStokesChannelGroups,
  parseSpectralRgbSourceName,
  parseSpectralStokesRgbSourceName,
  type SpectralStokesComponent
} from '../../spectral';
import {
  buildReflectanceSpectralRgbCoefficients,
  readSignedSpectralRgbSampleAtIndex,
  resolveSpectralRgbChannels
} from '../../spectral-color';
import {
  detectMuellerMatrixChannels,
  detectRgbMuellerMatrixChannels,
  MUELLER_MATRIX_ELEMENTS,
  parseMuellerMatrixSourceName,
  resolveMuellerMatrixDisplaySize,
  resolveRgbMuellerMatrixChannelArrays,
  type ResolvedRgbMuellerMatrixChannels,
  type MuellerMatrixElement
} from '../../mueller';
import type { ResidentChannelUpload } from '../../display-cache';
import { buildNextFloatMipLevel } from '../float-mipmap';
import { predictTextureStorageBytes } from '../texture-memory';
import type { DepthSource, DepthSourceGeometry } from '../../depth';
import type { ChannelRecognitionNameRules } from '../../channel-recognition-name-rules';
import type { DecodedLayer } from '../../types';
import {
  DEPTH_POSITION_Y_TEXTURE_UNIT,
  DEPTH_POSITION_Z_TEXTURE_UNIT,
  DEPTH_TEXTURE_UNIT
} from './constants';
import type { GlImageRendererState, LayerSourceTextures } from './types';

export function createZeroTexture(
  gl: WebGL2RenderingContext,
  smoothFloatMinification: boolean
): WebGLTexture {
  const zeroTexture = gl.createTexture();
  if (!zeroTexture) {
    throw new Error('Failed to create zero texture.');
  }

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, zeroTexture);
  configureSourceTexture(gl, smoothFloatMinification);
  uploadFloatTextureLevels(gl, {
    internalFormat: gl.R32F,
    format: gl.RED,
    width: 1,
    height: 1,
    components: 1,
    pixels: new Float32Array([0]),
    includeMipmaps: smoothFloatMinification
  });

  return zeroTexture;
}

export function ensureLayerChannelsResident(
  state: GlImageRendererState,
  sessionId: string,
  layerIndex: number,
  width: number,
  height: number,
  layer: DecodedLayer,
  channelNames: string[],
  channelRecognitionNameRules?: ChannelRecognitionNameRules
): ResidentChannelUpload[] {
  const layerTextures = getOrCreateLayerSourceTextures(state, sessionId, layerIndex, width, height, layer);
  const uploads: ResidentChannelUpload[] = [];

  try {
    for (const channelName of channelNames) {
      if (!channelName || layerTextures.textureByChannel.has(channelName)) {
        continue;
      }

      const spectralSeriesKey = parseSpectralRgbSourceName(channelName);
      if (spectralSeriesKey !== null) {
        uploads.push(uploadSpectralRgbSourceTexture(
          state,
          layerTextures,
          width,
          height,
          layer,
          channelName,
          spectralSeriesKey,
          channelRecognitionNameRules
        ));
        continue;
      }

      const spectralStokesComponent = parseSpectralStokesRgbSourceName(channelName);
      if (spectralStokesComponent !== null) {
        uploads.push(uploadSpectralStokesRgbSourceTexture(
          state,
          layerTextures,
          width,
          height,
          layer,
          channelName,
          spectralStokesComponent,
          channelRecognitionNameRules
        ));
        continue;
      }

      const muellerMatrixSource = parseMuellerMatrixSourceName(channelName);
      if (muellerMatrixSource !== null) {
        uploads.push(uploadMuellerMatrixSourceTexture(
          state,
          layerTextures,
          width,
          height,
          layer,
          channelName,
          muellerMatrixSource,
          channelRecognitionNameRules
        ));
        continue;
      }

      if (layer.channelStorage.channelIndexByName[channelName] === undefined) {
        continue;
      }

      const denseChannel = getChannelDenseArray(layer, channelName);
      if (!denseChannel) {
        continue;
      }

      const materializedBytes = layer.channelStorage.kind === 'interleaved-f32' ? denseChannel.byteLength : 0;
      let texture: WebGLTexture | null = null;
      try {
        texture = state.gl.createTexture();
        if (!texture) {
          throw new Error('Failed to create source texture.');
        }

        state.gl.bindTexture(state.gl.TEXTURE_2D, texture);
        configureSourceTexture(state.gl, state.smoothFloatMinification);
        uploadFloatTextureLevels(state.gl, {
          internalFormat: state.gl.R32F,
          format: state.gl.RED,
          width,
          height,
          components: 1,
          pixels: denseChannel,
          includeMipmaps: state.smoothFloatMinification
        });
        layerTextures.textureByChannel.set(channelName, texture);
        uploads.push({
          channelName,
          textureBytes: predictR32fTextureBytes(width, height, state.smoothFloatMinification),
          materializedBytes,
          resourceKind: 'source-texture'
        });
      } catch (error) {
        if (texture) {
          state.gl.deleteTexture(texture);
        }
        if (layer.channelStorage.kind === 'interleaved-f32') {
          discardMaterializedChannel(layer, channelName);
        }
        throw error;
      }
    }
  } catch (error) {
    for (const upload of uploads) {
      discardChannelSourceTexture(state, sessionId, layerIndex, upload.channelName);
    }
    pruneEmptyLayerSourceTextures(state, sessionId, layerIndex, layerTextures);
    throw error;
  }

  return uploads;
}

function uploadMuellerMatrixSourceTexture(
  state: GlImageRendererState,
  layerTextures: LayerSourceTextures,
  width: number,
  height: number,
  layer: DecodedLayer,
  sourceName: string,
  source: NonNullable<ReturnType<typeof parseMuellerMatrixSourceName>>,
  channelRecognitionNameRules?: ChannelRecognitionNameRules
): ResidentChannelUpload {
  const displaySize = resolveMuellerMatrixDisplaySize(width, height);
  const pixels = buildMuellerMatrixPixels(layer, width, height, source, channelRecognitionNameRules);
  let texture: WebGLTexture | null = null;
  try {
    texture = state.gl.createTexture();
    if (!texture) {
      throw new Error('Failed to create Mueller matrix source texture.');
    }

    state.gl.bindTexture(state.gl.TEXTURE_2D, texture);
    configureSourceTexture(state.gl, state.smoothFloatMinification);
    uploadFloatTextureLevels(state.gl, {
      internalFormat: state.gl.RGBA32F,
      format: state.gl.RGBA,
      width: displaySize.width,
      height: displaySize.height,
      components: 4,
      pixels,
      includeMipmaps: state.smoothFloatMinification
    });
    layerTextures.textureByChannel.set(sourceName, texture);
    return {
      channelName: sourceName,
      textureBytes: predictRgba32fTextureBytes(
        displaySize.width,
        displaySize.height,
        state.smoothFloatMinification
      ),
      materializedBytes: 0,
      resourceKind: 'derived-texture'
    };
  } catch (error) {
    if (texture) {
      state.gl.deleteTexture(texture);
    }
    throw error;
  }
}

function buildMuellerMatrixPixels(
  layer: DecodedLayer,
  width: number,
  height: number,
  source: NonNullable<ReturnType<typeof parseMuellerMatrixSourceName>>,
  channelRecognitionNameRules?: ChannelRecognitionNameRules
): Float32Array {
  const displaySize = resolveMuellerMatrixDisplaySize(width, height);
  const out = new Float32Array(displaySize.width * displaySize.height * 4);
  const scalarChannels = source.rgb ? null : detectMuellerMatrixChannels(layer.channelNames, source.suffix, {
    channelRecognitionNameRules
  });
  const rgbChannels = source.rgb
    ? resolveRgbMuellerMatrixChannelArrays(layer, detectRgbMuellerMatrixChannels(layer.channelNames, {
        channelRecognitionNameRules
      }))
    : null;
  if ((!scalarChannels && !rgbChannels) || width <= 0 || height <= 0) {
    return out;
  }

  const channelViews = {} as Record<MuellerMatrixElement, ReturnType<typeof getChannelReadView>>;
  if (scalarChannels) {
    for (const element of MUELLER_MATRIX_ELEMENTS) {
      channelViews[element] = getChannelReadView(layer, scalarChannels.elements[element]);
    }
  }

  for (let y = 0; y < displaySize.height; y += 1) {
    const matrixRow = Math.floor(y / height);
    const sourceY = y - matrixRow * height;
    for (let x = 0; x < displaySize.width; x += 1) {
      const matrixColumn = Math.floor(x / width);
      const sourceX = x - matrixColumn * width;
      const element = `M${matrixRow}${matrixColumn}` as MuellerMatrixElement;
      const sourceIndex = sourceY * width + sourceX;
      const outIndex = (y * displaySize.width + x) * 4;
      if (rgbChannels) {
        writeRgbMuellerMatrixPixel(out, outIndex, rgbChannels, element, sourceIndex);
      } else {
        const value = readChannelValue(channelViews[element], sourceIndex);
        out[outIndex + 0] = value;
        out[outIndex + 1] = value;
        out[outIndex + 2] = value;
      }
      out[outIndex + 3] = 1;
    }
  }

  return out;
}

function writeRgbMuellerMatrixPixel(
  output: Float32Array,
  outputIndex: number,
  channels: ResolvedRgbMuellerMatrixChannels,
  element: MuellerMatrixElement,
  sourceIndex: number
): void {
  output[outputIndex + 0] = readChannelValue(channels.r.elements[element], sourceIndex);
  output[outputIndex + 1] = readChannelValue(channels.g.elements[element], sourceIndex);
  output[outputIndex + 2] = readChannelValue(channels.b.elements[element], sourceIndex);
}

function uploadSpectralStokesRgbSourceTexture(
  state: GlImageRendererState,
  layerTextures: LayerSourceTextures,
  width: number,
  height: number,
  layer: DecodedLayer,
  sourceName: string,
  component: SpectralStokesComponent,
  channelRecognitionNameRules?: ChannelRecognitionNameRules
): ResidentChannelUpload {
  const pixels = buildSignedSpectralStokesRgbPixels(layer, width, height, component, channelRecognitionNameRules);
  let texture: WebGLTexture | null = null;
  try {
    texture = state.gl.createTexture();
    if (!texture) {
      throw new Error('Failed to create spectral Stokes RGB source texture.');
    }

    state.gl.bindTexture(state.gl.TEXTURE_2D, texture);
    configureSourceTexture(state.gl, state.smoothFloatMinification);
    uploadFloatTextureLevels(state.gl, {
      internalFormat: state.gl.RGBA32F,
      format: state.gl.RGBA,
      width,
      height,
      components: 4,
      pixels,
      includeMipmaps: state.smoothFloatMinification
    });
    layerTextures.textureByChannel.set(sourceName, texture);
    return {
      channelName: sourceName,
      textureBytes: predictRgba32fTextureBytes(width, height, state.smoothFloatMinification),
      materializedBytes: 0,
      resourceKind: 'derived-texture'
    };
  } catch (error) {
    if (texture) {
      state.gl.deleteTexture(texture);
    }
    throw error;
  }
}

function buildSignedSpectralStokesRgbPixels(
  layer: DecodedLayer,
  width: number,
  height: number,
  component: SpectralStokesComponent,
  channelRecognitionNameRules?: ChannelRecognitionNameRules
): Float32Array {
  const pixelCount = width * height;
  const out = new Float32Array(pixelCount * 4);
  const groups = detectSpectralStokesChannelGroups(layer.channelNames, {
    channelRecognitionNameRules
  });
  const channels = resolveSpectralRgbChannels(
    layer,
    buildReflectanceSpectralRgbCoefficients(buildSpectralStokesComponentChannels(groups, component))
  );

  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
    const outIndex = pixelIndex * 4;
    const sample = readSignedSpectralRgbSampleAtIndex(channels, pixelIndex);
    out[outIndex + 0] = sample.r;
    out[outIndex + 1] = sample.g;
    out[outIndex + 2] = sample.b;
    out[outIndex + 3] = 1;
  }

  return out;
}

function uploadSpectralRgbSourceTexture(
  state: GlImageRendererState,
  layerTextures: LayerSourceTextures,
  width: number,
  height: number,
  layer: DecodedLayer,
  sourceName: string,
  seriesKey: string,
  channelRecognitionNameRules?: ChannelRecognitionNameRules
): ResidentChannelUpload {
  const pixels = buildSelectedDisplayTexture(layer, width, height, {
    kind: 'spectralRgb',
    seriesKey
  }, 'rgb', undefined, { channelRecognitionNameRules });
  let texture: WebGLTexture | null = null;
  try {
    texture = state.gl.createTexture();
    if (!texture) {
      throw new Error('Failed to create spectral RGB source texture.');
    }

    state.gl.bindTexture(state.gl.TEXTURE_2D, texture);
    configureSourceTexture(state.gl, state.smoothFloatMinification);
    uploadFloatTextureLevels(state.gl, {
      internalFormat: state.gl.RGBA32F,
      format: state.gl.RGBA,
      width,
      height,
      components: 4,
      pixels,
      includeMipmaps: state.smoothFloatMinification
    });
    layerTextures.textureByChannel.set(sourceName, texture);
    return {
      channelName: sourceName,
      textureBytes: predictRgba32fTextureBytes(width, height, state.smoothFloatMinification),
      materializedBytes: 0,
      resourceKind: 'derived-texture'
    };
  } catch (error) {
    if (texture) {
      state.gl.deleteTexture(texture);
    }
    throw error;
  }
}

export function setDisplaySelectionBindings(
  state: GlImageRendererState,
  sessionId: string,
  layerIndex: number,
  width: number,
  height: number,
  binding: DisplaySourceBinding
): void {
  state.imageSize = binding.mode === 'muellerMatrix'
    ? resolveMuellerMatrixDisplaySize(width, height)
    : { width, height };
  state.activeBinding = binding;

  const layerTextures = state.layerTexturesBySession.get(sessionId)?.get(layerIndex) ?? null;
  for (let slotIndex = 0; slotIndex < DISPLAY_SOURCE_SLOT_COUNT; slotIndex += 1) {
    const channelName = binding.slots[slotIndex];
    const texture = channelName
      ? layerTextures?.textureByChannel.get(channelName) ?? state.zeroTexture
      : state.zeroTexture;
    state.gl.activeTexture(state.gl.TEXTURE0 + slotIndex);
    state.gl.bindTexture(state.gl.TEXTURE_2D, texture);
  }
}

export function setDepthSourceBinding(
  state: GlImageRendererState,
  sessionId: string,
  layerIndex: number,
  width: number,
  height: number,
  source: DepthSource | null,
  geometry: DepthSourceGeometry | null
): void {
  state.depthSourceSize = { width, height };
  state.activeDepthSource = source;
  state.activeDepthGeometry = geometry;

  const layerTextures = state.layerTexturesBySession.get(sessionId)?.get(layerIndex) ?? null;
  const textureX = source
    ? layerTextures?.textureByChannel.get(source.kind === 'xyzPosition' ? source.xChannel : source.channelName) ?? state.zeroTexture
    : state.zeroTexture;
  const textureY = source?.kind === 'xyzPosition'
    ? layerTextures?.textureByChannel.get(source.yChannel) ?? state.zeroTexture
    : state.zeroTexture;
  const textureZ = source?.kind === 'xyzPosition'
    ? layerTextures?.textureByChannel.get(source.zChannel) ?? state.zeroTexture
    : state.zeroTexture;
  state.activeDepthTextures = {
    x: textureX,
    y: textureY,
    z: textureZ
  };
  state.gl.activeTexture(state.gl.TEXTURE0 + DEPTH_TEXTURE_UNIT);
  state.gl.bindTexture(state.gl.TEXTURE_2D, textureX);
  state.gl.activeTexture(state.gl.TEXTURE0 + DEPTH_POSITION_Y_TEXTURE_UNIT);
  state.gl.bindTexture(state.gl.TEXTURE_2D, textureY);
  state.gl.activeTexture(state.gl.TEXTURE0 + DEPTH_POSITION_Z_TEXTURE_UNIT);
  state.gl.bindTexture(state.gl.TEXTURE_2D, textureZ);
}

export function discardSessionTextures(state: GlImageRendererState, sessionId: string): void {
  const sessionLayers = state.layerTexturesBySession.get(sessionId);
  if (!sessionLayers) {
    return;
  }

  for (const layerIndex of [...sessionLayers.keys()]) {
    discardLayerSourceTextures(state, sessionId, layerIndex);
  }
}

export function discardLayerSourceTextures(
  state: GlImageRendererState,
  sessionId: string,
  layerIndex: number
): void {
  const sessionLayers = state.layerTexturesBySession.get(sessionId);
  if (!sessionLayers) {
    return;
  }

  const layerTextures = sessionLayers.get(layerIndex);
  if (!layerTextures) {
    return;
  }

  for (const channelName of [...layerTextures.textureByChannel.keys()]) {
    discardChannelSourceTexture(state, sessionId, layerIndex, channelName);
  }
}

export function discardChannelMaterializedBuffer(
  state: GlImageRendererState,
  sessionId: string,
  layerIndex: number,
  channelName: string
): void {
  const sessionLayers = state.layerTexturesBySession.get(sessionId);
  if (!sessionLayers) {
    return;
  }

  const layerTextures = sessionLayers.get(layerIndex);
  if (!layerTextures) {
    return;
  }

  discardMaterializedChannel(layerTextures.layer, channelName);
}

export function discardChannelSourceTexture(
  state: GlImageRendererState,
  sessionId: string,
  layerIndex: number,
  channelName: string
): void {
  const sessionLayers = state.layerTexturesBySession.get(sessionId);
  if (!sessionLayers) {
    return;
  }

  const layerTextures = sessionLayers.get(layerIndex);
  if (!layerTextures) {
    return;
  }

  const texture = layerTextures.textureByChannel.get(channelName);
  if (!texture) {
    return;
  }

  if (
    state.activeDepthTextures?.x === texture ||
    state.activeDepthTextures?.y === texture ||
    state.activeDepthTextures?.z === texture
  ) {
    state.activeDepthSource = null;
    state.activeDepthTextures = null;
    state.activeDepthGeometry = null;
    state.depthSourceSize = null;
  }

  state.gl.deleteTexture(texture);
  layerTextures.textureByChannel.delete(channelName);
  discardMaterializedChannel(layerTextures.layer, channelName);

  if (layerTextures.textureByChannel.size > 0) {
    return;
  }

  sessionLayers.delete(layerIndex);
  if (sessionLayers.size === 0) {
    state.layerTexturesBySession.delete(sessionId);
  }
}

function configureSourceTexture(
  gl: WebGL2RenderingContext,
  smoothFloatMinification: boolean
): void {
  gl.texParameteri(
    gl.TEXTURE_2D,
    gl.TEXTURE_MIN_FILTER,
    smoothFloatMinification ? gl.LINEAR_MIPMAP_LINEAR : gl.NEAREST
  );
  gl.texParameteri(
    gl.TEXTURE_2D,
    gl.TEXTURE_MAG_FILTER,
    smoothFloatMinification ? gl.LINEAR : gl.NEAREST
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
}

interface FloatTextureUpload {
  internalFormat: number;
  format: number;
  width: number;
  height: number;
  components: number;
  pixels: Float32Array;
  includeMipmaps: boolean;
}

function uploadFloatTextureLevels(
  gl: WebGL2RenderingContext,
  upload: FloatTextureUpload
): void {
  validateFloatTextureUpload(gl, upload);
  let level = 0;
  let levelWidth = upload.width;
  let levelHeight = upload.height;
  let levelPixels = upload.pixels;

  while (true) {
    gl.texImage2D(
      gl.TEXTURE_2D,
      level,
      upload.internalFormat,
      levelWidth,
      levelHeight,
      0,
      upload.format,
      gl.FLOAT,
      levelPixels
    );
    const uploadError = gl.getError();
    if (uploadError !== gl.NO_ERROR) {
      throw new Error(
        `Failed to upload float source texture mip level ${level} ` +
        `(WebGL error 0x${uploadError.toString(16)}).`
      );
    }

    if (!upload.includeMipmaps) {
      return;
    }
    const nextLevel = buildNextFloatMipLevel(
      levelPixels,
      levelWidth,
      levelHeight,
      upload.components
    );
    if (!nextLevel) {
      return;
    }
    level += 1;
    levelWidth = nextLevel.width;
    levelHeight = nextLevel.height;
    levelPixels = nextLevel.pixels;
  }
}

function validateFloatTextureUpload(
  gl: WebGL2RenderingContext,
  upload: FloatTextureUpload
): void {
  if (
    !Number.isInteger(upload.width) ||
    !Number.isInteger(upload.height) ||
    !Number.isInteger(upload.components) ||
    upload.width <= 0 ||
    upload.height <= 0 ||
    upload.components <= 0 ||
    upload.pixels.length !== upload.width * upload.height * upload.components
  ) {
    throw new RangeError('Float texture dimensions do not match the source data.');
  }

  const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
  if (
    Number.isFinite(maxTextureSize) &&
    maxTextureSize > 0 &&
    (upload.width > maxTextureSize || upload.height > maxTextureSize)
  ) {
    throw new RangeError(`Float texture dimensions must be ${maxTextureSize} px or smaller.`);
  }
}

function predictR32fTextureBytes(
  width: number,
  height: number,
  includeMipmaps: boolean
): number {
  return predictTextureStorageBytes(width, height, Float32Array.BYTES_PER_ELEMENT, includeMipmaps);
}

function predictRgba32fTextureBytes(
  width: number,
  height: number,
  includeMipmaps: boolean
): number {
  return predictTextureStorageBytes(width, height, 4 * Float32Array.BYTES_PER_ELEMENT, includeMipmaps);
}

function pruneEmptyLayerSourceTextures(
  state: GlImageRendererState,
  sessionId: string,
  layerIndex: number,
  layerTextures: LayerSourceTextures
): void {
  const sessionLayers = state.layerTexturesBySession.get(sessionId);
  if (sessionLayers?.get(layerIndex) !== layerTextures || layerTextures.textureByChannel.size > 0) {
    return;
  }

  sessionLayers.delete(layerIndex);
  if (sessionLayers.size === 0) {
    state.layerTexturesBySession.delete(sessionId);
  }
}

function getOrCreateLayerSourceTextures(
  state: GlImageRendererState,
  sessionId: string,
  layerIndex: number,
  width: number,
  height: number,
  layer: DecodedLayer
): LayerSourceTextures {
  let sessionLayers = state.layerTexturesBySession.get(sessionId);
  if (!sessionLayers) {
    sessionLayers = new Map<number, LayerSourceTextures>();
    state.layerTexturesBySession.set(sessionId, sessionLayers);
  }

  const existingLayerTextures = sessionLayers.get(layerIndex);
  if (existingLayerTextures && existingLayerTextures.width === width && existingLayerTextures.height === height) {
    return existingLayerTextures;
  }

  if (existingLayerTextures) {
    discardLayerSourceTextures(state, sessionId, layerIndex);
  }

  const nextLayerTextures: LayerSourceTextures = {
    layer,
    width,
    height,
    textureByChannel: new Map<string, WebGLTexture>()
  };
  sessionLayers.set(layerIndex, nextLayerTextures);
  return nextLayerTextures;
}
