import { isStokesDegreeModulationEnabled, resolveStokesDegreeModulationMode } from '../../stokes';
import {
  resolveAlphaOutputModeUniformValue,
  resolveDisplaySourceModeUniformValue,
  resolveStokesParameterUniformValue
} from '../../display/gpu-bindings';
import { clampPanoramaProjectionPitch } from '../../interaction/panorama-geometry';
import type { ViewerState } from '../../types';
import type { ViewerPaneRenderInfo } from '../../viewer-pane-layout';
import {
  COLORMAP_TEXTURE_UNIT,
  DEFAULT_RENDER_PASS_OPTIONS
} from './constants';
import type {
  CommonUniforms,
  GlImageRendererState,
  RenderPassOptions
} from './types';

export function render(
  state: GlImageRendererState,
  viewerState: ViewerState,
  panes: readonly ViewerPaneRenderInfo[] = [],
  options: { clear?: boolean } = {}
): void {
  const gl = state.gl;
  const renderPanes = panes.length > 0 ? panes : [createFullViewportPane(state)];

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  if (options.clear !== false) {
    gl.disable(gl.SCISSOR_TEST);
    gl.viewport(0, 0, state.viewport.width, state.viewport.height);
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

      const glY = state.viewport.height - rect.y - rect.height;
      gl.viewport(rect.x, glY, rect.width, rect.height);
      gl.scissor(rect.x, glY, rect.width, rect.height);
      const options = {
        ...DEFAULT_RENDER_PASS_OPTIONS,
        viewportWidth: rect.width,
        viewportHeight: rect.height,
        viewportLeft: state.viewportOrigin.left + rect.x,
        viewportTop: state.viewportOrigin.top + rect.y,
        outputWidth: rect.width,
        outputHeight: rect.height,
        screenOriginX: -rect.x,
        screenOriginY: glY
      };
      if (viewerState.viewerMode === 'panorama') {
        renderPanoramaPass(state, viewerState, options);
      } else {
        renderImagePass(state, viewerState, options);
      }
    }
  } finally {
    gl.disable(gl.SCISSOR_TEST);
    gl.viewport(0, 0, state.viewport.width, state.viewport.height);
  }
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
  options: RenderPassOptions
): void {
  const gl = state.gl;
  const program = state.panoramaProgram;
  gl.useProgram(program.program);
  gl.bindVertexArray(state.vao);
  gl.activeTexture(gl.TEXTURE0 + COLORMAP_TEXTURE_UNIT);
  gl.bindTexture(gl.TEXTURE_2D, state.colormapTexture);

  setCommonUniforms(state, program.uniforms, viewerState, options);
  gl.uniform1f(program.uniforms.panoramaYawDeg, viewerState.panoramaYawDeg);
  gl.uniform1f(
    program.uniforms.panoramaPitchDeg,
    clampPanoramaProjectionPitch(viewerState.panoramaPitchDeg)
  );
  gl.uniform1f(program.uniforms.panoramaHfovDeg, viewerState.panoramaHfovDeg);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
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
    uniforms.screenOrigin,
    options.screenOriginX ?? 0,
    options.screenOriginY ?? 0
  );

  const width = state.imageSize?.width ?? 0;
  const height = state.imageSize?.height ?? 0;
  gl.uniform2f(uniforms.imageSize, width, height);
  gl.uniform1f(uniforms.exposure, viewerState.exposureEv);
  gl.uniform1f(uniforms.displayGamma, viewerState.displayGamma);
  gl.uniform1i(uniforms.useColormap, viewerState.visualizationMode === 'colormap' ? 1 : 0);
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
  gl.uniform1i(uniforms.maskInvalidStokesVectors, viewerState.maskInvalidStokesVectors !== false ? 1 : 0);
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
  gl.uniform1i(uniforms.compositeCheckerboard, options.compositeCheckerboard ? 1 : 0);
  gl.uniform1i(uniforms.alphaOutputMode, resolveAlphaOutputModeUniformValue(options.alphaOutputMode));
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
