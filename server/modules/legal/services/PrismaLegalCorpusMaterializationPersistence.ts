import type {
  CanonicalLegalCorpusRecordInput,
  LegalCorpusIngestionManifestWrite,
  LegalCorpusMaterializationPersistence,
  LegalCorpusMaterializationTransaction,
  LegalCorpusMaterializationWrite,
} from '@miljobeslut/mps-legal-corpus';

/**
 * Postgres adapter for LEGAL_CORPUS_MATERIALIZATION_PERSISTENCE_V1.
 *
 * This adapter deliberately accepts a transaction-only port. It is unable to write provenance
 * before the caller has passed CorpusImportGate, because it exposes no write method outside
 * `$transaction`.
 */
export interface PrismaLegalCorpusTransactionClient {
  readonly legalCorpusRecord: { create(args: { data: Record<string, unknown> }): Promise<{ id: string }> };
  readonly legalCorpusMaterialization: { create(args: { data: Record<string, unknown> }): Promise<{ id: string }> };
  readonly legalCorpusIngestionManifestEntry: { create(args: { data: Record<string, unknown> }): Promise<unknown> };
}

export interface PrismaLegalCorpusClient {
  $transaction<T>(work: (tx: PrismaLegalCorpusTransactionClient) => Promise<T>): Promise<T>;
}

export class PrismaLegalCorpusMaterializationPersistence
  implements LegalCorpusMaterializationPersistence {
  constructor(private readonly prisma: PrismaLegalCorpusClient) {}

  transaction<T>(work: (tx: LegalCorpusMaterializationTransaction) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (prisma) => work({
      createCanonicalCorpusRecord: async (input) => {
        return prisma.legalCorpusRecord.create({
          data: {
            recordKey: input.record_key,
            canonicalKey: input.record_key,
            sourceFamily: input.source_family,
            sourceType: input.source_type,
            sourceSystem: input.source_system,
            ...(input.external_id ? { externalId: input.external_id } : {}),
            title: input.title,
            ...(input.authority_name ? { authorityName: input.authority_name } : {}),
            ...(input.authority_type ? { authorityType: input.authority_type } : {}),
            ...(input.mime_type ? { mimeType: input.mime_type } : {}),
            ...(input.source_url ? { sourceUrl: input.source_url } : {}),
            sourcePath: input.source_path,
            documentText: input.document_text,
            searchText: input.search_text,
            contentHash: input.content_hash,
            byteSize: input.byte_size,
            metadata: input.metadata,
          },
        });
      },
      createMaterialization: async (input) => {
        return prisma.legalCorpusMaterialization.create({
          data: {
            canonicalRecordKey: input.canonical_record_key,
            logicalSourceId: input.identity.logical_source_id,
            registryArtifactId: input.identity.registry_artifact_id,
            registrySourceContentHash: input.identity.registry_source_content_hash,
            rawSourceRef: input.raw_source_ref,
            rawSourceContentHash: input.identity.raw_source_content_hash,
            textProjectionArtifactId: input.identity.text_projection_artifact_id,
            textProjectionHash: input.identity.text_projection_hash,
            textProjectionVersion: input.identity.text_projection_version,
            corpusMaterializationVersion: input.identity.corpus_materialization_version,
            corpusRecordId: input.corpus_record_id,
          },
        });
      },
      createIngestionManifestEntry: async (input) => {
        await prisma.legalCorpusIngestionManifestEntry.create({
          data: {
            runId: input.run_id,
            documentId: input.document_id,
            materializationId: input.materialization_id,
            ingestionStatus: input.ingestion_status,
            admissionOutcome: input.admission_outcome,
            sourceManifestRef: input.source_manifest_ref,
            corpusImportAttestation: input.corpus_import_attestation,
            corpusImportAttestationRef: input.corpus_import_attestation_ref,
          },
        });
      },
    }));
  }
}
