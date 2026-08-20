import { describe, expect, it } from 'vitest';
import {
  createArtifactAttestation,
  LocalPemSigningKeyProvider,
  type ArtifactAttestation,
} from '@miljobeslut/mimers-brunn-core';

import {
  buildCanonicalLegalCorpusRecordKey,
  computeChunkSetContentHash,
  CorpusImportGate,
  GovernedLegalCorpusMaterializer,
  LEGAL_CORPUS_IMPORT_ACTION,
  LEGAL_CORPUS_IMPORT_ATTESTATION_SCHEMA_VERSION,
  LEGAL_CORPUS_IMPORT_PREDICATE_TYPE,
  type CorpusImportBatchRequest,
  type IngestionManifestEntry,
  type LegalChunk,
  type LegalCorpusMaterializationIdentityInput,
  type LegalCorpusMaterializationPersistence,
  type LegalCorpusMaterializationTransaction,
  type ManifestStore,
} from '../src';

const signing = LocalPemSigningKeyProvider.generate('ed25519:test-materialization').provider;
const chunks: readonly LegalChunk[] = [{
  fragment_id: 'MB:1:1', structure_kind: 'law', chapter: '1', paragraph: '1', full_text: 'Miljobalken.',
  references_to: [], case_citations: [], chunk_policy_version: 'legal-chunker-v2.3',
  source_projection_ref: 'sha256:test-projection-ref', sequence: 0,
}];

function identity(raw = 'a'.repeat(64)): LegalCorpusMaterializationIdentityInput {
  return {
    logical_source_id: 'regeringskansliet-sfs-1998-808',
    registry_artifact_id: 'reg-rk-sfs-1998-808-001',
    registry_source_content_hash: 'b'.repeat(64),
    raw_source_content_hash: raw,
    text_projection_artifact_id: 'text-projection-1',
    text_projection_hash: 'c'.repeat(64),
    text_projection_version: 'v1.0',
    corpus_materialization_version: 'corpus-materialization-v1',
  };
}

async function attestation(documentId: string, sourceContentHash = 'a'.repeat(64)): Promise<ArtifactAttestation> {
  const hash = computeChunkSetContentHash(chunks);
  return createArtifactAttestation({
    subjectDigest: `sha256:${hash}`,
    predicateType: LEGAL_CORPUS_IMPORT_PREDICATE_TYPE,
    predicate: {
      action: LEGAL_CORPUS_IMPORT_ACTION,
      document_id: documentId,
      source_content_hash: sourceContentHash,
      chunk_set_content_hash: hash,
      pipeline_version: 'text-v1.0',
      chunk_policy_version: 'legal-chunker-v2.3',
      approver_actor_id: 'reviewer-1',
      approver_role: 'GOVERNANCE_REVIEWER',
      attestation_schema_version: LEGAL_CORPUS_IMPORT_ATTESTATION_SCHEMA_VERSION,
      signer_key_id: signing.keyId,
    },
    signing,
  });
}

function requestFor(input = identity()): Promise<{
  readonly gate_request: CorpusImportBatchRequest;
  readonly manifest_entry: IngestionManifestEntry;
  readonly identity: LegalCorpusMaterializationIdentityInput;
  readonly raw_source_ref: Record<string, unknown>;
  readonly corpus_record: {
    title: string; source_path: string; document_text: string; search_text: string;
    source_family: string; source_type: string; source_system: string; content_hash: string;
    byte_size: number; metadata: Record<string, unknown>;
  };
}> {
  const documentId = buildCanonicalLegalCorpusRecordKey(input);
  return attestation(documentId, input.raw_source_content_hash).then((signed) => {
    const entry: IngestionManifestEntry = {
      document_id: documentId,
      source_manifest_ref: { id: 'download-manifest-1', content_hash: { algorithm: 'sha256', digest: 'd'.repeat(64) } },
      status: 'INGESTED', classification: {}, content_hash: input.raw_source_content_hash,
      pipeline_version: 'text-v1.0', processed_at: '2026-08-17T00:00:00.000Z',
      corpus_import_attestation_ref: { id: 'attestation-1', content_hash: { algorithm: 'sha256', digest: 'e'.repeat(64) } },
    };
    return {
      gate_request: { runId: 'run-1', expectedDocumentIds: [documentId], imports: [{ documentId, chunks, attestation: signed }] },
      manifest_entry: entry,
      identity: input,
      raw_source_ref: { quarantine_id: 'q-1', content_hash: input.raw_source_content_hash },
      corpus_record: {
        title: 'Miljobalken', source_path: 'p2://q-1', document_text: 'Miljobalken.',
        search_text: 'Miljobalken.', source_family: 'SFS', source_type: 'LAW',
        source_system: 'regeringskansliet', content_hash: input.raw_source_content_hash,
        byte_size: 12, metadata: { governed: true },
      },
    };
  });
}

class SingleEntryManifestStore implements ManifestStore {
  constructor(private readonly entry: IngestionManifestEntry) {}
  async listEntries(): Promise<readonly IngestionManifestEntry[]> { return [this.entry]; }
}

class AtomicMemoryPersistence implements LegalCorpusMaterializationPersistence {
  readonly committed: string[] = [];
  failAt?: 'record' | 'materialization' | 'manifest';
  async transaction<T>(work: (tx: LegalCorpusMaterializationTransaction) => Promise<T>): Promise<T> {
    const staged: string[] = [];
    const tx: LegalCorpusMaterializationTransaction = {
      createCanonicalCorpusRecord: async () => {
        if (this.failAt === 'record') throw new Error('record failure');
        staged.push('record'); return { id: 'record-1' };
      },
      createMaterialization: async () => {
        if (this.failAt === 'materialization') throw new Error('materialization failure');
        staged.push('materialization'); return { id: 'materialization-1' };
      },
      createIngestionManifestEntry: async () => {
        if (this.failAt === 'manifest') throw new Error('manifest failure');
        staged.push('manifest');
      },
    };
    const result = await work(tx);
    this.committed.push(...staged);
    return result;
  }
}

async function materializerFor(entry: IngestionManifestEntry, persistence: AtomicMemoryPersistence) {
  const gate = new CorpusImportGate(new SingleEntryManifestStore(entry), { async writeChunkSet() {} }, signing);
  return new GovernedLegalCorpusMaterializer(gate, persistence, { async resolve() { return { persisted: true }; } });
}

describe('P2 legal governed materialization', () => {
  it('binds canonical identity to raw bytes and never emits a legacy foundation key', () => {
    const first = buildCanonicalLegalCorpusRecordKey(identity());
    const second = buildCanonicalLegalCorpusRecordKey(identity('f'.repeat(64)));
    expect(first).toMatch(/^canonical:legal-corpus:[a-f0-9]{64}$/);
    expect(first).not.toBe('foundation:sfs-1998-808');
    expect(second).not.toBe(first);
    expect(buildCanonicalLegalCorpusRecordKey(identity())).toBe(first);
  });

  it('GATE_BEFORE_WRITE_V1: a failed gate produces zero canonical, materialization, and manifest writes', async () => {
    const input = await requestFor();
    const persistence = new AtomicMemoryPersistence();
    const materializer = await materializerFor({ ...input.manifest_entry, content_hash: 'x'.repeat(64) }, persistence);
    await expect(materializer.materialize(input)).rejects.toThrow(/source_content_hash/);
    expect(persistence.committed).toEqual([]);
  });

  it('persists canonical corpus, materialization, and ingestion manifest only after a valid gate', async () => {
    const input = await requestFor();
    const persistence = new AtomicMemoryPersistence();
    const materializer = await materializerFor(input.manifest_entry, persistence);
    const result = await materializer.materialize(input);
    expect(result.canonical_record_key).toBe(buildCanonicalLegalCorpusRecordKey(input.identity));
    expect(persistence.committed).toEqual(['record', 'materialization', 'manifest']);
  });

  it('ATOMIC_CORPUS_ADMISSION_V1: any post-gate persistence failure commits none of the three writes', async () => {
    const input = await requestFor();
    const persistence = new AtomicMemoryPersistence();
    persistence.failAt = 'manifest';
    const materializer = await materializerFor(input.manifest_entry, persistence);
    await expect(materializer.materialize(input)).rejects.toThrow(/manifest failure/);
    expect(persistence.committed).toEqual([]);
  });
});
