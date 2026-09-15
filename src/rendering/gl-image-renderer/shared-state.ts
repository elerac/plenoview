import { createEmptyDisplaySourceBinding } from '../../display/bindings';
import {
  createAdaptiveDepthPointBudgetResolver,
  type DepthPointBudgetResolver
} from '../../depth-point-budget';
import { SPHERICAL_HARMONICS_COEFFICIENT_COUNT } from '../../panorama-lighting';
import { REQUIRED_TEXTURE_UNITS } from './constants';
import { createColormapTexture } from './colormap-texture';
import { createDepthProgram } from './depth-program';
import { createEnvironmentImportanceTexture } from './environment-importance-texture';
import { createImageProgram } from './image-program';
import { PanoramaPrograms } from './panorama-program';
import { EnvironmentRadianceCache } from './environment-radiance-cache';
import { RoughPlasticTransmittanceCache } from './roughplastic-transmittance-texture';
import { createPathTracingPresentProgram } from './path-tracing-present-program';
import { configureDepthProgramSamplers, configureProgramSamplers } from './program-utils';
import { createZeroTexture } from './texture-store';
import type { GlImageRendererState, LayerSourceTextures } from './types';

export function createGlImageRendererState(
  glCanvas: HTMLCanvasElement,
  resolveDepthPointBudget: DepthPointBudgetResolver = createAdaptiveDepthPointBudgetResolver()
): GlImageRendererState {
  const gl = glCanvas.getContext('webgl2', { antialias: false });
  if (!gl) {
    throw new Error('WebGL2 is required for this viewer.');
  }

  const smoothFloatMinification = gl.getExtension('OES_texture_float_linear') !== null;

  const maxTextureUnits = gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS) as number;
  if (maxTextureUnits < REQUIRED_TEXTURE_UNITS) {
    throw new Error(`WebGL2 must expose at least ${REQUIRED_TEXTURE_UNITS} texture units.`);
  }

  const vao = gl.createVertexArray();
  if (!vao) {
    throw new Error('Failed to create vertex array object.');
  }

  const imageProgram = createImageProgram(gl);
  const pathTracingPresentProgram = createPathTracingPresentProgram(gl);
  const depthProgram = createDepthProgram(gl);

  gl.bindVertexArray(vao);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);

  const zeroTexture = createZeroTexture(gl, smoothFloatMinification);
  const colormapTexture = createColormapTexture(gl);
  const environmentImportanceTexture = createEnvironmentImportanceTexture(gl);

  configureProgramSamplers(gl, imageProgram.program);
  configureDepthProgramSamplers(gl, depthProgram.program);

  return {
    glCanvas,
    gl,
    smoothFloatMinification,
    vao,
    zeroTexture,
    colormapTexture,
    imageProgram,
    panoramaPrograms: new PanoramaPrograms(gl),
    environmentRadianceCache: new EnvironmentRadianceCache(gl, smoothFloatMinification),
    roughPlasticTransmittanceCache: new RoughPlasticTransmittanceCache(gl),
    pathTracingPresentProgram,
    pathTracingFloatAccumulationSupported: gl.getExtension('EXT_color_buffer_float') !== null,
    pathTracingSurfaces: new Map(),
    activeSourceRevisionKey: '',
    activePolarizedEnvironment: null,
    activeSourceTextures: [],
    environmentImportanceTexture,
    environmentImportanceTextureSize: { width: 1, height: 1 },
    environmentImportanceGridSize: { width: 1, height: 1 },
    environmentImportanceEntryCount: 0,
    environmentImportanceProjection: 0,
    environmentShIrradiance: new Float32Array(
      SPHERICAL_HARMONICS_COEFFICIENT_COUNT * 3
    ),
    depthProgram,
    layerTexturesBySession: new Map<string, Map<number, LayerSourceTextures>>(),
    exportSourceSurface: null,
    viewport: { width: 1, height: 1 },
    outputPixelScale: { x: 1, y: 1 },
    viewportOrigin: { left: 0, top: 0 },
    imageSize: null,
    depthSourceSize: null,
    activeDepthSource: null,
    activeDepthTextures: null,
    activeDepthGeometry: null,
    colormapTextureSize: { width: 1, height: 1 },
    colormapEntryCount: 0,
    invalidValueWarningPhase: 0,
    activeBinding: createEmptyDisplaySourceBinding(),
    resolveDepthPointBudget,
    disposed: false,
    preparingPanorama: false
  };
}
