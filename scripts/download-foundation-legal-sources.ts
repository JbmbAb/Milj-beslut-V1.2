import { loadEnvFile } from '../server/loadEnv';
import { rejectLegacyLegalAcquisition } from '../server/modules/legal/services/legalSourceDownloadService';

async function main(): Promise<void> {
  loadEnvFile();
  loadEnvFile('.env.local');
  rejectLegacyLegalAcquisition('scripts/download-foundation-legal-sources.ts');
}

main().catch((error) => {
  console.error('Legacy foundation legal acquisition is disabled:', error);
  process.exitCode = 1;
});
