import { describe, expect, it } from 'vitest';
import {
  buildDisplayAutoExposureRevisionKey,
  buildDisplayLuminanceRevisionKey,
  buildDisplayTextureRevisionKey
} from '../src/display/revision-keys';
import {
  createChannelMonoSelection,
  createChannelRgbSelection,
  createSpectralRgbSelection,
  createStokesSelection,
  createViewerState
} from './helpers/state-fixtures';

describe('display revision keys', () => {
  it('builds a stable revision key for display selection state', () => {
    expect(buildDisplayTextureRevisionKey({
      activeLayer: 0,
      displaySelection: createChannelRgbSelection('R', 'G', 'B')
    })).toBe('0:channelRgb:R:G:B:');

    expect(buildDisplayTextureRevisionKey({
      activeLayer: 1,
      displaySelection: createStokesSelection('aolp', 'stokesRgb', 'G')
    })).toBe('1:stokesAngle:aolp:rgbComponent:G:maskInvalidStokesVectors:true');

    expect(buildDisplayTextureRevisionKey({
      activeLayer: 2,
      displaySelection: createStokesSelection('dolp', 'stokesRgb'),
      visualizationMode: 'rgb'
    })).toBe('2:stokesScalar:dolp:rgbLuminance:rgb:maskInvalidStokesVectors:true');

    expect(buildDisplayTextureRevisionKey({
      activeLayer: 2,
      displaySelection: createStokesSelection('dolp', 'stokesRgb'),
      visualizationMode: 'colormap'
    })).toBe('2:stokesScalar:dolp:rgbLuminance:colormap:maskInvalidStokesVectors:true');

    expect(buildDisplayTextureRevisionKey({
      activeLayer: 2,
      displaySelection: createStokesSelection('dolp', 'stokesScalar', null, '500nm')
    })).toBe('2:stokesScalar:dolp:scalar:500nm:maskInvalidStokesVectors:true');

    expect(buildDisplayTextureRevisionKey({
      activeLayer: 3,
      displaySelection: createStokesSelection('s1_over_s0', 'stokesSpectralRgb'),
      visualizationMode: 'colormap'
    })).toBe('3:stokesScalar:s1_over_s0:spectralRgb:colormap:maskInvalidStokesVectors:true:spectralRgbGrouping:true');

    expect(buildDisplayTextureRevisionKey({
      activeLayer: 4,
      displaySelection: createSpectralRgbSelection('hoge')
    })).toBe('4:spectralRgb:hoge:spectralRgbGrouping:true');
  });

  it('builds luminance revision keys that ignore alpha-only channel changes', () => {
    expect(buildDisplayLuminanceRevisionKey({
      activeLayer: 0,
      displaySelection: createChannelRgbSelection('R', 'G', 'B', 'A')
    })).toBe('0:channelRgb:R:G:B');

    expect(buildDisplayLuminanceRevisionKey({
      activeLayer: 2,
      displaySelection: createChannelMonoSelection('Y', 'A')
    })).toBe('2:channelMono:Y');

    expect(buildDisplayLuminanceRevisionKey({
      activeLayer: 3,
      displaySelection: createStokesSelection('aolp', 'stokesRgb'),
      visualizationMode: 'rgb'
    })).toBe('3:stokesAngle:aolp:rgbLuminance:rgb:maskInvalidStokesVectors:true');

    expect(buildDisplayLuminanceRevisionKey({
      activeLayer: 3,
      displaySelection: createStokesSelection('aolp', 'stokesRgb'),
      visualizationMode: 'colormap'
    })).toBe('3:stokesAngle:aolp:rgbLuminance:colormap:maskInvalidStokesVectors:true');

    expect(buildDisplayLuminanceRevisionKey({
      activeLayer: 3,
      displaySelection: createStokesSelection('s1_over_s0', 'stokesSpectralRgb'),
      visualizationMode: 'rgb'
    })).toBe('3:stokesScalar:s1_over_s0:spectralRgb:rgb:maskInvalidStokesVectors:true:spectralRgbGrouping:true');

    expect(buildDisplayLuminanceRevisionKey({
      activeLayer: 4,
      displaySelection: createSpectralRgbSelection('hoge')
    })).toBe('4:spectralRgb:hoge:spectralRgbGrouping:true');
  });

  it('builds auto-exposure revision keys with rgb absolute max percentile context', () => {
    expect(buildDisplayAutoExposureRevisionKey({
      activeLayer: 0,
      displaySelection: createChannelRgbSelection('R', 'G', 'B')
    })).toBe('0:channelRgb:R:G:B::autoExposure:rgbAbsMax:p99.5');
  });

  it('includes Stokes invalid-vector masking in Stokes revision keys only', () => {
    expect(buildDisplayTextureRevisionKey({
      activeLayer: 1,
      displaySelection: createStokesSelection('dolp'),
      maskInvalidStokesVectors: false
    })).toBe('1:stokesScalar:dolp:scalar:maskInvalidStokesVectors:false');

    expect(buildDisplayTextureRevisionKey({
      activeLayer: 1,
      displaySelection: createChannelMonoSelection('Y'),
      maskInvalidStokesVectors: false
    })).toBe('1:channelMono:Y:');
  });

  it('includes spectral RGB grouping in spectral-derived revision keys only', () => {
    expect(buildDisplayTextureRevisionKey({
      activeLayer: 1,
      displaySelection: createSpectralRgbSelection(),
      spectralRgbGroupingEnabled: false
    })).toBe('1:spectralRgb::spectralRgbGrouping:false');

    expect(buildDisplayTextureRevisionKey({
      activeLayer: 1,
      displaySelection: createStokesSelection('s1_over_s0', 'stokesSpectralRgb'),
      spectralRgbGroupingEnabled: false
    })).toBe('1:stokesScalar:s1_over_s0:spectralRgb:rgb:maskInvalidStokesVectors:true:spectralRgbGrouping:false');

    expect(buildDisplayTextureRevisionKey({
      activeLayer: 1,
      displaySelection: createChannelMonoSelection('Y'),
      spectralRgbGroupingEnabled: false
    })).toBe('1:channelMono:Y:');
  });

  it('matches revision keys used by viewer state', () => {
    const state = createViewerState({
      activeLayer: 2,
      displaySelection: createChannelMonoSelection('Y', 'A')
    });

    expect(buildDisplayTextureRevisionKey(state)).toBe('2:channelMono:Y:A');
  });
});
