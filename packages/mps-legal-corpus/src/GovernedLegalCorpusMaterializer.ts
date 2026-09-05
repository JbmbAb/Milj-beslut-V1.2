import { createHash } from 'node:crypto';

import { canonicalizeStrict, type ArtifactAttestation } from '@miljobeslut/mimers-brunn-core';
import type { ContentReference } from '@miljobeslut/mps-core';

import {
  buildCanonicalLegalCorpusRecordKey,
  type LegalCorpusMaterializationIdentityInput,
} from './LegalCorpusMaterializationIdentity';
import { CorpusImportGate, type CorpusImportBatchRequest, type LegalChunk } from './CorpusImportGate';
import type { LegalCorpusImportAttestationPredicate } from './CorpusImportAttestation';
import type { IngestionManifestEntry } from './IngestionManifest';
import type { ChunkStructureKind } from './ChunkIdentity';

export const CORPUS_MATERIALIZATION_VERSION = 'corpus-materialization-v1' as const;

export interface CanonicalLegalCorpusRecordInput {
  readonly title: string;
  readonly source_path: string;
  readonly source_url?: string;
  readonly document_text: string;
  readonly search_text: string;
  readonly source_family: string;
  readonly source_type: string;
  readonly source_system: string;
  readonly external_id?: string;
  readonly authority_name?: string;
  readonly authority_type?: string;
  readonly mime_type?: string;
  readonly content_hash: string;
  readonly byte_size: number;
  readonly metadata: Readonly<Record<string, unknown>>;
}

export interface LegalCorpusMaterializationWrite {
  readonly canonical_record_key: string;
  readonly identity: LegalCorpusMaterializationIdentityInput;
  readonly raw_source_ref: Readonly<Record<string, unknown>>;
}

export interface LegalCorpusIngestionManifestWrite {
  readonly run_id: string;
  readonly document_id: string;
  readonly ingestion_status: 'INGESTED';
  readonly admission_outcome: 'ADMITTED';
  readonly source_manifest_ref: ContentReference;
  readonly corpus_import_attestation: ArtifactAttestation;
  readonly corpus_import_attestation_ref: ContentReference;
}

/**
 * LEGAL-CORPUS-CHUNK-PERSISTENCE-V1 (F2).
 *
 * One row per admitted chunk, content-addressed via `fragment_id`. `chapter`/`paragraph` are
 * present only for `law` chunks; `law_section`/`court_section` are two distinct optional fields
 * (never one shared "section") so a court section can never be read back as if it were a law
 * citation or vice versa.
 */
export interface LegalCorpusChunkWrite {
  readonly fragment_id: string;
  readonly structure_kind: ChunkStructureKind;
  readonly sequence: number;
  readonly chapter?: string;
  readonly paragraph?: string;
  readonly law_section?: string;
  readonly court_section?: string;
  readonly chunk_text: string;
  readonly content_hash: string;
  readonly source_projection_ref: string;
  readonly chunk_policy_version: string;
}

/** Transaction-only write surface. No pre-gate method is present by construction. */
export interface LegalCorpusMaterializationTransaction {
  createCanonicalCorpusRecord(
    input: CanonicalLegalCorpusRecordInput & { readonly record_key: string },
  ): Promise<{ readonly id: string }>;
  createMaterialization(
    input: LegalCorpusMaterializationWrite & { readonly corpus_record_id: string },
  ): Promise<{ readonly id: string }>;
  /**
   * Insert-only, replay-safe by `fragment_id` within `materialization_id` (the persistence
   * adapter must not error or duplicate rows when the same fragment is re-persisted under the
   * SAME materialization -- see PrismaLegalCorpusMaterializationPersistence's skipDuplicates).
   * A different chunk_policy_version produces a different materialization identity upstream, so
   * it never reaches this method with the same materialization_id -- old chunk rows are
   * therefore never overwritten, only ever added alongside under their own materialization.
   */
  createChunks(input: {
    readonly materialization_id: string;
    readonly record_id: string;
    readonly chunks: readonly LegalCorpusChunkWrite[];
  }): Promise<void>;
  createIngestionManifestEntry(
    input: LegalCorpusIngestionManifestWrite & { readonly materialization_id: string },
  ): Promise<void>;
}

export interface LegalCorpusMaterializationPersistence {
  transaction<T>(work: (tx: LegalCorpusMaterializationTransaction) => Promise<T>): Promise<T>;
}

/** P2-owned DownloadManifest resolver port; corpus receives a reference, never a copied body. */
export interface SourceManifestResolver {
  resolve(reference: ContentReference): Promise<unknown | null>;
}

export interface GovernedLegalCorpusMaterializationRequest {
  readonly gate_request: CorpusImportBatchRequest;
  readonly manifest_entry: IngestionManifestEntry;
  readonly identity: LegalCorpusMaterializationIdentityInput;
  readonly raw_source_ref: Readonly<Record<string, unknown>>;
  readonly corpus_record: CanonicalLegalCorpusRecordInput;
}

/**
 * LEGAL_CORPUS_MATERIALIZATION_PERSISTENCE_V1.
 *
 * The import gate authorizes bytes/chunks; this service persists the three resulting read-model
 * rows only after that authorization has passed. It has no downloader, registry reader, or
 * signing capability, and cannot turn legacy seeded rows into governed ones.
 */
export class GovernedLegalCorpusMaterializer {
  constructor(
    private readonly gate: CorpusImportGate,
    private readonly persistence: LegalCorpusMaterializationPersistence,
    private readonly sourceManifestResolver: SourceManifestResolver,
  ) {}

  async materialize(request: GovernedLegalCorpusMaterializationRequest): Promise<{
    readonly canonical_record_key: string;
    readonly corpus_record_id: string;
  }> {
    const canonicalRecordKey = buildCanonicalLegalCorpusRecordKey(request.identity);
    if (canonicalRecordKey.startsWith('foundation:')) {
      throw new Error(
        'REJECT_LEGACY_RECORD_KEY: canonical materialization cannot target a legacy record key.',
      );
    }

    const imports = request.gate_request.imports;
    if (imports.length !== 1 || imports[0].documentId !== canonicalRecordKey) {
      throw new Error(
        'REJECT_MATERIALIZATION_BATCH: one canonical materialization requires one matching gated document.',
      );
    }
    if (request.manifest_entry.document_id !== canonicalRecordKey) {
      throw new Error('REJECT_MATERIALIZATION_MANIFEST: manifest entry must bind the canonical record key.');
    }
    const sourceManifest = await this.sourceManifestResolver.resolve(
      request.manifest_entry.source_manifest_ref,
    );
    if (sourceManifest === null) {
      throw new Error('REJECT_MATERIALIZATION_MANIFEST: source_manifest_ref is not resolvable in P2.');
    }

    // GATE_BEFORE_WRITE_V1: this has no persistence side effects.
    const validated = await this.gate.validateBatch(request.gate_request);
    const approved = validated.imports[0];

    // K2.1b finding 4: the gate proves the SIGNED predicate's registry binding resolves to a
    // currently-APPROVED registry entry. It cannot prove that the identity actually being
    // PERSISTED names that same entry — `identity.registry_artifact_id` /
    // `registry_source_content_hash` travel here separately from the attestation and land
    // verbatim in the materialization row. Without this comparison, a valid attestation for
    // registry entry X could be paired with an identity claiming entry Y, and the persisted
    // provenance would name an authority nothing ever checked. Compared after the gate, so a
    // mismatch can never be read as an attestation-validity failure.
    const predicate = (approved.attestation?.predicate ??
      {}) as Partial<LegalCorpusImportAttestationPredicate>;
    if (predicate.registry_artifact_id !== request.identity.registry_artifact_id) {
      throw new Error(
        'REJECT_MATERIALIZATION_REGISTRY_BINDING: the attested registry_artifact_id does not ' +
          'match the registry_artifact_id of the identity being materialized.',
      );
    }
    if (predicate.registry_source_content_hash !== request.identity.registry_source_content_hash) {
      throw new Error(
        'REJECT_MATERIALIZATION_REGISTRY_BINDING: the attested registry_source_content_hash ' +
          'does not match the registry_source_content_hash of the identity being materialized.',
      );
    }

    const attestationRef = buildAttestationReference(approved.attestation);

    return this.persistence.transaction(async (tx) => {
      const corpusRecord = await tx.createCanonicalCorpusRecord({
        ...request.corpus_record,
        record_key: canonicalRecordKey,
      });
      const materialization = await tx.createMaterialization({
        canonical_record_key: canonicalRecordKey,
        identity: request.identity,
        raw_source_ref: request.raw_source_ref,
        corpus_record_id: corpusRecord.id,
      });
      await tx.createChunks({
        materialization_id: materialization.id,
        record_id: corpusRecord.id,
        chunks: approved.chunks.map(mapChunkForPersistence),
      });
      await tx.createIngestionManifestEntry({
        run_id: request.gate_request.runId,
        document_id: canonicalRecordKey,
        ingestion_status: 'INGESTED',
        admission_outcome: 'ADMITTED',
        source_manifest_ref: request.manifest_entry.source_manifest_ref,
        corpus_import_attestation: approved.attestation,
        corpus_import_attestation_ref: attestationRef,
        materialization_id: materialization.id,
      });

      return { canonical_record_key: canonicalRecordKey, corpus_record_id: corpusRecord.id };
    });
  }
}

/** `LegalChunk` (identity) -> `LegalCorpusChunkWrite` (persistence). Never fabricates a field the
 *  chunk's own family doesn't carry -- `chapter`/`paragraph` only exist on `law`, `court_section`
 *  only exists on `court`, so the destination row's optional columns are left undefined exactly
 *  where the source chunk itself has no claim to make. */
function mapChunkForPersistence(chunk: LegalChunk): LegalCorpusChunkWrite {
  const base = {
    fragment_id: chunk.fragment_id,
    structure_kind: chunk.structure_kind,
    sequence: chunk.sequence,
    chunk_text: chunk.full_text,
    content_hash: createHash('sha256').update(chunk.full_text, 'utf8').digest('hex'),
    source_projection_ref: chunk.source_projection_ref,
    chunk_policy_version: chunk.chunk_policy_version,
  };
  if (chunk.structure_kind === 'law') {
    return { ...base, chapter: chunk.chapter, paragraph: chunk.paragraph, law_section: chunk.section };
  }
  if (chunk.structure_kind === 'court') {
    return { ...base, court_section: chunk.court_section };
  }
  return base;
}

function buildAttestationReference(attestation: ArtifactAttestation): ContentReference {
  const digest = createHash('sha256').update(canonicalizeStrict(attestation), 'utf8').digest('hex');
  return {
    id: `legal-corpus-import-attestation-${digest.slice(0, 16)}`,
    content_hash: { algorithm: 'sha256', digest },
  };
}
