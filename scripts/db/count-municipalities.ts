#!/usr/bin/env tsx
/**
 * Count municipalities in database
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function countMunicipalities() {
  console.log('\n🏛️  MUNICIPALITY COUNT\n');

  try {
    // Count unique municipalities from DocumentRecord
    const docMunicipalities = await prisma.$queryRaw<Array<{ municipality: string | null; count: number }>>`
      SELECT municipality, COUNT(*) as count 
      FROM "DocumentRecord"
      WHERE municipality IS NOT NULL AND municipality != ''
      GROUP BY municipality
      ORDER BY count DESC
    `;

    console.log('From DocumentRecord:');
    console.log(`Total: ${docMunicipalities.length} unique municipalities\n`);

    if (docMunicipalities.length > 0) {
      console.log('Top 10:');
      docMunicipalities.slice(0, 10).forEach((m, i) => {
        console.log(`  ${i + 1}. ${m.municipality}: ${m.count} documents`);
      });
    }

    console.log(`\n\n📊 SUMMARY`);
    console.log('───────────────────');
    console.log(`✅ Total unique municipalities: ${docMunicipalities.length}`);
    const totalDocs = docMunicipalities.reduce((sum, m) => sum + Number(m.count), 0);
    console.log(`✅ Total document records: ${totalDocs}`);
    console.log(`✅ Coverage: NATIONAL (Sweden)`);

    // Show largest municipalities
    console.log(`\n\n🏆 LARGEST (by document count):`);
    docMunicipalities.slice(0, 3).forEach((m, i) => {
      const pct = ((Number(m.count) / totalDocs) * 100).toFixed(1);
      console.log(`  ${i + 1}. ${m.municipality} - ${m.count} docs (${pct}%)`);
    });
  } catch (error) {
    console.error('\n❌ Error:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

countMunicipalities();
