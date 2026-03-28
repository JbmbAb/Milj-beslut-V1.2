import { syncManifestMetadata } from '../server/services/searchService';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const projectId = 'cmmpmyhc90004cuyg57iuzcmo';
  const organisationId = 'cmmpmyhbi0000cuygxder83pd';
  const manifestPath = 'C:\\Users\\jimmy\\Desktop\\OutlookExport\\manifest.csv';
  const outlookBaseDir = 'C:\\Users\\jimmy\\Desktop\\OutlookExport';

  console.log('--- SYNCING MANIFEST ---');
  const result = await syncManifestMetadata({
    projectId,
    organisationId,
    manifestPath,
    outlookBaseDir
  });

  console.log('Sync Result:', result);
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });
