import { prisma } from '../server/db/prisma';
import { loadEnvFile } from '../server/loadEnv';
import { syncFoundationLegalSources } from '../server/modules/legal/services/foundationLegalSourceSyncService';

async function main(): Promise<void> {
  loadEnvFile();
  loadEnvFile('.env.local');

  const result = await syncFoundationLegalSources();
  console.log(`Synkade ${result.processed} grundförfattningar till LegalSourceRecord.`);
  for (const record of result.records) {
    console.log(`- ${record.externalId}: ${record.title} (${record.legalSourceId})`);
  }
}

main()
  .catch((error) => {
    console.error('Kunde inte synka grundförfattningar:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
