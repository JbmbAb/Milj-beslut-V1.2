import { loadEnvFile } from '../server/loadEnv';
import {
  downloadDomstolRssFeed,
  resolveDomstolRssDownloadDirectory,
} from '../server/modules/legal/services/domstolRssDownloadService';

async function main(): Promise<void> {
  loadEnvFile();
  loadEnvFile('.env.local');

  const result = await downloadDomstolRssFeed();
  console.log(`Laddade ner ${result.processed} Domstolsverket-poster till ${resolveDomstolRssDownloadDirectory()}.`);

  for (const item of result.items) {
    console.log(`- ${item.guid}: ${item.savedAs}`);
  }

  console.log(`Feed: ${result.rawFeedPath}`);
  console.log(`Manifest: ${result.itemsManifestPath}`);
}

main().catch((error) => {
  console.error('Kunde inte ladda ner Domstolsverkets RSS-underlag:', error);
  process.exitCode = 1;
});
