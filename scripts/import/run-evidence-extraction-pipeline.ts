/**
 * Mimer Bibliotekarie (Bibbi) — Ingestion & Evidence Extraction Runner
 * 
 * Orkesstrerar hela extraktionspipelinen för de skördade miljöprövningsakterna.
 * Identifierar alla tillgängliga bundle_manifest.json under Master-arkivet och indexerar dem.
 * 
 * Usage:
 *   npx tsx scripts/import/run-evidence-extraction-pipeline.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { importCaseBundleTo3TierIndex } from '../../server/modules/legal/services/evidenceExtractionService';

// Standard Master-arkivrot i lokalt gränssnitt
const MASTER_ARCHIVE_ROOT = process.env.MASTER_ARCHIVE_ROOT || 'C:\\miljöbeslut\\storage\\geo_master_archive';

async function findBundleManifests(dir: string): Promise<string[]> {
  const manifests: string[] = [];
  
  async function traverse(currentDir: string) {
    if (!fs.existsSync(currentDir)) return;
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await traverse(fullPath);
      } else if (entry.name === 'bundle_manifest.json') {
        manifests.push(fullPath);
      }
    }
  }
  
  await traverse(dir);
  return manifests;
}

async function main() {
  console.log('=== Mimer Bibliotekarie (Bibbi): Evidence Extraction Pipeline ===');
  console.log(`Librarian: Söker efter skördade ärendepaket i: ${MASTER_ARCHIVE_ROOT}`);

  const manifestPaths = await findBundleManifests(MASTER_ARCHIVE_ROOT);
  
  if (manifestPaths.length === 0) {
    console.log('⚠️ Inga skördade ärendepaket (bundle_manifest.json) hittades i Master-arkivet.');
    console.log('Kör skördepipelinen först för att hämta akter:');
    console.log('  npx tsx scripts/import/harvest-mpd-mmd-to-master.ts --execute');
    return;
  }

  console.log(`🔍 Hittade ${manifestPaths.length} kompletta ärendepaket. Påbörjar extraktion och 3-stegs indexering...`);

  let processedCount = 0;
  let totalEvidence = 0;
  let totalChunks = 0;

  for (const manifestPath of manifestPaths) {
    processedCount++;
    console.log(`\n📦 [Ärende ${processedCount}/${manifestPaths.length}] Behandlar ${path.basename(path.dirname(path.dirname(manifestPath)))}/${path.basename(path.dirname(manifestPath))}...`);
    try {
      const result = await importCaseBundleTo3TierIndex(manifestPath);
      totalEvidence += result.evidenceCount;
      totalChunks += result.chunkCount;
    } catch (err) {
      console.error(`❌ Misslyckades med att importera ärendepaket ${manifestPath}:`, err);
    }
  }

  console.log('\n========================================================================');
  console.log('🎉 [EXTRAKTION SLUTFÖRD] Mimer Bibliotekarie har kört klart extraction pipelinen!');
  console.log(`   - Behandlade ärenden (Tier 1): ${processedCount} st`);
  console.log(`   - Indexerade dokument/bevis (Tier 2): ${totalEvidence} st`);
  console.log(`   - Genererade Evidence Chunks (Tier 3): ${totalChunks} st`);
  console.log('Samtliga Evidence Chunks är inbäddade, metadata-injicerade och sparade i pgvector/PostgreSQL.');
  console.log('========================================================================');
}

main().catch((err) => {
  console.error('❌ Pipelinerunner misslyckades:', err);
  process.exitCode = 1;
});
