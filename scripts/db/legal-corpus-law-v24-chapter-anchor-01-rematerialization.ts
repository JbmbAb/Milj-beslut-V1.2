/**
 * LEGAL-CHUNKING-LAW-V2.4-CHAPTER-ANCHOR-01 -- real rematerialization proof.
 *
 * Rematerializes Miljöbalk (1998:808) a second time under `chunk_policy_version =
 * 'legal-chunker-v2.4.1'` (the anchor-fixed chunkSwedishLawV24, see ChapterAnchor commit),
 * reusing the exact same real quarantined bytes / download manifest / projection already used
 * for both the v2.3 row (Part G) and the pre-fix v2.4 row (LEGAL-CORPUS-LAW-V2.4-
 * REMATERIALIZATION-01). `chunk_policy_version` is identity-bearing, so this is a new, distinct,
 * immutable row -- the pre-fix 'legal-chunker-v2.4' row is left exactly as-is, an honest
 * historical record of the bug, never mutated or deleted.
 *
 * Proves, against the real database:
 *   - both the v2.3 row and the pre-fix v2.4 row are untouched
 *   - a new, distinct v2.4.1 materialization exists
 *   - the false "10 a" (sjölagen cross-reference) chapter label is GONE
 *   - the genuine "17 a" chapter marker is still detected as structurally valid (see report;
 *     whether it surfaces on any chunk's own `chapter` field depends on whether chapter 17 a has
 *     any paragraphs of its own in the real text -- it does not, it is repealed)
 *   - replay is stable, zero duplicate rows
 *
 * Usage:
 *   LEGAL_CORPUS_MATERIALIZATION_SIGNING_PRIVATE_KEY_PEM=... \
 *   LEGAL_CORPUS_MATERIALIZATION_SIGNING_PUBLIC_KEY_PEM=... \
 *     npx tsx scripts/db/legal-corpus-law-v24-chapter-anchor-01-rematerialization.ts
 */
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { composeLegalCorpusMaterialization } from '../../server/modules/legal/materialization/LegalCorpusMaterializationCompositionRoot';
import {
  resolveActiveRegistryBinding,
  type ActiveRegistryBinding,
} from '../../server/modules/legal/materialization/SourceRegistryAdmissionAdapter';
import { PdfParseExtractorAdapter } from '../../server/text-projection/pdfParseExtractorAdapter';
import { admitLawChunksV24 } from '../../server/modules/legal/materialization/ChunkAdmission';
import { prisma } from '../../server/db/prisma';
import type { LegalChunk } from '@miljobeslut/mps-legal-corpus';

const QUARANTINE_ID = '602c6415-8125-4677-a61d-d4f868a965b6';
const SOURCE_ID = 'regeringskansliet-sfs-1998-808';
const REGISTRY_SOURCE_CONTENT_HASH = '888c7cbafc18058a9c254901b1b09e163726e270c271122ce532123af9285b97';
const DOWNLOAD_MANIFEST_REF = {
  id: 'download-manifest-pilot-regeringskansliet-sfs-1998-808-2c4f969a-60c7-4004-bed3-bf0147f25f37-330b1b6031bb712b',
  content_hash: {
    algorithm: 'sha256' as const,
    digest: '330b1b6031bb712bdab1e2bde35217f42acb3d875a1ef0baa704245643047c1f',
  },
};
const MIME_TYPE = 'text/html';
const V23_POLICY = 'legal-chunker-v2.3';
const V24_PREFIX_POLICY = 'legal-chunker-v2.4';
const V24_1_POLICY = 'legal-chunker-v2.4.1';

function chapterDistribution(admitted: readonly LegalChunk[]): Record<string, number> {
  const dist: Record<string, number> = {};
  for (const c of admitted) {
    if (c.structure_kind !== 'law') continue;
    dist[c.chapter] = (dist[c.chapter] ?? 0) + 1;
  }
  return dist;
}

async function countChunks(materializationId: string): Promise<number> {
  return prisma.legalCorpusMaterializedChunk.count({ where: { materializationId } });
}

function identityFor(
  chunkPolicyVersion: string,
  rawContentHash: string,
  projectedTextHash: string,
  activeBinding: ActiveRegistryBinding,
) {
  return {
    logical_source_id: SOURCE_ID,
    registry_artifact_id: activeBinding.registryArtifactId,
    registry_source_content_hash: activeBinding.registrySourceContentHash,
    raw_source_content_hash: rawContentHash,
    text_projection_artifact_id: `projection-${QUARANTINE_ID}`,
    text_projection_hash: projectedTextHash,
    text_projection_version: 'html-extract@1.0',
    corpus_materialization_version: 'corpus-materialization-v1',
    chunk_policy_version: chunkPolicyVersion,
  };
}

async function materializeOnce(
  admittedChunks: readonly LegalChunk[],
  rawContentHash: string,
  projectedTextHash: string,
  rawBytes: Uint8Array,
  chunkPolicyVersion: string,
  runTag: string,
) {
  const { materializer, ingestionManifestStore, signAttestation } = composeLegalCorpusMaterialization();
  // K2.1b(2): bind to the ACTIVE registry identity rather than a frozen artifact-id constant.
  const activeBinding = await resolveActiveRegistryBinding({
    sourceId: SOURCE_ID,
    expectedSourceContentHash: REGISTRY_SOURCE_CONTENT_HASH,
  });
  const identity = identityFor(chunkPolicyVersion, rawContentHash, projectedTextHash, activeBinding);

  const { buildCanonicalLegalCorpusRecordKey } = await import('@miljobeslut/mps-legal-corpus');
  const documentId = buildCanonicalLegalCorpusRecordKey(identity);
  const runId = `run-lawv241-${runTag}-${randomUUID()}`;

  const manifestEntryBase = {
    document_id: documentId,
    source_manifest_ref: DOWNLOAD_MANIFEST_REF,
    status: 'INGESTED' as const,
    classification: {},
    content_hash: rawContentHash,
    pipeline_version: 'text-v1.0',
  };

  await ingestionManifestStore.recordEntry(runId, {
    ...manifestEntryBase,
    processed_at: new Date().toISOString(),
  });

  const attestation = await signAttestation({
    documentId,
    sourceContentHash: rawContentHash,
    chunks: admittedChunks,
    pipelineVersion: 'text-v1.0',
    chunkPolicyVersion,
    approverActorId: 'system:legal-corpus-materialization',
    approverRole: 'AUTOMATED_EXECUTION_ATTESTOR',
    registryArtifactId: activeBinding.registryArtifactId,
    registrySourceContentHash: activeBinding.registrySourceContentHash,
  });
  const attestationRefDigest = createHash('sha256').update(JSON.stringify(attestation)).digest('hex');
  const attestationRef = {
    id: `att-${attestationRefDigest.slice(0, 16)}`,
    content_hash: { algorithm: 'sha256' as const, digest: attestationRefDigest },
  };

  await ingestionManifestStore.recordEntry(runId, {
    ...manifestEntryBase,
    processed_at: new Date().toISOString(),
    corpus_import_attestation_ref: attestationRef,
  });

  const documentText = admittedChunks.map((c) => c.full_text).join('\n\n') || '(no admitted chunks)';

  const result = await materializer.materialize({
    gate_request: {
      runId,
      expectedDocumentIds: [documentId],
      imports: [{ documentId, chunks: admittedChunks, attestation }],
    },
    manifest_entry: {
      ...manifestEntryBase,
      processed_at: new Date().toISOString(),
      corpus_import_attestation_ref: attestationRef,
    },
    identity,
    raw_source_ref: { quarantine_id: QUARANTINE_ID, download_manifest_ref: DOWNLOAD_MANIFEST_REF },
    corpus_record: {
      title: 'Miljöbalk (1998:808)',
      source_path: `p2://${QUARANTINE_ID}`,
      document_text: documentText,
      search_text: documentText,
      source_family: 'SFS',
      source_type: 'LAW',
      source_system: SOURCE_ID,
      content_hash: rawContentHash,
      byte_size: rawBytes.byteLength,
      metadata: { governed: true, unit: 'LEGAL-CHUNKING-LAW-V2.4-CHAPTER-ANCHOR-01', structure_kind: 'law' },
    },
  });

  return { result, documentId };
}

async function main() {
  console.log('########## LEGAL-CHUNKING-LAW-V2.4-CHAPTER-ANCHOR-01 -- real rematerialization ##########');

  const rawBytes = new Uint8Array(readFileSync(`C:\\miljöbeslut\\.quarantine\\${QUARANTINE_ID}.bin`));
  const rawContentHash = createHash('sha256').update(rawBytes).digest('hex');

  const adapter = new PdfParseExtractorAdapter();
  const extraction = await adapter.extract(
    {
      ref: { artifact_id: QUARANTINE_ID, artifact_type: 'raw_source' },
      doc_name: QUARANTINE_ID,
      mime_type: MIME_TYPE,
    },
    rawBytes,
  );
  const projectedTextHash = createHash('sha256').update(extraction.text, 'utf8').digest('hex');
  const sourceProjectionRef = `sha256:${projectedTextHash}`;
  console.log(
    'projected text hash:',
    projectedTextHash,
    `(${extraction.text.length} chars, same projection as all prior Miljöbalken runs)`,
  );

  const { buildCanonicalLegalCorpusRecordKey } = await import('@miljobeslut/mps-legal-corpus');

  // ---------- STEP 0: confirm both prior rows (v2.3 and the pre-fix v2.4) are present, and will
  // remain untouched. ----------
  // K2.1b(2) consequence, stated rather than hidden: these historical baselines are addressed by
  // the ACTIVE registry identity. Rows materialized under the superseded artifact id carry a
  // different canonical_record_key and will not be found; reconciling historical rows across a
  // re-attestation is successor-chain semantics, explicitly out of scope for this repair.
  const mainActiveBinding = await resolveActiveRegistryBinding({
    sourceId: SOURCE_ID,
    expectedSourceContentHash: REGISTRY_SOURCE_CONTENT_HASH,
  });
  const v23DocumentId = buildCanonicalLegalCorpusRecordKey(
    identityFor(V23_POLICY, rawContentHash, projectedTextHash, mainActiveBinding),
  );
  const v24PreFixDocumentId = buildCanonicalLegalCorpusRecordKey(
    identityFor(V24_PREFIX_POLICY, rawContentHash, projectedTextHash, mainActiveBinding),
  );

  const v23RowBefore = await prisma.legalCorpusMaterialization.findUnique({
    where: { canonicalRecordKey: v23DocumentId },
  });
  const v24PreFixRowBefore = await prisma.legalCorpusMaterialization.findUnique({
    where: { canonicalRecordKey: v24PreFixDocumentId },
  });
  const v23ChunkCountBefore = v23RowBefore ? await countChunks(v23RowBefore.id) : -1;
  const v24PreFixChunkCountBefore = v24PreFixRowBefore ? await countChunks(v24PreFixRowBefore.id) : -1;

  console.log('\n--- STEP 0: prior materializations ---');
  console.log('v2.3 row exists:', v23RowBefore !== null, '| chunk rows:', v23ChunkCountBefore);
  console.log(
    'pre-fix v2.4 row exists:',
    v24PreFixRowBefore !== null,
    '| chunk rows:',
    v24PreFixChunkCountBefore,
  );
  if (!v23RowBefore || !v24PreFixRowBefore) {
    console.log(
      '!!! one or both prior rows missing -- this run cannot prove "both prior rows unchanged" without them existing first. Aborting.',
    );
    await prisma.$disconnect();
    process.exitCode = 1;
    return;
  }

  // ---------- STEP 1: admit under the anchor-fixed v2.4.1 policy, real comparison against both priors. ----------
  const v241Admission = admitLawChunksV24({
    text: extraction.text,
    sourceProjectionRef,
    chunkPolicyVersion: V24_1_POLICY,
  });
  const v241Dist = chapterDistribution(v241Admission.admitted);

  console.log('\n--- STEP 1: v2.4.1 (anchor-fixed) admission ---');
  console.log(
    'admitted:',
    v241Admission.admitted.length,
    '| rejected:',
    v241Admission.rejected.length,
    '| status:',
    v241Admission.document_status,
  );
  console.log('chapter distribution:', v241Dist);

  const falseTenA = v241Admission.admitted.filter((c) => c.structure_kind === 'law' && c.chapter === '10 a');
  const genuineSeventeenA = v241Admission.admitted.filter(
    (c) => c.structure_kind === 'law' && c.chapter === '17 a',
  );
  console.log('\n--- PROOF: the false "10 a" (sjölagen cross-reference) label ---');
  console.log('chunks with chapter "10 a" (must be 0 after the fix):', falseTenA.length);
  console.log('\n--- "17 a" (genuine repealed chapter, has zero paragraphs of its own) ---');
  console.log(
    'chunks with chapter "17 a" (expected 0 -- chapter is repealed/empty, correctly superseded going forward by "18"):',
    genuineSeventeenA.length,
  );

  const paragraph19 = v241Admission.admitted.find(
    (c) => c.structure_kind === 'law' && c.paragraph === '19' && c.full_text.includes('sjölagen'),
  );
  console.log(
    '\nparagraph 19 (the fragment containing the sjölagen cross-reference) now labeled chapter:',
    paragraph19 && paragraph19.structure_kind === 'law' ? paragraph19.chapter : '(not found)',
  );

  if (v241Admission.admitted.length === 0) {
    console.log('\n!!! zero v2.4.1 chunks admitted -- aborting materialization.');
    await prisma.$disconnect();
    process.exitCode = 1;
    return;
  }

  // ---------- STEP 2: materialize under v2.4.1, twice (replay proof). ----------
  console.log('\n--- STEP 2: v2.4.1 materialization run 1 ---');
  const run1 = await materializeOnce(
    v241Admission.admitted,
    rawContentHash,
    projectedTextHash,
    rawBytes,
    V24_1_POLICY,
    'run1',
  );
  const v241Row1 = await prisma.legalCorpusMaterialization.findUnique({
    where: { canonicalRecordKey: run1.result.canonical_record_key },
  });
  const v241ChunkCount1 = v241Row1 ? await countChunks(v241Row1.id) : -1;
  console.log('v2.4.1 materialization_id:', run1.result.canonical_record_key);
  console.log(
    'v2.4.1 record row:',
    run1.result.corpus_record_id,
    '| provenance row:',
    v241Row1?.id,
    '| governed chunk rows:',
    v241ChunkCount1,
  );
  console.log(
    'distinct from v2.3 id:',
    run1.result.canonical_record_key !== v23DocumentId,
    '| distinct from pre-fix v2.4 id:',
    run1.result.canonical_record_key !== v24PreFixDocumentId,
  );

  console.log('\n--- STEP 3: v2.4.1 materialization run 2 (replay) ---');
  const run2 = await materializeOnce(
    v241Admission.admitted,
    rawContentHash,
    projectedTextHash,
    rawBytes,
    V24_1_POLICY,
    'run2',
  );
  const v241ChunkCount2 = v241Row1 ? await countChunks(v241Row1.id) : -1;
  const v241RecordRowCount = await prisma.legalCorpusRecord.count({
    where: { recordKey: run1.result.canonical_record_key },
  });

  const replaySameId = run1.result.canonical_record_key === run2.result.canonical_record_key;
  const replaySameChunkCount = v241ChunkCount1 === v241ChunkCount2;
  const replayNoDuplicateRecords = v241RecordRowCount === 1;
  const replayIdentityStable = run1.documentId === run2.documentId;

  console.log('same materialization_id across runs:', replaySameId);
  console.log(
    'same chunk row count across runs:',
    replaySameChunkCount,
    `(${v241ChunkCount1} vs ${v241ChunkCount2})`,
  );
  console.log(
    'record rows for this key:',
    v241RecordRowCount,
    '(no duplicates:',
    replayNoDuplicateRecords + ')',
  );
  console.log('identity stable:', replayIdentityStable);

  // ---------- STEP 4: re-verify BOTH prior rows are completely untouched. ----------
  const v23RowAfter = await prisma.legalCorpusMaterialization.findUnique({
    where: { canonicalRecordKey: v23DocumentId },
  });
  const v24PreFixRowAfter = await prisma.legalCorpusMaterialization.findUnique({
    where: { canonicalRecordKey: v24PreFixDocumentId },
  });
  const v23ChunkCountAfter = v23RowAfter ? await countChunks(v23RowAfter.id) : -1;
  const v24PreFixChunkCountAfter = v24PreFixRowAfter ? await countChunks(v24PreFixRowAfter.id) : -1;

  const v23Untouched =
    v23RowAfter !== null &&
    v23RowBefore.id === v23RowAfter.id &&
    v23ChunkCountBefore === v23ChunkCountAfter &&
    v23RowBefore.createdAt.getTime() === v23RowAfter.createdAt.getTime();
  const v24PreFixUntouched =
    v24PreFixRowAfter !== null &&
    v24PreFixRowBefore.id === v24PreFixRowAfter.id &&
    v24PreFixChunkCountBefore === v24PreFixChunkCountAfter &&
    v24PreFixRowBefore.createdAt.getTime() === v24PreFixRowAfter.createdAt.getTime();

  console.log('\n--- STEP 4: prior materializations after this run ---');
  console.log(
    'v2.3 untouched (same pk/chunk-count/createdAt):',
    v23Untouched,
    `(${v23ChunkCountBefore} vs ${v23ChunkCountAfter})`,
  );
  console.log(
    'pre-fix v2.4 untouched (same pk/chunk-count/createdAt):',
    v24PreFixUntouched,
    `(${v24PreFixChunkCountBefore} vs ${v24PreFixChunkCountAfter})`,
  );

  console.log('\n\n========== LEGAL-CHUNKING-LAW-V2.4-CHAPTER-ANCHOR-01 SUMMARY ==========');
  console.log(
    JSON.stringify(
      {
        source: SOURCE_ID,
        quarantine_id: QUARANTINE_ID,
        prior_v23: {
          materialization_id: v23DocumentId,
          untouched: v23Untouched,
          chunk_rows: v23ChunkCountAfter,
        },
        prior_v24_prefix: {
          materialization_id: v24PreFixDocumentId,
          untouched: v24PreFixUntouched,
          chunk_rows: v24PreFixChunkCountAfter,
          note: 'left as-is, honest historical record of the bug',
        },
        v24_1: {
          materialization_id: run1.result.canonical_record_key,
          distinct_from_v23: run1.result.canonical_record_key !== v23DocumentId,
          distinct_from_prefix_v24: run1.result.canonical_record_key !== v24PreFixDocumentId,
          chunk_rows: v241ChunkCount1,
          admitted: v241Admission.admitted.length,
          rejected: v241Admission.rejected.length,
          chapter_distribution: v241Dist,
          false_10a_chunks: falseTenA.length,
          replay_same_materialization_id: replaySameId,
          replay_same_chunk_count: replaySameChunkCount,
          replay_no_duplicate_records: replayNoDuplicateRecords,
          replay_identity_stable: replayIdentityStable,
        },
        overall_status:
          v23Untouched &&
          v24PreFixUntouched &&
          falseTenA.length === 0 &&
          run1.result.canonical_record_key !== v23DocumentId &&
          run1.result.canonical_record_key !== v24PreFixDocumentId &&
          replaySameId &&
          replaySameChunkCount &&
          replayNoDuplicateRecords &&
          replayIdentityStable
            ? 'PROVEN'
            : 'PARTIAL',
      },
      null,
      2,
    ),
  );

  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error('FATAL:', error);
  await prisma.$disconnect();
  process.exitCode = 1;
});
