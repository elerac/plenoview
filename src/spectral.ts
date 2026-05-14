import type { PixelSample } from './types';

export interface SpectralChannel {
  channelName: string;
  wavelength: number;
  seriesKey: string;
  seriesLabel: string;
}

export interface SpectralPlotPoint extends SpectralChannel {
  intensity: number;
}

interface IndexedSpectralChannel extends SpectralChannel {
  index: number;
}

interface SpectralSeriesCandidate {
  key: string;
  channels: IndexedSpectralChannel[];
  firstIndex: number;
}

const DEFAULT_SPECTRAL_SERIES_LABEL = '';
const JCGT_SPECTRAL_CHANNEL_PATTERN = /^((?:S[0-3]|T))\.(\d+(?:,\d+)?(?:[eE][-+]?\d+)?)nm$/i;
const RESERVED_SPECTRAL_LAYER_PATTERN = /^(?:S[0-4]|T)\./i;
const SPECTRAL_CHANNEL_PATTERN = /(\d+(?:[.,]\d+)?(?:[eE][-+]?\d+)?)nm$/i;
const MIN_SPECTRAL_CHANNEL_COUNT = 2;

export function parseSpectralChannelName(channelName: string): number | null {
  return parseSpectralChannel(channelName)?.wavelength ?? null;
}

export function parseSpectralChannel(channelName: string): SpectralChannel | null {
  const jcgtMatch = channelName.match(JCGT_SPECTRAL_CHANNEL_PATTERN);
  if (jcgtMatch) {
    const wavelength = parseWavelengthValue(jcgtMatch[2]);
    if (wavelength === null) {
      return null;
    }

    const seriesLabel = jcgtMatch[1] ?? DEFAULT_SPECTRAL_SERIES_LABEL;
    return {
      channelName,
      wavelength,
      seriesKey: seriesLabel,
      seriesLabel
    };
  }

  if (RESERVED_SPECTRAL_LAYER_PATTERN.test(channelName)) {
    return null;
  }

  const match = channelName.match(SPECTRAL_CHANNEL_PATTERN);
  if (!match) {
    return null;
  }

  const wavelength = parseWavelengthValue(match[1]);
  if (wavelength === null) {
    return null;
  }

  const prefix = channelName.slice(0, match.index ?? 0);
  const seriesLabel = prefix.endsWith('.') && prefix.length > 1
    ? prefix.slice(0, -1)
    : DEFAULT_SPECTRAL_SERIES_LABEL;

  return {
    channelName,
    wavelength,
    seriesKey: seriesLabel,
    seriesLabel
  };
}

function parseWavelengthValue(value: string | undefined): number | null {
  if (!value) {
    return null;
  }

  const wavelength = Number(value.replace(',', '.'));
  return Number.isFinite(wavelength) ? wavelength : null;
}

export function detectSpectralChannels(
  channelNames: string[],
  preferredChannelName: string | null = null
): SpectralChannel[] {
  const channels = channelNames
    .map((channelName, index) => {
      const parsed = parseSpectralChannel(channelName);
      return parsed ? { ...parsed, index } : null;
    })
    .filter((channel): channel is IndexedSpectralChannel => channel !== null);

  const series = buildSpectralSeriesCandidates(channels)
    .filter((candidate) => candidate.channels.length >= MIN_SPECTRAL_CHANNEL_COUNT);
  if (series.length === 0) {
    return [];
  }

  const preferredSeriesKey = preferredChannelName
    ? parseSpectralChannel(preferredChannelName)?.seriesKey ?? null
    : null;
  const preferredSeries = preferredSeriesKey === null
    ? null
    : series.find((candidate) => candidate.key === preferredSeriesKey) ?? null;
  const selectedSeries = preferredSeries ?? [...series].sort(compareSpectralSeriesCandidates)[0];
  if (!selectedSeries) {
    return [];
  }

  return selectedSeries.channels
    .sort((a, b) => a.wavelength - b.wavelength || a.index - b.index)
    .map(({ channelName, wavelength, seriesKey, seriesLabel }) => ({
      channelName,
      wavelength,
      seriesKey,
      seriesLabel
    }));
}

function buildSpectralSeriesCandidates(channels: IndexedSpectralChannel[]): SpectralSeriesCandidate[] {
  const seriesByKey = new Map<string, SpectralSeriesCandidate>();
  for (const channel of channels) {
    const candidate = seriesByKey.get(channel.seriesKey);
    if (candidate) {
      candidate.channels.push(channel);
      candidate.firstIndex = Math.min(candidate.firstIndex, channel.index);
      continue;
    }

    seriesByKey.set(channel.seriesKey, {
      key: channel.seriesKey,
      channels: [channel],
      firstIndex: channel.index
    });
  }

  return [...seriesByKey.values()];
}

function compareSpectralSeriesCandidates(a: SpectralSeriesCandidate, b: SpectralSeriesCandidate): number {
  return b.channels.length - a.channels.length || a.firstIndex - b.firstIndex;
}

export function buildSpectralPlotPoints(
  sample: PixelSample | null,
  channels: readonly SpectralChannel[]
): SpectralPlotPoint[] {
  if (!sample) {
    return [];
  }

  return channels
    .map((channel) => ({
      ...channel,
      intensity: sample.values[channel.channelName]
    }))
    .filter((point): point is SpectralPlotPoint => Number.isFinite(point.intensity));
}
