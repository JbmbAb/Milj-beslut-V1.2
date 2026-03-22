#!/usr/bin/env tsx
/**
 * Analyze Orsa municipality documents
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function analyzeOrsa() {
  console.log('\n🔍 ORSA DOCUMENTS ANALYSIS\n');

  try {
    // Get overall stats
    const total = await prisma.$queryRaw<
      Array<{ count: number }>
    >`SELECT COUNT(*) as count FROM "DocumentRecord" WHERE municipality = 'Orsa'`;

    console.log(`📊 Total Orsa documents: ${total[0]?.count || 0}\n`);

    // Group by status
    const byStatus = await prisma.$queryRaw<Array<{ status: string; count: number }>>`
      SELECT status, COUNT(*) as count 
      FROM "DocumentRecord"
      WHERE municipality = 'Orsa'
      GROUP BY status
      ORDER BY count DESC
    `;

    console.log('By Status:');
    byStatus.forEach((row) => {
      console.log(`  ${row.status}: ${row.count}`);
    });

    // Group by decision type
    const byDecision = await prisma.$queryRaw<Array<{ decisionType: string | null; count: number }>>`
      SELECT "decisionType", COUNT(*) as count 
      FROM "DocumentRecord"
      WHERE municipality = 'Orsa'
      GROUP BY "decisionType"
      ORDER BY count DESC
    `;

    console.log('\nBy Decision Type:');
    byDecision.forEach((row) => {
      console.log(`  ${row.decisionType || 'NULL'}: ${row.count}`);
    });

    // Group by waste type
    const byWaste = await prisma.$queryRaw<Array<{ wasteType: string | null; count: number }>>`
      SELECT "wasteType", COUNT(*) as count 
      FROM "DocumentRecord"
      WHERE municipality = 'Orsa'
      GROUP BY "wasteType"
      ORDER BY count DESC
      LIMIT 10
    `;

    console.log('\nTop Waste Types:');
    byWaste.forEach((row) => {
      console.log(`  ${row.wasteType || 'NULL'}: ${row.count}`);
    });

    // Check date range
    const dateRange = await prisma.$queryRaw<Array<{ minDate: any; maxDate: any }>>`
      SELECT 
        MIN("receivedTime") as "minDate",
        MAX("receivedTime") as "maxDate"
      FROM "DocumentRecord"
      WHERE municipality = 'Orsa'
    `;

    console.log('\nDate Range:');
    if (dateRange[0]) {
      console.log(`  Earliest: ${new Date(dateRange[0].minDate).toLocaleDateString('sv-SE')}`);
      console.log(`  Latest: ${new Date(dateRange[0].maxDate).toLocaleDateString('sv-SE')}`);
    }

    // Check by year
    const byYear = await prisma.$queryRaw<Array<{ year: number; count: number }>>`
      SELECT 
        EXTRACT(YEAR FROM "receivedTime")::INT as year,
        COUNT(*) as count
      FROM "DocumentRecord"
      WHERE municipality = 'Orsa'
      GROUP BY EXTRACT(YEAR FROM "receivedTime")
      ORDER BY year DESC
    `;

    console.log('\nBy Year:');
    byYear.forEach((row) => {
      console.log(`  ${row.year}: ${row.count}`);
    });

    // Sample filenames
    const samples = await prisma.$queryRaw<
      Array<{ originalName: string; status: string; decisionType: string | null }>
    >`
      SELECT "originalName", status, "decisionType"
      FROM "DocumentRecord"
      WHERE municipality = 'Orsa'
      LIMIT 5
    `;

    console.log('\nSample Documents:');
    samples.forEach((s) => {
      console.log(`  📄 ${s.originalName}`);
      console.log(`     Status: ${s.status}, Decision: ${s.decisionType}`);
    });

    console.log('\n');
  } catch (error) {
    console.error('\n❌ Error:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

analyzeOrsa();
