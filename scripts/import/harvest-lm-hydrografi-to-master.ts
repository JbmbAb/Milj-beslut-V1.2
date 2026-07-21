/**
 * LM Hydrografi Direkt — materialisera live OGC Features → GPKG + manifest.
 *
 * Källan finns **enbart som direkt tjänst** (ingen bulk-ZIP/Atom). Kör sist i
 * geodata-gap-pipelinen när övriga download-first-jobb är klara. Nycklar i .env.
 */
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { getHarvestPath } from './config/mimersBrunn';
import { createManifest } from './utils/harvesting';

dotenv.config();

const OGR2OGR_PATH = process.env.OGR2OGR_PATH || 'C:\\Program Files\\GDAL\\ogr2ogr.exe';
const BASE = 'https://api.lantmateriet.se/ogc-features/v1/hydrografi/collections';
const TOKEN_URL = process.env.LANTMATERIET_TOKEN_URL || 'https://api.lantmateriet.se/token';

const COLLECTIONS = [
  { id: 'WatercourseLine', layer: 'watercourseline' },
  { id: 'StandingWater', layer: 'standingwater' },
  { id: 'Wetland', layer: 'wetland' },
  { id: 'LandWaterBoundary', layer: 'landwaterboundary' },
] as const;

let cachedToken = '';
let tokenExpiresAt = 0;

/** OAuth2 client_credentials — same flow as the LM STAC harvesters. */
async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < tokenExpiresAt) return cachedToken;

  const consumerKey = process.env.LANTMATERIET_CONSUMER_KEY || '';
  const consumerSecret = process.env.LANTMATERIET_CONSUMER_SECRET || '';
  if (!consumerKey || !consumerSecret) {
    throw new Error(
      'Missing LANTMATERIET_CONSUMER_KEY / LANTMATERIET_CONSUMER_SECRET in .env (OAuth2 client_credentials)',
    );
  }

  const creds = Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64');
  const body = new URLSearchParams({ grant_type: 'client_credentials' });
  if (process.env.LANTMATERIET_SCOPE) body.set('scope', process.env.LANTMATERIET_SCOPE);

  const resp = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${creds}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });
  if (!resp.ok) {
    throw new Error(`LM token request failed (${resp.status}): ${await resp.text()}`);
  }
  const json = (await resp.json()) as { access_token: string; expires_in?: number };
  cachedToken = json.access_token;
  tokenExpiresAt = Date.now() + (json.expires_in ?? 3600) * 1000 - 60_000;
  return cachedToken;
}

async function harvestCollection(collection: (typeof COLLECTIONS)[number]): Promise<void> {
  const targetDir = getHarvestPath('Lantmateriet', `HydrografiDirekt/${collection.id}`);
  const rawDir = path.join(targetDir, 'raw');
  fs.mkdirSync(rawDir, { recursive: true });

  const token = await getAccessToken();
  const outputFile = path.join(rawDir, `${collection.layer}.gpkg`);
  const url = `OAPIF:${BASE}/${collection.id}/items?f=json&limit=10000`;

  console.log(`\nHarvesting ${collection.id} → ${outputFile}`);
  const result = spawnSync(
    OGR2OGR_PATH,
    [
      '--config',
      'GDAL_HTTP_HEADERS',
      `Authorization: Bearer ${token}`,
      '-f',
      'GPKG',
      outputFile,
      url,
      '-nln',
      collection.layer,
      '-t_srs',
      'EPSG:3006',
      '-overwrite',
      '-skipfailures',
    ],
    {
      stdio: 'inherit',
      env: { ...process.env },
    },
  );

  if (result.status !== 0) {
    throw new Error(`ogr2ogr failed for ${collection.id} (exit ${result.status})`);
  }

  await createManifest(rawDir, {
    provider: 'Lantmateriet',
    dataset: `HydrografiDirekt/${collection.id}`,
    version: new Date().toISOString().split('T')[0],
    source_url: `${BASE}/${collection.id}`,
    provenance: 'harvested',
  });
}

async function main() {
  console.log('LM Hydrografi Direkt harvest (Mimers Brunn)');
  for (const collection of COLLECTIONS) {
    await harvestCollection(collection);
  }
  console.log('\n✅ LM Hydrografi harvest complete.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
