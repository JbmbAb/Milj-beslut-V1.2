/**
 * LEGAL-CORPUS-LAW-V2.4-REMATERIALIZATION-01.
 *
 * Real rematerialization of Miljöbalken (SFS 1998:808) under LEGAL-CHUNKING-LAW-V2.4
 * (chunk_policy_version = 'legal-chunker-v2.4'), reusing the exact same real quarantined raw
 * bytes / download manifest / projection already proven in Part G under v2.3 -- only the chunk
 * admission path changes.
 *
 * Proves, against the real database, not just unit tests:
 *   - the existing v2.3 materialization (Part G) is untouched by this run
 *   - a new, distinct v2.4 materialization is created (chunk_policy_version is identity-bearing)
 *   - the v2.4 materialization replays identically (run 1 vs run 2), zero duplicate rows
 *   - real letter-suffixed chapter structure ("17 a kap.", "10 a kap.") appears in governed output
 *
 * Also reports, honestly, any semantic drift found against the real text -- this run is not
 * fixing anything, only measuring and recording what the real data shows.
 *
 * Usage:
 *   LEGAL_CORPUS_MATERIALIZATION_SIGNING_PRIVATE_KEY_PEM=... \
 *   LEGAL_CORPUS_MATERIALIZATION_SIGNING_PUBLIC_KEY_PEM=... \
 *     npx tsx scripts/db/legal-corpus-law-v24-rematerialization-01.ts
 */
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { composeLegalCorpusMaterialization } from '../../server/modules/legal/materialization/LegalCorpusMaterializationCompositionRoot';
import { resolveActiveRegistryBinding } from '../../server/modules/legal/materialization/SourceRegistryAdmissionAdapter';
import { PdfParseExtractorAdapter } from '../../server/text-projection/pdfParseExtractorAdapter';
import { admitChunks, admitLawChunksV24 } from '../../server/modules/legal/materialization/ChunkAdmission';
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
const V24_POLICY = 'legal-chunker-v2.4';

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

  const identity = {
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

  const { buildCanonicalLegalCorpusRecordKey } = await import('@miljobeslut/mps-legal-corpus');
  const documentId = buildCanonicalLegalCorpusRecordKey(identity);
  const runId = `run-lawv24-${runTag}-${randomUUID()}`;

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
      metadata: { governed: true, unit: 'LEGAL-CORPUS-LAW-V2.4-REMATERIALIZATION-01', structure_kind: 'law' },
    },
  });

  return { result, documentId };
}

async function main() {
  console.log('########## LEGAL-CORPUS-LAW-V2.4-REMATERIALIZATION-01 ##########');

  const rawBytes = new Uint8Array(readFileSync(`C:\\miljöbeslut\\.quarantine\\${QUARANTINE_ID}.bin`));
  const rawContentHash = createHash('sha256').update(rawBytes).digest('hex');
  console.log('\nraw quarantine hash:', rawContentHash);

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
    `(${extraction.text.length} chars, same projection as Part G)`,
  );

  // ---------- STEP 0: confirm the pre-existing v2.3 materialization (Part G) is present and will
  // remain untouched by everything below (identity does not depend on anything this script does). ----------
  // K2.1b(2) consequence, stated rather than hidden: this v2.3 baseline is addressed by the
  // ACTIVE registry identity. A row materialized under the superseded artifact id carries a
  // different canonical_record_key and will not be found; reconciling historical rows across a
  // re-attestation is successor-chain semantics, explicitly out of scope for this repair.
  const mainActiveBinding = await resolveActiveRegistryBinding({
    sourceId: SOURCE_ID,
    expectedSourceContentHash: REGISTRY_SOURCE_CONTENT_HASH,
  });
  const v23Identity = {
    logical_source_id: SOURCE_ID,
    registry_artifact_id: mainActiveBinding.registryArtifactId,
    registry_source_content_hash: mainActiveBinding.registrySourceContentHash,
    raw_source_content_hash: rawContentHash,
    text_projection_artifact_id: `projection-${QUARANTINE_ID}`,
    text_projection_hash: projectedTextHash,
    text_projection_version: 'html-extract@1.0',
    corpus_materialization_version: 'corpus-materialization-v1',
    chunk_policy_version: V23_POLICY,
  };
  const { buildCanonicalLegalCorpusRecordKey } = await import('@miljobeslut/mps-legal-corpus');
  const v23DocumentId = buildCanonicalLegalCorpusRecordKey(v23Identity);
  const v23RowBefore = await prisma.legalCorpusMaterialization.findUnique({
    where: { canonicalRecordKey: v23DocumentId },
  });
  const v23ChunkCountBefore = v23RowBefore ? await countChunks(v23RowBefore.id) : -1;
  console.log('\n--- STEP 0: pre-existing v2.3 materialization (Part G) ---');
  console.log('v2.3 materialization_id:', v23DocumentId);
  console.log('v2.3 row exists:', v23RowBefore !== null, '| chunk rows:', v23ChunkCountBefore);
  if (!v23RowBefore) {
    console.log(
      '!!! Part G v2.3 materialization not found -- this run cannot prove "A unchanged" without it existing first. Aborting.',
    );
    await prisma.$disconnect();
    process.exitCode = 1;
    return;
  }

  // ---------- STEP 1: admit under both policies for the real comparison. ----------
  const v23Admission = admitChunks({
    structureKind: 'law',
    text: extraction.text,
    sourceProjectionRef,
    chunkPolicyVersion: V23_POLICY,
  });
  const v24Admission = admitLawChunksV24({
    text: extraction.text,
    sourceProjectionRef,
    chunkPolicyVersion: V24_POLICY,
  });

  const v23Dist = chapterDistribution(v23Admission.admitted);
  const v24Dist = chapterDistribution(v24Admission.admitted);
  const v24LetterSuffixed = Object.keys(v24Dist).filter(
    (k) => /[a-z]/i.test(k) && k !== '(ingen kapitelindelning)',
  );

  console.log('\n--- STEP 1: v2.3 vs v2.4 chunk admission comparison (real Miljöbalken text) ---');
  console.log(
    'v2.3: admitted',
    v23Admission.admitted.length,
    '| rejected',
    v23Admission.rejected.length,
    '| status',
    v23Admission.document_status,
  );
  console.log(
    'v2.4: admitted',
    v24Admission.admitted.length,
    '| rejected',
    v24Admission.rejected.length,
    '| status',
    v24Admission.document_status,
  );
  console.log('v2.3 chapter distribution:', v23Dist);
  console.log('v2.4 chapter distribution:', v24Dist);
  console.log(
    'v2.4 letter-suffixed chapters found:',
    v24LetterSuffixed.map((k) => `${k} (${v24Dist[k]} chunk[s])`),
  );

  // Known, honestly-reported drift: chunkSwedishLawV24's chapterRegex, inherited unanchored from
  // v2.3, scans the WHOLE fragment body for "N[ x] kap.", not just its start. A cross-reference to
  // a DIFFERENT statute's chapter embedded mid-paragraph ("...omfattas av 10 eller 10 a kap.
  // sjölagen (1994:1009)...") can therefore overwrite currentChapter for that fragment even though
  // this specific occurrence is not a Miljöbalken chapter heading at all. This is a pre-existing
  // limitation shared with v2.3 (which has the same unanchored match for plain numeric "N kap."),
  // now also reachable via letter-suffixed patterns -- not introduced by, and not silently hidden
  // by, this unit. Reported here, not fixed here.
  const crossStatuteDrift = v24Admission.admitted.filter(
    (c) => c.structure_kind === 'law' && c.chapter === '10 a' && c.full_text.includes('sjölagen'),
  );
  console.log('\n--- KNOWN DRIFT (reported, not fixed by this unit) ---');
  console.log(
    'chunks mislabeled chapter "10 a" via an embedded cross-reference to sjölagen (a different statute), ' +
      'not a real Miljöbalken chapter heading:',
    crossStatuteDrift.length,
  );
  for (const c of crossStatuteDrift) {
    console.log(
      '  paragraph:',
      c.structure_kind === 'law' ? c.paragraph : undefined,
      '| preview:',
      c.full_text.slice(0, 160),
    );
  }

  const genuineLetterSuffixed = v24Admission.admitted.filter(
    (c) => c.structure_kind === 'law' && c.chapter === '17 a',
  );
  console.log(
    '\ngenuine letter-suffixed chapter correctly captured ("17 a kap.", a real repealed Miljöbalken chapter):',
    genuineLetterSuffixed.length,
  );

  if (v24Admission.admitted.length === 0) {
    console.log('\n!!! zero v2.4 chunks admitted -- aborting materialization.');
    await prisma.$disconnect();
    process.exitCode = 1;
    return;
  }

  // ---------- STEP 2: materialize under v2.4, twice (replay proof). ----------
  console.log('\n--- STEP 2: v2.4 materialization run 1 ---');
  const run1 = await materializeOnce(
    v24Admission.admitted,
    rawContentHash,
    projectedTextHash,
    rawBytes,
    V24_POLICY,
    'run1',
  );
  const v24Row1 = await prisma.legalCorpusMaterialization.findUnique({
    where: { canonicalRecordKey: run1.result.canonical_record_key },
  });
  const v24ChunkCount1 = v24Row1 ? await countChunks(v24Row1.id) : -1;
  console.log('v2.4 materialization_id:', run1.result.canonical_record_key);
  console.log(
    'v2.4 record row:',
    run1.result.corpus_record_id,
    '| provenance row:',
    v24Row1?.id,
    '| governed chunk rows:',
    v24ChunkCount1,
  );
  console.log(
    'v2.4 materialization_id differs from v2.3 materialization_id:',
    run1.result.canonical_record_key !== v23DocumentId,
  );

  console.log('\n--- STEP 3: v2.4 materialization run 2 (replay) ---');
  const run2 = await materializeOnce(
    v24Admission.admitted,
    rawContentHash,
    projectedTextHash,
    rawBytes,
    V24_POLICY,
    'run2',
  );
  const v24ChunkCount2 = v24Row1 ? await countChunks(v24Row1.id) : -1;
  const v24RecordRowCount = await prisma.legalCorpusRecord.count({
    where: { recordKey: run1.result.canonical_record_key },
  });

  const replaySameId = run1.result.canonical_record_key === run2.result.canonical_record_key;
  const replaySameChunkCount = v24ChunkCount1 === v24ChunkCount2;
  const replayNoDuplicateRecords = v24RecordRowCount === 1;
  const replayIdentityStable = run1.documentId === run2.documentId;

  console.log('same materialization_id across runs:', replaySameId);
  console.log(
    'same chunk row count across runs:',
    replaySameChunkCount,
    `(${v24ChunkCount1} vs ${v24ChunkCount2})`,
  );
  console.log(
    'record rows for this key:',
    v24RecordRowCount,
    '(no duplicates:',
    replayNoDuplicateRecords + ')',
  );
  console.log('identity stable:', replayIdentityStable);

  // ---------- STEP 4: re-verify the v2.3 row is completely untouched. ----------
  const v23RowAfter = await prisma.legalCorpusMaterialization.findUnique({
    where: { canonicalRecordKey: v23DocumentId },
  });
  const v23ChunkCountAfter = v23RowAfter ? await countChunks(v23RowAfter.id) : -1;
  const v23Untouched =
    v23RowAfter !== null &&
    v23RowBefore.id === v23RowAfter.id &&
    v23ChunkCountBefore === v23ChunkCountAfter &&
    v23RowBefore.createdAt.getTime() === v23RowAfter.createdAt.getTime();

  console.log('\n--- STEP 4: v2.3 materialization (Part G) after this run ---');
  console.log('v2.3 row still exists, same pk, same chunk count, same createdAt (untouched):', v23Untouched);
  console.log('v2.3 chunk rows before/after:', v23ChunkCountBefore, '/', v23ChunkCountAfter);

  console.log('\n\n========== LEGAL-CORPUS-LAW-V2.4-REMATERIALIZATION-01 SUMMARY ==========');
  console.log(
    JSON.stringify(
      {
        source: SOURCE_ID,
        quarantine_id: QUARANTINE_ID,
        v23: {
          materialization_id: v23DocumentId,
          untouched: v23Untouched,
          chunk_rows: v23ChunkCountAfter,
          admitted: v23Admission.admitted.length,
          rejected: v23Admission.rejected.length,
          chapter_distribution: v23Dist,
        },
        v24: {
          materialization_id: run1.result.canonical_record_key,
          distinct_from_v23: run1.result.canonical_record_key !== v23DocumentId,
          chunk_rows: v24ChunkCount1,
          admitted: v24Admission.admitted.length,
          rejected: v24Admission.rejected.length,
          chapter_distribution: v24Dist,
          letter_suffixed_chapters_found: v24LetterSuffixed,
          replay_same_materialization_id: replaySameId,
          replay_same_chunk_count: replaySameChunkCount,
          replay_no_duplicate_records: replayNoDuplicateRecords,
          replay_identity_stable: replayIdentityStable,
        },
        known_drift: {
          cross_statute_chapter_mislabel_count: crossStatuteDrift.length,
          description:
            "unanchored chapterRegex (inherited from v2.3) can pick up a cross-reference to a DIFFERENT statute's letter-suffixed chapter embedded mid-paragraph; reported, not fixed, by this unit",
        },
        overall_status:
          v23Untouched &&
          run1.result.canonical_record_key !== v23DocumentId &&
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
