/**
 * LEGAL-CORPUS-MATERIALIZATION-V1-BULK-01.
 *
 * Materializes the remaining 7 already-PROVEN P2-HARVEST-LIVE-01 single-endpoint sources
 * (5 SFS statutes/ordinances + HVMFS + SGU well-drilling guidance) through the now-proven
 * governed chain: projection -> classification -> chunk admission -> materialization -> replay.
 *
 * Explicitly excluded: boverket-planbestammelser (FAILED_CLOSED), unsigned Phase B drafts, the
 * 510 remaining PUH court decisions (a separate, bounded batch decision), embeddings, retrieval.
 *
 * Sequential, not parallel. Each source is independently reported and independently PROVEN /
 * PARTIAL / FAILED_CLOSED -- one source's problem does not invalidate another's already-verified
 * materialization.
 *
 * Usage:
 *   LEGAL_CORPUS_MATERIALIZATION_SIGNING_PRIVATE_KEY_PEM=... \
 *   LEGAL_CORPUS_MATERIALIZATION_SIGNING_PUBLIC_KEY_PEM=... \
 *     npx tsx scripts/db/legal-corpus-materialization-bulk-01.ts
 */
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { composeLegalCorpusMaterialization } from '../../server/modules/legal/materialization/LegalCorpusMaterializationCompositionRoot';
import { PdfParseExtractorAdapter } from '../../server/text-projection/pdfParseExtractorAdapter';
import { admitChunks } from '../../server/modules/legal/materialization/ChunkAdmission';
import { prisma } from '../../server/db/prisma';
import type { ChunkStructureKind, LegalChunk } from '@miljobeslut/mps-legal-corpus';

const CHUNK_POLICY_VERSION = 'legal-chunker-v2.3';

interface DocumentSpec {
  readonly sourceId: string;
  readonly authority: string;
  readonly registryArtifactId: string;
  readonly registrySourceContentHash: string;
  readonly quarantineId: string;
  readonly mimeType: string;
  readonly downloadManifestId: string;
  readonly downloadManifestDigest: string;
  readonly structureKind: ChunkStructureKind;
  readonly sourceFamily: string;
  readonly sourceType: string;
  readonly title: string;
}

const DOCUMENTS: readonly DocumentSpec[] = [
  {
    sourceId: 'regeringskansliet-sfs-2013-251', authority: 'Regeringskansliet',
    registryArtifactId: 'reg-rk-sfs-2013-251-001', registrySourceContentHash: '3c46a82cbc1b8ede1653df88a435b991d3d64acaf8e72ed6ec9e9a12fbf37c21',
    quarantineId: 'c623f644-106d-4291-b472-65a6ce68694e', mimeType: 'text/html',
    downloadManifestId: 'download-manifest-pilot-regeringskansliet-sfs-2013-251-2a8d3773-f7f7-4b95-8655-d2502d095954-98b66a7299df09a6',
    downloadManifestDigest: '98b66a7299df09a6750432cfaaf0e1df5279bd77dca7e39a8840cded218c7e34',
    structureKind: 'law', sourceFamily: 'SFS', sourceType: 'ORDINANCE', title: 'Miljöprövningsförordning (2013:251)',
  },
  {
    sourceId: 'regeringskansliet-sfs-2020-614', authority: 'Regeringskansliet',
    registryArtifactId: 'reg-rk-sfs-2020-614-001', registrySourceContentHash: '36fd0e912567b7e1bf828fa24678a5b35459c9135e04f9dd85d5417545112973',
    quarantineId: 'ee39bba5-86ea-4e4c-8375-2ff6eef9a6f3', mimeType: 'text/html',
    downloadManifestId: 'download-manifest-pilot-regeringskansliet-sfs-2020-614-055a39bd-bd6e-4e8f-bf33-70b3f05d8662-f00d3cd19b32a7a7',
    downloadManifestDigest: 'f00d3cd19b32a7a7c44287bccfb614feba25fe062ff184b3ff128f2b73c24008',
    structureKind: 'law', sourceFamily: 'SFS', sourceType: 'ORDINANCE', title: 'Avfallsförordning (2020:614)',
  },
  {
    sourceId: 'regeringskansliet-sfs-2010-900', authority: 'Regeringskansliet',
    registryArtifactId: 'reg-rk-sfs-2010-900-001', registrySourceContentHash: '59161ba7d94e2391e4fff945c6f2f4572290d13e2cddef4cb8c05464ddd1be98',
    quarantineId: '64db5c34-618d-4a0c-ba68-35fa395c3ab5', mimeType: 'text/html',
    downloadManifestId: 'download-manifest-pilot-regeringskansliet-sfs-2010-900-e0d88b92-558b-4178-a881-31ac5ff96a2d-874b3a966c7650c6',
    downloadManifestDigest: '874b3a966c7650c604b00e1031d05c51102d26cd6e103ce04f9a2f5b05bd9446',
    structureKind: 'law', sourceFamily: 'SFS', sourceType: 'LAW', title: 'Plan- och bygglag (2010:900)',
  },
  {
    sourceId: 'regeringskansliet-sfs-2011-338', authority: 'Regeringskansliet',
    registryArtifactId: 'reg-rk-sfs-2011-338-001', registrySourceContentHash: '27d279b8b9945f9101589bf0035cb1ddb816bd39338caa49396aa1ab24ff39f4',
    quarantineId: 'd5faea79-837e-4f7c-a836-f1cd869bc0d2', mimeType: 'text/html',
    downloadManifestId: 'download-manifest-pilot-regeringskansliet-sfs-2011-338-a231ceaa-77fc-4ae4-80b4-2237730e1c25-2e3dfbd878587842',
    downloadManifestDigest: '2e3dfbd878587842d845765bb27838f748b5707064d4ec226640fa9bbd32433a',
    structureKind: 'law', sourceFamily: 'SFS', sourceType: 'ORDINANCE', title: 'Förordning (2011:338) om miljöfarlig verksamhet och hälsoskydd (miljötillsyn)',
  },
  {
    sourceId: 'regeringskansliet-sfs-1998-899', authority: 'Regeringskansliet',
    registryArtifactId: 'reg-rk-sfs-1998-899-001', registrySourceContentHash: 'ef965c7f3ac1f6d98ae4a4ec74405aeef99e726cb4caf83c871b9632160b4bf2',
    quarantineId: 'd3c146d4-2f3c-419e-b7f0-5cd443a756ea', mimeType: 'text/html',
    downloadManifestId: 'download-manifest-pilot-regeringskansliet-sfs-1998-899-dfba2f33-1f58-4021-aa3e-8a2d330b9ec1-3e069dc1f5e52e8f',
    downloadManifestDigest: '3e069dc1f5e52e8f2ad9904ccea8e2feed2c967750cb7e8aed7cd7e927ee3a94',
    structureKind: 'law', sourceFamily: 'SFS', sourceType: 'ORDINANCE', title: 'Förordning (1998:899) om miljöfarlig verksamhet och hälsoskydd',
  },
  {
    sourceId: 'hav-hvmfs-2016-17', authority: 'Havs- och vattenmyndigheten',
    registryArtifactId: 'reg-hav-hvmfs-2016-17-001', registrySourceContentHash: 'bbcd43eb8053e3f62a7480edb330e3a2f5a98bb75d32e1365fd7878a2fba8640',
    quarantineId: 'b86f5d5d-a3c0-4008-8698-511e816f538d', mimeType: 'text/html',
    downloadManifestId: 'download-manifest-pilot-hav-hvmfs-2016-17-47a45b8f-6894-40bf-ab78-49aa03ed44f5-52bfbac0de7cff5c',
    downloadManifestDigest: '52bfbac0de7cff5c78c429992cf2667c1994149745a7ae551277241f50d3b726',
    structureKind: 'standard', sourceFamily: 'HVMFS', sourceType: 'AGENCY_GENERAL_ADVICE', title: 'HVMFS 2016:17 - Små avloppsanordningar för hushållsspillvatten',
  },
  {
    sourceId: 'sgu-well-drilling-guidance', authority: 'Sveriges geologiska undersökning',
    registryArtifactId: 'reg-sgu-well-drilling-guidance-001', registrySourceContentHash: 'b6472a38d46916fa03fa205c0e88684cf04ba561ad9c20ac22847aeb814fe17d',
    quarantineId: '1a6961db-c0a1-4268-b838-d4ba744e37b6', mimeType: 'text/html',
    downloadManifestId: 'download-manifest-pilot-sgu-well-drilling-guidance-d4a65f06-9b20-4a2c-a702-36b02c4154df-e643acd1accd0309',
    downloadManifestDigest: 'e643acd1accd0309baa1c3d13c691c918116a32ddac134f88762839bfc2dd177',
    structureKind: 'standard', sourceFamily: 'SGU', sourceType: 'AGENCY_GUIDANCE', title: 'Vägledning för att borra brunn',
  },
];

async function countChunks(materializationId: string): Promise<number> {
  return prisma.legalCorpusMaterializedChunk.count({ where: { materializationId } });
}

async function materializeOnce(
  spec: DocumentSpec,
  admittedChunks: readonly LegalChunk[],
  rawContentHash: string,
  projectedTextHash: string,
  rawBytes: Uint8Array,
) {
  const { materializer, ingestionManifestStore, signAttestation } = composeLegalCorpusMaterialization();
  const downloadManifestRef = { id: spec.downloadManifestId, content_hash: { algorithm: 'sha256' as const, digest: spec.downloadManifestDigest } };

  const identity = {
    logical_source_id: spec.sourceId,
    registry_artifact_id: spec.registryArtifactId,
    registry_source_content_hash: spec.registrySourceContentHash,
    raw_source_content_hash: rawContentHash,
    text_projection_artifact_id: `projection-${spec.quarantineId}`,
    text_projection_hash: projectedTextHash,
    text_projection_version: 'html-extract@1.0',
    corpus_materialization_version: 'corpus-materialization-v1',
    chunk_policy_version: CHUNK_POLICY_VERSION,
  };

  const { buildCanonicalLegalCorpusRecordKey } = await import('@miljobeslut/mps-legal-corpus');
  const documentId = buildCanonicalLegalCorpusRecordKey(identity);
  const runId = `run-bulk01-${randomUUID()}`;

  const manifestEntryBase = {
    document_id: documentId, source_manifest_ref: downloadManifestRef, status: 'INGESTED' as const,
    classification: {}, content_hash: rawContentHash, pipeline_version: 'text-v1.0',
  };
  await ingestionManifestStore.recordEntry(runId, { ...manifestEntryBase, processed_at: new Date().toISOString() });

  const attestation = await signAttestation({
    documentId, sourceContentHash: rawContentHash, chunks: admittedChunks, pipelineVersion: 'text-v1.0',
    chunkPolicyVersion: CHUNK_POLICY_VERSION, approverActorId: 'system:legal-corpus-materialization',
    approverRole: 'AUTOMATED_EXECUTION_ATTESTOR',
    registryArtifactId: spec.registryArtifactId,
    registrySourceContentHash: spec.registrySourceContentHash,
  });
  const attestationRefDigest = createHash('sha256').update(JSON.stringify(attestation)).digest('hex');
  const attestationRef = { id: `att-${attestationRefDigest.slice(0, 16)}`, content_hash: { algorithm: 'sha256' as const, digest: attestationRefDigest } };
  await ingestionManifestStore.recordEntry(runId, { ...manifestEntryBase, processed_at: new Date().toISOString(), corpus_import_attestation_ref: attestationRef });

  const documentText = admittedChunks.map((c) => c.full_text).join('\n\n') || '(no admitted chunks)';
  const result = await materializer.materialize({
    gate_request: { runId, expectedDocumentIds: [documentId], imports: [{ documentId, chunks: admittedChunks, attestation }] },
    manifest_entry: { ...manifestEntryBase, processed_at: new Date().toISOString(), corpus_import_attestation_ref: attestationRef },
    identity,
    raw_source_ref: { quarantine_id: spec.quarantineId, download_manifest_ref: downloadManifestRef },
    corpus_record: {
      title: spec.title, source_path: `p2://${spec.quarantineId}`, document_text: documentText, search_text: documentText,
      source_family: spec.sourceFamily, source_type: spec.sourceType, source_system: spec.sourceId,
      content_hash: rawContentHash, byte_size: rawBytes.byteLength,
      metadata: { governed: true, batch: 'BULK-01', structure_kind: spec.structureKind },
    },
  });
  return { result, documentId };
}

interface SourceReport {
  source_id: string;
  status: 'PROVEN' | 'PARTIAL' | 'FAILED_CLOSED';
  detail?: string;
  [key: string]: unknown;
}

async function runSource(spec: DocumentSpec): Promise<SourceReport> {
  console.log(`\n\n########## ${spec.sourceId} ##########`);
  const report: SourceReport = { source_id: spec.sourceId, status: 'FAILED_CLOSED' };

  try {
    const rawBytes = new Uint8Array(readFileSync(`C:\\miljöbeslut\\.quarantine\\${spec.quarantineId}.bin`));
    const rawContentHash = createHash('sha256').update(rawBytes).digest('hex');
    report.raw_objects = 1;
    report.raw_content_hash = rawContentHash;

    const adapter = new PdfParseExtractorAdapter();
    const extraction = await adapter.extract(
      { ref: { artifact_id: spec.quarantineId, artifact_type: 'raw_source' }, doc_name: spec.quarantineId, mime_type: spec.mimeType },
      rawBytes,
    );
    const projectedTextHash = createHash('sha256').update(extraction.text, 'utf8').digest('hex');
    const sourceProjectionRef = `sha256:${projectedTextHash}`;
    report.projection_status = extraction.succeeded ? 'OK' : 'FAILED';
    report.projection_version = extraction.version;
    report.projected_text_length = extraction.text.length;
    console.log('projection:', extraction.method, extraction.version, `(${extraction.text.length} chars)`);

    if (!extraction.succeeded) {
      report.status = 'FAILED_CLOSED';
      report.detail = 'projection failed: ' + (extraction.notes ?? 'unknown');
      return report;
    }

    const admission = admitChunks({
      structureKind: spec.structureKind, text: extraction.text, sourceProjectionRef, chunkPolicyVersion: CHUNK_POLICY_VERSION,
    });
    report.document_family = spec.structureKind;
    report.chunk_strategy = spec.structureKind;
    report.chunks_produced = admission.admitted.length + admission.rejected.length;
    report.chunks_admitted = admission.admitted.length;
    report.chunks_rejected = admission.rejected.length;
    report.rejection_reasons = [...new Set(admission.rejected.map((r) => r.reason))];
    report.admission_document_status = admission.document_status;
    console.log('chunking:', report.chunks_admitted, 'admitted /', report.chunks_rejected, 'rejected —', admission.document_status);
    if (report.rejection_reasons.length) console.log('rejection reasons:', report.rejection_reasons);

    if (admission.admitted.length === 0) {
      report.status = 'PARTIAL';
      report.detail = 'zero chunks admitted — nothing to materialize';
      return report;
    }

    const run1 = await materializeOnce(spec, admission.admitted, rawContentHash, projectedTextHash, rawBytes);
    const materializationRow1 = await prisma.legalCorpusMaterialization.findUnique({ where: { canonicalRecordKey: run1.result.canonical_record_key } });
    const chunkCount1 = materializationRow1 ? await countChunks(materializationRow1.id) : -1;
    report.materialization_id = run1.result.canonical_record_key;
    report.record_row = run1.result.corpus_record_id;
    report.provenance_row = materializationRow1?.id;
    report.governed_chunk_rows = chunkCount1;
    console.log('materialized:', run1.result.canonical_record_key, `(${chunkCount1} chunk rows)`);

    const run2 = await materializeOnce(spec, admission.admitted, rawContentHash, projectedTextHash, rawBytes);
    const chunkCount2 = materializationRow1 ? await countChunks(materializationRow1.id) : -1;
    const recordRowCount = await prisma.legalCorpusRecord.count({ where: { recordKey: run1.result.canonical_record_key } });

    report.replay_same_materialization_id = run1.result.canonical_record_key === run2.result.canonical_record_key;
    report.replay_same_chunk_count = chunkCount1 === chunkCount2;
    report.replay_duplicate_rows = recordRowCount !== 1;
    report.replay_identity_drift = run1.documentId !== run2.documentId;
    console.log('replay:', report.replay_same_materialization_id ? 'same identity' : 'IDENTITY DRIFT', '/', chunkCount1, 'vs', chunkCount2, 'chunk rows / record rows =', recordRowCount);

    report.status = report.replay_same_materialization_id && report.replay_same_chunk_count && !report.replay_duplicate_rows && !report.replay_identity_drift
      ? 'PROVEN'
      : 'PARTIAL';
    return report;
  } catch (error) {
    report.status = 'FAILED_CLOSED';
    report.detail = error instanceof Error ? error.message : String(error);
    console.error('FAILED_CLOSED:', report.detail);
    return report;
  }
}

async function main() {
  const reports: SourceReport[] = [];
  for (const spec of DOCUMENTS) {
    reports.push(await runSource(spec));
  }

  console.log('\n\n========== LEGAL-CORPUS-MATERIALIZATION-V1-BULK-01 SUMMARY ==========');
  for (const r of reports) console.log(JSON.stringify(r, null, 2));

  const proven = reports.filter((r) => r.status === 'PROVEN').length;
  const partial = reports.filter((r) => r.status === 'PARTIAL').length;
  const failed = reports.filter((r) => r.status === 'FAILED_CLOSED').length;
  const totalChunkRows = reports.reduce((sum, r) => sum + (typeof r.governed_chunk_rows === 'number' ? r.governed_chunk_rows : 0), 0);
  console.log('\nsources attempted:', reports.length);
  console.log('sources PROVEN:', proven);
  console.log('sources PARTIAL:', partial);
  console.log('sources FAILED_CLOSED:', failed);
  console.log('total governed chunk rows added:', totalChunkRows);

  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error('FATAL:', error);
  await prisma.$disconnect();
  process.exitCode = 1;
});
