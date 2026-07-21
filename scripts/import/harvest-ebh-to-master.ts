/**
 * EBH potentiellt förorenade områden — nationell ZIP → Master Archive.
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { getHarvestPath } from './config/mimersBrunn';
import { buildArchiveManifestV2 } from './types/manifestSchema';

const EBH_ZIP_URL =
  'https://ext-dokument.lansstyrelsen.se/Gemensamt/Geodata/Datadistribution/SWEREF99TM/EBH_Potentiellt_fororenade_omraden.zip';

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
  const version = new Date().toISOString().split('T')[0];
  const targetDir = getHarvestPath('LST', 'EBH_Potentiellt_fororenade_omraden');
  const rawDir = path.join(targetDir, 'raw');
  fs.mkdirSync(rawDir, { recursive: true });

  const zipPath = path.join(rawDir, 'EBH_Potentiellt_fororenade_omraden.zip');
  console.log(`Downloading EBH ZIP → ${zipPath}`);
  await download(EBH_ZIP_URL, zipPath);

  const stat = fs.statSync(zipPath);
  const rel = 'raw/EBH_Potentiellt_fororenade_omraden.zip';
  const manifest = buildArchiveManifestV2({
    provider: 'LST',
    dataset: 'EBH_Potentiellt_fororenade_omraden',
    version,
    total_bytes: stat.size,
    files: [rel],
    content_bundle_sha256: sha256File(zipPath),
    provenance: 'harvested',
    source_url: EBH_ZIP_URL,
    license: 'CC0',
  });
  fs.writeFileSync(path.join(targetDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.log('✅ EBH ZIP archived with manifest v2.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
