// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { __debugGetMaterializedChannel, __debugGetMaterializedChannelCount } from '../src/channel-storage';
import {
  buildDisplaySourceBinding,
  createEmptyDisplaySourceBinding,
  getDisplaySourceBindingChannelNames
} from '../src/display/bindings';
import { resolveDisplaySourceModeUniformValue } from '../src/display/gpu-bindings';
import { buildSelectedDisplayTexture } from '../src/display/materialize-cpu';
import { CONSTRAINED_DEPTH_POINTS, type DepthPointBudgetResolver } from '../src/depth-point-budget';
import { clampPanoramaProjectionPitch } from '../src/interaction/panorama-geometry';
import { GlImageRenderer } from '../src/rendering/gl-image-renderer';
import type { GlImageRendererState } from '../src/rendering/gl-image-renderer/types';
import type { ViewerState } from '../src/types';
import { createEmptyRoiInteractionState } from '../src/view-state';
import { createInitialState } from '../src/viewer-store';
import { DEFAULT_PATH_TRACING_MAX_SAMPLES } from '../src/path-tracing-settings';
import {
  createChannelMonoSelection,
  createChannelRgbSelection,
  createSpectralRgbSelection,
  createStokesSelection,
  createLayerFromChannels,
  createInterleavedLayerFromChannels
} from './helpers/state-fixtures';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('gl image renderer', () => {
  it('keeps panorama frames pending without waiting for link status or drawing', () => {
    const parallelCompilation = { complete: false };
    const { renderer, gl } = createHarness({ parallelCompilation });
    const state = createPanoramaState();
    vi.mocked(gl.getProgramParameter).mockClear();
    vi.mocked(gl.getShaderParameter).mockClear();

    expect(renderer.render(state)).toBe(true);
    expect(renderer.render(state)).toBe(true);
    expect(gl.drawArrays).not.toHaveBeenCalled();
    expect(gl.getShaderParameter).not.toHaveBeenCalled();
    expect(vi.mocked(gl.getProgramParameter).mock.calls.map((call) => call[1])).toEqual([0x91b1, 0x91b1]);

    parallelCompilation.complete = true;
    expect(renderer.render(state)).toBe(false);
    expect(gl.drawArrays).toHaveBeenCalledTimes(1);
    expect(vi.mocked(gl.getProgramParameter).mock.calls.at(-1)?.[1]).toBe(gl.LINK_STATUS);
    expect(renderer.render(state)).toBe(false);
    expect(gl.drawArrays).toHaveBeenCalledTimes(2);
    renderer.dispose();
  });

  it('compiles panorama modes independently and shares the radiance bake program', () => {
    const { renderer, gl } = createHarness({ floatAccumulationSupported: true });
    const state = createPanoramaState();
    expect(gl.createProgram).toHaveBeenCalledTimes(3);

    renderer.render(state);
    expect(gl.createProgram).toHaveBeenCalledTimes(4);
    const lightingState = { ...state, panoramaDisplayMode: 'environmentLighting' as const };
    renderer.render(lightingState);
    expect(gl.createProgram).toHaveBeenCalledTimes(6);
    renderer.render({ ...lightingState, panoramaLightingMethod: 'pathTracing' });
    expect(gl.createProgram).toHaveBeenCalledTimes(7);

    renderer.render(state);
    renderer.render(lightingState);
    renderer.render({ ...lightingState, panoramaLightingMethod: 'pathTracing' });
    expect(gl.createProgram).toHaveBeenCalledTimes(7);
    renderer.dispose();
    expect(gl.deleteProgram).toHaveBeenCalledTimes(7);
  });

  it('requests lighting and radiance compilation together and disposes pending programs', () => {
    const { renderer, gl } = createHarness({ parallelCompilation: { complete: false } });
    vi.mocked(gl.deleteShader).mockClear();
    const state = createPanoramaState({ panoramaDisplayMode: 'environmentLighting' });

    expect(renderer.render(state)).toBe(true);
    expect(gl.createProgram).toHaveBeenCalledTimes(5);
    expect(gl.drawArrays).not.toHaveBeenCalled();
    renderer.dispose();
    expect(gl.deleteProgram).toHaveBeenCalledTimes(5);
    expect(gl.deleteShader).toHaveBeenCalledTimes(4);
  });

  it('compiles scalar and polarized path programs once each and reuses them when sources switch', () => {
    const { renderer, gl, layer, state } = createPolarizedHarness();
    const programs = getRendererState(renderer).panoramaPrograms;
    const polarizedBinding = buildDisplaySourceBinding(layer, state.displaySelection);
    const scalarLayer = createLayerFromChannels({ R: [1], G: [0.5], B: [0.25] });
    const scalarBinding = buildDisplaySourceBinding(scalarLayer, state.displaySelection);
    const compiledVariants = () => vi.mocked(gl.shaderSource).mock.calls
      .map((call) => call[1])
      .filter(source => source.includes('#define PATH_TRACING_POLARIZED_ENVIRONMENT '));

    renderer.render(state);
    const polarizedProgram = programs.get('pathTracing', true)!.program;
    expect(gl.createProgram).toHaveBeenCalledTimes(4);
    expect(compiledVariants()).toEqual([expect.stringContaining('#define PATH_TRACING_POLARIZED_ENVIRONMENT true')]);

    renderer.ensureLayerChannelsResident('scalar', 0, 1, 1, scalarLayer, ['R', 'G', 'B']);
    renderer.setDisplaySelectionBindings('scalar', 0, 1, 1, scalarBinding);
    renderer.render(state);
    const scalarProgram = programs.get('pathTracing', false)!.program;
    expect(scalarProgram).not.toBe(polarizedProgram);
    // Three shared programs, both path variants, and the scalar radiance bake.
    expect(gl.createProgram).toHaveBeenCalledTimes(6);
    expect(compiledVariants()).toEqual([
      expect.stringContaining('#define PATH_TRACING_POLARIZED_ENVIRONMENT true'),
      expect.stringContaining('#define PATH_TRACING_POLARIZED_ENVIRONMENT false')
    ]);

    for (let round = 0; round < 2; round += 1) {
      renderer.setDisplaySelectionBindings('penvmap', 0, 2, 3, polarizedBinding);
      vi.mocked(gl.useProgram).mockClear();
      renderer.render(state);
      expect(vi.mocked(gl.useProgram).mock.calls.some(([used]) => used === polarizedProgram)).toBe(true);
      expect(vi.mocked(gl.useProgram).mock.calls.some(([used]) => used === scalarProgram)).toBe(false);

      renderer.setDisplaySelectionBindings('scalar', 0, 1, 1, scalarBinding);
      vi.mocked(gl.useProgram).mockClear();
      renderer.render(state);
      expect(vi.mocked(gl.useProgram).mock.calls.some(([used]) => used === scalarProgram)).toBe(true);
      expect(vi.mocked(gl.useProgram).mock.calls.some(([used]) => used === polarizedProgram)).toBe(false);
    }
    expect(gl.createProgram).toHaveBeenCalledTimes(6);
    expect(compiledVariants()).toHaveLength(2);
    renderer.dispose();
    expect(gl.deleteProgram).toHaveBeenCalledTimes(6);
  });

  it('prepares only the captured polarized variant when another source becomes active during compilation', async () => {
    vi.useFakeTimers();
    const parallelCompilation = { complete: false };
    const { renderer, gl, layer, state } = createPolarizedHarness({ parallelCompilation });
    try {
      let prepared = false;
      const preparation = renderer.preparePanoramaPrograms(state).then(() => { prepared = true; });
      expect(gl.createProgram).toHaveBeenCalledTimes(4);
      expect(gl.drawArrays).not.toHaveBeenCalled();

      // Another pane may rebind the shared renderer while export awaits its shader.
      const scalarLayer = createLayerFromChannels({ R: [1], G: [0.5], B: [0.25] });
      renderer.ensureLayerChannelsResident('scalar', 0, 1, 1, scalarLayer, ['R', 'G', 'B']);
      renderer.setDisplaySelectionBindings('scalar', 0, 1, 1, buildDisplaySourceBinding(scalarLayer, state.displaySelection));
      expect(getRendererState(renderer).activePolarizedEnvironment).toBeNull();
      await vi.advanceTimersByTimeAsync(16);
      expect(prepared).toBe(false);
      expect(gl.createProgram).toHaveBeenCalledTimes(4);

      parallelCompilation.complete = true;
      await vi.advanceTimersByTimeAsync(16);
      await preparation;
      expect(prepared).toBe(true);
      // No scalar path or radiance bake was requested by the pending preparation.
      expect(gl.createProgram).toHaveBeenCalledTimes(4);

      renderer.setDisplaySelectionBindings('penvmap', 0, 2, 3, buildDisplaySourceBinding(layer, state.displaySelection));
      parallelCompilation.complete = false;
      renderer.render(state);
      expect(gl.drawArrays).toHaveBeenCalled();
      expect(getRendererState(renderer).preparingPanorama).toBe(false);
      expect(gl.createProgram).toHaveBeenCalledTimes(4);
    } finally {
      renderer.dispose();
      vi.useRealTimers();
    }
  });

  it('rebakes linear radiance for source revisions and Stokes changes, and reuses it for display adjustments', () => {
    const { renderer, gl } = createHarness({ floatAccumulationSupported: true, floatLinearSupported: true });
    const layer = createLayerFromChannels({ S0: [1], S1: [0.5], S2: [0.2], S3: [0] });
    const selection = createStokesSelection('dolp');
    const binding = buildDisplaySourceBinding(layer, selection);
    const state = createPanoramaState({
      panoramaDisplayMode: 'environmentLighting',
      displaySelection: selection,
      maskInvalidStokesVectors: true
    });
    renderer.ensureLayerChannelsResident('session-1', 0, 1, 1, layer, getDisplaySourceBindingChannelNames(binding));
    renderer.setDisplaySelectionBindings('session-1', 0, 1, 1, binding, 'revision-1');
    const mipmaps = vi.mocked(gl.generateMipmap);

    renderer.render(state);
    expect(mipmaps).toHaveBeenCalledTimes(1);
    renderer.render({ ...state, exposureEv: 2, displayGamma: 1.8, panoramaYawDeg: 15 });
    expect(mipmaps).toHaveBeenCalledTimes(1);
    renderer.setDisplaySelectionBindings('session-1', 0, 1, 1, binding, 'revision-2');
    renderer.render(state);
    expect(mipmaps).toHaveBeenCalledTimes(2);
    renderer.render({ ...state, maskInvalidStokesVectors: false });
    expect(mipmaps).toHaveBeenCalledTimes(3);

    const otherSelection = createStokesSelection('aolp');
    const otherBinding = buildDisplaySourceBinding(layer, otherSelection);
    renderer.setDisplaySelectionBindings('session-1', 0, 1, 1, otherBinding, 'revision-2');
    renderer.render({ ...state, displaySelection: otherSelection });
    expect(mipmaps).toHaveBeenCalledTimes(4);

    gl.deleteTexture.mockClear();
    renderer.discardLayerSourceTextures('session-1', 0);
    expect(gl.deleteTexture).toHaveBeenCalledTimes(getDisplaySourceBindingChannelNames(binding).length + 4);
    renderer.ensureLayerChannelsResident('session-1', 0, 1, 1, layer, getDisplaySourceBindingChannelNames(binding));
    renderer.setDisplaySelectionBindings('session-1', 0, 1, 1, binding, 'revision-1');
    renderer.render(state);
    expect(mipmaps).toHaveBeenCalledTimes(5);
    gl.deleteTexture.mockClear();
    renderer.dispose();
    expect(gl.deleteTexture).toHaveBeenCalledTimes(getDisplaySourceBindingChannelNames(binding).length + 4);
  });

  it('refuses screenshot readback until the requested panorama program is ready', async () => {
    const parallelCompilation = { complete: false };
    const { renderer, gl } = createHarness({ parallelCompilation });
    const layer = createLayerFromChannels({ R: [1], G: [0.5], B: [0.2] });
    const state = createPanoramaState({ displaySelection: createChannelRgbSelection() });
    renderer.ensureLayerChannelsResident('session-1', 0, 1, 1, layer, ['R', 'G', 'B']);
    renderer.setDisplaySelectionBindings('session-1', 0, 1, 1, buildDisplaySourceBinding(layer, state.displaySelection));
    const args = {
      state,
      sourceWidth: 1,
      sourceHeight: 1,
      screenshot: {
        coordinateSpace: 'viewport' as const,
        rect: { x: 0, y: 0, width: 1, height: 1 },
        sourceViewport: { width: 1, height: 1 }
      }
    };

    expect(() => renderer.readExportPixels(args)).toThrow('still preparing');
    expect(gl.readPixels).not.toHaveBeenCalled();
    parallelCompilation.complete = true;
    await renderer.preparePanoramaPrograms(state);
    renderer.readExportPixels(args);
    expect(gl.readPixels).toHaveBeenCalledTimes(1);
    renderer.dispose();
  });

  it('defers panorama compilation until it is used, reuses it, and disposes it', () => {
    const { renderer, gl } = createHarness();
    const shaderSource = gl.shaderSource as unknown as ReturnType<typeof vi.fn>;
    const panoramaCompilations = () => shaderSource.mock.calls.filter((call) =>
      (call[1] as string).includes('uniform float uPanoramaYawDeg;')
    ).length;
    const state = {
      ...createInitialState(),
      viewerMode: 'panorama' as const,
      hoveredPixel: null,
      draftRoi: null,
      roiInteraction: createEmptyRoiInteractionState()
    };

    expect(panoramaCompilations()).toBe(0);
    renderer.render(state);
    expect(panoramaCompilations()).toBe(1);
    renderer.render(state);
    expect(panoramaCompilations()).toBe(1);
    renderer.dispose();
    expect(gl.deleteProgram).toHaveBeenCalledTimes(4);
  });

  it('uploads only the channels required by the active selection and only uploads newly required channels later', () => {
    const { renderer, gl } = createHarness();
    const layer = createInterleavedLayerFromChannels({
      R: [1, 2],
      G: [3, 4],
      B: [5, 6],
      A: [0.25, 0.5],
      Z: [10, 20]
    });

    const firstUploadedChannels = renderer.ensureLayerChannelsResident('session-1', 0, 2, 1, layer, ['R', 'G', 'B']);
    renderer.setDisplaySelectionBindings(
      'session-1',
      0,
      2,
      1,
      buildDisplaySourceBinding(layer, createChannelRgbSelection('R', 'G', 'B'))
    );

    const texImageCallsAfterFirstUpload = gl.texImage2D.mock.calls.length;

    const secondUploadedChannels = renderer.ensureLayerChannelsResident('session-1', 0, 2, 1, layer, ['Z', 'A']);
    renderer.setDisplaySelectionBindings(
      'session-1',
      0,
      2,
      1,
      buildDisplaySourceBinding(layer, createChannelMonoSelection('Z', 'A'))
    );

    expect(firstUploadedChannels).toEqual([
      { channelName: 'R', textureBytes: 8, materializedBytes: 8, resourceKind: 'source-texture' },
      { channelName: 'G', textureBytes: 8, materializedBytes: 8, resourceKind: 'source-texture' },
      { channelName: 'B', textureBytes: 8, materializedBytes: 8, resourceKind: 'source-texture' }
    ]);
    expect(secondUploadedChannels).toEqual([
      { channelName: 'Z', textureBytes: 8, materializedBytes: 8, resourceKind: 'source-texture' },
      { channelName: 'A', textureBytes: 8, materializedBytes: 8, resourceKind: 'source-texture' }
    ]);
    expect(texImageCallsAfterFirstUpload).toBe(6);
    expect(gl.texImage2D).toHaveBeenCalledTimes(8);
    expect(gl.createTexture).toHaveBeenCalledTimes(8);
  });

  it('uploads interleaved source textures from lazily materialized dense channel buffers', () => {
    const { renderer, gl } = createHarness();
    const layer = createInterleavedLayerFromChannels({
      R: [1, 2],
      G: [3, 4],
      B: [5, 6]
    });

    const uploads = renderer.ensureLayerChannelsResident('session-1', 0, 2, 1, layer, ['R', 'G', 'B']);

    expect(layer.channelStorage.kind).toBe('interleaved-f32');
    expect(uploads).toEqual([
      { channelName: 'R', textureBytes: 8, materializedBytes: 8, resourceKind: 'source-texture' },
      { channelName: 'G', textureBytes: 8, materializedBytes: 8, resourceKind: 'source-texture' },
      { channelName: 'B', textureBytes: 8, materializedBytes: 8, resourceKind: 'source-texture' }
    ]);
    expect(__debugGetMaterializedChannelCount(layer)).toBe(3);
    expect(gl.texImage2D.mock.calls[3]?.[8]).toBe(
      __debugGetMaterializedChannel(layer, 'R')
    );
    expect(gl.texImage2D.mock.calls[4]?.[8]).toBe(
      __debugGetMaterializedChannel(layer, 'G')
    );
    expect(gl.texImage2D.mock.calls[5]?.[8]).toBe(
      __debugGetMaterializedChannel(layer, 'B')
    );
  });

  it('reports planar source uploads without additional materialized CPU bytes', () => {
    const { renderer } = createHarness();
    const layer = createLayerFromChannels({
      R: [1, 2],
      G: [3, 4]
    });

    const uploads = renderer.ensureLayerChannelsResident('session-1', 0, 2, 1, layer, ['R', 'G']);

    expect(layer.channelStorage.kind).toBe('planar-f32');
    expect(uploads).toEqual([
      { channelName: 'R', textureBytes: 8, materializedBytes: 0, resourceKind: 'source-texture' },
      { channelName: 'G', textureBytes: 8, materializedBytes: 0, resourceKind: 'source-texture' }
    ]);
    expect(__debugGetMaterializedChannelCount(layer)).toBe(0);
  });

  it('uses seam-safe trilinear filtering for panorama-compatible float textures', () => {
    const { renderer, gl } = createHarness({ floatLinearSupported: true });
    const layer = createLayerFromChannels({
      R: [1, 2]
    });
    gl.texParameteri.mockClear();
    gl.texImage2D.mockClear();

    const uploads = renderer.ensureLayerChannelsResident('session-1', 0, 2, 1, layer, ['R']);

    expect(gl.getExtension).toHaveBeenCalledWith('OES_texture_float_linear');
    expect(gl.texParameteri).toHaveBeenCalledWith(
      gl.TEXTURE_2D,
      gl.TEXTURE_MIN_FILTER,
      gl.LINEAR_MIPMAP_LINEAR
    );
    expect(gl.texParameteri).toHaveBeenCalledWith(
      gl.TEXTURE_2D,
      gl.TEXTURE_MAG_FILTER,
      gl.LINEAR
    );
    expect(gl.texParameteri).toHaveBeenCalledWith(
      gl.TEXTURE_2D,
      gl.TEXTURE_WRAP_S,
      gl.REPEAT
    );
    expect(gl.texParameteri).toHaveBeenCalledWith(
      gl.TEXTURE_2D,
      gl.TEXTURE_WRAP_T,
      gl.CLAMP_TO_EDGE
    );
    expect(gl.texImage2D).toHaveBeenCalledTimes(2);
    expect(gl.texImage2D.mock.calls[0]).toEqual([
      gl.TEXTURE_2D,
      0,
      gl.R32F,
      2,
      1,
      0,
      gl.RED,
      gl.FLOAT,
      new Float32Array([1, 2])
    ]);
    expect(gl.texImage2D.mock.calls[1]).toEqual([
      gl.TEXTURE_2D,
      1,
      gl.R32F,
      1,
      1,
      0,
      gl.RED,
      gl.FLOAT,
      new Float32Array([1.5])
    ]);
    expect(uploads).toEqual([
      { channelName: 'R', textureBytes: 12, materializedBytes: 0, resourceKind: 'source-texture' }
    ]);
  });

  it('falls back to nearest minification without mipmaps when float-linear filtering is unsupported', () => {
    const { renderer, gl } = createHarness({ floatLinearSupported: false });
    const layer = createLayerFromChannels({
      R: [1, 2]
    });
    gl.texParameteri.mockClear();
    gl.texImage2D.mockClear();

    const uploads = renderer.ensureLayerChannelsResident('session-1', 0, 2, 1, layer, ['R']);

    expect(gl.getExtension).toHaveBeenCalledWith('OES_texture_float_linear');
    expect(gl.texParameteri).toHaveBeenCalledWith(
      gl.TEXTURE_2D,
      gl.TEXTURE_MIN_FILTER,
      gl.NEAREST
    );
    expect(gl.texParameteri).toHaveBeenCalledWith(
      gl.TEXTURE_2D,
      gl.TEXTURE_MAG_FILTER,
      gl.NEAREST
    );
    expect(gl.texParameteri).toHaveBeenCalledWith(
      gl.TEXTURE_2D,
      gl.TEXTURE_WRAP_S,
      gl.REPEAT
    );
    expect(gl.texImage2D).toHaveBeenCalledTimes(1);
    expect(gl.texImage2D.mock.calls[0]?.[1]).toBe(0);
    expect(uploads).toEqual([
      { channelName: 'R', textureBytes: 8, materializedBytes: 0, resourceKind: 'source-texture' }
    ]);
  });

  it('uploads spectral RGB as a derived RGBA32F source texture', () => {
    const { renderer, gl } = createHarness();
    const layer = createLayerFromChannels({
      '410nm': [0.2],
      '500nm': [0.8],
      '650nm': [0.3]
    });
    const selection = createSpectralRgbSelection();
    const binding = buildDisplaySourceBinding(layer, selection);
    const cpuTexture = buildSelectedDisplayTexture(layer, 1, 1, selection);

    const uploads = renderer.ensureLayerChannelsResident(
      'session-1',
      0,
      1,
      1,
      layer,
      getDisplaySourceBindingChannelNames(binding)
    );
    renderer.setDisplaySelectionBindings('session-1', 0, 1, 1, binding);

    const texImageCall = gl.texImage2D.mock.calls.at(-1);
    expect(uploads).toEqual([
      { channelName: '__spectralRgb:', textureBytes: 16, materializedBytes: 0, resourceKind: 'derived-texture' }
    ]);
    expect(texImageCall?.[2]).toBe(gl.RGBA32F);
    expect(texImageCall?.[6]).toBe(gl.RGBA);
    expect(texImageCall?.[8]).toBeInstanceOf(Float32Array);
    expect(Array.from((texImageCall?.[8] as Float32Array).slice(0, 4))).toEqual(Array.from(cpuTexture));
  });

  it('uploads spectral Stokes RGB components as derived RGBA32F source textures', () => {
    const { renderer, gl } = createHarness();
    const layer = createLayerFromChannels({
      'S0.400nm': [1],
      'S1.400nm': [1],
      'S2.400nm': [0],
      'S3.400nm': [0],
      'S0.500nm': [1],
      'S1.500nm': [0],
      'S2.500nm': [1],
      'S3.500nm': [0]
    });
    const selection = createStokesSelection('aolp', 'stokesSpectralRgb');
    const binding = buildDisplaySourceBinding(layer, selection);

    const uploads = renderer.ensureLayerChannelsResident(
      'session-1',
      0,
      1,
      1,
      layer,
      getDisplaySourceBindingChannelNames(binding)
    );
    renderer.setDisplaySelectionBindings('session-1', 0, 1, 1, binding);

    const texImageCalls = gl.texImage2D.mock.calls.slice(-4);
    expect(uploads).toEqual([
      { channelName: '__spectralStokesRgb:S0', textureBytes: 16, materializedBytes: 0, resourceKind: 'derived-texture' },
      { channelName: '__spectralStokesRgb:S1', textureBytes: 16, materializedBytes: 0, resourceKind: 'derived-texture' },
      { channelName: '__spectralStokesRgb:S2', textureBytes: 16, materializedBytes: 0, resourceKind: 'derived-texture' },
      { channelName: '__spectralStokesRgb:S3', textureBytes: 16, materializedBytes: 0, resourceKind: 'derived-texture' }
    ]);
    expect(texImageCalls).toHaveLength(4);
    for (const texImageCall of texImageCalls) {
      expect(texImageCall?.[2]).toBe(gl.RGBA32F);
      expect(texImageCall?.[6]).toBe(gl.RGBA);
      expect(texImageCall?.[8]).toBeInstanceOf(Float32Array);
      expect((texImageCall?.[8] as Float32Array)[3]).toBe(1);
    }
  });

  it('discards materialized interleaved CPU data when source texture upload fails', () => {
    const { renderer, gl } = createHarness();
    const layer = createInterleavedLayerFromChannels({
      R: [1, 2]
    });
    gl.texImage2D.mockImplementationOnce(() => {
      throw new Error('upload failed');
    });

    expect(() => {
      renderer.ensureLayerChannelsResident('session-1', 0, 2, 1, layer, ['R']);
    }).toThrow('upload failed');

    expect(gl.deleteTexture).toHaveBeenCalledTimes(1);
    expect(__debugGetMaterializedChannelCount(layer)).toBe(0);
    expect(getLayerTextureChannels(renderer, 'session-1', 0)).toEqual([]);
  });

  it('cleans up a source texture and materialized data when WebGL reports an upload error', () => {
    const { renderer, gl } = createHarness();
    const layer = createInterleavedLayerFromChannels({
      R: [1, 2]
    });
    let pendingError: number = gl.NO_ERROR;
    gl.texImage2D.mockImplementationOnce(() => {
      pendingError = 0x0502;
    });
    gl.getError.mockImplementation(() => {
      const error = pendingError;
      pendingError = gl.NO_ERROR;
      return error;
    });

    expect(() => {
      renderer.ensureLayerChannelsResident('session-1', 0, 2, 1, layer, ['R']);
    }).toThrow(/WebGL error 0x502/);

    expect(gl.getError).toHaveBeenCalled();
    expect(gl.deleteTexture).toHaveBeenCalledTimes(1);
    expect(__debugGetMaterializedChannelCount(layer)).toBe(0);
    expect(getLayerTextureChannels(renderer, 'session-1', 0)).toEqual([]);
  });

  it('cleans up a source texture and materialized data when a mip-level upload fails', () => {
    const { renderer, gl } = createHarness({ floatLinearSupported: true });
    const layer = createInterleavedLayerFromChannels({
      R: [1, 2]
    });
    gl.texImage2D.mockClear();
    gl.texImage2D
      .mockImplementationOnce(() => undefined)
      .mockImplementationOnce(() => {
        throw new Error('mip-level upload failed');
      });

    expect(() => {
      renderer.ensureLayerChannelsResident('session-1', 0, 2, 1, layer, ['R']);
    }).toThrow('mip-level upload failed');

    expect(gl.texImage2D).toHaveBeenCalledTimes(2);
    expect(gl.texImage2D.mock.calls.at(-1)?.[1]).toBe(1);
    expect(gl.deleteTexture).toHaveBeenCalledTimes(1);
    expect(__debugGetMaterializedChannelCount(layer)).toBe(0);
    expect(getLayerTextureChannels(renderer, 'session-1', 0)).toEqual([]);
  });

  it('rolls back earlier channel uploads when a later channel mip-level upload fails', () => {
    const { renderer, gl } = createHarness({ floatLinearSupported: true });
    const layer = createInterleavedLayerFromChannels({
      R: [1, 2],
      G: [3, 4]
    });
    gl.texImage2D.mockClear();
    gl.texImage2D
      .mockImplementationOnce(() => undefined)
      .mockImplementationOnce(() => undefined)
      .mockImplementationOnce(() => undefined)
      .mockImplementationOnce(() => {
        throw new Error('G mip-level upload failed');
      });

    expect(() => {
      renderer.ensureLayerChannelsResident('session-1', 0, 2, 1, layer, ['R', 'G']);
    }).toThrow('G mip-level upload failed');

    expect(gl.texImage2D.mock.calls.map((call) => call[1])).toEqual([0, 1, 0, 1]);
    const sourceTextures = gl.createTexture.mock.results.slice(-2).map((result) => result.value);
    expect(gl.deleteTexture).toHaveBeenCalledTimes(2);
    expect(gl.deleteTexture.mock.calls.map((call) => call[0])).toEqual(
      expect.arrayContaining(sourceTextures)
    );
    expect(__debugGetMaterializedChannelCount(layer)).toBe(0);
    expect(getLayerTextureChannels(renderer, 'session-1', 0)).toEqual([]);
  });

  it('discards one resident channel at a time and prunes empty session containers', () => {
    const { renderer, gl } = createHarness();
    const layer = createInterleavedLayerFromChannels({
      R: [1, 2],
      G: [3, 4],
      B: [5, 6]
    });

    renderer.ensureLayerChannelsResident('session-1', 0, 2, 1, layer, ['R', 'G']);

    expect(__debugGetMaterializedChannelCount(layer)).toBe(2);

    renderer.discardChannelSourceTexture('session-1', 0, 'R');

    expect(gl.deleteTexture).toHaveBeenCalledTimes(1);
    expect(getLayerTextureChannels(renderer, 'session-1', 0)).toEqual(['G']);
    expect(__debugGetMaterializedChannelCount(layer)).toBe(1);

    renderer.discardChannelSourceTexture('session-1', 0, 'G');

    expect(gl.deleteTexture).toHaveBeenCalledTimes(2);
    expect(getLayerTexturesBySession(renderer).has('session-1')).toBe(false);
    expect(__debugGetMaterializedChannelCount(layer)).toBe(0);
  });

  it('discards materialized CPU data without deleting a resident texture', () => {
    const { renderer, gl } = createHarness();
    const layer = createInterleavedLayerFromChannels({
      R: [1, 2],
      G: [3, 4]
    });

    renderer.ensureLayerChannelsResident('session-1', 0, 2, 1, layer, ['R', 'G']);
    expect(__debugGetMaterializedChannelCount(layer)).toBe(2);

    renderer.discardChannelMaterializedBuffer('session-1', 0, 'R');

    expect(gl.deleteTexture).not.toHaveBeenCalled();
    expect(getLayerTextureChannels(renderer, 'session-1', 0)).toEqual(['R', 'G']);
    expect(__debugGetMaterializedChannelCount(layer)).toBe(1);
  });

  it('deletes owned GL resources exactly once', () => {
    const { renderer, gl } = createHarness();

    renderer.dispose();
    renderer.dispose();

    expect(gl.deleteTexture).toHaveBeenCalledTimes(3);
    expect(gl.deleteProgram).toHaveBeenCalledTimes(3);
    expect(gl.deleteVertexArray).toHaveBeenCalledTimes(1);
  });

  it('clears the default framebuffer and drops the prepared image state', () => {
    const { renderer, gl } = createHarness();
    const layer = createInterleavedLayerFromChannels({
      R: [1, 2],
      G: [3, 4],
      B: [5, 6]
    });
    const state = {
      ...createInitialState(),
      displaySelection: createChannelRgbSelection('R', 'G', 'B'),
      hoveredPixel: null,
      draftRoi: null,
      roiInteraction: createEmptyRoiInteractionState()
    };

    renderer.ensureLayerChannelsResident('session-1', 0, 2, 1, layer, ['R', 'G', 'B']);
    renderer.setDisplaySelectionBindings(
      'session-1',
      0,
      2,
      1,
      buildDisplaySourceBinding(layer, state.displaySelection)
    );
    renderer.resize(320, 180);

    renderer.clearImage();

    expect(gl.bindFramebuffer).toHaveBeenCalledWith(gl.FRAMEBUFFER, null);
    expect(gl.viewport).toHaveBeenLastCalledWith(0, 0, 320, 180);
    expect(gl.clearColor).toHaveBeenCalledWith(0, 0, 0, 0);
    expect(gl.clear).toHaveBeenCalledWith(gl.COLOR_BUFFER_BIT);
    expect(() => renderer.readExportPixels({
      state,
      sourceWidth: 2,
      sourceHeight: 1
    })).toThrow('No prepared image is active for export.');
  });

  it('renders each configured viewer pane with pane-local viewport and scissor', () => {
    const { renderer, gl } = createHarness();
    const state = {
      ...createInitialState(),
      displaySelection: createChannelRgbSelection('R', 'G', 'B'),
      hoveredPixel: null,
      draftRoi: null,
      roiInteraction: createEmptyRoiInteractionState()
    };

    renderer.resize(320, 180);
    renderer.setPanes([
      {
        path: [0],
        rect: { x: 0, y: 0, width: 160, height: 180 },
        viewport: { width: 160, height: 180 },
        active: false
      },
      {
        path: [1],
        rect: { x: 160, y: 0, width: 160, height: 180 },
        viewport: { width: 160, height: 180 },
        active: true
      }
    ]);

    renderer.render(state);

    expect(gl.scissor).toHaveBeenCalledWith(0, 0, 160, 180);
    expect(gl.scissor).toHaveBeenCalledWith(160, 0, 160, 180);
    expect(gl.drawArrays).toHaveBeenCalledTimes(2);
    expect(lastUniform2fValue(gl, 'uViewport')).toEqual([160, 180]);
  });

  it('renders logical pane coordinates into a high-density canvas backing store', () => {
    const { renderer, gl, canvas } = createHarness();
    const state = {
      ...createInitialState(),
      hoveredPixel: null,
      draftRoi: null,
      roiInteraction: createEmptyRoiInteractionState()
    };

    renderer.resize(320, 180, 12, 8, 2);

    expect(canvas.width).toBe(640);
    expect(canvas.height).toBe(360);
    expect(gl.viewport).toHaveBeenCalledWith(0, 0, 640, 360);

    vi.mocked(gl.viewport).mockClear();
    vi.mocked(gl.scissor).mockClear();
    renderer.setPanes([
      {
        path: [0],
        rect: { x: 20, y: 30, width: 100, height: 50 },
        viewport: { width: 100, height: 50 },
        active: true
      }
    ]);

    renderer.render(state);

    expect(gl.viewport).toHaveBeenCalledWith(40, 200, 200, 100);
    expect(gl.scissor).toHaveBeenCalledWith(40, 200, 200, 100);
    expect(lastUniform2fValue(gl, 'uViewport')).toEqual([100, 50]);
    expect(lastUniform2fValue(gl, 'uOutputSize')).toEqual([100, 50]);
    expect(lastUniform2fValue(gl, 'uOutputPixelScale')).toEqual([2, 2]);
  });

  it('renders 3D mode through the point-cloud pass', () => {
    const { renderer, gl } = createHarness();
    const layer = createInterleavedLayerFromChannels({
      R: [1, 0, 0, 1],
      G: [0, 1, 0, 1],
      B: [0, 0, 1, 1],
      Z: [1, 2, 3, 4]
    });
    const state = {
      ...createInitialState(),
      viewerMode: '3d' as const,
      depthChannel: 'Z',
      depthYawDeg: 120,
      depthPitchDeg: 91,
      depthZoom: 2.5,
      depthTargetX: 0.1,
      depthTargetY: -0.2,
      depthTargetZ: 0.3,
      depthFocalLengthPx: null,
      depthPointSizePx: 3,
      displaySelection: createChannelRgbSelection('R', 'G', 'B'),
      hoveredPixel: null,
      draftRoi: null,
      roiInteraction: createEmptyRoiInteractionState()
    };

    renderer.ensureLayerChannelsResident('session-1', 0, 2, 2, layer, ['R', 'G', 'B', 'Z']);
    renderer.setDisplaySelectionBindings(
      'session-1',
      0,
      2,
      2,
      buildDisplaySourceBinding(layer, state.displaySelection)
    );
    renderer.setDepthSourceBinding(
      'session-1',
      0,
      2,
      2,
      { kind: 'scalarDepth', channelName: 'Z' },
      { kind: 'scalarDepth', range: { min: 1, max: 4 } }
    );
    renderer.resize(320, 180);

    renderer.render(state);

    expect(gl.clear).toHaveBeenCalledWith(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    expect(gl.enable).toHaveBeenCalledWith(gl.DEPTH_TEST);
    expect(gl.drawArrays).toHaveBeenLastCalledWith(gl.POINTS, 0, 4);
    expect(gl.disable).toHaveBeenCalledWith(gl.DEPTH_TEST);
    expect(lastUniform2fValue(gl, 'uImageSize')).toEqual([2, 2]);
    expect(lastUniform1fValue(gl, 'uDepthFocalLengthPx')).toBe(2);
    expect(lastUniform1fValue(gl, 'uDepthYawDeg')).toBeCloseTo(89.9, 7);
    expect(lastUniform1fValue(gl, 'uDepthPitchDeg')).toBeCloseTo(89.9, 7);
    expect(lastUniform1fValue(gl, 'uDepthZoom')).toBe(2.5);
    expect(lastUniform3fValue(gl, 'uDepthTarget')).toEqual([0.1, -0.2, 0.3]);
    expect(lastUniform1fValue(gl, 'uDepthPointSizePx')).toBe(3);
    expect(lastUniform2fValue(gl, 'uDepthOutputOrigin')).toEqual([0, 0]);
    expect(lastUniform2iValue(gl, 'uDepthGridSize')).toEqual([2, 2]);
    expect(lastUniform1iValue(gl, 'uDepthSampleStep')).toBe(1);
    expect(lastUniform2fValue(gl, 'uDepthRange')).toEqual([1, 4]);
    const depthCameraZRange = lastUniform2fValue(gl, 'uDepthCameraZRange');
    expect(depthCameraZRange).toEqual([expect.any(Number), expect.any(Number)]);
    expect(depthCameraZRange![0]).toBeLessThan(depthCameraZRange![1]);
    expect(lastUniform1iValue(gl, 'uDepthSourceKind')).toBe(0);
    const depthVertexShaderSource = getDepthVertexShaderSource(gl);
    expect(depthVertexShaderSource).toContain('uniform vec2 uDepthCameraZRange;');
    expect(depthVertexShaderSource).toContain('mapDepthCameraZToNdc(cameraPoint.z)');
    expect(depthVertexShaderSource).not.toContain('cameraPoint.z * zoom');
    const depthFragmentShaderSource = getDepthFragmentShaderSource(gl);
    expect(depthFragmentShaderSource).toContain('SourceCoordinate source = SourceCoordinate(');
    expect(depthFragmentShaderSource).toContain('DisplaySample displaySample = readDisplaySample(source);');
  });

  it('uses the injected adaptive budget for 3D point-cloud sampling', () => {
    const { renderer, gl } = createHarness({
      resolveDepthPointBudget: () => CONSTRAINED_DEPTH_POINTS
    });
    const state = {
      ...createInitialState(),
      viewerMode: '3d' as const,
      depthChannel: 'Z',
      depthFocalLengthPx: null,
      depthPointSizePx: 2,
      hoveredPixel: null,
      draftRoi: null,
      roiInteraction: createEmptyRoiInteractionState()
    };

    renderer.setDisplaySelectionBindings(
      'session-1',
      0,
      800,
      600,
      createEmptyDisplaySourceBinding()
    );
    renderer.setDepthSourceBinding(
      'session-1',
      0,
      800,
      600,
      { kind: 'scalarDepth', channelName: 'Z' },
      { kind: 'scalarDepth', range: { min: 1, max: 4 } }
    );
    renderer.resize(320, 180);

    renderer.render(state);

    expect(gl.drawArrays).toHaveBeenLastCalledWith(gl.POINTS, 0, 120_000);
    expect(lastUniform2iValue(gl, 'uDepthGridSize')).toEqual([400, 300]);
    expect(lastUniform1iValue(gl, 'uDepthSampleStep')).toBe(2);
  });

  it('caps desktop 3D point-cloud sampling by viewport and point size', () => {
    const { renderer, gl } = createHarness();
    const state = {
      ...createInitialState(),
      viewerMode: '3d' as const,
      depthChannel: 'Z',
      depthFocalLengthPx: null,
      depthPointSizePx: 2,
      hoveredPixel: null,
      draftRoi: null,
      roiInteraction: createEmptyRoiInteractionState()
    };

    renderer.setDisplaySelectionBindings(
      'session-1',
      0,
      2000,
      2000,
      createEmptyDisplaySourceBinding()
    );
    renderer.setDepthSourceBinding(
      'session-1',
      0,
      2000,
      2000,
      { kind: 'scalarDepth', channelName: 'Z' },
      { kind: 'scalarDepth', range: { min: 1, max: 4 } }
    );
    renderer.resize(320, 180);

    renderer.render(state);

    expect(gl.drawArrays).toHaveBeenLastCalledWith(gl.POINTS, 0, 160_000);
    expect(lastUniform2iValue(gl, 'uDepthGridSize')).toEqual([400, 400]);
    expect(lastUniform1iValue(gl, 'uDepthSampleStep')).toBe(5);
  });

  it('renders XYZ position sources through the point-cloud pass', () => {
    const { renderer, gl } = createHarness();
    const layer = createInterleavedLayerFromChannels({
      R: [1, 0, 0, 1],
      G: [0, 1, 0, 1],
      B: [0, 0, 1, 1],
      'P.X': [-1, 1, -1, 1],
      'P.Y': [-2, -2, 2, 2],
      'P.Z': [3, 3, 5, 5]
    });
    const state = {
      ...createInitialState(),
      viewerMode: '3d' as const,
      depthChannel: '__position:P',
      depthYawDeg: 120,
      depthPitchDeg: -120,
      depthZoom: 1.5,
      depthFocalLengthPx: null,
      depthPointSizePx: 4,
      displaySelection: createChannelRgbSelection('R', 'G', 'B'),
      hoveredPixel: null,
      draftRoi: null,
      roiInteraction: createEmptyRoiInteractionState()
    };

    renderer.ensureLayerChannelsResident('session-1', 0, 2, 2, layer, ['R', 'G', 'B', 'P.X', 'P.Y', 'P.Z']);
    renderer.setDisplaySelectionBindings(
      'session-1',
      0,
      2,
      2,
      buildDisplaySourceBinding(layer, state.displaySelection)
    );
    renderer.setDepthSourceBinding(
      'session-1',
      0,
      2,
      2,
      {
        kind: 'xyzPosition',
        base: 'P',
        xChannel: 'P.X',
        yChannel: 'P.Y',
        zChannel: 'P.Z'
      },
      {
        kind: 'xyzPosition',
        bounds: {
          minX: -1,
          maxX: 1,
          minY: -2,
          maxY: 2,
          minZ: 3,
          maxZ: 5
        }
      }
    );
    renderer.resize(320, 180);

    renderer.render(state);

    expect(gl.drawArrays).toHaveBeenLastCalledWith(gl.POINTS, 0, 4);
    expect(lastUniform1iValue(gl, 'uDepthSourceKind')).toBe(1);
    expect(lastUniform1fValue(gl, 'uDepthYawDeg')).toBe(120);
    expect(lastUniform1fValue(gl, 'uDepthPitchDeg')).toBe(-120);
    expect(lastUniform3fValue(gl, 'uDepthPositionBoundsMin')).toEqual([-1, -2, 3]);
    expect(lastUniform3fValue(gl, 'uDepthPositionBoundsMax')).toEqual([1, 2, 5]);
    const depthCameraZRange = lastUniform2fValue(gl, 'uDepthCameraZRange');
    expect(depthCameraZRange).toEqual([expect.any(Number), expect.any(Number)]);
    expect(depthCameraZRange![0]).toBeLessThan(depthCameraZRange![1]);
  });

  it('reuses export framebuffers and textures when the export size is unchanged', () => {
    const { renderer, gl } = createHarness();
    const layer = createInterleavedLayerFromChannels({
      R: [1, 2],
      G: [3, 4],
      B: [5, 6]
    });
    const state = {
      ...createInitialState(),
      displaySelection: createChannelRgbSelection('R', 'G', 'B'),
      hoveredPixel: null,
      draftRoi: null,
      roiInteraction: createEmptyRoiInteractionState()
    };

    renderer.ensureLayerChannelsResident('session-1', 0, 2, 1, layer, ['R', 'G', 'B']);
    renderer.setDisplaySelectionBindings(
      'session-1',
      0,
      2,
      1,
      buildDisplaySourceBinding(layer, state.displaySelection)
    );
    gl.readPixels.mockImplementation((_x, _y, _width, _height, _format, _type, data: Uint8ClampedArray) => {
      data.set([1, 2, 3, 255, 4, 5, 6, 255]);
    });

    const first = renderer.readExportPixels({
      state,
      sourceWidth: 2,
      sourceHeight: 1
    });
    const framebuffersAfterFirst = gl.createFramebuffer.mock.calls.length;
    const texturesAfterFirst = gl.createTexture.mock.calls.length;

    const second = renderer.readExportPixels({
      state,
      sourceWidth: 2,
      sourceHeight: 1
    });

    expect(first).toEqual({
      width: 2,
      height: 1,
      data: new Uint8ClampedArray([1, 2, 3, 255, 4, 5, 6, 255])
    });
    expect(second).toEqual(first);
    expect(gl.createFramebuffer.mock.calls.length).toBe(framebuffersAfterFirst);
    expect(gl.createTexture.mock.calls.length).toBe(texturesAfterFirst);
  });

  it('reads the source-sized export buffer without resampling', () => {
    const { renderer, gl } = createHarness();
    const layer = createInterleavedLayerFromChannels({
      R: [1, 2, 3, 4],
      G: [1, 2, 3, 4],
      B: [1, 2, 3, 4]
    });
    const state = {
      ...createInitialState(),
      displaySelection: createChannelRgbSelection('R', 'G', 'B'),
      hoveredPixel: null,
      draftRoi: null,
      roiInteraction: createEmptyRoiInteractionState()
    };

    renderer.ensureLayerChannelsResident('session-1', 0, 2, 2, layer, ['R', 'G', 'B']);
    renderer.setDisplaySelectionBindings(
      'session-1',
      0,
      2,
      2,
      buildDisplaySourceBinding(layer, state.displaySelection)
    );
    gl.readPixels.mockImplementation((_x, _y, width, height, _format, _type, data: Uint8ClampedArray) => {
      expect(width).toBe(2);
      expect(height).toBe(2);
      data.set([10, 20, 30, 255, 40, 50, 60, 255, 70, 80, 90, 255, 100, 110, 120, 255]);
    });

    const pixels = renderer.readExportPixels({
      state,
      sourceWidth: 2,
      sourceHeight: 2
    });

    expect(gl.blitFramebuffer).not.toHaveBeenCalled();
    expect(pixels).toEqual({
      width: 2,
      height: 2,
      data: new Uint8ClampedArray([70, 80, 90, 255, 100, 110, 120, 255, 10, 20, 30, 255, 40, 50, 60, 255])
    });
  });

  it('renders the onscreen viewer with an opaque checker while preserving transparent export mode', () => {
    const { renderer, gl } = createHarness();
    const layer = createInterleavedLayerFromChannels({
      R: [1],
      G: [0],
      B: [0],
      A: [0.5]
    });
    const state = {
      ...createInitialState(),
      displayGamma: 1.8,
      invalidValueWarningEnabled: true,
      invalidValueWarningPhase: 1,
      displaySelection: createChannelRgbSelection('R', 'G', 'B', 'A'),
      hoveredPixel: null,
      draftRoi: null,
      roiInteraction: createEmptyRoiInteractionState()
    };

    renderer.ensureLayerChannelsResident('session-1', 0, 1, 1, layer, ['R', 'G', 'B', 'A']);
    renderer.setDisplaySelectionBindings(
      'session-1',
      0,
      1,
      1,
      buildDisplaySourceBinding(layer, state.displaySelection)
    );

    renderer.render(state);

    expect(lastUniform1iValue(gl, 'uBackgroundMode')).toBe(1);
    expect(lastUniform3fValue(gl, 'uBackgroundColor')).toEqual([0, 0, 0]);
    expect(lastUniform1iValue(gl, 'uAlphaOutputMode')).toBe(0);
    expect(lastUniform1fValue(gl, 'uDisplayGamma')).toBe(1.8);
    expect(lastUniform1iValue(gl, 'uWarnInvalidValues')).toBe(1);
    expect(lastUniform1fValue(gl, 'uInvalidValueWarningPhase')).toBe(1);

    gl.uniform1i.mockClear();
    gl.readPixels.mockImplementation((_x, _y, _width, _height, _format, _type, data: Uint8ClampedArray) => {
      data.set([255, 0, 0, 128]);
    });

    renderer.readExportPixels({
      state,
      sourceWidth: 1,
      sourceHeight: 1
    });

    expect(lastUniform1iValue(gl, 'uBackgroundMode')).toBe(0);
    expect(lastUniform1iValue(gl, 'uAlphaOutputMode')).toBe(1);
    expect(lastUniform1iValue(gl, 'uWarnInvalidValues')).toBe(0);
  });

  it('renders the onscreen viewer with the selected solid background', () => {
    const { renderer, gl } = createHarness();
    const layer = createInterleavedLayerFromChannels({
      R: [1],
      G: [0],
      B: [0],
      A: [0.5]
    });
    const state = {
      ...createInitialState(),
      viewerBackground: 'gray' as const,
      displaySelection: createChannelRgbSelection('R', 'G', 'B', 'A'),
      hoveredPixel: null,
      draftRoi: null,
      roiInteraction: createEmptyRoiInteractionState()
    };

    renderer.ensureLayerChannelsResident('session-1', 0, 1, 1, layer, ['R', 'G', 'B', 'A']);
    renderer.setDisplaySelectionBindings(
      'session-1',
      0,
      1,
      1,
      buildDisplaySourceBinding(layer, state.displaySelection)
    );

    renderer.render(state);

    expect(lastUniform1iValue(gl, 'uBackgroundMode')).toBe(2);
    expect(lastUniform3fValue(gl, 'uBackgroundColor')).toEqual([0.5, 0.5, 0.5]);
    expect(lastUniform1iValue(gl, 'uAlphaOutputMode')).toBe(0);
  });

  it('progressively accumulates path tracing and resets only for radiance-changing state', () => {
    const { renderer, gl } = createHarness({ floatAccumulationSupported: true });
    const layer = createInterleavedLayerFromChannels({
      R: [1, 0.5],
      G: [0.5, 0.25],
      B: [0.25, 0.125]
    });
    const state = {
      ...createInitialState(),
      viewerMode: 'panorama' as const,
      panoramaDisplayMode: 'environmentLighting' as const,
      panoramaLightingMethod: 'pathTracing' as const,
      displaySelection: createChannelRgbSelection('R', 'G', 'B'),
      hoveredPixel: null,
      draftRoi: null,
      roiInteraction: createEmptyRoiInteractionState()
    };
    renderer.resize(100, 80, 0, 0, 1);
    renderer.ensureLayerChannelsResident('session-1', 0, 2, 1, layer, ['R', 'G', 'B']);
    renderer.setDisplaySelectionBindings(
      'session-1',
      0,
      2,
      1,
      buildDisplaySourceBinding(layer, state.displaySelection),
      'revision-1'
    );
    renderer.setEnvironmentImportanceSampling({
      projection: 'equirectangular',
      gridWidth: 2,
      gridHeight: 1,
      entryCount: 2,
      rgba32f: new Float32Array([
        1, 0, 0.5, 0,
        1, 1, 0.5, 0
      ])
    });

    expect(renderer.render(state)).toBe(true);
    expect(readRootPathTracingSampleCount(renderer)).toBe(1);
    expect(lastUniform2iValue(gl, 'uEnvironmentSampleCounts')).toEqual([128, 256]);
    expect(lastUniform1iValue(gl, 'uPathTracingMaxBounces')).toBe(6);
    expect(lastUniform2iValue(gl, 'uEnvironmentImportanceGridSize')).toEqual([2, 1]);
    expect(lastUniform1iValue(gl, 'uEnvironmentImportanceEntryCount')).toBe(2);
    expect(renderer.render(state)).toBe(true);
    expect(readRootPathTracingSampleCount(renderer)).toBe(2);

    renderer.render({ ...state, exposureEv: 2, displayGamma: 1.8 });
    expect(readRootPathTracingSampleCount(renderer)).toBe(3);

    renderer.setDisplaySelectionBindings(
      'session-1',
      0,
      2,
      1,
      buildDisplaySourceBinding(layer, state.displaySelection),
      'revision-2'
    );
    renderer.render(state);
    expect(readRootPathTracingSampleCount(renderer)).toBe(1);

    renderer.render({ ...state, panoramaYawDeg: 15 });
    expect(readRootPathTracingSampleCount(renderer)).toBe(1);

    const changedMaterialState = {
      ...state,
      panoramaYawDeg: 15,
      environmentSphereMaterial: {
        ...state.environmentSphereMaterial,
        type: 'roughplastic' as const
      }
    };
    renderer.render(changedMaterialState);
    expect(readRootPathTracingSampleCount(renderer)).toBe(1);

    setRootPathTracingSampleCount(renderer, DEFAULT_PATH_TRACING_MAX_SAMPLES - 1);
    expect(renderer.render(changedMaterialState)).toBe(false);
    expect(readRootPathTracingSampleCount(renderer)).toBe(DEFAULT_PATH_TRACING_MAX_SAMPLES);

    // The limit controls stopping only; changing it must retain the accumulated image.
    const convergedSurface = getRendererState(renderer).pathTracingSurfaces.get('root');
    const stoppedState = { ...changedMaterialState, pathTracingMaxSamples: 32 };
    expect(renderer.render(stoppedState)).toBe(false);
    expect(readRootPathTracingSampleCount(renderer)).toBe(DEFAULT_PATH_TRACING_MAX_SAMPLES);
    const resumedState = { ...changedMaterialState, pathTracingMaxSamples: DEFAULT_PATH_TRACING_MAX_SAMPLES + 2 };
    expect(renderer.render(resumedState)).toBe(true);
    expect(readRootPathTracingSampleCount(renderer)).toBe(DEFAULT_PATH_TRACING_MAX_SAMPLES + 1);
    expect(renderer.render(resumedState)).toBe(false);
    expect(readRootPathTracingSampleCount(renderer)).toBe(DEFAULT_PATH_TRACING_MAX_SAMPLES + 2);
    expect(getRendererState(renderer).pathTracingSurfaces.get('root')).toBe(convergedSurface);

    renderer.setPanes([{
      path: [1],
      rect: { x: 0, y: 0, width: 100, height: 80 },
      viewport: { width: 100, height: 80 },
      active: true
    }]);
    expect(readRootPathTracingSampleCount(renderer)).toBeUndefined();
  });

  it('retains all RGB Stokes accumulation across display selections and resets on material edits', () => {
    const { renderer, gl, layer, state } = createPolarizedHarness();
    expect(renderer.render(state)).toBe(true);
    const renderState = getRendererState(renderer);
    const surface = renderState.pathTracingSurfaces.get('root')!;
    expect(surface.polarized).toBe(true);
    expect(surface.stokesTextures.map(textures => textures.length)).toEqual([4, 4]);
    expect(new Set(surface.stokesTextures.flat()).size).toBe(8);
    expect(gl.drawBuffers).toHaveBeenCalledTimes(2);
    expect(gl.drawBuffers).toHaveBeenCalledWith([0, 1, 2, 3].map(index => gl.COLOR_ATTACHMENT0 + index));
    expect(lastUniform1iValue(gl, 'uEnvironmentPolarized')).toBe(1);
    expect(lastUniform1iValue(gl, 'uEnvironmentImportanceProjection')).toBe(2);
    const source = renderState.activePolarizedEnvironment!;
    const environment = renderState.environmentRadianceCache.getOrCreatePolarized(source.sourceKey, source);

    const select = (selection: ViewerState['displaySelection'], colormap = false) => {
      const binding = buildDisplaySourceBinding(layer, selection, colormap ? 'colormap' : 'rgb');
      renderer.ensureLayerChannelsResident('penvmap', 0, 2, 3, layer, getDisplaySourceBindingChannelNames(binding));
      renderer.setDisplaySelectionBindings('penvmap', 0, 2, 3, binding, 'display-selection-changed');
      return { ...state, displaySelection: selection, visualizationMode: colormap ? 'colormap' as const : 'rgb' as const };
    };
    renderer.render(select(createStokesSelection('dolp', 'stokesRgb')));
    expect(surface.sampleCount).toBe(2);
    renderer.render(select(createStokesSelection('aolp', 'stokesRgb'), true));
    expect(surface.sampleCount).toBe(3);
    const circularState = select(createChannelRgbSelection('S3.R', 'S3.G', 'S3.B'));
    renderer.render(circularState);
    expect(lastUniform1iValue(gl, 'uPathTracingOutputComponent')).toBe(3);
    expect(surface.sampleCount).toBe(4);
    renderer.render({ ...circularState, maskInvalidStokesVectors: true, exposureEv: 3, displayGamma: 1.6 });
    expect(surface.sampleCount).toBe(5);
    expect(renderState.pathTracingSurfaces.get('root')).toBe(surface);
    expect(renderState.environmentRadianceCache.getOrCreatePolarized(source.sourceKey, source)).toBe(environment);
    expect(gl.drawBuffers).toHaveBeenCalledTimes(2);

    renderer.render({
      ...circularState,
      environmentSphereMaterial: { ...state.environmentSphereMaterial, type: 'roughSilver', alpha: 0.3, distribution: 'ggx' }
    });
    expect(surface.sampleCount).toBe(1);
    expect(renderState.pathTracingSurfaces.get('root')).toBe(surface);
    expect(lastUniform1iValue(gl, 'uEnvironmentSphereRoughSilver')).toBe(1);
    renderer.render({
      ...circularState,
      environmentSphereMaterial: { ...state.environmentSphereMaterial, type: 'pplastic', alpha: 0.12 }
    });
    expect(surface.sampleCount).toBe(1);
    expect(lastUniform1iValue(gl, 'uEnvironmentSpherePolarizedPlastic')).toBe(1);
    expect(lastUniform1iValue(gl, 'uEnvironmentSphereRoughSilver')).toBe(0);
    const ownedTextures = [...surface.stokesTextures.flat(), ...environment.textures, environment.importanceTexture];
    renderer.dispose();
    for (const texture of ownedTextures) expect(gl.deleteTexture).toHaveBeenCalledWith(texture);
  });

  it('restores raw RGB source units after polarized rendering when switching to image, panorama, depth, or export', () => {
    const { renderer, gl, state } = createPolarizedHarness();
    const expected = getRendererState(renderer).activeSourceTextures.slice(0, 3);
    const expectRawBindings = () => {
      for (let index = 0; index < 3; index += 1) {
        gl.activeTexture(gl.TEXTURE0 + index);
        expect(gl.getParameter(gl.TEXTURE_BINDING_2D)).toBe(expected[index]);
      }
    };
    renderer.render(state);
    gl.activeTexture(gl.TEXTURE0 + 1);
    expect(gl.getParameter(gl.TEXTURE_BINDING_2D)).not.toBe(expected[1]);
    renderer.render({ ...state, viewerMode: 'image' });
    expectRawBindings();
    renderer.render(state);
    renderer.render({ ...state, panoramaDisplayMode: 'image' });
    expectRawBindings();
    renderer.render(state);
    renderer.render({ ...state, viewerMode: '3d', depthChannel: 'Z' });
    expect(gl.drawArrays).toHaveBeenLastCalledWith(gl.POINTS, 0, 6);
    expectRawBindings();
    renderer.render(state);
    const liveSampleCount = readRootPathTracingSampleCount(renderer);
    renderer.readExportPixels({ state, sourceWidth: 2, sourceHeight: 3, outputWidth: 2, outputHeight: 3 });
    expectRawBindings();
    expect(readRootPathTracingSampleCount(renderer)).toBe(liveSampleCount);
    renderer.dispose();
  });

  it('exports a polarized viewport without replacing or advancing its progressive surfaces', () => {
    const { renderer, gl, state, layer } = createPolarizedHarness();
    renderer.render(state);
    renderer.render(state);
    const surface = getRendererState(renderer).pathTracingSurfaces.get('root')!;
    const previousReadIndex = surface.readIndex;
    const selection = createStokesSelection('aolp', 'stokesRgb');
    const binding = buildDisplaySourceBinding(layer, selection, 'colormap');
    renderer.ensureLayerChannelsResident('penvmap', 0, 2, 3, layer, getDisplaySourceBindingChannelNames(binding));
    renderer.setDisplaySelectionBindings('penvmap', 0, 2, 3, binding);
    const drawsBefore = vi.mocked(gl.drawArrays).mock.calls.length;
    renderer.readExportPixels({
      state: { ...state, displaySelection: selection, visualizationMode: 'colormap' },
      sourceWidth: 2, sourceHeight: 3, outputWidth: 20, outputHeight: 15,
      screenshot: { coordinateSpace: 'viewport', rect: { x: 10, y: 10, width: 20, height: 15 }, sourceViewport: { width: 100, height: 80 } }
    });
    expect(lastUniform1iValue(gl, 'uEnvironmentPolarized')).toBe(1);
    expect(lastUniform1iValue(gl, 'uPathTracingPass')).toBe(1);
    expect(lastUniform1iValue(gl, 'uPathTracingSampleIndex')).toBe(63);
    expect(lastUniform1fValue(gl, 'uPathTracingBlendWeight')).toBe(1 / 64);
    expect(lastUniform1iValue(gl, 'uStokesParameter')).toBe(0);
    expect(lastUniform2fValue(gl, 'uScreenOrigin')).toEqual([10, 10]);
    expect(vi.mocked(gl.drawArrays).mock.calls.length - drawsBefore).toBe(128);
    expect(gl.drawBuffers).toHaveBeenCalledTimes(4);
    expect(getRendererState(renderer).pathTracingSurfaces.get('root')).toBe(surface);
    expect(getRendererState(renderer).pathTracingSurfaces.has('__export')).toBe(false);
    expect(surface.sampleCount).toBe(2);
    expect(surface.readIndex).toBe(previousReadIndex);
    expect(renderer.render(state)).toBe(true);
    expect(surface.sampleCount).toBe(3);
    renderer.dispose();
  });

  it('preserves live accumulation when an export accumulation framebuffer cannot be allocated', () => {
    const { renderer, gl, state } = createPolarizedHarness();
    renderer.render(state);
    const surface = getRendererState(renderer).pathTracingSurfaces.get('root')!;
    vi.mocked(gl.checkFramebufferStatus).mockReturnValueOnce(gl.FRAMEBUFFER_COMPLETE).mockReturnValueOnce(0);
    expect(() => renderer.readExportPixels({
      state, sourceWidth: 2, sourceHeight: 3, outputWidth: 20, outputHeight: 15,
      screenshot: { coordinateSpace: 'viewport', rect: { x: 10, y: 10, width: 20, height: 15 }, sourceViewport: { width: 100, height: 80 } }
    })).toThrow('framebuffer is incomplete');
    expect(getRendererState(renderer).pathTracingSurfaces.get('root')).toBe(surface);
    expect(surface.sampleCount).toBe(1);
    expect(getRendererState(renderer).pathTracingFloatAccumulationSupported).toBe(true);
    expect(getRendererState(renderer).pathTracingSurfaces.has('__export')).toBe(false);
    renderer.render(state);
    expect(surface.sampleCount).toBe(2);
    renderer.dispose();
  });

  it('keeps the renderer-owned invalid value warning phase across ordinary redraws', () => {
    const { renderer, gl } = createHarness();
    const layer = createInterleavedLayerFromChannels({
      R: [Number.NaN],
      G: [0],
      B: [0]
    });
    const state = {
      ...createInitialState(),
      invalidValueWarningEnabled: true,
      displaySelection: createChannelRgbSelection('R', 'G', 'B'),
      hoveredPixel: null,
      draftRoi: null,
      roiInteraction: createEmptyRoiInteractionState()
    };

    renderer.ensureLayerChannelsResident('session-1', 0, 1, 1, layer, ['R', 'G', 'B']);
    renderer.setDisplaySelectionBindings(
      'session-1',
      0,
      1,
      1,
      buildDisplaySourceBinding(layer, state.displaySelection)
    );
    renderer.setInvalidValueWarningPhase(1);
    renderer.render(state);

    expect(lastUniform1fValue(gl, 'uInvalidValueWarningPhase')).toBe(1);

    renderer.render({
      ...state,
      hoveredPixel: { ix: 0, iy: 0 }
    });

    expect(lastUniform1fValue(gl, 'uInvalidValueWarningPhase')).toBe(1);
  });

  it('keeps full-image RGB exports opaque while making screenshot backgrounds transparent', () => {
    const { renderer, gl } = createHarness();
    const layer = createInterleavedLayerFromChannels({
      R: [1, 0, 0, 1],
      G: [0, 1, 0, 1],
      B: [0, 0, 1, 1]
    });
    const state = {
      ...createInitialState(),
      displaySelection: createChannelRgbSelection('R', 'G', 'B'),
      hoveredPixel: null,
      draftRoi: null,
      roiInteraction: createEmptyRoiInteractionState()
    };

    renderer.ensureLayerChannelsResident('session-1', 0, 2, 2, layer, ['R', 'G', 'B']);
    renderer.setDisplaySelectionBindings(
      'session-1',
      0,
      2,
      2,
      buildDisplaySourceBinding(layer, state.displaySelection)
    );
    gl.readPixels.mockImplementation((_x, _y, _width, _height, _format, _type, data: Uint8ClampedArray) => {
      data.fill(255);
    });

    renderer.readExportPixels({
      state,
      sourceWidth: 2,
      sourceHeight: 2
    });

    expect(lastUniform1iValue(gl, 'uBackgroundMode')).toBe(0);
    expect(lastUniform1iValue(gl, 'uAlphaOutputMode')).toBe(0);

    gl.uniform1i.mockClear();

    renderer.readExportPixels({
      state,
      sourceWidth: 2,
      sourceHeight: 2,
      outputWidth: 40,
      outputHeight: 20,
      screenshot: {
        coordinateSpace: 'viewport',
        rect: { x: 10, y: 5, width: 20, height: 10 },
        sourceViewport: { width: 100, height: 50 }
      }
    });

    expect(lastUniform1iValue(gl, 'uBackgroundMode')).toBe(0);
    expect(lastUniform1iValue(gl, 'uAlphaOutputMode')).toBe(1);
  });

  it('renders bounded export pixels into the requested output dimensions', () => {
    const { renderer, gl } = createHarness();
    const layer = createInterleavedLayerFromChannels({
      R: [1, 0, 0, 1, 1, 0, 0, 1],
      G: [0, 1, 0, 1, 0, 1, 0, 1],
      B: [0, 0, 1, 1, 0, 0, 1, 1],
      A: [1, 0.5, 1, 0.5, 1, 0.5, 1, 0.5]
    });
    const state = {
      ...createInitialState(),
      displaySelection: createChannelRgbSelection('R', 'G', 'B', 'A'),
      hoveredPixel: null,
      draftRoi: null,
      roiInteraction: createEmptyRoiInteractionState()
    };

    renderer.ensureLayerChannelsResident('session-1', 0, 4, 2, layer, ['R', 'G', 'B', 'A']);
    renderer.setDisplaySelectionBindings(
      'session-1',
      0,
      4,
      2,
      buildDisplaySourceBinding(layer, state.displaySelection)
    );
    renderer.resize(320, 180, 0, 0, 2);
    gl.readPixels.mockImplementation((_x, _y, width, height, _format, _type, data: Uint8ClampedArray) => {
      expect(width).toBe(2);
      expect(height).toBe(1);
      data.set([10, 20, 30, 128, 40, 50, 60, 255]);
    });

    const pixels = renderer.readExportPixels({
      state,
      sourceWidth: 4,
      sourceHeight: 2,
      outputWidth: 2,
      outputHeight: 1
    });

    expect(pixels).toEqual({
      width: 2,
      height: 1,
      data: new Uint8ClampedArray([10, 20, 30, 128, 40, 50, 60, 255])
    });
    expect(gl.viewport).toHaveBeenCalledWith(0, 0, 2, 1);
    expect(gl.viewport).toHaveBeenLastCalledWith(0, 0, 640, 360);
    expect(lastUniform2fValue(gl, 'uViewport')).toEqual([2, 1]);
    expect(lastUniform2fValue(gl, 'uPan')).toEqual([2, 1]);
    expect(lastUniform1fValue(gl, 'uZoom')).toBe(0.5);
    expect(lastUniform1iValue(gl, 'uBackgroundMode')).toBe(0);
    expect(lastUniform1iValue(gl, 'uAlphaOutputMode')).toBe(1);
  });

  it('renders screenshot exports from the selected image viewer region', () => {
    const { renderer, gl } = createHarness();
    const layer = createInterleavedLayerFromChannels({
      R: [1, 0, 0, 1],
      G: [0, 1, 0, 1],
      B: [0, 0, 1, 1]
    });
    const state = {
      ...createInitialState(),
      zoom: 3,
      panX: 8,
      panY: 9,
      displaySelection: createChannelRgbSelection('R', 'G', 'B'),
      hoveredPixel: null,
      draftRoi: null,
      roiInteraction: createEmptyRoiInteractionState()
    };

    renderer.ensureLayerChannelsResident('session-1', 0, 2, 2, layer, ['R', 'G', 'B']);
    renderer.setDisplaySelectionBindings(
      'session-1',
      0,
      2,
      2,
      buildDisplaySourceBinding(layer, state.displaySelection)
    );
    gl.readPixels.mockImplementation((_x, _y, width, height, _format, _type, data: Uint8ClampedArray) => {
      expect(width).toBe(40);
      expect(height).toBe(20);
      data.fill(255);
    });

    renderer.readExportPixels({
      state,
      sourceWidth: 2,
      sourceHeight: 2,
      outputWidth: 40,
      outputHeight: 20,
      screenshot: {
        coordinateSpace: 'viewport',
        rect: { x: 10, y: 5, width: 20, height: 10 },
        sourceViewport: { width: 100, height: 50 }
      }
    });

    expect(lastUniform2fValue(gl, 'uViewport')).toEqual([200, 100]);
    expect(lastUniform2fValue(gl, 'uOutputSize')).toEqual([40, 20]);
    expect(lastUniform2fValue(gl, 'uScreenOrigin')).toEqual([20, 10]);
    expect(lastUniform2fValue(gl, 'uPan')).toEqual([8, 9]);
    expect(lastUniform1fValue(gl, 'uZoom')).toBe(6);
  });

  it('renders screenshot exports through the panorama pass when panorama mode is active', () => {
    const { renderer, gl } = createHarness({ floatLinearSupported: true, floatAccumulationSupported: true });
    const layer = createInterleavedLayerFromChannels({
      R: [1, 0, 0, 1],
      G: [0, 1, 0, 1],
      B: [0, 0, 1, 1]
    });
    const state = {
      ...createInitialState(),
      viewerMode: 'panorama' as const,
      panoramaDisplayMode: 'environmentLighting' as const,
      panoramaYawDeg: 17,
      panoramaPitchDeg: 90,
      panoramaHfovDeg: 90,
      environmentLightingInteractive: true,
      environmentSphereMaterial: {
        type: 'roughplastic' as const,
        diffuseReflectance: { r: 0.2, g: 0.3, b: 0.4 },
        alpha: 0.25,
        intIor: 1.6,
        extIor: 1.1,
        distribution: 'ggx' as const,
        nonlinear: true
      },
      displaySelection: createChannelRgbSelection('R', 'G', 'B'),
      hoveredPixel: null,
      draftRoi: null,
      roiInteraction: createEmptyRoiInteractionState()
    };

    renderer.ensureLayerChannelsResident('session-1', 0, 2, 2, layer, ['R', 'G', 'B']);
    renderer.setDisplaySelectionBindings(
      'session-1',
      0,
      2,
      2,
      buildDisplaySourceBinding(layer, state.displaySelection)
    );
    const environmentShIrradiance = Float32Array.from(
      { length: 108 },
      (_, index) => index + 0.25
    );
    renderer.setEnvironmentShIrradiance(environmentShIrradiance);

    renderer.readExportPixels({
      state,
      sourceWidth: 2,
      sourceHeight: 2,
      outputWidth: 40,
      outputHeight: 20,
      screenshot: {
        coordinateSpace: 'viewport',
        rect: { x: 10, y: 5, width: 20, height: 10 },
        sourceViewport: { width: 100, height: 50 }
      }
    });

    expect(lastUniform2fValue(gl, 'uViewport')).toEqual([200, 100]);
    expect(lastUniform2fValue(gl, 'uScreenOrigin')).toEqual([20, 10]);
    expect(lastUniform1fValue(gl, 'uPanoramaYawDeg')).toBe(17);
    expect(lastUniform1fValue(gl, 'uPanoramaPitchDeg')).toBeCloseTo(clampPanoramaProjectionPitch(90), 7);
    expect(lastUniform1fValue(gl, 'uPanoramaHfovDeg')).toBe(90);
    expect(lastUniform1iValue(gl, 'uPanoramaDisplayMode')).toBeUndefined();
    expect(lastUniform1iValue(gl, 'uSourceTextureMipmapsAvailable')).toBe(1);
    expect(lastUniform2iValue(gl, 'uEnvironmentSampleCounts')).toEqual([64, 64]);
    expect(lastUniform1iValue(gl, 'uPathTracingMaxBounces')).toBe(6);
    expect(lastUniform3fvValue(gl, 'uEnvironmentShIrradiance[0]')).toEqual(
      environmentShIrradiance
    );
    expect(lastUniform3fValue(gl, 'uEnvironmentSphereDiffuseReflectance')).toEqual([
      0.2,
      0.3,
      0.4
    ]);
    expect(lastUniform1fValue(gl, 'uEnvironmentSphereAlpha')).toBe(0.25);
    expect(lastUniform1fValue(gl, 'uEnvironmentSphereIntIor')).toBe(1.6);
    expect(lastUniform1fValue(gl, 'uEnvironmentSphereExtIor')).toBe(1.1);
    expect(lastUniform1iValue(gl, 'uEnvironmentSphereDistribution')).toBe(0);
    expect(lastUniform1iValue(gl, 'uEnvironmentSphereNonlinear')).toBe(1);
  });

  it('renders screenshot exports through the depth point-cloud pass when 3D mode is active', () => {
    const { renderer, gl } = createHarness();
    const layer = createInterleavedLayerFromChannels({
      R: [1, 0, 0, 1],
      G: [0, 1, 0, 1],
      B: [0, 0, 1, 1],
      Z: [1, 2, 3, 4]
    });
    const state = {
      ...createInitialState(),
      viewerMode: '3d' as const,
      depthChannel: 'Z',
      depthYawDeg: 17,
      depthPitchDeg: 20,
      depthZoom: 2,
      depthPointSizePx: 4,
      displaySelection: createChannelRgbSelection('R', 'G', 'B'),
      hoveredPixel: null,
      draftRoi: null,
      roiInteraction: createEmptyRoiInteractionState()
    };

    renderer.ensureLayerChannelsResident('session-1', 0, 2, 2, layer, ['R', 'G', 'B', 'Z']);
    renderer.setDisplaySelectionBindings(
      'session-1',
      0,
      2,
      2,
      buildDisplaySourceBinding(layer, state.displaySelection)
    );
    renderer.setDepthSourceBinding(
      'session-1',
      0,
      2,
      2,
      { kind: 'scalarDepth', channelName: 'Z' },
      { kind: 'scalarDepth', range: { min: 1, max: 4 } }
    );
    gl.readPixels.mockImplementation((_x, _y, width, height, _format, _type, data: Uint8ClampedArray) => {
      expect(width).toBe(40);
      expect(height).toBe(20);
      data.fill(0);
    });

    renderer.readExportPixels({
      state,
      sourceWidth: 2,
      sourceHeight: 2,
      outputWidth: 40,
      outputHeight: 20,
      screenshot: {
        coordinateSpace: 'viewport',
        rect: { x: 10, y: 5, width: 20, height: 10 },
        sourceViewport: { width: 100, height: 50 }
      }
    });

    expect(gl.framebufferRenderbuffer).toHaveBeenCalledWith(
      gl.FRAMEBUFFER,
      gl.DEPTH_ATTACHMENT,
      gl.RENDERBUFFER,
      expect.anything()
    );
    expect(gl.clear).toHaveBeenCalledWith(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    expect(gl.drawArrays).toHaveBeenLastCalledWith(gl.POINTS, 0, 4);
    expect(lastUniform2fValue(gl, 'uViewport')).toEqual([200, 100]);
    expect(lastUniform2fValue(gl, 'uOutputSize')).toEqual([40, 20]);
    expect(lastUniform2fValue(gl, 'uScreenOrigin')).toEqual([20, 10]);
    expect(lastUniform2fValue(gl, 'uDepthOutputOrigin')).toEqual([20, 10]);
    expect(lastUniform1fValue(gl, 'uDepthYawDeg')).toBe(17);
    expect(lastUniform1fValue(gl, 'uDepthPointSizePx')).toBe(4);
  });

  it('anchors checkerboard rendering to the viewport origin instead of the canvas origin', () => {
    const { renderer, gl } = createHarness();
    const layer = createInterleavedLayerFromChannels({
      R: [1],
      G: [1],
      B: [1]
    });
    const state = {
      ...createInitialState(),
      displaySelection: createChannelRgbSelection('R', 'G', 'B'),
      hoveredPixel: null,
      draftRoi: null,
      roiInteraction: createEmptyRoiInteractionState()
    };

    renderer.ensureLayerChannelsResident('session-1', 0, 1, 1, layer, ['R', 'G', 'B']);
    renderer.setDisplaySelectionBindings(
      'session-1',
      0,
      1,
      1,
      buildDisplaySourceBinding(layer, state.displaySelection)
    );
    renderer.resize(320, 180, 48.5, 12.25);

    renderer.render(state);

    expect(lastUniform2fValue(gl, 'uViewportOrigin')).toEqual([48.5, 12.25]);

    gl.uniform2f.mockClear();
    gl.readPixels.mockImplementation((_x, _y, _width, _height, _format, _type, data: Uint8ClampedArray) => {
      data.set([255, 255, 255, 255]);
    });

    renderer.readExportPixels({
      state,
      sourceWidth: 1,
      sourceHeight: 1
    });

    expect(lastUniform2fValue(gl, 'uViewportOrigin')).toEqual([0, 0]);
  });

  it('keeps CPU materialization and shader-facing bindings aligned for display modes', () => {
    const { renderer, gl } = createHarness();
    const cases = [
      {
        label: 'rgb',
        layer: createLayerFromChannels({ R: [0.25], G: [0.5], B: [1] }),
        selection: createChannelRgbSelection('R', 'G', 'B'),
        visualizationMode: 'rgb' as const,
        expectedPixel: [0.25, 0.5, 1, 1]
      },
      {
        label: 'mono alpha',
        layer: createLayerFromChannels({ Y: [0.75], A: [0.5] }),
        selection: createChannelMonoSelection('Y', 'A'),
        visualizationMode: 'rgb' as const,
        expectedPixel: [0.75, 0.75, 0.75, 0.5]
      },
      {
        label: 'normal map',
        layer: createLayerFromChannels({ 'normal.X': [0], 'normal.Y': [0], 'normal.Z': [1] }),
        selection: createChannelRgbSelection('normal.X', 'normal.Y', 'normal.Z', null, 'normalMap'),
        visualizationMode: 'colormap' as const,
        expectedPixel: [0.5, 0.5, 1, 1]
      },
      {
        label: 'scalar stokes',
        layer: createLayerFromChannels({ S0: [1], S1: [0], S2: [1], S3: [0] }),
        selection: createStokesSelection('aolp'),
        visualizationMode: 'rgb' as const,
        expectedPixel: [Math.PI / 4, Math.PI / 4, Math.PI / 4, 1]
      },
      {
        label: 'grouped rgb stokes',
        layer: createLayerFromChannels({
          'S0.R': [1], 'S0.G': [2], 'S0.B': [4],
          'S1.R': [1], 'S1.G': [1], 'S1.B': [2],
          'S2.R': [0], 'S2.G': [Math.sqrt(3)], 'S2.B': [0],
          'S3.R': [0], 'S3.G': [0], 'S3.B': [0]
        }),
        selection: createStokesSelection('dolp', 'stokesRgb'),
        visualizationMode: 'rgb' as const,
        expectedPixel: [1, 1, 0.5, 1]
      },
      {
        label: 'grouped rgb stokes colormap',
        layer: createLayerFromChannels({
          'S0.R': [1], 'S0.G': [2], 'S0.B': [4],
          'S1.R': [1], 'S1.G': [1], 'S1.B': [2],
          'S2.R': [0], 'S2.G': [Math.sqrt(3)], 'S2.B': [0],
          'S3.R': [0], 'S3.G': [0], 'S3.B': [0]
        }),
        selection: createStokesSelection('dolp', 'stokesRgb'),
        visualizationMode: 'colormap' as const,
        expectedPixel: [
          0.8480879693007776,
          0.8480879693007776,
          0.8480879693007776,
          1
        ]
      }
    ];

    for (let index = 0; index < cases.length; index += 1) {
      const item = cases[index];
      const binding = buildDisplaySourceBinding(item.layer, item.selection, item.visualizationMode);
      const cpuTexture = buildSelectedDisplayTexture(item.layer, 1, 1, item.selection, item.visualizationMode);
      const state = {
        ...createInitialState(),
        visualizationMode: item.visualizationMode,
        displaySelection: item.selection,
        hoveredPixel: null,
        draftRoi: null,
        roiInteraction: createEmptyRoiInteractionState()
      };

      renderer.ensureLayerChannelsResident(
        `session-${index}`,
        0,
        1,
        1,
        item.layer,
        getDisplaySourceBindingChannelNames(binding)
      );
      renderer.setDisplaySelectionBindings(`session-${index}`, 0, 1, 1, binding);
      gl.readPixels.mockImplementationOnce((_x, _y, _width, _height, _format, _type, data: Uint8ClampedArray) => {
        data.set([index, index + 1, index + 2, 255]);
      });

      const pixels = renderer.readExportPixels({
        state,
        sourceWidth: 1,
        sourceHeight: 1
      });

      expect(item.label).toBeTruthy();
      expect(lastUniform1iValue(gl, 'uDisplayMode')).toBe(resolveDisplaySourceModeUniformValue(binding.mode));
      expect(pixels.data).toEqual(new Uint8ClampedArray([index, index + 1, index + 2, 255]));
      for (let channel = 0; channel < item.expectedPixel.length; channel += 1) {
        expect(cpuTexture[channel]).toBeCloseTo(item.expectedPixel[channel], 6);
      }
    }
  });
});

function createPanoramaState(overrides: Partial<ViewerState> = {}): ViewerState {
  return {
    ...createInitialState(),
    viewerMode: 'panorama',
    panoramaDisplayMode: 'image',
    panoramaLightingMethod: 'sphericalHarmonics',
    hoveredPixel: null,
    draftRoi: null,
    roiInteraction: createEmptyRoiInteractionState(),
    ...overrides
  };
}

function createHarness(options: {
  resolveDepthPointBudget?: DepthPointBudgetResolver;
  floatLinearSupported?: boolean;
  floatAccumulationSupported?: boolean;
  parallelCompilation?: { complete: boolean };
} = {}): {
  renderer: GlImageRenderer;
  gl: ReturnType<typeof createWebGlContextMock>;
  canvas: HTMLCanvasElement;
} {
  const gl = createWebGlContextMock({
    floatLinearSupported: options.floatLinearSupported ?? false,
    floatAccumulationSupported: options.floatAccumulationSupported ?? false,
    parallelCompilation: options.parallelCompilation
  });
  const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((contextId) => {
    if (contextId === 'webgl2') {
      return gl;
    }
    return null;
  });

  const canvas = document.createElement('canvas');
  const renderer = new GlImageRenderer(canvas, options.resolveDepthPointBudget);
  expect(getContext).toHaveBeenCalledWith('webgl2', { antialias: false });
  return {
    renderer,
    gl,
    canvas
  };
}

function createPolarizedHarness(options: { parallelCompilation?: { complete: boolean } } = {}) {
  const { renderer, gl } = createHarness({ floatAccumulationSupported: true, ...options });
  const layer = createLayerFromChannels({
    R: [1, 1, 1, 1, 1, 1], G: [2, 2, 2, 2, 2, 2], B: [3, 3, 3, 3, 3, 3], Z: [1, 1, 1, 1, 1, 1],
    ...Object.fromEntries(['S0', 'S1', 'S2', 'S3'].flatMap((component, index) =>
      ['R', 'G', 'B'].map(color => [`${component}.${color}`, Array(6).fill(index === 0 ? 1 : -0.1)])))
  });
  const state = createPanoramaState({
    panoramaDisplayMode: 'environmentLighting', panoramaLightingMethod: 'pathTracing',
    displaySelection: createChannelRgbSelection('R', 'G', 'B')
  });
  renderer.resize(100, 80, 0, 0, 1);
  renderer.ensureLayerChannelsResident('penvmap', 0, 2, 3, layer, ['R', 'G', 'B', 'Z']);
  renderer.setDisplaySelectionBindings('penvmap', 0, 2, 3, buildDisplaySourceBinding(layer, state.displaySelection), 'initial');
  renderer.setDepthSourceBinding('penvmap', 0, 2, 3, { kind: 'scalarDepth', channelName: 'Z' }, { kind: 'scalarDepth', range: { min: 1, max: 1 } });
  return { renderer, gl, layer, state };
}

function getRendererState(renderer: GlImageRenderer): GlImageRendererState {
  return (renderer as unknown as { state: GlImageRendererState }).state;
}

function getLayerTexturesBySession(renderer: GlImageRenderer): Map<string, Map<number, unknown>> {
  return (renderer as unknown as { layerTexturesBySession: Map<string, Map<number, unknown>> }).layerTexturesBySession;
}

function getLayerTextureChannels(renderer: GlImageRenderer, sessionId: string, layerIndex: number): string[] {
  const layerTextures = getLayerTexturesBySession(renderer).get(sessionId)?.get(layerIndex) as {
    textureByChannel: Map<string, unknown>;
  } | undefined;
  return [...(layerTextures?.textureByChannel.keys() ?? [])];
}

function readRootPathTracingSampleCount(renderer: GlImageRenderer): number | undefined {
  const state = (renderer as unknown as {
    state: {
      pathTracingSurfaces: Map<string, { sampleCount: number }>;
    };
  }).state;
  return state.pathTracingSurfaces.get('root')?.sampleCount;
}

function setRootPathTracingSampleCount(renderer: GlImageRenderer, sampleCount: number): void {
  const state = (renderer as unknown as {
    state: {
      pathTracingSurfaces: Map<string, { sampleCount: number }>;
    };
  }).state;
  const surface = state.pathTracingSurfaces.get('root');
  if (!surface) {
    throw new Error('Expected root path-tracing surface.');
  }
  surface.sampleCount = sampleCount;
}

function lastUniform1iValue(
  gl: ReturnType<typeof createWebGlContextMock>,
  uniformName: string
): number | undefined {
  const calls = gl.uniform1i.mock.calls.filter((call) => {
    const [location] = call as [{ name?: string } | null, ...unknown[]];
    return location?.name === uniformName;
  });
  return calls.at(-1)?.[1] as number | undefined;
}

function lastUniform1fValue(
  gl: ReturnType<typeof createWebGlContextMock>,
  uniformName: string
): number | undefined {
  const calls = gl.uniform1f.mock.calls.filter((call) => {
    const [location] = call as [{ name?: string } | null, ...unknown[]];
    return location?.name === uniformName;
  });
  return calls.at(-1)?.[1] as number | undefined;
}

function lastUniform2fValue(
  gl: ReturnType<typeof createWebGlContextMock>,
  uniformName: string
): [number, number] | undefined {
  const calls = gl.uniform2f.mock.calls.filter((call) => {
    const [location] = call as [{ name?: string } | null, ...unknown[]];
    return location?.name === uniformName;
  });
  const lastCall = calls.at(-1);
  if (!lastCall) {
    return undefined;
  }
  return [lastCall[1] as number, lastCall[2] as number];
}

function lastUniform3fValue(
  gl: ReturnType<typeof createWebGlContextMock>,
  uniformName: string
): [number, number, number] | undefined {
  const calls = gl.uniform3f.mock.calls.filter((call) => {
    const [location] = call as [{ name?: string } | null, ...unknown[]];
    return location?.name === uniformName;
  });
  const lastCall = calls.at(-1);
  if (!lastCall) {
    return undefined;
  }
  return [lastCall[1] as number, lastCall[2] as number, lastCall[3] as number];
}

function lastUniform3fvValue(
  gl: ReturnType<typeof createWebGlContextMock>,
  uniformName: string
): Float32Array | undefined {
  const calls = gl.uniform3fv.mock.calls.filter((call) => {
    const [location] = call as [{ name?: string } | null, ...unknown[]];
    return location?.name === uniformName;
  });
  return calls.at(-1)?.[1] as Float32Array | undefined;
}

function lastUniform2iValue(
  gl: ReturnType<typeof createWebGlContextMock>,
  uniformName: string
): [number, number] | undefined {
  const calls = gl.uniform2i.mock.calls.filter((call) => {
    const [location] = call as [{ name?: string } | null, ...unknown[]];
    return location?.name === uniformName;
  });
  const lastCall = calls.at(-1);
  if (!lastCall) {
    return undefined;
  }
  return [lastCall[1] as number, lastCall[2] as number];
}

function getDepthVertexShaderSource(gl: ReturnType<typeof createWebGlContextMock>): string {
  const shaderSource = gl.shaderSource as unknown as ReturnType<typeof vi.fn>;
  const source = shaderSource.mock.calls
    .map((call) => call[1] as string)
    .find((shaderSource) => shaderSource.includes('uDepthCameraZRange'));
  expect(source).toBeTruthy();
  return source ?? '';
}

function getDepthFragmentShaderSource(gl: ReturnType<typeof createWebGlContextMock>): string {
  const shaderSource = gl.shaderSource as unknown as ReturnType<typeof vi.fn>;
  const source = shaderSource.mock.calls
    .map((call) => call[1] as string)
    .find((candidate) => candidate.includes('flat in int vDepthValid'));
  expect(source).toBeTruthy();
  return source ?? '';
}

function createWebGlContextMock(options: {
  floatLinearSupported: boolean;
  floatAccumulationSupported: boolean;
  parallelCompilation?: { complete: boolean };
}): WebGL2RenderingContext & {
  texImage2D: ReturnType<typeof vi.fn>;
  texParameteri: ReturnType<typeof vi.fn>;
  getExtension: ReturnType<typeof vi.fn>;
  getError: ReturnType<typeof vi.fn>;
  createTexture: ReturnType<typeof vi.fn>;
  createFramebuffer: ReturnType<typeof vi.fn>;
  createRenderbuffer: ReturnType<typeof vi.fn>;
  deleteTexture: ReturnType<typeof vi.fn>;
  deleteRenderbuffer: ReturnType<typeof vi.fn>;
  deleteProgram: ReturnType<typeof vi.fn>;
  deleteVertexArray: ReturnType<typeof vi.fn>;
  readPixels: ReturnType<typeof vi.fn>;
  uniform1i: ReturnType<typeof vi.fn>;
  uniform1f: ReturnType<typeof vi.fn>;
  uniform2f: ReturnType<typeof vi.fn>;
  uniform3f: ReturnType<typeof vi.fn>;
  uniform3fv: ReturnType<typeof vi.fn>;
  uniform2i: ReturnType<typeof vi.fn>;
  clearColor: ReturnType<typeof vi.fn>;
  clear: ReturnType<typeof vi.fn>;
  scissor: ReturnType<typeof vi.fn>;
} {
  const programs = [{ id: 'program-1' }, { id: 'program-2' }, { id: 'program-3' }];
  const shaders = [
    { id: 'shader-1' },
    { id: 'shader-2' },
    { id: 'shader-3' },
    { id: 'shader-4' },
    { id: 'shader-5' },
    { id: 'shader-6' }
  ];
  const textures = [
    { id: 'texture-1' },
    { id: 'texture-2' },
    { id: 'texture-3' },
    { id: 'texture-4' },
    { id: 'texture-5' }
  ];
  const framebuffers = [{ id: 'framebuffer-1' }, { id: 'framebuffer-2' }];
  const renderbuffers = [{ id: 'renderbuffer-1' }, { id: 'renderbuffer-2' }];
  const vaos = [{ id: 'vao-1' }];
  let activeTextureUnit = 0x84c0;
  const boundTextures = new Map<number, WebGLTexture | null>();

  return {
    VERTEX_SHADER: 0x8b31,
    FRAGMENT_SHADER: 0x8b30,
    COMPILE_STATUS: 0x8b81,
    LINK_STATUS: 0x8b82,
    NO_ERROR: 0,
    TEXTURE0: 0x84c0,
    TEXTURE_2D: 0x0de1,
    UNPACK_ALIGNMENT: 0x0cf5,
    TEXTURE_MIN_FILTER: 0x2801,
    TEXTURE_MAG_FILTER: 0x2800,
    TEXTURE_WRAP_S: 0x2802,
    TEXTURE_WRAP_T: 0x2803,
    NEAREST: 0x2600,
    LINEAR: 0x2601,
    LINEAR_MIPMAP_LINEAR: 0x2703,
    REPEAT: 0x2901,
    CLAMP_TO_EDGE: 0x812f,
    RGBA8: 0x8058,
    RGBA32F: 0x8814,
    RGBA: 0x1908,
    UNSIGNED_BYTE: 0x1401,
    R32F: 0x822e,
    RED: 0x1903,
    FLOAT: 0x1406,
    TRIANGLES: 0x0004,
    POINTS: 0x0000,
    FRAMEBUFFER: 0x8d40,
    FRAMEBUFFER_BINDING: 0x8ca6,
    DRAW_FRAMEBUFFER_BINDING: 0x8ca6,
    READ_FRAMEBUFFER_BINDING: 0x8caa,
    READ_FRAMEBUFFER: 0x8ca8,
    DRAW_FRAMEBUFFER: 0x8ca9,
    RENDERBUFFER: 0x8d41,
    COLOR_ATTACHMENT0: 0x8ce0,
    DEPTH_ATTACHMENT: 0x8d00,
    DEPTH_COMPONENT16: 0x81a5,
    FRAMEBUFFER_COMPLETE: 0x8cd5,
    COLOR_BUFFER_BIT: 0x00004000,
    DEPTH_BUFFER_BIT: 0x00000100,
    SCISSOR_TEST: 0x0c11,
    SCISSOR_BOX: 0x0c10,
    VIEWPORT: 0x0ba2,
    ACTIVE_TEXTURE: 0x84e0,
    TEXTURE_BINDING_2D: 0x8069,
    DEPTH_TEST: 0x0b71,
    MAX_TEXTURE_SIZE: 4096,
    MAX_TEXTURE_IMAGE_UNITS: 16,
    createVertexArray: vi.fn(() => vaos.shift() ?? { id: 'vao-extra' }),
    createTexture: vi.fn(() => textures.shift() ?? { id: 'texture-extra' }),
    createFramebuffer: vi.fn(() => framebuffers.shift() ?? { id: 'framebuffer-extra' }),
    createRenderbuffer: vi.fn(() => renderbuffers.shift() ?? { id: 'renderbuffer-extra' }),
    createProgram: vi.fn(() => programs.shift() ?? { id: 'program-extra' }),
    createShader: vi.fn(() => shaders.shift() ?? { id: 'shader-extra' }),
    shaderSource: vi.fn(),
    compileShader: vi.fn(),
    getShaderParameter: vi.fn(() => true),
    getShaderInfoLog: vi.fn(() => ''),
    deleteShader: vi.fn(),
    attachShader: vi.fn(),
    detachShader: vi.fn(),
    linkProgram: vi.fn(),
    getProgramParameter: vi.fn((_program, parameter: number) => (
      parameter === 0x91b1 ? options.parallelCompilation?.complete ?? true : true
    )),
    getProgramInfoLog: vi.fn(() => ''),
    deleteProgram: vi.fn(),
    bindVertexArray: vi.fn(),
    activeTexture: vi.fn((unit: number) => { activeTextureUnit = unit; }),
    bindTexture: vi.fn((_target: number, texture: WebGLTexture | null) => { boundTextures.set(activeTextureUnit, texture); }),
    bindFramebuffer: vi.fn(),
    bindRenderbuffer: vi.fn(),
    framebufferTexture2D: vi.fn(),
    framebufferRenderbuffer: vi.fn(),
    renderbufferStorage: vi.fn(),
    checkFramebufferStatus: vi.fn(() => 0x8cd5),
    blitFramebuffer: vi.fn(),
    pixelStorei: vi.fn(),
    texParameteri: vi.fn(),
    texImage2D: vi.fn(),
    generateMipmap: vi.fn(),
    useProgram: vi.fn(),
    uniform1i: vi.fn(),
    uniform1iv: vi.fn(),
    uniform1f: vi.fn(),
    uniform2f: vi.fn(),
    uniform3f: vi.fn(),
    uniform3fv: vi.fn(),
    uniform2i: vi.fn(),
    clearColor: vi.fn(),
    clear: vi.fn(),
    enable: vi.fn(),
    disable: vi.fn(),
    isEnabled: vi.fn(() => false),
    scissor: vi.fn(),
    drawArrays: vi.fn(),
    drawBuffers: vi.fn(),
    readPixels: vi.fn(),
    viewport: vi.fn(),
    getUniformLocation: vi.fn((_program, name: string) => ({ name })),
    getError: vi.fn(() => 0),
    getExtension: vi.fn((extensionName: string) => {
      if (extensionName === 'OES_texture_float_linear' && options.floatLinearSupported) {
        return {};
      }
      if (extensionName === 'EXT_color_buffer_float' && options.floatAccumulationSupported) {
        return {};
      }
      if (extensionName === 'KHR_parallel_shader_compile' && options.parallelCompilation) {
        return { COMPLETION_STATUS_KHR: 0x91b1 };
      }
      return null;
    }),
    getParameter: vi.fn((parameter) => {
      if (parameter === 0x8ca6 || parameter === 0x8caa) {
        return null;
      }
      if (parameter === 0x0ba2 || parameter === 0x0c10) {
        return new Int32Array([0, 0, 100, 80]);
      }
      if (parameter === 0x84e0) return activeTextureUnit;
      if (parameter === 0x8069) return boundTextures.get(activeTextureUnit) ?? null;
      if (parameter === 16) {
        return 16;
      }
      return 4096;
    }),
    deleteTexture: vi.fn(),
    deleteFramebuffer: vi.fn(),
    deleteRenderbuffer: vi.fn(),
    deleteVertexArray: vi.fn()
  } as unknown as WebGL2RenderingContext & {
    texImage2D: ReturnType<typeof vi.fn>;
    texParameteri: ReturnType<typeof vi.fn>;
    getExtension: ReturnType<typeof vi.fn>;
    getError: ReturnType<typeof vi.fn>;
    createTexture: ReturnType<typeof vi.fn>;
    createFramebuffer: ReturnType<typeof vi.fn>;
    createRenderbuffer: ReturnType<typeof vi.fn>;
    readPixels: ReturnType<typeof vi.fn>;
    uniform1i: ReturnType<typeof vi.fn>;
    uniform1f: ReturnType<typeof vi.fn>;
    uniform2f: ReturnType<typeof vi.fn>;
    uniform3f: ReturnType<typeof vi.fn>;
    uniform3fv: ReturnType<typeof vi.fn>;
    uniform2i: ReturnType<typeof vi.fn>;
    blitFramebuffer: ReturnType<typeof vi.fn>;
    deleteTexture: ReturnType<typeof vi.fn>;
    deleteFramebuffer: ReturnType<typeof vi.fn>;
    deleteRenderbuffer: ReturnType<typeof vi.fn>;
    deleteProgram: ReturnType<typeof vi.fn>;
    deleteVertexArray: ReturnType<typeof vi.fn>;
    clearColor: ReturnType<typeof vi.fn>;
    clear: ReturnType<typeof vi.fn>;
    scissor: ReturnType<typeof vi.fn>;
  };
}
