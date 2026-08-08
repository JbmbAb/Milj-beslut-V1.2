/**
 * Lightweight mojibake repair for text chunking (no server dependency).
 * Preserves \n\n paragraph boundaries.
 */

const MOJIBAKE_MARKERS = ["Ã", "â", "�", "Â"];

function mojibakeScore(value: string): number {
  return MOJIBAKE_MARKERS.reduce(
    (sum, marker) => sum + value.split(marker).length - 1,
    0,
  );
}

function commonReplacements(value: string): string {
  return value
    .replace(/â€“/g, "-")
    .replace(/â€”/g, "-")
    .replace(/â€˜|â€™/g, "'")
    .replace(/â€œ|â€/g, '"')
    .replace(/â€¦/g, "...")
    .replace(/Â /g, " ")
    .replace(/\uFFFD/g, "");
}

export function repairMojibake(value: string): string {
  const input = commonReplacements(String(value || ""));
  if (!input) return input;

  const candidates = new Set<string>([input]);
  try {
    candidates.add(Buffer.from(input, "latin1").toString("utf8"));
  } catch {
    /* ignore */
  }
  try {
    candidates.add(Buffer.from(input, "binary").toString("utf8"));
  } catch {
    /* ignore */
  }

  let best = input;
  let bestScore = mojibakeScore(input);
  for (const candidate of candidates) {
    const normalized = commonReplacements(candidate).normalize("NFC");
    const score = mojibakeScore(normalized);
    if (score < bestScore) {
      best = normalized;
      bestScore = score;
    }
  }
  return best;
}

export function sanitizeForChunking(text: string): string {
  return repairMojibake(text)
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n");
}
