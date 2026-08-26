import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const shaderFiles = [
  '../src/rendering/shaders/exr-image.frag.glsl',
  '../src/rendering/shaders/panorama-image.frag.glsl'
] as const;
const flatImageShaderPath = '../src/rendering/shaders/exr-image.frag.glsl';
const panoramaImageShaderPath = '../src/rendering/shaders/panorama-image.frag.glsl';
const pathTracingPresentShaderPath =
  '../src/rendering/shaders/path-tracing-present.frag.glsl';

describe('shader source regressions', () => {
  it.each(shaderFiles)('%s avoids dynamic sampler indexing and reserved sample identifiers', (path) => {
    const source = readFileSync(new URL(path, import.meta.url), 'utf8');

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

    expect(source).toContain('vec2 pixelSample = pathTracing');
    expect(source).toContain(': vec2(0.5);');
    expect(source).toContain('vec2 samplePosition = screen + pixelSample / pixelScale;');
  });

  it('selects horizontal-cross cubemap sampling from the source aspect ratio', () => {
    const source = readFileSync(new URL(panoramaImageShaderPath, import.meta.url), 'utf8');

    expect(source).toContain('abs(uImageSize.x * 3.0 - uImageSize.y * 4.0) < 0.5');
    expect(source).toContain('ivec2 cubemapDirectionToPixel(vec3 ray)');
    expect(source).toContain('ivec2 pixel = panoramaDirectionToPixel(ray);');
  });

  it('filters power-of-two cubemap-cross lighting without sampling across face boundaries', () => {
    const source = readFileSync(new URL(panoramaImageShaderPath, import.meta.url), 'utf8');

    expect(source).toContain('bool usesMipmappedCubemapCrossProjection()');
    expect(source).toContain('uniform bool uSourceTextureMipmapsAvailable;');
    expect(source).toContain('return uSourceTextureMipmapsAvailable && (');
    expect(source).toContain('(faceSize & (faceSize - 1)) == 0');
    expect(source).toContain('vec2 cubemapFaceSafeUvAtMip(');
    expect(source).toContain('vec2(mipFaceSize - 0.5)');
    expect(source).toContain('float uvClampMip = ceil(clampedLod);');
    expect(source).toContain(
      'cubemapFaceSafeUvAtMip(face, local, uvClampMip),'
    );
    expect(source).toContain('clampedLod\n    );');
    expect(source).toContain('lod <= 0.0 ||');
  });

  it('derives cubemap environment LOD from per-face texel solid angle', () => {
    const source = readFileSync(new URL(panoramaImageShaderPath, import.meta.url), 'utf8');

    expect(source).toContain(
      'float majorAxis = max(abs(ray.x), max(abs(ray.y), abs(ray.z)));'
    );
    expect(source).toContain(
      'texelSolidAngle = 4.0 * majorAxis * majorAxis * majorAxis /'
    );
    expect(source).toContain(
      'resolvedMaximumLod = min(resolvedMaximumLod, log2(faceSize));'
    );
    expect(source).not.toContain(
      'if (usesCubemapCrossProjection()) {\n    return 0.0;\n  }'
    );
  });

  it('provides the spherical-harmonics sphere and floor environment-lighting scene', () => {
    const source = readFileSync(new URL(panoramaImageShaderPath, import.meta.url), 'utf8');

    expect(source).toContain('uniform int uPanoramaDisplayMode;');
    expect(source).toContain('uniform vec3 uEnvironmentShIrradiance[36];');
    expect(source).toContain('uniform vec3 uEnvironmentSphereDiffuseReflectance;');
    expect(source).toContain('uniform float uEnvironmentSphereAlpha;');
    expect(source).toContain('uniform float uEnvironmentSphereIntIor;');
    expect(source).toContain('uniform float uEnvironmentSphereExtIor;');
    expect(source).toContain('uniform int uEnvironmentSphereDistribution;');
    expect(source).toContain('uniform bool uEnvironmentSphereNonlinear;');
    expect(source).toContain('const int PANORAMA_DISPLAY_MODE_ENVIRONMENT_LIGHTING = 1;');
    expect(source).toContain('vec3 evaluateEnvironmentIrradiance(vec3 normal)');
    expect(source).toContain('basis[0] = 0.28209479177387814;');
    expect(source).toContain('basis[8] = 0.5462742152960396 * (x2 - y2);');
    expect(source).toContain(
      'basis[24] = 0.6258357354491761 * (x4 - 6.0 * x2 * y2 + y4);'
    );
    expect(source).toContain(
      'basis[35] = 0.6563820568401701 * x * (x4 - 10.0 * x2 * y2 + 5.0 * y4);'
    );
    expect(source).toContain('coefficientIndex < 36');
    expect(source).toContain(
      'irradiance += uEnvironmentShIrradiance[coefficientIndex] * basis[coefficientIndex];'
    );
    expect(source).toContain('const vec3 ENVIRONMENT_SPHERE_CENTER = vec3(0.0, 0.0, 3.5);');
    expect(source).toContain('const vec3 ENVIRONMENT_FLOOR_CENTER = vec3(0.0, 1.0, 3.5);');
    expect(source).toContain('const float ENVIRONMENT_FLOOR_RADIUS = 2.75;');
    expect(source).toContain('const float ENVIRONMENT_FLOOR_ALPHA = 0.7;');
    expect(source).toContain('const float ENVIRONMENT_CAMERA_ORBIT_RADIUS = 3.5;');
    expect(source).toContain('const float MIN_ENVIRONMENT_CAMERA_ORBIT_PITCH_DEG = -15.0;');
    expect(source).toContain('vec3 originToCenter = rayOrigin - center;');
    expect(source).toContain('vec3 point = rayOrigin + rayDirection * distance;');
    expect(source).toContain('void resolveEnvironmentOrbitCamera(');
    expect(source).toContain('void resolveEnvironmentOrbitBasis(');
    expect(source).toContain('right = rotateYaw(vec3(1.0, 0.0, 0.0), yaw);');
    expect(source).toContain(
      'rayOrigin = ENVIRONMENT_SPHERE_CENTER - forward * ENVIRONMENT_CAMERA_ORBIT_RADIUS;'
    );
    expect(source).toContain('resolveEnvironmentOrbitCamera(cameraRay, rayOrigin, ray);');
    expect(source).toContain('uPanoramaPitchDeg,');
    expect(source).toContain('MIN_ENVIRONMENT_CAMERA_ORBIT_PITCH_DEG');
    expect(source).toContain(
      'if (uPanoramaDisplayMode == PANORAMA_DISPLAY_MODE_ENVIRONMENT_LIGHTING)'
    );
    expect(source).toContain('vec3 evaluateEnvironmentRoughPlastic(');
    expect(source).toContain('float evaluateDielectricFresnel(float cosThetaI, float eta)');
    expect(source).toContain('float evaluateRoughPlasticSmithG1(');
    expect(source).toContain('float evaluateRoughPlasticMicrofacetDistribution(');
    expect(source).toContain('float resolveEnvironmentSampleLod(');
    expect(source).toContain('const int ROUGH_PLASTIC_DIFFUSE_SAMPLE_COUNT = 256;');
    expect(source).toContain('const int ROUGH_PLASTIC_SPECULAR_SAMPLE_COUNT = 128;');
    expect(source).toContain('uniform bool uEnvironmentLightingInteractive;');
    expect(source).toContain('const int ROUGH_PLASTIC_INTERACTIVE_DIFFUSE_SAMPLE_COUNT = 64;');
    expect(source).toContain('const int ROUGH_PLASTIC_INTERACTIVE_SPECULAR_SAMPLE_COUNT = 64;');
    expect(source).toContain('if (sampleIndex >= specularSampleCount)');
    expect(source).toContain('if (sampleIndex >= diffuseSampleCount)');
    expect(source).toContain('specular /= float(specularSampleCount);');
    expect(source).toContain('transmittedIrradiance /= float(diffuseSampleCount);');
    expect(source).toContain('ROUGH_PLASTIC_SAMPLE_FILTER_OVERLAP /');
    expect(source).toContain('vec3 sampleRoughPlasticMicrofacetNormal(vec2 sampleValue, float alpha)');
    expect(source).toContain(
      'specular += sampleEnvironmentRadiance(wi, environmentLod) * sampleWeight;'
    );
    expect(source).toContain(
      'transmittedIrradiance += sampleEnvironmentRadiance(wi, environmentLod)'
    );
    expect(source).toContain('vec2 equirectangularDirectionToUv(vec3 direction)');
    expect(source).toContain('return readDisplaySample(pixel).linear;');
    expect(source).toContain('roughPlasticRadicalInverse(sampleIndex) + offset');
    expect(source).toContain(
      'buildRoughPlasticFrame(normal, cameraRight, cameraDown, tangent, bitangent);'
    );
    expect(source).not.toContain('0.6180339887498949');
    expect(source).not.toContain('abs(normal.z) < 0.999');
    expect(source).toContain('textureLod(uSourceTextures[0], uv, lod)');
    expect(source).toContain('materialAlpha = ENVIRONMENT_FLOOR_ALPHA;');
    expect(source).toContain(
      'ENVIRONMENT_COMPARISON_SPHERE_DIFFUSE_REFLECTANCE[sphereIndex]'
    );
    expect(source).toContain('const int ENVIRONMENT_COMPARISON_SPHERE_COUNT = 6;');
    expect(source).toContain('const float ENVIRONMENT_COMPARISON_SPHERE_RADIUS = 0.3;');
    expect(source).toContain('const float ENVIRONMENT_COMPARISON_SPHERE_ALPHA[6]');
    expect(source).toContain('sphereAlpha = uEnvironmentSphereAlpha;');
    expect(source).toContain('sceneMaterialAlpha');
    expect(source).not.toContain('lightingNormal');
    expect(source).toContain('vec3 linear = evaluateEnvironmentRoughPlastic(');
    expect(source).toContain('surfaceType == ENVIRONMENT_SURFACE_FLOOR');
    expect(source).toContain('evaluateEnvironmentIrradiance(normal) *');
    expect(source).toContain('(exteriorDiffuseTransmittance / PI);');
    expect(source).toContain(') * sceneVisibility;');
    expect(source).not.toContain('samplePathTracingLambertDirection');
    expect(source).toContain('albedo = mix(vec3(0.34), vec3(0.43), checker);');
    expect(source).not.toContain('radialFade');
  });

  it('provides progressive multi-bounce path tracing with environment NEE and MIS', () => {
    const source = readFileSync(new URL(panoramaImageShaderPath, import.meta.url), 'utf8');
    const presentSource = readFileSync(
      new URL(pathTracingPresentShaderPath, import.meta.url),
      'utf8'
    );

    expect(source).toContain('uniform sampler2D uPathTracingPreviousTexture;');
    expect(source).toContain('uniform sampler2D uEnvironmentImportanceTexture;');
    expect(source).toContain('const int PATH_TRACING_MAX_BOUNCES = 6;');
    expect(source).toContain(
      'for (int bounce = 0; bounce < PATH_TRACING_MAX_BOUNCES; bounce += 1)'
    );
    expect(source).toContain('vec3 samplePathTracingDirectEnvironment(');
    expect(source).toContain('bool sampleEnvironmentImportance(');
    expect(source).toContain('float pathTracingPowerHeuristic(');
    expect(source).toContain('float survivalProbability = clamp(');
    expect(source).toContain('outColor = mix(previous, pathSample,');
    expect(presentSource).toContain('vec3 linear = alpha > 1.0e-6');
    expect(presentSource).toContain('accumulated.rgb / alpha');
  });
});
