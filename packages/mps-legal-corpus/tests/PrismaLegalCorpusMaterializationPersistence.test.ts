import { describe, expect, it } from 'vitest';

import {
  PrismaLegalCorpusMaterializationPersistence,
  type PrismaLegalCorpusClient,
} from '../../../server/modules/legal/services/PrismaLegalCorpusMaterializationPersistence';

describe('PrismaLegalCorpusMaterializationPersistence', () => {
  it('writes the four governed rows (record, materialization, chunks, manifest) through one transaction and never stores a legacy alias', async () => {
    const calls: Array<{ model: string; data: Record<string, unknown> }> = [];
    const chunkCreateManyArgs: Array<{ data: Record<string, unknown>[]; skipDuplicates?: boolean }> = [];
    const client: PrismaLegalCorpusClient = {
      async $transaction(work) {
        return work({
          legalCorpusRecord: { async upsert({ create }) { calls.push({ model: 'record', data: create }); return { id: 'record-1' }; } },
          legalCorpusMaterialization: { async upsert({ create }) { calls.push({ model: 'materialization', data: create }); return { id: 'materialization-1' }; } },
          legalCorpusMaterializedChunk: {
            async createMany(args) { calls.push({ model: 'chunks', data: {} }); chunkCreateManyArgs.push(args); return { count: args.data.length }; },
          },
          legalCorpusIngestionManifestEntry: { async create({ data }) { calls.push({ model: 'manifest', data }); return {}; } },
        });
      },
    };
    const persistence = new PrismaLegalCorpusMaterializationPersistence(client);

    await persistence.transaction(async (tx) => {
      const record = await tx.createCanonicalCorpusRecord({
        record_key: 'canonical:legal-corpus:abc', title: 'Miljobalken', source_path: 'p2://q-1',
        document_text: 'text', search_text: 'text', source_family: 'SFS', source_type: 'LAW',
        source_system: 'regeringskansliet', content_hash: 'a'.repeat(64), byte_size: 4, metadata: {},
      });
      const materialization = await tx.createMaterialization({
        canonical_record_key: 'canonical:legal-corpus:abc', corpus_record_id: record.id,
        raw_source_ref: { quarantine_id: 'q-1' },
        identity: {
          logical_source_id: 'regeringskansliet-sfs-1998-808', registry_artifact_id: 'reg-1',
          registry_source_content_hash: 'b'.repeat(64), raw_source_content_hash: 'a'.repeat(64),
          text_projection_artifact_id: 'projection-1', text_projection_hash: 'c'.repeat(64),
          text_projection_version: 'v1.0', corpus_materialization_version: 'corpus-materialization-v1',
          chunk_policy_version: 'legal-chunker-v2.3',
        },
      });
      await tx.createChunks({
        materialization_id: materialization.id,
        record_id: record.id,
        chunks: [
          {
            fragment_id: 'frag:abc', structure_kind: 'law', sequence: 0,
            chapter: '1', paragraph: '1', chunk_text: 'Text.', content_hash: 'f'.repeat(64),
            source_projection_ref: 'sha256:proj-1', chunk_policy_version: 'legal-chunker-v2.3',
          },
        ],
      });
      await tx.createIngestionManifestEntry({
        run_id: 'run-1', document_id: 'canonical:legal-corpus:abc', ingestion_status: 'INGESTED',
        admission_outcome: 'ADMITTED', materialization_id: materialization.id,
        source_manifest_ref: { id: 'manifest-1', content_hash: { algorithm: 'sha256', digest: 'd'.repeat(64) } },
        corpus_import_attestation: {} as never,
        corpus_import_attestation_ref: { id: 'attestation-1', content_hash: { algorithm: 'sha256', digest: 'e'.repeat(64) } },
      });
    });

    expect(calls.map((call) => call.model)).toEqual(['record', 'materialization', 'chunks', 'manifest']);
    expect(calls[0].data.recordKey).toBe('canonical:legal-corpus:abc');
    expect(calls[1].data).not.toHaveProperty('legacyRecordKey');
    expect(chunkCreateManyArgs[0]?.skipDuplicates).toBe(true);
    expect(chunkCreateManyArgs[0]?.data[0]).toMatchObject({
      fragmentId: 'frag:abc', materializationId: 'materialization-1', recordId: 'record-1',
      structureKind: 'law', sequence: 0, chapter: '1', paragraph: '1', chunkText: 'Text.',
    });
    expect(chunkCreateManyArgs[0]?.data[0]).not.toHaveProperty('courtSection');
  });

  it('createCanonicalCorpusRecord and createMaterialization upsert by identity, not create -- a replay reaching the same key does not error', async () => {
    const recordUpserts: Array<{ where: Record<string, unknown> }> = [];
    const materializationUpserts: Array<{ where: Record<string, unknown> }> = [];
    const client: PrismaLegalCorpusClient = {
      async $transaction(work) {
        return work({
          legalCorpusRecord: {
            async upsert(args) { recordUpserts.push(args); return { id: 'record-1' }; },
          },
          legalCorpusMaterialization: {
            async upsert(args) { materializationUpserts.push(args); return { id: 'materialization-1' }; },
          },
          legalCorpusMaterializedChunk: { async createMany(args) { return { count: args.data.length }; } },
          legalCorpusIngestionManifestEntry: { async create() { return {}; } },
        });
      },
    };
    const persistence = new PrismaLegalCorpusMaterializationPersistence(client);

    const doRun = () => persistence.transaction(async (tx) => {
      const record = await tx.createCanonicalCorpusRecord({
        record_key: 'canonical:legal-corpus:replay-test', title: 'T', source_path: 'p',
        document_text: 't', search_text: 't', source_family: 'SFS', source_type: 'LAW',
        source_system: 'regeringskansliet', content_hash: 'a'.repeat(64), byte_size: 1, metadata: {},
      });
      return tx.createMaterialization({
        canonical_record_key: 'canonical:legal-corpus:replay-test', corpus_record_id: record.id,
        raw_source_ref: {},
        identity: {
          logical_source_id: 'x', registry_artifact_id: 'y', registry_source_content_hash: 'a'.repeat(64),
          raw_source_content_hash: 'a'.repeat(64), text_projection_artifact_id: 'z',
          text_projection_hash: 'a'.repeat(64), text_projection_version: 'v1', corpus_materialization_version: 'v1',
          chunk_policy_version: 'legal-chunker-v2.3',
        },
      });
    });

    const first = await doRun();
    const second = await doRun();

    expect(first.id).toBe(second.id);
    expect(recordUpserts).toHaveLength(2);
    expect(recordUpserts[0]!.where).toEqual(recordUpserts[1]!.where);
    expect(materializationUpserts).toHaveLength(2);
    expect(materializationUpserts[0]!.where).toEqual(materializationUpserts[1]!.where);
  });

  it('createChunks is a no-op when there are zero admitted chunks (e.g. a NOT_ADMITTED_TO_PARAGRAPH_CORPUS document)', async () => {
    let createManyCalled = false;
    const client: PrismaLegalCorpusClient = {
      async $transaction(work) {
        return work({
          legalCorpusRecord: { async upsert() { return { id: 'record-1' }; } },
          legalCorpusMaterialization: { async upsert() { return { id: 'materialization-1' }; } },
          legalCorpusMaterializedChunk: {
            async createMany(args) { createManyCalled = true; return { count: args.data.length }; },
          },
          legalCorpusIngestionManifestEntry: { async create() { return {}; } },
        });
      },
    };
    const persistence = new PrismaLegalCorpusMaterializationPersistence(client);

    await persistence.transaction(async (tx) => {
      await tx.createChunks({ materialization_id: 'materialization-1', record_id: 'record-1', chunks: [] });
    });

    expect(createManyCalled).toBe(false);
  });
});
