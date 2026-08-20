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
  readonly legalCorpusRecord: {
    upsert(args: {
      where: Record<string, unknown>;
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    }): Promise<{ id: string }>;
  };
  readonly legalCorpusMaterialization: {
    upsert(args: {
      where: Record<string, unknown>;
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    }): Promise<{ id: string }>;
  };
  readonly legalCorpusMaterializedChunk: {
    createMany(args: { data: Record<string, unknown>[]; skipDuplicates?: boolean }): Promise<{ count: number }>;
  };
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
      // Both records below are upsert-by-identity, not create: `record_key` /
      // `canonical_record_key` are themselves content-derived (LegalCorpusMaterializationIdentity),
      // so a second write reaching the SAME key is a replay of the identical governed input, not
      // a new fact -- the `update` clause re-asserts the same values rather than changing
      // anything, so a replay is a genuine no-op, never a duplicate row and never a silent
      // mutation of different content under an unchanged key.
      createCanonicalCorpusRecord: async (input) => {
        const data = {
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
        };
        return prisma.legalCorpusRecord.upsert({
          where: { recordKey: input.record_key },
          create: data,
          update: data,
        });
      },
      createMaterialization: async (input) => {
        const data = {
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
          chunkPolicyVersion: input.identity.chunk_policy_version,
          corpusRecordId: input.corpus_record_id,
        };
        return prisma.legalCorpusMaterialization.upsert({
          where: { canonicalRecordKey: input.canonical_record_key },
          create: data,
          update: data,
        });
      },
      createChunks: async (input) => {
        if (input.chunks.length === 0) return;
        // skipDuplicates: replay-safety at the DB layer, on top of the identity/gate layer --
        // the SAME materialization_id + fragment_id re-persisted (a genuine replay of the same
        // governed input) is silently a no-op insert, never a constraint-violation error and
        // never a second row. A DIFFERENT chunk_policy_version produces a DIFFERENT
        // materialization_id upstream (LegalCorpusMaterializationIdentity), so it is never the
        // same insert set -- old rows under the old materialization are never touched.
        await prisma.legalCorpusMaterializedChunk.createMany({
          data: input.chunks.map((chunk) => ({
            fragmentId: chunk.fragment_id,
            materializationId: input.materialization_id,
            recordId: input.record_id,
            structureKind: chunk.structure_kind,
            sequence: chunk.sequence,
            ...(chunk.chapter ? { chapter: chunk.chapter } : {}),
            ...(chunk.paragraph ? { paragraph: chunk.paragraph } : {}),
            ...(chunk.law_section ? { lawSection: chunk.law_section } : {}),
            ...(chunk.court_section ? { courtSection: chunk.court_section } : {}),
            chunkText: chunk.chunk_text,
            contentHash: chunk.content_hash,
            sourceProjectionRef: chunk.source_projection_ref,
            chunkPolicyVersion: chunk.chunk_policy_version,
          })),
          skipDuplicates: true,
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
