import { loadEnvFile } from '../server/loadEnv';
import {
  downloadFoundationLegalSources,
  resolveFoundationLegalSourceDownloadDirectory,
} from '../server/modules/legal/services/foundationLegalSourceDownloadService';

async function main(): Promise<void> {
  loadEnvFile();
  loadEnvFile('.env.local');

  const result = await downloadFoundationLegalSources();
  console.log(
    `Laddade ner ${result.processed} grundförfattningar till ${resolveFoundationLegalSourceDownloadDirectory()}.`,
  );

  for (const download of result.downloads) {
    console.log(`- ${download.externalId}: ${download.savedAs} (${download.contentType}, ${download.bytes} byte)`);
  }

  console.log(`Manifest: ${result.manifestPath}`);
}

main().catch((error) => {
  console.error('Kunde inte ladda ner grundförfattningar:', error);
  process.exitCode = 1;
});
