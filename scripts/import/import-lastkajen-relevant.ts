/**
 * Importerar utvald relevant Lastkajen-data (legacy entrypoint).
 * För all nedladdad data: import-lastkajen-all-downloaded.ts
 *
 * Run: npx dotenv -e .env -- tsx scripts/import/import-lastkajen-relevant.ts
 */
import path from 'path';
import { fileURLToPath } from 'url';
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import { LASTKAJEN_IMPORT_JOBS } from '../../server/datasources/lastkajenImportManifest';
import { buildPgConn, runLastkajenImportJob } from './lastkajenImportEngine';

dotenv.config();

const RELEVANT_KEYS = new Set([
  'tv_atk_matplats',
  'tv_trafikplats_vag',
  'tv_viltolycka_vag',
  'tv_isa_hastighet',
]);

const prisma = new PrismaClient();
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ingestRoot = path.join(repoRoot, 'storage/ingest/lastkajen');

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL saknas');
  }

  const jobs = LASTKAJEN_IMPORT_JOBS.filter((j) => RELEVANT_KEYS.has(j.key));
  const pgConn = buildPgConn(databaseUrl);

  for (const job of jobs) {
    await runLastkajenImportJob(prisma, pgConn, ingestRoot, job);
  }

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
