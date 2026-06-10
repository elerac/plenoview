import type { DisplaySourceBinding } from '../../display/bindings';
import type { DepthPointBudgetResolver } from '../../depth-point-budget';
import type { DepthSource, DepthSourceGeometry } from '../../depth';
import type { ExportImagePixels } from '../../export/export-pixels';
import type { DecodedLayer, ImageRect, ViewerState, ViewportInfo, ViewportRect } from '../../types';

export interface CommonUniforms {
  viewport: WebGLUniformLocation;
  viewportOrigin: WebGLUniformLocation;
  outputSize: WebGLUniformLocation;
  screenOrigin: WebGLUniformLocation;
  imageSize: WebGLUniformLocation;
  exposure: WebGLUniformLocation;
  displayGamma: WebGLUniformLocation;
  useColormap: WebGLUniformLocation;
  colormapExposure: WebGLUniformLocation;
  colormapGamma: WebGLUniformLocation;
  colormapZeroCentered: WebGLUniformLocation;
  colormapReversed: WebGLUniformLocation;
  colormapMin: WebGLUniformLocation;
  colormapMax: WebGLUniformLocation;
  colormapTextureSize: WebGLUniformLocation;
  colormapEntryCount: WebGLUniformLocation;
  displayMode: WebGLUniformLocation;
  stokesParameter: WebGLUniformLocation;
  maskInvalidStokesVectors: WebGLUniformLocation;
  warnInvalidValues: WebGLUniformLocation;
  invalidValueWarningPhase: WebGLUniformLocation;
  useStokesDegreeModulation: WebGLUniformLocation;
  stokesDegreeModulationMode: WebGLUniformLocation;
  useImageAlpha: WebGLUniformLocation;
  backgroundMode: WebGLUniformLocation;
  backgroundColor: WebGLUniformLocation;
  alphaOutputMode: WebGLUniformLocation;
}

export interface ImageUniforms extends CommonUniforms {
  pan: WebGLUniformLocation;
  zoom: WebGLUniformLocation;
}

export interface PanoramaUniforms extends CommonUniforms {
  panoramaYawDeg: WebGLUniformLocation;
  panoramaPitchDeg: WebGLUniformLocation;
  panoramaHfovDeg: WebGLUniformLocation;
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

export interface ProgramBundle<TUniforms extends CommonUniforms> {
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
  vao: WebGLVertexArrayObject;
  zeroTexture: WebGLTexture;
  colormapTexture: WebGLTexture;
  imageProgram: ProgramBundle<ImageUniforms>;
  panoramaProgram: ProgramBundle<PanoramaUniforms>;
  depthProgram: ProgramBundle<DepthUniforms>;
  layerTexturesBySession: Map<string, Map<number, LayerSourceTextures>>;
  exportSourceSurface: ExportSurface | null;
  viewport: ViewportInfo;
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
}

export type { ExportImagePixels };
