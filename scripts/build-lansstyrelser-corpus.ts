import { loadEnvFile } from '../server/loadEnv';
import {
  buildLansstyrelserCorpus,
  resolveLansstyrelserCorpusDirectory,
} from '../server/modules/legal/services/lansstyrelserCorpusService';

async function main(): Promise<void> {
  loadEnvFile();
  loadEnvFile('.env.local');

  const result = await buildLansstyrelserCorpus();
  console.log(`Byggde länsstyrelse-korpus med ${result.processed} län i ${resolveLansstyrelserCorpusDirectory()}.`);
  console.log(`Manifest: ${result.manifestPath}`);
}

main().catch((error) => {
  console.error('Kunde inte bygga länsstyrelse-korpus:', error);
  process.exitCode = 1;
});
