import commonSource from '../shaders/panorama-common.glsl?raw';
import displaySource from '../shaders/panorama-display.glsl?raw';
import projectionSource from '../shaders/panorama-projection.glsl?raw';
import lightingSource from '../shaders/panorama-lighting.glsl?raw';
import sphericalHarmonicsSource from '../shaders/panorama-sh-lighting.glsl?raw';
import pathTracingSource from '../shaders/panorama-path-tracing.glsl?raw';
import imageMainSource from '../shaders/panorama-image.frag.glsl?raw';
import sphericalHarmonicsMainSource from '../shaders/panorama-lighting.frag.glsl?raw';
import pathTracingMainSource from '../shaders/panorama-path-tracing.frag.glsl?raw';
import environmentRadianceMainSource from '../shaders/environment-radiance.frag.glsl?raw';

export type PanoramaProgramKind = 'image' | 'sphericalHarmonics' | 'pathTracing';

function fragmentSource(...parts: string[]): string {
  return ['#version 300 es', ...parts].join('\n');
}

/** Assemble distinct programs so native compilers only see the selected mode. */
export function createPanoramaFragmentSource(kind: PanoramaProgramKind): string {
  switch (kind) {
    case 'image':
      return fragmentSource(commonSource, displaySource, projectionSource, imageMainSource);
    case 'sphericalHarmonics':
      return fragmentSource(
        commonSource,
        displaySource,
        projectionSource,
        lightingSource,
        sphericalHarmonicsSource,
        sphericalHarmonicsMainSource
      );
    case 'pathTracing':
      return fragmentSource(
        commonSource,
        projectionSource,
        lightingSource,
        pathTracingSource,
        pathTracingMainSource
      );
  }
}

/** Evaluate selected channels once, before repeated lighting samples. */
export const environmentRadianceFragmentSource = fragmentSource(
  commonSource,
  displaySource,
  environmentRadianceMainSource
);
