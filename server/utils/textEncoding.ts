const MOJIBAKE_MARKERS = ['Ã', 'â', '�', 'Â'];

function mojibakeScore(value: string): number {
  return MOJIBAKE_MARKERS.reduce((sum, marker) => sum + value.split(marker).length - 1, 0);
}

function commonReplacements(value: string): string {
  return value
    .replace(/â€“/g, '-')
    .replace(/â€”/g, '-')
    .replace(/â€˜|â€™/g, "'")
    .replace(/â€œ|â€/g, '"')
    .replace(/â€¦/g, '...')
    .replace(/Â /g, ' ')
    .replace(/\uFFFD/g, '');
}

export function looksLikeMojibake(value: string): boolean {
  return mojibakeScore(value) > 0;
}

export function repairMojibake(value: string): string {
  const input = commonReplacements(String(value || ''));
  if (!input) return input;

  const candidates = new Set<string>([input]);

  try {
    candidates.add(Buffer.from(input, 'latin1').toString('utf8'));
  } catch {
    // Ignore failed decode attempts.
  }

  try {
    candidates.add(Buffer.from(input, 'binary').toString('utf8'));
  } catch {
    // Ignore failed decode attempts.
  }

  let best = input;
  let bestScore = mojibakeScore(input);

  for (const candidate of candidates) {
    const normalized = commonReplacements(candidate).normalize('NFC');
    const score = mojibakeScore(normalized);
    if (score < bestScore) {
      best = normalized;
      bestScore = score;
    }
  }

  return best;
}

export function normalizeExternalText(value?: string | null): string | undefined {
  if (value == null) return undefined;
  const repaired = repairMojibake(value).replace(/\s+/g, ' ').trim();
  return repaired || undefined;
}

export function normalizeSearchToken(value?: string | null): string {
  const normalized = normalizeExternalText(value) || '';
  return normalized
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}
