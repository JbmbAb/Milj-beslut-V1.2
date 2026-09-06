/**
 * LEGAL-CORPUS-LAW-V2.4.1-BULK-01.
 *
 * Source-by-source rollout of the anchor-fixed chunker (chunk_policy_version =
 * 'legal-chunker-v2.4.1') across the remaining already-materialized SFS law sources (Miljöbalken
 * was already done in LEGAL-CHUNKING-LAW-V2.4-CHAPTER-ANCHOR-01's own proof). Each source reuses
 * its exact existing real quarantined bytes / download manifest / projection -- only the chunk
 * admission path changes.
 *
 * Deliberately NOT a single bulk sweep with a blanket pass/fail: each source gets its own
 * OLD (v2.3) / NEW (v2.4.1) / DELTA report, and a status that is NOT "PROVEN" merely because the
 * process succeeded and replay is stable -- the structural delta against v2.3 must also be
 * inspected and explained. No blanket percentage threshold is used (a source with many
 * letter-suffixed chapters can legitimately show a large delta) -- the report exists so a human
 * (or a careful reviewer) can judge WHY the change happened, not just THAT it happened.
 *
 * Usage:
 *   LEGAL_CORPUS_MATERIALIZATION_SIGNING_PRIVATE_KEY_PEM=... \
 *   LEGAL_CORPUS_MATERIALIZATION_SIGNING_PUBLIC_KEY_PEM=... \
 *     npx tsx scripts/db/legal-corpus-law-v241-bulk-01.ts [count]
 *
 *   [count] -- how many of the remaining 5 sources to process, in the fixed order below.
 *              Defaults to 3 (the "inspect the first 2-3" checkpoint). Pass 5 for the rest.
 */
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { composeLegalCorpusMaterialization } from '../../server/modules/legal/materialization/LegalCorpusMaterializationCompositionRoot';
import {
  resolveActiveRegistryBinding,
  type ActiveRegistryBinding,
} from '../../server/modules/legal/materialization/SourceRegistryAdmissionAdapter';
import { PdfParseExtractorAdapter } from '../../server/text-projection/pdfParseExtractorAdapter';
import { admitChunks, admitLawChunksV24 } from '../../server/modules/legal/materialization/ChunkAdmission';
import { prisma } from '../../server/db/prisma';
import type { LegalChunk } from '@miljobeslut/mps-legal-corpus';

const V23_POLICY = 'legal-chunker-v2.3';
const V241_POLICY = 'legal-chunker-v2.4.1';

interface SourceSpec {
  readonly sourceId: string;
  readonly registrySourceContentHash: string;
  readonly quarantineId: string;
  readonly mimeType: string;
  readonly downloadManifestRef: { id: string; content_hash: { algorithm: 'sha256'; digest: string } };
  readonly title: string;
}

const SOURCES: readonly SourceSpec[] = [
  {
    sourceId: 'regeringskansliet-sfs-2013-251',
    registrySourceContentHash: '3c46a82cbc1b8ede1653df88a435b991d3d64acaf8e72ed6ec9e9a12fbf37c21',
    quarantineId: 'c623f644-106d-4291-b472-65a6ce68694e',
    mimeType: 'text/html',
    downloadManifestRef: {
      id: 'download-manifest-pilot-regeringskansliet-sfs-2013-251-2a8d3773-f7f7-4b95-8655-d2502d095954-98b66a7299df09a6',
      content_hash: { algorithm: 'sha256', digest: '98b66a7299df09a6750432cfaaf0e1df5279bd77dca7e39a8840cded218c7e34' },
    },
    title: 'Miljöprövningsförordning (2013:251)',
  },
  {
    sourceId: 'regeringskansliet-sfs-2020-614',
    registrySourceContentHash: '36fd0e912567b7e1bf828fa24678a5b35459c9135e04f9dd85d5417545112973',
    quarantineId: 'ee39bba5-86ea-4e4c-8375-2ff6eef9a6f3',
    mimeType: 'text/html',
    downloadManifestRef: {
      id: 'download-manifest-pilot-regeringskansliet-sfs-2020-614-055a39bd-bd6e-4e8f-bf33-70b3f05d8662-f00d3cd19b32a7a7',
      content_hash: { algorithm: 'sha256', digest: 'f00d3cd19b32a7a7c44287bccfb614feba25fe062ff184b3ff128f2b73c24008' },
    },
    title: 'Avfallsförordning (2020:614)',
  },
  {
    sourceId: 'regeringskansliet-sfs-2010-900',
    registrySourceContentHash: '59161ba7d94e2391e4fff945c6f2f4572290d13e2cddef4cb8c05464ddd1be98',
    quarantineId: '64db5c34-618d-4a0c-ba68-35fa395c3ab5',
    mimeType: 'text/html',
    downloadManifestRef: {
      id: 'download-manifest-pilot-regeringskansliet-sfs-2010-900-e0d88b92-558b-4178-a881-31ac5ff96a2d-874b3a966c7650c6',
      content_hash: { algorithm: 'sha256', digest: '874b3a966c7650c604b00e1031d05c51102d26cd6e103ce04f9a2f5b05bd9446' },
    },
    title: 'Plan- och bygglag (2010:900)',
  },
  {
    sourceId: 'regeringskansliet-sfs-2011-338',
    registrySourceContentHash: '27d279b8b9945f9101589bf0035cb1ddb816bd39338caa49396aa1ab24ff39f4',
    quarantineId: 'd5faea79-837e-4f7c-a836-f1cd869bc0d2',
    mimeType: 'text/html',
    downloadManifestRef: {
      id: 'download-manifest-pilot-regeringskansliet-sfs-2011-338-a231ceaa-77fc-4ae4-80b4-2237730e1c25-2e3dfbd878587842',
      content_hash: { algorithm: 'sha256', digest: '2e3dfbd878587842d845765bb27838f748b5707064d4ec226640fa9bbd32433a' },
    },
    title: 'Förordning (2011:338) om miljöfarlig verksamhet och hälsoskydd (miljötillsyn)',
  },
  {
    sourceId: 'regeringskansliet-sfs-1998-899',
    registrySourceContentHash: 'ef965c7f3ac1f6d98ae4a4ec74405aeef99e726cb4caf83c871b9632160b4bf2',
    quarantineId: 'd3c146d4-2f3c-419e-b7f0-5cd443a756ea',
    mimeType: 'text/html',
    downloadManifestRef: {
      id: 'download-manifest-pilot-regeringskansliet-sfs-1998-899-dfba2f33-1f58-4021-aa3e-8a2d330b9ec1-3e069dc1f5e52e8f',
      content_hash: { algorithm: 'sha256', digest: '3e069dc1f5e52e8f2ad9904ccea8e2feed2c967750cb7e8aed7cd7e927ee3a94' },
    },
    title: 'Förordning (1998:899) om miljöfarlig verksamhet och hälsoskydd',
  },
];

function chapterDistribution(admitted: readonly LegalChunk[]): Record<string, number> {
  const dist: Record<string, number> = {};
  for (const c of admitted) {
    if (c.structure_kind !== 'law') continue;
    dist[c.chapter] = (dist[c.chapter] ?? 0) + 1;
  }
  return dist;
}

function paragraphCountDistribution(admitted: readonly LegalChunk[]): { distinctParagraphs: number; totalParagraphFragments: number } {
  const paragraphs = new Set<string>();
  let total = 0;
  for (const c of admitted) {
    if (c.structure_kind !== 'law') continue;
    total++;
    paragraphs.add(`${c.chapter}::${c.paragraph}`);
  }
  return { distinctParagraphs: paragraphs.size, totalParagraphFragments: total };
}

function letterSuffixedChapters(dist: Record<string, number>): string[] {
  return Object.keys(dist).filter((k) => /[a-z]/i.test(k) && k !== '(ingen kapitelindelning)');
}

/** Diagnostic-only count of "eller N[ x] kap." occurrences in the raw sanitized text -- the
 * exact pattern LEGAL-CHUNKING-LAW-V2.4-CHAPTER-ANCHOR-01 rejects. Report-only, does not affect
 * admission; mirrors the chunker's own filter for transparency in the DELTA report. */
function countRejectedEmbeddedReferences(text: string): number {
  const CHAPTER_MARKER = /(\d+(?:\s+[a-z])?)\s+kap\./gi;
  const REJECT = /\beller\s*$/i;
  let count = 0;
  for (const m of text.matchAll(CHAPTER_MARKER)) {
    const before = text.slice(Math.max(0, m.index! - 30), m.index).trimEnd();
    if (REJECT.test(before)) count++;
  }
  return count;
}

async function countChunks(materializationId: string): Promise<number> {
  return prisma.legalCorpusMaterializedChunk.count({ where: { materializationId } });
}

function identityFor(
  spec: SourceSpec,
  chunkPolicyVersion: string,
  rawContentHash: string,
  projectedTextHash: string,
  activeBinding: ActiveRegistryBinding,
) {
  return {
    logical_source_id: spec.sourceId,
    registry_artifact_id: activeBinding.registryArtifactId,
    registry_source_content_hash: activeBinding.registrySourceContentHash,
    raw_source_content_hash: rawContentHash,
    text_projection_artifact_id: `projection-${spec.quarantineId}`,
    text_projection_hash: projectedTextHash,
    text_projection_version: 'html-extract@1.0',
    corpus_materialization_version: 'corpus-materialization-v1',
    chunk_policy_version: chunkPolicyVersion,
  };
}

async function materializeOnce(
  spec: SourceSpec,
  admittedChunks: readonly LegalChunk[],
  rawContentHash: string,
  projectedTextHash: string,
  rawBytes: Uint8Array,
  runTag: string,
) {
  const { materializer, ingestionManifestStore, signAttestation } = composeLegalCorpusMaterialization();
  // K2.1b(2): bind to the ACTIVE registry identity rather than a frozen artifact-id constant.
  const activeBinding = await resolveActiveRegistryBinding({
    sourceId: spec.sourceId,
    expectedSourceContentHash: spec.registrySourceContentHash,
  });
  const identity = identityFor(spec, V241_POLICY, rawContentHash, projectedTextHash, activeBinding);

  const { buildCanonicalLegalCorpusRecordKey } = await import('@miljobeslut/mps-legal-corpus');
  const documentId = buildCanonicalLegalCorpusRecordKey(identity);
  const runId = `run-bulk241-${runTag}-${randomUUID()}`;

  const manifestEntryBase = {
    document_id: documentId, source_manifest_ref: spec.downloadManifestRef, status: 'INGESTED' as const,
    classification: {}, content_hash: rawContentHash, pipeline_version: 'text-v1.0',
  };
  await ingestionManifestStore.recordEntry(runId, { ...manifestEntryBase, processed_at: new Date().toISOString() });

  const attestation = await signAttestation({
    documentId, sourceContentHash: rawContentHash, chunks: admittedChunks, pipelineVersion: 'text-v1.0',
    chunkPolicyVersion: V241_POLICY, approverActorId: 'system:legal-corpus-materialization',
    approverRole: 'AUTOMATED_EXECUTION_ATTESTOR',
    registryArtifactId: activeBinding.registryArtifactId,
    registrySourceContentHash: activeBinding.registrySourceContentHash,
  });
  const attestationRefDigest = createHash('sha256').update(JSON.stringify(attestation)).digest('hex');
  const attestationRef = { id: `att-${attestationRefDigest.slice(0, 16)}`, content_hash: { algorithm: 'sha256' as const, digest: attestationRefDigest } };
  await ingestionManifestStore.recordEntry(runId, { ...manifestEntryBase, processed_at: new Date().toISOString(), corpus_import_attestation_ref: attestationRef });

  const documentText = admittedChunks.map((c) => c.full_text).join('\n\n') || '(no admitted chunks)';
  const result = await materializer.materialize({
    gate_request: { runId, expectedDocumentIds: [documentId], imports: [{ documentId, chunks: admittedChunks, attestation }] },
    manifest_entry: { ...manifestEntryBase, processed_at: new Date().toISOString(), corpus_import_attestation_ref: attestationRef },
    identity,
    raw_source_ref: { quarantine_id: spec.quarantineId, download_manifest_ref: spec.downloadManifestRef },
    corpus_record: {
      title: spec.title, source_path: `p2://${spec.quarantineId}`, document_text: documentText, search_text: documentText,
      source_family: 'SFS', source_type: 'ORDINANCE_OR_LAW', source_system: spec.sourceId,
      content_hash: rawContentHash, byte_size: rawBytes.byteLength,
      metadata: { governed: true, unit: 'LEGAL-CORPUS-LAW-V2.4.1-BULK-01' },
    },
  });
  return { result, documentId };
}

interface SourceReport {
  source_id: string;
  status: 'PROVEN' | 'STRUCTURE_REVIEW_REQUIRED' | 'FAILED_CLOSED';
  detail?: string;
  [key: string]: unknown;
}

async function runSource(spec: SourceSpec): Promise<SourceReport> {
  console.log(`\n\n########## ${spec.sourceId} ##########`);
  const report: SourceReport = { source_id: spec.sourceId, status: 'FAILED_CLOSED' };

  try {
    const rawBytes = new Uint8Array(readFileSync(`C:\\miljöbeslut\\.quarantine\\${spec.quarantineId}.bin`));
    const rawContentHash = createHash('sha256').update(rawBytes).digest('hex');

    const adapter = new PdfParseExtractorAdapter();
    const extraction = await adapter.extract(
      { ref: { artifact_id: spec.quarantineId, artifact_type: 'raw_source' }, doc_name: spec.quarantineId, mime_type: spec.mimeType },
      rawBytes,
    );
    const projectedTextHash = createHash('sha256').update(extraction.text, 'utf8').digest('hex');
    const sourceProjectionRef = `sha256:${projectedTextHash}`;
    console.log('projection:', extraction.method, extraction.version, `(${extraction.text.length} chars)`);

    if (!extraction.succeeded) {
      report.status = 'FAILED_CLOSED';
      report.detail = 'projection failed: ' + (extraction.notes ?? 'unknown');
      return report;
    }

    // ---------- OLD (v2.3), re-verified against the live DB row created in BULK-01 ----------
    // K2.1b(2) consequence, stated rather than hidden: this baseline is addressed by the ACTIVE
    // registry identity, like every other identity in this script. Rows materialized under the
    // superseded artifact id carry a different canonical_record_key and will therefore NOT be
    // found here. Reconciling historical rows across a re-attestation is successor-chain
    // semantics, which this repair is explicitly scoped out of; the miss is reported as
    // FAILED_CLOSED below rather than silently papered over with a stale id.
    const v23ActiveBinding = await resolveActiveRegistryBinding({
      sourceId: spec.sourceId,
      expectedSourceContentHash: spec.registrySourceContentHash,
    });
    const v23Identity = identityFor(spec, V23_POLICY, rawContentHash, projectedTextHash, v23ActiveBinding);
    const { buildCanonicalLegalCorpusRecordKey } = await import('@miljobeslut/mps-legal-corpus');
    const v23DocumentId = buildCanonicalLegalCorpusRecordKey(v23Identity);
    const v23Row = await prisma.legalCorpusMaterialization.findUnique({ where: { canonicalRecordKey: v23DocumentId } });
    if (!v23Row) {
      report.status = 'FAILED_CLOSED';
      report.detail = 'no existing v2.3 materialization found -- BULK-01 prerequisite missing';
      return report;
    }
    const v23ChunkCountBefore = await countChunks(v23Row.id);
    const v23Admission = admitChunks({ structureKind: 'law', text: extraction.text, sourceProjectionRef, chunkPolicyVersion: V23_POLICY });
    const v23ChapterDist = chapterDistribution(v23Admission.admitted);
    const v23ParaDist = paragraphCountDistribution(v23Admission.admitted);

    // ---------- NEW (v2.4.1) ----------
    const v241Admission = admitLawChunksV24({ text: extraction.text, sourceProjectionRef, chunkPolicyVersion: V241_POLICY });
    const v241ChapterDist = chapterDistribution(v241Admission.admitted);
    const v241ParaDist = paragraphCountDistribution(v241Admission.admitted);
    const letterSuffixed = letterSuffixedChapters(v241ChapterDist);
    const rejectedReferences = countRejectedEmbeddedReferences(extraction.text);

    console.log('OLD v2.3:', v23Admission.admitted.length, 'admitted /', v23Admission.rejected.length, 'rejected | chapters:', Object.keys(v23ChapterDist).length);
    console.log('NEW v2.4.1:', v241Admission.admitted.length, 'admitted /', v241Admission.rejected.length, 'rejected | chapters:', Object.keys(v241ChapterDist).length, '| letter-suffixed:', letterSuffixed);
    console.log('rejected embedded references (diagnostic, "eller N kap." pattern):', rejectedReferences);

    if (v241Admission.admitted.length === 0) {
      report.status = 'STRUCTURE_REVIEW_REQUIRED';
      report.detail = 'zero v2.4.1 chunks admitted -- not materializing';
      report.old = { admitted: v23Admission.admitted.length, rejected: v23Admission.rejected.length, chapter_distribution: v23ChapterDist };
      return report;
    }

    // ---------- MATERIALIZE v2.4.1, twice (replay) ----------
    const run1 = await materializeOnce(spec, v241Admission.admitted, rawContentHash, projectedTextHash, rawBytes, 'run1');
    const v241Row1 = await prisma.legalCorpusMaterialization.findUnique({ where: { canonicalRecordKey: run1.result.canonical_record_key } });
    const v241ChunkCount1 = v241Row1 ? await countChunks(v241Row1.id) : -1;

    const run2 = await materializeOnce(spec, v241Admission.admitted, rawContentHash, projectedTextHash, rawBytes, 'run2');
    const v241ChunkCount2 = v241Row1 ? await countChunks(v241Row1.id) : -1;
    const v241RecordRowCount = await prisma.legalCorpusRecord.count({ where: { recordKey: run1.result.canonical_record_key } });

    const replaySameId = run1.result.canonical_record_key === run2.result.canonical_record_key;
    const replaySameChunkCount = v241ChunkCount1 === v241ChunkCount2;
    const replayNoDuplicateRecords = v241RecordRowCount === 1;
    const replayIdentityStable = run1.documentId === run2.documentId;

    const v23RowAfter = await prisma.legalCorpusMaterialization.findUnique({ where: { canonicalRecordKey: v23DocumentId } });
    const v23ChunkCountAfter = v23RowAfter ? await countChunks(v23RowAfter.id) : -1;
    const v23Untouched = v23RowAfter !== null && v23Row.id === v23RowAfter.id && v23ChunkCountBefore === v23ChunkCountAfter && v23Row.createdAt.getTime() === v23RowAfter.createdAt.getTime();

    const totalChunkDelta = v241Admission.admitted.length - v23Admission.admitted.length;
    const oldChapters = new Set(Object.keys(v23ChapterDist));
    const newChapters = new Set(Object.keys(v241ChapterDist));
    const newlyDiscovered = [...newChapters].filter((c) => !oldChapters.has(c));
    const disappeared = [...oldChapters].filter((c) => !newChapters.has(c));

    // Concentration shift: report per-chapter chunk-count delta, largest first -- no threshold,
    // just the raw numbers for inspection (see module doc comment).
    const allChapterKeys = new Set([...oldChapters, ...newChapters]);
    const concentrationShifts = [...allChapterKeys]
      .map((k) => ({ chapter: k, old: v23ChapterDist[k] ?? 0, new: v241ChapterDist[k] ?? 0, delta: (v241ChapterDist[k] ?? 0) - (v23ChapterDist[k] ?? 0) }))
      .filter((s) => s.delta !== 0)
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

    console.log('replay:', replaySameId ? 'same identity' : 'IDENTITY DRIFT', '/', v241ChunkCount1, 'vs', v241ChunkCount2, 'chunk rows / record rows =', v241RecordRowCount);
    console.log('v2.3 untouched:', v23Untouched, `(${v23ChunkCountBefore} vs ${v23ChunkCountAfter})`);
    console.log('total chunk delta:', totalChunkDelta, '| newly discovered chapters:', newlyDiscovered, '| disappeared chapters:', disappeared);
    console.log('largest chapter shifts:', JSON.stringify(concentrationShifts.slice(0, 5)));

    const technicallySound = replaySameId && replaySameChunkCount && replayNoDuplicateRecords && replayIdentityStable && v23Untouched;

    report.old = {
      materialization_id: v23DocumentId,
      admitted: v23Admission.admitted.length,
      rejected: v23Admission.rejected.length,
      chunk_count: v23ChunkCountAfter,
      chapter_distribution: v23ChapterDist,
      distinct_paragraphs: v23ParaDist.distinctParagraphs,
    };
    report.new = {
      materialization_id: run1.result.canonical_record_key,
      admitted: v241Admission.admitted.length,
      rejected: v241Admission.rejected.length,
      chunk_count: v241ChunkCount1,
      chapter_distribution: v241ChapterDist,
      distinct_paragraphs: v241ParaDist.distinctParagraphs,
      letter_suffixed_chapters: letterSuffixed,
      rejected_embedded_references: rejectedReferences,
    };
    report.delta = {
      total_chunk_delta: totalChunkDelta,
      newly_discovered_chapters: newlyDiscovered,
      disappeared_chapters: disappeared,
      largest_chapter_shifts: concentrationShifts.slice(0, 8),
    };
    report.replay = { same_materialization_id: replaySameId, same_chunk_count: replaySameChunkCount, no_duplicate_records: replayNoDuplicateRecords, identity_stable: replayIdentityStable };
    report.v23_untouched = v23Untouched;

    // Status is NOT auto-PROVEN on process success alone. A real replay/persistence failure is
    // FAILED_CLOSED (a genuine defect, not a judgment call). Otherwise this script always reports
    // STRUCTURE_REVIEW_REQUIRED -- the structural delta against v2.3 must be inspected and
    // explained by a human before anything here is promoted to PROVEN; this script does not make
    // that call for itself.
    report.status = technicallySound ? 'STRUCTURE_REVIEW_REQUIRED' : 'FAILED_CLOSED';
    if (!technicallySound) {
      report.detail = 'technical replay/persistence check failed -- see replay/v23_untouched fields';
    }
    return report;
  } catch (error) {
    report.status = 'FAILED_CLOSED';
    report.detail = error instanceof Error ? error.message : String(error);
    console.error('FAILED_CLOSED:', report.detail);
    return report;
  }
}

async function main() {
  const count = Math.min(Number(process.argv[2] ?? 3), SOURCES.length);
  const toRun = SOURCES.slice(0, count);
  console.log(`Running ${toRun.length} of ${SOURCES.length} remaining law sources under legal-chunker-v2.4.1.`);

  const reports: SourceReport[] = [];
  for (const spec of toRun) {
    reports.push(await runSource(spec));
  }

  console.log('\n\n========== LEGAL-CORPUS-LAW-V2.4.1-BULK-01 REPORT ==========');
  for (const r of reports) console.log(JSON.stringify(r, null, 2));

  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error('FATAL:', error);
  await prisma.$disconnect();
  process.exitCode = 1;
});
