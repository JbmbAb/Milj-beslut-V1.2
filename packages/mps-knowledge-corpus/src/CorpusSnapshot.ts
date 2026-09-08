import { createHash } from 'node:crypto';

import { canonicalizeStrict } from '@miljobeslut/mimers-brunn-core';
import {
  buildCanonicalLegalCorpusRecordKey,
  computeChunkSetContentHash,
} from '@miljobeslut/mps-legal-corpus';

import { codepointCompare, projectionFingerprint, type CorpusDocumentProjection } from './CorpusProjection';
import { computeKnowledgeDocumentId } from './DocumentIdentity';

export const KNOWLEDGE_CORPUS_SNAPSHOT_VERSION = 'knowledge-corpus-snapshot-v1' as const;

export interface DuplicateAcquisition {
  readonly document_id: string;
  /** Distinct acquisitions (quarantine id / name) of byte-identical content. Two chunk policies over ONE acquisition are not a duplicate. */
  readonly occurrences: number;
  readonly doc_names: readonly string[];
  readonly quarantine_ids: readonly string[];
  readonly acquired_at: readonly string[];
  readonly source_version_labels: readonly string[];
  readonly source_urls: readonly string[];
  readonly version_lineage_keys: readonly string[];
}

/** How `is_current` was derived. Always DERIVED from acquisition metadata — never a source fact. */
export type CurrencyMethod =
  /** Decided inside a keyed version lineage from acquisition instants (and chunk-set content). */
  | 'ACQUISITION_RECENCY'
  /** The document is in no lineage (no key, or the only member): current by definition, i.e. no version notion. */
  | 'NO_LINEAGE';

export type CurrencyReason =
  | 'SINGLETON'
  /** Unambiguously the newest acquisition of its lineage. */
  | 'NEWEST'
  /** An older acquisition whose admitted chunk set is byte-identical to the newest one's: the same content, re-fetched. Not superseded. */
  | 'CONTENT_IDENTICAL_TO_NEWEST'
  | 'SUPERSEDED'
  /** The newest acquisition cannot be decided (tie or undated member): nobody is current. */
  | 'AMBIGUOUS';

export interface VersionMember {
  readonly document_id: string;
  readonly canonical_record_key: string;
  readonly chunk_set_content_hash: string;
  readonly acquired_at?: string;
  readonly source_version_label?: string;
  readonly is_current: boolean;
  readonly currency_reason: CurrencyReason;
}

export interface VersionLineage {
  readonly source_id: string;
  readonly registry_source_content_hash: string;
  /** The logical publication these documents are versions of (see CorpusDocumentInput.version_lineage_key). */
  readonly version_lineage_key: string;
  readonly currency_method: 'ACQUISITION_RECENCY';
  readonly members: readonly VersionMember[];
  /** Set when the newest acquisition cannot be decided (tie, or an undated member): NO member is current. */
  readonly ambiguous_current: boolean;
  /** Older members whose chunk set equals the newest one's — re-fetches of the same content, reported so a reviewer can see them. */
  readonly content_identical_members: number;
}

export interface CorpusSnapshot {
  readonly snapshot_version: typeof KNOWLEDGE_CORPUS_SNAPSHOT_VERSION;
  readonly catalog_origin: string;
  /** One entry per canonical_record_key — byte-identical acquisitions are collapsed, never duplicated. */
  readonly documents: readonly CorpusDocumentProjection[];
  readonly duplicates: readonly DuplicateAcquisition[];
  readonly version_lineages: readonly VersionLineage[];
  /**
   * sha256 over the catalog origin, the sorted (document_id, canonical_record_key,
   * chunk_set_content_hash, fingerprint) tuples AND the version state (lineage key, acquired_at,
   * label, currency per document). It is a SNAPSHOT identity — "which exact corpus state,
   * including currency" — not a content-only document identity. NOTE: it hashes the identity
   * FIELDS the documents carry; whether those fields are true of the chunks is what
   * `verifyCorpusSnapshot` recomputes, and every consumer that trusts a snapshot as governed
   * (createGovernedKnowledgeLookup) runs that verification first.
   */
  readonly snapshot_identity: string;
}

export class CorpusSnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CorpusSnapshotError';
  }
}

const ISO_8601 = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-]\d{2}:\d{2})$/;

/**
 * Acquisition instants are compared as INSTANTS (epoch ms), never as strings. Only a complete
 * ISO-8601 timestamp with an explicit offset whose calendar fields are REAL (no 2026-02-30, no
 * 24:00) is an instant; anything else is "undated" and makes a lineage ambiguous.
 */
export function acquiredAtMs(value: string | undefined): number | null {
  if (value === undefined) return null;
  const m = ISO_8601.exec(value);
  if (!m) return null;
  const [y, mo, d, h, mi] = [m[1], m[2], m[3], m[4], m[5]].map(Number) as [
    number,
    number,
    number,
    number,
    number,
  ];
  const s = m[6] === undefined ? 0 : Number(m[6]);
  const frac = m[7] === undefined ? 0 : Number(`0.${m[7]}`) * 1000;
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) return null;
  const utc = Date.UTC(y, mo - 1, d, h, mi, s, 0);
  const probe = new Date(utc);
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) return null;
  let offsetMs = 0;
  if (m[8] !== 'Z') {
    const sign = m[8]!.startsWith('-') ? -1 : 1;
    const oh = Number(m[8]!.slice(1, 3));
    const om = Number(m[8]!.slice(4, 6));
    if (oh > 23 || om > 59) return null;
    offsetMs = sign * (oh * 60 + om) * 60_000;
  }
  return utc + Math.round(frac) - offsetMs;
}

/** Newest acquisition first, then every field that can differ between byte-identical replays — a full tie means the replays are indistinguishable. */
function rankCompare(a: CorpusDocumentProjection, b: CorpusDocumentProjection): number {
  const ia = acquiredAtMs(a.acquisition?.acquired_at) ?? Number.NEGATIVE_INFINITY;
  const ib = acquiredAtMs(b.acquisition?.acquired_at) ?? Number.NEGATIVE_INFINITY;
  if (ia !== ib) return ia > ib ? -1 : 1;
  return (
    codepointCompare(a.acquisition?.quarantine_id ?? '', b.acquisition?.quarantine_id ?? '') ||
    codepointCompare(a.doc_name, b.doc_name) ||
    codepointCompare(a.source_version_label ?? '', b.source_version_label ?? '') ||
    codepointCompare(a.version_lineage_key ?? '', b.version_lineage_key ?? '') ||
    codepointCompare(a.acquisition?.source_url ?? '', b.acquisition?.source_url ?? '') ||
    codepointCompare(a.acquisition?.acquired_at ?? '', b.acquisition?.acquired_at ?? '')
  );
}

/**
 * Builds the snapshot. ORDER-INSENSITIVE in every output, including currency: byte-identical
 * replays of one materialization collapse to the acquisition with the newest valid `acquired_at`
 * (ties broken by every distinguishing field), never to "whichever came first". Two projections
 * with the same document_id but a DIFFERENT canonical_record_key (e.g. two chunk policies for the
 * same bytes) are two materializations of one document and are both kept. Refused, never merged:
 * two chunk sets under one key (REJECT_IDENTITY_COLLISION); one source under two registry scope
 * hashes (REJECT_SOURCE_SCOPE_MIXED); one document under two different NON-NULL lineage keys
 * (REJECT_LINEAGE_KEY_CONFLICT — a mirror of the same bytes must be given the same explicit key).
 */
export function buildCorpusSnapshot(
  projections: readonly CorpusDocumentProjection[],
  options: { readonly catalog_origin: string },
): CorpusSnapshot {
  const byRecordKey = new Map<string, CorpusDocumentProjection>();
  const scopeBySource = new Map<string, string>();
  const lineageKeyByDocument = new Map<string, string | null>();

  for (const p of projections) {
    if (p.catalog_origin !== options.catalog_origin) {
      throw new CorpusSnapshotError(
        `REJECT_MIXED_AUTHORITY: document ${p.document_id} was projected against catalog '${p.catalog_origin}', snapshot is '${options.catalog_origin}'.`,
      );
    }
    const scope = scopeBySource.get(p.source.source_id);
    if (scope !== undefined && scope !== p.source.registry_source_content_hash) {
      throw new CorpusSnapshotError(
        `REJECT_SOURCE_SCOPE_MIXED: source_id '${p.source.source_id}' appears under two registry scope hashes in one snapshot; a re-scoped registry requires review, not a merge.`,
      );
    }
    scopeBySource.set(p.source.source_id, p.source.registry_source_content_hash);

    const knownKey = lineageKeyByDocument.get(p.document_id);
    if (
      knownKey !== undefined &&
      knownKey !== null &&
      p.version_lineage_key !== null &&
      knownKey !== p.version_lineage_key
    ) {
      throw new CorpusSnapshotError(
        `REJECT_LINEAGE_KEY_CONFLICT: document ${p.document_id} carries two version lineage keys ('${knownKey}' and '${p.version_lineage_key}'); a mirrored publication must be given one explicit version_lineage_key.`,
      );
    }
    if (knownKey === undefined || knownKey === null)
      lineageKeyByDocument.set(p.document_id, p.version_lineage_key);

    const existing = byRecordKey.get(p.canonical_record_key);
    if (existing) {
      if (
        existing.chunk_set_content_hash !== p.chunk_set_content_hash ||
        existing.document_id !== p.document_id
      ) {
        throw new CorpusSnapshotError(
          `REJECT_IDENTITY_COLLISION: canonical_record_key ${p.canonical_record_key} produced two different chunk sets.`,
        );
      }
      // Byte-identical replay: keep the deterministically newest acquisition, whatever the input order.
      if (rankCompare(p, existing) < 0) byRecordKey.set(p.canonical_record_key, p);
      continue;
    }
    byRecordKey.set(p.canonical_record_key, p);
  }

  const documents = Object.freeze(
    [...byRecordKey.values()].sort(
      (a, b) =>
        codepointCompare(a.document_id, b.document_id) ||
        codepointCompare(a.canonical_record_key, b.canonical_record_key),
    ),
  );

  const duplicates = buildDuplicates(projections);
  const lineages = buildVersionLineages(documents, lineageKeyByDocument);
  const currency = currencyByDocument(documents, lineages);

  const snapshotIdentity = createHash('sha256')
    .update(
      canonicalizeStrict({
        snapshot_version: KNOWLEDGE_CORPUS_SNAPSHOT_VERSION,
        catalog_origin: options.catalog_origin,
        documents: documents.map((d) => [
          d.document_id,
          d.canonical_record_key,
          d.chunk_set_content_hash,
          projectionFingerprint(d),
        ]),
        version_state: documents.map((d) => [
          d.document_id,
          d.canonical_record_key,
          lineageKeyByDocument.get(d.document_id) ?? null,
          d.acquisition?.acquired_at ?? null,
          d.source_version_label ?? null,
          currency.get(d.document_id)!.is_current,
          currency.get(d.document_id)!.reason,
        ]),
      }),
      'utf8',
    )
    .digest('hex');

  return Object.freeze({
    snapshot_version: KNOWLEDGE_CORPUS_SNAPSHOT_VERSION,
    catalog_origin: options.catalog_origin,
    documents,
    duplicates,
    version_lineages: lineages,
    snapshot_identity: snapshotIdentity,
  });
}

function buildDuplicates(projections: readonly CorpusDocumentProjection[]): readonly DuplicateAcquisition[] {
  const byDocument = new Map<string, Map<string, CorpusDocumentProjection>>();
  for (const p of projections) {
    const acquisitions = byDocument.get(p.document_id) ?? new Map<string, CorpusDocumentProjection>();
    // One acquisition = one quarantine object (or, without one, one observed name).
    const acquisitionKey = p.acquisition?.quarantine_id ?? `name:${p.doc_name}`;
    if (!acquisitions.has(acquisitionKey)) acquisitions.set(acquisitionKey, p);
    byDocument.set(p.document_id, acquisitions);
  }
  const uniqSorted = (values: readonly (string | null | undefined)[]): readonly string[] =>
    Object.freeze(
      [...new Set(values.filter((v): v is string => typeof v === 'string'))].sort(codepointCompare),
    );
  return Object.freeze(
    [...byDocument.entries()]
      .filter(([, acquisitions]) => acquisitions.size > 1)
      .map(([document_id, acquisitions]) => {
        const all = [...acquisitions.values()];
        return Object.freeze({
          document_id,
          occurrences: acquisitions.size,
          doc_names: uniqSorted(all.map((p) => p.doc_name)),
          quarantine_ids: uniqSorted(all.map((p) => p.acquisition?.quarantine_id)),
          acquired_at: uniqSorted(all.map((p) => p.acquisition?.acquired_at)),
          source_version_labels: uniqSorted(all.map((p) => p.source_version_label)),
          source_urls: uniqSorted(all.map((p) => p.acquisition?.source_url)),
          version_lineage_keys: uniqSorted(all.map((p) => p.version_lineage_key)),
        });
      })
      .sort((a, b) => codepointCompare(a.document_id, b.document_id)),
  );
}

/**
 * A lineage = the DOCUMENTS of one source, one registry scope and one non-null lineage key (a
 * document's key is the single non-null key among its materializations). Currency is decided per
 * document from the newest valid acquisition instant among its materializations: the unique
 * newest document is NEWEST; an older document whose chunk set is byte-identical to the newest
 * one's is CONTENT_IDENTICAL_TO_NEWEST (same content re-fetched — current, not superseded); any
 * other is SUPERSEDED; a lineage with an undated document or a tie on the newest instant is
 * AMBIGUOUS and marks nobody current.
 */
function buildVersionLineages(
  documents: readonly CorpusDocumentProjection[],
  lineageKeyByDocument: ReadonlyMap<string, string | null>,
): readonly VersionLineage[] {
  const groups = new Map<string, CorpusDocumentProjection[]>();
  for (const d of documents) {
    const key = lineageKeyByDocument.get(d.document_id) ?? null;
    if (key === null) continue;
    const groupKey = `${d.source.source_id}\n${d.source.registry_source_content_hash}\n${key}`;
    const group = groups.get(groupKey) ?? [];
    group.push(d);
    groups.set(groupKey, group);
  }
  const lineages: VersionLineage[] = [];
  for (const group of groups.values()) {
    const byDocument = new Map<string, CorpusDocumentProjection[]>();
    for (const d of group) {
      const members = byDocument.get(d.document_id) ?? [];
      members.push(d);
      byDocument.set(d.document_id, members);
    }
    if (byDocument.size < 2) continue; // one document (possibly several chunk policies) -> no versioning question

    const documentInstant = new Map<string, number | null>();
    for (const [documentId, members] of byDocument) {
      const instants = members
        .map((m) => acquiredAtMs(m.acquisition?.acquired_at))
        .filter((x): x is number => x !== null);
      documentInstant.set(documentId, instants.length ? Math.max(...instants) : null);
    }
    const instants = [...documentInstant.values()];
    const anyUndated = instants.some((x) => x === null);
    const newest = anyUndated ? null : Math.max(...(instants as number[]));
    const newestDocuments =
      newest === null ? [] : [...documentInstant.entries()].filter(([, x]) => x === newest).map(([id]) => id);
    const ambiguous = newest === null || newestDocuments.length !== 1;
    const newestContent = ambiguous
      ? new Set<string>()
      : new Set(byDocument.get(newestDocuments[0]!)!.map((m) => m.chunk_set_content_hash));
    const reasonOf = (d: CorpusDocumentProjection): CurrencyReason => {
      if (ambiguous) return 'AMBIGUOUS';
      if (d.document_id === newestDocuments[0]) return 'NEWEST';
      if (newestContent.has(d.chunk_set_content_hash)) return 'CONTENT_IDENTICAL_TO_NEWEST';
      return 'SUPERSEDED';
    };
    const first = group[0]!;
    const members = group
      .map((d): VersionMember => {
        const reason = reasonOf(d);
        return Object.freeze({
          document_id: d.document_id,
          canonical_record_key: d.canonical_record_key,
          chunk_set_content_hash: d.chunk_set_content_hash,
          ...(d.acquisition?.acquired_at ? { acquired_at: d.acquisition.acquired_at } : {}),
          ...(d.source_version_label ? { source_version_label: d.source_version_label } : {}),
          is_current: reason === 'NEWEST' || reason === 'CONTENT_IDENTICAL_TO_NEWEST',
          currency_reason: reason,
        });
      })
      .sort(
        (a, b) =>
          codepointCompare(a.document_id, b.document_id) ||
          codepointCompare(a.canonical_record_key, b.canonical_record_key),
      );
    lineages.push(
      Object.freeze({
        source_id: first.source.source_id,
        registry_source_content_hash: first.source.registry_source_content_hash,
        version_lineage_key: lineageKeyByDocument.get(first.document_id) as string,
        currency_method: 'ACQUISITION_RECENCY',
        ambiguous_current: ambiguous,
        content_identical_members: new Set(
          members
            .filter((m) => m.currency_reason === 'CONTENT_IDENTICAL_TO_NEWEST')
            .map((m) => m.document_id),
        ).size,
        members: Object.freeze(members),
      }),
    );
  }
  return Object.freeze(
    lineages.sort(
      (a, b) =>
        codepointCompare(a.source_id, b.source_id) ||
        codepointCompare(a.version_lineage_key, b.version_lineage_key),
    ),
  );
}

export interface DocumentCurrency {
  readonly is_current: boolean;
  readonly method: CurrencyMethod;
  readonly reason: CurrencyReason;
}

/** Per-document currency: lineage members as decided by their (single) lineage; everything else NO_LINEAGE = current. */
export function currencyByDocument(
  documents: readonly Pick<CorpusDocumentProjection, 'document_id'>[],
  lineages: readonly VersionLineage[],
): ReadonlyMap<string, DocumentCurrency> {
  const out = new Map<string, DocumentCurrency>();
  for (const d of documents)
    out.set(d.document_id, Object.freeze({ is_current: true, method: 'NO_LINEAGE', reason: 'SINGLETON' }));
  const seen = new Map<string, string>();
  for (const lineage of lineages) {
    for (const m of lineage.members) {
      const previous = seen.get(m.document_id);
      if (previous !== undefined && previous !== lineage.version_lineage_key) {
        throw new CorpusSnapshotError(
          `REJECT_LINEAGE_KEY_CONFLICT: document ${m.document_id} is a member of two lineages ('${previous}', '${lineage.version_lineage_key}').`,
        );
      }
      seen.set(m.document_id, lineage.version_lineage_key);
      out.set(
        m.document_id,
        Object.freeze({ is_current: m.is_current, method: 'ACQUISITION_RECENCY', reason: m.currency_reason }),
      );
    }
  }
  return out;
}

export interface SnapshotVerificationViolation {
  readonly canonical_record_key: string;
  readonly code:
    | 'DOCUMENT_ID_MISMATCH'
    | 'RECORD_KEY_MISMATCH'
    | 'CHUNK_SET_HASH_MISMATCH'
    | 'PROVENANCE_CHAIN_BROKEN'
    | 'SNAPSHOT_IDENTITY_MISMATCH';
  readonly detail: string;
}

/**
 * Recomputes every identity in the snapshot from the fields it claims to be derived from (chunk
 * set hash from the chunks themselves, record key from the materialization identity, document id
 * from source + raw hash, chain links, and the snapshot identity from a rebuild). A stale,
 * tampered, or hand-edited snapshot fails here explicitly; nothing is repaired in place.
 */
export function verifyCorpusSnapshot(snapshot: CorpusSnapshot): readonly SnapshotVerificationViolation[] {
  const violations: SnapshotVerificationViolation[] = [];
  for (const d of snapshot.documents) {
    const expectedDocumentId = computeKnowledgeDocumentId({
      logical_source_id: d.source.source_id,
      registry_source_content_hash: d.source.registry_source_content_hash,
      raw_source_content_hash: d.raw_source_content_hash,
    });
    if (expectedDocumentId !== d.document_id) {
      violations.push({
        canonical_record_key: d.canonical_record_key,
        code: 'DOCUMENT_ID_MISMATCH',
        detail: `expected ${expectedDocumentId}`,
      });
    }
    const expectedKey = buildCanonicalLegalCorpusRecordKey(d.materialization_identity);
    if (expectedKey !== d.canonical_record_key) {
      violations.push({
        canonical_record_key: d.canonical_record_key,
        code: 'RECORD_KEY_MISMATCH',
        detail: `expected ${expectedKey}`,
      });
    }
    let chunkHash: string | null = null;
    try {
      chunkHash = computeChunkSetContentHash(d.chunks);
    } catch (err) {
      violations.push({
        canonical_record_key: d.canonical_record_key,
        code: 'CHUNK_SET_HASH_MISMATCH',
        detail: err instanceof Error ? err.message : String(err),
      });
    }
    if (chunkHash !== null && chunkHash !== d.chunk_set_content_hash) {
      violations.push({
        canonical_record_key: d.canonical_record_key,
        code: 'CHUNK_SET_HASH_MISMATCH',
        detail: `expected ${chunkHash}`,
      });
    }
    const stages = d.provenance_chain.map((l) => l.stage);
    const chainOk =
      stages.join('>') === 'SOURCE_REGISTRY>RAW_SOURCE>TEXT_PROJECTION>CHUNK_SET' &&
      d.provenance_chain[0]!.content_hash === d.source.registry_source_content_hash &&
      d.provenance_chain[1]!.content_hash === d.raw_source_content_hash &&
      d.provenance_chain[2]!.content_hash === d.text_projection.content_hash.value &&
      d.provenance_chain[3]!.content_hash === d.chunk_set_content_hash &&
      d.provenance_chain.every((l, i) =>
        i === 0 ? l.derived_from === null : l.derived_from === d.provenance_chain[i - 1]!.ref,
      );
    if (!chainOk) {
      violations.push({
        canonical_record_key: d.canonical_record_key,
        code: 'PROVENANCE_CHAIN_BROKEN',
        detail: 'chain stages/hashes do not derive from one another',
      });
    }
  }
  let rebuiltIdentity: string | null = null;
  try {
    rebuiltIdentity = buildCorpusSnapshot(snapshot.documents, {
      catalog_origin: snapshot.catalog_origin,
    }).snapshot_identity;
  } catch (err) {
    violations.push({
      canonical_record_key: '*',
      code: 'SNAPSHOT_IDENTITY_MISMATCH',
      detail: `snapshot cannot be rebuilt from its documents: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
  if (rebuiltIdentity !== null && rebuiltIdentity !== snapshot.snapshot_identity) {
    violations.push({
      canonical_record_key: '*',
      code: 'SNAPSHOT_IDENTITY_MISMATCH',
      detail: `expected ${rebuiltIdentity}`,
    });
  }
  return Object.freeze(violations);
}

export interface RelabeledMaterialization {
  readonly document_id: string;
  readonly previous_key: string;
  readonly next_key: string;
}

export interface IncrementalRebuildPlan {
  /** Keys in both snapshots with identical chunk-set content. Their VECTORS are reusable; row metadata (currency, labels) is always recomputed. */
  readonly unchanged: readonly string[];
  /** Keys in both snapshots whose chunk-set content differs (e.g. the chunker behind a policy label changed): rebuild AND drop the old rows. */
  readonly changed: readonly string[];
  /** Keys only in the next snapshot: project + index. */
  readonly added: readonly string[];
  /** Keys only in the previous snapshot: their index rows are stale and must be removed. */
  readonly removed: readonly string[];
  /**
   * added/removed pairs that are the SAME document (document_id) with the SAME chunk-set content
   * under a new canonical_record_key — a registry re-attestation relabel. The K2.1b materialization
   * identity binds the artifact id, so these DO re-materialize; the plan names them so the operator
   * can see that no content changed.
   */
  readonly relabeled: readonly RelabeledMaterialization[];
}

/** The structural minimum the plan needs — a full `CorpusSnapshot` satisfies it, and so does a compact run report. */
export interface RebuildPlanInput {
  readonly documents: readonly Pick<
    CorpusDocumentProjection,
    'document_id' | 'canonical_record_key' | 'chunk_set_content_hash'
  >[];
}

/** Deterministic diff by materialization identity. */
export function planIncrementalRebuild(
  previous: RebuildPlanInput | null,
  next: RebuildPlanInput,
): IncrementalRebuildPlan {
  const prevByKey = new Map((previous?.documents ?? []).map((d) => [d.canonical_record_key, d]));
  const nextByKey = new Map(next.documents.map((d) => [d.canonical_record_key, d]));
  const unchanged: string[] = [];
  const changed: string[] = [];
  const added: string[] = [];
  const removed: string[] = [];
  for (const [key, doc] of nextByKey) {
    const prev = prevByKey.get(key);
    if (!prev) added.push(key);
    else if (prev.chunk_set_content_hash === doc.chunk_set_content_hash) unchanged.push(key);
    else changed.push(key);
  }
  for (const key of prevByKey.keys()) if (!nextByKey.has(key)) removed.push(key);

  const relabeled: RelabeledMaterialization[] = [];
  const removedByContent = new Map<string, string[]>();
  for (const key of removed.sort(codepointCompare)) {
    const d = prevByKey.get(key)!;
    const content = `${d.document_id}\n${d.chunk_set_content_hash}`;
    removedByContent.set(content, [...(removedByContent.get(content) ?? []), key]);
  }
  for (const key of added.sort(codepointCompare)) {
    const d = nextByKey.get(key)!;
    const content = `${d.document_id}\n${d.chunk_set_content_hash}`;
    const previousKey = removedByContent.get(content)?.shift();
    if (previousKey !== undefined)
      relabeled.push({ document_id: d.document_id, previous_key: previousKey, next_key: key });
  }

  return Object.freeze({
    unchanged: Object.freeze(unchanged.sort(codepointCompare)),
    changed: Object.freeze(changed.sort(codepointCompare)),
    added: Object.freeze(added),
    removed: Object.freeze(removed),
    relabeled: Object.freeze(relabeled.sort((a, b) => codepointCompare(a.next_key, b.next_key))),
  });
}
