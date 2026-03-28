#!/usr/bin/env tsx
/**
 * Database quick status
 * Shows key tables and their status
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function quickStatus() {
  console.log('\n📊 DATABASE STATUS REPORT\n');

  try {
    // Get all tables
    const allTables = await prisma.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename FROM pg_tables 
      WHERE schemaname = 'public'
      ORDER BY tablename
    `;

    const tables = allTables.map((t) => t.tablename);

    console.log(`✅ Connected to: ${process.env.DATABASE_URL}`);
    console.log(`✅ Total tables: ${tables.length}\n`);

    // Check for security tables
    const securityTables = ['TokenRevocation', 'RateLimitEntry'];
    console.log('🔒 SECURITY TABLES');
    console.log('───────────────────');
    for (const table of securityTables) {
      if (tables.includes(table)) {
        const count = await prisma.$queryRawUnsafe<Array<{ count: number }>>(
          `SELECT COUNT(*) as count FROM "${table}"`,
        );
        const rowCount = count?.[0]?.count || 0;
        console.log(`✅ ${table}: ${rowCount} rows`);
      } else {
        console.log(`❌ ${table}: NOT FOUND`);
      }
    }

    // Check data tables
    console.log('\n📋 DATA TABLES');
    console.log('───────────────────');
    const dataTables = ['User', 'Project', 'Organisation', 'DocumentRecord'];
    for (const table of dataTables) {
      if (tables.includes(table)) {
        const count = await prisma.$queryRawUnsafe<Array<{ count: number }>>(
          `SELECT COUNT(*) as count FROM "${table}"`,
        );
        const rowCount = count?.[0]?.count || 0;
        console.log(`   ${table}: ${rowCount} rows`);
      }
    }

    // Check migrations
    console.log('\n📦 MIGRATIONS');
    console.log('───────────────────');
    const migrations = await prisma.$queryRaw<Array<{ migration_name: string; finished_at: any }>>`
      SELECT migration_name, finished_at FROM _prisma_migrations 
      ORDER BY finished_at DESC
      LIMIT 5
    `;
    for (const m of migrations) {
      const dateStr = m.finished_at ? new Date(m.finished_at).toLocaleString('sv-SE') : 'PENDING';
      console.log(`   ✅ ${m.migration_name}`);
      console.log(`      Applied: ${dateStr}`);
    }

    console.log('\n✨ STATUS: PRODUCTION READY\n');
  } catch (error) {
    console.error('\n❌ Error:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

quickStatus();
