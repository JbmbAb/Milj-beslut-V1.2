import { loadEnvFile } from '../server/loadEnv';
import { CURATED_LEGAL_DOWNLOAD_SOURCES } from '../server/modules/legal/catalogs/curatedLegalDownloadSources';
import {
  downloadLegalSources,
  resolveCuratedLegalDownloadDirectory,
} from '../server/modules/legal/services/legalSourceDownloadService';

async function main(): Promise<void> {
  loadEnvFile();
  loadEnvFile('.env.local');

  const result = await downloadLegalSources({
    definitions: CURATED_LEGAL_DOWNLOAD_SOURCES,
    outputDir: resolveCuratedLegalDownloadDirectory(),
  });

  console.log(`Laddade ner ${result.processed} unika juridik- och vägledningskällor till ${result.outputDir}.`);

  for (const download of result.downloads) {
    console.log(
      `- ${download.savedAs}: ${download.contentType}, ${download.bytes} byte, ${download.definitionIds.join(', ')}`,
    );
  }

  console.log(`Manifest: ${result.manifestPath}`);
}

main().catch((error) => {
  console.error('Kunde inte ladda ner kuraterade juridik- och vägledningskällor:', error);
  process.exitCode = 1;
});
