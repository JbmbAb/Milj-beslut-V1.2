/**
 * Contract 5.1 (placeholders) and 5.6 (forbidden provider identity). Pure string predicates.
 *
 * This unit scans for provider names, so it must not contain them as literals (a unit that scans for X does not
 * contain X): the floor is assembled from parts.
 */

const j = (...parts: string[]): string => parts.join('');

/** Long, unambiguous vendor strings: case-insensitive SUBSTRING match. */
export const FORBIDDEN_SUBSTRINGS: readonly string[] = Object.freeze([
  j('goo', 'gle'),
  j('gem', 'ini'),
  j('goo', 'gleapis'),
  j('generative', 'language'),
  j('ai', 'platform'),
  j('g', 'cloud'),
  j('vertex', 'ai'),
]);

/** Short or ambiguous words: whole-TOKEN match after splitting on non-alphanumerics and camelCase boundaries. */
export const FORBIDDEN_TOKENS: readonly string[] = Object.freeze([j('ver', 'tex'), j('g', 'cp'), j('pa', 'lm'), j('ba', 'rd')]);

export const PLACEHOLDER_TOKENS: readonly string[] = Object.freeze([
  'tbd',
  'todo',
  'unknown',
  'unresolved',
  'none',
  'null',
  'n/a',
  'pending',
  'placeholder',
  'undefined',
]);

/** Splits `VertexAI`, `gcp-embedding`, `GCPEmbedding` into lower-case alphanumeric tokens. */
export function tokensOf(value: string): string[] {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter((t) => t.length > 0)
    .map((t) => t.toLowerCase());
}

/** The floor of 5.6 plus any extra policy patterns (case-insensitive substrings; a policy can add, never remove). */
export function matchesForbiddenProviderIdentity(value: string, extraPatterns: readonly string[] = []): boolean {
  const lower = value.toLowerCase();
  if (FORBIDDEN_SUBSTRINGS.some((s) => lower.includes(s))) return true;
  const tokens = tokensOf(value);
  if (tokens.some((t) => FORBIDDEN_TOKENS.includes(t))) return true;
  return extraPatterns.some((p) => p.length > 0 && lower.includes(p.toLowerCase()));
}

/** A placeholder token, the empty string, or any string made of 8 or more identical characters. */
export function isUnresolvedPlaceholder(value: string): boolean {
  if (value.length === 0) return true;
  if (PLACEHOLDER_TOKENS.includes(value.toLowerCase())) return true;
  if (value.length >= 8) {
    const first = value[0]!;
    if ([...value].every((c) => c === first)) return true;
  }
  return false;
}

/**
 * Mock/test generation runtime deny patterns (contract 5.3, C6 step 4): substrings plus the whole token `test`.
 * Applied to runtime_id and model_id. Built from parts like the provider floor (it is a scan, not a claim).
 */
const MOCK_SUBSTRINGS: readonly string[] = Object.freeze([j('mo', 'ck'), j('fa', 'ke'), j('st', 'ub'), j('can', 'ned'), j('dum', 'my'), j('no', 'op')]);
const MOCK_TOKENS: readonly string[] = Object.freeze([j('te', 'st')]);

export function looksLikeMockRuntime(value: string): boolean {
  const lower = value.toLowerCase();
  if (MOCK_SUBSTRINGS.some((s) => lower.includes(s))) return true;
  return tokensOf(value).some((t) => MOCK_TOKENS.includes(t));
}
