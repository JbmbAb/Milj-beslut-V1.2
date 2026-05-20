import { spawnSync } from 'child_process';
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import fetch from 'node-fetch';
import fs from 'fs';

dotenv.config();

const prisma = new PrismaClient();
const DATABASE_URL = process.env.DATABASE_URL || '';
const OGR2OGR_PATH = 'C:\\Program Files\\GDAL\\ogr2ogr.exe';

const COLLECTIONS = [
  {
    id: 'lm_fastighetsytor',
    url: 'https://api.lantmateriet.se/ogc-features/v1/fastighetsindelning/collections/registerenhetsomradesytor',
    table: 'public.env_registerenhetsomradesytor',
  },
  {
    id: 'lm_fastighetslinjer',
    url: 'https://api.lantmateriet.se/ogc-features/v1/fastighetsindelning/collections/registerenhetsomradeslinjer',
    table: 'public.env_registerenhetsomradeslinjer',
  },
];

async function fetchAllFeatures(baseUrl: string, token: string, limit = 1000) {
  let nextUrl: string | null = `${baseUrl}/items?limit=${limit}`;
  const allFeatures: any[] = [];
  let page = 1;

  while (nextUrl) {
    console.log(`   - Fetching page ${page}...`);
    try {
      const res = await fetch(nextUrl, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/geo+json',
        },
      });

      if (res.status === 429) {
        console.log(`   ⚠️ Rate limited. Waiting 30s...`);
        await new Promise((resolve) => setTimeout(resolve, 30000));
        continue; // Retry same URL
      }

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Fetch failed (${res.status}): ${text}`);
      }

      const data = (await res.json()) as any;
      if (data.features) {
        allFeatures.push(...data.features);
        console.log(`     (Got ${data.features.length} features, total ${allFeatures.length})`);
      }

      const nextLink = (data.links || []).find((l: any) => l.rel === 'next');
      nextUrl = nextLink ? nextLink.href : null;
      page++;

      // Small delay between pages
      await new Promise((resolve) => setTimeout(resolve, 1000));
    } catch (e) {
      console.error(`   ❌ Error on page ${page}:`, e);
      throw e;
    }
  }

  return {
    type: 'FeatureCollection',
    features: allFeatures,
  };
}

async function runImport() {
  console.log(`\n🚀 STARTING FULL MANUAL LANTMÄTERIET IMPORT (Node-Fetch)`);

  // Get Token with Scope
  const consumerKey = process.env.LANTMATERIET_CONSUMER_KEY;
  const consumerSecret = process.env.LANTMATERIET_CONSUMER_SECRET;
  if (!consumerKey || !consumerSecret) {
    console.error('Missing credentials');
    process.exit(1);
  }

  const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64');
  const scope = 'ogc_api_fastighetsindelning_read';

  console.log('🔑 Fetching token...');
  const tokenRes = await fetch('https://api.lantmateriet.se/token', {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=client_credentials&scope=${encodeURIComponent(scope)}`,
  });
  const tokenData = (await tokenRes.json()) as any;
  const token = tokenData.access_token;

  if (!token) {
    console.error('Failed to get token:', tokenData);
    process.exit(1);
  }

  for (const item of COLLECTIONS) {
    console.log(`\n📦 Processing: ${item.id}`);

    try {
      const geojson = await fetchAllFeatures(item.url, token);
      const tempPath = `./storage/ingest/platform-downloads/${item.id}_manual.json`;
      fs.writeFileSync(tempPath, JSON.stringify(geojson));
      console.log(`   ✅ Saved ${geojson.features.length} features to ${tempPath}`);

      const url = new URL(DATABASE_URL);
      const dbname = url.pathname.slice(1);
      const host = url.hostname;
      const user = url.username;
      const password = url.password;
      const port = url.port || '5432';
      const pgConn = `PG:dbname='${dbname}' host='${host}' user='${user}' password='${password}' port='${port}'`;

      const args = [
        '-f',
        'PostgreSQL',
        pgConn,
        tempPath,
        '-nln',
        item.table,
        '-overwrite',
        '-nlt',
        'PROMOTE_TO_MULTI',
        '-lco',
        'GEOMETRY_NAME=geom',
      ];

      console.log(`   - Running ogr2ogr import to PostGIS...`);
      const result = spawnSync(OGR2OGR_PATH, args, { stdio: 'inherit' });
      if (result.status !== 0) {
        throw new Error(`ogr2ogr import failed with status ${result.status}`);
      }
      console.log(`   ✅ Database update complete for ${item.id}`);
    } catch (err) {
      console.error(`   ❌ Failed ${item.id}:`, err);
    }

    // Wait between collections
    await new Promise((resolve) => setTimeout(resolve, 10000));
  }
}

runImport();
