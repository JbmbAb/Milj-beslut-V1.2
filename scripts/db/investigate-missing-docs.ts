#!/usr/bin/env tsx
/**
 * Investigate what happened to the ~800 missing documents
 * Compare before/after populate-municipalities.ts execution
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function investigateMissingDocs() {
  console.log('\n🔍 INVESTIGATION: WHERE DID THE 800 DOCUMENTS GO?\n');

  try {
    // Get current state
    const current = await prisma.$queryRaw<Array<{ municipality: string; count: number }>>`
      SELECT municipality, COUNT(*) as count
      FROM "DocumentRecord"
      GROUP BY municipality
      ORDER BY count DESC
    `;

    console.log('📊 CURRENT DATABASE STATE:');
    console.log('─────────────────────────────────');
    const totalCurrent = current.reduce((sum, m) => sum + Number(m.count), 0);
    console.log(`Total documents: ${totalCurrent}`);
    console.log(`Total municipalities: ${current.length}\n`);

    // Analyze documents by status
    const byStatus = await prisma.$queryRaw<Array<{ status: string; count: number }>>`
      SELECT status, COUNT(*) as count
      FROM "DocumentRecord"
      GROUP BY status
    `;

    console.log('By Status:');
    byStatus.forEach((row) => {
      console.log(`  ${row.status}: ${row.count}`);
    });

    console.log();

    // Check by project
    const byProject = await prisma.$queryRaw<
      Array<{ projectId: string; projectName: string; count: number }>
    >`
      SELECT 
        d."projectId",
        COALESCE(p."propertyDesignation", 'NO PROJECT') as "projectName",
        COUNT(*) as count
      FROM "DocumentRecord" d
      LEFT JOIN "Project" p ON d."projectId" = p.id
      GROUP BY d."projectId", "projectName"
      ORDER BY count DESC
    `;

    console.log('By Project:');
    byProject.forEach((row) => {
      console.log(`  ${row.projectName} (${row.projectId}): ${row.count}`);
    });

    // Check for orphaned documents (no project)
    const orphaned = await prisma.$queryRaw<Array<{ count: number }>>`
      SELECT COUNT(*) as count
      FROM "DocumentRecord"
      WHERE "projectId" NOT IN (SELECT id FROM "Project")
    `;

    console.log(`\nDocuments with missing PROJECT: ${orphaned[0]?.count || 0}`);

    // Check DocumentContent table
    const contentCheck = await prisma.$queryRaw<
      Array<{ total: number; withContent: number; orphaned: number }>
    >`
      SELECT
        (SELECT COUNT(*) FROM "DocumentRecord") as total,
        (SELECT COUNT(*) FROM "DocumentContent" dc 
         WHERE dc."documentId" IN (SELECT id FROM "DocumentRecord")) as "withContent",
        (SELECT COUNT(*) FROM "DocumentContent" dc 
         WHERE dc."documentId" NOT IN (SELECT id FROM "DocumentRecord")) as orphaned
    `;

    console.log('\nDocument Content Status:');
    console.log(`  DocumentRecord total: ${contentCheck[0]?.total}`);
    console.log(`  With content in table: ${contentCheck[0]?.withContent}`);
    console.log(`  Orphaned content (doc deleted): ${contentCheck[0]?.orphaned}`);

    // Timeline analysis
    const timeline = await prisma.$queryRaw<
      Array<{ year: number | null; month: number | null; count: number }>
    >`
      SELECT
        EXTRACT(YEAR FROM "receivedTime")::INT as year,
        EXTRACT(MONTH FROM "receivedTime")::INT as month,
        COUNT(*) as count
      FROM "DocumentRecord"
      GROUP BY year, month
      ORDER BY year DESC, month DESC
      LIMIT 20
    `;

    console.log('\nRecent documents (by month):');
    timeline.forEach((row) => {
      const date = row.year ? `${row.year}-${String(row.month).padStart(2, '0')}` : 'NULL';
      console.log(`  ${date}: ${row.count}`);
    });

    // Check original real municipalities (from before populate script)
    // These would have documents NOT from 2026 or with real document names
    const realData = await prisma.$queryRaw<
      Array<{ municipality: string; count: number; realCount: number }>
    >`
      SELECT
        municipality,
        COUNT(*) as count,
        COUNT(CASE WHEN "originalName" NOT LIKE 'MIL%' THEN 1 END) as "realCount"
      FROM "DocumentRecord"
      WHERE municipality IS NOT NULL
      GROUP BY municipality
      HAVING COUNT(CASE WHEN "originalName" NOT LIKE 'MIL%' THEN 1 END) > 0
      ORDER BY "realCount" DESC
    `;

    console.log('\n📍 NON-SYNTHETIC DOCUMENTS (likely original data):');
    const realTotal = realData.reduce((sum, m) => sum + Number(m.realCount), 0);
    console.log(`Total original docs remaining: ${realTotal}`);
    console.log(`From ${realData.length} municipalities\n`);
    realData.slice(0, 15).forEach((row) => {
      console.log(`  ${row.municipality}: ${row.realCount}/${row.count}`);
    });

    // Hypothesis
    console.log('\n' + '═'.repeat(60));
    console.log('🕵️ HYPOTHESIS:');
    console.log('═'.repeat(60));

    const totalDocs = current.reduce((sum, m) => sum + Number(m.count), 0);
    const realDocs = realData.reduce((sum, m) => sum + Number(m.realCount), 0);
    const syntheticDocs = totalDocs - realDocs;

    console.log(`Current total: ${totalDocs}`);
    console.log(`Real original docs: ~${realDocs}`);
    console.log(`Synthetic added: ${syntheticDocs}`);
    console.log(`\nMissing from original: ~${2692 - totalDocs} (total was 2692)`);

    if (realDocs < 500) {
      console.log('\n⚠️ LIKELY ISSUE:');
      console.log('The populate-municipalities.ts script may have:');
      console.log('1. Inadvertently deleted non-Orsa documents');
      console.log('2. OR they were in a different project that got removed');
      console.log('3. OR the script ran twice and cleaned up differently');
    }

    console.log('\n');
  } catch (error) {
    console.error('\n❌ Error:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

investigateMissingDocs();
