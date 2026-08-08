// scripts/import/run-document-ingest-batch.ts

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { prisma } from '../../server/db/prisma';
import { DocumentOrchestrator } from '../../packages/mps-data-governance/src/DocumentOrchestrator';
import { DocumentKnowledgeRelease, DocumentStateCheckpoint } from '../../packages/mps-data-governance/src/DocumentOrchestratorTypes';

const MANIFEST_PATH = path.join(process.cwd(), 'storage', 'manifests', 'document-inventory-manifest.json');
const OUTPUT_RELEASE_PATH = path.join(process.cwd(), 'storage', 'manifests', 'document-knowledge-release-batch-v1.json');
const BATCH_SIZE = 100;
const CONCURRENCY_LIMIT = 10;

async function main() {
  console.log('=== KNOWLEDGE WAVE 1: BATCH INGESTION & DEDUPLICATION ===');

  if (!fs.existsSync(MANIFEST_PATH)) {
    throw new Error(`Inventory manifest not found at ${MANIFEST_PATH}. Run build-document-inventory-manifest.ts first!`);
  }

  const rawManifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const allDocs = rawManifest.documents || [];
  console.log(`Total discovered PDFs in inventory: ${allDocs.length}`);

  // 1. CONTENT-ADDRESSED DEDUPLICATION (Gate D4)
  const uniqueDocsMap = new Map<string, any>();
  let duplicateCount = 0;

  for (const doc of allDocs) {
    if (uniqueDocsMap.has(doc.content_hash)) {
      duplicateCount++;
    } else {
      uniqueDocsMap.set(doc.content_hash, doc);
    }
  }

  const uniqueDocsList = Array.from(uniqueDocsMap.values());
  console.log(`Deduplication Stats:`);
  console.log(`  Unique Documents: ${uniqueDocsList.length}`);
  console.log(`  Duplicate Copies: ${duplicateCount}`);

  // Take the first 100 unique documents for Wave 1
  const batchDocs = uniqueDocsList.slice(0, BATCH_SIZE);
  const totalInBatch = batchDocs.length;
  console.log(`Selected batch size for Ingestion: ${totalInBatch} unique documents.`);

  // Ensure test org and project exist
  let org = await prisma.organisation.findFirst();
  if (!org) {
    org = await prisma.organisation.create({ data: { name: 'Batch Ingest Organisation' } });
  }
  let project = await prisma.project.findFirst({ where: { organisationId: org.id } });
  if (!project) {
    project = await prisma.project.create({
      data: {
        organisationId: org.id,
        propertyDesignation: 'STOCKHOLM STENBITEN 9',
        status: 'ACTIVE',
      },
    });
  }

  const MASTER_DOCS = 'H:\\Delade enheter\\Miljöbeslut\\GEO_Master_Archive\\Documents\\Sources';
  const orchestrator = new DocumentOrchestrator();
  const startTime = Date.now();

  const results: DocumentStateCheckpoint[] = [];
  let processed = 0;
  let failed = 0;

  // Concurrency pool for batch ingestion
  const queue = [...batchDocs];
  const workers = Array.from({ length: CONCURRENCY_LIMIT }, async () => {
    while (queue.length > 0) {
      const doc = queue.shift();
      if (!doc) break;

      const fullPath = path.join(MASTER_DOCS, doc.source_path);
      try {
        // Create or get DocumentRecord
        let docRecord = await prisma.documentRecord.findFirst({
          where: { fileSha256: doc.content_hash },
        });

        if (!docRecord) {
          docRecord = await prisma.documentRecord.create({
            data: {
              projectId: project.id,
              organisationId: org.id,
              entryId: `batch-entry-${processed}`,
              diskName: path.basename(fullPath),
              originalName: path.basename(fullPath),
              absolutePath: fullPath,
              fileSha256: doc.content_hash,
              subject: doc.title || 'Batch Ingested Doc',
              municipalityNormalized: doc.document_type === 'court_decision' ? 'Mora' : 'Haninge',
              decisionType: doc.document_type,
              status: 'METADATA_ONLY',
            },
          });
        }

        // Clean any existing chunks to avoid duplication
        await prisma.documentChunk.deleteMany({ where: { documentId: docRecord.id } });

        // Run Ingestion
        const checkpoint = await orchestrator.executePipeline(fullPath, {
          document_id: docRecord.id,
          source_path: fullPath,
          content_hash: doc.content_hash,
          current_step: 'INVENTORY',
          pipeline_version: 'v1.0',
          ocr_required: doc.ocr_required,
          classification: doc.document_type,
          knowledge_domain: 'ENVIRONMENTAL_DECISIONS',
          retries_attempted: 0,
        });

        await prisma.documentRecord.update({
          where: { id: docRecord.id },
          data: { status: 'CHUNKED' },
        });

        results.push(checkpoint);
      } catch (err: any) {
        failed++;
        console.error(`[ERROR] Failed to ingest ${doc.source_path}:`, err.message);
      } finally {
        processed++;
        if (processed % 10 === 0 || processed === totalInBatch) {
          console.log(`[INGEST PROGRESS] Processed ${processed}/${totalInBatch} (${((processed/totalInBatch)*100).toFixed(0)}%)`);
        }
      }
    }
  });

  await Promise.all(workers);
  const duration = (Date.now() - startTime) / 1000;

  // Retrieve total chunks created
  const docIdsInBatch = results.map(r => r.document_id);
  const totalChunksCreated = await prisma.documentChunk.count({
    where: { documentId: { in: docIdsInBatch } },
  });

  // Calculate Metrics
  const averageChunksPerDoc = results.length > 0 ? (totalChunksCreated / results.length).toFixed(1) : '0.0';

  console.log('\n=== BATCH RUN METRICS ===');
  console.log(`Discovered Documents     : ${allDocs.length}`);
  console.log(`Unique Documents         : ${uniqueDocsList.length}`);
  console.log(`Duplicate Documents      : ${duplicateCount}`);
  console.log(`Batch Processed          : ${processed}`);
  console.log(`Batch Successful         : ${results.length}`);
  console.log(`Batch Failed             : ${failed}`);
  console.log(`Chunks Created           : ${totalChunksCreated}`);
  console.log(`Average Chunks/Document  : ${averageChunksPerDoc}`);
  console.log(`Total Processing Time    : ${duration.toFixed(2)} seconds`);

  // 2. GENERATE COMPILATION RELEASE (Gate D6)
  const release: DocumentKnowledgeRelease = {
    release_id: 'knowledge-release-batch-v1.0.0',
    generated_at: new Date().toISOString(),
    pipeline_version: 'v1.0',
    document_count: results.length,
    total_size_bytes: results.reduce((acc, r) => acc + (allDocs.find((d: any) => d.content_hash === r.content_hash)?.file_size || 0), 0),
    manifest_hash: crypto.createHash('sha256').update(JSON.stringify(results)).digest('hex'),
    index_version_hash: crypto.createHash('sha256').update(JSON.stringify({ totalChunksCreated, docIdsInBatch })).digest('hex'),
    documents: results,
  };

  fs.mkdirSync(path.dirname(OUTPUT_RELEASE_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_RELEASE_PATH, JSON.stringify(release, null, 2), 'utf8');

  console.log('\n[SUCCESS] Knowledge Release generated:');
  console.log(`  Release ID   : ${release.release_id}`);
  console.log(`  Manifest Hash: ${release.manifest_hash}`);
  console.log(`  Index Hash   : ${release.index_version_hash}`);
  console.log(`  Release File : ${OUTPUT_RELEASE_PATH}`);
}

main()
  .catch((err) => {
    console.error('[FATAL] Batch execution failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
