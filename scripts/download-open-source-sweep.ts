import { loadEnvFile } from '../server/loadEnv';
import {
  downloadOpenSourceSweep,
  resolveOpenSourceSweepDirectory,
} from '../server/services/openSourceSweepDownloadService';

async function main(): Promise<void> {
  loadEnvFile();
  loadEnvFile('.env.local');

  const result = await downloadOpenSourceSweep();
  console.log(`Laddade ner ${result.downloaded} av ${result.attempted} publika öppna källor till ${resolveOpenSourceSweepDirectory()}.`);

  for (const entry of result.entries) {
    console.log(`- ${entry.id}: ok=${entry.ok}${entry.status ? ` status=${entry.status}` : ''}`);
  }

  console.log(`Manifest: ${result.manifestPath}`);
}

main().catch((error) => {
  console.error('Kunde inte köra open source sweep:', error);
  process.exitCode = 1;
});
