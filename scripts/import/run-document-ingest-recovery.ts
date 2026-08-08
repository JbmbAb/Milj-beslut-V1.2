// scripts/import/run-document-ingest-recovery.ts

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { prisma } from '../../server/db/prisma';
import { DocumentOrchestrator } from '../../packages/mps-data-governance/src/DocumentOrchestrator';
import { DocumentKnowledgeRelease, DocumentStateCheckpoint, DocumentQuarantineRecord } from '../../packages/mps-data-governance/src/DocumentOrchestratorTypes';

const RELEASE_PATH = path.join(process.cwd(), 'storage', 'manifests', 'document-knowledge-release-batch-v2.json');
const QUARANTINE_PATH = path.join(process.cwd(), 'storage', 'manifests', 'document-quarantine-ledger.json');
const CONCURRENCY_LIMIT = 3; // Low bounded concurrency to protect Postgres connection pool completely

async function main() {
  console.log('=== KNOWLEDGE WAVE 2R: RECOVERY & REVALIDATION ===');

  if (!fs.existsSync(QUARANTINE_PATH)) {
    console.log('No quarantine ledger found. Zero recovery needed.');
    return;
  }

  const quarantineRecords: DocumentQuarantineRecord[] = JSON.parse(fs.readFileSync(QUARANTINE_PATH, 'utf8'));
  console.log(`Total quarantine records to analyze: ${quarantineRecords.length}`);

  // Separate infrastructure failures from genuine document quality failures
  const retryableInfraRecords = quarantineRecords.filter(r => 
    r.failure_reason.includes('transaction') || 
    r.failure_reason.includes('pool') ||
    r.failure_reason.includes('time')
  );

  const genuineDocumentFailures = quarantineRecords.filter(r => 
    !r.failure_reason.includes('transaction') && 
    !r.failure_reason.includes('pool') &&
    !r.failure_reason.includes('time')
  );

  console.log(`Diagnostic Analysis:`);
  console.log(`  Retryable Infrastructure Failures: ${retryableInfraRecords.length}`);
  console.log(`  Genuine Document Quality Failures: ${genuineDocumentFailures.length}`);

  if (retryableInfraRecords.length === 0) {
    console.log('Zero retryable infrastructure failures identified. Quarantine ledger is already pristine.');
    return;
  }

  // Load existing Wave 2 successful documents manifest to append to it
  let release: DocumentKnowledgeRelease = {
    release_id: 'knowledge-release-batch-v2.0.0',
    generated_at: new Date().toISOString(),
    pipeline_version: 'v1.0',
    document_count: 0,
    total_size_bytes: 0,
    manifest_hash: '',
    index_version_hash: '',
    documents: [],
  };

  if (fs.existsSync(RELEASE_PATH)) {
    release = JSON.parse(fs.readFileSync(RELEASE_PATH, 'utf8'));
  }

  const MASTER_DOCS = 'H:\\Delade enheter\\Miljöbeslut\\GEO_Master_Archive\\Documents\\Sources';
  const orchestrator = new DocumentOrchestrator();
  const startTime = Date.now();

  const newlyRecoveredResults: DocumentStateCheckpoint[] = [];
  const finalQuarantineLedger: DocumentQuarantineRecord[] = [...genuineDocumentFailures];

  let processed = 0;
  let recoveredCount = 0;
  let permanentDocumentRejectCount = 0;

  // Queue up only retryable infrastructure records for execution
  const queue = [...retryableInfraRecords];
  const workers = Array.from({ length: CONCURRENCY_LIMIT }, async () => {
    while (queue.length > 0) {
      const record = queue.shift();
      if (!record) break;

      const fullPath = path.join(MASTER_DOCS, record.source_path);
      try {
        // Retrieve matching document record
        const docRecord = await prisma.documentRecord.findFirst({
          where: { fileSha256: record.document_sha256 },
        });

        if (!docRecord) {
          throw new Error(`DATABASE_ERROR: DocumentRecord for SHA ${record.document_sha256} missing in database.`);
        }

        // Clean previous chunks to avoid duplication
        await prisma.documentChunk.deleteMany({ where: { documentId: docRecord.id } });

        // Run Ingestion live
        const checkpoint = await orchestrator.executePipeline(fullPath, {
          document_id: docRecord.id,
          source_path: fullPath,
          content_hash: record.document_sha256,
          current_step: 'INVENTORY',
          pipeline_version: 'v1.0',
          ocr_required: false,
          classification: docRecord.decisionType as any || 'unknown',
          knowledge_domain: 'ENVIRONMENTAL_DECISIONS',
          retries_attempted: 0,
        });

        await prisma.documentRecord.update({
          where: { id: docRecord.id },
          data: { status: 'CHUNKED' },
        });

        newlyRecoveredResults.push(checkpoint);
        recoveredCount++;
      } catch (err: any) {
        if (err.message.includes('QUALITY_GATE_FAILURE')) {
          permanentDocumentRejectCount++;
          // Convert infrastructure failure to proven permanent document failure
          finalQuarantineLedger.push({
            document_sha256: record.document_sha256,
            source_path: record.source_path,
            pipeline_version: 'v1.0',
            gate_id: 'VERIFY',
            failure_code: 'QUALITY_GATE_FAILURE',
            failure_reason: err.message,
            timestamp: new Date().toISOString(),
            quarantine_reference: `quarantine-ref-${record.document_sha256.slice(0, 16)}`,
          });
          console.error(`[QUALITY REJECT] ${record.source_path} permanently rejected: ${err.message}`);
        } else {
          // Still a retryable infrastructure error, persist original quarantine entry
          finalQuarantineLedger.push(record);
          console.error(`[RE-TRY FAIL] ${record.source_path} infra retry failed: ${err.message}`);
        }
      } finally {
        processed++;
        if (processed % 50 === 0 || processed === retryableInfraRecords.length) {
          console.log(`[RECOVERY PROGRESS] Processed ${processed}/${retryableInfraRecords.length}`);
        }
      }
    }
  });

  await Promise.all(workers);
  const duration = (Date.now() - startTime) / 1000;

  // Append new successful checkpoints to release document stream
  release.documents.push(...newlyRecoveredResults);
  release.document_count = release.documents.length;
  release.generated_at = new Date().toISOString();
  release.manifest_hash = crypto.createHash('sha256').update(JSON.stringify(release.documents)).digest('hex');

  // Rewrite both fryst release and the cleaned quarantine ledger
  fs.writeFileSync(RELEASE_PATH, JSON.stringify(release, null, 2), 'utf8');
  fs.writeFileSync(QUARANTINE_PATH, JSON.stringify(finalQuarantineLedger, null, 2), 'utf8');

  console.log('\n=== RECOVERY WORK METRICS ===');
  console.log(`Recovered as ACCEPTED   : ${recoveredCount}`);
  console.log(`Permanent Quality Rejects: ${permanentDocumentRejectCount}`);
  console.log(`Remaining in Quarantine  : ${finalQuarantineLedger.length}`);
  console.log(`Total Final Release count: ${release.document_count} successful documents.`);
  console.log(`Total Processing Time    : ${duration.toFixed(2)} seconds`);
  console.log(`\nCleaned Quarantine Ledger: ${QUARANTINE_PATH}`);
  console.log(`Cleaned Knowledge Release: ${RELEASE_PATH}`);
}

main()
  .catch((err) => {
    console.error('[FATAL] Recovery execution failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
