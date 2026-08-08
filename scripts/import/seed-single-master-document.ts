// scripts/import/seed-single-master-document.ts

import { prisma } from '../../server/db/prisma';
import { DocumentOrchestrator } from '../../packages/mps-data-governance/src/DocumentOrchestrator';
import path from 'path';

const DOC_PATH = 'H:\\Delade enheter\\Miljöbeslut\\GEO_Master_Archive\\National_Archive\\Mark-_och_miljööverdomstolen\\2026\\Mora\\MÖD-M-1456-26\\original\\beslut.txt';

async function main() {
  console.log('--- SEEDING SINGLE MASTER DOCUMENT ---');

  // 1. Ensure we have a mock/test organisation and project
  let org = await prisma.organisation.findFirst();
  if (!org) {
    org = await prisma.organisation.create({
      data: {
        name: 'Seed Organisation',
      },
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

  // 2. Clean up any existing seed document
  await prisma.documentRecord.deleteMany({
    where: { diskName: 'MÖD-M-1456-26' },
  });

  // 3. Create DocumentRecord
  const docRecord = await prisma.documentRecord.create({
    data: {
      projectId: project.id,
      organisationId: org.id,
      entryId: 'seed-entry-1',
      diskName: 'MÖD-M-1456-26',
      originalName: 'beslut.txt',
      absolutePath: DOC_PATH,
      subject: 'MÖD-M-1456-26 Domstolsbeslut Mora',
      municipalityNormalized: 'Mora',
      decisionType: 'court_decision',
      status: 'METADATA_ONLY',
    },
  });

  console.log(`Created DocumentRecord: ${docRecord.id} for Mora municipality.`);

  // 4. Instantiate DocumentOrchestrator and run the pipeline
  const orchestrator = new DocumentOrchestrator();
  console.log('Executing DocumentOrchestrator pipeline...');
  const checkpoint = await orchestrator.executePipeline(DOC_PATH, {
    document_id: docRecord.id,
    source_path: DOC_PATH,
    content_hash: 'seed-hash-mora-beslut',
    current_step: 'INVENTORY',
    pipeline_version: 'v1.0',
    ocr_required: false,
    classification: 'court_decision',
    knowledge_domain: 'ENVIRONMENTAL_DECISIONS',
    retries_attempted: 0,
  });

  // 5. Update status to CHUNKED
  await prisma.documentRecord.update({
    where: { id: docRecord.id },
    data: { status: 'CHUNKED' },
  });

  console.log('=== SEED SUCCESSFUL ===');
  console.log('Checkpoint result:', checkpoint);

  const chunkCount = await prisma.documentChunk.count({
    where: { documentId: docRecord.id },
  });
  console.log(`Seeded Chunks in Database: ${chunkCount}`);
}

main()
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
