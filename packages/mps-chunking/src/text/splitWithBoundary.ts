/** Max ~300 words per chunk for embeddings */
export const MAX_CHUNK_CHARS = 1500;
/** ~15% overlap */
export const OVERLAP_CHARS = 225;
export const MIN_CHUNK_CHARS = 20;

/**
 * Split long text with overlap, preferring paragraph / sentence / whitespace
 * boundaries near the limit (v2.3 — avoid mid-word cuts).
 */
export function splitWithBoundary(
  text: string,
  limit = MAX_CHUNK_CHARS,
  overlap = OVERLAP_CHARS,
): string[] {
  if (text.length <= limit) return [text];

  const parts: string[] = [];
  let start = 0;

  while (start < text.length) {
    const hardEnd = Math.min(text.length, start + limit);
    let end = hardEnd;

    if (hardEnd < text.length) {
      const window = text.slice(start, hardEnd);
      const paraBreak = window.lastIndexOf("\n\n");
      const sentBreak = Math.max(
        window.lastIndexOf(". "),
        window.lastIndexOf("! "),
        window.lastIndexOf("? "),
        window.lastIndexOf(".\n"),
      );
      const spaceBreak = window.lastIndexOf(" ");

      const minKeep = Math.floor(limit * 0.6);
      if (paraBreak >= minKeep) {
        end = start + paraBreak + 2;
      } else if (sentBreak >= minKeep) {
        end = start + sentBreak + 1;
      } else if (spaceBreak >= minKeep) {
        end = start + spaceBreak + 1;
      }
    }

    const slice = text.slice(start, end).trim();
    if (slice.length >= MIN_CHUNK_CHARS) {
      parts.push(slice);
    }

    if (end >= text.length) break;

    let nextStart = Math.max(0, end - overlap);
    // Snap forward to a word/line boundary so overlap does not start mid-word
    if (nextStart > 0 && nextStart < end) {
      const ch = text[nextStart];
      if (ch !== " " && ch !== "\n" && ch !== "\t") {
        const snapped = text.indexOf(" ", nextStart);
        const snappedNl = text.indexOf("\n", nextStart);
        let candidate = -1;
        if (snapped !== -1 && snapped < end) candidate = snapped;
        if (snappedNl !== -1 && snappedNl < end) {
          candidate =
            candidate === -1 ? snappedNl : Math.min(candidate, snappedNl);
        }
        if (candidate !== -1) {
          nextStart = candidate + 1;
        }
      } else {
        nextStart += 1; // skip the boundary char itself
      }
    }
    // Ensure forward progress
    start = nextStart <= start ? end : nextStart;
  }

  return parts;
}
