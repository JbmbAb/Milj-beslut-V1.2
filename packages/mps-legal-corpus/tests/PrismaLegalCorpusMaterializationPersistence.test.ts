import { describe, expect, it } from 'vitest';

import {
  PrismaLegalCorpusMaterializationPersistence,
  type PrismaLegalCorpusClient,
} from '../../../server/modules/legal/services/PrismaLegalCorpusMaterializationPersistence';

describe('PrismaLegalCorpusMaterializationPersistence', () => {
  it('writes the three governed rows through one transaction and never stores a legacy alias', async () => {
    const calls: Array<{ model: string; data: Record<string, unknown> }> = [];
    const client: PrismaLegalCorpusClient = {
      async $transaction(work) {
        return work({
          legalCorpusRecord: { async create({ data }) { calls.push({ model: 'record', data }); return { id: 'record-1' }; } },
          legalCorpusMaterialization: { async create({ data }) { calls.push({ model: 'materialization', data }); return { id: 'materialization-1' }; } },
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
        },
      });
      await tx.createIngestionManifestEntry({
        run_id: 'run-1', document_id: 'canonical:legal-corpus:abc', ingestion_status: 'INGESTED',
        admission_outcome: 'ADMITTED', materialization_id: materialization.id,
        source_manifest_ref: { id: 'manifest-1', content_hash: { algorithm: 'sha256', digest: 'd'.repeat(64) } },
        corpus_import_attestation: {} as never,
        corpus_import_attestation_ref: { id: 'attestation-1', content_hash: { algorithm: 'sha256', digest: 'e'.repeat(64) } },
      });
    });

    expect(calls.map((call) => call.model)).toEqual(['record', 'materialization', 'manifest']);
    expect(calls[0].data.recordKey).toBe('canonical:legal-corpus:abc');
    expect(calls[1].data).not.toHaveProperty('legacyRecordKey');
  });
});
