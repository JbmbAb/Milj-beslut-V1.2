import path from 'path';
import { fileURLToPath } from 'url';
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import { LASTKAJEN_IMPORT_JOBS } from '../../server/datasources/lastkajenImportManifest';
import { buildPgConn, runLastkajenImportJob } from './lastkajenImportEngine';

dotenv.config();

const prisma = new PrismaClient();
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ingestRoot = path.join(repoRoot, 'storage/ingest/lastkajen');
const job = LASTKAJEN_IMPORT_JOBS.find((j) => j.key === 'tv_water_transport');

if (!job) {
  throw new Error('tv_water_transport job not found');
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL saknas');
}

await prisma.$executeRawUnsafe('CREATE SCHEMA IF NOT EXISTS transport;');
const result = await runLastkajenImportJob(prisma, buildPgConn(databaseUrl), ingestRoot, job);
console.log(
  'Imported tables:',
  result.tables.map((t) => t.table + ' (' + String(t.rows) + ' rows)').join(', '),
);
await prisma.$disconnect();
