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
  createRegistryAdmissionAuthority,
  GovernedLegalCorpusMaterializer,
  LEGAL_CORPUS_IMPORT_ACTION,
  LEGAL_CORPUS_IMPORT_ATTESTATION_SCHEMA_VERSION,
  LEGAL_CORPUS_IMPORT_PREDICATE_TYPE,
  type CorpusImportBatchRequest,
  type IngestionManifestEntry,
  type LegalChunk,
  type LegalCorpusChunkWrite,
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

function identity(raw = 'a'.repeat(64), chunkPolicyVersion = 'legal-chunker-v2.3'): LegalCorpusMaterializationIdentityInput {
  return {
    logical_source_id: 'regeringskansliet-sfs-1998-808',
    registry_artifact_id: 'reg-rk-sfs-1998-808-001',
    registry_source_content_hash: 'b'.repeat(64),
    raw_source_content_hash: raw,
    text_projection_artifact_id: 'text-projection-1',
    text_projection_hash: 'c'.repeat(64),
    text_projection_version: 'v1.0',
    corpus_materialization_version: 'corpus-materialization-v1',
    chunk_policy_version: chunkPolicyVersion,
  };
}

const REGISTRY_ARTIFACT_ID = 'reg-rk-sfs-1998-808-001';
const REGISTRY_SOURCE_CONTENT_HASH = 'b'.repeat(64);

/** K2.1: the gate's required registry authority, fed the entry `identity()` claims. */
const registryAuthority = createRegistryAdmissionAuthority({
  async loadApprovedEntries() {
    return [{ registryArtifactId: REGISTRY_ARTIFACT_ID, sourceContentHash: REGISTRY_SOURCE_CONTENT_HASH }];
  },
});

async function attestation(
  documentId: string,
  sourceContentHash = 'a'.repeat(64),
  registryOverrides: { artifactId?: string; sourceContentHash?: string } = {},
): Promise<ArtifactAttestation> {
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
      registry_artifact_id: registryOverrides.artifactId ?? REGISTRY_ARTIFACT_ID,
      registry_source_content_hash: registryOverrides.sourceContentHash ?? REGISTRY_SOURCE_CONTENT_HASH,
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
  readonly committedChunkSets: readonly LegalCorpusChunkWrite[][] = [];
  failAt?: 'record' | 'materialization' | 'chunks' | 'manifest';
  async transaction<T>(work: (tx: LegalCorpusMaterializationTransaction) => Promise<T>): Promise<T> {
    const staged: string[] = [];
    const stagedChunkSets: LegalCorpusChunkWrite[][] = [];
    const tx: LegalCorpusMaterializationTransaction = {
      createCanonicalCorpusRecord: async () => {
        if (this.failAt === 'record') throw new Error('record failure');
        staged.push('record'); return { id: 'record-1' };
      },
      createMaterialization: async () => {
        if (this.failAt === 'materialization') throw new Error('materialization failure');
        staged.push('materialization'); return { id: 'materialization-1' };
      },
      createChunks: async (input) => {
        if (this.failAt === 'chunks') throw new Error('chunks failure');
        staged.push('chunks'); stagedChunkSets.push([...input.chunks]);
      },
      createIngestionManifestEntry: async () => {
        if (this.failAt === 'manifest') throw new Error('manifest failure');
        staged.push('manifest');
      },
    };
    const result = await work(tx);
    this.committed.push(...staged);
    (this.committedChunkSets as LegalCorpusChunkWrite[][]).push(...stagedChunkSets);
    return result;
  }
}

async function materializerFor(entry: IngestionManifestEntry, persistence: AtomicMemoryPersistence) {
  const gate = new CorpusImportGate(new SingleEntryManifestStore(entry), { async writeChunkSet() {} }, signing, registryAuthority);
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
    expect(persistence.committed).toEqual(['record', 'materialization', 'chunks', 'manifest']);
    expect(persistence.committedChunkSets).toHaveLength(1);
    expect(persistence.committedChunkSets[0]?.map((c) => c.fragment_id)).toEqual(
      chunks.map((c) => c.fragment_id),
    );
  });

  it('ATOMIC_CORPUS_ADMISSION_V1: any post-gate persistence failure commits none of the four writes (including chunks)', async () => {
    for (const failAt of ['record', 'materialization', 'chunks', 'manifest'] as const) {
      const input = await requestFor();
      const persistence = new AtomicMemoryPersistence();
      persistence.failAt = failAt;
      const materializer = await materializerFor(input.manifest_entry, persistence);
      await expect(materializer.materialize(input)).rejects.toThrow(new RegExp(`${failAt} failure`));
      expect(persistence.committed).toEqual([]);
      expect(persistence.committedChunkSets).toEqual([]);
    }
  });
});

// ---- K2.1b finding 4: identity <-> attested registry binding -------------------------------
//
// The gate proves the SIGNED predicate's registry binding resolves to a currently-APPROVED
// entry. It cannot prove the identity actually being PERSISTED names that same entry -- the
// identity travels to the materializer separately and lands verbatim in the materialization
// row. Without this check, "valid registry entry + valid attestation for a DIFFERENT entry"
// would persist provenance naming an authority nothing verified.

function manifestEntryFor(documentId: string, contentHash: string): IngestionManifestEntry {
  return {
    document_id: documentId,
    source_manifest_ref: { id: 'raw-1', content_hash: { algorithm: 'sha256', digest: '0'.repeat(64) } },
    status: 'INGESTED',
    classification: {},
    content_hash: contentHash,
    pipeline_version: 'text-v1.0',
    processed_at: '2026-09-05T00:00:00.000Z',
    corpus_import_attestation_ref: { id: 'att-1', content_hash: { algorithm: 'sha256', digest: '1'.repeat(64) } },
  };
}

function corpusRecordFor(contentHash: string) {
  return {
    title: 't', source_path: 'p', document_text: 'd', search_text: 's',
    source_family: 'f', source_type: 'ty', source_system: 'sy',
    content_hash: contentHash, byte_size: 1, metadata: {},
  };
}

describe('K2.1: attested registry binding must match the materialized identity', () => {
  it('rejects when the attested registry_artifact_id differs from the identity being materialized', async () => {
    const input = identity();
    const documentId = buildCanonicalLegalCorpusRecordKey(input);
    // Attestation names a DIFFERENT (but also validly-approved) registry entry than the identity.
    const mismatched = await attestation(documentId, input.raw_source_content_hash, {
      artifactId: 'reg-some-other-approved-source-001',
    });
    const persistence = new AtomicMemoryPersistence();
    // Authority approves BOTH entries, so the gate itself passes -- proving this rejection comes
    // from the identity cross-check, not from the registry lookup failing.
    const permissiveAuthority = createRegistryAdmissionAuthority({
      async loadApprovedEntries() {
        return [
          { registryArtifactId: REGISTRY_ARTIFACT_ID, sourceContentHash: REGISTRY_SOURCE_CONTENT_HASH },
          { registryArtifactId: 'reg-some-other-approved-source-001', sourceContentHash: REGISTRY_SOURCE_CONTENT_HASH },
        ];
      },
    });
    const entry = manifestEntryFor(documentId, input.raw_source_content_hash);
    const gate = new CorpusImportGate(new SingleEntryManifestStore(entry), { async writeChunkSet() {} }, signing, permissiveAuthority);
    const materializer = new GovernedLegalCorpusMaterializer(gate, persistence, { async resolve() { return { persisted: true }; } });

    await expect(
      materializer.materialize({
        gate_request: { runId: 'run-1', expectedDocumentIds: [documentId], imports: [{ documentId, chunks, attestation: mismatched }] },
        manifest_entry: entry,
        identity: input,
        raw_source_ref: {},
        corpus_record: corpusRecordFor(input.raw_source_content_hash),
      }),
    ).rejects.toThrow(/REJECT_MATERIALIZATION_REGISTRY_BINDING/);
    expect(persistence.committed).toEqual([]);
  });

  it('rejects when the attested registry_source_content_hash differs from the identity being materialized', async () => {
    const input = identity();
    const documentId = buildCanonicalLegalCorpusRecordKey(input);
    const mismatched = await attestation(documentId, input.raw_source_content_hash, {
      sourceContentHash: 'e'.repeat(64),
    });
    const persistence = new AtomicMemoryPersistence();
    const permissiveAuthority = createRegistryAdmissionAuthority({
      async loadApprovedEntries() {
        return [{ registryArtifactId: REGISTRY_ARTIFACT_ID, sourceContentHash: 'e'.repeat(64) }];
      },
    });
    const entry = manifestEntryFor(documentId, input.raw_source_content_hash);
    const gate = new CorpusImportGate(new SingleEntryManifestStore(entry), { async writeChunkSet() {} }, signing, permissiveAuthority);
    const materializer = new GovernedLegalCorpusMaterializer(gate, persistence, { async resolve() { return { persisted: true }; } });

    await expect(
      materializer.materialize({
        gate_request: { runId: 'run-1', expectedDocumentIds: [documentId], imports: [{ documentId, chunks, attestation: mismatched }] },
        manifest_entry: entry,
        identity: input,
        raw_source_ref: {},
        corpus_record: corpusRecordFor(input.raw_source_content_hash),
      }),
    ).rejects.toThrow(/REJECT_MATERIALIZATION_REGISTRY_BINDING/);
    expect(persistence.committed).toEqual([]);
  });

  it('admits when the attested registry binding matches the identity', async () => {
    const input = await requestFor();
    const persistence = new AtomicMemoryPersistence();
    const materializer = await materializerFor(input.manifest_entry, persistence);
    await expect(materializer.materialize(input)).resolves.toBeDefined();
    expect(persistence.committed).toEqual(['record', 'materialization', 'chunks', 'manifest']);
  });
});
