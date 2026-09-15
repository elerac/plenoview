import vertexSource from '../shaders/fullscreen-triangle.vert.glsl?raw';
import { resolvePanoramaDisplayMode, resolvePanoramaLightingMethod } from '../../panorama-lighting';
import type { ViewerRenderState } from '../../types';
import { DISPLAY_SOURCE_SLOT_COUNT } from '../../display/bindings';
import { COLORMAP_TEXTURE_UNIT, PATH_TRACING_ACCUMULATION_TEXTURE_UNIT, PATH_TRACING_ENVIRONMENT_TABLE_TEXTURE_UNIT, ENVIRONMENT_STOKES_TEXTURE_UNITS, PATH_TRACING_STOKES_TEXTURE_UNITS } from './constants';
import { createPendingProgram, type PendingProgram } from './pending-program';
import { createPanoramaFragmentSource, environmentRadianceFragmentSource, type PanoramaProgramKind } from './panorama-shader-source';
import { getCommonUniforms, getRequiredUniformLocation } from './program-utils';
import type { PanoramaUniforms, ProgramBundle } from './types';

export const ENVIRONMENT_RADIANCE_TEXTURE_UNIT = 15;
type ProgramKind = PanoramaProgramKind | 'radiance';
interface ProgramEntry {
  pending: PendingProgram;
  bundle: ProgramBundle<PanoramaUniforms> | null;
}

/** Only requested modes compile. Polling never asks the driver to wait for a link. */
export class PanoramaPrograms {
  private readonly entries = new Map<ProgramKind, ProgramEntry>();
  private disposed = false;

  constructor(private readonly gl: WebGL2RenderingContext) {}

  get(kind: ProgramKind): ProgramBundle<PanoramaUniforms> | null {
    if (this.disposed) throw new Error('Renderer has been disposed.');
    let entry = this.entries.get(kind);
    if (!entry) {
      entry = {
        pending: createPendingProgram(this.gl, vertexSource, kind === 'radiance'
          ? environmentRadianceFragmentSource
          : createPanoramaFragmentSource(kind)),
        bundle: null
      };
      this.entries.set(kind, entry);
    }
    if (entry.bundle) return entry.bundle;
    const program = entry.pending.poll();
    if (!program) return null;
    entry.bundle = this.resolveBundle(program, kind);
    return entry.bundle;
  }

  async prepare(state: ViewerRenderState, signal?: AbortSignal): Promise<void> {
    if (state.viewerMode !== 'panorama') return;
    const kind = resolvePanoramaProgramKind(state);
    for (;;) {
      signal?.throwIfAborted();
      const program = this.get(kind);
      const radiance = kind === 'image' || this.get('radiance');
      if (program && radiance) return;
      await new Promise<void>((resolve) => setTimeout(resolve, 16));
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const entry of this.entries.values()) entry.pending.dispose();
    this.entries.clear();
  }

  private resolveBundle(program: WebGLProgram, kind: ProgramKind): ProgramBundle<PanoramaUniforms> {
    const gl = this.gl;
    const optional = (name: string) => gl.getUniformLocation(program, name);
    const uniforms: PanoramaUniforms = {
      ...getCommonUniforms(gl, program, true),
      environmentPolarized: optional('uEnvironmentPolarized'),
      conductorEta: optional('uConductorEta'),
      conductorK: optional('uConductorK'),
      environmentSphereRoughSilver: optional('uEnvironmentSphereRoughSilver'),
      environmentSpherePolarizedPlastic: optional('uEnvironmentSpherePolarizedPlastic'),
      pathTracingOutputComponent: optional('uPathTracingOutputComponent'),
      pathTracingOutputColorChannel: optional('uPathTracingOutputColorChannel'),
      environmentRadianceTexture: optional('uEnvironmentRadianceTexture'),
      sourceTextureMipmapsAvailable: optional('uSourceTextureMipmapsAvailable'),
      environmentSampleCounts: optional('uEnvironmentSampleCounts'),
      pathTracingMaxBounces: optional('uPathTracingMaxBounces'),
      panoramaYawDeg: optional('uPanoramaYawDeg'),
      panoramaPitchDeg: optional('uPanoramaPitchDeg'),
      panoramaHfovDeg: optional('uPanoramaHfovDeg'),
      pathTracingPass: optional('uPathTracingPass'),
      pathTracingSampleIndex: optional('uPathTracingSampleIndex'),
      pathTracingBlendWeight: optional('uPathTracingBlendWeight'),
      pathTracingPreviousTexture: optional('uPathTracingPreviousTexture'),
      environmentImportanceTexture: optional('uEnvironmentImportanceTexture'),
      environmentImportanceTextureSize: optional('uEnvironmentImportanceTextureSize'),
      environmentImportanceGridSize: optional('uEnvironmentImportanceGridSize'),
      environmentImportanceEntryCount: optional('uEnvironmentImportanceEntryCount'),
      environmentImportanceProjection: optional('uEnvironmentImportanceProjection'),
      environmentShIrradiance: optional('uEnvironmentShIrradiance[0]'),
      environmentSphereSmoothSilver: optional('uEnvironmentSphereSmoothSilver'),
      environmentSphereDiffuseReflectance: optional('uEnvironmentSphereDiffuseReflectance'),
      environmentSphereAlpha: optional('uEnvironmentSphereAlpha'),
      environmentSphereIntIor: optional('uEnvironmentSphereIntIor'),
      environmentSphereExtIor: optional('uEnvironmentSphereExtIor'),
      environmentSphereDistribution: optional('uEnvironmentSphereDistribution'),
      environmentSphereNonlinear: optional('uEnvironmentSphereNonlinear')
    };
    // These variants deliberately omit unused uniforms; WebGL ignores null writes.
    const required = kind === 'radiance' ? ['uDisplayMode']
      : ['uPanoramaYawDeg', 'uPanoramaPitchDeg', 'uPanoramaHfovDeg'];
    if (kind === 'sphericalHarmonics' || kind === 'pathTracing') required.push('uEnvironmentRadianceTexture');
    for (const name of required) getRequiredUniformLocation(gl, program, name);
    gl.useProgram(program);
    gl.uniform1iv(optional('uSourceTextures[0]'), Int32Array.from({ length: DISPLAY_SOURCE_SLOT_COUNT }, (_, index) => index));
    gl.uniform1i(optional('uColormapTexture'), COLORMAP_TEXTURE_UNIT);
    gl.uniform1i(uniforms.environmentRadianceTexture, ENVIRONMENT_RADIANCE_TEXTURE_UNIT);
    gl.uniform1i(uniforms.pathTracingPreviousTexture, PATH_TRACING_ACCUMULATION_TEXTURE_UNIT);
    gl.uniform1i(uniforms.environmentImportanceTexture, PATH_TRACING_ENVIRONMENT_TABLE_TEXTURE_UNIT);
    for (let component = 1; component < 4; component += 1) {
      gl.uniform1i(optional(`uEnvironmentStokesS${component}Texture`), ENVIRONMENT_STOKES_TEXTURE_UNITS[component]);
      gl.uniform1i(optional(`uPathTracingPreviousS${component}Texture`), PATH_TRACING_STOKES_TEXTURE_UNITS[component]);
    }
    gl.uniform1i(optional('uRoughPlasticTransmittanceTexture'), 7);
    return { program, uniforms };
  }
}

export function resolvePanoramaProgramKind(state: ViewerRenderState): PanoramaProgramKind {
  return resolvePanoramaDisplayMode(state.panoramaDisplayMode) === 'image'
    ? 'image' : resolvePanoramaLightingMethod(state.panoramaLightingMethod);
}
