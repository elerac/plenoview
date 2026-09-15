import type { PanoramaPrograms } from './panorama-program';
import type { EnvironmentRadianceCache } from './environment-radiance-cache';
import type { DisplaySourceBinding } from '../../display/bindings';
import type { DepthPointBudgetResolver } from '../../depth-point-budget';
import type { DepthSource, DepthSourceGeometry } from '../../depth';
import type { ExportImagePixels } from '../../export/export-pixels';
import type { DecodedLayer, ImageRect, ViewerState, ViewportInfo, ViewportRect } from '../../types';

export interface CommonUniforms {
  viewport: WebGLUniformLocation | null;
  viewportOrigin: WebGLUniformLocation | null;
  outputSize: WebGLUniformLocation | null;
  outputPixelScale: WebGLUniformLocation | null;
  screenOrigin: WebGLUniformLocation | null;
  imageSize: WebGLUniformLocation | null;
  exposure: WebGLUniformLocation | null;
  displayGamma: WebGLUniformLocation | null;
  useColormap: WebGLUniformLocation | null;
  colormapExposure: WebGLUniformLocation | null;
  colormapGamma: WebGLUniformLocation | null;
  colormapZeroCentered: WebGLUniformLocation | null;
  colormapReversed: WebGLUniformLocation | null;
  colormapMin: WebGLUniformLocation | null;
  colormapMax: WebGLUniformLocation | null;
  colormapTextureSize: WebGLUniformLocation | null;
  colormapEntryCount: WebGLUniformLocation | null;
  displayMode: WebGLUniformLocation | null;
  stokesParameter: WebGLUniformLocation | null;
  maskInvalidStokesVectors: WebGLUniformLocation | null;
  warnInvalidValues: WebGLUniformLocation | null;
  invalidValueWarningPhase: WebGLUniformLocation | null;
  useStokesDegreeModulation: WebGLUniformLocation | null;
  stokesDegreeModulationMode: WebGLUniformLocation | null;
  useImageAlpha: WebGLUniformLocation | null;
  backgroundMode: WebGLUniformLocation | null;
  backgroundColor: WebGLUniformLocation | null;
  alphaOutputMode: WebGLUniformLocation | null;
}

export interface ImageUniforms extends CommonUniforms {
  pan: WebGLUniformLocation | null;
  zoom: WebGLUniformLocation | null;
}

export interface PanoramaUniforms extends CommonUniforms {
  environmentRadianceTexture: WebGLUniformLocation | null;
  sourceTextureMipmapsAvailable: WebGLUniformLocation | null;
  environmentSampleCounts: WebGLUniformLocation | null;
  pathTracingMaxBounces: WebGLUniformLocation | null;
  panoramaYawDeg: WebGLUniformLocation | null;
  panoramaPitchDeg: WebGLUniformLocation | null;
  panoramaHfovDeg: WebGLUniformLocation | null;
  pathTracingPass: WebGLUniformLocation | null;
  pathTracingSampleIndex: WebGLUniformLocation | null;
  pathTracingBlendWeight: WebGLUniformLocation | null;
  pathTracingPreviousTexture: WebGLUniformLocation | null;
  environmentImportanceTexture: WebGLUniformLocation | null;
  environmentImportanceTextureSize: WebGLUniformLocation | null;
  environmentImportanceGridSize: WebGLUniformLocation | null;
  environmentImportanceEntryCount: WebGLUniformLocation | null;
  environmentImportanceProjection: WebGLUniformLocation | null;
  environmentShIrradiance: WebGLUniformLocation | null;
  environmentSphereSmoothSilver: WebGLUniformLocation | null;
  environmentSphereDiffuseReflectance: WebGLUniformLocation | null;
  environmentSphereAlpha: WebGLUniformLocation | null;
  environmentSphereIntIor: WebGLUniformLocation | null;
  environmentSphereExtIor: WebGLUniformLocation | null;
  environmentSphereDistribution: WebGLUniformLocation | null;
  environmentSphereNonlinear: WebGLUniformLocation | null;
}

export interface PathTracingPresentUniforms {
  outputOriginPx: WebGLUniformLocation;
  outputSize: WebGLUniformLocation;
  outputPixelScale: WebGLUniformLocation;
  viewportOrigin: WebGLUniformLocation;
  exposure: WebGLUniformLocation;
  displayGamma: WebGLUniformLocation;
  backgroundMode: WebGLUniformLocation;
  backgroundColor: WebGLUniformLocation;
  alphaOutputMode: WebGLUniformLocation;
}

export interface PathTracingAccumulationSurface {
  framebuffers: readonly [WebGLFramebuffer, WebGLFramebuffer];
  textures: readonly [WebGLTexture, WebGLTexture];
  width: number;
  height: number;
  readIndex: 0 | 1;
  sampleCount: number;
  signature: string;
}

export interface DepthUniforms extends CommonUniforms {
  depthOutputOrigin: WebGLUniformLocation;
  depthSourceKind: WebGLUniformLocation;
  depthFocalLengthPx: WebGLUniformLocation;
  depthYawDeg: WebGLUniformLocation;
  depthPitchDeg: WebGLUniformLocation;
  depthZoom: WebGLUniformLocation;
  depthTarget: WebGLUniformLocation;
  depthPointSizePx: WebGLUniformLocation;
  depthGridSize: WebGLUniformLocation;
  depthSampleStep: WebGLUniformLocation;
  depthRange: WebGLUniformLocation;
  depthCameraZRange: WebGLUniformLocation;
  depthPositionBoundsMin: WebGLUniformLocation;
  depthPositionBoundsMax: WebGLUniformLocation;
}

export interface ProgramBundle<TUniforms> {
  program: WebGLProgram;
  uniforms: TUniforms;
}

export interface LayerSourceTextures {
  layer: DecodedLayer;
  width: number;
  height: number;
  textureByChannel: Map<string, WebGLTexture>;
}

export interface ExportSurface {
  framebuffer: WebGLFramebuffer;
  texture: WebGLTexture;
  depthBuffer: WebGLRenderbuffer;
  width: number;
  height: number;
}

export type AlphaOutputMode = 'opaque' | 'straight' | 'premultiplied';
export type RenderBackgroundMode = 'none' | 'checker' | 'solid';

export interface RenderPassOptions {
  backgroundMode: RenderBackgroundMode;
  backgroundColor: readonly [number, number, number];
  alphaOutputMode: AlphaOutputMode;
  warnInvalidValues?: boolean;
  invalidValueWarningPhase?: number;
  imageWidth?: number;
  imageHeight?: number;
  viewportWidth?: number;
  viewportHeight?: number;
  viewportLeft?: number;
  viewportTop?: number;
  outputWidth?: number;
  outputHeight?: number;
  outputPixelScaleX?: number;
  outputPixelScaleY?: number;
  screenOriginX?: number;
  screenOriginY?: number;
  depthOutputOriginX?: number;
  depthOutputOriginY?: number;
}

export interface ReadExportPixelsArgs {
  state: ViewerState;
  sourceWidth: number;
  sourceHeight: number;
  outputWidth?: number;
  outputHeight?: number;
  screenshot?:
    | {
        coordinateSpace: 'image';
        imageRect: ImageRect;
      }
    | {
        coordinateSpace: 'viewport';
        rect: ViewportRect;
        sourceViewport: ViewportInfo;
      };
}

export interface GlImageRendererState {
  glCanvas: HTMLCanvasElement;
  gl: WebGL2RenderingContext;
  smoothFloatMinification: boolean;
  vao: WebGLVertexArrayObject;
  zeroTexture: WebGLTexture;
  colormapTexture: WebGLTexture;
  imageProgram: ProgramBundle<ImageUniforms>;
  panoramaPrograms: PanoramaPrograms;
  environmentRadianceCache: EnvironmentRadianceCache;
  pathTracingPresentProgram: ProgramBundle<PathTracingPresentUniforms>;
  pathTracingFloatAccumulationSupported: boolean;
  pathTracingSurfaces: Map<string, PathTracingAccumulationSurface>;
  activeSourceRevisionKey: string;
  environmentImportanceTexture: WebGLTexture;
  environmentImportanceTextureSize: { width: number; height: number };
  environmentImportanceGridSize: { width: number; height: number };
  environmentImportanceEntryCount: number;
  environmentImportanceProjection: number;
  environmentShIrradiance: Float32Array;
  depthProgram: ProgramBundle<DepthUniforms>;
  layerTexturesBySession: Map<string, Map<number, LayerSourceTextures>>;
  exportSourceSurface: ExportSurface | null;
  viewport: ViewportInfo;
  outputPixelScale: { x: number; y: number };
  viewportOrigin: { left: number; top: number };
  imageSize: { width: number; height: number } | null;
  depthSourceSize: { width: number; height: number } | null;
  activeDepthSource: DepthSource | null;
  activeDepthTextures: {
    x: WebGLTexture;
    y: WebGLTexture;
    z: WebGLTexture;
  } | null;
  activeDepthGeometry: DepthSourceGeometry | null;
  colormapTextureSize: { width: number; height: number };
  colormapEntryCount: number;
  invalidValueWarningPhase: number;
  activeBinding: DisplaySourceBinding;
  resolveDepthPointBudget: DepthPointBudgetResolver;
  disposed: boolean;
  preparingPanorama: boolean;
}

export type { ExportImagePixels };
