// scripts/import/seed-single-pdf-document.ts

import { prisma } from '../../server/db/prisma';
import { DocumentOrchestrator } from '../../packages/mps-data-governance/src/DocumentOrchestrator';
import { DocumentKnowledgeRelease } from '../../packages/mps-data-governance/src/DocumentOrchestratorTypes';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

const PDF_PATH = 'H:\\Delade enheter\\Miljöbeslut\\GEO_Master_Archive\\Documents\\Sources\\C_Drive_Import\\00000000125C043_1043_001_BMN-2024-497_2024-06-17.pdf';
const OUTPUT_RELEASE_PATH = path.join(process.cwd(), 'storage', 'manifests', 'document-knowledge-release-v1.json');

async function main() {
  console.log('--- EXECUTING GATE D1: CANONICAL PDF INGESTION & KNOWLEDGE RELEASE ---');

  if (!fs.existsSync(PDF_PATH)) {
    throw new Error(`PDF_NOT_FOUND: ${PDF_PATH}`);
  }

  // 1. Ensure test org and project exist
  let org = await prisma.organisation.findFirst();
  if (!org) {
    org = await prisma.organisation.create({
      data: { name: 'Seed Organisation' },
    });
  }

  let project = await prisma.project.findFirst({
    where: { organisationId: org.id },
  });
  if (!project) {
    project = await prisma.project.create({
      data: {
        organisationId: org.id,
        propertyDesignation: 'STOCKHOLM STENBITEN 9',
        status: 'ACTIVE',
      },
    });
  }

  // Calculate SHA256 of original PDF
  console.log('Hashing raw PDF bytes...');
  const sha = crypto.createHash('sha256').update(fs.readFileSync(PDF_PATH)).digest('hex');
  const docId = `doc-${sha.slice(0, 16)}`;

  // 2. Clean up any existing records for this PDF
  await prisma.documentRecord.deleteMany({
    where: { fileSha256: sha },
  });

  // 3. Create DocumentRecord
  const docRecord = await prisma.documentRecord.create({
    data: {
      projectId: project.id,
      organisationId: org.id,
      entryId: 'seed-pdf-entry-1',
      diskName: path.basename(PDF_PATH),
      originalName: path.basename(PDF_PATH),
      absolutePath: PDF_PATH,
      fileSha256: sha,
      subject: 'Byggnadsnämndens ärende BMN-2024-497',
      municipalityNormalized: 'Haninge', // Inferred from Case ID BMN
      decisionType: 'court_decision',
      status: 'METADATA_ONLY',
    },
  });

  console.log(`Created DocumentRecord in Database: ${docRecord.id}`);

  // 4. Ingest and execute the actual PDF pipeline via DocumentOrchestrator
  const orchestrator = new DocumentOrchestrator();
  console.log('Executing DocumentOrchestrator on real PDF...');
  const checkpoint = await orchestrator.executePipeline(PDF_PATH, {
    document_id: docRecord.id,
    source_path: PDF_PATH,
    content_hash: sha,
    current_step: 'INVENTORY',
    pipeline_version: 'v1.0',
    ocr_required: false,
    classification: 'court_decision',
    knowledge_domain: 'ENVIRONMENTAL_DECISIONS',
    retries_attempted: 0,
  });

  // 5. Update Status to CHUNKED in db
  await prisma.documentRecord.update({
    where: { id: docRecord.id },
    data: { status: 'CHUNKED' },
  });

  const chunkCount = await prisma.documentChunk.count({
    where: { documentId: docRecord.id },
  });
  console.log(`Successfully ingested real PDF. Generated chunks in Database: ${chunkCount}`);

  // 6. Issue a verifierbar Knowledge Release baseline
  const release: DocumentKnowledgeRelease = {
    release_id: 'knowledge-release-v1.0.0',
    generated_at: new Date().toISOString(),
    pipeline_version: 'v1.0',
    document_count: 1,
    total_size_bytes: fs.statSync(PDF_PATH).size,
    manifest_hash: crypto.createHash('sha256').update(JSON.stringify(checkpoint)).digest('hex'),
    index_version_hash: 'fryst-index-v1',
    documents: [checkpoint],
  };

  fs.mkdirSync(path.dirname(OUTPUT_RELEASE_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_RELEASE_PATH, JSON.stringify(release, null, 2), 'utf8');

  console.log('=== KNOWLEDGE RELEASE COMPLETED & FROZEN ===');
  console.log('Release file:', OUTPUT_RELEASE_PATH);
  console.log(JSON.stringify(release, null, 2));
}

main()
  .catch((err) => {
    console.error('PDF Ingestion Gate D1 failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
