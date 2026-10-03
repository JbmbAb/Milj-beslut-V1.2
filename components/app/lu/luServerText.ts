/**
 * W-UI1 (C; owner decision 5, 2026-10-03) -- no internal terms in text a user sees. The UI shows some of the
 * server's Swedish texts as the server writes them (check rows, the overall line, evidence and root notes;
 * W-M2d items 1-2). Before they are shown, the terms that belong only under "Teknisk information" are taken
 * out: "CAS" (said as "arkivet"), a machine code in parentheses ("(EVIDENCE_NOT_FOUND)",
 * "(RECORD_INTEGRITY_ERROR: UNKNOWN_SEVERITY)"), a hash, a file path. The meaning of the sentence is kept;
 * the codes stay in the technical rows, which keep the server's text unchanged.
 *
 * Defence in depth: the server's own texts are being cleaned too (W-UI1 C); this keeps an older server's or a
 * missed text off the screen. Pure.
 */

/** A machine code in parentheses, optionally followed by ": details" (ids, more codes). */
const PARENTHESISED_CODE = /\s*\((?:[A-Z][A-Z0-9]*_[A-Z0-9_]+)(?:\s*[:,][^)]*)?\)/g;
/** A hex hash of 16 or more characters, with an optional "sha256:" prefix. */
const HASH = /\s*\b(?:sha256:)?[0-9a-f]{16,}\b/gi;
/** A Windows or POSIX path standing as a word of its own. */
const PATH = /\s*(?:\b[A-Za-z]:\\[^\s),;]+|(?<=^|\s)\/(?:[\w.-]+\/)+[\w.-]*)/g;

export function presentServerTextSv(text: string): string {
  return text
    .replace(PARENTHESISED_CODE, '')
    .replace(/\bur CAS\b/g, 'ur arkivet')
    .replace(/\bi CAS\b/g, 'i arkivet')
    .replace(/\bCAS\b/g, 'arkivet')
    .replace(HASH, '')
    .replace(PATH, '')
    .replace(/\s+([.,;:])/g, '$1')
    .replace(/ {2,}/g, ' ')
    .trim();
}

/** The same for an optional value: null and non-strings stay as they are. */
export function presentServerTextOrNull(value: string | null): string | null {
  return value === null ? null : presentServerTextSv(value);
}
