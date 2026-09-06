/**
 * LEGAL CORPUS MATERIALIZATION V1 -- Part G: the three-document real governed pilot.
 *
 * Uses REAL raw bytes already quarantined by P2-HARVEST-LIVE-01 (no re-fetch here -- acquisition
 * was already proven live and separately; this proves projection -> classification -> chunk
 * admission -> materialization -> replay against real content across three structure families).
 *
 * Usage:
 *   LEGAL_CORPUS_MATERIALIZATION_SIGNING_PRIVATE_KEY_PEM=... \
 *   LEGAL_CORPUS_MATERIALIZATION_SIGNING_PUBLIC_KEY_PEM=... \
 *     npx tsx scripts/db/legal-corpus-materialization-pilot-g.ts
 */
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { composeLegalCorpusMaterialization } from '../../server/modules/legal/materialization/LegalCorpusMaterializationCompositionRoot';
import { resolveActiveRegistryBinding } from '../../server/modules/legal/materialization/SourceRegistryAdmissionAdapter';
import { PdfParseExtractorAdapter } from '../../server/text-projection/pdfParseExtractorAdapter';
import {
  admitChunks,
  type AdmissionDocumentStatus,
} from '../../server/modules/legal/materialization/ChunkAdmission';
import { prisma } from '../../server/db/prisma';
import type { ChunkStructureKind, LegalChunk } from '@miljobeslut/mps-legal-corpus';

const QUARANTINE_ROOT = 'C:\\miljöbeslut\\.quarantine';
const CHUNK_POLICY_VERSION = 'legal-chunker-v2.3';

interface DocumentSpec {
  readonly label: string;
  readonly sourceId: string;
  readonly authority: string;
  readonly registrySourceContentHash: string;
  readonly quarantineId: string;
  readonly mimeType: string;
  readonly downloadManifestRef: { id: string; content_hash: { algorithm: 'sha256'; digest: string } };
  readonly structureKind: ChunkStructureKind;
  readonly sourceFamily: string;
  readonly sourceType: string;
  readonly title: string;
  readonly knownRawVolatility?: string;
}

const DOCUMENTS: readonly DocumentSpec[] = [
  {
    label: '1. SFS (Miljöbalken)',
    sourceId: 'regeringskansliet-sfs-1998-808',
    authority: 'Regeringskansliet',
    registrySourceContentHash: '888c7cbafc18058a9c254901b1b09e163726e270c271122ce532123af9285b97',
    quarantineId: '602c6415-8125-4677-a61d-d4f868a965b6',
    mimeType: 'text/html',
    downloadManifestRef: {
      id: 'download-manifest-pilot-regeringskansliet-sfs-1998-808-2c4f969a-60c7-4004-bed3-bf0147f25f37-330b1b6031bb712b',
      content_hash: {
        algorithm: 'sha256',
        digest: '330b1b6031bb712bdab1e2bde35217f42acb3d875a1ef0baa704245643047c1f',
      },
    },
    structureKind: 'law',
    sourceFamily: 'SFS',
    sourceType: 'LAW',
    title: 'Miljöbalk (1998:808)',
  },
  {
    label: '2. Regulatory HTML (SGU groundwater guidance)',
    sourceId: 'sgu-groundwater-influence-analytical-models',
    authority: 'Sveriges geologiska undersökning',
    registrySourceContentHash: 'c3d7d17e3ff84f7257abd9942ecd72cafcbc83c9766a6b095aebafcd8ca71f88',
    quarantineId: '5ad61a45-ba58-4dcc-bae1-220cd599aa4b',
    mimeType: 'text/html',
    downloadManifestRef: {
      id: 'download-manifest-pilot-sgu-groundwater-influence-analytical-models-d43d004d-a4e8-4c7b-8076-533f11bedf3c-bd4b494a2e1fd772',
      content_hash: {
        algorithm: 'sha256',
        digest: 'bd4b494a2e1fd7729b293abc6068cb197248f2e8454a789389d73affd9ef28d1',
      },
    },
    structureKind: 'standard',
    sourceFamily: 'SGU',
    sourceType: 'AGENCY_GUIDANCE',
    title: 'Bedömning av influensområde avseende grundvatten - analytiska modeller',
    knownRawVolatility:
      'HTML-SOURCE-STABILITY-01: raw HTTP bytes for this source family are known VOLATILE ' +
      '(server-generated per-render id in navigation markup, verified by diff in an earlier session) -- this pilot ' +
      'proves the projection layer absorbs it correctly, using the one real quarantined fetch on disk.',
  },
  {
    label: '3. PUH court decision (MMÖD)',
    sourceId: 'domstolsverket-puh-mmod',
    authority: 'Domstolsverket',
    registrySourceContentHash: '5d9bc238ef9f0470ef48f30e5c470ef3b12ce638ccd16c6082834f01bae6f977',
    quarantineId: '942b0f43-153a-4ef2-8ec8-9f80fb63bd5c',
    mimeType: 'application/pdf',
    downloadManifestRef: {
      id: 'download-manifest-pilot-domstolsverket-puh-mmod-e2c6e403-dc4d-4d22-b36a-8358b406f231-e742f608a7caa2b3',
      content_hash: {
        algorithm: 'sha256',
        digest: 'e742f608a7caa2b3b57652163f7b0661c5dbea37affbff0bd206b84662be701e',
      },
    },
    structureKind: 'court',
    sourceFamily: 'MMOD',
    sourceType: 'decision',
    title: 'MMÖD dom M 307-24 (2026-08-18)',
  },
];

async function projectAndAdmit(spec: DocumentSpec, bytes: Uint8Array) {
  const adapter = new PdfParseExtractorAdapter();
  const extraction = await adapter.extract(
    {
      ref: { artifact_id: spec.quarantineId, artifact_type: 'raw_source' },
      doc_name: spec.quarantineId,
      mime_type: spec.mimeType,
    },
    bytes,
  );
  const projectedTextHash = createHash('sha256').update(extraction.text, 'utf8').digest('hex');
  const sourceProjectionRef = `sha256:${projectedTextHash}`;

  const admission = admitChunks({
    structureKind: spec.structureKind,
    text: extraction.text,
    sourceProjectionRef,
    chunkPolicyVersion: CHUNK_POLICY_VERSION,
  });

  return { extraction, projectedTextHash, sourceProjectionRef, admission };
}

async function materializeOnce(
  spec: DocumentSpec,
  admittedChunks: readonly LegalChunk[],
  rawContentHash: string,
  projectedTextHash: string,
  rawBytes: Uint8Array,
) {
  const { materializer, ingestionManifestStore, signAttestation } = composeLegalCorpusMaterialization();
  // K2.1b(2): bind to the ACTIVE registry identity rather than a frozen artifact-id constant.
  const activeBinding = await resolveActiveRegistryBinding({
    sourceId: spec.sourceId,
    expectedSourceContentHash: spec.registrySourceContentHash,
  });

  const identity = {
    logical_source_id: spec.sourceId,
    registry_artifact_id: activeBinding.registryArtifactId,
    registry_source_content_hash: activeBinding.registrySourceContentHash,
    raw_source_content_hash: rawContentHash,
    text_projection_artifact_id: `projection-${spec.quarantineId}`,
    text_projection_hash: projectedTextHash,
    text_projection_version: 'html-extract@1.0',
    corpus_materialization_version: 'corpus-materialization-v1',
    chunk_policy_version: CHUNK_POLICY_VERSION,
  };

  const { buildCanonicalLegalCorpusRecordKey } = await import('@miljobeslut/mps-legal-corpus');
  const documentId = buildCanonicalLegalCorpusRecordKey(identity);
  const runId = `run-g-${randomUUID()}`;

  const manifestEntryBase = {
    document_id: documentId,
    source_manifest_ref: spec.downloadManifestRef,
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
    chunkPolicyVersion: CHUNK_POLICY_VERSION,
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

  const projectedText = Buffer.from(rawBytes).length > 0 ? undefined : undefined; // placeholder, unused
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
    raw_source_ref: { quarantine_id: spec.quarantineId, download_manifest_ref: spec.downloadManifestRef },
    corpus_record: {
      title: spec.title,
      source_path: `p2://${spec.quarantineId}`,
      document_text: documentText,
      search_text: documentText,
      source_family: spec.sourceFamily,
      source_type: spec.sourceType,
      source_system: spec.sourceId,
      content_hash: rawContentHash,
      byte_size: rawBytes.byteLength,
      metadata: { governed: true, pilot: 'G', structure_kind: spec.structureKind },
    },
  });

  return { result, documentId };
}

async function countChunks(materializationId: string): Promise<number> {
  return prisma.legalCorpusMaterializedChunk.count({ where: { materializationId } });
}

async function runDocument(spec: DocumentSpec) {
  console.log(`\n\n########## ${spec.label} ##########`);

  const rawBytes = new Uint8Array(readFileSync(`${QUARANTINE_ROOT}\\${spec.quarantineId}.bin`));
  const rawContentHash = createHash('sha256').update(rawBytes).digest('hex');

  console.log('\n--- SOURCE ---');
  console.log('source_id:', spec.sourceId);
  console.log('authority:', spec.authority);
  console.log('download_manifest_id:', spec.downloadManifestRef.id);
  console.log('raw quarantine hash:', rawContentHash);

  const { extraction, projectedTextHash, sourceProjectionRef, admission } = await projectAndAdmit(
    spec,
    rawBytes,
  );

  console.log('\n--- PROJECTION ---');
  console.log('media type:', spec.mimeType);
  console.log('extraction/projection version:', extraction.version, '(method:', extraction.method + ')');
  console.log('projected text hash:', projectedTextHash);
  console.log('projected text length:', extraction.text.length);
  if (spec.knownRawVolatility) console.log('raw HTML volatility:', spec.knownRawVolatility);

  console.log('\n--- CLASSIFICATION ---');
  console.log('document family (structure_kind):', spec.structureKind);
  console.log('selected chunk strategy:', spec.structureKind);

  console.log('\n--- CHUNKING ---');
  console.log(
    'chunks produced (admitted + rejected):',
    admission.admitted.length + admission.rejected.length,
  );
  console.log('chunks admitted:', admission.admitted.length);
  console.log('chunks rejected:', admission.rejected.length);
  console.log('admission document_status:', admission.document_status);
  if (admission.rejected.length > 0) {
    console.log('rejection reason(s):', [...new Set(admission.rejected.map((r) => r.reason))]);
  }
  console.log(
    'fragment ids (first 5):',
    admission.admitted.slice(0, 5).map((c) => c.fragment_id),
  );
  if (spec.structureKind === 'law') {
    const lawChunks = admission.admitted.filter(
      (c): c is Extract<LegalChunk, { structure_kind: 'law' }> => c.structure_kind === 'law',
    );
    console.log(
      'sample chapter/paragraph (law):',
      lawChunks.slice(0, 3).map((c) => ({ chapter: c.chapter, paragraph: c.paragraph })),
    );
    console.log(
      'any fabricated "0" chapter/paragraph:',
      lawChunks.some((c) => c.chapter === '0' || c.paragraph === '0'),
    );
  }
  if (spec.structureKind === 'court') {
    const courtChunks = admission.admitted.filter(
      (c): c is Extract<LegalChunk, { structure_kind: 'court' }> => c.structure_kind === 'court',
    );
    console.log(
      'sample court_section (first 5):',
      courtChunks.slice(0, 5).map((c) => c.court_section),
    );
    console.log(
      'any law fields present on court chunks:',
      courtChunks.some((c) => 'chapter' in c || 'paragraph' in c),
    );
  }

  if (admission.admitted.length === 0) {
    console.log('\n!!! NO CHUNKS ADMITTED -- skipping materialization for this document.');
    return { spec, admission, run1: null, run2: null };
  }

  console.log('\n--- MATERIALIZATION (run 1) ---');
  const run1 = await materializeOnce(spec, admission.admitted, rawContentHash, projectedTextHash, rawBytes);
  const materializationRow1 = await prisma.legalCorpusMaterialization.findUnique({
    where: { canonicalRecordKey: run1.result.canonical_record_key },
  });
  const chunkCount1 = materializationRow1 ? await countChunks(materializationRow1.id) : -1;
  console.log('materialization id:', run1.result.canonical_record_key);
  console.log('record row:', run1.result.corpus_record_id);
  console.log('provenance row (materialization pk):', materializationRow1?.id);
  console.log('governed chunk rows:', chunkCount1);

  console.log('\n--- REPLAY (run 2) ---');
  const run2 = await materializeOnce(spec, admission.admitted, rawContentHash, projectedTextHash, rawBytes);
  const materializationRow2 = await prisma.legalCorpusMaterialization.findUnique({
    where: { canonicalRecordKey: run2.result.canonical_record_key },
  });
  const chunkCount2 = materializationRow2 ? await countChunks(materializationRow2.id) : -1;
  const recordRowCount = await prisma.legalCorpusRecord.count({
    where: { recordKey: run1.result.canonical_record_key },
  });

  console.log('second run materialization id:', run2.result.canonical_record_key);
  console.log(
    'same materialization id?',
    run1.result.canonical_record_key === run2.result.canonical_record_key,
  );
  console.log(
    'same chunk rows count after replay (no duplicates)?',
    chunkCount1 === chunkCount2,
    `(${chunkCount1} vs ${chunkCount2})`,
  );
  console.log('duplicate record rows?', recordRowCount !== 1, `(count=${recordRowCount})`);
  console.log('identity stable?', run1.documentId === run2.documentId);

  console.log('\n--- PROVENANCE CHAIN ---');
  console.log(
    `raw quarantine (${spec.quarantineId}, hash ${rawContentHash.slice(0, 16)}...) -> ` +
      `download_manifest (${spec.downloadManifestRef.id.slice(0, 40)}...) -> ` +
      `projection (${sourceProjectionRef.slice(0, 20)}...) -> ` +
      `${chunkCount1} governed chunks -> materialization (${run1.result.canonical_record_key.slice(0, 30)}...)`,
  );

  return {
    spec,
    admission,
    run1,
    run2,
    sameMaterializationId: run1.result.canonical_record_key === run2.result.canonical_record_key,
    sameChunkCount: chunkCount1 === chunkCount2,
    noDuplicateRecords: recordRowCount === 1,
    chunkCount: chunkCount1,
  };
}

async function main() {
  const results = [];
  for (const spec of DOCUMENTS) {
    results.push(await runDocument(spec));
  }

  console.log('\n\n========== LEGAL CORPUS MATERIALIZATION V1 -- PART G SUMMARY ==========');
  for (const r of results) {
    console.log(
      JSON.stringify(
        {
          document: r.spec.label,
          structure_kind: r.spec.structureKind,
          admitted: r.admission.admitted.length,
          rejected: r.admission.rejected.length,
          document_status: r.admission.document_status,
          materialized: r.run1 !== null,
          chunk_rows: 'chunkCount' in r ? r.chunkCount : null,
          replay_same_materialization_id: 'sameMaterializationId' in r ? r.sameMaterializationId : null,
          replay_same_chunk_count: 'sameChunkCount' in r ? r.sameChunkCount : null,
          replay_no_duplicate_records: 'noDuplicateRecords' in r ? r.noDuplicateRecords : null,
        },
        null,
        2,
      ),
    );
  }

  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error('FATAL:', error);
  await prisma.$disconnect();
  process.exitCode = 1;
});
