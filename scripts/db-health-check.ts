import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('--- Database Health Check ---');
  try {
    await prisma.$connect();
    console.log('✅ Connected to database');

    const postgisVersion = await prisma.$queryRawUnsafe('SELECT PostGIS_Version();');
    console.log('✅ PostGIS Version:', (postgisVersion as any)[0].postgis_version);

    const tables = [
      'User', 'Organisation', 'Project', 'DocumentRecord', 
      'RequirementRecord', 'RequirementCase', 'AuditTrail'
    ];

    for (const table of tables) {
      try {
        const result = await prisma.$queryRawUnsafe(`SELECT count(*) as count FROM public."${table}"`);
        console.log(`✅ Table ${table}: ${(result as any)[0].count} rows`);
      } catch (e: any) {
        console.log(`❌ Table ${table}: ${e.message}`);
      }
    }

    const spatialTables = [
      { schema: 'env', table: 'sgu_ground_layer' },
      { schema: 'env', table: 'sgu_landslide_feature' },
      { schema: 'env', table: 'protected_area' },
      { schema: 'env', table: 'natura2000_area' },
      { schema: 'hydro', table: 'water_body' }
    ];

    for (const st of spatialTables) {
      try {
        const result = await prisma.$queryRawUnsafe(`SELECT count(*) as count FROM ${st.schema}.${st.table}`);
        console.log(`✅ Spatial Table ${st.schema}.${st.table}: ${(result as any)[0].count} rows`);
      } catch (e: any) {
        console.log(`❌ Spatial Table ${st.schema}.${st.table}: ${e.message}`);
      }
    }

  } catch (error) {
    console.error('❌ Connection failed:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
