// packages/mps-legal-corpus/tests/CorpusImportGate.test.ts
//
// ADR: docs/architecture/ADR-LEGAL-CORPUS-IMPORT-GATE.md (ACCEPTED / FROZEN).
//
// Negative tests first, per instruction. Covers the six required negative cases named in the
// spec, both locked precisions (order-sensitive chunk_set_content_hash; manifest completeness
// as a single pre-write batch gate, not a post-hoc audit), and a happy path.

import { describe, expect, it, beforeEach } from 'vitest';
import {
  createArtifactAttestation,
  LocalPemSigningKeyProvider,
  type ArtifactAttestation,
  type SigningKeyProvider,
} from '@miljobeslut/mimers-brunn-core';
import {
  CorpusImportGate,
  ChunkOrderError,
  computeChunkSetContentHash,
  isCanonicallyOrdered,
  orderChunksDeterministically,
  LEGAL_CORPUS_IMPORT_ACTION,
  LEGAL_CORPUS_IMPORT_ATTESTATION_SCHEMA_VERSION,
  LEGAL_CORPUS_IMPORT_PREDICATE_TYPE,
  LegalCorpusGateError,
  type CorpusWriter,
  type IngestionManifestEntry,
  type LegalChunk,
  type LegalCorpusImportAttestationPredicate,
  type ManifestStore,
} from '../src/index';

// ---- Fixtures -------------------------------------------------------------------------

const PIPELINE_VERSION = 'pipeline-v1';
const CHUNK_POLICY_VERSION = 'policy-v1';

const SOURCE_PROJECTION_REF = 'sha256:test-projection-ref';

function chunk(chapter: number | string, paragraph: string, text: string, sequence = 0): LegalChunk {
  return {
    fragment_id: `MB:${chapter}:${paragraph}`,
    structure_kind: 'law',
    chapter: String(chapter),
    paragraph,
    full_text: text,
    references_to: [],
    case_citations: [],
    chunk_policy_version: CHUNK_POLICY_VERSION,
    source_projection_ref: SOURCE_PROJECTION_REF,
    sequence,
  };
}

function docChunks(): LegalChunk[] {
  // Already in canonical order (chapter 34, paragraph "1" then "2").
  return [chunk(34, '1', 'Första paragrafens text.', 0), chunk(34, '2', 'Andra paragrafens text.', 1)];
}

function manifestEntry(overrides: Partial<IngestionManifestEntry> & { document_id: string }): IngestionManifestEntry {
  return {
    source_manifest_ref: { id: `raw-${overrides.document_id}`, content_hash: { algorithm: 'sha256', digest: '00'.repeat(32) } },
    status: 'INGESTED',
    classification: {},
    content_hash: '11'.repeat(32),
    pipeline_version: PIPELINE_VERSION,
    processed_at: '2026-08-11T00:00:00.000Z',
    corpus_import_attestation_ref: { id: `att-${overrides.document_id}`, content_hash: { algorithm: 'sha256', digest: '22'.repeat(32) } },
    ...overrides,
  };
}

class InMemoryManifestStore implements ManifestStore {
  constructor(private entries: IngestionManifestEntry[]) {}
  async listEntries(_runId: string): Promise<readonly IngestionManifestEntry[]> {
    return this.entries;
  }
}

class RecordingCorpusWriter implements CorpusWriter {
  readonly writes: Array<{ documentId: string; chunks: readonly LegalChunk[]; attestation: ArtifactAttestation }> = [];
  async writeChunkSet(args: { documentId: string; chunks: readonly LegalChunk[]; attestation: ArtifactAttestation }): Promise<void> {
    this.writes.push(args);
  }
}

let signing: SigningKeyProvider;
let otherSigning: SigningKeyProvider;

async function buildAttestation(
  args: {
    documentId: string;
    chunks: readonly LegalChunk[];
    pipelineVersion?: string;
    chunkPolicyVersion?: string;
    action?: string;
    approverActorId?: string;
    approverRole?: string;
    signerKeyId?: string;
  },
  withSigning: SigningKeyProvider = signing,
): Promise<ArtifactAttestation> {
  const chunkSetContentHash = computeChunkSetContentHash(args.chunks);
  const predicate: LegalCorpusImportAttestationPredicate = {
    action: (args.action ?? LEGAL_CORPUS_IMPORT_ACTION) as typeof LEGAL_CORPUS_IMPORT_ACTION,
    document_id: args.documentId,
    source_content_hash: '11'.repeat(32),
    chunk_set_content_hash: chunkSetContentHash,
    pipeline_version: args.pipelineVersion ?? PIPELINE_VERSION,
    chunk_policy_version: args.chunkPolicyVersion ?? CHUNK_POLICY_VERSION,
    approver_actor_id: args.approverActorId ?? 'reviewer-1',
    approver_role: args.approverRole ?? 'GOVERNANCE_REVIEWER',
    attestation_schema_version: LEGAL_CORPUS_IMPORT_ATTESTATION_SCHEMA_VERSION,
    signer_key_id: args.signerKeyId ?? withSigning.keyId,
  };
  return createArtifactAttestation({
    subjectDigest: `sha256:${chunkSetContentHash}`,
    predicateType: LEGAL_CORPUS_IMPORT_PREDICATE_TYPE,
    predicate: predicate as unknown as Record<string, unknown>,
    signing: withSigning,
  });
}

beforeEach(() => {
  signing = LocalPemSigningKeyProvider.generate('ed25519:test-legal-corpus-authority').provider;
  otherSigning = LocalPemSigningKeyProvider.generate('ed25519:not-the-legal-corpus-key').provider;
});

// ---- 1. Direct bypass: no / invalid attestation ---------------------------------------

describe('CorpusImportGate — negative: bypass with missing/invalid attestation', () => {
  it('rejects an import with a garbage attestation, writes nothing', async () => {
    const docId = 'doc-1';
    const chunks = docChunks();
    const manifestStore = new InMemoryManifestStore([manifestEntry({ document_id: docId })]);
    const writer = new RecordingCorpusWriter();
    const gate = new CorpusImportGate(manifestStore, writer, signing);

    const forged: ArtifactAttestation = {
      subjectDigest: 'sha256:not-real',
      predicateType: LEGAL_CORPUS_IMPORT_PREDICATE_TYPE,
      predicate: {
        action: LEGAL_CORPUS_IMPORT_ACTION,
        document_id: docId,
        source_content_hash: '11'.repeat(32),
        chunk_set_content_hash: computeChunkSetContentHash(chunks),
        pipeline_version: PIPELINE_VERSION,
        chunk_policy_version: CHUNK_POLICY_VERSION,
        approver_actor_id: 'attacker',
        approver_role: 'GOVERNANCE_REVIEWER',
        attestation_schema_version: LEGAL_CORPUS_IMPORT_ATTESTATION_SCHEMA_VERSION,
        signer_key_id: signing.keyId,
      },
      hashAlgorithm: 'sha256',
      signatureAlgorithm: 'Ed25519',
      signer: signing.keyId,
      signature: 'ed25519:not-a-real-signature==',
    };

    await expect(
      gate.importBatch({ runId: 'run-1', expectedDocumentIds: [docId], imports: [{ documentId: docId, chunks, attestation: forged }] }),
    ).rejects.toThrow(LegalCorpusGateError);
    expect(writer.writes).toHaveLength(0);
  });

  it('rejects an import with an undefined attestation, writes nothing', async () => {
    const docId = 'doc-1';
    const chunks = docChunks();
    const manifestStore = new InMemoryManifestStore([manifestEntry({ document_id: docId })]);
    const writer = new RecordingCorpusWriter();
    const gate = new CorpusImportGate(manifestStore, writer, signing);

    await expect(
      gate.importBatch({
        runId: 'run-1',
        expectedDocumentIds: [docId],
        imports: [{ documentId: docId, chunks, attestation: undefined as unknown as ArtifactAttestation }],
      }),
    ).rejects.toThrow();
    expect(writer.writes).toHaveLength(0);
  });
});

// ---- 2. Artifact substitution ----------------------------------------------------------

describe('CorpusImportGate — negative: artifact substitution', () => {
  it('rejects attestation for document A reused to import document B', async () => {
    const chunksA = docChunks();
    const chunksB = [chunk(10, '1', 'Ett helt annat kapitel.')];
    const attestationForA = await buildAttestation({ documentId: 'doc-A', chunks: chunksA });

    const manifestStore = new InMemoryManifestStore([manifestEntry({ document_id: 'doc-B' })]);
    const writer = new RecordingCorpusWriter();
    const gate = new CorpusImportGate(manifestStore, writer, signing);

    await expect(
      gate.importBatch({
        runId: 'run-1',
        expectedDocumentIds: ['doc-B'],
        imports: [{ documentId: 'doc-B', chunks: chunksB, attestation: attestationForA }],
      }),
    ).rejects.toThrow(/different document_id/);
    expect(writer.writes).toHaveLength(0);
  });
});

// ---- 3. Action substitution --------------------------------------------------------------

describe('CorpusImportGate — negative: action substitution', () => {
  it('rejects an attestation signed for a different action', async () => {
    const docId = 'doc-1';
    const chunks = docChunks();
    const attestation = await buildAttestation({ documentId: docId, chunks, action: 'legal.corpus.reject' });

    const manifestStore = new InMemoryManifestStore([manifestEntry({ document_id: docId })]);
    const writer = new RecordingCorpusWriter();
    const gate = new CorpusImportGate(manifestStore, writer, signing);

    await expect(
      gate.importBatch({ runId: 'run-1', expectedDocumentIds: [docId], imports: [{ documentId: docId, chunks, attestation }] }),
    ).rejects.toThrow(/action is not/);
    expect(writer.writes).toHaveLength(0);
  });
});

// ---- 4. Pipeline / chunk-policy version drift -------------------------------------------

describe('CorpusImportGate — negative: pipeline_version / chunk_policy_version drift', () => {
  it('rejects when the attestation was signed against a different pipeline_version than the manifest records', async () => {
    const docId = 'doc-1';
    const chunks = docChunks();
    const attestation = await buildAttestation({ documentId: docId, chunks, pipelineVersion: 'pipeline-v2-different' });

    const manifestStore = new InMemoryManifestStore([
      manifestEntry({ document_id: docId, pipeline_version: PIPELINE_VERSION }),
    ]);
    const writer = new RecordingCorpusWriter();
    const gate = new CorpusImportGate(manifestStore, writer, signing);

    await expect(
      gate.importBatch({ runId: 'run-1', expectedDocumentIds: [docId], imports: [{ documentId: docId, chunks, attestation }] }),
    ).rejects.toThrow(/pipeline_version does not match/);
    expect(writer.writes).toHaveLength(0);
  });
});

// ---- 5. Content-hash tamper ---------------------------------------------------------------

describe('CorpusImportGate — negative: chunk_set_content_hash tamper', () => {
  it('rejects when the chunks being imported differ from what the attestation was signed over', async () => {
    const docId = 'doc-1';
    const originalChunks = docChunks();
    const attestation = await buildAttestation({ documentId: docId, chunks: originalChunks });

    // Import different chunk content than what was signed (e.g. re-chunked, or tampered).
    const tamperedChunks = [chunk(34, '1', 'MANIPULERAD TEXT'), chunk(34, '2', 'Andra paragrafens text.')];

    const manifestStore = new InMemoryManifestStore([manifestEntry({ document_id: docId })]);
    const writer = new RecordingCorpusWriter();
    const gate = new CorpusImportGate(manifestStore, writer, signing);

    await expect(
      gate.importBatch({
        runId: 'run-1',
        expectedDocumentIds: [docId],
        imports: [{ documentId: docId, chunks: tamperedChunks, attestation }],
      }),
    ).rejects.toThrow(/chunk_set_content_hash does not match/);
    expect(writer.writes).toHaveLength(0);
  });
});

// ---- 6. Manifest completeness (batch-level) ----------------------------------------------

describe('CorpusImportGate — negative: manifest completeness', () => {
  it('rejects the whole batch when a document has no manifest entry at all', async () => {
    const docId = 'doc-1';
    const chunks = docChunks();
    const attestation = await buildAttestation({ documentId: docId, chunks });

    const manifestStore = new InMemoryManifestStore([]); // no entry for doc-1 at all
    const writer = new RecordingCorpusWriter();
    const gate = new CorpusImportGate(manifestStore, writer, signing);

    await expect(
      gate.importBatch({ runId: 'run-1', expectedDocumentIds: [docId], imports: [{ documentId: docId, chunks, attestation }] }),
    ).rejects.toThrow(/no manifest entry at all/);
    expect(writer.writes).toHaveLength(0);
  });

  it('rejects the whole batch when a FILTERED_OUT entry has no filtered_reason', async () => {
    const manifestStore = new InMemoryManifestStore([
      manifestEntry({ document_id: 'doc-filtered', status: 'FILTERED_OUT', filtered_reason: undefined, corpus_import_attestation_ref: undefined }),
    ]);
    const writer = new RecordingCorpusWriter();
    const gate = new CorpusImportGate(manifestStore, writer, signing);

    await expect(
      gate.importBatch({ runId: 'run-1', expectedDocumentIds: ['doc-filtered'], imports: [] }),
    ).rejects.toThrow(/FILTERED_OUT without filtered_reason/);
    expect(writer.writes).toHaveLength(0);
  });

  it('rejects the whole batch when an INGESTED entry has no corpus_import_attestation_ref', async () => {
    const manifestStore = new InMemoryManifestStore([
      manifestEntry({ document_id: 'doc-1', status: 'INGESTED', corpus_import_attestation_ref: undefined }),
    ]);
    const writer = new RecordingCorpusWriter();
    const gate = new CorpusImportGate(manifestStore, writer, signing);

    await expect(
      gate.importBatch({ runId: 'run-1', expectedDocumentIds: ['doc-1'], imports: [] }),
    ).rejects.toThrow(/INGESTED without corpus_import_attestation_ref/);
    expect(writer.writes).toHaveLength(0);
  });
});

// ---- Precision 1: order-sensitive chunk_set_content_hash ---------------------------------

describe('CorpusImportGate — locked precision: chunk_set_content_hash is order-sensitive', () => {
  it('computeChunkSetContentHash throws ChunkOrderError for a non-canonically-ordered array', () => {
    const scrambled = [chunk(34, '2', 'Andra paragrafens text.'), chunk(34, '1', 'Första paragrafens text.')];
    expect(isCanonicallyOrdered(scrambled)).toBe(false);
    expect(() => computeChunkSetContentHash(scrambled)).toThrow(ChunkOrderError);
  });

  it('does NOT silently normalize order before hashing — same chunks, different array order, is a rejection not a match', () => {
    const canonical = docChunks();
    const shuffled = [...canonical].reverse();

    const canonicalHash = computeChunkSetContentHash(canonical);
    expect(() => computeChunkSetContentHash(shuffled)).toThrow(ChunkOrderError);

    // Sorting the shuffled array back into canonical order reproduces the SAME hash — proving
    // the hash is a function of (content, canonical order), not of accidental input order,
    // and that the ordering rule is itself reproducible/deterministic.
    const reSorted = orderChunksDeterministically(shuffled);
    expect(computeChunkSetContentHash(reSorted)).toBe(canonicalHash);
  });

  it('the gate rejects an import whose chunk array is not canonically ordered, before any write', async () => {
    const docId = 'doc-1';
    const canonical = docChunks();
    const attestation = await buildAttestation({ documentId: docId, chunks: canonical });
    const scrambled = [...canonical].reverse();

    const manifestStore = new InMemoryManifestStore([manifestEntry({ document_id: docId })]);
    const writer = new RecordingCorpusWriter();
    const gate = new CorpusImportGate(manifestStore, writer, signing);

    await expect(
      gate.importBatch({ runId: 'run-1', expectedDocumentIds: [docId], imports: [{ documentId: docId, chunks: scrambled, attestation }] }),
    ).rejects.toThrow(/not in canonical document-structure order/);
    expect(writer.writes).toHaveLength(0);
  });

  it('numeric-aware paragraph ordering: "34:10" sorts after "34:2", not before', () => {
    const c2 = chunk(34, '2', 'para 2');
    const c10 = chunk(34, '10', 'para 10');
    expect(isCanonicallyOrdered([c2, c10])).toBe(true);
    expect(isCanonicallyOrdered([c10, c2])).toBe(false);
    expect(orderChunksDeterministically([c10, c2])).toEqual([c2, c10]);
  });
});

// ---- Precision 2: manifest completeness is a single pre-write batch gate -----------------

describe('CorpusImportGate — locked precision: manifest completeness gates the whole batch before any write', () => {
  it('a batch with one valid document and one manifest-incomplete document writes NOTHING — not even the valid one', async () => {
    const validDocId = 'doc-valid';
    const brokenDocId = 'doc-broken';
    const chunks = docChunks();
    const validAttestation = await buildAttestation({ documentId: validDocId, chunks });

    const manifestStore = new InMemoryManifestStore([
      manifestEntry({ document_id: validDocId }),
      // Broken: INGESTED but no corpus_import_attestation_ref — a completeness violation.
      manifestEntry({ document_id: brokenDocId, corpus_import_attestation_ref: undefined }),
    ]);
    const writer = new RecordingCorpusWriter();
    const gate = new CorpusImportGate(manifestStore, writer, signing);

    await expect(
      gate.importBatch({
        runId: 'run-1',
        expectedDocumentIds: [validDocId, brokenDocId],
        imports: [{ documentId: validDocId, chunks, attestation: validAttestation }],
      }),
    ).rejects.toThrow(LegalCorpusGateError);

    // The forbidden pattern the spec names explicitly: "process → write some chunks →
    // discover manifest/attestation problem". Proven here as zero writes, not one.
    expect(writer.writes).toHaveLength(0);
  });

  it('a batch with one valid document and one binding-invalid document writes NOTHING for either', async () => {
    const validDocId = 'doc-valid';
    const invalidDocId = 'doc-invalid';
    const chunks = docChunks();
    const validAttestation = await buildAttestation({ documentId: validDocId, chunks });
    const invalidAttestation = await buildAttestation({ documentId: invalidDocId, chunks, action: 'legal.corpus.reject' });

    const manifestStore = new InMemoryManifestStore([
      manifestEntry({ document_id: validDocId }),
      manifestEntry({ document_id: invalidDocId }),
    ]);
    const writer = new RecordingCorpusWriter();
    const gate = new CorpusImportGate(manifestStore, writer, signing);

    await expect(
      gate.importBatch({
        runId: 'run-1',
        expectedDocumentIds: [validDocId, invalidDocId],
        imports: [
          { documentId: validDocId, chunks, attestation: validAttestation },
          { documentId: invalidDocId, chunks, attestation: invalidAttestation },
        ],
      }),
    ).rejects.toThrow(LegalCorpusGateError);

    expect(writer.writes).toHaveLength(0);
  });
});

// ---- Bonus: wrong signer key (named explicitly in the ordered check list) ---------------

describe('CorpusImportGate — bonus: attestation signed by a different key is rejected', () => {
  it('rejects an attestation validly signed by a non-governance key', async () => {
    const docId = 'doc-1';
    const chunks = docChunks();
    const attestation = await buildAttestation({ documentId: docId, chunks, signerKeyId: otherSigning.keyId }, otherSigning);

    const manifestStore = new InMemoryManifestStore([manifestEntry({ document_id: docId })]);
    const writer = new RecordingCorpusWriter();
    const gate = new CorpusImportGate(manifestStore, writer, signing);

    await expect(
      gate.importBatch({ runId: 'run-1', expectedDocumentIds: [docId], imports: [{ documentId: docId, chunks, attestation }] }),
    ).rejects.toThrow(/legal-corpus governance key|cryptographic signature is invalid/);
    expect(writer.writes).toHaveLength(0);
  });
});

// ---- Happy path ---------------------------------------------------------------------------

describe('CorpusImportGate — a correctly bound batch imports exactly once', () => {
  it('imports both documents when everything is valid and complete', async () => {
    const doc1 = 'doc-1';
    const doc2 = 'doc-2';
    const chunks1 = docChunks();
    const chunks2 = [chunk(10, '1', 'Kapitel tio, paragraf ett.')];

    const attestation1 = await buildAttestation({ documentId: doc1, chunks: chunks1 });
    const attestation2 = await buildAttestation({ documentId: doc2, chunks: chunks2 });

    const manifestStore = new InMemoryManifestStore([
      manifestEntry({ document_id: doc1 }),
      manifestEntry({ document_id: doc2 }),
    ]);
    const writer = new RecordingCorpusWriter();
    const gate = new CorpusImportGate(manifestStore, writer, signing);

    const result = await gate.importBatch({
      runId: 'run-1',
      expectedDocumentIds: [doc1, doc2],
      imports: [
        { documentId: doc1, chunks: chunks1, attestation: attestation1 },
        { documentId: doc2, chunks: chunks2, attestation: attestation2 },
      ],
    });

    expect([...result.importedDocumentIds].sort()).toEqual([doc1, doc2].sort());
    expect(writer.writes).toHaveLength(2);
    expect(writer.writes.map((w) => w.documentId).sort()).toEqual([doc1, doc2].sort());
  });

  it('a FILTERED_OUT document with a proper filtered_reason does not block an otherwise-valid batch', async () => {
    const doc1 = 'doc-1';
    const filteredDoc = 'doc-filtered';
    const chunks1 = docChunks();
    const attestation1 = await buildAttestation({ documentId: doc1, chunks: chunks1 });

    const manifestStore = new InMemoryManifestStore([
      manifestEntry({ document_id: doc1 }),
      manifestEntry({
        document_id: filteredDoc,
        status: 'FILTERED_OUT',
        filtered_reason: 'Not environmentally relevant (manual review).',
        corpus_import_attestation_ref: undefined,
      }),
    ]);
    const writer = new RecordingCorpusWriter();
    const gate = new CorpusImportGate(manifestStore, writer, signing);

    const result = await gate.importBatch({
      runId: 'run-1',
      expectedDocumentIds: [doc1, filteredDoc],
      imports: [{ documentId: doc1, chunks: chunks1, attestation: attestation1 }],
    });

    expect(result.importedDocumentIds).toEqual([doc1]);
    expect(writer.writes).toHaveLength(1);
  });
});
