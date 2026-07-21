/**
 * VISS ZIP Harvester (Mimers Brunn compliant)
 *
 * Säkrad, robust och blixtsnabb fysisk ZIP-nedladdning för VISS vattenförekomster och statusklassningar.
 * Landar i MASTER_ARCHIVE_ROOT/Data/VISS/
 *
 * Kör: npx tsx scripts/import/harvest-viss-zip-to-master.ts
 */

import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { getHarvestPath } from './config/mimersBrunn';
import { buildArchiveManifestV2 } from './types/manifestSchema';

interface VissZipJob {
  id: string;
  dataset: string;
  url: string;
  fileName: string;
  description: string;
}

const VISS_ZIP_JOBS: VissZipJob[] = [
  {
    id: 'viss_vattenforekomster_all',
    dataset: 'viss_vattenforekomster',
    url: 'https://ext-dokument.lansstyrelsen.se/Gemensamt/Geodata/Datadistribution/ZIP/VM_Vattenforekomster.zip',
    fileName: 'VM_Vattenforekomster.zip',
    description: 'VISS Vattenförekomster inkl preliminära samt övriga vatten (grupp) 2016-2021 (cykel 3)'
  },
  {
    id: 'viss_status_c3_vattendrag',
    dataset: 'viss_status_vattendrag',
    url: 'https://ext-dokument.lansstyrelsen.se/Gemensamt/Geodata/Datadistribution/ZIP/VISS_status_C3_vdr.zip',
    fileName: 'VISS_status_C3_vdr.zip',
    description: 'VM VISS Statusklassningar vattendrag 2016-2021 (cykel 3)'
  },
  {
    id: 'viss_status_c3_sjoar',
    dataset: 'viss_status_sjoar',
    url: 'https://ext-dokument.lansstyrelsen.se/Gemensamt/Geodata/Datadistribution/ZIP/VISS_status_C3_sjo.zip',
    fileName: 'VISS_status_C3_sjo.zip',
    description: 'VM VISS Statusklassningar sjöar 2016-2021 (cykel 3)'
  },
  {
    id: 'viss_status_c3_grundvatten',
    dataset: 'viss_status_grundvatten',
    url: 'https://ext-dokument.lansstyrelsen.se/Gemensamt/Geodata/Datadistribution/ZIP/VISS_status_C3_grundv.zip',
    fileName: 'VISS_status_C3_grundv.zip',
    description: 'VM VISS Statusklassningar grundvatten 2016-2021 (cykel 3)'
  },
  {
    id: 'viss_atgardsomraden',
    dataset: 'viss_atgardsomraden',
    url: 'https://ext-dokument.lansstyrelsen.se/Gemensamt/Geodata/Datadistribution/SWEREF99TM/VM_Atgardsomraden_vatten.zip',
    fileName: 'VM_Atgardsomraden_vatten.zip',
    description: 'VM Åtgärdsområden vattenförvaltningen'
  }
];

function sha256File(filePath: string): string {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

async function download(url: string, dest: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }
  if (!response.body) {
    throw new Error('Empty response body');
  }
  await pipeline(Readable.fromWeb(response.body as import('stream/web').ReadableStream), fs.createWriteStream(dest));
}

async function main() {
  console.log('🚀 VISS ZIP HARVESTER (Mimers Brunn offline-first)');
  const version = new Date().toISOString().split('T')[0];

  for (const job of VISS_ZIP_JOBS) {
    console.log(`\n📦 Inleder hämtning av: ${job.description}`);
    const targetDir = getHarvestPath('VISS', job.dataset);
    const rawDir = path.join(targetDir, 'raw');
    fs.mkdirSync(rawDir, { recursive: true });

    const zipPath = path.join(rawDir, job.fileName);
    console.log(`   Laddar ner ZIP → ${zipPath}`);
    try {
      await download(job.url, zipPath);
      
      const stat = fs.statSync(zipPath);
      const relPath = `raw/${job.fileName}`;
      
      console.log('   Genererar manifest.json v2...');
      const manifest = buildArchiveManifestV2({
        provider: 'VISS',
        dataset: job.dataset,
        version,
        total_bytes: stat.size,
        files: [relPath],
        content_bundle_sha256: sha256File(zipPath),
        provenance: 'harvested',
        source_url: job.url,
        license: 'CC BY 4.0',
      });
      
      fs.writeFileSync(
        path.join(targetDir, 'manifest.json'), 
        `${JSON.stringify(manifest, null, 2)}\n`, 
        'utf8'
      );
      console.log(`   ✅ Spara klar! VISS dataset ${job.dataset} arkiverat framgångsrikt.`);
    } catch (error) {
      console.error(`   ❌ Misslyckades med att hämta ${job.dataset}: ${(error as Error).message}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
