/**
 * LEGAL-CORPUS-CHUNK-PERSISTENCE-V1 (F2) — replay/rechunk proof against the real database.
 *
 * Isolates the PERSISTENCE layer from acquisition: builds one synthetic-but-governed-shaped
 * document (real chunk admission via ChunkAdmission.ts, real signing, real Prisma writes
 * through the real composition root) and runs it three times to prove:
 *
 *   run 1                          -> record=1, materialization=1, chunks=N, manifest=1
 *   run 2 (identical inputs)       -> same materialization identity, same fragment ids,
 *                                      chunks still=N, no duplicate rows
 *   run 3 (different chunk policy) -> new materialization identity, new chunk set,
 *                                      run 1/2's chunk rows still exist, unchanged
 *
 * Usage:
 *   LEGAL_CORPUS_MATERIALIZATION_SIGNING_PRIVATE_KEY_PEM=... \
 *   LEGAL_CORPUS_MATERIALIZATION_SIGNING_PUBLIC_KEY_PEM=... \
 *     npx tsx scripts/db/legal-corpus-materialization-persistence-proof.ts
 */
import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';

import { composeLegalCorpusMaterialization } from '../../server/modules/legal/materialization/LegalCorpusMaterializationCompositionRoot';
import { admitLawChunks } from '../../server/modules/legal/materialization/ChunkAdmission';
import { prisma } from '../../server/db/prisma';

const TEXT =
  '2 kap. Allmänna bestämmelser om denna rubrik som föregår första paragrafen i kapitlet.\n' +
  '1 § Detta är text för första paragrafens innehåll, tillräckligt lång för att bli en chunk.\n' +
  '2 § Detta är text för andra paragrafens innehåll, också tillräckligt lång för att räknas.';

// Reuses a REAL P2-HARVEST-LIVE-01 download manifest (regeringskansliet-sfs-1998-808) already
// persisted in .quarantine/download-manifests/ -- so sourceManifestResolver.resolve() succeeds
// against a genuine governed acquisition, not a fabricated reference. Only logical_source_id is
// synthesized per run (randomized) so this proof script can run repeatedly without colliding
// with a real materialization of the actual statute.
const LOGICAL_SOURCE_ID = `pilot-persistence-proof-${randomUUID()}`;
const REGISTRY_ARTIFACT_ID = 'reg-rk-sfs-1998-808-001';
const REGISTRY_SOURCE_CONTENT_HASH = '888c7cbafc18058a9c254901b1b09e163726e270c271122ce532123af9285b97';
const RAW_SOURCE_CONTENT_HASH = 'b0f2708d931edcab18a05f803a1103d62278358168782fc318eaa555739590a9';
const TEXT_PROJECTION_HASH = createHash('sha256').update(TEXT).digest('hex');
const SOURCE_MANIFEST_REF = {
  id: 'download-manifest-pilot-regeringskansliet-sfs-1998-808-2c4f969a-60c7-4004-bed3-bf0147f25f37-330b1b6031bb712b',
  content_hash: {
    algorithm: 'sha256' as const,
    digest: '330b1b6031bb712bdab1e2bde35217f42acb3d875a1ef0baa704245643047c1f',
  },
};

async function runOnce(chunkPolicyVersion: string) {
  const { materializer, ingestionManifestStore, signAttestation } = composeLegalCorpusMaterialization();

  const sourceProjectionRef = `sha256:${TEXT_PROJECTION_HASH}`;
  const admission = admitLawChunks({ text: TEXT, sourceProjectionRef, chunkPolicyVersion });
  if (admission.admitted.length === 0) throw new Error('admission produced zero chunks');

  const identity = {
    logical_source_id: LOGICAL_SOURCE_ID,
    registry_artifact_id: REGISTRY_ARTIFACT_ID,
    registry_source_content_hash: REGISTRY_SOURCE_CONTENT_HASH,
    raw_source_content_hash: RAW_SOURCE_CONTENT_HASH,
    text_projection_artifact_id: 'projection-synthetic',
    text_projection_hash: TEXT_PROJECTION_HASH,
    text_projection_version: 'html-extract@1.0',
    corpus_materialization_version: 'corpus-materialization-v1',
    chunk_policy_version: chunkPolicyVersion,
  };

  const { buildCanonicalLegalCorpusRecordKey } = await import('@miljobeslut/mps-legal-corpus');
  const documentId = buildCanonicalLegalCorpusRecordKey(identity);
  const runId = `run-${randomUUID()}`;

  await ingestionManifestStore.recordEntry(runId, {
    document_id: documentId,
    source_manifest_ref: SOURCE_MANIFEST_REF,
    status: 'INGESTED',
    classification: {},
    content_hash: RAW_SOURCE_CONTENT_HASH,
    pipeline_version: 'text-v1.0',
    processed_at: new Date().toISOString(),
    corpus_import_attestation_ref: { id: 'placeholder', content_hash: { algorithm: 'sha256', digest: 'c'.repeat(64) } },
  });

  const attestation = await signAttestation({
    documentId,
    sourceContentHash: RAW_SOURCE_CONTENT_HASH,
    chunks: admission.admitted,
    pipelineVersion: 'text-v1.0',
    chunkPolicyVersion,
    approverActorId: 'system:legal-corpus-materialization',
    approverRole: 'AUTOMATED_EXECUTION_ATTESTOR',
  });

  const attestationRefDigest = createHash('sha256')
    .update(JSON.stringify(attestation))
    .digest('hex');
  await ingestionManifestStore.recordEntry(runId, {
    document_id: documentId,
    source_manifest_ref: SOURCE_MANIFEST_REF,
    status: 'INGESTED',
    classification: {},
    content_hash: RAW_SOURCE_CONTENT_HASH,
    pipeline_version: 'text-v1.0',
    processed_at: new Date().toISOString(),
    corpus_import_attestation_ref: { id: `att-${attestationRefDigest.slice(0, 16)}`, content_hash: { algorithm: 'sha256', digest: attestationRefDigest } },
  });

  const result = await materializer.materialize({
    gate_request: {
      runId,
      expectedDocumentIds: [documentId],
      imports: [{ documentId, chunks: admission.admitted, attestation }],
    },
    manifest_entry: {
      document_id: documentId,
      source_manifest_ref: SOURCE_MANIFEST_REF,
      status: 'INGESTED',
      classification: {},
      content_hash: RAW_SOURCE_CONTENT_HASH,
      pipeline_version: 'text-v1.0',
      processed_at: new Date().toISOString(),
      corpus_import_attestation_ref: { id: `att-${attestationRefDigest.slice(0, 16)}`, content_hash: { algorithm: 'sha256', digest: attestationRefDigest } },
    },
    identity,
    raw_source_ref: { synthetic: true, source_manifest_ref: SOURCE_MANIFEST_REF },
    corpus_record: {
      title: 'Persistence proof synthetic document',
      source_path: 'synthetic://persistence-proof',
      document_text: TEXT,
      search_text: TEXT,
      source_family: 'SFS',
      source_type: 'LAW',
      source_system: 'regeringskansliet',
      content_hash: RAW_SOURCE_CONTENT_HASH,
      byte_size: TEXT.length,
      metadata: { governed: true, proof: 'F2' },
    },
  });

  return { result, admittedCount: admission.admitted.length, fragmentIds: admission.admitted.map((c) => c.fragment_id) };
}

async function countChunks(materializationId: string): Promise<number> {
  return prisma.legalCorpusMaterializedChunk.count({ where: { materializationId } });
}

async function main() {
  console.log('=== RUN 1 ===');
  const run1 = await runOnce('legal-chunker-v2.3');
  const run1Count = await countChunks(run1.result.corpus_record_id ? run1.result.canonical_record_key : '');
  console.log('materialization identity:', run1.result.canonical_record_key);
  console.log('admitted chunks:', run1.admittedCount);

  console.log('\n=== RUN 2 (identical inputs — replay) ===');
  const run2 = await runOnce('legal-chunker-v2.3');
  console.log('materialization identity:', run2.result.canonical_record_key);
  console.log('SAME identity as run 1:', run1.result.canonical_record_key === run2.result.canonical_record_key);
  console.log('SAME fragment ids as run 1:', JSON.stringify(run1.fragmentIds) === JSON.stringify(run2.fragmentIds));

  const materializationRow = await prisma.legalCorpusMaterialization.findUnique({
    where: { canonicalRecordKey: run1.result.canonical_record_key },
  });
  if (!materializationRow) throw new Error('materialization row not found after run 1/2');
  const chunkCountAfterReplay = await countChunks(materializationRow.id);
  console.log('chunk rows after run 1+2 (should equal admitted count, no duplicates):', chunkCountAfterReplay, 'vs admitted', run1.admittedCount);

  const recordCount = await prisma.legalCorpusRecord.count({ where: { recordKey: run1.result.canonical_record_key } });
  console.log('LegalCorpusRecord rows for this key (should be 1, not 2):', recordCount);

  console.log('\n=== RUN 3 (different chunk policy — rechunk) ===');
  const run3 = await runOnce('legal-chunker-v2.4-test');
  console.log('materialization identity:', run3.result.canonical_record_key);
  console.log('DIFFERENT identity from run 1/2:', run3.result.canonical_record_key !== run1.result.canonical_record_key);

  const oldChunksStillPresent = await countChunks(materializationRow.id);
  console.log('run 1/2 chunk rows still present, unchanged:', oldChunksStillPresent, 'vs original', run1.admittedCount);

  const newMaterializationRow = await prisma.legalCorpusMaterialization.findUnique({
    where: { canonicalRecordKey: run3.result.canonical_record_key },
  });
  const newChunkCount = newMaterializationRow ? await countChunks(newMaterializationRow.id) : 0;
  console.log('run 3 chunk rows (distinct materialization):', newChunkCount);

  console.log('\n=== SUMMARY ===');
  console.log(JSON.stringify({
    run1_materialization: run1.result.canonical_record_key,
    run2_materialization: run2.result.canonical_record_key,
    run3_materialization: run3.result.canonical_record_key,
    replay_identity_stable: run1.result.canonical_record_key === run2.result.canonical_record_key,
    replay_no_duplicate_chunks: chunkCountAfterReplay === run1.admittedCount,
    replay_no_duplicate_records: recordCount === 1,
    rechunk_new_identity: run3.result.canonical_record_key !== run1.result.canonical_record_key,
    rechunk_preserves_old_chunks: oldChunksStillPresent === run1.admittedCount,
  }, null, 2));

  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error('FATAL:', error);
  await prisma.$disconnect();
  process.exitCode = 1;
});
