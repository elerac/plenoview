import { readFileSync } from 'node:fs';
import { expect, test } from './helpers/test';
import { evaluateDielectricFresnel } from '../src/roughplastic';
import { resolveStokesParameterUniformValue } from '../src/display/gpu-bindings';
import {
  apply, basisRotation, environmentBasisRotation, multiply, normalize, reflectionMueller,
  pplasticBsdf, pplasticDiffuseMueller, pplasticPdf, scaleMatrix, sensorBasisRotation,
  stokesBasis, transmissionMueller, worldReflectionMueller, type Stokes, type Vector3
} from '../tests/helpers/polarization-reference';

interface NumericalCase { label: string; shader: string; expected: readonly number[]; expectedGgx?: readonly number[] }
const float = (value: number) => Number.isInteger(value) ? `${value}.0` : `${value}`;
const vector = (value: readonly number[]) => `vec${value.length}(${value.map(float).join(',')})`;
const input: Stokes = [1.2, -0.2, 0.5, -0.4];
const inputExpression = 'PolarizedStokes(vec3(1.2),vec3(-0.2),vec3(0.5),vec3(-0.4))';
const pplasticSamplerFixtures = [0.02, 0.2, 0.7].flatMap(alpha => [123, 6].map(seed => ({
  alpha, seed, normal: [0, 0, 1] as Vector3, view: normalize([0.2, 0.1, 1])
})));

function numericalCases(): NumericalCase[] {
  const cases: NumericalCase[] = [];
  for (const cosine of [1, 0.7, 0.1, 0.001]) {
    for (const [eta, k] of [[0.2, 3], [1.5, 0], [0.4, 2.7]]) {
      cases.push({
        label: `complex Fresnel cos=${cosine}, eta=${eta}, k=${k}`,
        shader: `outColor=mitsubaSpecularReflection(${float(cosine)},vec2(${float(eta)},${float(k)}))*${vector(input)};`,
        expected: apply(reflectionMueller(cosine, eta, k), input)
      });
    }
  }
  const directions: Vector3[] = [[0, 0, 1], [0, 0, -1], [0, 1, 0], normalize([1, 2, 3]), normalize([-2, 1, -3])];
  for (const direction of directions) {
    cases.push({
      label: `Duff implicit basis ${direction}`,
      shader: `outColor=vec4(mitsubaStokesBasis(${vector(direction)}),1.0);`,
      expected: [...stokesBasis(direction), 1]
    });
    cases.push({
      label: `emitter signed Stokes and proper basis conversion ${direction}`,
      shader: `outColor=packStokes(samplePolarizedEnvironment(${vector(direction)}));`,
      expected: apply(environmentBasisRotation(direction), input)
    });
  }
  const diagonal = normalize([1, -1, 0]);
  cases.push({
    label: 'double-angle signed rotation',
    shader: `outColor=rotateStokesBasis(vec3(0,0,1),vec3(1,0,0),${vector(diagonal)})*${vector(input)};`,
    expected: apply(basisRotation([0, 0, 1], [1, 0, 0], diagonal), input)
  });
  const ray = normalize([1, 0.4, 2]);
  cases.push({
    label: 'off-axis sensor orientation follows Mitsuba stokes integrator',
    shader: `outColor=packStokes(stokesToSensor(${inputExpression},${vector(ray)}));`,
    expected: apply(sensorBasisRotation(ray, [0, -1, 0]), input)
  });
  const view = normalize([0.2, 0.4, 1]), light = normalize([-0.5, 0.3, 1]);
  const normal = normalize([view[0] + light[0], view[1] + light[1], view[2] + light[2]]);
  const secondView = normalize([0.3, -0.4, 1]), secondLight = normalize([-0.2, -0.6, 1]);
  const secondNormal = normalize([secondView[0] + secondLight[0], secondView[1] + secondLight[1], secondView[2] + secondLight[2]]);
  const first = `silverReflectionMueller(${vector(normal)},${vector(view)},${vector(light)})`;
  const second = `silverReflectionMueller(${vector(secondNormal)},${vector(secondView)},${vector(secondLight)})`;
  const firstReference = worldReflectionMueller(normal, view, light, 0.2, 3);
  const secondReference = worldReflectionMueller(secondNormal, secondView, secondLight, 0.2, 3);
  cases.push({
    label: 'conductor rotates incident and outgoing frames independently',
    shader: `outColor=packStokes(applyMueller(${first},${inputExpression}));`,
    expected: apply(firstReference, input)
  }, {
    label: 'two noncoplanar conductor bounces multiply throughput on the right',
    shader: `outColor=packStokes(applyMueller(multiplyMueller(${first},${second}),${inputExpression}));`,
    expected: apply(multiply(firstReference, secondReference), input)
  }, {
    label: 'depolarizing material removes signed and circular Stokes',
    shader: `outColor=packStokes(applyMueller(depolarizingMueller(vec3(0.7)),${inputExpression}));`,
    expected: [0.84, 0, 0, 0]
  });
  for (const [uv, expected] of [
    [[1 / 6, 0], [1, -1, 2, 1]],
    [[0, 0], [3, -3, 6, 1]],
    [[0, 1], [23, -23, 46, 1]],
    [[2 / 3, 0.25], [6, -6, 12, 1]]
  ] as const) {
    cases.push({ label: `penvmap half-texel/seam/latitude sampling ${uv}`,
      shader: `outColor=vec4(samplePenvmapComponent(uTestTexture,${vector(uv)}),1.0);`, expected });
  }
  cases.push({
    label: 'rough plastic table interpolation over cosine endpoints',
    shader: 'outColor=vec4(roughPlasticLookup(0.42,0.2),0.0,1.0);',
    expected: [0.921, 0.1, 0, 1]
  });
  const eta = 1.49 / 1.000277;
  const microfacetCosine = Math.sqrt(.9);
  const distribution = Math.exp(-(1 / .9 - 1) / .04) / (Math.PI * .04 * .9 * .9);
  const brdf = evaluateDielectricFresnel(microfacetCosine, eta) * distribution / 3.2 +
    (.5 / .9) * .95 * .94 / (Math.PI * eta * eta);
  const ggxDistribution = 1 / (Math.PI * .04 * ((1 - .9) / .04 + .9) ** 2);
  const ggxMasking = 2 / (1 + Math.sqrt(1 + .04 * .36 / .64));
  const ggxBrdf = evaluateDielectricFresnel(microfacetCosine, eta) * ggxDistribution * ggxMasking / 3.2 +
    (.5 / .9) * .95 * .94 / (Math.PI * eta * eta);
  cases.push({
    label: 'rough plastic full glossy and diffuse BSDF depolarizes with Mitsuba table factors',
    shader: `float pdf; RgbMueller bsdf=evaluatePolarizedSurfaceBsdf(vec3(0,0,1),vec3(0,0,1),vec3(0.6,0,0.8),vec3(0.5),0.2,ENVIRONMENT_SURFACE_SPHERE,pdf);outColor=packStokes(applyMueller(bsdf,${inputExpression}));`,
    expected: [brdf * input[0], 0, 0, 0],
    expectedGgx: [ggxBrdf * input[0], 0, 0, 0]
  }, {
    label: 'full path tracer preserves signed Stokes through one smooth conductor bounce',
    shader: 'uint state=123u;outColor=packStokes(tracePolarizedEnvironmentPath(vec3(0),vec3(0,0,1),state));',
    expected: apply(reflectionMueller(1, 0.2, 3), input)
  });
  for (const alpha of [0.02, 0.2, 0.7]) {
    cases.push({
      label: `rough conductor VNDF sampled weight equals BSDF*cos/pdf alpha=${alpha}`,
      shader: `uint state=123u;vec3 light;RgbMueller weight;float pdf;bool valid=false;
        vec3 view=normalize(vec3(0.7,0.2,1.0)),normal=vec3(0,0,1);
        for(int attempt=0;attempt<16;++attempt){
          vec3 m=sampleMitsubaVisibleMicrofacet(normal,view,${float(alpha)},nextPathTracingRandom2(state));
          light=reflect(-view,m);if(light.z<=0.0)continue;
          pdf=mitsubaMicrofacetDistribution(normal,m,${float(alpha)})*mitsubaSmithG1(view,m,normal,${float(alpha)})/(4.0*view.z);
          weight=scaleMueller(silverReflectionMueller(m,view,light),mitsubaSmithG1(light,m,normal,${float(alpha)}));
          valid=pdf>0.0;break;
        }
        if(!valid)outColor=vec4(-1.0);else{
          vec3 h=normalize(view+light);
          float d=mitsubaMicrofacetDistribution(normal,h,${float(alpha)});
          float gv=mitsubaSmithG1(view,h,normal,${float(alpha)}),gl=mitsubaSmithG1(light,h,normal,${float(alpha)});
          RgbMueller evaluated=scaleMueller(silverReflectionMueller(h,view,light),d*gv*gl/(4.0*view.z*light.z));
          vec4 sampleValue=packStokes(applyMueller(weight,${inputExpression}));
          vec4 evalValue=packStokes(applyMueller(evaluated,${inputExpression}))*light.z/pdf;
          float mismatch=max(max(abs(sampleValue.x-evalValue.x),abs(sampleValue.y-evalValue.y)),max(abs(sampleValue.z-evalValue.z),abs(sampleValue.w-evalValue.w)));
          outColor=vec4(mismatch/max(sampleValue.x,0.0001),abs((d*gv/(4.0*view.z))/pdf-1.0),0.0,1.0);
        }`,
      expected: [0, 0, 0, 1]
    });
  }
  for (const transmissionEta of [1.5, 1 / 1.5]) {
    for (const cosine of [1, 0.8, 0.5, 0.01]) {
      cases.push({
        label: `dielectric transmission power/phase cos=${cosine} eta=${transmissionEta}`,
        shader: `outColor=mitsubaSpecularTransmission(${float(cosine)},${float(transmissionEta)})*${vector(input)};`,
        expected: apply(transmissionMueller(cosine, transmissionEta), input)
      });
    }
  }
  const plasticGeometries = [
    { normal: [0, 0, 1] as Vector3, view: [0, 0, 1] as Vector3, light: normalize([.6, .2, 1]) },
    { normal: [0, 0, 1] as Vector3, view: normalize([1.4, .2, 1]), light: normalize([.5, -.4, 1]) },
    { normal: [0, 1, 0] as Vector3, view: normalize([.3, 1, .8]), light: normalize([-.5, 1, .2]) },
    { normal: normalize([-.3, .7, -.5]), view: normalize([-.2, 1, -.4]), light: normalize([-.6, .5, -.6]) }
  ];
  for (const [index, geometry] of plasticGeometries.entries()) {
    const args = `${vector(geometry.normal)},${vector(geometry.view)},${vector(geometry.light)}`;
    const diffuseReference = pplasticDiffuseMueller(geometry.normal, geometry.view, geometry.light, eta);
    for (const source of [[1, 0, 0, 0], input, [1, 0, 0, 1]] as Stokes[]) {
      cases.push({
        label: `pplastic diffuse entrance/depolarization/exit world frames ${index} source=${source}`,
        shader: `outColor=pplasticDiffuseMueller(${args},${float(eta)})*${vector(source)};`,
        expected: apply(diffuseReference, source)
      });
    }
    for (const alpha of [0.1, 0.4]) {
      const reference = { ...geometry, eta, alpha, albedo: .3, distribution: 'beckmann' as const };
      const ggxReference = { ...reference, distribution: 'ggx' as const };
      cases.push({
        label: `pplastic complete polarized diffuse+specular BRDF geometry=${index} alpha=${alpha}`,
        shader: `float pdf;RgbMueller value=evaluatePathTracingPolarizedPlasticBsdf(${args},vec3(0.3,0.5,0.7),${float(alpha)},pdf);outColor=packStokes(applyMueller(value,${inputExpression}));`,
        expected: apply(pplasticBsdf(reference), input),
        expectedGgx: apply(pplasticBsdf(ggxReference), input)
      }, {
        label: `pplastic reflectance-only mixture PDF geometry=${index} alpha=${alpha}`,
        shader: `float pdf;evaluatePathTracingPolarizedPlasticBsdf(${args},vec3(0.3,0.5,0.7),${float(alpha)},pdf);outColor=vec4(pdf,pdf,pdf,1);`,
        expected: [pplasticPdf(reference, .5), pplasticPdf(reference, .5), pplasticPdf(reference, .5), 1],
        expectedGgx: [pplasticPdf(ggxReference, .5), pplasticPdf(ggxReference, .5), pplasticPdf(ggxReference, .5), 1]
      });
    }
  }
  for (const [index, fixture] of pplasticSamplerFixtures.entries()) {
    const sample = `uint state=${fixture.seed}u;vec3 light;RgbMueller weight;float pdf;
      bool valid=samplePathTracingPolarizedPlastic(${vector(fixture.normal)},${vector(fixture.view)},vec3(0.3,0.5,0.7),${float(fixture.alpha)},state,light,weight,pdf);`;
    // Check these against independent CPU BRDF/PDF using the sampled direction
    // after readback; we do not reproduce the GPU's pseudorandom inverse CDF.
    cases.push({ label: `pplastic sampler ${index} direction`, shader: `${sample}outColor=valid?vec4(light,pdf):vec4(0);`, expected: [] },
      { label: `pplastic sampler ${index} weight`, shader: `${sample}outColor=packStokes(applyMueller(weight,${inputExpression}));`, expected: [] });
  }
  return cases;
}

for (const variant of ['dynamic', 'polarized', 'depolarizing'] as const) {
test(`production ${variant} polarized GLSL matches independent Mitsuba numerical references @smoke`, async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  // A depolarizing central sphere is intentionally compiled in its own variant.
  const cases = numericalCases().filter(entry => variant !== 'polarized' ||
    !entry.label.startsWith('rough plastic full glossy'));
  const components = ['panorama-common.glsl', 'panorama-projection.glsl', 'panorama-lighting.glsl', 'panorama-polarization.glsl', 'panorama-path-tracing.glsl'];
  const prefix = '#version 300 es\n' +
    (variant === 'dynamic' ? '' : '#define PATH_TRACING_POLARIZED_ENVIRONMENT true\n' +
      `#define PATH_TRACING_DEPOLARIZING_SPHERE ${variant === 'depolarizing'}\n`) +
    components.map(file => readFileSync(new URL(`../src/rendering/shaders/${file}`, import.meta.url), 'utf8')).join('\n') + `
uniform sampler2D uTestTexture;
vec4 packStokes(PolarizedStokes value) { return vec4(value.s0.r,value.s1.r,value.s2.r,value.s3.r); }
`;
  // ANGLE inlines these diagnostic entry points. Keeping each program small
  // avoids driver compiler limits without removing any reference cases.
  const batchSize = 8;
  const batches = Array.from({ length: Math.ceil(cases.length / batchSize) }, (_, index) => {
    const offset = index * batchSize;
    const entries = cases.slice(offset, offset + batchSize);
    return { offset, count: entries.length, label: `batch ${index + 1}, cases ${offset}-${offset + entries.length - 1} (${entries.map(entry => entry.label).join('; ')})`, source: prefix + `
void main() {
  int testCase=int(gl_FragCoord.x);
  ${entries.map((entry, index) => `${index ? 'else ' : ''}if(testCase==${offset + index}) { ${entry.shader} }`).join('\n')}
  else outColor=vec4(0.0);
}` };
  });
  await page.setContent('<canvas></canvas>');
  const result = await page.evaluate(({ batches, width }) => {
    const canvas = document.querySelector('canvas')!;
    canvas.width = width;
    canvas.height = 1;
    const gl = canvas.getContext('webgl2', { antialias: false })!;
    if (!gl) throw new Error('WebGL2 is unavailable');
    if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('Float framebuffer support is unavailable');
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = String(gl.getParameter(debug?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER));
    function failure(stage: string, context: string, log: string | null): Error {
      return new Error(`${stage} failed for ${context}; renderer: ${renderer}; context lost: ${gl.isContextLost()}; WebGL error: 0x${gl.getError().toString(16)}; ${log?.trim() || '(driver returned no log)'}`);
    }
    function shader(type: number, text: string, context: string): WebGLShader {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, text);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw failure(type === gl.VERTEX_SHADER ? 'Vertex compilation' : 'Fragment compilation', context, gl.getShaderInfoLog(shader));
      return shader;
    }
    const vertex = shader(gl.VERTEX_SHADER, '#version 300 es\nvoid main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.0-1.0,0.0,1.0);}', 'shared fullscreen triangle');
    function texture(unit: number, w: number, h: number, values: Float32Array | null): WebGLTexture {
      const image = gl.createTexture()!;
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, image);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, w, h, 0, gl.RGBA, gl.FLOAT, values);
      return image;
    }
    const framebuffer = gl.createFramebuffer()!;
    const target = texture(0, width, 1, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Incomplete framebuffer');
    const textures: WebGLTexture[] = [target];
    [1.2, -0.2, 0.5, -0.4].forEach((value, index) => {
      textures.push(texture(index + 1, 3, 3, new Float32Array(Array.from({ length: 9 }, () => [value, value, value, 1]).flat())));
    });
    const signed = new Float32Array(Array.from({ length: 9 }, (_, i) => {
      const value = [1, -3, 5][i % 3] + Math.floor(i / 3) * 10;
      return [value, -value, 2 * value, 1];
    }).flat());
    textures.push(texture(5, 3, 3, signed));
    textures.push(texture(6, 1, 1, new Float32Array([1, 0, 1, 0])));
    const table = new Float32Array(Array.from({ length: 64 * 8 }, (_, i) => [.9 + .05 * (i % 64) / 63, .1, 0, 0]).flat());
    textures.push(texture(7, 64, 8, table));
    gl.viewport(0, 0, width, 1);
    const pixels: number[][] = [Array(width * 4).fill(0), Array(width * 4).fill(0)];
    for (const batch of batches) {
      const fragment = shader(gl.FRAGMENT_SHADER, batch.source, batch.label);
      const program = gl.createProgram()!;
      gl.attachShader(program, vertex);
      gl.attachShader(program, fragment);
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw failure('Program linking', batch.label, gl.getProgramInfoLog(program));
      gl.useProgram(program);
      ['uEnvironmentRadianceTexture', 'uEnvironmentStokesS1Texture', 'uEnvironmentStokesS2Texture', 'uEnvironmentStokesS3Texture'].forEach((name, index) => {
        gl.uniform1i(gl.getUniformLocation(program, name), index + 1);
      });
      gl.uniform1i(gl.getUniformLocation(program, 'uTestTexture'), 5);
      gl.uniform1i(gl.getUniformLocation(program, 'uEnvironmentImportanceTexture'), 6);
      gl.uniform1i(gl.getUniformLocation(program, 'uPathTracingPreviousTexture'), 6);
      gl.uniform1i(gl.getUniformLocation(program, 'uRoughPlasticTransmittanceTexture'), 7);
      gl.uniform1i(gl.getUniformLocation(program, 'uEnvironmentPolarized'), 1);
      gl.uniform1i(gl.getUniformLocation(program, 'uEnvironmentSphereSmoothSilver'), 1);
      gl.uniform1i(gl.getUniformLocation(program, 'uPathTracingMaxBounces'), 1);
      gl.uniform1f(gl.getUniformLocation(program, 'uEnvironmentSphereIntIor'), 1.49);
      gl.uniform1f(gl.getUniformLocation(program, 'uEnvironmentSphereExtIor'), 1.000277);
      gl.uniform1f(gl.getUniformLocation(program, 'uEnvironmentSphereAlpha'), .2);
      gl.uniform3f(gl.getUniformLocation(program, 'uConductorEta'), .2, .2, .2);
      gl.uniform3f(gl.getUniformLocation(program, 'uConductorK'), 3, 3, 3);
      for (const distribution of [0, 1]) {
        gl.uniform1i(gl.getUniformLocation(program, 'uEnvironmentSphereDistribution'), distribution);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        const values = new Float32Array(batch.count * 4);
        gl.readPixels(batch.offset, 0, batch.count, 1, gl.RGBA, gl.FLOAT, values);
        values.forEach((value, index) => { pixels[distribution][batch.offset * 4 + index] = value; });
        const error = gl.getError();
        if (error !== gl.NO_ERROR) throw failure('Rendering/readback', `${batch.label}, distribution ${distribution}`, `WebGL error: 0x${error.toString(16)}`);
      }
      gl.deleteProgram(program);
      gl.deleteShader(fragment);
    }
    const error = gl.getError();
    textures.forEach(image => gl.deleteTexture(image));
    gl.deleteFramebuffer(framebuffer);
    gl.deleteShader(vertex);
    return { pixels, renderer, error };
  }, { batches, width: cases.length });
  await testInfo.attach('gpu-backend', { body: result.renderer, contentType: 'text/plain' });
  expect(result.error).toBe(0);
  for (const [distribution, pixels] of result.pixels.entries()) {
    for (const [index, numericalCase] of cases.entries()) {
      const actual = pixels.slice(index * 4, index * 4 + 4);
      const expected = distribution === 1 && numericalCase.expectedGgx ? numericalCase.expectedGgx : numericalCase.expected;
      expected.forEach((value, channel) => {
        expect(Number.isFinite(actual[channel]), `${numericalCase.label}, channel ${channel}`).toBe(true);
        expect(Math.abs(actual[channel] - value), `${distribution === 1 ? 'GGX' : 'Beckmann'} ${numericalCase.label}: expected ${expected}, got ${actual}`)
          .toBeLessThan(3e-5 * Math.max(1, Math.abs(value)));
      });
    }
    for (const [index, fixture] of pplasticSamplerFixtures.entries()) {
      const directionOffset = 4 * cases.findIndex(entry => entry.label === `pplastic sampler ${index} direction`);
      const weightOffset = 4 * cases.findIndex(entry => entry.label === `pplastic sampler ${index} weight`);
      const light = pixels.slice(directionOffset, directionOffset + 3) as unknown as Vector3;
      const pdf = pixels[directionOffset + 3];
      const actual = pixels.slice(weightOffset, weightOffset + 4);
      expect(pdf, `pplastic sample valid (${distribution}, seed ${fixture.seed}, alpha ${fixture.alpha})`).toBeGreaterThan(0);
      const reference = { ...fixture, light, albedo: .3, eta: 1.49 / 1.000277, distribution: distribution === 0 ? 'beckmann' as const : 'ggx' as const };
      const expectedPdf = pplasticPdf(reference, .5);
      expect(Math.abs(pdf - expectedPdf) / expectedPdf, `pplastic independent sample PDF (${distribution}, ${index})`).toBeLessThan(1e-4);
      const expected = apply(scaleMatrix(pplasticBsdf(reference), light[2] / pdf), input);
      expected.forEach((value, channel) => expect(Math.abs(actual[channel] - value),
        `pplastic independent sample weight (${distribution}, ${index}, ${channel}) expected ${value}, got ${actual[channel]}`)
        .toBeLessThan(1e-4 * Math.max(1, Math.abs(value))));
    }
  }
});

}

test('all Stokes presentation mappings read averaged rendered buffers @smoke', async ({ page }, testInfo) => {
  const parameterNames = ['aolp', 'dolp', 'dop', 'docp', 'cop', 'top', 's1_over_s0', 's2_over_s0', 's3_over_s0'] as const;
  type Parameter = typeof parameterNames[number];
  const firstSample: readonly Stokes[] = [[2, 1, 0, .6], [1, .1, .5, -.3], [4, -.8, .4, 1.2]];
  const secondSample: readonly Stokes[] = [[1, -.2, .8, -.2], [3, .7, -.1, .5], [2, .4, .8, -.6]];
  const averaged = firstSample.map((value, color) => value.map((component, index) =>
    (component + secondSample[color][index]) / 2) as unknown as Stokes);
  const coverage = .75;
  function derived(parameter: Parameter, stokes: Stokes): number {
    const [i, q, u, v] = stokes;
    if (parameter === 'aolp') {
      const angle = .5 * Math.atan2(u, q);
      return angle < 0 ? angle + Math.PI : angle;
    }
    if (parameter === 'dolp') return Math.hypot(q, u) / i;
    if (parameter === 'dop') return Math.hypot(q, u, v) / i;
    if (parameter === 'docp') return Math.abs(v) / i;
    if (parameter === 'cop' || parameter === 'top') return .5 * Math.atan2(v, Math.hypot(q, u));
    return stokes[parameter === 's1_over_s0' ? 1 : parameter === 's2_over_s0' ? 2 : 3] / i;
  }
  // This fixture deliberately distinguishes derive(mean(Stokes)) from the
  // incorrect mean(derive(Stokes)), especially around changing linear axes.
  expect(Math.abs(derived('dolp', averaged[0]) -
    (derived('dolp', firstSample[0]) + derived('dolp', secondSample[0])) / 2)).toBeGreaterThan(.1);
  const cases: { label: string; parameter: number; component: number; channel: number; colormap: boolean; expected: number[] }[] = [];
  for (const component of [0, 1, 2, 3]) {
    for (const channel of [-1, 0, 1, 2]) {
      const color = channel === -1 ? averaged.map(value => value[component]) : Array(3).fill(averaged[channel][component]);
      cases.push({ label: `S${component} ${channel === -1 ? 'RGB' : `channel ${channel}`}`, parameter: -1, component, channel, colormap: false, expected: [...color, coverage] });
    }
  }
  for (const parameter of parameterNames) {
    for (const channel of [-1, 0, 1, 2]) {
      const color = channel === -1 ? averaged.map(value => derived(parameter, value)) : Array(3).fill(derived(parameter, averaged[channel]));
      cases.push({ label: `${parameter} ${channel === -1 ? 'RGB' : `channel ${channel}`}`, parameter: resolveStokesParameterUniformValue(parameter), component: 0, channel, colormap: false, expected: [...color, coverage] });
    }
    const luminanceStokes = [0, 1, 2, 3].map(component =>
      averaged[0][component] * .2126 + averaged[1][component] * .7152 + averaged[2][component] * .0722) as unknown as Stokes;
    const gray = (derived(parameter, luminanceStokes) + Math.PI) / (2 * Math.PI);
    cases.push({ label: `${parameter} luminance colormap`, parameter: resolveStokesParameterUniformValue(parameter), component: 0, channel: -1, colormap: true, expected: [gray, gray, gray, coverage] });
  }
  const source = ['#version 300 es', '#define PATH_TRACED_STOKES',
    ...['panorama-common.glsl', 'display-colors.glsl', 'path-tracing-display.glsl', 'path-tracing-present.frag.glsl']
      .map(file => readFileSync(new URL(`../src/rendering/shaders/${file}`, import.meta.url), 'utf8'))].join('\n');
  await page.setContent('<canvas width="1" height="1"></canvas>');
  const result = await page.evaluate(({ fragmentSource, values, coverage, configurations }) => {
    const gl = document.querySelector('canvas')!.getContext('webgl2', { antialias: false })!;
    if (!gl || !gl.getExtension('EXT_color_buffer_float')) throw new Error('Float WebGL2 rendering is unavailable');
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = String(gl.getParameter(debug?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER));
    function shader(type: number, source: string): WebGLShader {
      const value = gl.createShader(type)!;
      gl.shaderSource(value, source);
      gl.compileShader(value);
      if (!gl.getShaderParameter(value, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(value) ?? 'Shader compile failed');
      return value;
    }
    const vertex = shader(gl.VERTEX_SHADER, '#version 300 es\nvoid main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.0-1.0,0.0,1.0);}');
    const fragment = shader(gl.FRAGMENT_SHADER, fragmentSource);
    const program = gl.createProgram()!;
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'Shader link failed');
    gl.useProgram(program);
    const textures: WebGLTexture[] = [];
    function texture(unit: number, width: number, pixels: number[]): WebGLTexture {
      const value = gl.createTexture()!;
      textures.push(value);
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, value);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, width, 1, 0, gl.RGBA, gl.FLOAT, new Float32Array(pixels));
      return value;
    }
    const target = texture(0, 1, [0, 0, 0, 0]);
    const framebuffer = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Incomplete framebuffer');
    const uniform = (name: string) => gl.getUniformLocation(program, name);
    for (const [component, unit] of [13, 4, 5, 6].entries()) {
      texture(unit, 1, [...values.map(value => value[component] * coverage), coverage]);
      gl.uniform1i(uniform(component === 0 ? 'uAccumulationTexture' : `uAccumulationS${component}Texture`), unit);
    }
    // Unrelated source data occupies the ordinary image texture slots. The
    // production presentation program must never bind/read these as Stokes.
    texture(1, 1, [100, 200, 300, 1]);
    texture(2, 1, [-80, -90, -100, 1]);
    texture(3, 1, [60, 70, 80, 1]);
    texture(12, 2, [0, 0, 0, 1, 1, 1, 1, 1]);
    gl.uniform1i(uniform('uColormapTexture'), 12);
    gl.uniform2i(uniform('uColormapTextureSize'), 2, 1);
    gl.uniform1i(uniform('uColormapEntryCount'), 2);
    gl.uniform1f(uniform('uColormapMin'), -Math.PI);
    gl.uniform1f(uniform('uColormapMax'), Math.PI);
    gl.uniform1f(uniform('uColormapGamma'), 1);
    gl.uniform1f(uniform('uDisplayGamma'), 1);
    gl.uniform1i(uniform('uMaskInvalidStokesVectors'), 1);
    gl.uniform1i(uniform('uEnvironmentPolarized'), 1);
    gl.uniform1i(uniform('uAlphaOutputMode'), 1);
    gl.uniform2f(uniform('uOutputSize'), 1, 1);
    gl.uniform2f(uniform('uOutputPixelScale'), 1, 1);
    const pixels: number[][] = [];
    for (const config of configurations) {
      gl.uniform1i(uniform('uStokesParameter'), config.parameter);
      gl.uniform1i(uniform('uPathTracingOutputComponent'), config.component);
      gl.uniform1i(uniform('uPathTracingOutputColorChannel'), config.channel);
      gl.uniform1i(uniform('uUseColormap'), config.colormap ? 1 : 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      const pixel = new Float32Array(4);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, pixel);
      pixels.push(Array.from(pixel));
    }
    const samplers = Array.from({ length: gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS) as number }, (_, index) => gl.getActiveUniform(program, index)!)
      .filter(info => info.type === gl.SAMPLER_2D).map(info => info.name).sort();
    const error = gl.getError();
    textures.forEach(value => gl.deleteTexture(value));
    gl.deleteFramebuffer(framebuffer);
    gl.deleteProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    return { pixels, samplers, renderer, error };
  }, { fragmentSource: source, values: averaged, coverage, configurations: cases });
  await testInfo.attach('presentation-gpu-backend', { body: result.renderer, contentType: 'text/plain' });
  expect(result.error).toBe(0);
  expect(result.samplers).toEqual(['uAccumulationS1Texture', 'uAccumulationS2Texture', 'uAccumulationS3Texture', 'uAccumulationTexture', 'uColormapTexture']);
  for (const [index, config] of cases.entries()) {
    config.expected.forEach((value, channel) => expect(Math.abs(result.pixels[index][channel] - value),
      `${config.label}: expected ${config.expected}, got ${result.pixels[index]}`)
      .toBeLessThan(3e-5 * Math.max(1, Math.abs(value))));
  }
});
