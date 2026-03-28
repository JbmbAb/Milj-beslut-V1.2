#!/usr/bin/env tsx
/**
 * Check municipality coverage
 * Sweden has 290 municipalities - need 260+ for production
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkCoverage() {
  console.log('\n📋 MUNICIPALITY COVERAGE ANALYSIS\n');

  try {
    // Get current coverage
    const inDb = await prisma.$queryRaw<Array<{ municipality: string; count: number }>>`
      SELECT municipality, COUNT(*) as count
      FROM "DocumentRecord"
      WHERE municipality IS NOT NULL AND municipality != ''
      GROUP BY municipality
      ORDER BY count DESC
    `;

    const total = inDb.length;
    const targetSwedish = 290;
    const requiredProduction = 260;

    console.log(`📊 CURRENT STATUS:`);
    console.log(`   Coverage: ${total}/${targetSwedish} municipalities`);
    console.log(`   Required: ${requiredProduction}/${targetSwedish} (for production)`);
    console.log(`   Status: ${total >= requiredProduction ? '✅ PRODUCTION READY' : '❌ TEST/DEV PHASE'}\n`);

    // Show top municipalities
    console.log('📈 TOP 10 MUNICIPALITIES:');
    inDb.slice(0, 10).forEach((m, i) => {
      const pct = ((Number(m.count) / inDb.reduce((sum, x) => sum + Number(x.count), 0)) * 100).toFixed(1);
      console.log(`   ${i + 1}. ${m.municipality}: ${m.count} documents (${pct}%)`);
    });

    // Show small ones
    console.log(`\n📊 DISTRIBUTION:`);
    console.log(`   > 100 docs: ${inDb.filter((m) => Number(m.count) > 100).length} municipalities`);
    console.log(
      `   50-100 docs: ${inDb.filter((m) => Number(m.count) >= 50 && Number(m.count) <= 100).length} municipalities`,
    );
    console.log(`   < 50 docs: ${inDb.filter((m) => Number(m.count) < 50).length} municipalities`);

    // Check if real data
    const dateCheck = await prisma.$queryRaw<Array<{ hasRealDates: boolean; count: number }>>`
      SELECT 
        (EXTRACT(YEAR FROM "receivedTime") > 1970) as "hasRealDates",
        COUNT(*) as count
      FROM "DocumentRecord"
      GROUP BY "hasRealDates"
    `;

    console.log('\n⏰ DATA QUALITY:');
    const realDatesCount = dateCheck.find((d) => d.hasRealDates)?.count || 0;
    const testDataCount = dateCheck.find((d) => !d.hasRealDates)?.count || 0;
    console.log(`   Real dates (>1970): ${realDatesCount} documents`);
    console.log(`   Test data (NULL/1970): ${testDataCount} documents`);
    const isRealData = realDatesCount > testDataCount;
    console.log(`   Type: ${isRealData ? '✅ REAL DATA' : '⚠️ TEST DATA'}`);

    console.log('\n' + '═'.repeat(50));
    console.log('🎯 PRODUCTION READINESS:');
    console.log('═'.repeat(50));

    if (total >= requiredProduction && isRealData) {
      console.log('✅ READY FOR PRODUCTION');
      console.log(`   - Coverage: ${total}/${targetSwedish} (needs ${requiredProduction}+)`);
      console.log('   - Data quality: Real municipal permit data');
      console.log('   - Next: Deploy with migrations');
    } else {
      console.log('❌ NOT READY - ISSUES FOUND:\n');
      const issues = [];
      if (total < requiredProduction) {
        issues.push(
          `   ❌ Insufficient coverage: ${total}/${requiredProduction} (missing ${requiredProduction - total})`,
        );
      }
      if (!isRealData) {
        issues.push('   ❌ Contains test data (dates in 1970)');
      }
      issues.forEach((i) => console.log(i));
      console.log('\n   ACTION REQUIRED:');
      console.log('   1) Obtain real municipal permit data for 260+ communes');
      console.log('   2) Import data with valid date ranges');
      console.log('   3) Verify with "npx tsx scripts/db/check-coverage.ts"');
      console.log('   4) Then proceed with production deployment');
    }

    console.log('\n');
  } catch (error) {
    console.error('\n❌ Error:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

checkCoverage();
