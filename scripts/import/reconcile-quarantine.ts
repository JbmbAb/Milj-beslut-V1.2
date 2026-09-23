// scripts/import/reconcile-quarantine.ts

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { prisma } from '../../server/db/prisma';
import { DocumentOrchestrator } from '../../packages/mps-data-governance/src/DocumentOrchestrator';
import { DocumentKnowledgeRelease, DocumentStateCheckpoint, DocumentQuarantineRecord } from '../../packages/mps-data-governance/src/DocumentOrchestratorTypes';

const RELEASE_PATH = path.join(process.cwd(), 'storage', 'manifests', 'document-knowledge-release-batch-v2.json');
const QUARANTINE_PATH = path.join(process.cwd(), 'storage', 'manifests', 'document-quarantine-ledger.json');
const MANIFEST_PATH = path.join(process.cwd(), 'storage', 'manifests', 'document-inventory-manifest.json');
const CONCURRENCY_LIMIT = 3;

async function main() {
  console.log('=== KNOWLEDGE WAVE 2: QUARANTINE RECONCILIATION ===');

  if (!fs.existsSync(QUARANTINE_PATH)) {
    console.log('No quarantine ledger found.');
    return;
  }

  const quarantineRecords: DocumentQuarantineRecord[] = JSON.parse(fs.readFileSync(QUARANTINE_PATH, 'utf8'));
  console.log(`Total quarantine records to reconcile: ${quarantineRecords.length}`);

  if (quarantineRecords.length === 0) {
    console.log('Quarantine ledger is empty.');
    return;
  }

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

  const rawManifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const allDocs = rawManifest.documents || [];

  const MASTER_DOCS = 'H:\\Delade enheter\\Miljöbeslut\\GEO_Master_Archive\\Documents\\Sources';
  const orchestrator = new DocumentOrchestrator();
  
  const org = await prisma.organisation.findFirst();
  const project = await prisma.project.findFirst({ where: { organisationId: org?.id } });

  const newlyRecoveredResults: DocumentStateCheckpoint[] = [];
  const finalQuarantineLedger: DocumentQuarantineRecord[] = [];

  let recoveredCount = 0;

  for (const record of quarantineRecords) {
    const fullPath = path.join(MASTER_DOCS, record.source_path);
    try {
      let docRecord = await prisma.documentRecord.findFirst({
        where: { fileSha256: record.document_sha256 },
      });

      if (!docRecord) {
        console.log(`Reconciling missing DocumentRecord for ${record.document_sha256}...`);
        const manifestDoc = allDocs.find((d: any) => d.content_hash === record.document_sha256);
        
        docRecord = await prisma.documentRecord.create({
          data: {
            projectId: project!.id,
            organisationId: org!.id,
            entryId: `reconcile-${Date.now()}`,
            diskName: path.basename(fullPath),
            originalName: path.basename(fullPath),
            absolutePath: fullPath,
            fileSha256: record.document_sha256,
            subject: manifestDoc?.title || 'Reconciled Doc',
            municipalityNormalized: manifestDoc?.document_type === 'court_decision' ? 'Mora' : 'Haninge',
            decisionType: manifestDoc?.document_type || 'unknown',
            status: 'METADATA_ONLY',
          },
        });
      }

      await prisma.documentChunk.deleteMany({ where: { documentId: docRecord.id } });

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
      console.log(`[RECOVERED] ${record.source_path}`);
    } catch (err: any) {
      console.error(`[REJECTED] ${record.source_path}: ${err.message}`);
      record.failure_reason = err.message;
      record.timestamp = new Date().toISOString();
      finalQuarantineLedger.push(record);
    }
  }

  release.documents.push(...newlyRecoveredResults);
  release.document_count = release.documents.length;
  release.generated_at = new Date().toISOString();
  release.manifest_hash = crypto.createHash('sha256').update(JSON.stringify(release.documents)).digest('hex');

  fs.writeFileSync(RELEASE_PATH, JSON.stringify(release, null, 2), 'utf8');
  fs.writeFileSync(QUARANTINE_PATH, JSON.stringify(finalQuarantineLedger, null, 2), 'utf8');

  console.log('\n=== RECONCILIATION METRICS ===');
  console.log(`Recovered as ACCEPTED   : ${recoveredCount}`);
  console.log(`Remaining in Quarantine : ${finalQuarantineLedger.length}`);
  console.log(`Total Final Release count: ${release.document_count} successful documents.`);
}

main()
  .catch((err) => {
    console.error('[FATAL] Reconciliation execution failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
