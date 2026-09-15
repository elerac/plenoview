import commonSource from '../shaders/panorama-common.glsl?raw';
import displaySource from '../shaders/panorama-display.glsl?raw';
import displayColorsSource from '../shaders/display-colors.glsl?raw';
import projectionSource from '../shaders/panorama-projection.glsl?raw';
import lightingSource from '../shaders/panorama-lighting.glsl?raw';
import pathTracingSource from '../shaders/panorama-path-tracing.glsl?raw';
import pathTracingDisplaySource from '../shaders/path-tracing-display.glsl?raw';
import polarizationSource from '../shaders/panorama-polarization.glsl?raw';
import imageMainSource from '../shaders/panorama-image.frag.glsl?raw';
import pathTracingMainSource from '../shaders/panorama-path-tracing.frag.glsl?raw';
import environmentRadianceMainSource from '../shaders/environment-radiance.frag.glsl?raw';

export type PanoramaProgramKind = 'image' | 'pathTracing';

function fragmentSource(...parts: string[]): string {
  return ['#version 300 es', ...parts].join('\n');
}

/** Assemble distinct programs so native compilers only see the selected mode. */
export function createPanoramaFragmentSource(kind: PanoramaProgramKind, polarized?: boolean): string {
  switch (kind) {
    case 'image':
      return fragmentSource(commonSource, displayColorsSource, displaySource, projectionSource, imageMainSource);
    case 'pathTracing':
      return fragmentSource(
        '#define PATH_TRACED_STOKES',
        ...(polarized === undefined ? [] : [`#define PATH_TRACING_POLARIZED_ENVIRONMENT ${polarized}`]),
        commonSource,
        displayColorsSource,
        pathTracingDisplaySource,
        projectionSource,
        lightingSource,
        polarizationSource,
        pathTracingSource,
        pathTracingMainSource
      );
  }
}

/** Evaluate selected channels once, before repeated lighting samples. */
export const environmentRadianceFragmentSource = fragmentSource(
  commonSource,
  displayColorsSource,
  displaySource,
  environmentRadianceMainSource
);
