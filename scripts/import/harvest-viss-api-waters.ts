/**
 * VISS Open API waters harvest.
 *
 * Fallback when LST ext-geodata WFS is unreachable. This archives VISS water
 * attributes from https://viss.lansstyrelsen.se/API as JSON. The API does not
 * provide geometry, so these files are not imported as spatial layers.
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { getHarvestPath } from './config/mimersBrunn';

dotenv.config();

const API_URL = 'https://viss.lansstyrelsen.se/API';
const MANAGEMENT_CYCLES = [
  { id: '3', label: 'cycle_1_2004_2009' },
  { id: '1', label: 'cycle_2_2010_2016' },
  { id: '4', label: 'cycle_2_extension' },
  { id: '2', label: 'cycle_3_2017_2021' },
  { id: '5', label: 'cycle_3_extension' },
] as const;

function sha256File(filePath: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function countRecords(raw: string): number | string {
  const parsed = JSON.parse(raw) as unknown;
  if (Array.isArray(parsed)) return parsed.length;
  if (parsed && typeof parsed === 'object') {
    const values = Object.values(parsed as Record<string, unknown>);
    const arrayValue = values.find(Array.isArray);
    if (Array.isArray(arrayValue)) return arrayValue.length;
  }
  return 'unknown';
}

async function main(): Promise<void> {
  const apiKey = process.env.VISS_API_KEY;
  if (!apiKey) throw new Error('VISS_API_KEY saknas i .env');

  const targetDir = getHarvestPath('VISS', 'viss_api_waters');
  const rawDir = path.join(targetDir, 'raw');
  fs.mkdirSync(rawDir, { recursive: true });

  const files: string[] = [];
  const counts: Record<string, number | string> = {};

  for (const cycle of MANAGEMENT_CYCLES) {
    const url = new URL(API_URL);
    url.searchParams.set('method', 'waters');
    url.searchParams.set('apikey', apiKey);
    url.searchParams.set('format', 'json');
    url.searchParams.set('managementcycleidentifier', cycle.id);

    const response = await fetch(url, { signal: AbortSignal.timeout(600_000) });
    const body = await response.text();
    if (!response.ok) {
      throw new Error(`VISS API waters ${cycle.label} failed (${response.status}): ${body.slice(0, 300)}`);
    }

    const fileName = `waters_${cycle.label}.json`;
    const outputFile = path.join(rawDir, fileName);
    fs.writeFileSync(outputFile, body, 'utf8');
    files.push(fileName);
    counts[cycle.label] = countRecords(body);
    console.log(`${cycle.label}: ${counts[cycle.label]} records -> ${outputFile}`);
  }

  const fullPaths = files.map((file) => path.join(rawDir, file));
  const contentBundleSha256 = crypto
    .createHash('sha256')
    .update(files.map((file) => `${file}:${sha256File(path.join(rawDir, file))}`).sort().join('|'))
    .digest('hex');

  const manifest = {
    provider: 'VISS',
    dataset: 'viss_api_waters',
    version: new Date().toISOString().split('T')[0],
    downloaded_at: new Date().toISOString(),
    source_url: `${API_URL}?method=waters`,
    provenance: 'harvested_viss_open_api_non_spatial',
    content_bundle_sha256: contentBundleSha256,
    files,
    total_bytes: fullPaths.reduce((total, filePath) => total + fs.statSync(filePath).size, 0),
    counts,
    note: 'VISS Open API waters attributes only; no geometry. Use as fallback while ext-geodata WFS is unreachable.',
  };

  fs.writeFileSync(path.join(rawDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  fs.writeFileSync(
    path.join(rawDir, 'checksums.txt'),
    files.map((file) => `${sha256File(path.join(rawDir, file))}  ${file}`).join('\n'),
    'utf8',
  );
  console.log(`manifest: ${path.join(rawDir, 'manifest.json')}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
