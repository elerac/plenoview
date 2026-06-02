export type ChannelRecognitionNameRuleId =
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
  | 'fallback.alphaCompanions';

export type ComponentNameRuleKind = 'rgb' | 'xyz' | 'uv';
export type ComponentNameRuleSlot = 'r' | 'g' | 'b' | 'x' | 'y' | 'z' | 'u' | 'v' | 'a';
export type NormalMapNameRuleComponent = 'x' | 'y' | 'z';
export type StokesNameRuleComponent = 'S0' | 'S1' | 'S2' | 'S3';
export type RgbNameRuleComponent = 'R' | 'G' | 'B';

export interface ChannelRecognitionNameRule {
  pattern: string;
}

export type ChannelRecognitionNameRules = Record<ChannelRecognitionNameRuleId, ChannelRecognitionNameRule>;

export interface ChannelRecognitionNameRuleDescriptor {
  id: ChannelRecognitionNameRuleId;
  label: string;
  hint: string;
  requiredCaptures: string[];
}

export interface ChannelRecognitionNameRuleValidationIssue {
  id: ChannelRecognitionNameRuleId;
  message: string;
}

export interface ChannelRecognitionNameRuleValidationResult {
  valid: boolean;
  issues: ChannelRecognitionNameRuleValidationIssue[];
}

export interface CompiledNameRule {
  source: ChannelRecognitionNameRule;
  regex: RegExp;
}

export interface CompiledChannelRecognitionNameRules {
  rules: Record<ChannelRecognitionNameRuleId, CompiledNameRule>;
}

export interface ParsedComponentChannelName {
  base: string;
  slot: ComponentNameRuleSlot;
}

export interface ParsedAlphaChannelName {
  base: string;
}

export interface ParsedNormalMapChannelName {
  base: string;
  component: NormalMapNameRuleComponent;
}

export interface ParsedDepthMapChannelName {
  channelName: string;
}

export interface ParsedSpectralChannelName {
  channelName: string;
  wavelength: number;
  seriesKey: string;
  seriesLabel: string;
}

export interface ParsedSpectralStokesChannelName {
  channelName: string;
  component: StokesNameRuleComponent;
  wavelength: number;
  suffix: string;
}

export interface ParsedScalarStokesChannelName {
  component: StokesNameRuleComponent;
  suffix: string | null;
}

export interface ParsedRgbStokesChannelName {
  component: StokesNameRuleComponent;
  rgb: RgbNameRuleComponent;
}

export interface ParsedMuellerMatrixChannelName {
  element: string;
  suffix: string | null;
}

export interface ParsedRgbMuellerMatrixChannelName {
  element: string;
  rgb: RgbNameRuleComponent;
}

export const CHANNEL_RECOGNITION_NAME_RULES_STORAGE_KEY = 'prismifold:channel-recognition-name-rules:v2';

export const CHANNEL_RECOGNITION_NAME_RULE_DESCRIPTORS: readonly ChannelRecognitionNameRuleDescriptor[] = [
  {
    id: 'component.rgb',
    label: 'RGB component groups',
    hint: 'Use named captures base, r, g, b, and a. Default matches R, G, B, A and layer.R style names.',
    requiredCaptures: ['r', 'g', 'b', 'a']
  },
  {
    id: 'component.xyz',
    label: 'XYZ component groups',
    hint: 'Use named captures base, x, y, z, and a.',
    requiredCaptures: ['x', 'y', 'z', 'a']
  },
  {
    id: 'component.uv',
    label: 'UV component groups',
    hint: 'Use named captures base, u, v, and a.',
    requiredCaptures: ['u', 'v', 'a']
  },
  {
    id: 'normal.map',
    label: 'Normal maps',
    hint: 'Use named captures x, y, z, and optional base.',
    requiredCaptures: ['x', 'y', 'z']
  },
  {
    id: 'depth.map',
    label: 'Depth maps',
    hint: 'Use z or depth named captures. Default matches Z and depth-like .Z channels.',
    requiredCaptures: ['z|depth']
  },
  {
    id: 'spectral.series',
    label: 'Spectral RGB series',
    hint: 'Use wavelength and optional series captures. Wavelength values may use decimal commas or points.',
    requiredCaptures: ['wavelength']
  },
  {
    id: 'stokes.scalar',
    label: 'Scalar Stokes',
    hint: 'Use one or more s0, s1, s2, s3 captures and optional suffix.',
    requiredCaptures: ['s0|s1|s2|s3']
  },
  {
    id: 'stokes.rgb',
    label: 'RGB Stokes',
    hint: 'Use one or more s0, s1, s2, s3 captures and one or more r, g, b captures.',
    requiredCaptures: ['s0|s1|s2|s3', 'r|g|b']
  },
  {
    id: 'stokes.spectral',
    label: 'Spectral Stokes',
    hint: 'Use one or more s0, s1, s2, s3 captures plus wavelength and optional suffix.',
    requiredCaptures: ['s0|s1|s2|s3', 'wavelength']
  },
  {
    id: 'mueller.scalar',
    label: 'Scalar Mueller matrices',
    hint: 'Use element and optional suffix captures. Element must resolve to M00 through M33.',
    requiredCaptures: ['element']
  },
  {
    id: 'mueller.rgb',
    label: 'RGB Mueller matrices',
    hint: 'Use element plus one or more r, g, b captures.',
    requiredCaptures: ['element', 'r|g|b']
  },
  {
    id: 'fallback.alphaCompanions',
    label: 'Alpha companions',
    hint: 'Use optional base plus a or alpha captures.',
    requiredCaptures: ['a|alpha']
  }
];

const CHANNEL_RECOGNITION_NAME_RULE_IDS = CHANNEL_RECOGNITION_NAME_RULE_DESCRIPTORS.map((descriptor) => descriptor.id);

const DEFAULT_CHANNEL_RECOGNITION_NAME_RULES: ChannelRecognitionNameRules = {
  'component.rgb': {
    pattern: '^(?:(?<base>.+)\\.)?(?:(?<r>R)|(?<g>G)|(?<b>B)|(?<a>A))$'
  },
  'component.xyz': {
    pattern: '^(?:(?<base>.+)\\.)?(?:(?<x>X)|(?<y>Y)|(?<z>Z)|(?<a>A))$'
  },
  'component.uv': {
    pattern: '^(?:(?<base>.+)\\.)?(?:(?<u>U)|(?<v>V)|(?<a>A))$'
  },
  'normal.map': {
    pattern: '^(?<base>N|normal|.+_normal)\\.(?:(?<x>X)|(?<y>Y)|(?<z>Z))$'
  },
  'depth.map': {
    pattern: '^(?:(?<z>Z)|(?<depth>.*[dD][eE][pP][tT][hH].*\\.Z))$'
  },
  'spectral.series': {
    pattern: '^(?![sS]4\\.)(?![sS][0-3]\\.\\d+\\.\\d+(?:[eE][-+]?\\d+)?[nN][mM]$)(?![tT]\\.\\d+\\.\\d+(?:[eE][-+]?\\d+)?[nN][mM]$)(?:(?<series>[sS][0-3]|[tT]|(?!(?:[sS][0-4]|[tT])\\.)[A-Za-z_][A-Za-z0-9_.-]*?)\\.|[A-Za-z_][A-Za-z0-9_-]*?(?=\\d))?(?<wavelength>\\d+(?:[.,]\\d+)?(?:[eE][-+]?\\d+)?)[nN][mM]$'
  },
  'stokes.scalar': {
    pattern: '^(?:(?<s0>[sS]0)|(?<s1>[sS]1)|(?<s2>[sS]2)|(?<s3>[sS]3))(?:\\.(?<suffix>.+))?$'
  },
  'stokes.rgb': {
    pattern: '^(?:(?<s0>[sS]0)|(?<s1>[sS]1)|(?<s2>[sS]2)|(?<s3>[sS]3))\\.(?:(?<r>[rR])|(?<g>[gG])|(?<b>[bB]))$'
  },
  'stokes.spectral': {
    pattern: '^(?:(?<s0>[sS]0)|(?<s1>[sS]1)|(?<s2>[sS]2)|(?<s3>[sS]3))\\.(?<wavelength>\\d+(?:[.,]\\d+)?(?:[eE][-+]?\\d+)?)[nN][mM]$'
  },
  'mueller.scalar': {
    pattern: '^(?<element>[mM][0-3][0-3])(?:\\.(?<suffix>.+))?$'
  },
  'mueller.rgb': {
    pattern: '^(?<element>[mM][0-3][0-3])\\.(?:(?<r>[rR])|(?<g>[gG])|(?<b>[bB]))$'
  },
  'fallback.alphaCompanions': {
    pattern: '^(?:(?<base>.+)\\.)?(?:(?<a>A)|(?<alpha>Alpha))$'
  }
};

export function createDefaultChannelRecognitionNameRules(): ChannelRecognitionNameRules {
  return cloneChannelRecognitionNameRules(DEFAULT_CHANNEL_RECOGNITION_NAME_RULES);
}

export function cloneChannelRecognitionNameRules(
  rules: ChannelRecognitionNameRules
): ChannelRecognitionNameRules {
  const next = {} as ChannelRecognitionNameRules;
  for (const id of CHANNEL_RECOGNITION_NAME_RULE_IDS) {
    const rule = rules[id] ?? DEFAULT_CHANNEL_RECOGNITION_NAME_RULES[id];
    next[id] = {
      pattern: rule.pattern
    };
  }
  return next;
}

export function normalizeChannelRecognitionNameRules(input: unknown): ChannelRecognitionNameRules {
  const defaults = createDefaultChannelRecognitionNameRules();
  const record = isRecord(input) ? input : {};

  for (const id of CHANNEL_RECOGNITION_NAME_RULE_IDS) {
    const value = record[id];
    if (!isRecord(value)) {
      continue;
    }

    const pattern = typeof value.pattern === 'string' ? value.pattern : defaults[id].pattern;
    defaults[id] = { pattern };
  }

  return defaults;
}

export function sameChannelRecognitionNameRules(
  a: ChannelRecognitionNameRules,
  b: ChannelRecognitionNameRules
): boolean {
  return CHANNEL_RECOGNITION_NAME_RULE_IDS.every((id) => (
    a[id].pattern === b[id].pattern
  ));
}

export function serializeChannelRecognitionNameRulesKey(rules: ChannelRecognitionNameRules): string {
  const normalized = normalizeChannelRecognitionNameRules(rules);
  return CHANNEL_RECOGNITION_NAME_RULE_IDS
    .map((id) => `${id}:${normalized[id].pattern}`)
    .join(',');
}

export function validateChannelRecognitionNameRules(
  input: unknown
): ChannelRecognitionNameRuleValidationResult {
  const rules = normalizeChannelRecognitionNameRules(input);
  const issues = CHANNEL_RECOGNITION_NAME_RULE_IDS.flatMap((id) => validateChannelRecognitionNameRule(id, rules[id]));
  return {
    valid: issues.length === 0,
    issues
  };
}

export function validateChannelRecognitionNameRule(
  id: ChannelRecognitionNameRuleId,
  rule: ChannelRecognitionNameRule
): ChannelRecognitionNameRuleValidationIssue[] {
  const issues: ChannelRecognitionNameRuleValidationIssue[] = [];
  const pattern = rule.pattern.trim();
  if (pattern.length === 0) {
    issues.push({ id, message: 'Enter a JavaScript regular expression pattern.' });
    return issues;
  }

  try {
    new RegExp(pattern);
  } catch (error) {
    issues.push({
      id,
      message: error instanceof Error ? error.message : 'Pattern is not a valid regular expression.'
    });
  }

  const groupNames = getNamedCaptureGroups(pattern);
  const descriptor = CHANNEL_RECOGNITION_NAME_RULE_DESCRIPTORS.find((item) => item.id === id);
  for (const required of descriptor?.requiredCaptures ?? []) {
    const alternatives = required.split('|');
    if (!alternatives.some((name) => groupNames.has(name))) {
      issues.push({
        id,
        message: `Add a named capture for ${alternatives.map((name) => `(?<${name}>...)`).join(' or ')}.`
      });
    }
  }

  return issues;
}

export function compileChannelRecognitionNameRules(
  input?: ChannelRecognitionNameRules
): CompiledChannelRecognitionNameRules {
  const rules = normalizeChannelRecognitionNameRules(input);
  const validation = validateChannelRecognitionNameRules(rules);
  const validRules = validation.valid ? rules : createDefaultChannelRecognitionNameRules();
  const compiled = {} as Record<ChannelRecognitionNameRuleId, CompiledNameRule>;
  for (const id of CHANNEL_RECOGNITION_NAME_RULE_IDS) {
    const rule = validRules[id];
    compiled[id] = {
      source: rule,
      regex: new RegExp(rule.pattern)
    };
  }
  return { rules: compiled };
}

export function readStoredChannelRecognitionNameRules(): ChannelRecognitionNameRules {
  if (typeof window === 'undefined') {
    return createDefaultChannelRecognitionNameRules();
  }

  try {
    const raw = window.localStorage.getItem(CHANNEL_RECOGNITION_NAME_RULES_STORAGE_KEY);
    if (raw === null) {
      return createDefaultChannelRecognitionNameRules();
    }

    const rules = normalizeChannelRecognitionNameRules(JSON.parse(raw));
    return validateChannelRecognitionNameRules(rules).valid
      ? rules
      : createDefaultChannelRecognitionNameRules();
  } catch {
    return createDefaultChannelRecognitionNameRules();
  }
}

export function saveStoredChannelRecognitionNameRules(rules: ChannelRecognitionNameRules): void {
  if (typeof window === 'undefined') {
    return;
  }

  const normalized = normalizeChannelRecognitionNameRules(rules);
  if (!validateChannelRecognitionNameRules(normalized).valid) {
    return;
  }

  try {
    if (sameChannelRecognitionNameRules(normalized, createDefaultChannelRecognitionNameRules())) {
      window.localStorage.removeItem(CHANNEL_RECOGNITION_NAME_RULES_STORAGE_KEY);
      return;
    }

    window.localStorage.setItem(
      CHANNEL_RECOGNITION_NAME_RULES_STORAGE_KEY,
      JSON.stringify(normalized)
    );
  } catch {
    // Storage can be unavailable in private contexts; keep the runtime setting anyway.
  }
}

export function parseComponentChannelNameWithRules(
  channelName: string,
  kind: ComponentNameRuleKind,
  compiled = compileChannelRecognitionNameRules()
): ParsedComponentChannelName | null {
  const id = getComponentRuleId(kind);
  const match = execNamedRule(compiled.rules[id], channelName);
  if (!match) {
    return null;
  }

  const slot = findCapturedSlot(match.groups, getComponentSlots(kind));
  if (!slot) {
    return null;
  }

  return {
    base: match.groups.base ?? '',
    slot
  };
}

export function parseAlphaChannelNameWithRules(
  channelName: string,
  compiled = compileChannelRecognitionNameRules()
): ParsedAlphaChannelName | null {
  const match = execNamedRule(compiled.rules['fallback.alphaCompanions'], channelName);
  if (!match || (!hasCapture(match.groups, 'a') && !hasCapture(match.groups, 'alpha'))) {
    return null;
  }

  return {
    base: match.groups.base ?? ''
  };
}

export function parseNormalMapChannelNameWithRules(
  channelName: string,
  compiled = compileChannelRecognitionNameRules()
): ParsedNormalMapChannelName | null {
  const match = execNamedRule(compiled.rules['normal.map'], channelName);
  if (!match) {
    return null;
  }

  const component = findCapturedSlot(match.groups, ['x', 'y', 'z'] as const);
  return component
    ? { base: match.groups.base ?? '', component }
    : null;
}

export function parseDepthMapChannelNameWithRules(
  channelName: string,
  compiled = compileChannelRecognitionNameRules()
): ParsedDepthMapChannelName | null {
  const match = execNamedRule(compiled.rules['depth.map'], channelName);
  if (!match || (!hasCapture(match.groups, 'z') && !hasCapture(match.groups, 'depth'))) {
    return null;
  }

  return { channelName };
}

export function parseSpectralChannelNameWithRules(
  channelName: string,
  compiled = compileChannelRecognitionNameRules()
): ParsedSpectralChannelName | null {
  const match = execNamedRule(compiled.rules['spectral.series'], channelName);
  if (!match) {
    return null;
  }

  const wavelength = parseWavelengthValue(match.groups.wavelength);
  if (wavelength === null) {
    return null;
  }

  const seriesLabel = match.groups.series ?? '';
  return {
    channelName,
    wavelength,
    seriesKey: seriesLabel,
    seriesLabel
  };
}

export function parseSpectralStokesChannelNameWithRules(
  channelName: string,
  compiled = compileChannelRecognitionNameRules()
): ParsedSpectralStokesChannelName | null {
  const match = execNamedRule(compiled.rules['stokes.spectral'], channelName);
  if (!match) {
    return null;
  }

  const component = findStokesComponent(match.groups);
  const wavelength = parseWavelengthValue(match.groups.wavelength);
  if (!component || wavelength === null) {
    return null;
  }

  return {
    channelName,
    component,
    wavelength,
    suffix: match.groups.suffix ?? `${match.groups.wavelength}nm`
  };
}

export function parseScalarStokesChannelNameWithRules(
  channelName: string,
  compiled = compileChannelRecognitionNameRules()
): ParsedScalarStokesChannelName | null {
  const match = execNamedRule(compiled.rules['stokes.scalar'], channelName);
  if (!match) {
    return null;
  }

  const component = findStokesComponent(match.groups);
  return component
    ? { component, suffix: match.groups.suffix ?? null }
    : null;
}

export function parseRgbStokesChannelNameWithRules(
  channelName: string,
  compiled = compileChannelRecognitionNameRules()
): ParsedRgbStokesChannelName | null {
  const match = execNamedRule(compiled.rules['stokes.rgb'], channelName);
  if (!match) {
    return null;
  }

  const component = findStokesComponent(match.groups);
  const rgb = findRgbComponent(match.groups);
  return component && rgb ? { component, rgb } : null;
}

export function parseMuellerMatrixChannelNameWithRules(
  channelName: string,
  compiled = compileChannelRecognitionNameRules()
): ParsedMuellerMatrixChannelName | null {
  const match = execNamedRule(compiled.rules['mueller.scalar'], channelName);
  if (!match) {
    return null;
  }

  const element = normalizeMuellerMatrixElement(match.groups.element);
  return element
    ? { element, suffix: match.groups.suffix ?? null }
    : null;
}

export function parseRgbMuellerMatrixChannelNameWithRules(
  channelName: string,
  compiled = compileChannelRecognitionNameRules()
): ParsedRgbMuellerMatrixChannelName | null {
  const match = execNamedRule(compiled.rules['mueller.rgb'], channelName);
  if (!match) {
    return null;
  }

  const element = normalizeMuellerMatrixElement(match.groups.element);
  const rgb = findRgbComponent(match.groups);
  return element && rgb ? { element, rgb } : null;
}

export function isDefaultChannelRecognitionNameRules(rules: ChannelRecognitionNameRules): boolean {
  return sameChannelRecognitionNameRules(rules, createDefaultChannelRecognitionNameRules());
}

function execNamedRule(
  rule: CompiledNameRule,
  value: string
): { groups: Record<string, string | undefined> } | null {
  rule.regex.lastIndex = 0;
  const match = rule.regex.exec(value);
  if (!match?.groups) {
    return null;
  }

  return { groups: match.groups };
}

function getNamedCaptureGroups(pattern: string): Set<string> {
  const groups = new Set<string>();
  for (const match of pattern.matchAll(/\(\?<([A-Za-z][A-Za-z0-9_]*)>/g)) {
    const name = match[1];
    if (name) {
      groups.add(name);
    }
  }
  return groups;
}

function getComponentRuleId(kind: ComponentNameRuleKind): Extract<ChannelRecognitionNameRuleId, `component.${string}`> {
  return `component.${kind}`;
}

function getComponentSlots(kind: ComponentNameRuleKind): ComponentNameRuleSlot[] {
  switch (kind) {
    case 'rgb':
      return ['r', 'g', 'b', 'a'];
    case 'xyz':
      return ['x', 'y', 'z', 'a'];
    case 'uv':
      return ['u', 'v', 'a'];
  }
}

function findCapturedSlot<T extends string>(
  groups: Record<string, string | undefined>,
  slots: readonly T[]
): T | null {
  return slots.find((slot) => hasCapture(groups, slot)) ?? null;
}

function findStokesComponent(groups: Record<string, string | undefined>): StokesNameRuleComponent | null {
  const component = findCapturedSlot(groups, ['s0', 's1', 's2', 's3'] as const);
  return component ? component.toUpperCase() as StokesNameRuleComponent : null;
}

function findRgbComponent(groups: Record<string, string | undefined>): RgbNameRuleComponent | null {
  const component = findCapturedSlot(groups, ['r', 'g', 'b'] as const);
  return component ? component.toUpperCase() as RgbNameRuleComponent : null;
}

function hasCapture(groups: Record<string, string | undefined>, name: string): boolean {
  return typeof groups[name] === 'string';
}

function parseWavelengthValue(value: string | undefined): number | null {
  if (!value) {
    return null;
  }

  const wavelength = Number(value.replace(',', '.'));
  return Number.isFinite(wavelength) ? wavelength : null;
}

function normalizeMuellerMatrixElement(value: string | undefined): string | null {
  const element = value?.toUpperCase() ?? '';
  return /^M[0-3][0-3]$/.test(element) ? element : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
