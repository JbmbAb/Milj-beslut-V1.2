import { createHash } from 'node:crypto';

import { canonicalizeStrict, type ArtifactAttestation } from '@miljobeslut/mimers-brunn-core';
import type { ContentReference } from '@miljobeslut/mps-core';

import {
  buildCanonicalLegalCorpusRecordKey,
  type LegalCorpusMaterializationIdentityInput,
} from './LegalCorpusMaterializationIdentity';
import { CorpusImportGate, type CorpusImportBatchRequest, type LegalChunk } from './CorpusImportGate';
import type { IngestionManifestEntry } from './IngestionManifest';

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

/** Transaction-only write surface. No pre-gate method is present by construction. */
export interface LegalCorpusMaterializationTransaction {
  createCanonicalCorpusRecord(input: CanonicalLegalCorpusRecordInput & { readonly record_key: string }): Promise<{ readonly id: string }>;
  createMaterialization(input: LegalCorpusMaterializationWrite & { readonly corpus_record_id: string }): Promise<{ readonly id: string }>;
  createIngestionManifestEntry(input: LegalCorpusIngestionManifestWrite & { readonly materialization_id: string }): Promise<void>;
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
      throw new Error('REJECT_LEGACY_RECORD_KEY: canonical materialization cannot target a legacy record key.');
    }

    const imports = request.gate_request.imports;
    if (imports.length !== 1 || imports[0].documentId !== canonicalRecordKey) {
      throw new Error('REJECT_MATERIALIZATION_BATCH: one canonical materialization requires one matching gated document.');
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

function buildAttestationReference(attestation: ArtifactAttestation): ContentReference {
  const digest = createHash('sha256').update(canonicalizeStrict(attestation), 'utf8').digest('hex');
  return {
    id: `legal-corpus-import-attestation-${digest.slice(0, 16)}`,
    content_hash: { algorithm: 'sha256', digest },
  };
}
