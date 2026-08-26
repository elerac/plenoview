import {
  DEFAULT_MASK_INVALID_STOKES_VECTORS,
  isStokesDegreeModulationEnabled,
  resolveStokesDegreeModulationMode
} from '../../stokes';
import {
  resolveAlphaOutputModeUniformValue,
  resolveDisplaySourceModeUniformValue,
  resolveStokesParameterUniformValue
} from '../../display/gpu-bindings';
import {
  DEFAULT_VIEWER_BACKGROUND_ID,
  getViewerBackgroundColor,
  isSolidViewerBackground,
  type ViewerBackgroundId
} from '../../viewer-background-settings';
import { clampPanoramaProjectionPitch } from '../../interaction/panorama-geometry';
import {
  resolvePanoramaDisplayMode,
  resolvePanoramaLightingMethod,
  usesPathTracingEnvironmentLighting
} from '../../panorama-lighting';
import { normalizeEnvironmentSphereMaterial } from '../../environment-sphere-material';
import {
  clampDepthZoom,
  normalizeDepthTarget,
  normalizeDepthPointSize,
  normalizeDepthPitchForSource,
  normalizeDepthYawForSource,
  resolveDepthCameraZRange,
  resolveDepthFocalLengthPx,
  resolveDepthPointSampling
} from '../../depth';
import type { ViewerState } from '../../types';
import type { ViewerPaneRenderInfo } from '../../viewer-pane-layout';
import {
  COLORMAP_TEXTURE_UNIT,
  DEPTH_POSITION_Y_TEXTURE_UNIT,
  DEPTH_POSITION_Z_TEXTURE_UNIT,
  DEPTH_TEXTURE_UNIT,
  DEFAULT_RENDER_PASS_OPTIONS,
  PATH_TRACING_ACCUMULATION_TEXTURE_UNIT,
  PATH_TRACING_ENVIRONMENT_TABLE_TEXTURE_UNIT
} from './constants';
import {
  clearPathTracingSurfaces,
  getOrCreatePathTracingSurface
} from './path-tracing-surface';
import type {
  CommonUniforms,
  GlImageRendererState,
  RenderBackgroundMode,
  RenderPassOptions
} from './types';

const BACKGROUND_MODE_NONE = 0;
const BACKGROUND_MODE_CHECKER = 1;
const BACKGROUND_MODE_SOLID = 2;
const PATH_TRACING_PASS_DIRECT = 2;
export const MAX_PATH_TRACING_SAMPLE_COUNT = 4096;

interface PanoramaRenderTarget {
  accumulationKey: string;
  outputRect: { x: number; y: number; width: number; height: number };
}

export function render(
  state: GlImageRendererState,
  viewerState: ViewerState,
  panes: readonly ViewerPaneRenderInfo[] = [],
  options: { clear?: boolean } = {}
): boolean {
  const gl = state.gl;
  const renderPanes = panes.length > 0 ? panes : [createFullViewportPane(state)];
  let pathTracingNeedsMoreSamples = false;

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  if (options.clear !== false) {
    gl.disable(gl.SCISSOR_TEST);
    gl.viewport(0, 0, state.glCanvas.width, state.glCanvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }
  gl.enable(gl.SCISSOR_TEST);

  try {
    for (const pane of renderPanes) {
      const rect = normalizePaneRect(pane.rect, state.viewport.width, state.viewport.height);
      if (!rect) {
        continue;
      }

      const outputRect = scalePaneRect(rect, state);
      const glY = state.glCanvas.height - outputRect.y - outputRect.height;
      gl.viewport(outputRect.x, glY, outputRect.width, outputRect.height);
      gl.scissor(outputRect.x, glY, outputRect.width, outputRect.height);
      const outputPixelScaleX = outputRect.width / rect.width;
      const outputPixelScaleY = outputRect.height / rect.height;
      const options = {
        ...DEFAULT_RENDER_PASS_OPTIONS,
        ...resolveViewerBackgroundOptions(viewerState.viewerBackground),
        viewportWidth: rect.width,
        viewportHeight: rect.height,
        viewportLeft: state.viewportOrigin.left + rect.x,
        viewportTop: state.viewportOrigin.top + rect.y,
        outputWidth: rect.width,
        outputHeight: rect.height,
        outputPixelScaleX,
        outputPixelScaleY,
        screenOriginX: -outputRect.x / outputPixelScaleX,
        screenOriginY: glY / outputPixelScaleY,
        depthOutputOriginX: 0,
        depthOutputOriginY: 0
      };
      if (viewerState.viewerMode === 'panorama') {
        pathTracingNeedsMoreSamples = renderPanoramaPass(
          state,
          viewerState,
          options,
          {
            accumulationKey: serializePanePath(pane.path),
            outputRect: {
              ...outputRect,
              y: glY
            }
          }
        ) || pathTracingNeedsMoreSamples;
      } else if (viewerState.viewerMode === '3d') {
        renderDepthPass(state, viewerState, options);
      } else {
        renderImagePass(state, viewerState, options);
      }
    }
  } finally {
    gl.disable(gl.SCISSOR_TEST);
    gl.viewport(0, 0, state.glCanvas.width, state.glCanvas.height);
  }
  return pathTracingNeedsMoreSamples;
}

export function renderImagePass(
  state: GlImageRendererState,
  viewerState: ViewerState,
  options: RenderPassOptions
): void {
  const gl = state.gl;
  const program = state.imageProgram;
  gl.useProgram(program.program);
  gl.bindVertexArray(state.vao);
  gl.activeTexture(gl.TEXTURE0 + COLORMAP_TEXTURE_UNIT);
  gl.bindTexture(gl.TEXTURE_2D, state.colormapTexture);

  setCommonUniforms(state, program.uniforms, viewerState, options);
  gl.uniform2f(program.uniforms.pan, viewerState.panX, viewerState.panY);
  gl.uniform1f(program.uniforms.zoom, viewerState.zoom);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

export function renderPanoramaPass(
  state: GlImageRendererState,
  viewerState: ViewerState,
  options: RenderPassOptions,
  target?: PanoramaRenderTarget
): boolean {
  if (
    usesPathTracingEnvironmentLighting(viewerState) &&
    target &&
    state.pathTracingFloatAccumulationSupported
  ) {
    try {
      return renderProgressivePathTracingPass(state, viewerState, options, target);
    } catch {
      clearPathTracingSurfaces(state);
      state.pathTracingFloatAccumulationSupported = false;
      state.gl.bindFramebuffer(state.gl.FRAMEBUFFER, null);
      state.gl.enable(state.gl.SCISSOR_TEST);
      state.gl.viewport(
        target.outputRect.x,
        target.outputRect.y,
        target.outputRect.width,
        target.outputRect.height
      );
      state.gl.scissor(
        target.outputRect.x,
        target.outputRect.y,
        target.outputRect.width,
        target.outputRect.height
      );
    }
  }

  const gl = state.gl;
  const program = state.panoramaProgram;
  gl.useProgram(program.program);
  gl.bindVertexArray(state.vao);
  gl.activeTexture(gl.TEXTURE0 + COLORMAP_TEXTURE_UNIT);
  gl.bindTexture(gl.TEXTURE_2D, state.colormapTexture);

  setPanoramaUniforms(
    state,
    viewerState,
    options,
    usesPathTracingEnvironmentLighting(viewerState) ? PATH_TRACING_PASS_DIRECT : 0,
    0,
    1
  );
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  return false;
}

function renderProgressivePathTracingPass(
  state: GlImageRendererState,
  viewerState: ViewerState,
  options: RenderPassOptions,
  target: PanoramaRenderTarget
): boolean {
  const gl = state.gl;
  const destinationFramebuffer = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
  const material = normalizeEnvironmentSphereMaterial(viewerState.environmentSphereMaterial);
  const signature = buildPathTracingSignature(
    state,
    viewerState,
    material,
    options,
    target.outputRect
  );
  const surface = getOrCreatePathTracingSurface(
    state,
    target.accumulationKey,
    target.outputRect.width,
    target.outputRect.height,
    signature
  );

  if (surface.sampleCount < MAX_PATH_TRACING_SAMPLE_COUNT) {
    const writeIndex: 0 | 1 = surface.readIndex === 0 ? 1 : 0;
    gl.bindFramebuffer(gl.FRAMEBUFFER, surface.framebuffers[writeIndex]);
    gl.disable(gl.SCISSOR_TEST);
    gl.viewport(0, 0, surface.width, surface.height);
    gl.useProgram(state.panoramaProgram.program);
    gl.bindVertexArray(state.vao);
    gl.activeTexture(gl.TEXTURE0 + PATH_TRACING_ACCUMULATION_TEXTURE_UNIT);
    gl.bindTexture(gl.TEXTURE_2D, surface.textures[surface.readIndex]);
    setPanoramaUniforms(
      state,
      viewerState,
      {
        ...options,
        screenOriginX: 0,
        screenOriginY: 0
      },
      1,
      surface.sampleCount,
      1 / (surface.sampleCount + 1)
    );
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    surface.readIndex = writeIndex;
    surface.sampleCount += 1;
  }

  gl.bindFramebuffer(gl.FRAMEBUFFER, destinationFramebuffer);
  gl.enable(gl.SCISSOR_TEST);
  gl.viewport(
    target.outputRect.x,
    target.outputRect.y,
    target.outputRect.width,
    target.outputRect.height
  );
  gl.scissor(
    target.outputRect.x,
    target.outputRect.y,
    target.outputRect.width,
    target.outputRect.height
  );
  gl.useProgram(state.pathTracingPresentProgram.program);
  gl.bindVertexArray(state.vao);
  gl.activeTexture(gl.TEXTURE0 + PATH_TRACING_ACCUMULATION_TEXTURE_UNIT);
  gl.bindTexture(gl.TEXTURE_2D, surface.textures[surface.readIndex]);
  const uniforms = state.pathTracingPresentProgram.uniforms;
  gl.uniform2i(uniforms.outputOriginPx, target.outputRect.x, target.outputRect.y);
  gl.uniform2f(
    uniforms.outputSize,
    options.outputWidth ?? options.viewportWidth ?? state.viewport.width,
    options.outputHeight ?? options.viewportHeight ?? state.viewport.height
  );
  gl.uniform2f(
    uniforms.outputPixelScale,
    options.outputPixelScaleX ?? state.outputPixelScale.x,
    options.outputPixelScaleY ?? state.outputPixelScale.y
  );
  gl.uniform2f(
    uniforms.viewportOrigin,
    options.viewportLeft ?? state.viewportOrigin.left,
    options.viewportTop ?? state.viewportOrigin.top
  );
  gl.uniform1f(uniforms.exposure, viewerState.exposureEv);
  gl.uniform1f(uniforms.displayGamma, viewerState.displayGamma);
  gl.uniform1i(uniforms.backgroundMode, resolveBackgroundModeUniformValue(options.backgroundMode));
  gl.uniform3f(
    uniforms.backgroundColor,
    options.backgroundColor[0],
    options.backgroundColor[1],
    options.backgroundColor[2]
  );
  gl.uniform1i(uniforms.alphaOutputMode, resolveAlphaOutputModeUniformValue(options.alphaOutputMode));
  gl.drawArrays(gl.TRIANGLES, 0, 3);

  return surface.sampleCount < MAX_PATH_TRACING_SAMPLE_COUNT;
}

function setPanoramaUniforms(
  state: GlImageRendererState,
  viewerState: ViewerState,
  options: RenderPassOptions,
  pathTracingPass: number,
  pathTracingSampleIndex: number,
  pathTracingBlendWeight: number
): void {
  const gl = state.gl;
  const program = state.panoramaProgram;
  setCommonUniforms(state, program.uniforms, viewerState, options);
  gl.uniform1i(
    program.uniforms.sourceTextureMipmapsAvailable,
    state.smoothFloatMinification ? 1 : 0
  );
  gl.uniform1i(
    program.uniforms.environmentLightingInteractive,
    viewerState.environmentLightingInteractive === true ? 1 : 0
  );
  gl.uniform1f(program.uniforms.panoramaYawDeg, viewerState.panoramaYawDeg);
  gl.uniform1f(
    program.uniforms.panoramaPitchDeg,
    clampPanoramaProjectionPitch(viewerState.panoramaPitchDeg)
  );
  gl.uniform1f(program.uniforms.panoramaHfovDeg, viewerState.panoramaHfovDeg);
  gl.uniform1i(
    program.uniforms.panoramaDisplayMode,
    resolvePanoramaDisplayMode(viewerState.panoramaDisplayMode) === 'environmentLighting' ? 1 : 0
  );
  gl.uniform1i(
    program.uniforms.panoramaLightingMethod,
    resolvePanoramaLightingMethod(viewerState.panoramaLightingMethod) === 'pathTracing' ? 1 : 0
  );
  gl.uniform1i(program.uniforms.pathTracingPass, pathTracingPass);
  gl.uniform1i(program.uniforms.pathTracingSampleIndex, pathTracingSampleIndex);
  gl.uniform1f(program.uniforms.pathTracingBlendWeight, pathTracingBlendWeight);
  gl.activeTexture(gl.TEXTURE0 + PATH_TRACING_ENVIRONMENT_TABLE_TEXTURE_UNIT);
  gl.bindTexture(gl.TEXTURE_2D, state.environmentImportanceTexture);
  gl.uniform2i(
    program.uniforms.environmentImportanceTextureSize,
    state.environmentImportanceTextureSize.width,
    state.environmentImportanceTextureSize.height
  );
  gl.uniform2i(
    program.uniforms.environmentImportanceGridSize,
    state.environmentImportanceGridSize.width,
    state.environmentImportanceGridSize.height
  );
  gl.uniform1i(
    program.uniforms.environmentImportanceEntryCount,
    state.environmentImportanceEntryCount
  );
  gl.uniform1i(
    program.uniforms.environmentImportanceProjection,
    state.environmentImportanceProjection
  );
  gl.uniform3fv(program.uniforms.environmentShIrradiance, state.environmentShIrradiance);
  const material = normalizeEnvironmentSphereMaterial(viewerState.environmentSphereMaterial);
  gl.uniform3f(
    program.uniforms.environmentSphereDiffuseReflectance,
    material.diffuseReflectance.r,
    material.diffuseReflectance.g,
    material.diffuseReflectance.b
  );
  gl.uniform1f(program.uniforms.environmentSphereAlpha, material.alpha);
  gl.uniform1f(program.uniforms.environmentSphereIntIor, material.intIor);
  gl.uniform1f(program.uniforms.environmentSphereExtIor, material.extIor);
  gl.uniform1i(
    program.uniforms.environmentSphereDistribution,
    material.distribution === 'ggx' ? 1 : 0
  );
  gl.uniform1i(program.uniforms.environmentSphereNonlinear, material.nonlinear ? 1 : 0);
}

function buildPathTracingSignature(
  state: GlImageRendererState,
  viewerState: ViewerState,
  material: ReturnType<typeof normalizeEnvironmentSphereMaterial>,
  options: RenderPassOptions,
  outputRect: PanoramaRenderTarget['outputRect']
): string {
  return [
    state.activeSourceRevisionKey,
    state.imageSize?.width ?? 0,
    state.imageSize?.height ?? 0,
    outputRect.width,
    outputRect.height,
    options.viewportWidth ?? state.viewport.width,
    options.viewportHeight ?? state.viewport.height,
    options.outputPixelScaleX ?? state.outputPixelScale.x,
    options.outputPixelScaleY ?? state.outputPixelScale.y,
    viewerState.panoramaYawDeg,
    viewerState.panoramaPitchDeg,
    viewerState.panoramaHfovDeg,
    material.diffuseReflectance.r,
    material.diffuseReflectance.g,
    material.diffuseReflectance.b,
    material.alpha,
    material.intIor,
    material.extIor,
    material.distribution,
    material.nonlinear ? 1 : 0
  ].join('|');
}

export function renderDepthPass(
  state: GlImageRendererState,
  viewerState: ViewerState,
  options: RenderPassOptions
): void {
  const gl = state.gl;
  const sourceSize = state.depthSourceSize ?? state.imageSize;
  const depthSource = state.activeDepthSource;
  const depthGeometry = state.activeDepthGeometry;
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  if (!sourceSize || !depthSource || !depthGeometry || sourceSize.width <= 0 || sourceSize.height <= 0) {
    return;
  }

  const depthPointSizePx = normalizeDepthPointSize(viewerState.depthPointSizePx);
  const maxPoints = state.resolveDepthPointBudget({
    width: options.viewportWidth ?? state.viewport.width,
    height: options.viewportHeight ?? state.viewport.height,
    pointSizePx: depthPointSizePx
  });
  const sampling = resolveDepthPointSampling(sourceSize.width, sourceSize.height, maxPoints);
  if (sampling.pointCount <= 0) {
    return;
  }

  const program = state.depthProgram;
  const depthCameraZRange = resolveDepthCameraZRange({
    width: sourceSize.width,
    height: sourceSize.height,
    source: depthSource,
    geometry: depthGeometry,
    depthFocalLengthPx: viewerState.depthFocalLengthPx,
    depthYawDeg: viewerState.depthYawDeg,
    depthPitchDeg: viewerState.depthPitchDeg,
    depthTargetX: viewerState.depthTargetX,
    depthTargetY: viewerState.depthTargetY,
    depthTargetZ: viewerState.depthTargetZ
  });
  gl.useProgram(program.program);
  gl.bindVertexArray(state.vao);
  gl.activeTexture(gl.TEXTURE0 + COLORMAP_TEXTURE_UNIT);
  gl.bindTexture(gl.TEXTURE_2D, state.colormapTexture);
  gl.activeTexture(gl.TEXTURE0 + DEPTH_TEXTURE_UNIT);
  gl.bindTexture(gl.TEXTURE_2D, state.activeDepthTextures?.x ?? state.zeroTexture);
  gl.activeTexture(gl.TEXTURE0 + DEPTH_POSITION_Y_TEXTURE_UNIT);
  gl.bindTexture(gl.TEXTURE_2D, state.activeDepthTextures?.y ?? state.zeroTexture);
  gl.activeTexture(gl.TEXTURE0 + DEPTH_POSITION_Z_TEXTURE_UNIT);
  gl.bindTexture(gl.TEXTURE_2D, state.activeDepthTextures?.z ?? state.zeroTexture);

  setCommonUniforms(state, program.uniforms, viewerState, {
    ...options,
    imageWidth: sourceSize.width,
    imageHeight: sourceSize.height,
    backgroundMode: 'none'
  });
  gl.uniform1i(program.uniforms.depthSourceKind, depthSource.kind === 'xyzPosition' ? 1 : 0);
  gl.uniform1f(
    program.uniforms.depthFocalLengthPx,
    resolveDepthFocalLengthPx(sourceSize.width, sourceSize.height, viewerState.depthFocalLengthPx)
  );
  gl.uniform1f(program.uniforms.depthYawDeg, normalizeDepthYawForSource(viewerState.depthYawDeg, depthSource));
  gl.uniform1f(program.uniforms.depthPitchDeg, normalizeDepthPitchForSource(viewerState.depthPitchDeg, depthSource));
  gl.uniform1f(program.uniforms.depthZoom, clampDepthZoom(viewerState.depthZoom));
  gl.uniform3f(
    program.uniforms.depthTarget,
    normalizeDepthTarget(viewerState.depthTargetX),
    normalizeDepthTarget(viewerState.depthTargetY),
    normalizeDepthTarget(viewerState.depthTargetZ)
  );
  const outputPixelScale = Math.min(
    options.outputPixelScaleX ?? state.outputPixelScale.x,
    options.outputPixelScaleY ?? state.outputPixelScale.y
  );
  gl.uniform1f(program.uniforms.depthPointSizePx, depthPointSizePx * outputPixelScale);
  gl.uniform2f(
    program.uniforms.depthOutputOrigin,
    options.depthOutputOriginX ?? options.screenOriginX ?? 0,
    options.depthOutputOriginY ?? options.screenOriginY ?? 0
  );
  gl.uniform2i(program.uniforms.depthGridSize, sampling.gridWidth, sampling.gridHeight);
  gl.uniform1i(program.uniforms.depthSampleStep, sampling.step);
  gl.uniform2f(program.uniforms.depthCameraZRange, depthCameraZRange.min, depthCameraZRange.max);
  if (depthGeometry.kind === 'xyzPosition') {
    gl.uniform2f(program.uniforms.depthRange, 0, 1);
    gl.uniform3f(
      program.uniforms.depthPositionBoundsMin,
      depthGeometry.bounds.minX,
      depthGeometry.bounds.minY,
      depthGeometry.bounds.minZ
    );
    gl.uniform3f(
      program.uniforms.depthPositionBoundsMax,
      depthGeometry.bounds.maxX,
      depthGeometry.bounds.maxY,
      depthGeometry.bounds.maxZ
    );
  } else {
    gl.uniform2f(program.uniforms.depthRange, depthGeometry.range.min, depthGeometry.range.max);
    gl.uniform3f(program.uniforms.depthPositionBoundsMin, 0, 0, 0);
    gl.uniform3f(program.uniforms.depthPositionBoundsMax, 1, 1, 1);
  }

  gl.enable(gl.DEPTH_TEST);
  try {
    gl.drawArrays(gl.POINTS, 0, sampling.pointCount);
  } finally {
    gl.disable(gl.DEPTH_TEST);
  }
}

function setCommonUniforms(
  state: GlImageRendererState,
  uniforms: CommonUniforms,
  viewerState: ViewerState,
  options: RenderPassOptions
): void {
  const gl = state.gl;
  gl.uniform2f(
    uniforms.viewport,
    options.viewportWidth ?? state.viewport.width,
    options.viewportHeight ?? state.viewport.height
  );
  gl.uniform2f(
    uniforms.viewportOrigin,
    options.viewportLeft ?? state.viewportOrigin.left,
    options.viewportTop ?? state.viewportOrigin.top
  );
  gl.uniform2f(
    uniforms.outputSize,
    options.outputWidth ?? options.viewportWidth ?? state.viewport.width,
    options.outputHeight ?? options.viewportHeight ?? state.viewport.height
  );
  gl.uniform2f(
    uniforms.outputPixelScale,
    options.outputPixelScaleX ?? state.outputPixelScale.x,
    options.outputPixelScaleY ?? state.outputPixelScale.y
  );
  gl.uniform2f(
    uniforms.screenOrigin,
    options.screenOriginX ?? 0,
    options.screenOriginY ?? 0
  );

  const width = options.imageWidth ?? state.imageSize?.width ?? 0;
  const height = options.imageHeight ?? state.imageSize?.height ?? 0;
  gl.uniform2f(uniforms.imageSize, width, height);
  gl.uniform1f(uniforms.exposure, viewerState.exposureEv);
  gl.uniform1f(uniforms.displayGamma, viewerState.displayGamma);
  gl.uniform1i(uniforms.useColormap, viewerState.visualizationMode === 'colormap' ? 1 : 0);
  gl.uniform1f(uniforms.colormapExposure, viewerState.colormapExposureEv);
  gl.uniform1f(uniforms.colormapGamma, viewerState.colormapGamma);
  gl.uniform1i(uniforms.colormapZeroCentered, viewerState.colormapZeroCentered ? 1 : 0);
  gl.uniform1i(uniforms.colormapReversed, viewerState.colormapReversed ? 1 : 0);
  gl.uniform1f(uniforms.colormapMin, viewerState.colormapRange?.min ?? 0);
  gl.uniform1f(uniforms.colormapMax, viewerState.colormapRange?.max ?? 0);
  gl.uniform2i(
    uniforms.colormapTextureSize,
    state.colormapTextureSize.width,
    state.colormapTextureSize.height
  );
  gl.uniform1i(uniforms.colormapEntryCount, state.colormapEntryCount);
  gl.uniform1i(uniforms.displayMode, resolveDisplaySourceModeUniformValue(state.activeBinding.mode));
  gl.uniform1i(uniforms.stokesParameter, resolveStokesParameterUniformValue(state.activeBinding.stokesParameter));
  gl.uniform1i(
    uniforms.maskInvalidStokesVectors,
    (viewerState.maskInvalidStokesVectors ?? DEFAULT_MASK_INVALID_STOKES_VECTORS) ? 1 : 0
  );
  gl.uniform1i(
    uniforms.warnInvalidValues,
    (options.warnInvalidValues ?? viewerState.invalidValueWarningEnabled) ? 1 : 0
  );
  gl.uniform1f(
    uniforms.invalidValueWarningPhase,
    options.invalidValueWarningPhase ?? viewerState.invalidValueWarningPhase ?? state.invalidValueWarningPhase
  );
  gl.uniform1i(
    uniforms.useStokesDegreeModulation,
    isStokesDegreeModulationEnabled(viewerState.displaySelection, viewerState.stokesDegreeModulation) ? 1 : 0
  );
  gl.uniform1i(
    uniforms.stokesDegreeModulationMode,
    resolveStokesDegreeModulationMode(
      viewerState.displaySelection,
      viewerState.stokesAolpDegreeModulationMode
    ) === 'saturation' ? 1 : 0
  );
  gl.uniform1i(uniforms.useImageAlpha, state.activeBinding.usesImageAlpha ? 1 : 0);
  gl.uniform1i(uniforms.backgroundMode, resolveBackgroundModeUniformValue(options.backgroundMode));
  gl.uniform3f(
    uniforms.backgroundColor,
    options.backgroundColor[0],
    options.backgroundColor[1],
    options.backgroundColor[2]
  );
  gl.uniform1i(uniforms.alphaOutputMode, resolveAlphaOutputModeUniformValue(options.alphaOutputMode));
}

function resolveViewerBackgroundOptions(
  viewerBackground: ViewerBackgroundId = DEFAULT_VIEWER_BACKGROUND_ID
): Pick<RenderPassOptions, 'backgroundMode' | 'backgroundColor'> {
  return {
    backgroundMode: isSolidViewerBackground(viewerBackground) ? 'solid' : 'checker',
    backgroundColor: getViewerBackgroundColor(viewerBackground)
  };
}

function resolveBackgroundModeUniformValue(mode: RenderBackgroundMode): number {
  switch (mode) {
    case 'none':
      return BACKGROUND_MODE_NONE;
    case 'checker':
      return BACKGROUND_MODE_CHECKER;
    case 'solid':
      return BACKGROUND_MODE_SOLID;
  }
}

function createFullViewportPane(state: GlImageRendererState): ViewerPaneRenderInfo {
  return {
    path: [],
    rect: {
      x: 0,
      y: 0,
      width: state.viewport.width,
      height: state.viewport.height
    },
    viewport: { ...state.viewport },
    active: true
  };
}

function serializePanePath(path: readonly number[]): string {
  return path.length === 0 ? 'root' : path.join('.');
}

function normalizePaneRect(
  rect: { x: number; y: number; width: number; height: number },
  maxWidth: number,
  maxHeight: number
): { x: number; y: number; width: number; height: number } | null {
  const x0 = clamp(Math.floor(rect.x), 0, maxWidth);
  const y0 = clamp(Math.floor(rect.y), 0, maxHeight);
  const x1 = clamp(Math.ceil(rect.x + rect.width), 0, maxWidth);
  const y1 = clamp(Math.ceil(rect.y + rect.height), 0, maxHeight);
  const width = x1 - x0;
  const height = y1 - y0;
  return width > 0 && height > 0
    ? { x: x0, y: y0, width, height }
    : null;
}

function scalePaneRect(
  rect: { x: number; y: number; width: number; height: number },
  state: GlImageRendererState
): { x: number; y: number; width: number; height: number } {
  const x0 = Math.round(rect.x * state.outputPixelScale.x);
  const y0 = Math.round(rect.y * state.outputPixelScale.y);
  const x1 = Math.round((rect.x + rect.width) * state.outputPixelScale.x);
  const y1 = Math.round((rect.y + rect.height) * state.outputPixelScale.y);
  return {
    x: x0,
    y: y0,
    width: Math.max(1, x1 - x0),
    height: Math.max(1, y1 - y0)
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
