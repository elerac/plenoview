import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  createPanoramaFragmentSource,
  environmentRadianceFragmentSource
} from '../src/rendering/gl-image-renderer/panorama-shader-source';

const shaderFiles = [
  '../src/rendering/shaders/exr-image.frag.glsl',
  '../src/rendering/shaders/panorama-image.frag.glsl'
] as const;
const flatImageShaderPath = '../src/rendering/shaders/exr-image.frag.glsl';
const panoramaImageShaderPath = '../src/rendering/shaders/panorama-image.frag.glsl';

function readShaderSource(path: string): string {
  return path === panoramaImageShaderPath
    ? createPanoramaFragmentSource('image')
    : readFileSync(new URL(path, import.meta.url), 'utf8');
}
const pathTracingPresentShaderPath =
  '../src/rendering/shaders/path-tracing-present.frag.glsl';

describe('shader source regressions', () => {
  it('specializes path transport to its source while keeping diagnostic shaders dynamic', () => {
    for (const polarized of [true, false]) {
      expect(createPanoramaFragmentSource('pathTracing', polarized)).toContain(
        `#define PATH_TRACING_POLARIZED_ENVIRONMENT ${polarized}`
      );
    }
    expect(createPanoramaFragmentSource('pathTracing')).not.toContain('#define PATH_TRACING_POLARIZED_ENVIRONMENT');
    expect(createPanoramaFragmentSource('image', true)).toBe(createPanoramaFragmentSource('image', false));
  });

  it('restricts material specialization to polarized sources and specializes accumulation independently', () => {
    const progressive = createPanoramaFragmentSource('pathTracing', true, false, true);
    expect(progressive).toContain('#define PATH_TRACING_DEPOLARIZING_SPHERE false');
    expect(progressive).toContain('#define PATH_TRACING_ACCUMULATE_ONLY');
    const direct = createPanoramaFragmentSource('pathTracing', true, true);
    expect(direct).toContain('#define PATH_TRACING_DEPOLARIZING_SPHERE true');
    expect(direct).not.toContain('#define PATH_TRACING_ACCUMULATE_ONLY');
    expect(createPanoramaFragmentSource('pathTracing', false, true))
      .not.toContain('#define PATH_TRACING_DEPOLARIZING_SPHERE');
  });

  it('compiles separate panorama modes without unrelated rendering algorithms', () => {
    const imageSource = createPanoramaFragmentSource('image');
    const pathSource = createPanoramaFragmentSource('pathTracing');

    expect(imageSource).toContain('DisplaySample readDisplaySample(');
    expect(imageSource).not.toContain('resolveEnvironmentScene(');
    expect(imageSource).not.toContain('sampleEnvironmentRadiance(');
    expect(imageSource).not.toContain('traceEnvironmentPath(');
    expect(pathSource).toContain('traceEnvironmentPath(');
    expect(pathSource).not.toContain('evaluateEnvironmentRoughPlastic(');
    expect(pathSource).not.toContain('evaluateEnvironmentIrradiance(');
    expect(pathSource).not.toContain('readDisplaySample(');
    expect(pathSource).not.toContain('uSourceTextures');

    for (const source of [imageSource, pathSource]) {
      expect(source.startsWith('#version 300 es\n')).toBe(true);
      expect(source.match(/void main\(/g)).toHaveLength(1);
      expect(source).not.toContain('uPanoramaDisplayMode');
      expect(source).not.toContain('uPanoramaLightingMethod');
    }
  });

  it('samples the cached HDR texture in lighting loops without evaluating display channels', () => {
    const source = createPanoramaFragmentSource('pathTracing');
    const start = source.indexOf('vec3 sampleEnvironmentRadiance(');
    const end = source.indexOf('\n}\n', start) + 3;
    const samplingFunction = source.slice(start, end);

    expect(samplingFunction).toContain('texelFetch(uEnvironmentRadianceTexture, pixel, 0)');
    expect(samplingFunction).toContain('textureLod(uEnvironmentRadianceTexture, uv, sampleLod)');
    expect(samplingFunction).not.toContain('readDisplaySample');
    expect(samplingFunction).not.toContain('uSourceTextures');
    expect(samplingFunction).not.toContain('uDisplayMode');
  });

  it('bakes sanitized linear HDR values and alpha before display transforms', () => {
    const main = environmentRadianceFragmentSource.slice(
      environmentRadianceFragmentSource.indexOf('void main()')
    );

    expect(main).toContain('readDisplaySample(ivec2(gl_FragCoord.xy))');
    expect(main).toContain('vec4(sanitizeDisplayColor(displaySample.linear), displaySample.alpha)');
    expect(main).not.toContain('uExposure');
    expect(main).not.toContain('linearToDisplayGamma');
    expect(main).not.toContain('sampleColormap');
    expect(main).not.toContain('applyInvalidValueWarning');
    expect(environmentRadianceFragmentSource).toContain('floatBitsToUint(value)');
    expect(environmentRadianceFragmentSource).toContain('(bits & 0x7f800000u) == 0x7f800000u ? 0u : bits');
    expect(environmentRadianceFragmentSource).toContain('return uintBitsToFloat(finiteBits);');
  });

  it.each(shaderFiles)('%s avoids dynamic sampler indexing and reserved sample identifiers', (path) => {
    const source = readShaderSource(path);

    expect(source).not.toMatch(/uSourceTextures\[(?!\d+\])/);
    expect(source).not.toMatch(/\bDisplaySample\s+sample\b/);
    expect(source).not.toMatch(/\b(?:bool|int|uint|float|vec[234])\s+sample\b/);
    expect(source).not.toMatch(/\bsample\./);
    expect(source).toContain('uniform float uDisplayGamma;');
    expect(source).toContain('uniform float uColormapExposure;');
    expect(source).toContain('uniform float uColormapGamma;');
    expect(source).toContain('uniform bool uColormapZeroCentered;');
    expect(source).toContain('uniform bool uColormapReversed;');
    expect(source).toContain('uniform bool uMaskInvalidStokesVectors;');
    expect(source).toContain('uniform bool uWarnInvalidValues;');
    expect(source).toContain('uniform float uInvalidValueWarningPhase;');
    expect(source).toContain('uniform int uBackgroundMode;');
    expect(source).toContain('uniform vec3 uBackgroundColor;');
    expect(source).toContain('BACKGROUND_MODE_CHECKER');
    expect(source).toContain('BACKGROUND_MODE_SOLID');
    expect(source).toContain('mix(uBackgroundColor, color, alpha)');
    expect(source).toContain('linearToDisplayGamma');
    expect(source).toContain('sign(linear) * pow(abs(linear)');
    expect(source).toContain('float scaledValue = value * exp2(uColormapExposure);');
    expect(source).toContain('pow(clamp((scaledValue - vmin) / (vmax - vmin), 0.0, 1.0), 1.0 / gamma)');
    expect(source).toContain('float signedGamma = sign(signedValue) * pow(abs(signedValue), 1.0 / gamma);');
    expect(source).toContain('t = 1.0 - t;');
    expect(source).toContain('const float STOKES_VECTOR_VALIDITY_RTOL = 1.0e-8;');
    expect(source).not.toContain('STOKES_VECTOR_VALIDITY_ATOL');
    expect(source).toContain(
      's0Squared - (s1 * s1 + s2 * s2 + s3 * s3) >= -abs(STOKES_VECTOR_VALIDITY_RTOL) * s0Squared'
    );
    expect(source).toContain('uMaskInvalidStokesVectors && !isPhysicallyValidStokesVector');
    expect(source).toContain('bool invalidValue;');
    expect(source).toContain('struct StokesRgbDisplaySample');
    expect(source).toContain('applyInvalidValueWarning');
    expect(source).toContain('isInvalidStokesDisplayValue');
    expect(source).toContain(
      'shouldRejectStokesVector(stokes.x, stokes.y, stokes.z, stokes.w) || !isFiniteValue(value)'
    );
    expect(source.match(/isInvalidStokesDisplayValue\(stokes, value\)/g) ?? []).toHaveLength(3);
    expect(source.match(/hasInvalidStokesDisplayValues\(stokesR, stokesG, stokesB, value\)/g) ?? [])
      .toHaveLength(2);
    expect(source).toContain('return DisplaySample(stokesRgb.value, 1.0, vec4(0.0), stokesRgb.invalidValue);');
    expect(source).toContain('DISPLAY_MODE_STOKES_SPECTRAL_RGB');
    expect(source).toContain('readSpectralStokesRgbDisplaySample');
  });

  it.each(shaderFiles)('%s converts physical fragment coordinates to logical screen coordinates', (path) => {
    const source = readShaderSource(path);

    expect(source).toContain('uniform vec2 uOutputPixelScale;');
    expect(source).toContain('vec2 pixelScale = max(uOutputPixelScale, vec2(1.0e-6));');
    expect(source).toContain('(gl_FragCoord.x - 0.5) / pixelScale.x');
    expect(source).toContain('uOutputSize.y - (gl_FragCoord.y + 0.5) / pixelScale.y');
  });

  it('smoothly minifies the flat image from centered continuous coordinates while preserving nearest magnification', () => {
    const source = readFileSync(new URL(flatImageShaderPath, import.meta.url), 'utf8');

    expect(source).toContain('ivec2 pixel = clamp(ivec2(floor(samplePos)), ivec2(0), maxPixel);');
    expect(source).toContain('float effectiveZoom = uZoom * min(pixelScale.x, pixelScale.y);');
    expect(source).toContain('bool minifying = effectiveZoom < 1.0;');
    expect(source).toContain('vec2(0.5) / (uZoom * pixelScale)');
    expect(source).toContain('SourceCoordinate source = SourceCoordinate(');
    expect(source).not.toContain('float lod;');
    expect(source).not.toContain('source.lod');
    expect(source).not.toContain('textureLod(');

    for (let slotIndex = 0; slotIndex < 12; slotIndex += 1) {
      expect(source).toContain(`texture(uSourceTextures[${slotIndex}], source.uv)`);
      expect(source).toContain(`texelFetch(uSourceTextures[${slotIndex}], source.pixel, 0)`);
    }

    expect(source).toContain('vec3 spectralRgb = readRgbSource0(source);');
    expect(source).toContain('vec4 mueller = readRgbaSource0(source);');
  });

  it('centers panorama samples in logical pixels under high-density output scaling', () => {
    const source = createPanoramaFragmentSource('image');

    expect(source).toContain('vec2 pixelSample = vec2(0.5);');
    expect(createPanoramaFragmentSource('pathTracing')).toContain(
      'vec2 samplePosition = screen + nextPathTracingRandom2(randomState) / pixelScale;'
    );
    expect(source).toContain('vec2 samplePosition = screen + pixelSample / pixelScale;');
  });

  it('selects horizontal-cross cubemap sampling from the source aspect ratio', () => {
    const source = createPanoramaFragmentSource('image');

    expect(source).toContain('abs(uImageSize.x * 3.0 - uImageSize.y * 4.0) < 0.5');
    expect(source).toContain('ivec2 cubemapDirectionToPixel(vec3 ray)');
    expect(source).toContain('ivec2 pixel = panoramaDirectionToPixel(ray);');
  });

  it('filters power-of-two cubemap-cross lighting without sampling across face boundaries', () => {
    const source = createPanoramaFragmentSource('pathTracing');

    expect(source).toContain('bool usesMipmappedCubemapCrossProjection()');
    expect(source).toContain('uniform bool uSourceTextureMipmapsAvailable;');
    expect(source).toContain('(faceSize & (faceSize - 1)) == 0');
    expect(source).toContain('vec2 cubemapFaceSafeUvAtMip(');
    expect(source).toContain('vec2(mipFaceSize - 0.5)');
    expect(source).toContain('float uvClampMip = ceil(clampedLod);');
    expect(source).toContain(
      'uv = cubemapFaceSafeUvAtMip(face, local, uvClampMip);'
    );
    expect(source).toContain('sampleLod = clampedLod;');
    expect(source).toContain('return textureLod(uEnvironmentRadianceTexture, uv, sampleLod).rgb;');
    expect(source).toContain('lod <= 0.0 ||');
  });

  it('provides progressive multi-bounce path tracing with environment NEE and MIS', () => {
    const source = createPanoramaFragmentSource('pathTracing');
    const presentSource = readFileSync(
      new URL(pathTracingPresentShaderPath, import.meta.url),
      'utf8'
    );

    expect(source).toContain('uniform sampler2D uPathTracingPreviousTexture;');
    expect(source).toContain('uniform sampler2D uEnvironmentImportanceTexture;');
    expect(source).toContain('uniform int uPathTracingMaxBounces;');
    expect(source).toContain(
      'for (int bounce = 0; bounce <= uPathTracingMaxBounces; ++bounce)'
    );
    expect(source).toContain('PolarizedStokes tracePolarizedEnvironmentPath(');
    expect(source).toContain('bool sampleEnvironmentImportance(');
    expect(source).toContain('float pathTracingPowerHeuristic(');
    expect(source).toContain('float survival = min(throughputMaximum, 0.95);');
    expect(source).toContain('outColor = mix(texelFetch(uPathTracingPreviousTexture, pixel, 0), s0, weight);');
    expect(source).toContain('throughput = multiplyMueller(throughput, bounceWeight);');
    expect(source).toContain('layout(location = 3) out vec4 outStokesS3;');
    expect(presentSource).toContain('float inverseAlpha = alpha > 1.0e-6');
    expect(presentSource).toContain('accumulated.rgb * inverseAlpha');
  });
});
