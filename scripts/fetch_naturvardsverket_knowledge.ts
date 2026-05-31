import { loadEnvFile } from '../server/loadEnv.ts';
import {
  downloadNaturvardsverketKnowledge,
  resolveNaturvardsverketDownloadDirectory,
} from '../server/modules/legal/services/naturvardsverketDownloadService.ts';

async function main(): Promise<void> {
  loadEnvFile();
  loadEnvFile('.env.local');

  const result = await downloadNaturvardsverketKnowledge();
  console.log(`Laddade ner NVV-underlag till ${resolveNaturvardsverketDownloadDirectory()}.`);
  for (const file of result.files) {
    console.log(`- ${file}`);
  }
  console.log(`Manifest: ${result.manifestPath}`);
}

main().catch((error) => {
  console.error('Kunde inte ladda ner Naturvårdsverkets underlag:', error);
  process.exitCode = 1;
});
