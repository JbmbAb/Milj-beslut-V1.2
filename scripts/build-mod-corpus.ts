import { loadEnvFile } from '../server/loadEnv';
import { buildModCorpus, resolveModCorpusDirectory } from '../server/modules/legal/services/modCorpusService';

async function main(): Promise<void> {
  loadEnvFile();
  loadEnvFile('.env.local');

  const result = await buildModCorpus();
  console.log(`Byggde MÖD-korpus med ${result.processed} poster i ${resolveModCorpusDirectory()}.`);
  console.log(`Manifest: ${result.manifestPath}`);
}

main().catch((error) => {
  console.error('Kunde inte bygga MÖD-korpus:', error);
  process.exitCode = 1;
});
