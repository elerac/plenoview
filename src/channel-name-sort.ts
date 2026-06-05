interface TextChannelNameSortToken {
  kind: 'text';
  value: string;
}

interface NumericChannelNameSortToken {
  kind: 'number';
  raw: string;
  value: number;
}

type ChannelNameSortToken = TextChannelNameSortToken | NumericChannelNameSortToken;

const NUMERIC_CHANNEL_NAME_TOKEN_PATTERN = /\d+(?:[.,]\d+)?(?:[eE][-+]?\d+)?/g;

export function compareChannelNamesNaturally(left: string, right: string): number {
  if (left === right) {
    return 0;
  }

  const leftTokens = tokenizeChannelNameForSort(left);
  const rightTokens = tokenizeChannelNameForSort(right);
  if (!leftTokens.hasNumericToken && !rightTokens.hasNumericToken) {
    return 0;
  }

  const tokenCount = Math.min(leftTokens.tokens.length, rightTokens.tokens.length);
  for (let index = 0; index < tokenCount; index += 1) {
    const leftToken = leftTokens.tokens[index];
    const rightToken = rightTokens.tokens[index];
    if (!leftToken || !rightToken) {
      continue;
    }

    const comparison = compareChannelNameSortTokens(leftToken, rightToken);
    if (comparison !== 0) {
      return comparison;
    }
  }

  return leftTokens.tokens.length - rightTokens.tokens.length;
}

export function hasNumericChannelNameToken(value: string): boolean {
  return tokenizeChannelNameForSort(value).hasNumericToken;
}

function tokenizeChannelNameForSort(value: string): {
  tokens: ChannelNameSortToken[];
  hasNumericToken: boolean;
} {
  const tokens: ChannelNameSortToken[] = [];
  let hasNumericToken = false;
  let offset = 0;

  for (const match of value.matchAll(NUMERIC_CHANNEL_NAME_TOKEN_PATTERN)) {
    const raw = match[0];
    const index = match.index ?? 0;
    if (index > offset) {
      tokens.push({ kind: 'text', value: value.slice(offset, index) });
    }

    const numericValue = Number(raw.replace(',', '.'));
    if (Number.isFinite(numericValue)) {
      tokens.push({ kind: 'number', raw, value: numericValue });
      hasNumericToken = true;
    } else {
      tokens.push({ kind: 'text', value: raw });
    }
    offset = index + raw.length;
  }

  if (offset < value.length) {
    tokens.push({ kind: 'text', value: value.slice(offset) });
  }

  return {
    tokens: tokens.length > 0 ? tokens : [{ kind: 'text', value }],
    hasNumericToken
  };
}

function compareChannelNameSortTokens(left: ChannelNameSortToken, right: ChannelNameSortToken): number {
  if (left.kind === 'number' && right.kind === 'number') {
    return left.value - right.value;
  }

  if (left.kind === 'text' && right.kind === 'text') {
    return left.value.localeCompare(right.value);
  }

  const leftValue = left.kind === 'number' ? left.raw : left.value;
  const rightValue = right.kind === 'number' ? right.raw : right.value;
  return leftValue.localeCompare(rightValue);
}
