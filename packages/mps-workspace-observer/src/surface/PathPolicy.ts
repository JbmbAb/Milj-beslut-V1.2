/**
 * WORKSPACE-LIFECYCLE-CONTROLLER-V1 — path construction, comparison and case identity.
 *
 * Every rule here is transcribed from the frozen command surface
 * (workspace-observer-command-surface-v1.json, commandSurfaceDigest
 * d1213675fcf2b945ea74a189eac7ede88ebf4474402b591e5730728698b6f642) rather than invented, and each
 * one is digest-covered on the Phase 0 side: path spelling is the replay lookup key, so two
 * implementations that disagree by one separator produce a corpus miss rather than a wrong answer.
 *
 * The reason these are their own module with their own tests: `node:path` is the obvious thing to
 * reach for and it is wrong here. `path.join` normalises, collapses `..`, and rewrites separators.
 * The frozen policy does none of that — it concatenates literally, because a path derived from git
 * output keeps git's own forward slashes verbatim and must still hash to the recorded spelling.
 */
import { createHash } from 'node:crypto';

/**
 * pathConstructionPolicy LITERAL_BACKSLASH_CONCATENATION_V1.
 *
 * join(a, b) = a + '\' + b, except that when `a` already ends with '/' or '\' no separator is
 * added. No normalisation, no realpath resolution, no separator conversion, no '..' collapsing,
 * no case change.
 */
export function joinPath(a: string, b: string): string {
  if (a.endsWith('/') || a.endsWith('\\')) return a + b;
  return `${a}\\${b}`;
}

/**
 * pathComparisonPolicy WINDOWS_CASE_INSENSITIVE_SLASH_NORMALIZED_V1.
 *
 * key(path) = path with every '\' replaced by '/', then trailing '/' characters removed while the
 * result is longer than 3 characters, then lower-cased with String.prototype.toLowerCase.
 *
 * This is simple lowercasing, NOT Unicode case folding, and there is no Unicode normalisation, no
 * realpath resolution, no drive-letter expansion and no '..' collapsing. The 3-character floor is
 * what keeps a drive root spelled `C:/` from collapsing to `C:`.
 */
export function comparisonKey(path: string): string {
  let key = path.replace(/\\/g, '/');
  while (key.length > 3 && key.endsWith('/')) key = key.slice(0, -1);
  return key.toLowerCase();
}

/**
 * Whether a recorded path is already absolute, so the caller knows whether to resolve it.
 *
 * Three shapes count: a drive-letter path in either separator, a UNC path, and a POSIX root. The
 * last one matters here — the frozen corpus contains `/sessions/...` and `/tmp/...` spellings from
 * a Linux container, and treating those as relative would resolve them against the Windows repo
 * root and produce a path that names nothing.
 */
export function isAbsolutePath(p: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(p) || p.startsWith('\\\\') || p.startsWith('/');
}

/**
 * R-F-04 parentOfRule.
 *
 * parentOf(p) = p with one trailing separator-plus-'.git' segment removed, matching
 * /[\\/]\.git[\\/]?$/ with a single replacement. When `p` has no such suffix the result is
 * undefined, and the caller must record that as a declared non-attempt rather than fall back to a
 * duplicate observation of the target.
 */
export function parentOfGitDir(p: string): string | undefined {
  const re = /[\\/]\.git[\\/]?$/;
  if (!re.test(p)) return undefined;
  return p.replace(re, '');
}

/**
 * candidateExpansion.caseIdRule.
 *
 * caseId = 'ws-' + slug + '-' + the first 8 lowercase hex characters of SHA-256 over the UTF-8
 * bytes of the comparison key, where slug = the comparison key with every character outside
 * [a-z0-9] replaced by '-', runs of '-' collapsed to one, leading and trailing '-' removed,
 * truncated to 48 characters, and any trailing '-' removed again.
 *
 * The identity depends only on the comparison key, which is source-invariant. That is the property
 * that matters: adding or removing a discovery source that names the same directory cannot re-key
 * an expectation, so the frozen facit stays addressable.
 */
export function caseIdFromComparisonKey(key: string): string {
  let slug = key.replace(/[^a-z0-9]/g, '-');
  slug = slug.replace(/-+/g, '-');
  slug = slug.replace(/^-+/, '').replace(/-+$/, '');
  slug = slug.slice(0, 48);
  slug = slug.replace(/-+$/, '');
  const hash = createHash('sha256').update(Buffer.from(key, 'utf8')).digest('hex').slice(0, 8);
  return `ws-${slug}-${hash}`;
}

/** Discovery sources S1-S4 of candidateExpansion, in the surface's own declaration order. */
export type CandidateSource = 'S1' | 'S2' | 'S3' | 'S4';

export interface CandidateSpelling {
  readonly source: CandidateSource;
  readonly path: string;
}

/**
 * candidatePathSpellingsRule: sorted by source priority (S3, then S1, then S2, then S4) and,
 * within a source, by path ascending under the ECMAScript default string comparator. Exact
 * (source, path) duplicates are removed, keeping the first.
 *
 * Filesystem discovery (S3) wins over git's forward-slash spelling, which wins over a derived
 * gitdir parent, which wins over a branch binding. That order is not aesthetic: preferredSpelling
 * is substituted into `-C <candidatePath>` and is therefore part of the replay key.
 */
const SOURCE_PRIORITY: Readonly<Record<CandidateSource, number>> = Object.freeze({
  S3: 0,
  S1: 1,
  S2: 2,
  S4: 3,
});

export function sortCandidateSpellings(
  spellings: readonly CandidateSpelling[],
): readonly CandidateSpelling[] {
  const seen = new Set<string>();
  const deduped: CandidateSpelling[] = [];
  const sorted = [...spellings].sort((a, b) => {
    const bySource = SOURCE_PRIORITY[a.source] - SOURCE_PRIORITY[b.source];
    if (bySource !== 0) return bySource;
    // The ECMAScript default comparator: UTF-16 code-unit order, not localeCompare.
    if (a.path < b.path) return -1;
    if (a.path > b.path) return 1;
    return 0;
  });
  for (const s of sorted) {
    const k = `${s.source}\u0000${s.path}`;
    if (seen.has(k)) continue;
    seen.add(k);
    deduped.push(s);
  }
  return Object.freeze(deduped);
}

/** preferredSpellingRule: the path of the first entry of the sorted spellings list. */
export function preferredSpelling(spellings: readonly CandidateSpelling[]): string {
  const sorted = sortCandidateSpellings(spellings);
  if (sorted.length === 0) throw new Error('a candidate must have at least one spelling');
  return sorted[0].path;
}
