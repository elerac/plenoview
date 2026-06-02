import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cloneChannelRecognitionNameRules,
  compileChannelRecognitionNameRules,
  createDefaultChannelRecognitionNameRules,
  parseDepthMapChannelNameWithRules,
  parseComponentChannelNameWithRules,
  parseMuellerMatrixChannelNameWithRules,
  parseNormalMapChannelNameWithRules,
  parseRgbStokesChannelNameWithRules,
  parseScalarStokesChannelNameWithRules,
  parseSpectralChannelNameWithRules,
  parseSpectralStokesChannelNameWithRules,
  readStoredChannelRecognitionNameRules,
  saveStoredChannelRecognitionNameRules,
  validateChannelRecognitionNameRule,
  validateChannelRecognitionNameRules,
  CHANNEL_RECOGNITION_NAME_RULES_STORAGE_KEY
} from '../src/channel-recognition-name-rules';
import { recognizeLayerChannels } from '../src/channel-recognition';

describe('channel recognition name rules', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('preserves the existing default channel-name behavior', () => {
    const compiled = compileChannelRecognitionNameRules();

    expect(parseComponentChannelNameWithRules('beauty.R', 'rgb', compiled)).toEqual({ base: 'beauty', slot: 'r' });
    expect(parseComponentChannelNameWithRules('N.Z', 'xyz', compiled)).toEqual({ base: 'N', slot: 'z' });
    expect(parseNormalMapChannelNameWithRules('N.Z', compiled)).toEqual({ base: 'N', component: 'z' });
    expect(parseNormalMapChannelNameWithRules('normal.X', compiled)).toEqual({ base: 'normal', component: 'x' });
    expect(parseNormalMapChannelNameWithRules('surface_normal.Y', compiled)).toEqual({
      base: 'surface_normal',
      component: 'y'
    });
    expect(parseNormalMapChannelNameWithRules('surface.X', compiled)).toBeNull();
    expect(parseDepthMapChannelNameWithRules('Z', compiled)).toEqual({ channelName: 'Z' });
    expect(parseDepthMapChannelNameWithRules('depth.Z', compiled)).toEqual({ channelName: 'depth.Z' });
    expect(parseDepthMapChannelNameWithRules('cameraDepth.Z', compiled)).toEqual({ channelName: 'cameraDepth.Z' });
    expect(parseDepthMapChannelNameWithRules('beauty.Z', compiled)).toBeNull();
    expect(parseComponentChannelNameWithRules('flow.U', 'uv', compiled)).toEqual({ base: 'flow', slot: 'u' });
    expect(parseSpectralChannelNameWithRules('FUGA500nm', compiled)).toMatchObject({
      wavelength: 500,
      seriesKey: ''
    });
    expect(parseSpectralChannelNameWithRules('S0.414nm', compiled)).toMatchObject({
      wavelength: 414,
      seriesKey: 'S0'
    });
    expect(parseSpectralStokesChannelNameWithRules('S2.450nm', compiled)).toMatchObject({
      component: 'S2',
      wavelength: 450,
      suffix: '450nm'
    });
    expect(parseSpectralStokesChannelNameWithRules('s2.450NM', compiled)).toMatchObject({
      component: 'S2',
      wavelength: 450,
      suffix: '450nm'
    });
    expect(parseScalarStokesChannelNameWithRules('S3.mask', compiled)).toEqual({
      component: 'S3',
      suffix: 'mask'
    });
    expect(parseRgbStokesChannelNameWithRules('S1.G', compiled)).toEqual({
      component: 'S1',
      rgb: 'G'
    });
    expect(parseRgbStokesChannelNameWithRules('s1.g', compiled)).toEqual({
      component: 'S1',
      rgb: 'G'
    });
    expect(parseMuellerMatrixChannelNameWithRules('M23.diffuse', compiled)).toEqual({
      element: 'M23',
      suffix: 'diffuse'
    });
    expect(parseMuellerMatrixChannelNameWithRules('m23.diffuse', compiled)).toEqual({
      element: 'M23',
      suffix: 'diffuse'
    });
  });

  it('recognizes custom component aliases after applying custom regexes', () => {
    const rules = createDefaultChannelRecognitionNameRules();
    rules['component.rgb'] = {
      pattern: '^(?<base>.+)_(?:(?<r>[rR][eE][dD])|(?<g>[gG][rR][eE][eE][nN])|(?<b>[bB][lL][uU][eE])|(?<a>[aA][lL][pP][hH][aA]))$'
    };

    const result = recognizeLayerChannels(
      ['beauty_Red', 'beauty_GREEN', 'beauty_blue', 'beauty_Alpha'],
      { channelRecognitionNameRules: rules }
    );

    expect(result.candidates.find((candidate) => candidate.key === 'group:beauty')).toMatchObject({
      kind: 'componentGroup',
      channels: ['beauty_Red', 'beauty_GREEN', 'beauty_blue', 'beauty_Alpha']
    });
  });

  it('recognizes custom normal-map aliases after applying custom regexes', () => {
    const rules = createDefaultChannelRecognitionNameRules();
    rules['normal.map'] = {
      pattern: '^(?<base>.+)_(?:(?<x>[nN][xX])|(?<y>[nN][yY])|(?<z>[nN][zZ]))$'
    };

    const result = recognizeLayerChannels(
      ['surface_NX', 'surface_nY', 'surface_Nz'],
      { channelRecognitionNameRules: rules }
    );

    expect(result.candidates.find((candidate) => candidate.key === 'normalMap:surface')).toMatchObject({
      kind: 'normalMap',
      ruleId: 'normal.map',
      channels: ['surface_NX', 'surface_nY', 'surface_Nz'],
      selection: {
        kind: 'channelRgb',
        colorMapping: 'normalMap'
      }
    });
  });

  it('recognizes custom depth-map aliases after applying custom regexes', () => {
    const rules = createDefaultChannelRecognitionNameRules();
    rules['depth.map'] = {
      pattern: '^(?<depth>worldDepth)$'
    };
    const compiled = compileChannelRecognitionNameRules(rules);

    expect(parseDepthMapChannelNameWithRules('worldDepth', compiled)).toEqual({ channelName: 'worldDepth' });
    expect(parseDepthMapChannelNameWithRules('Z', compiled)).toBeNull();
  });

  it('validates regex syntax and required named captures without losing input', () => {
    expect(validateChannelRecognitionNameRule('spectral.series', {
      pattern: '^(?<series>.+)$'
    })).toEqual([
      {
        id: 'spectral.series',
        message: 'Add a named capture for (?<wavelength>...).'
      }
    ]);
    expect(validateChannelRecognitionNameRule('normal.map', {
      pattern: '^(?<base>.+)_(?<x>nx)$'
    })).toEqual([
      {
        id: 'normal.map',
        message: 'Add a named capture for (?<y>...).'
      },
      {
        id: 'normal.map',
        message: 'Add a named capture for (?<z>...).'
      }
    ]);
    expect(validateChannelRecognitionNameRule('depth.map', {
      pattern: '^(?<base>.+)$'
    })).toEqual([
      {
        id: 'depth.map',
        message: 'Add a named capture for (?<z>...) or (?<depth>...).'
      }
    ]);

    const invalid = cloneChannelRecognitionNameRules(createDefaultChannelRecognitionNameRules());
    invalid['component.rgb'] = {
      pattern: '(?<r>R'
    };
    const validation = validateChannelRecognitionNameRules(invalid);
    expect(validation.valid).toBe(false);
    expect(validation.issues.some((issue) => issue.id === 'component.rgb')).toBe(true);
  });

  it('round-trips valid custom rules through storage and ignores invalid stored rules', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => {
          store.set(key, value);
        },
        removeItem: (key: string) => {
          store.delete(key);
        }
      }
    });

    const rules = createDefaultChannelRecognitionNameRules();
    rules['mueller.scalar'] = {
      pattern: '^(?<element>[mM][0-3][0-3])(?:_(?<suffix>.+))?$'
    };

    store.set('prismifold:channel-recognition-name-rules:v1', JSON.stringify(rules));
    expect(readStoredChannelRecognitionNameRules()).toEqual(createDefaultChannelRecognitionNameRules());

    saveStoredChannelRecognitionNameRules(rules);
    expect(readStoredChannelRecognitionNameRules()).toEqual(rules);

    const legacyRules = { ...rules } as Record<string, unknown>;
    delete legacyRules['depth.map'];
    store.set(CHANNEL_RECOGNITION_NAME_RULES_STORAGE_KEY, JSON.stringify(legacyRules));
    expect(readStoredChannelRecognitionNameRules()).toEqual(rules);

    store.set(CHANNEL_RECOGNITION_NAME_RULES_STORAGE_KEY, JSON.stringify({
      ...rules,
      'mueller.scalar': {
        pattern: '('
      }
    }));
    expect(readStoredChannelRecognitionNameRules()).toEqual(createDefaultChannelRecognitionNameRules());
  });
});
