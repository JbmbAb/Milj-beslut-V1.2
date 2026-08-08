// scripts/import/verify-cold-start-replay.ts

import fs from 'fs';
import path from 'path';
import { prisma } from '../../server/db/prisma';
import { DocumentOrchestrator } from '../../packages/mps-data-governance/src/DocumentOrchestrator';
import { DocumentKnowledgeRelease } from '../../packages/mps-data-governance/src/DocumentOrchestratorTypes';

const RELEASE_PATH = path.join(process.cwd(), 'storage', 'manifests', 'document-knowledge-release-batch-v2.json');

async function main() {
  console.log('=== CERTIFYING COLD-START REPLAY DETERMINISM (TV-L1) ===');

  if (!fs.existsSync(RELEASE_PATH)) {
    throw new Error(`Release baseline manifest not found at ${RELEASE_PATH}. Run Wave 2 batch ingestion first!`);
  }

  const release: DocumentKnowledgeRelease = JSON.parse(fs.readFileSync(RELEASE_PATH, 'utf8'));
  const docs = release.documents || [];
  
  if (docs.length === 0) {
    throw new Error('Baseline release manifest contains 0 documents. Cannot perform replay.');
  }

  // Pick up to 3 successful documents to verify
  const sampleDocs = docs.slice(0, 3);
  console.log(`Selected ${sampleDocs.length} sample documents for deterministic replay verification.`);

  const orchestrator = new DocumentOrchestrator();
  let verifiedCount = 0;

  for (const doc of sampleDocs) {
    console.log(`\nVerifying document: ${doc.document_id}`);
    console.log(`  Source Path: ${doc.source_path}`);
    console.log(`  Content Hash: ${doc.content_hash}`);

    // 1. Fetch current chunks (the "Baseline State")
    const baselineChunks = await prisma.documentChunk.findMany({
      where: { documentId: doc.document_id },
      orderBy: { chunkIndex: 'asc' },
    });
    console.log(`  Baseline Chunk Count: ${baselineChunks.length}`);

    if (baselineChunks.length === 0) {
      console.warn(`  [WARN] Document ${doc.document_id} has 0 chunks in database. Skipping.`);
      continue;
    }

    // 2. Clear current chunks in DB to simulate isolated/empty DB state
    await prisma.documentChunk.deleteMany({
      where: { documentId: doc.document_id },
    });

    // 3. Re-run Ingestion (Replay) from original PDF
    console.log('  Executing Cold-Start Ingestion Replay...');
    await orchestrator.executePipeline(doc.source_path, {
      document_id: doc.document_id,
      source_path: doc.source_path,
      content_hash: doc.content_hash,
      current_step: 'INVENTORY',
      pipeline_version: doc.pipeline_version,
      ocr_required: doc.ocr_required,
      classification: doc.classification,
      knowledge_domain: doc.knowledge_domain,
      retries_attempted: 0,
    });

    // 4. Fetch newly generated chunks (the "Replayed State")
    const replayedChunks = await prisma.documentChunk.findMany({
      where: { documentId: doc.document_id },
      orderBy: { chunkIndex: 'asc' },
    });
    console.log(`  Replayed Chunk Count: ${replayedChunks.length}`);

    // 5. Hard Assertion: Verify complete identity of replayed state against baseline
    if (baselineChunks.length !== replayedChunks.length) {
      throw new Error(
        `DETERMINISM_FAILURE: Chunk count mismatch for ${doc.document_id}. Baseline: ${baselineChunks.length}, Replayed: ${replayedChunks.length}`
      );
    }

    for (let i = 0; i < baselineChunks.length; i++) {
      const base = baselineChunks[i];
      const repl = replayedChunks[i];

      if (base.chunkIndex !== repl.chunkIndex) {
        throw new Error(
          `DETERMINISM_FAILURE: Chunk index mismatch at position ${i}. Baseline index: ${base.chunkIndex}, Replayed index: ${repl.chunkIndex}`
        );
      }
      if (base.chunkText !== repl.chunkText) {
        throw new Error(
          `DETERMINISM_FAILURE: Chunk content mismatch at index ${base.chunkIndex}.\nBaseline: "${base.chunkText}"\nReplayed: "${repl.chunkText}"`
        );
      }
    }

    console.log(`  [PASS] Cold-start replay verified with 100% identity for ${doc.document_id}`);
    verifiedCount++;
  }

  console.log('\n================================================');
  console.log(`=== REPLAY STATUS: PASS (Deterministic)        ===`);
  console.log(`=== Verified Documents: ${verifiedCount}/${sampleDocs.length}                     ===`);
  console.log('================================================');
}

main()
  .catch((err) => {
    console.error('[FAIL] Cold-start replay failed:', err.message);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
