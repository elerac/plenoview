import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const shaderFiles = [
  '../src/rendering/shaders/exr-image.frag.glsl',
  '../src/rendering/shaders/panorama-image.frag.glsl'
] as const;
const flatImageShaderPath = '../src/rendering/shaders/exr-image.frag.glsl';
const panoramaImageShaderPath = '../src/rendering/shaders/panorama-image.frag.glsl';

describe('shader source regressions', () => {
  it.each(shaderFiles)('%s avoids dynamic sampler indexing and reserved sample identifiers', (path) => {
    const source = readFileSync(new URL(path, import.meta.url), 'utf8');

    expect(source).not.toMatch(/uSourceTextures\[(?!\d+\])/);
    expect(source).not.toMatch(/\bDisplaySample\s+sample\b/);
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
    const source = readFileSync(new URL(path, import.meta.url), 'utf8');

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
    const source = readFileSync(new URL(panoramaImageShaderPath, import.meta.url), 'utf8');

    expect(source).toContain('vec2 samplePosition = screen + vec2(0.5) / pixelScale;');
  });

  it('selects horizontal-cross cubemap sampling from the source aspect ratio', () => {
    const source = readFileSync(new URL(panoramaImageShaderPath, import.meta.url), 'utf8');

    expect(source).toContain('abs(uImageSize.x * 3.0 - uImageSize.y * 4.0) < 0.5');
    expect(source).toContain('ivec2 cubemapDirectionToPixel(vec3 ray)');
    expect(source).toContain('ivec2 pixel = panoramaDirectionToPixel(ray);');
  });
});
