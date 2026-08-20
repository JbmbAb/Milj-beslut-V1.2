/**
 * LEGAL-CORPUS-PUH-COURT-BATCH-01.
 *
 * A bounded batch of real MMÖD court decisions (default 40) through the same frozen governed
 * chain proven in Part G / Bulk-01: projection -> court chunk admission -> materialization ->
 * replay. Uses raw bytes already quarantined by P2-HARVEST-LIVE-01 -- no re-fetch.
 *
 * Deliberately bounded: this is NOT the full 511-decision batch. If this batch clears cleanly
 * (no new canonical-contract gap), the same script can be re-run with a larger BATCH_SIZE.
 *
 * Usage:
 *   LEGAL_CORPUS_MATERIALIZATION_SIGNING_PRIVATE_KEY_PEM=... \
 *   LEGAL_CORPUS_MATERIALIZATION_SIGNING_PUBLIC_KEY_PEM=... \
 *     npx tsx scripts/db/legal-corpus-materialization-puh-batch-01.ts [batchSize]
 */
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { composeLegalCorpusMaterialization } from '../../server/modules/legal/materialization/LegalCorpusMaterializationCompositionRoot';
import { PdfParseExtractorAdapter } from '../../server/text-projection/pdfParseExtractorAdapter';
import { admitCourtChunks } from '../../server/modules/legal/materialization/ChunkAdmission';
import { prisma } from '../../server/db/prisma';
import type { LegalChunk } from '@miljobeslut/mps-legal-corpus';

const CHUNK_POLICY_VERSION = 'legal-chunker-v2.3';
const QUARANTINE_ROOT = 'C:\\miljöbeslut\\.quarantine';
const MANIFEST_PATH = 'C:\\miljöbeslut\\.quarantine\\download-manifests\\e742f608a7caa2b3b57652163f7b0661c5dbea37affbff0bd206b84662be701e.json';
const BATCH_SIZE = Number(process.argv[2] ?? 40);

interface ManifestObject {
  quarantine_id: string;
  content_hash: string;
  byte_length: number;
  file_name: string;
  url: string;
}
interface Manifest {
  execution_id: string;
  registry_artifact_id: string;
  source_content_hash: string;
  source_id: string;
  objects: ManifestObject[];
}

const DOWNLOAD_MANIFEST_ID =
  'download-manifest-pilot-domstolsverket-puh-mmod-e2c6e403-dc4d-4d22-b36a-8358b406f231-e742f608a7caa2b3';
const DOWNLOAD_MANIFEST_DIGEST = 'e742f608a7caa2b3b57652163f7b0661c5dbea37affbff0bd206b84662be701e';

async function countChunks(materializationId: string): Promise<number> {
  return prisma.legalCorpusMaterializedChunk.count({ where: { materializationId } });
}

interface DocReport {
  quarantine_id: string;
  file_name: string;
  byte_length: number;
  status: 'PROVEN' | 'PARTIAL' | 'FAILED_CLOSED';
  detail?: string;
  chunks_admitted?: number;
  court_sections?: Record<string, number>;
  materialization_id?: string;
  chunk_rows?: number;
  replay_same_id?: boolean;
  replay_same_count?: boolean;
  duplicate_rows?: boolean;
}

async function runDoc(manifest: Manifest, obj: ManifestObject): Promise<DocReport> {
  const report: DocReport = { quarantine_id: obj.quarantine_id, file_name: obj.file_name, byte_length: obj.byte_length, status: 'FAILED_CLOSED' };
  try {
    const rawBytes = new Uint8Array(readFileSync(`${QUARANTINE_ROOT}\\${obj.quarantine_id}.bin`));
    const rawContentHash = createHash('sha256').update(rawBytes).digest('hex');
    if (rawContentHash !== obj.content_hash) {
      report.status = 'FAILED_CLOSED';
      report.detail = `raw bytes on disk do not match manifest content_hash (expected ${obj.content_hash}, got ${rawContentHash})`;
      return report;
    }

    const adapter = new PdfParseExtractorAdapter();
    const extraction = await adapter.extract(
      { ref: { artifact_id: obj.quarantine_id, artifact_type: 'raw_source' }, doc_name: obj.file_name, mime_type: 'application/pdf' },
      rawBytes,
    );

    if (!extraction.succeeded || extraction.text.trim().length === 0) {
      report.status = 'PARTIAL';
      report.detail = 'extraction produced zero usable text: ' + (extraction.notes ?? 'empty');
      return report;
    }

    const projectedTextHash = createHash('sha256').update(extraction.text, 'utf8').digest('hex');
    const sourceProjectionRef = `sha256:${projectedTextHash}`;
    const admission = admitCourtChunks({ text: extraction.text, sourceProjectionRef, chunkPolicyVersion: CHUNK_POLICY_VERSION });

    if (admission.admitted.length === 0) {
      report.status = 'PARTIAL';
      report.detail = '0 chunks admitted (text below MIN_CHUNK_CHARS after section splitting)';
      return report;
    }

    const sectionCounts: Record<string, number> = {};
    for (const c of admission.admitted) {
      if (c.structure_kind === 'court') sectionCounts[c.court_section] = (sectionCounts[c.court_section] ?? 0) + 1;
    }
    report.chunks_admitted = admission.admitted.length;
    report.court_sections = sectionCounts;

    const materializeOnce = async () => {
      const { materializer, ingestionManifestStore, signAttestation } = composeLegalCorpusMaterialization();
      const downloadManifestRef = { id: DOWNLOAD_MANIFEST_ID, content_hash: { algorithm: 'sha256' as const, digest: DOWNLOAD_MANIFEST_DIGEST } };
      const identity = {
        logical_source_id: manifest.source_id, registry_artifact_id: manifest.registry_artifact_id,
        registry_source_content_hash: manifest.source_content_hash, raw_source_content_hash: rawContentHash,
        text_projection_artifact_id: `projection-${obj.quarantine_id}`, text_projection_hash: projectedTextHash,
        text_projection_version: 'pdf-parse@2.4.5', corpus_materialization_version: 'corpus-materialization-v1',
        chunk_policy_version: CHUNK_POLICY_VERSION,
      };
      const { buildCanonicalLegalCorpusRecordKey } = await import('@miljobeslut/mps-legal-corpus');
      const documentId = buildCanonicalLegalCorpusRecordKey(identity);
      const runId = `run-puhbatch01-${randomUUID()}`;
      const base = {
        document_id: documentId, source_manifest_ref: downloadManifestRef, status: 'INGESTED' as const,
        classification: {}, content_hash: rawContentHash, pipeline_version: 'text-v1.0',
      };
      await ingestionManifestStore.recordEntry(runId, { ...base, processed_at: new Date().toISOString() });
      const attestation = await signAttestation({
        documentId, sourceContentHash: rawContentHash, chunks: admission.admitted, pipelineVersion: 'text-v1.0',
        chunkPolicyVersion: CHUNK_POLICY_VERSION, approverActorId: 'system:legal-corpus-materialization',
        approverRole: 'AUTOMATED_EXECUTION_ATTESTOR',
      });
      const attRefDigest = createHash('sha256').update(JSON.stringify(attestation)).digest('hex');
      const attRef = { id: `att-${attRefDigest.slice(0, 16)}`, content_hash: { algorithm: 'sha256' as const, digest: attRefDigest } };
      await ingestionManifestStore.recordEntry(runId, { ...base, processed_at: new Date().toISOString(), corpus_import_attestation_ref: attRef });
      const documentText = admission.admitted.map((c: LegalChunk) => c.full_text).join('\n\n');
      return materializer.materialize({
        gate_request: { runId, expectedDocumentIds: [documentId], imports: [{ documentId, chunks: admission.admitted, attestation }] },
        manifest_entry: { ...base, processed_at: new Date().toISOString(), corpus_import_attestation_ref: attRef },
        identity, raw_source_ref: { quarantine_id: obj.quarantine_id, download_manifest_ref: downloadManifestRef },
        corpus_record: {
          title: obj.file_name.replace(/\.pdf$/i, ''), source_path: `p2://${obj.quarantine_id}`,
          document_text: documentText, search_text: documentText, source_family: 'MMOD', source_type: 'decision',
          source_system: manifest.source_id, content_hash: rawContentHash, byte_size: rawBytes.byteLength,
          metadata: { governed: true, batch: 'PUH-COURT-BATCH-01' },
        },
      });
    };

    const run1 = await materializeOnce();
    const materializationRow = await prisma.legalCorpusMaterialization.findUnique({ where: { canonicalRecordKey: run1.canonical_record_key } });
    const count1 = materializationRow ? await countChunks(materializationRow.id) : -1;
    report.materialization_id = run1.canonical_record_key;
    report.chunk_rows = count1;

    const run2 = await materializeOnce();
    const count2 = materializationRow ? await countChunks(materializationRow.id) : -1;
    const recordCount = await prisma.legalCorpusRecord.count({ where: { recordKey: run1.canonical_record_key } });

    report.replay_same_id = run1.canonical_record_key === run2.canonical_record_key;
    report.replay_same_count = count1 === count2;
    report.duplicate_rows = recordCount !== 1;
    report.status = report.replay_same_id && report.replay_same_count && !report.duplicate_rows ? 'PROVEN' : 'PARTIAL';
    return report;
  } catch (error) {
    report.status = 'FAILED_CLOSED';
    report.detail = error instanceof Error ? error.message : String(error);
    return report;
  }
}

async function main() {
  const manifest: Manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
  const seen = new Set<string>();
  const uniqueObjects: ManifestObject[] = [];
  const duplicatesFound: { file_name: string; sharesContentWith: string }[] = [];
  for (const obj of manifest.objects) {
    if (seen.has(obj.content_hash)) {
      const original = uniqueObjects.find((o) => o.content_hash === obj.content_hash);
      duplicatesFound.push({ file_name: obj.file_name, sharesContentWith: original?.file_name ?? '?' });
      continue;
    }
    seen.add(obj.content_hash);
    uniqueObjects.push(obj);
  }

  const batch = uniqueObjects.slice(0, BATCH_SIZE);
  console.log(`Batch size: ${batch.length} (requested ${BATCH_SIZE}, ${manifest.objects.length} total objects in manifest, ${uniqueObjects.length} unique by content_hash)`);
  console.log('Duplicate attachments found in full manifest (not necessarily in this batch):', duplicatesFound.length);

  const reports: DocReport[] = [];
  let idx = 0;
  for (const obj of batch) {
    idx++;
    process.stdout.write(`\r[${idx}/${batch.length}] ${obj.file_name}...`.padEnd(100));
    reports.push(await runDoc(manifest, obj));
  }
  console.log('\n');

  const byStatus = { PROVEN: 0, PARTIAL: 0, FAILED_CLOSED: 0 };
  const zeroChunkDocs: string[] = [];
  const largeDocs: { file_name: string; byte_length: number }[] = [];
  const extractionFailures: string[] = [];
  const replayDrift: string[] = [];
  const sectionDistribution: Record<string, number> = {};
  const chunkCountDistribution: number[] = [];

  for (const r of reports) {
    byStatus[r.status]++;
    if (r.byte_length > 3_000_000) largeDocs.push({ file_name: r.file_name, byte_length: r.byte_length });
    if (r.detail?.includes('zero usable text')) extractionFailures.push(r.file_name);
    if (r.chunks_admitted === 0 || (r.status === 'PARTIAL' && r.detail?.includes('0 chunks'))) zeroChunkDocs.push(r.file_name);
    if (r.replay_same_id === false) replayDrift.push(r.file_name);
    if (r.court_sections) {
      for (const [section, count] of Object.entries(r.court_sections)) sectionDistribution[section] = (sectionDistribution[section] ?? 0) + count;
      chunkCountDistribution.push(r.chunks_admitted ?? 0);
    }
  }

  console.log('========== LEGAL-CORPUS-PUH-COURT-BATCH-01 SUMMARY ==========');
  console.log(JSON.stringify({
    batch_size: batch.length,
    unique_objects_in_full_manifest: uniqueObjects.length,
    duplicate_attachments_in_full_manifest: duplicatesFound.length,
    status_counts: byStatus,
    zero_chunk_documents: zeroChunkDocs,
    extraction_failures: extractionFailures,
    large_documents_over_3mb: largeDocs,
    replay_drift_documents: replayDrift,
    court_section_distribution: sectionDistribution,
    chunk_count_distribution: {
      min: Math.min(...chunkCountDistribution), max: Math.max(...chunkCountDistribution),
      mean: chunkCountDistribution.reduce((a, b) => a + b, 0) / (chunkCountDistribution.length || 1),
      total: chunkCountDistribution.reduce((a, b) => a + b, 0),
    },
  }, null, 2));

  console.log('\nPer-document results:');
  for (const r of reports) console.log(JSON.stringify(r));

  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error('FATAL:', error);
  await prisma.$disconnect();
  process.exitCode = 1;
});
