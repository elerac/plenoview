export type ChannelRecognitionSettingId =
  | 'component.rgb'
  | 'component.xyz'
  | 'component.uv'
  | 'normal.map'
  | 'depth.map'
  | 'spectral.series'
  | 'stokes.scalar'
  | 'stokes.rgb'
  | 'stokes.spectral'
  | 'mueller.scalar'
  | 'mueller.rgb'
  | 'fallback.alphaCompanions'
  | 'fallback.singleChannel';

export type ChannelRecognitionSettings = Record<ChannelRecognitionSettingId, boolean>;

export interface ChannelRecognitionSettingDescriptor {
  id: ChannelRecognitionSettingId;
  label: string;
  defaultEnabled: boolean;
  mutable: boolean;
}

export const CHANNEL_RECOGNITION_SETTINGS_STORAGE_KEY = 'openexr-viewer:channel-recognition-settings:v1';

export const CHANNEL_RECOGNITION_SETTING_DESCRIPTORS: readonly ChannelRecognitionSettingDescriptor[] = [
  { id: 'component.rgb', label: 'RGB component groups', defaultEnabled: true, mutable: true },
  { id: 'component.xyz', label: 'XYZ component groups', defaultEnabled: true, mutable: true },
  { id: 'normal.map', label: 'Normal maps', defaultEnabled: true, mutable: true },
  { id: 'depth.map', label: 'Depth maps', defaultEnabled: true, mutable: true },
  { id: 'component.uv', label: 'UV component groups', defaultEnabled: true, mutable: true },
  { id: 'spectral.series', label: 'Spectral RGB series', defaultEnabled: true, mutable: true },
  { id: 'stokes.scalar', label: 'Scalar Stokes', defaultEnabled: true, mutable: true },
  { id: 'stokes.rgb', label: 'RGB Stokes', defaultEnabled: true, mutable: true },
  { id: 'stokes.spectral', label: 'Spectral Stokes', defaultEnabled: true, mutable: true },
  { id: 'mueller.scalar', label: 'Scalar Mueller matrices', defaultEnabled: true, mutable: true },
  { id: 'mueller.rgb', label: 'RGB Mueller matrices', defaultEnabled: true, mutable: true },
  { id: 'fallback.alphaCompanions', label: 'Alpha companions', defaultEnabled: true, mutable: true },
  { id: 'fallback.singleChannel', label: 'Single channels', defaultEnabled: true, mutable: false }
];

const CHANNEL_RECOGNITION_SETTING_IDS = CHANNEL_RECOGNITION_SETTING_DESCRIPTORS.map((descriptor) => descriptor.id);

export function createDefaultChannelRecognitionSettings(): ChannelRecognitionSettings {
  const settings = {} as ChannelRecognitionSettings;
  for (const descriptor of CHANNEL_RECOGNITION_SETTING_DESCRIPTORS) {
    settings[descriptor.id] = descriptor.defaultEnabled;
  }
  return settings;
}

export function cloneChannelRecognitionSettings(settings: ChannelRecognitionSettings): ChannelRecognitionSettings {
  return normalizeChannelRecognitionSettings(settings);
}

export function normalizeChannelRecognitionSettings(input: unknown): ChannelRecognitionSettings {
  const settings = createDefaultChannelRecognitionSettings();
  const record = isRecord(input) ? input : {};

  for (const descriptor of CHANNEL_RECOGNITION_SETTING_DESCRIPTORS) {
    if (!descriptor.mutable) {
      settings[descriptor.id] = descriptor.defaultEnabled;
      continue;
    }

    const value = record[descriptor.id];
    if (typeof value === 'boolean') {
      settings[descriptor.id] = value;
    }
  }

  return settings;
}

export function createChannelRecognitionSettingsFromLegacySpectralGrouping(enabled: boolean): ChannelRecognitionSettings {
  const settings = createDefaultChannelRecognitionSettings();
  if (!enabled) {
    settings['spectral.series'] = false;
    settings['stokes.spectral'] = false;
  }
  return settings;
}

export function deriveSpectralRgbGroupingEnabled(settings: ChannelRecognitionSettings): boolean {
  return settings['spectral.series'] !== false || settings['stokes.spectral'] !== false;
}

export function withChannelRecognitionSetting(
  settings: ChannelRecognitionSettings,
  id: ChannelRecognitionSettingId,
  enabled: boolean
): ChannelRecognitionSettings {
  const next = normalizeChannelRecognitionSettings(settings);
  const descriptor = CHANNEL_RECOGNITION_SETTING_DESCRIPTORS.find((item) => item.id === id);
  if (descriptor?.mutable) {
    next[id] = enabled;
  }
  return next;
}

export function sameChannelRecognitionSettings(
  a: ChannelRecognitionSettings,
  b: ChannelRecognitionSettings
): boolean {
  return CHANNEL_RECOGNITION_SETTING_IDS.every((id) => a[id] === b[id]);
}

export function serializeChannelRecognitionSettingsKey(settings: ChannelRecognitionSettings): string {
  const normalized = normalizeChannelRecognitionSettings(settings);
  return CHANNEL_RECOGNITION_SETTING_IDS
    .map((id) => `${id}:${normalized[id] ? '1' : '0'}`)
    .join(',');
}

export function readStoredChannelRecognitionSettings(options: {
  legacySpectralRgbGroupingEnabled?: boolean;
} = {}): ChannelRecognitionSettings {
  if (typeof window === 'undefined') {
    return createDefaultChannelRecognitionSettings();
  }

  try {
    const raw = window.localStorage.getItem(CHANNEL_RECOGNITION_SETTINGS_STORAGE_KEY);
    if (raw !== null) {
      return normalizeChannelRecognitionSettings(JSON.parse(raw));
    }
  } catch {
    return createDefaultChannelRecognitionSettings();
  }

  return options.legacySpectralRgbGroupingEnabled === false
    ? createChannelRecognitionSettingsFromLegacySpectralGrouping(false)
    : createDefaultChannelRecognitionSettings();
}

export function saveStoredChannelRecognitionSettings(settings: ChannelRecognitionSettings): void {
  if (typeof window === 'undefined') {
    return;
  }

  const normalized = normalizeChannelRecognitionSettings(settings);
  try {
    if (sameChannelRecognitionSettings(normalized, createDefaultChannelRecognitionSettings())) {
      window.localStorage.removeItem(CHANNEL_RECOGNITION_SETTINGS_STORAGE_KEY);
      return;
    }

    window.localStorage.setItem(
      CHANNEL_RECOGNITION_SETTINGS_STORAGE_KEY,
      JSON.stringify(serializeChannelRecognitionSettings(normalized))
    );
  } catch {
    // Storage can be unavailable in private contexts; keep the runtime setting anyway.
  }
}

function serializeChannelRecognitionSettings(settings: ChannelRecognitionSettings): ChannelRecognitionSettings {
  return normalizeChannelRecognitionSettings(settings);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
