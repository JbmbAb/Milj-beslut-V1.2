#!/usr/bin/env tsx
/**
 * Database inspection script
 * Reads database schema and shows tables, row counts, and samples
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function inspectDatabase() {
  console.log('\n🔍 DATABASE INSPECTION\n');
  console.log(`Database URL: ${process.env.DATABASE_URL}\n`);

  try {
    // Get all tables
    const tables = await prisma.$queryRaw<
      Array<{ tablename: string }>
    >`
      SELECT tablename FROM pg_tables 
      WHERE schemaname = 'public'
      ORDER BY tablename
    `;

    console.log(`📊 TABLES (${tables.length}):`);
    console.log('════════════════════════════════════════\n');

    for (const table of tables) {
      const tableName = table.tablename;
      
      // Get row count
      const countResult = await prisma.$queryRawUnsafe<
        Array<{ count: number }>
      >(`SELECT COUNT(*) as count FROM "${tableName}"`);
      const count = countResult?.[0]?.count || 0;

      // Get columns
      const columns = await prisma.$queryRaw<
        Array<{ column_name: string; data_type: string }>
      >`
        SELECT column_name, data_type 
        FROM information_schema.columns 
        WHERE table_name = ${tableName}
        ORDER BY ordinal_position
      `;

      console.log(`\n📌 ${tableName.toUpperCase()}`);
      console.log(`   Rows: ${count}`);
      console.log(`   Columns:`);
      for (const col of columns) {
        console.log(`     - ${col.column_name}: ${col.data_type}`);
      }

      // Show sample data for important tables
      if (['TokenRevocation', 'RateLimitEntry', 'User', 'Project'].includes(tableName)) {
        if (count > 0) {
          const sample = await prisma.$queryRawUnsafe<any[]>(
            `SELECT * FROM "${tableName}" LIMIT 3`
          );
          console.log(`   Sample data:`);
          sample.forEach((row, i) => {
            console.log(`     [${i + 1}] ${JSON.stringify(row, null, 2).split('\n').join('\n        ')}`);
          });
        } else {
          console.log(`   (No data yet)`);
        }
      }
    }

    console.log('\n════════════════════════════════════════');
    console.log('\n✅ Inspection complete\n');

  } catch (error) {
    console.error('\n❌ Error:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

inspectDatabase();
