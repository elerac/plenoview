import panoramaFragmentSource from '../shaders/panorama-image.frag.glsl?raw';
import vertexSource from '../shaders/fullscreen-triangle.vert.glsl?raw';
import {
  PATH_TRACING_ACCUMULATION_TEXTURE_UNIT,
  PATH_TRACING_ENVIRONMENT_TABLE_TEXTURE_UNIT
} from './constants';
import { createProgram, getCommonUniforms, getRequiredUniformLocation } from './program-utils';
import type { PanoramaUniforms, ProgramBundle } from './types';

export function createPanoramaProgram(gl: WebGL2RenderingContext): ProgramBundle<PanoramaUniforms> {
  const program = createProgram(gl, vertexSource, panoramaFragmentSource);
  const bundle: ProgramBundle<PanoramaUniforms> = {
    program,
    uniforms: {
      ...getCommonUniforms(gl, program),
      sourceTextureMipmapsAvailable: getRequiredUniformLocation(
        gl,
        program,
        'uSourceTextureMipmapsAvailable'
      ),
      environmentLightingInteractive: getRequiredUniformLocation(
        gl,
        program,
        'uEnvironmentLightingInteractive'
      ),
      panoramaYawDeg: getRequiredUniformLocation(gl, program, 'uPanoramaYawDeg'),
      panoramaPitchDeg: getRequiredUniformLocation(gl, program, 'uPanoramaPitchDeg'),
      panoramaHfovDeg: getRequiredUniformLocation(gl, program, 'uPanoramaHfovDeg'),
      panoramaDisplayMode: getRequiredUniformLocation(gl, program, 'uPanoramaDisplayMode'),
      panoramaLightingMethod: getRequiredUniformLocation(gl, program, 'uPanoramaLightingMethod'),
      pathTracingPass: getRequiredUniformLocation(gl, program, 'uPathTracingPass'),
      pathTracingSampleIndex: getRequiredUniformLocation(gl, program, 'uPathTracingSampleIndex'),
      pathTracingBlendWeight: getRequiredUniformLocation(gl, program, 'uPathTracingBlendWeight'),
      pathTracingPreviousTexture: getRequiredUniformLocation(
        gl,
        program,
        'uPathTracingPreviousTexture'
      ),
      environmentImportanceTexture: getRequiredUniformLocation(
        gl,
        program,
        'uEnvironmentImportanceTexture'
      ),
      environmentImportanceTextureSize: getRequiredUniformLocation(
        gl,
        program,
        'uEnvironmentImportanceTextureSize'
      ),
      environmentImportanceGridSize: getRequiredUniformLocation(
        gl,
        program,
        'uEnvironmentImportanceGridSize'
      ),
      environmentImportanceEntryCount: getRequiredUniformLocation(
        gl,
        program,
        'uEnvironmentImportanceEntryCount'
      ),
      environmentImportanceProjection: getRequiredUniformLocation(
        gl,
        program,
        'uEnvironmentImportanceProjection'
      ),
      environmentShIrradiance: getRequiredUniformLocation(gl, program, 'uEnvironmentShIrradiance[0]'),
      environmentSphereDiffuseReflectance: getRequiredUniformLocation(
        gl,
        program,
        'uEnvironmentSphereDiffuseReflectance'
      ),
      environmentSphereAlpha: getRequiredUniformLocation(gl, program, 'uEnvironmentSphereAlpha'),
      environmentSphereIntIor: getRequiredUniformLocation(gl, program, 'uEnvironmentSphereIntIor'),
      environmentSphereExtIor: getRequiredUniformLocation(gl, program, 'uEnvironmentSphereExtIor'),
      environmentSphereDistribution: getRequiredUniformLocation(
        gl,
        program,
        'uEnvironmentSphereDistribution'
      ),
      environmentSphereNonlinear: getRequiredUniformLocation(
        gl,
        program,
        'uEnvironmentSphereNonlinear'
      )
    }
  };
  gl.useProgram(program);
  gl.uniform1i(
    bundle.uniforms.pathTracingPreviousTexture,
    PATH_TRACING_ACCUMULATION_TEXTURE_UNIT
  );
  gl.uniform1i(
    bundle.uniforms.environmentImportanceTexture,
    PATH_TRACING_ENVIRONMENT_TABLE_TEXTURE_UNIT
  );
  return bundle;
}
