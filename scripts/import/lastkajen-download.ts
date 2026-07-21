/**
 * Ladda ner en fil från Lastkajen till storage/ingest/lastkajen/.
 *
 * Run:
 *   npx dotenv -e .env -- tsx scripts/import/lastkajen-download.ts <packageId> <fileName>
 *
 * Exempel:
 *   npx dotenv -e .env -- tsx scripts/import/lastkajen-download.ts 1234 data.zip
 */
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { downloadDataPackageFileToPath } from '../../server/services/lastkajenService';

dotenv.config();

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ingestRoot = path.join(repoRoot, 'storage/ingest/lastkajen');

async function main() {
  const packageId = Number(process.argv[2]);
  const fileName = process.argv[3];
  if (!Number.isFinite(packageId) || !fileName) {
    throw new Error('Användning: lastkajen-download.ts <packageId> <fileName>');
  }

  const safeName = path.basename(fileName);
  const destination = path.join(ingestRoot, String(packageId), safeName);

  console.log(`\nLastkajen nedladdning: paket ${packageId}, fil ${safeName}`);
  const result = await downloadDataPackageFileToPath(packageId, safeName, destination);
  console.log(`\nKlar: ${result.destinationPath} (${result.bytesWritten} bytes)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
