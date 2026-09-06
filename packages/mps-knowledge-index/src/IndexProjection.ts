import { createHash } from 'node:crypto';

import { canonicalizeStrict } from '@miljobeslut/mimers-brunn-core';
import { sha256Utf8Text } from '@miljobeslut/mps-chunking';
import {
  bindEmbeddingIdentity,
  computeEmbeddingIdentityHash,
  type EmbeddingIdentityFields,
} from '@miljobeslut/mps-embedding-identity';
import {
  codepointCompare,
  currencyByDocument,
  isAdmittedProjection,
  verifyCorpusSnapshot,
  type CorpusDocumentProjection,
  type CorpusSnapshot,
  type CurrencyMethod,
  type CurrencyReason,
  type DocumentCurrency,
  type DocumentRole,
  type RoleDerivationMethod,
} from '@miljobeslut/mps-knowledge-corpus';
import type { ChunkStructureKind, LegalChunk } from '@miljobeslut/mps-legal-corpus';

import {
  assertSameBinding,
  assertVectorBatchShape,
  bindingOf,
  type EmbeddingProviderBinding,
  type KnowledgeEmbeddingProvider,
} from './EmbeddingProvider';
import { KNOWLEDGE_INDEX_PROJECTION_VERSION } from './versions';

/**
 * KNOWLEDGE-INDEX-PROJECTION-V1.
 *
 * VECTOR INDEX IS A READ MODEL — AND NEVER ITS OWN WITNESS. Every row is DERIVED from a corpus
 * snapshot under one embedding binding by ONE function (`expectedIndexRow`), and that same function
 * is what `verifyIndexProjection` and `searchKnowledgeIndex` recompute from the governed corpus to
 * check a row before it is served: a row that disagrees with the governed chunk/document in any
 * column (provenance, role, currency, text, identity) is a corrupt read model, reported by the
 * verifier and refused by search. The governed side is itself verified (`verifyCorpusSnapshot`)
 * before it is trusted. The index identity (`index_snapshot_identity`) is content-addressed over
 * the header and EVERY column of every row INCLUDING a vector digest, so a persisted index with
 * anything altered no longer deserializes as the index it claims to be.
 *
 * WHAT THE VECTOR IS. A vector's CONTENT is opaque to every check except re-embedding: a valid
 * vector belonging to another chunk is indistinguishable by shape or identity (the provider port
 * returns vectors positionally and is trusted as configuration). `verifyIndexProjection` can
 * therefore re-embed rows (`reembed`) and compare — the only witness a vector has.
 *
 * `materialization_id` in this read model IS the content-addressed `canonical_record_key`
 * (legal-corpus-record-v2), not a database cuid. `is_current` is DERIVED (see `currency_method`
 * and `currency_reason`), never a source fact.
 */
export interface IndexRowMetadata {
  readonly sequence: number;
  readonly chapter?: string;
  readonly paragraph?: string;
  readonly law_section?: string;
  readonly court_section?: string;
  readonly evidence_anchor?: string;
  readonly source_version_label?: string;
  readonly acquired_at?: string;
  /** The logical publication this document is a version of, or null (no version notion). */
  readonly version_lineage_key: string | null;
  /** DERIVED currency: true when the document is the newest acquisition of its lineage (or content-identical to it), or is in no lineage. */
  readonly is_current: boolean;
  readonly currency_method: CurrencyMethod;
  readonly currency_reason: CurrencyReason;
}

export interface IndexRow {
  readonly embedding_identity: EmbeddingIdentityFields;
  readonly document_id: string;
  readonly canonical_record_key: string;
  readonly source_id: string;
  readonly registry_artifact_id: string;
  readonly registry_source_content_hash: string;
  readonly catalog_origin: string;
  readonly text_projection_id: string;
  readonly role: DocumentRole;
  /** How the role was derived (SOURCE_DECLARED / CALLER_DECLARED / DETERMINISTIC_CLASSIFIER) — carried, never flattened away. */
  readonly role_method: RoleDerivationMethod;
  readonly structure_kind: ChunkStructureKind;
  readonly metadata: IndexRowMetadata;
  readonly chunk_text: string;
  readonly vector: readonly number[];
}

export type IndexRowWithoutVector = Omit<IndexRow, 'vector'>;

export interface SkippedDocument {
  readonly canonical_record_key: string;
  readonly reason: string;
}

export interface KnowledgeIndexProjection {
  readonly projection_version: typeof KNOWLEDGE_INDEX_PROJECTION_VERSION;
  readonly corpus_snapshot_identity: string;
  readonly catalog_origin: string;
  readonly provider: EmbeddingProviderBinding;
  readonly rows: readonly IndexRow[];
  readonly skipped_documents: readonly SkippedDocument[];
  /** sha256 over (projection_version, provider binding, corpus_snapshot_identity, catalog_origin, skipped_documents, sorted per-row digests incl. vector digests). */
  readonly index_snapshot_identity: string;
}

export interface IndexBuildStats {
  readonly documents_indexed: number;
  readonly documents_skipped: number;
  readonly chunks_embedded: number;
  readonly chunks_reused: number;
  readonly embedding_batches: number;
}

export class IndexProjectionError extends Error {
  constructor(
    readonly code:
      | 'REUSE_MODEL_MISMATCH'
      | 'REUSE_CATALOG_MISMATCH'
      | 'REUSE_INDEX_INVALID'
      | 'INDEX_DESERIALIZE_INVALID'
      | 'REJECT_GOVERNED_SNAPSHOT',
    message: string,
  ) {
    super(message);
    this.name = 'IndexProjectionError';
  }
}

/** sha256(full_text) — the exact convention the persisted chunk row uses (mapChunkForPersistence), via the chunking package's helper. */
export function chunkContentHash(chunk: LegalChunk): string {
  return sha256Utf8Text(chunk.full_text).value;
}

/** True only for a plain array of exactly `dimensions` finite numbers. Never pads, never coerces. */
export function isValidVector(vector: unknown, dimensions: number): vector is readonly number[] {
  if (!Array.isArray(vector) || vector.length !== dimensions) return false;
  for (let i = 0; i < vector.length; i++) {
    const x = vector[i];
    if (typeof x !== 'number' || !Number.isFinite(x)) return false;
  }
  return true;
}

/** Content digest of a vector: sha256 over its IEEE-754 float64 bytes. */
export function vectorDigest(vector: readonly number[]): string {
  return createHash('sha256')
    .update(Buffer.from(new Float64Array(vector).buffer))
    .digest('hex');
}

export function stripVector(row: IndexRow): IndexRowWithoutVector {
  const { vector: _vector, ...rest } = row;
  return rest;
}

/** Canonical digest of one row — every column AND the vector. */
export function rowDigest(row: IndexRow): string {
  return createHash('sha256')
    .update(canonicalizeStrict({ ...stripVector(row), vector_digest: vectorDigest(row.vector) }), 'utf8')
    .digest('hex');
}

export interface GovernedEntry {
  readonly chunk: LegalChunk;
  readonly document: CorpusDocumentProjection;
  readonly currency: DocumentCurrency;
}

/**
 * The governed side of every check: chunks and documents of ONE VERIFIED corpus snapshot,
 * resolvable by (canonical_record_key, fragment_id). Built from the snapshot after
 * `verifyCorpusSnapshot` passes — never from index rows, never from an unverified snapshot. In K3
 * the same port is what a database-backed adapter over the canonical tables implements.
 */
export interface GovernedKnowledgeLookup {
  readonly snapshot_identity: string;
  readonly catalog_origin: string;
  readonly current_document_ids: ReadonlySet<string>;
  resolve(canonicalRecordKey: string, fragmentId: string): GovernedEntry | null;
  /** All (canonical_record_key, fragment_id) keys of admitted chunks, for completeness checks. */
  admittedKeys(): ReadonlySet<string>;
}

export function governedKey(canonicalRecordKey: string, fragmentId: string): string {
  return `${canonicalRecordKey}\n${fragmentId}`;
}

export function createGovernedKnowledgeLookup(corpus: CorpusSnapshot): GovernedKnowledgeLookup {
  // The snapshot's identity hashes the fields the documents CARRY; only a verification recomputes
  // whether those fields are true of the chunks. Nothing is trusted as governed before that.
  const violations = verifyCorpusSnapshot(corpus);
  if (violations.length > 0) {
    const codes = [...new Set(violations.map((v) => v.code))].sort(codepointCompare);
    throw new IndexProjectionError(
      'REJECT_GOVERNED_SNAPSHOT',
      `corpus snapshot ${corpus.snapshot_identity} fails verification (${codes.join(', ')}; ${violations.length} violation(s)) and cannot be the governed side of anything`,
    );
  }
  const currency = currencyByDocument(corpus.documents, corpus.version_lineages);
  const entries = new Map<string, GovernedEntry>();
  const admitted = new Set<string>();
  const current = new Set<string>();
  for (const document of corpus.documents) {
    const c = currency.get(document.document_id)!;
    if (c.is_current) current.add(document.document_id);
    for (const chunk of document.chunks) {
      const key = governedKey(document.canonical_record_key, chunk.fragment_id);
      entries.set(key, Object.freeze({ chunk, document, currency: c }));
      if (isAdmittedProjection(document)) admitted.add(key);
    }
  }
  return Object.freeze({
    snapshot_identity: corpus.snapshot_identity,
    catalog_origin: corpus.catalog_origin,
    current_document_ids: current,
    resolve(canonicalRecordKey: string, fragmentId: string) {
      return entries.get(governedKey(canonicalRecordKey, fragmentId)) ?? null;
    },
    admittedKeys() {
      return admitted;
    },
  });
}

/** Documents in no lineage are current by definition; lineage members are current only if newest (or content-identical to it). */
export function currentDocumentIds(corpus: CorpusSnapshot): ReadonlySet<string> {
  return createGovernedKnowledgeLookup(corpus).current_document_ids;
}

/**
 * THE row derivation. Build, verify and search all compute rows through this one function, so
 * "what the index must say about this chunk" has exactly one definition.
 */
export function expectedIndexRow(
  entry: GovernedEntry,
  binding: EmbeddingProviderBinding,
): IndexRowWithoutVector {
  const { chunk, document, currency } = entry;
  const identity = bindEmbeddingIdentity({
    fragment_id: chunk.fragment_id,
    materialization_id: document.canonical_record_key,
    chunk_content_hash: chunkContentHash(chunk),
    embedding_model_id: binding.model_id,
    embedding_model_version: binding.model_version,
    embedding_pipeline_version: binding.pipeline_version,
  });
  const metadata: IndexRowMetadata = Object.freeze({
    sequence: chunk.sequence,
    ...(chunk.structure_kind === 'law'
      ? {
          chapter: chunk.chapter,
          paragraph: chunk.paragraph,
          ...(chunk.section ? { law_section: chunk.section } : {}),
        }
      : {}),
    ...(chunk.structure_kind === 'court' ? { court_section: chunk.court_section } : {}),
    ...(chunk.structure_kind === 'evidence' && chunk.evidence_anchor
      ? { evidence_anchor: chunk.evidence_anchor }
      : {}),
    ...(document.source_version_label ? { source_version_label: document.source_version_label } : {}),
    ...(document.acquisition?.acquired_at ? { acquired_at: document.acquisition.acquired_at } : {}),
    version_lineage_key: document.version_lineage_key,
    is_current: currency.is_current,
    currency_method: currency.method,
    currency_reason: currency.reason,
  });
  return Object.freeze({
    embedding_identity: identity,
    document_id: document.document_id,
    canonical_record_key: document.canonical_record_key,
    source_id: document.source.source_id,
    registry_artifact_id: document.source.registry_artifact_id,
    registry_source_content_hash: document.source.registry_source_content_hash,
    catalog_origin: document.catalog_origin,
    text_projection_id: document.text_projection.projection_id,
    role: document.role.role,
    role_method: document.role.method,
    structure_kind: chunk.structure_kind,
    metadata,
    chunk_text: chunk.full_text,
  });
}

/** Top-level keys on which a row disagrees with its expected derivation (compared canonically). */
export function rowDifferences(
  actual: IndexRowWithoutVector,
  expected: IndexRowWithoutVector,
): readonly string[] {
  const keys = new Set<string>([...Object.keys(actual), ...Object.keys(expected)]);
  const diff: string[] = [];
  for (const key of [...keys].sort(codepointCompare)) {
    const a = (actual as Record<string, unknown>)[key];
    const e = (expected as Record<string, unknown>)[key];
    let same: boolean;
    try {
      same =
        canonicalizeStrict(a === undefined ? null : a) === canonicalizeStrict(e === undefined ? null : e);
    } catch {
      same = false;
    }
    if (!same) diff.push(key);
  }
  return diff;
}

export function computeIndexSnapshotIdentity(input: {
  readonly provider: EmbeddingProviderBinding;
  readonly corpus_snapshot_identity: string;
  readonly catalog_origin: string;
  readonly skipped_documents: readonly SkippedDocument[];
  readonly rows: readonly IndexRow[];
}): string {
  return createHash('sha256')
    .update(
      canonicalizeStrict({
        projection_version: KNOWLEDGE_INDEX_PROJECTION_VERSION,
        provider: bindingOf(input.provider),
        corpus_snapshot_identity: input.corpus_snapshot_identity,
        catalog_origin: input.catalog_origin,
        skipped_documents: [...input.skipped_documents]
          .map((s) => [s.canonical_record_key, s.reason])
          .sort((a, b) => codepointCompare(a[0]!, b[0]!)),
        row_digests: input.rows.map(rowDigest).sort(codepointCompare),
      }),
      'utf8',
    )
    .digest('hex');
}

function identityOf(index: KnowledgeIndexProjection): string {
  return computeIndexSnapshotIdentity({
    provider: index.provider,
    corpus_snapshot_identity: index.corpus_snapshot_identity,
    catalog_origin: index.catalog_origin,
    skipped_documents: index.skipped_documents,
    rows: index.rows,
  });
}

function rowOrder(a: IndexRow, b: IndexRow): number {
  return (
    codepointCompare(a.document_id, b.document_id) ||
    codepointCompare(a.canonical_record_key, b.canonical_record_key) ||
    a.metadata.sequence - b.metadata.sequence ||
    codepointCompare(a.embedding_identity.fragment_id, b.embedding_identity.fragment_id)
  );
}

/**
 * Builds (or incrementally rebuilds) the index from a corpus snapshot. Idempotent: the same
 * snapshot under the same provider yields byte-identical rows and identity. With `reuse`, any row
 * whose embedding identity already exists under the SAME provider binding keeps its VECTOR (every
 * other column is recomputed from the corpus) and is not re-embedded; rows for documents no longer
 * in the snapshot simply do not exist in the result. The reuse index must itself be intact: its
 * identity is recomputed (covers vectors) and every reused vector must be a valid finite vector.
 * A reused vector's CONTENT is trusted (see the module note): re-embed to verify.
 */
export async function buildIndexProjection(
  corpus: CorpusSnapshot,
  provider: KnowledgeEmbeddingProvider,
  options: { readonly reuse?: KnowledgeIndexProjection; readonly batch_size?: number } = {},
): Promise<{ readonly index: KnowledgeIndexProjection; readonly stats: IndexBuildStats }> {
  const binding = bindingOf(provider);
  const batchSize = Math.max(1, options.batch_size ?? 64);
  const governed = createGovernedKnowledgeLookup(corpus);
  const reusable = new Map<string, readonly number[]>();
  if (options.reuse) {
    const reuse = options.reuse;
    try {
      assertSameBinding(reuse.provider, binding, 'buildIndexProjection(reuse)');
    } catch (err) {
      throw new IndexProjectionError(
        'REUSE_MODEL_MISMATCH',
        err instanceof Error ? err.message : String(err),
      );
    }
    if (reuse.catalog_origin !== corpus.catalog_origin) {
      throw new IndexProjectionError(
        'REUSE_CATALOG_MISMATCH',
        `reuse index was built against '${reuse.catalog_origin}', corpus is '${corpus.catalog_origin}'`,
      );
    }
    for (const row of reuse.rows) {
      if (!isValidVector(row.vector, binding.dimensions)) {
        throw new IndexProjectionError(
          'REUSE_INDEX_INVALID',
          `reuse index row ${row.embedding_identity.fragment_id} carries an invalid vector (not ${binding.dimensions} finite numbers)`,
        );
      }
      if (
        computeEmbeddingIdentityHash(row.embedding_identity) !==
        row.embedding_identity.embedding_identity_hash
      ) {
        throw new IndexProjectionError(
          'REUSE_INDEX_INVALID',
          `reuse index row ${row.embedding_identity.fragment_id} has an inconsistent embedding identity`,
        );
      }
    }
    if (identityOf(reuse) !== reuse.index_snapshot_identity) {
      throw new IndexProjectionError(
        'REUSE_INDEX_INVALID',
        'reuse index_snapshot_identity does not match its header, rows and vectors — a tampered or mis-merged index is never reused',
      );
    }
    for (const row of reuse.rows) reusable.set(row.embedding_identity.embedding_identity_hash, row.vector);
  }

  const skipped: SkippedDocument[] = [];
  const pending: { readonly row: IndexRowWithoutVector; readonly text: string }[] = [];
  const rows: IndexRow[] = [];
  let reused = 0;
  let indexed = 0;

  for (const document of corpus.documents) {
    if (!isAdmittedProjection(document)) {
      skipped.push({
        canonical_record_key: document.canonical_record_key,
        reason: `${document.status}${document.status_detail ? `: ${document.status_detail}` : ''}`,
      });
      continue;
    }
    indexed += 1;
    for (const chunk of document.chunks) {
      const entry = governed.resolve(document.canonical_record_key, chunk.fragment_id)!;
      const base = expectedIndexRow(entry, binding);
      const existing = reusable.get(base.embedding_identity.embedding_identity_hash);
      if (existing) {
        rows.push(Object.freeze({ ...base, vector: Object.freeze([...existing]) }));
        reused += 1;
      } else {
        pending.push({ row: base, text: chunk.full_text });
      }
    }
  }

  let batches = 0;
  for (let i = 0; i < pending.length; i += batchSize) {
    const slice = pending.slice(i, i + batchSize);
    const vectors = await provider.embedDocuments(slice.map((p) => p.text));
    assertVectorBatchShape(vectors, slice.length, binding.dimensions);
    batches += 1;
    for (let j = 0; j < slice.length; j++)
      rows.push(Object.freeze({ ...slice[j]!.row, vector: Object.freeze([...vectors[j]!]) }));
  }

  rows.sort(rowOrder);
  const skippedSorted = Object.freeze(
    skipped.sort((a, b) => codepointCompare(a.canonical_record_key, b.canonical_record_key)),
  );
  const index: KnowledgeIndexProjection = Object.freeze({
    projection_version: KNOWLEDGE_INDEX_PROJECTION_VERSION,
    corpus_snapshot_identity: corpus.snapshot_identity,
    catalog_origin: corpus.catalog_origin,
    provider: binding,
    rows: Object.freeze(rows),
    skipped_documents: skippedSorted,
    index_snapshot_identity: computeIndexSnapshotIdentity({
      provider: binding,
      corpus_snapshot_identity: corpus.snapshot_identity,
      catalog_origin: corpus.catalog_origin,
      skipped_documents: skippedSorted,
      rows,
    }),
  });
  return {
    index,
    stats: Object.freeze({
      documents_indexed: indexed,
      documents_skipped: skipped.length,
      chunks_embedded: pending.length,
      chunks_reused: reused,
      embedding_batches: batches,
    }),
  };
}

export type IndexViolationCode =
  | 'CORPUS_SNAPSHOT_MISMATCH'
  | 'CATALOG_MISMATCH'
  | 'MISSING_CHUNK'
  | 'STALE_CONTENT_HASH'
  | 'MODEL_MISMATCH'
  | 'DIMENSION_MISMATCH'
  | 'VECTOR_INVALID'
  | 'VECTOR_MISMATCH'
  | 'DUPLICATE_ROW'
  | 'IDENTITY_HASH_MISMATCH'
  | 'SUPERSEDED_ACTIVE'
  | 'ROW_MISMATCH'
  | 'MISSING_ROW'
  | 'INDEX_IDENTITY_MISMATCH';

export interface IndexViolation {
  readonly code: IndexViolationCode;
  readonly fragment_id?: string;
  readonly detail: string;
}

export interface VerifyIndexOptions {
  /**
   * Re-embed rows with the provider and compare vectors — the only witness a vector's CONTENT has.
   * `sample_size` (default: all rows) takes a deterministic sample (every k-th row in row order);
   * `tolerance` (default 0 — exact) is the max absolute per-element difference for float providers.
   */
  readonly reembed?: {
    readonly provider: KnowledgeEmbeddingProvider;
    readonly sample_size?: number;
    readonly tolerance?: number;
  };
}

/**
 * Stale/corrupt read-model defense. Recomputes what EVERY column of every row must be from the
 * governed corpus the index claims to derive from, and reports each disagreement explicitly;
 * nothing is served or repaired silently. With `reembed`, vector CONTENT is verified too.
 */
export async function verifyIndexProjectionWithReembedding(
  index: KnowledgeIndexProjection,
  corpus: CorpusSnapshot,
  options: VerifyIndexOptions,
): Promise<readonly IndexViolation[]> {
  const violations = [...verifyIndexProjection(index, corpus)];
  if (options.reembed) {
    const { provider, tolerance = 0 } = options.reembed;
    try {
      assertSameBinding(index.provider, bindingOf(provider), 'verifyIndexProjection(reembed)');
    } catch (err) {
      violations.push({ code: 'MODEL_MISMATCH', detail: err instanceof Error ? err.message : String(err) });
      return Object.freeze(violations);
    }
    const rows = [...index.rows].sort(rowOrder);
    const sampleSize = Math.max(1, Math.min(rows.length, options.reembed.sample_size ?? rows.length));
    const step = Math.max(1, Math.floor(rows.length / sampleSize));
    const sample = rows.filter((_, i) => i % step === 0).slice(0, sampleSize);
    for (let i = 0; i < sample.length; i += 64) {
      const slice = sample.slice(i, i + 64);
      const vectors = await provider.embedDocuments(slice.map((r) => r.chunk_text));
      assertVectorBatchShape(vectors, slice.length, index.provider.dimensions);
      slice.forEach((row, j) => {
        const v = vectors[j]!;
        let maxDiff = 0;
        for (let k = 0; k < v.length; k++)
          maxDiff = Math.max(maxDiff, Math.abs(v[k]! - (row.vector[k] ?? Number.NaN)));
        if (!(maxDiff <= tolerance)) {
          violations.push({
            code: 'VECTOR_MISMATCH',
            fragment_id: row.embedding_identity.fragment_id,
            detail: `stored vector differs from a fresh embedding of the governed text (max |Δ| ${maxDiff})`,
          });
        }
      });
    }
  }
  return Object.freeze(violations);
}

export function verifyIndexProjection(
  index: KnowledgeIndexProjection,
  corpus: CorpusSnapshot,
): readonly IndexViolation[] {
  const violations: IndexViolation[] = [];
  if (index.corpus_snapshot_identity !== corpus.snapshot_identity) {
    violations.push({
      code: 'CORPUS_SNAPSHOT_MISMATCH',
      detail: `index derives from ${index.corpus_snapshot_identity}, corpus is ${corpus.snapshot_identity}`,
    });
  }
  if (index.catalog_origin !== corpus.catalog_origin) {
    violations.push({
      code: 'CATALOG_MISMATCH',
      detail: `index claims catalog '${index.catalog_origin}', corpus is '${corpus.catalog_origin}'`,
    });
  }
  let governed: GovernedKnowledgeLookup;
  try {
    governed = createGovernedKnowledgeLookup(corpus);
  } catch (err) {
    violations.push({
      code: 'CORPUS_SNAPSHOT_MISMATCH',
      detail: err instanceof Error ? err.message : String(err),
    });
    return Object.freeze(violations);
  }
  const expectedKeys = new Set(governed.admittedKeys());
  const seen = new Set<string>();

  for (const row of index.rows) {
    const id = row.embedding_identity;
    const key = governedKey(row.canonical_record_key, id.fragment_id);
    if (seen.has(id.embedding_identity_hash))
      violations.push({
        code: 'DUPLICATE_ROW',
        fragment_id: id.fragment_id,
        detail: 'two rows share one embedding identity',
      });
    seen.add(id.embedding_identity_hash);
    expectedKeys.delete(key);

    if (
      id.embedding_model_id !== index.provider.model_id ||
      id.embedding_model_version !== index.provider.model_version ||
      id.embedding_pipeline_version !== index.provider.pipeline_version
    ) {
      violations.push({
        code: 'MODEL_MISMATCH',
        fragment_id: id.fragment_id,
        detail: `row bound to ${id.embedding_model_id}@${id.embedding_model_version}/${id.embedding_pipeline_version}`,
      });
    }
    if (!Array.isArray(row.vector) || row.vector.length !== index.provider.dimensions) {
      violations.push({
        code: 'DIMENSION_MISMATCH',
        fragment_id: id.fragment_id,
        detail: `${Array.isArray(row.vector) ? row.vector.length : typeof row.vector} != ${index.provider.dimensions}`,
      });
    } else if (!isValidVector(row.vector, index.provider.dimensions)) {
      violations.push({
        code: 'VECTOR_INVALID',
        fragment_id: id.fragment_id,
        detail: 'vector contains non-finite or non-numeric elements',
      });
    }
    if (computeEmbeddingIdentityHash(id) !== id.embedding_identity_hash)
      violations.push({
        code: 'IDENTITY_HASH_MISMATCH',
        fragment_id: id.fragment_id,
        detail: 'stored identity hash does not match its fields',
      });

    const entry = governed.resolve(row.canonical_record_key, id.fragment_id);
    if (!entry) {
      violations.push({
        code: 'MISSING_CHUNK',
        fragment_id: id.fragment_id,
        detail: `no governed chunk ${id.fragment_id} under ${row.canonical_record_key}`,
      });
      continue;
    }
    const expected = expectedIndexRow(entry, index.provider);
    if (
      expected.chunk_text !== row.chunk_text ||
      expected.embedding_identity.chunk_content_hash !== id.chunk_content_hash
    ) {
      violations.push({
        code: 'STALE_CONTENT_HASH',
        fragment_id: id.fragment_id,
        detail: 'row content no longer matches the governed chunk',
      });
    }
    if (row.metadata?.is_current && !expected.metadata.is_current) {
      violations.push({
        code: 'SUPERSEDED_ACTIVE',
        fragment_id: id.fragment_id,
        detail: `document ${row.document_id} is not current but the row is marked current`,
      });
    }
    const differences = rowDifferences(stripVector(row), expected);
    if (differences.length > 0) {
      violations.push({
        code: 'ROW_MISMATCH',
        fragment_id: id.fragment_id,
        detail: `row disagrees with its governed derivation on: ${differences.join(', ')}`,
      });
    }
  }
  for (const missing of expectedKeys) {
    violations.push({
      code: 'MISSING_ROW',
      fragment_id: missing.split('\n')[1],
      detail: `admitted chunk has no index row (${missing.replace('\n', ' / ')})`,
    });
  }
  if (identityOf(index) !== index.index_snapshot_identity) {
    violations.push({
      code: 'INDEX_IDENTITY_MISMATCH',
      detail: 'index_snapshot_identity does not match the header, rows and vectors it claims',
    });
  }
  return Object.freeze(violations);
}

/** Plain-JSON form for storing/transporting the read model. Round-trips through `deserializeIndexProjection`. */
export function serializeIndexProjection(index: KnowledgeIndexProjection): string {
  return JSON.stringify(index);
}

const REQUIRED_ROW_STRINGS = [
  'document_id',
  'canonical_record_key',
  'source_id',
  'registry_artifact_id',
  'registry_source_content_hash',
  'catalog_origin',
  'text_projection_id',
  'role',
  'role_method',
  'structure_kind',
  'chunk_text',
] as const;

function invalid(detail: string): never {
  throw new IndexProjectionError('INDEX_DESERIALIZE_INVALID', detail);
}

export function deserializeIndexProjection(json: string): KnowledgeIndexProjection {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    invalid(err instanceof Error ? err.message : String(err));
  }
  const v = parsed as Partial<KnowledgeIndexProjection>;
  if (
    !v ||
    typeof v !== 'object' ||
    v.projection_version !== KNOWLEDGE_INDEX_PROJECTION_VERSION ||
    !Array.isArray(v.rows) ||
    !v.provider ||
    typeof v.provider !== 'object' ||
    typeof v.corpus_snapshot_identity !== 'string' ||
    typeof v.catalog_origin !== 'string' ||
    typeof v.index_snapshot_identity !== 'string' ||
    !Array.isArray(v.skipped_documents)
  ) {
    invalid('not a knowledge-index-projection-v1 document');
  }
  const provider = bindingOf(v.provider);
  if (
    typeof provider.model_id !== 'string' ||
    typeof provider.model_version !== 'string' ||
    typeof provider.pipeline_version !== 'string' ||
    !Number.isInteger(provider.dimensions) ||
    provider.dimensions <= 0
  ) {
    invalid('provider binding invalid');
  }
  const skipped = (v.skipped_documents as unknown[]).map((s, i): SkippedDocument => {
    const x = s as Partial<SkippedDocument>;
    if (
      !x ||
      typeof x !== 'object' ||
      typeof x.canonical_record_key !== 'string' ||
      typeof x.reason !== 'string'
    )
      invalid(`skipped_documents[${i}] is malformed`);
    return Object.freeze({ canonical_record_key: x.canonical_record_key, reason: x.reason });
  });
  const rows = (v.rows as unknown[]).map((raw, i): IndexRow => {
    const r = raw as Partial<IndexRow>;
    if (!r || typeof r !== 'object') invalid(`row ${i} is not an object`);
    for (const key of REQUIRED_ROW_STRINGS) {
      if (typeof r[key] !== 'string') invalid(`row ${i} field '${key}' is not a string`);
    }
    const id = r.embedding_identity as Partial<EmbeddingIdentityFields> | undefined;
    if (
      !id ||
      typeof id !== 'object' ||
      typeof id.embedding_identity_hash !== 'string' ||
      typeof id.fragment_id !== 'string'
    )
      invalid(`row ${i} has no embedding identity`);
    if (
      id.embedding_model_id !== provider.model_id ||
      id.embedding_model_version !== provider.model_version ||
      id.embedding_pipeline_version !== provider.pipeline_version
    ) {
      invalid(`row ${i} (${id.fragment_id}) is bound to a different embedding model than the index provider`);
    }
    if (computeEmbeddingIdentityHash(id as EmbeddingIdentityFields) !== id.embedding_identity_hash)
      invalid(`row ${i} (${id.fragment_id}) embedding identity hash does not match its fields`);
    const m = r.metadata as Partial<IndexRowMetadata> | undefined;
    if (
      !m ||
      typeof m !== 'object' ||
      typeof m.sequence !== 'number' ||
      typeof m.is_current !== 'boolean' ||
      typeof m.currency_method !== 'string' ||
      typeof m.currency_reason !== 'string'
    )
      invalid(`row ${i} (${id.fragment_id}) metadata is malformed`);
    if (!isValidVector(r.vector, provider.dimensions))
      invalid(`row ${i} (${id.fragment_id}) vector is not ${provider.dimensions} finite numbers`);
    return Object.freeze({ ...(r as IndexRow), vector: Object.freeze([...(r.vector as readonly number[])]) });
  });
  const result: KnowledgeIndexProjection = Object.freeze({
    projection_version: KNOWLEDGE_INDEX_PROJECTION_VERSION,
    corpus_snapshot_identity: v.corpus_snapshot_identity as string,
    catalog_origin: v.catalog_origin as string,
    provider,
    rows: Object.freeze(rows),
    skipped_documents: Object.freeze(skipped),
    index_snapshot_identity: v.index_snapshot_identity as string,
  });
  if (identityOf(result) !== result.index_snapshot_identity)
    invalid('index_snapshot_identity does not match the serialized header, rows and vectors');
  return result;
}
