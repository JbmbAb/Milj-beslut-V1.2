import { loadEnvFile } from '../server/loadEnv';
import { buildMmdCorpus, resolveMmdCorpusDirectory } from '../server/modules/legal/services/mmdCorpusService';

async function main(): Promise<void> {
  loadEnvFile();
  loadEnvFile('.env.local');

  const result = await buildMmdCorpus();
  console.log(`Byggde MMD-korpus med ${result.processed} domstolar i ${resolveMmdCorpusDirectory()}.`);
  console.log(`Manifest: ${result.manifestPath}`);
}

main().catch((error) => {
  console.error('Kunde inte bygga MMD-korpus:', error);
  process.exitCode = 1;
});
