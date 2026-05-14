import { describe, expect, it } from 'vitest';
import {
  buildSpectralPlotPoints,
  detectSpectralChannels,
  parseSpectralChannel,
  parseSpectralChannelName
} from '../src/spectral';
import type { SpectralChannel } from '../src/spectral';

function summarizeChannels(channels: readonly SpectralChannel[]): Array<{
  channelName: string;
  wavelength: number;
  seriesKey: string;
  seriesLabel: string;
}> {
  return channels.map(({ channelName, wavelength, seriesKey, seriesLabel }) => ({
    channelName,
    wavelength,
    seriesKey,
    seriesLabel
  }));
}

describe('spectral channel helpers', () => {
  it('extracts wavelengths from bare, dotted-prefix, and attached-prefix channel names', () => {
    expect(parseSpectralChannelName('400nm')).toBe(400);
    expect(parseSpectralChannelName('HOGE.450nm')).toBe(450);
    expect(parseSpectralChannelName('FUGA500nm')).toBe(500);
    expect(parseSpectralChannelName('sensor.650.5nm')).toBe(650.5);
  });

  it('extracts wavelengths from JCGT spectral layer channel names', () => {
    expect(parseSpectralChannelName('S0.414nm')).toBe(414);
    expect(parseSpectralChannelName('S3.453nm')).toBe(453);
    expect(parseSpectralChannelName('T.560,5nm')).toBe(560.5);
    expect(parseSpectralChannelName('S2.4,14e2nm')).toBe(414);
  });

  it('extracts stable spectral series keys from channel prefixes', () => {
    expect(parseSpectralChannel('414nm')).toMatchObject({
      channelName: '414nm',
      wavelength: 414,
      seriesKey: '',
      seriesLabel: ''
    });
    expect(parseSpectralChannel('S0.414nm')).toMatchObject({
      channelName: 'S0.414nm',
      wavelength: 414,
      seriesKey: 'S0',
      seriesLabel: 'S0'
    });
    expect(parseSpectralChannel('hoge.414nm')).toMatchObject({
      channelName: 'hoge.414nm',
      wavelength: 414,
      seriesKey: 'hoge',
      seriesLabel: 'hoge'
    });
    expect(parseSpectralChannel('FUGA500nm')).toMatchObject({
      channelName: 'FUGA500nm',
      wavelength: 500,
      seriesKey: '',
      seriesLabel: ''
    });
  });

  it('rejects channel names without a numeric wavelength suffix', () => {
    expect(parseSpectralChannelName('400nm.foo')).toBeNull();
    expect(parseSpectralChannelName('400 um')).toBeNull();
    expect(parseSpectralChannelName('nm400')).toBeNull();
  });

  it('rejects malformed or non-nm JCGT spectral layer channel names', () => {
    expect(parseSpectralChannelName('S0.414m')).toBeNull();
    expect(parseSpectralChannelName('S0.414um')).toBeNull();
    expect(parseSpectralChannelName('S0.414Hz')).toBeNull();
    expect(parseSpectralChannelName('S4.414nm')).toBeNull();
    expect(parseSpectralChannelName('S0.414.5nm')).toBeNull();
  });

  it('detects only wavelength channels from mixed channel lists', () => {
    expect(summarizeChannels(detectSpectralChannels(['R', '400nm', 'mask', 'FUGA500nm']))).toEqual([
      { channelName: '400nm', wavelength: 400, seriesKey: '', seriesLabel: '' },
      { channelName: 'FUGA500nm', wavelength: 500, seriesKey: '', seriesLabel: '' }
    ]);
  });

  it('detects the selected JCGT spectral Stokes series', () => {
    expect(summarizeChannels(detectSpectralChannels([
      'S0.414nm', 'S1.414nm', 'S2.414nm', 'S3.414nm',
      'S0.453nm', 'S1.453nm', 'S2.453nm', 'S3.453nm'
    ], 'S1.414nm'))).toEqual([
      { channelName: 'S1.414nm', wavelength: 414, seriesKey: 'S1', seriesLabel: 'S1' },
      { channelName: 'S1.453nm', wavelength: 453, seriesKey: 'S1', seriesLabel: 'S1' }
    ]);
  });

  it('detects the selected arbitrary-prefix spectral series', () => {
    expect(summarizeChannels(detectSpectralChannels([
      'hoge.414nm',
      'fuga.414nm',
      'hoge.453nm',
      'fuga.453nm'
    ], 'fuga.414nm'))).toEqual([
      { channelName: 'fuga.414nm', wavelength: 414, seriesKey: 'fuga', seriesLabel: 'fuga' },
      { channelName: 'fuga.453nm', wavelength: 453, seriesKey: 'fuga', seriesLabel: 'fuga' }
    ]);
  });

  it('requires at least two wavelength channels to recognize a spectral layer', () => {
    expect(detectSpectralChannels(['400nm', 'R', 'G'])).toEqual([]);
    expect(detectSpectralChannels(['S0.414nm', 'S1.414nm'])).toEqual([]);
  });

  it('falls back to the largest valid spectral series, then first input order', () => {
    expect(summarizeChannels(detectSpectralChannels([
      'hoge.414nm',
      'fuga.414nm',
      'fuga.453nm',
      'hoge.453nm',
      'fuga.500nm'
    ], 'mask'))).toEqual([
      { channelName: 'fuga.414nm', wavelength: 414, seriesKey: 'fuga', seriesLabel: 'fuga' },
      { channelName: 'fuga.453nm', wavelength: 453, seriesKey: 'fuga', seriesLabel: 'fuga' },
      { channelName: 'fuga.500nm', wavelength: 500, seriesKey: 'fuga', seriesLabel: 'fuga' }
    ]);

    expect(summarizeChannels(detectSpectralChannels([
      'hoge.414nm',
      'fuga.414nm',
      'fuga.453nm',
      'hoge.453nm'
    ], 'mask'))).toEqual([
      { channelName: 'hoge.414nm', wavelength: 414, seriesKey: 'hoge', seriesLabel: 'hoge' },
      { channelName: 'hoge.453nm', wavelength: 453, seriesKey: 'hoge', seriesLabel: 'hoge' }
    ]);
  });

  it('sorts wavelengths numerically while preserving duplicate input order', () => {
    expect(summarizeChannels(detectSpectralChannels(['600nm', 'HOGE500nm', 'FUGA500nm', '400nm']))).toEqual([
      { channelName: '400nm', wavelength: 400, seriesKey: '', seriesLabel: '' },
      { channelName: 'HOGE500nm', wavelength: 500, seriesKey: '', seriesLabel: '' },
      { channelName: 'FUGA500nm', wavelength: 500, seriesKey: '', seriesLabel: '' },
      { channelName: '600nm', wavelength: 600, seriesKey: '', seriesLabel: '' }
    ]);
  });

  it('builds finite raw spectral plot points for a sampled pixel', () => {
    const channels = detectSpectralChannels(['400nm', '500nm', '600nm']);
    const points = buildSpectralPlotPoints({
      x: 1,
      y: 2,
      values: {
        '400nm': 0.25,
        '500nm': Number.NaN,
        '600nm': -0.5
      }
    }, channels);

    expect(points).toEqual([
      { channelName: '400nm', wavelength: 400, seriesKey: '', seriesLabel: '', intensity: 0.25 },
      { channelName: '600nm', wavelength: 600, seriesKey: '', seriesLabel: '', intensity: -0.5 }
    ]);
  });
});
