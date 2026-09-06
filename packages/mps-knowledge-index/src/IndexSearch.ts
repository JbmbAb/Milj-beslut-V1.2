import {
  codepointCompare,
  DOCUMENT_ROLES,
  type CurrencyMethod,
  type CurrencyReason,
  type DocumentRole,
  type RoleDerivationMethod,
} from '@miljobeslut/mps-knowledge-corpus';
import type { ChunkStructureKind } from '@miljobeslut/mps-legal-corpus';
import {
  buildRetrievalResult,
  createInMemoryGovernedChunkLookup,
  type RetrievalResultFields,
} from '@miljobeslut/mps-legal-retrieval-contract';
import { evaluateLegalRetrieval } from '@miljobeslut/mps-retrieval-governance';
import {
  createRetrievalExecutionTrace,
  hashQuery as hashQueryForPolicy,
  type RetrievalExecutionTraceArtifact,
} from '@miljobeslut/mps-retrieval-trace';

import { assertSameBinding, cosineSimilarity, type KnowledgeEmbeddingProvider } from './EmbeddingProvider';
import {
  chunkContentHash,
  expectedIndexRow,
  isValidVector,
  rowDifferences,
  stripVector,
  type GovernedEntry,
  type GovernedKnowledgeLookup,
  type IndexRow,
  type KnowledgeIndexProjection,
} from './IndexProjection';
import { KNOWLEDGE_INDEX_BUDGET_PROFILE, KNOWLEDGE_SEARCH_VERSION } from './versions';

/**
 * Metadata narrowing + semantic ranking over the index read model, RESOLVED AGAINST THE GOVERNED
 * CORPUS. Every filter is an EXACT, structural comparison on a typed field — validated at runtime
 * into a plain, frozen copy that is the ONLY object applied (a getter, proxy, inherited or
 * non-enumerable property can neither pass validation with one value and apply with another, nor
 * vanish between the two); a malformed filter or request is refused, never widened. Unrestricted
 * nearest-neighbor over the whole corpus is the explicit `filters: {}` case.
 *
 * Every hit is cross-checked column-by-column against the governed chunk/document it claims
 * (`expectedIndexRow`) before it is served, and its provenance is taken from the GOVERNED side.
 * A candidate that cannot be scored (non-finite score) or that duplicates another candidate's
 * identity is a corrupt read model: the search fails closed instead of silently mis-ranking.
 */
export interface RetrievalFilters {
  readonly source_ids?: readonly string[];
  readonly roles?: readonly DocumentRole[];
  readonly structure_kinds?: readonly ChunkStructureKind[];
  readonly document_ids?: readonly string[];
  readonly canonical_record_keys?: readonly string[];
  /** `current` = only the current version of each lineage (DERIVED currency); a label = exactly that declared version. */
  readonly version?: 'any' | 'current' | { readonly source_version_label: string };
  readonly chapter?: string;
  readonly court_sections?: readonly string[];
  readonly evidence_anchors?: readonly string[];
}

export interface KnowledgeSearchRequest {
  readonly query: string;
  readonly filters?: RetrievalFilters;
  readonly top_k?: number;
  /** Below this cosine score the top hit is not evidence: the search abstains with NO_EVIDENCE. */
  readonly abstain_below_score?: number;
}

export class KnowledgeSearchError extends Error {
  constructor(
    readonly code:
      | 'REJECT_FILTERS'
      | 'REJECT_REQUEST'
      | 'CORPUS_SNAPSHOT_MISMATCH'
      | 'INDEX_ROW_CORRUPT'
      | 'REJECT_QUERY_EMBEDDING',
    message: string,
  ) {
    super(message);
    this.name = 'KnowledgeSearchError';
  }
}

/** Provenance of a hit, taken from the governed document — not from the index row. */
export interface ProvenanceResolution {
  readonly document_id: string;
  readonly canonical_record_key: string;
  readonly source_id: string;
  readonly registry_artifact_id: string;
  readonly registry_source_content_hash: string;
  readonly catalog_origin: string;
  readonly text_projection_id: string;
  readonly fragment_id: string;
  readonly chunk_content_hash: string;
  readonly role: DocumentRole;
  readonly role_method: RoleDerivationMethod;
  readonly version_lineage_key: string | null;
  readonly is_current: boolean;
  readonly currency_method: CurrencyMethod;
  readonly currency_reason: CurrencyReason;
}

export interface KnowledgeRetrievalHit {
  readonly result: RetrievalResultFields;
  readonly row: IndexRow;
  readonly provenance: ProvenanceResolution;
  readonly score: number;
}

export interface KnowledgeSearchOutcome {
  readonly kind: 'RESULTS' | 'NO_EVIDENCE';
  readonly search_version: typeof KNOWLEDGE_SEARCH_VERSION;
  readonly query_hash: string;
  readonly candidate_count: number;
  readonly hits: readonly KnowledgeRetrievalHit[];
  readonly trace: RetrievalExecutionTraceArtifact;
  readonly applied_filters: RetrievalFilters;
  readonly abstain_below_score: number;
}

/** The retrieval-trace package's convention: sha256 over canonical {intent, policy_version}. */
export function queryHash(query: string, policyVersion: string): string {
  return hashQueryForPolicy(query, policyVersion);
}

const FILTER_KEYS = [
  'source_ids',
  'roles',
  'structure_kinds',
  'document_ids',
  'canonical_record_keys',
  'version',
  'chapter',
  'court_sections',
  'evidence_anchors',
] as const;
const STRING_ARRAY_KEYS = [
  'source_ids',
  'document_ids',
  'canonical_record_keys',
  'court_sections',
  'evidence_anchors',
] as const;
const STRUCTURE_KINDS: readonly string[] = ['law', 'court', 'evidence', 'standard'];

function reject(detail: string): never {
  throw new KnowledgeSearchError('REJECT_FILTERS', detail);
}

/** Reads `key` ONCE and returns a frozen plain copy of a non-empty-string array, or rejects. */
function stringArray(value: unknown, key: string): readonly string[] {
  if (!Array.isArray(value) || value.length === 0)
    reject(`filter '${key}' must be a non-empty array of non-empty strings`);
  const copy: string[] = [];
  for (let i = 0; i < value.length; i++) {
    const x: unknown = value[i];
    if (typeof x !== 'string' || x.length === 0) reject(`filter '${key}'[${i}] must be a non-empty string`);
    copy.push(x);
  }
  return Object.freeze(copy);
}

/**
 * Refuses anything that is not a well-formed RetrievalFilters value and returns a NEW plain frozen
 * object holding only the validated values: the applied filter can never differ from the validated
 * one. Own, inherited, non-enumerable and getter-backed keys are all read exactly once through the
 * same accessor; any key outside the known set (own or inherited, enumerable or not) is refused.
 */
export function validateFilters(filters: unknown): RetrievalFilters {
  if (filters === undefined) return Object.freeze({});
  if (filters === null || typeof filters !== 'object' || Array.isArray(filters))
    reject('filters must be a plain object');
  const known = new Set<string>(FILTER_KEYS);
  for (let o: object | null = filters; o !== null && o !== Object.prototype; o = Object.getPrototypeOf(o)) {
    for (const key of Reflect.ownKeys(o)) {
      if (typeof key !== 'string' || !known.has(key)) reject(`unknown filter '${String(key)}'`);
    }
  }
  const f = filters as Record<string, unknown>;
  const clean: Record<string, unknown> = {};
  for (const key of STRING_ARRAY_KEYS) {
    const value: unknown = f[key];
    if (value !== undefined) clean[key] = stringArray(value, key);
  }
  const roles: unknown = f.roles;
  if (roles !== undefined) {
    const list = stringArray(roles, 'roles');
    for (const r of list)
      if (!(DOCUMENT_ROLES as readonly string[]).includes(r))
        reject(`filter 'roles' contains an unknown role '${r}'`);
    clean.roles = list;
  }
  const kinds: unknown = f.structure_kinds;
  if (kinds !== undefined) {
    const list = stringArray(kinds, 'structure_kinds');
    for (const k of list)
      if (!STRUCTURE_KINDS.includes(k)) reject(`filter 'structure_kinds' contains an unknown kind '${k}'`);
    clean.structure_kinds = list;
  }
  const chapter: unknown = f.chapter;
  if (chapter !== undefined) {
    if (typeof chapter !== 'string' || chapter.length === 0)
      reject(`filter 'chapter' must be a non-empty string`);
    clean.chapter = chapter;
  }
  const version: unknown = f.version;
  if (version !== undefined) {
    if (version === 'any' || version === 'current') clean.version = version;
    else if (version !== null && typeof version === 'object' && !Array.isArray(version)) {
      const keys = Reflect.ownKeys(version);
      const label: unknown = (version as Record<string, unknown>).source_version_label;
      if (
        keys.length !== 1 ||
        keys[0] !== 'source_version_label' ||
        typeof label !== 'string' ||
        label.length === 0
      )
        reject(`filter 'version' must be 'any', 'current' or { source_version_label }`);
      clean.version = Object.freeze({ source_version_label: label });
    } else reject(`filter 'version' must be 'any', 'current' or { source_version_label }`);
  }
  return Object.freeze(clean) as RetrievalFilters;
}

/** Exact structural matching of one row against VALIDATED filters (exported so an eval can measure a narrowed pool). */
export function matchesFilters(row: IndexRow, f: RetrievalFilters): boolean {
  if (f.source_ids && !f.source_ids.includes(row.source_id)) return false;
  if (f.roles && !f.roles.includes(row.role)) return false;
  if (f.structure_kinds && !f.structure_kinds.includes(row.structure_kind)) return false;
  if (f.document_ids && !f.document_ids.includes(row.document_id)) return false;
  if (f.canonical_record_keys && !f.canonical_record_keys.includes(row.canonical_record_key)) return false;
  if (f.version === 'current' && !row.metadata.is_current) return false;
  if (typeof f.version === 'object' && row.metadata.source_version_label !== f.version.source_version_label)
    return false;
  if (f.chapter !== undefined && row.metadata.chapter !== f.chapter) return false;
  if (
    f.court_sections &&
    (row.metadata.court_section === undefined || !f.court_sections.includes(row.metadata.court_section))
  )
    return false;
  if (
    f.evidence_anchors &&
    (row.metadata.evidence_anchor === undefined || !f.evidence_anchors.includes(row.metadata.evidence_anchor))
  )
    return false;
  return true;
}

function describeFilters(f: RetrievalFilters): string {
  const parts: string[] = [];
  if (f.source_ids) parts.push(`source_ids=${[...f.source_ids].sort(codepointCompare).join(',')}`);
  if (f.roles) parts.push(`roles=${[...f.roles].sort(codepointCompare).join(',')}`);
  if (f.structure_kinds)
    parts.push(`structure_kinds=${[...f.structure_kinds].sort(codepointCompare).join(',')}`);
  if (f.document_ids) parts.push(`document_ids=${f.document_ids.length}`);
  if (f.canonical_record_keys) parts.push(`canonical_record_keys=${f.canonical_record_keys.length}`);
  if (f.version)
    parts.push(
      `version=${typeof f.version === 'string' ? f.version : `label:${f.version.source_version_label}`}`,
    );
  if (f.chapter !== undefined) parts.push(`chapter=${f.chapter}`);
  if (f.court_sections)
    parts.push(`court_sections=${[...f.court_sections].sort(codepointCompare).join(',')}`);
  if (f.evidence_anchors)
    parts.push(`evidence_anchors=${[...f.evidence_anchors].sort(codepointCompare).join(',')}`);
  return parts.length ? parts.join(';') : 'unrestricted';
}

export function provenanceOfGoverned(entry: GovernedEntry): ProvenanceResolution {
  const { chunk, document, currency } = entry;
  return Object.freeze({
    document_id: document.document_id,
    canonical_record_key: document.canonical_record_key,
    source_id: document.source.source_id,
    registry_artifact_id: document.source.registry_artifact_id,
    registry_source_content_hash: document.source.registry_source_content_hash,
    catalog_origin: document.catalog_origin,
    text_projection_id: document.text_projection.projection_id,
    fragment_id: chunk.fragment_id,
    chunk_content_hash: chunkContentHash(chunk),
    role: document.role.role,
    role_method: document.role.method,
    version_lineage_key: document.version_lineage_key,
    is_current: currency.is_current,
    currency_method: currency.method,
    currency_reason: currency.reason,
  });
}

export function provenanceRefsOf(p: ProvenanceResolution): readonly string[] {
  return Object.freeze([
    `registry:${p.registry_artifact_id}`,
    `source:${p.source_id}`,
    `document:${p.document_id}`,
    `materialization:${p.canonical_record_key}`,
    `projection:${p.text_projection_id}`,
  ]);
}

/** Deterministic total order: score desc, then stable identity fields — never insertion order. */
function rankOrder(a: { score: number; row: IndexRow }, b: { score: number; row: IndexRow }): number {
  return (
    b.score - a.score ||
    codepointCompare(a.row.document_id, b.row.document_id) ||
    codepointCompare(a.row.canonical_record_key, b.row.canonical_record_key) ||
    a.row.metadata.sequence - b.row.metadata.sequence ||
    codepointCompare(a.row.embedding_identity.fragment_id, b.row.embedding_identity.fragment_id)
  );
}

interface ValidatedRequest {
  readonly query: string;
  readonly filters: RetrievalFilters;
  readonly top_k: number;
  readonly abstain_below_score: number;
}

/** Every request field is checked for its exact type; nothing is coerced. */
export function validateRequest(request: unknown): ValidatedRequest {
  if (request === null || typeof request !== 'object')
    throw new KnowledgeSearchError('REJECT_REQUEST', 'request must be an object');
  const r = request as Record<string, unknown>;
  const query: unknown = r.query;
  if (typeof query !== 'string' || query.trim().length === 0)
    throw new KnowledgeSearchError('REJECT_REQUEST', 'query must be a non-empty string');
  const topK: unknown = r.top_k;
  if (topK !== undefined && (typeof topK !== 'number' || !Number.isInteger(topK) || topK < 1))
    throw new KnowledgeSearchError('REJECT_REQUEST', 'top_k must be a positive integer');
  const abstain: unknown = r.abstain_below_score;
  if (abstain !== undefined && (typeof abstain !== 'number' || !Number.isFinite(abstain)))
    throw new KnowledgeSearchError('REJECT_REQUEST', 'abstain_below_score must be a finite number');
  return Object.freeze({
    query,
    filters: validateFilters(r.filters),
    top_k: (topK as number | undefined) ?? 10,
    abstain_below_score: (abstain as number | undefined) ?? 0,
  });
}

export async function searchKnowledgeIndex(
  index: KnowledgeIndexProjection,
  provider: KnowledgeEmbeddingProvider,
  request: KnowledgeSearchRequest,
  governed: GovernedKnowledgeLookup,
): Promise<KnowledgeSearchOutcome> {
  // Read-only policy gate, same check every governed legal retrieval performs. Cannot create authority.
  const decision = evaluateLegalRetrieval('LEGAL_CORPUS_SEARCH');
  assertSameBinding(index.provider, provider, 'searchKnowledgeIndex');
  if (
    governed.snapshot_identity !== index.corpus_snapshot_identity ||
    governed.catalog_origin !== index.catalog_origin
  ) {
    throw new KnowledgeSearchError(
      'CORPUS_SNAPSHOT_MISMATCH',
      `index derives from corpus ${index.corpus_snapshot_identity} (${index.catalog_origin}); the governed lookup is ${governed.snapshot_identity} (${governed.catalog_origin})`,
    );
  }

  const { query, filters, top_k: topK, abstain_below_score: abstainBelow } = validateRequest(request);
  const queryHashValue = queryHash(query, decision.policy.policy_version);
  const queryVector: unknown = await provider.embedQuery(query);
  if (!isValidVector(queryVector, provider.dimensions)) {
    throw new KnowledgeSearchError(
      'REJECT_QUERY_EMBEDDING',
      `query embedding is not ${provider.dimensions} finite numbers (got ${Array.isArray(queryVector) ? `${queryVector.length}d` : typeof queryVector})`,
    );
  }

  const candidates = index.rows.filter((row) => matchesFilters(row, filters));
  const seenIdentities = new Set<string>();
  const scored = candidates.map((row) => {
    const hash = row.embedding_identity?.embedding_identity_hash;
    if (typeof hash !== 'string' || seenIdentities.has(hash)) {
      throw new KnowledgeSearchError(
        'INDEX_ROW_CORRUPT',
        `candidate ${row.embedding_identity?.fragment_id ?? '?'} duplicates another row's embedding identity or has none — refusing to serve a corrupt read model`,
      );
    }
    seenIdentities.add(hash);
    const score =
      Array.isArray(row.vector) && row.vector.length === provider.dimensions
        ? cosineSimilarity(queryVector, row.vector)
        : Number.NaN;
    if (!Number.isFinite(score)) {
      throw new KnowledgeSearchError(
        'INDEX_ROW_CORRUPT',
        `candidate ${row.embedding_identity.fragment_id} cannot be scored (invalid vector) — refusing to serve a corrupt read model`,
      );
    }
    return { row, score };
  });
  scored.sort(rankOrder);
  const top = scored.slice(0, topK);
  const evidence =
    top.length > 0 && top[0]!.score > abstainBelow ? top.filter((t) => t.score > abstainBelow) : [];

  const hits: KnowledgeRetrievalHit[] = [];
  evidence.forEach(({ row, score }, i) => {
    // The row must agree with the GOVERNED corpus in every column before it is served.
    const entry = governed.resolve(row.canonical_record_key, row.embedding_identity.fragment_id);
    if (!entry) {
      throw new KnowledgeSearchError(
        'INDEX_ROW_CORRUPT',
        `row ${row.embedding_identity.fragment_id} under ${row.canonical_record_key} has no governed chunk — the read model is stale or tampered`,
      );
    }
    const differences = rowDifferences(stripVector(row), expectedIndexRow(entry, index.provider));
    if (differences.length > 0 || !isValidVector(row.vector, index.provider.dimensions)) {
      throw new KnowledgeSearchError(
        'INDEX_ROW_CORRUPT',
        `row ${row.embedding_identity.fragment_id} disagrees with its governed derivation on: ${differences.join(', ') || 'vector'} — refusing to serve a corrupt read model`,
      );
    }
    const provenance = provenanceOfGoverned(entry);
    // buildRetrievalResult is the frozen contract's executable guard, resolved against the GOVERNED
    // chunk (never against the row): a result must resolve to the exact governed chunk its embedding
    // identity was bound to. It throws rather than returns.
    const lookup = createInMemoryGovernedChunkLookup([
      {
        fragment_id: entry.chunk.fragment_id,
        materialization_id: entry.document.canonical_record_key,
        content_hash: provenance.chunk_content_hash,
        structure_kind: entry.chunk.structure_kind,
      },
    ]);
    const result = buildRetrievalResult(
      {
        fragment_id: row.embedding_identity.fragment_id,
        materialization_id: row.canonical_record_key,
        source_provenance_refs: provenanceRefsOf(provenance),
        embedding_identity: row.embedding_identity,
        retrieval_policy_version: decision.policy.policy_version,
        query_run_identity: queryHashValue,
        score,
        rank: i + 1,
      },
      lookup,
    );
    hits.push(Object.freeze({ result, row, provenance, score }));
  });

  const trace = createRetrievalExecutionTrace({
    query_hash: queryHashValue,
    policy_version: decision.policy.policy_version,
    // Content-addressed: which exact index state answered, not which code version.
    artifact_snapshot: index.index_snapshot_identity,
    selected_artifact_refs: hits.map((h) => h.result.fragment_id),
    budget_profile: KNOWLEDGE_INDEX_BUDGET_PROFILE,
    expansion_path: [
      `${KNOWLEDGE_SEARCH_VERSION}:${describeFilters(filters)}:top_k=${topK}:abstain_below=${abstainBelow}`,
    ],
  });

  return Object.freeze({
    kind: hits.length > 0 ? 'RESULTS' : 'NO_EVIDENCE',
    search_version: KNOWLEDGE_SEARCH_VERSION,
    query_hash: queryHashValue,
    candidate_count: candidates.length,
    hits: Object.freeze(hits),
    trace,
    applied_filters: filters,
    abstain_below_score: abstainBelow,
  });
}
