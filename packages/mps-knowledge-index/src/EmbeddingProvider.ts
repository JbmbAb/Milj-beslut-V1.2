import { createHash } from 'node:crypto';

/**
 * The embedding-provider port for the knowledge index. Provider/model names are CONFIGURATION,
 * carried into every embedding identity (mps-embedding-identity), never authority. Two providers
 * whose binding differs in any of the four fields are incompatible and are never mixed in one index.
 */
export interface EmbeddingProviderBinding {
  readonly model_id: string;
  readonly model_version: string;
  readonly pipeline_version: string;
  readonly dimensions: number;
}

export interface KnowledgeEmbeddingProvider extends EmbeddingProviderBinding {
  embedDocuments(texts: readonly string[]): Promise<readonly (readonly number[])[]>;
  /** Query-side embedding; may differ from document embedding for asymmetric models. */
  embedQuery(text: string): Promise<readonly number[]>;
}

export class EmbeddingProviderError extends Error {
  constructor(
    readonly code:
      | 'EMBEDDING_BATCH_SIZE_MISMATCH'
      | 'EMBEDDING_DIMENSION_MISMATCH'
      | 'EMBEDDING_NOT_FINITE'
      | 'INDEX_MODEL_MISMATCH',
    message: string,
  ) {
    super(message);
    this.name = 'EmbeddingProviderError';
  }
}

export function bindingOf(provider: EmbeddingProviderBinding): EmbeddingProviderBinding {
  return Object.freeze({
    model_id: provider.model_id,
    model_version: provider.model_version,
    pipeline_version: provider.pipeline_version,
    dimensions: provider.dimensions,
  });
}

export function sameBinding(a: EmbeddingProviderBinding, b: EmbeddingProviderBinding): boolean {
  return (
    a.model_id === b.model_id &&
    a.model_version === b.model_version &&
    a.pipeline_version === b.pipeline_version &&
    a.dimensions === b.dimensions
  );
}

export function assertSameBinding(
  expected: EmbeddingProviderBinding,
  actual: EmbeddingProviderBinding,
  context: string,
): void {
  if (!sameBinding(expected, actual)) {
    throw new EmbeddingProviderError(
      'INDEX_MODEL_MISMATCH',
      `${context}: index is bound to ${describeBinding(expected)} but got ${describeBinding(actual)} — embeddings from incompatible models are never mixed`,
    );
  }
}

export function describeBinding(b: EmbeddingProviderBinding): string {
  return `${b.model_id}@${b.model_version}/${b.pipeline_version}/${b.dimensions}d`;
}

/** Fail closed on any shape defect: wrong count, wrong dimension, NaN/Infinity. Never pads, never truncates. */
export function assertVectorBatchShape(
  vectors: readonly (readonly number[])[],
  expectedCount: number,
  dimensions: number,
): void {
  if (vectors.length !== expectedCount) {
    throw new EmbeddingProviderError(
      'EMBEDDING_BATCH_SIZE_MISMATCH',
      `requested ${expectedCount} embeddings, provider returned ${vectors.length}`,
    );
  }
  for (let i = 0; i < vectors.length; i++) {
    const v = vectors[i]!;
    if (v.length !== dimensions) {
      throw new EmbeddingProviderError(
        'EMBEDDING_DIMENSION_MISMATCH',
        `embedding ${i} has ${v.length} dimensions, provider declares ${dimensions}`,
      );
    }
    for (let j = 0; j < v.length; j++) {
      if (!Number.isFinite(v[j]))
        throw new EmbeddingProviderError('EMBEDDING_NOT_FINITE', `embedding ${i}[${j}] is not finite`);
    }
  }
}

// Deliberately local (not imported from server/services/searchService.ts): packages must not depend on
// server code, and the fixture provider is the only consumer here.
export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length) {
    throw new EmbeddingProviderError(
      'EMBEDDING_DIMENSION_MISMATCH',
      `cannot compare ${a.length}d with ${b.length}d vectors`,
    );
  }
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export const FIXTURE_HASH_EMBEDDING_MODEL_ID = 'fixture-hash-embedding' as const;
export const FIXTURE_HASH_EMBEDDING_MODEL_VERSION = '1' as const;
export const FIXTURE_HASH_EMBEDDING_PIPELINE_VERSION = 'fixture-embed-pipeline-v1' as const;
export const FIXTURE_HASH_EMBEDDING_DEFAULT_DIMENSIONS = 512;

const TOKEN = /[\p{L}\p{N}]+/gu;
const SWEDISH_STOPWORDS = new Set([
  'och',
  'i',
  'att',
  'det',
  'som',
  'en',
  'på',
  'är',
  'av',
  'för',
  'med',
  'till',
  'den',
  'har',
  'de',
  'inte',
  'om',
  'ett',
  'kan',
  'eller',
  'ska',
  'vid',
  'från',
  'enligt',
  'samt',
  'denna',
  'detta',
  'dessa',
  'the',
  'of',
  'and',
  // question / function words that carry no evidence on their own
  'vad',
  'vilka',
  'vilken',
  'vilket',
  'hur',
  'när',
  'var',
  'vem',
  'varför',
  'får',
  'måste',
  'bör',
  'gäller',
  'finns',
  'ha',
  'sin',
  'sitt',
  'sina',
  'dess',
  'än',
  'så',
  'där',
  'här',
  'också',
  'även',
  'skall',
  'vara',
  'blir',
  'under',
  'över',
  'efter',
  'innan',
  'mellan',
  'utan',
  'genom',
  'mot',
  'hos',
  'inom',
]);

function fnv1a32(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

const SWEDISH_VOWELS = 'aeiouyäåö';
const STEM_STEP1_SUFFIXES = [
  'heterna',
  'hetens',
  'arnas',
  'ernas',
  'ornas',
  'heten',
  'heter',
  'anden',
  'andes',
  'andet',
  'arens',
  'arna',
  'erna',
  'orna',
  'ande',
  'arne',
  'aste',
  'aren',
  'ades',
  'erns',
  'ade',
  'are',
  'ern',
  'het',
  'ast',
  'ens',
  'ad',
  'en',
  'ar',
  'er',
  'or',
  'as',
  'es',
  'at',
  'a',
  'e',
] as const;
const STEM_VALID_S_ENDING = 'bcdfghjklmnoprtvy';
const STEM_STEP2_ENDINGS = ['dd', 'gd', 'nn', 'dt', 'gt', 'kt', 'tt'] as const;

/** Start of the Snowball R1 region (after the first non-vowel following a vowel; at least 3 letters before it). */
function snowballR1(word: string): number {
  let i = 0;
  while (i < word.length && !SWEDISH_VOWELS.includes(word[i]!)) i++;
  while (i < word.length && SWEDISH_VOWELS.includes(word[i]!)) i++;
  const r1 = i < word.length ? i + 1 : word.length;
  return Math.min(word.length, Math.max(3, r1));
}

/**
 * Snowball Swedish stemmer (Porter, snowballstem.org/algorithms/swedish/stemmer.html), verbatim
 * steps 1-3. Deterministic and purely lexical: it lets inflected forms of the same lemma share a
 * dimension (tillsyn/tillsynen, syfte/syftar, miljöbalken/miljöbalkens) without any language model.
 */
export function stemSwedish(word: string): string {
  let w = word;
  let r1 = snowballR1(w);
  // Step 1: longest suffix in R1 from list (a) is deleted; 's' is deleted only after a valid s-ending.
  let matched = false;
  for (const s of STEM_STEP1_SUFFIXES) {
    if (w.endsWith(s) && w.length - s.length >= r1) {
      w = w.slice(0, -s.length);
      matched = true;
      break;
    }
  }
  if (
    !matched &&
    w.endsWith('s') &&
    w.length - 1 >= r1 &&
    STEM_VALID_S_ENDING.includes(w[w.length - 2] ?? '')
  ) {
    w = w.slice(0, -1);
  }
  // Step 2: double-consonant endings in R1 lose their last letter.
  r1 = Math.min(r1, w.length);
  if (STEM_STEP2_ENDINGS.some((e) => w.endsWith(e)) && w.length - 2 >= r1) w = w.slice(0, -1);
  // Step 3: longest of lig/ig/els (delete), löst -> lös, fullt -> full, in R1.
  for (const [s, repl] of [
    ['fullt', 'full'],
    ['löst', 'lös'],
    ['lig', ''],
    ['els', ''],
    ['ig', ''],
  ] as const) {
    if (w.endsWith(s) && w.length - s.length >= r1) {
      w = w.slice(0, -s.length) + repl;
      break;
    }
  }
  return w;
}

export function tokenizeForFixtureEmbedding(text: string): readonly string[] {
  const tokens: string[] = [];
  for (const m of text.toLowerCase().matchAll(TOKEN)) {
    const t = m[0]!;
    if (t.length < 2 || SWEDISH_STOPWORDS.has(t)) continue;
    tokens.push(stemSwedish(t));
  }
  return tokens;
}

/**
 * Inverse-document-frequency table fitted on a corpus of texts. Deterministic given the texts;
 * its identity (a hash of the sorted vocabulary + document frequencies) becomes part of the
 * provider's `model_version`, so an index embedded under one table can never be silently searched
 * with vectors from another.
 */
export interface IdfTable {
  readonly document_count: number;
  readonly document_frequency: ReadonlyMap<string, number>;
  readonly identity: string;
}

export function fitIdfTable(texts: readonly string[]): IdfTable {
  const df = new Map<string, number>();
  for (const text of texts) {
    for (const term of new Set(tokenizeForFixtureEmbedding(text))) df.set(term, (df.get(term) ?? 0) + 1);
  }
  const identity = createHash('sha256')
    .update(
      // Codepoint order, never localeCompare: the table identity must not depend on the process ICU locale.
      JSON.stringify([
        texts.length,
        [...df.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)),
      ]),
      'utf8',
    )
    .digest('hex')
    .slice(0, 16);
  return Object.freeze({ document_count: texts.length, document_frequency: df, identity });
}

/**
 * ⚠️ FIXTURE PROVIDER — NOT A SEMANTIC MODEL. A deterministic bag-of-stems embedding (Snowball
 * Swedish stems, sublinear TF, optional IDF from a fitted table, L2 normalized). It exists so the
 * pipeline, the index read model and the golden eval are reproducible OFFLINE with no network, no
 * API key and no nondeterminism; retrieval quality with it is lexical. Its binding names it
 * honestly (`fixture-hash-embedding`, with the IDF table identity in `model_version`) and it can
 * never be confused with a production model in an embedding identity.
 */
export function createDeterministicHashEmbeddingProvider(
  options: { readonly dimensions?: number; readonly idf?: IdfTable } = {},
): KnowledgeEmbeddingProvider {
  const idf = options.idf;
  // EXACT-VOCABULARY MODE (idf given): every fitted term owns one dimension (sorted vocabulary,
  // deterministic), bucket 0 is reserved and never written. No hashing, so two texts share
  // similarity only through terms they actually share — the null floor for out-of-domain text is
  // exactly 0 and a degenerate 1-2 token fragment cannot collide its way to the top. Terms unseen
  // at fit time cannot match anything and are skipped (the table must be refitted when the corpus
  // changes; its identity is bound into model_version so a stale table is a model mismatch).
  // HASHED MODE (no idf): sign-hashed buckets, unigrams + bigrams, for small self-contained tests.
  const termIndex = idf
    ? new Map([...idf.document_frequency.keys()].sort().map((t, i) => [t, i + 1] as const))
    : undefined;
  const dimensions = termIndex
    ? termIndex.size + 1
    : (options.dimensions ?? FIXTURE_HASH_EMBEDDING_DEFAULT_DIMENSIONS);
  if (termIndex) {
    if (termIndex.size === 0)
      throw new Error('fixture embedding in exact-vocabulary mode needs a table with at least one term');
    if (options.dimensions !== undefined) {
      throw new Error(
        `fixture embedding in exact-vocabulary mode derives dimensions (${dimensions}) from the fitted table; do not pass dimensions`,
      );
    }
  } else if (!Number.isInteger(dimensions) || dimensions < 8) {
    throw new Error('fixture embedding needs an integer dimension >= 8');
  }
  const weightOf = (term: string): number => {
    if (!idf) return 1;
    const df = idf.document_frequency.get(term) ?? 0;
    return Math.log((idf.document_count + 1) / (df + 1)) + 1;
  };

  const embedOne = (text: string, side: 'document' | 'query'): readonly number[] => {
    const vector = new Array<number>(dimensions).fill(0);
    const tokens = tokenizeForFixtureEmbedding(text);
    const counts = new Map<string, number>();
    for (let i = 0; i < tokens.length; i++) {
      counts.set(tokens[i]!, (counts.get(tokens[i]!) ?? 0) + 1);
      if (!termIndex && i + 1 < tokens.length) {
        const bigram = `${tokens[i]}_${tokens[i + 1]}`;
        counts.set(bigram, (counts.get(bigram) ?? 0) + 0.5);
      }
    }
    for (const [term, count] of counts) {
      if (termIndex) {
        const index = termIndex.get(term);
        if (index === undefined) {
          // Out of vocabulary. Document side: cannot match anything, contributes nothing.
          // Query side (asymmetric by design): the term's mass goes into the reserved bucket 0,
          // which no document ever writes, so it can never match but DOES enter the query norm —
          // a query the corpus vocabulary mostly does not know is coverage-penalized instead of
          // scoring on the one token it happens to share with some chunk.
          if (side === 'query') vector[0]! += (1 + Math.log(count)) * weightOf(term);
          continue;
        }
        vector[index]! += (1 + Math.log(count)) * weightOf(term);
        continue;
      }
      const h = fnv1a32(term);
      const bucket = h % dimensions;
      const sign = (h >>> 16) & 1 ? 1 : -1;
      vector[bucket]! += sign * (1 + Math.log(count));
    }
    let norm = 0;
    for (const x of vector) norm += x * x;
    norm = Math.sqrt(norm);
    if (norm === 0) return Object.freeze(vector);
    return Object.freeze(vector.map((x) => x / norm));
  };

  return {
    model_id: FIXTURE_HASH_EMBEDDING_MODEL_ID,
    model_version: idf
      ? `${FIXTURE_HASH_EMBEDDING_MODEL_VERSION}+idf:${idf.identity}`
      : FIXTURE_HASH_EMBEDDING_MODEL_VERSION,
    pipeline_version: FIXTURE_HASH_EMBEDDING_PIPELINE_VERSION,
    dimensions,
    async embedDocuments(texts) {
      return Object.freeze(texts.map((t) => embedOne(t, 'document')));
    },
    async embedQuery(text) {
      return embedOne(text, 'query');
    },
  };
}

/** Stable identity of a provider binding for reports and snapshot hashing. */
export function bindingDigest(b: EmbeddingProviderBinding): string {
  return createHash('sha256').update(describeBinding(b), 'utf8').digest('hex');
}
