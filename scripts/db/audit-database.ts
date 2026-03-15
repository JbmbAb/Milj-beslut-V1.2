#!/usr/bin/env tsx
/**
 * Detailed database audit
 * Verify what actually happened during population
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function auditDatabase() {
  console.log('\n📋 DATABASE AUDIT - DETAILED ANALYSIS\n');

  try {
    // Get all municipalities with counts
    const allMuni = await prisma.$queryRaw<
      Array<{ municipality: string; count: number; minYear: number | null; maxYear: number | null }>
    >`
      SELECT 
        municipality,
        COUNT(*) as count,
        EXTRACT(YEAR FROM MIN("receivedTime"))::INT as "minYear",
        EXTRACT(YEAR FROM MAX("receivedTime"))::INT as "maxYear"
      FROM "DocumentRecord"
      GROUP BY municipality
      ORDER BY count DESC
    `;

    console.log(`📊 EXACT DATA:`);
    console.log(`Total unique municipalities: ${allMuni.length}`);
    console.log(`Total documents: ${allMuni.reduce((sum, m) => sum + Number(m.count), 0)}\n`);

    // Show all 260
    console.log('ALL MUNICIPALITIES:');
    console.log('───────────────────────────────────────────────────────');
    allMuni.forEach((m, i) => {
      const year = m.maxYear ? `(${m.minYear}-${m.maxYear})` : '(NULL)';
      console.log(`${String(i + 1).padStart(3)}. ${m.municipality.padEnd(30)} ${String(m.count).padStart(4)} docs ${year}`);
    });

    console.log('\n📈 STATISTICS:');
    console.log('───────────────────────────────────────────────────────');
    
    // Check date distribution
    const dateDistribution = await prisma.$queryRaw<
      Array<{ year: number | null; count: number }>
    >`
      SELECT 
        EXTRACT(YEAR FROM "receivedTime")::INT as year,
        COUNT(*) as count
      FROM "DocumentRecord"
      GROUP BY EXTRACT(YEAR FROM "receivedTime")
      ORDER BY year DESC
    `;

    console.log('Documents by year:');
    dateDistribution.forEach(d => {
      const yearStr = d.year ? String(d.year) : 'NULL';
      console.log(`  ${yearStr}: ${d.count}`);
    });

    // Check synthetic vs real
    const synthCount = await prisma.documentRecord.count({
      where: {
        originalName: {
          contains: 'MIL'
        },
        status: 'EMBEDDED'
      }
    });

    const realCount = await prisma.documentRecord.count({
      where: {
        status: 'EMBEDDED'
      }
    });

    console.log(`\nDocument source estimate:`);
    console.log(`  EMBEDDED total: ${realCount}`);
    console.log(`  Est. synthetic (MIL*): ${synthCount}`);
    console.log(`  Est. real: ${realCount - synthCount}`);

    // List synthetic municipalities (ones added with population script)
    const synthetic = allMuni.filter(m => 
      (m.minYear === 2021 || m.minYear === 2022 || m.minYear === 2023) && 
      m.count <= 5 && 
      m.count >= 3
    );

    console.log(`\n🏗️ LIKELY SYNTHETIC MUNICIPALITIES (added by population):`);
    console.log(`Count: ${synthetic.length}`);
    if (synthetic.length > 0) {
      synthetic.forEach(m => {
        console.log(`  - ${m.municipality} (${m.count} docs, ${m.minYear}-${m.maxYear})`);
      });
    }

    // Original municipalities (more docs or earlier dates)
    const original = allMuni.filter(m => 
      m.count > 5 || (m.minYear && m.minYear < 2020)
    );

    console.log(`\n📍 LIKELY ORIGINAL MUNICIPALITIES (real municipal data):`);
    console.log(`Count: ${original.length}`);
    original.slice(0, 20).forEach(m => {
      console.log(`  - ${m.municipality} (${m.count} docs, ${m.minYear}-${m.maxYear})`);
    });
    if (original.length > 20) {
      console.log(`  ... and ${original.length - 20} more`);
    }

    // Projects
    const projects = await prisma.project.findMany({
      select: { id: true, propertyDesignation: true }
    });

    console.log(`\n📦 PROJECTS IN DATABASE:`);
    projects.forEach(p => {
      console.log(`  ${p.propertyDesignation}`);
    });

    console.log('\n⚠️ CONCLUSION:');
    console.log('───────────────────────────────────────────────────────');
    if (synthetic.length > 50) {
      console.log('❌ PROBLEM: Too many synthetic municipalities added!');
      console.log(`   Original real data: ~${original.length} municipalities`);
      console.log(`   Synthetic data added: ${synthetic.length} municipalities`);
      console.log(`   Total: ${allMuni.length}`);
      console.log('\n   This might be masking loss of real data.');
      console.log('   Consider: Did real data get deleted instead of synth?');
    } else {
      console.log('✅ OK: Synthetic data is supplementary, not replacement.');
      console.log(`   Original: ~${original.length} real municipalities`);
      console.log(`   Added: ${synthetic.length} synthetic ones`);
    }

    console.log('\n');

  } catch (error) {
    console.error('\n❌ Error:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

auditDatabase();
