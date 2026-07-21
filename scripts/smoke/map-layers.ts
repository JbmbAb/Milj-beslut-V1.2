/**
 * scripts/smoke/map-layers.ts
 *
 * Smoketest för kartlager-API. Pingar alla endpoints i MAP_LAYER_CATALOG och
 * GEODATA_SMOKE_CATALOG (/api/geodata/*) med en bounding box över Uppsala län
 * och verifierar att varje svar är:
 *   - HTTP 2xx
 *   - Giltig JSON med FeatureCollection-struktur (type === 'FeatureCollection')
 *
 * Körs mot valfri host via env BASE_URL (default http://localhost:8787).
 *
 * Användning:
 *   npm run smoke:map-layers
 *   BASE_URL=https://staging.miljobeslut.se npm run smoke:map-layers
 */

import { GEODATA_SMOKE_CATALOG, MAP_LAYER_CATALOG } from '../../server/datasources/mapLayerCatalog';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:8787';
// BBOX över centrala Uppsala (lng_min, lat_min, lng_max, lat_max)
const DEFAULT_BBOX = '17.55,59.82,17.75,59.92';

interface SmokeResult {
  key: string;
  endpoint: string;
  status: 'ok' | 'fail' | 'degraded';
  httpStatus?: number;
  durationMs: number;
  error?: string;
  featureCount?: number;
}

async function smokeFeatureCollection(key: string, endpoint: string, url: string): Promise<SmokeResult> {
  const started = Date.now();
  try {
    const res = await fetch(url, { method: 'GET' });
    const durationMs = Date.now() - started;
    if (!res.ok) {
      return {
        key,
        endpoint,
        status: 'fail',
        httpStatus: res.status,
        durationMs,
        error: `HTTP ${res.status} ${res.statusText}`,
      };
    }
    const body: any = await res.json();
    const isCollection = body && body.type === 'FeatureCollection' && Array.isArray(body.features);
    if (!isCollection) {
      return {
        key,
        endpoint,
        status: 'degraded',
        httpStatus: res.status,
        durationMs,
        error: 'Response is not a FeatureCollection',
      };
    }
    return {
      key,
      endpoint,
      status: 'ok',
      httpStatus: res.status,
      durationMs,
      featureCount: body.features.length,
    };
  } catch (err) {
    return {
      key,
      endpoint,
      status: 'fail',
      durationMs: Date.now() - started,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function hitEndpoint(entry: (typeof MAP_LAYER_CATALOG)[number]): Promise<SmokeResult> {
  const bbox = entry.bboxRequired ? DEFAULT_BBOX : '';
  const url = bbox
    ? `${BASE_URL}${entry.endpoint}?bbox=${encodeURIComponent(bbox)}`
    : `${BASE_URL}${entry.endpoint}`;
  return smokeFeatureCollection(entry.key, entry.endpoint, url);
}

async function hitGeodataEndpoint(entry: (typeof GEODATA_SMOKE_CATALOG)[number]): Promise<SmokeResult> {
  const url = `${BASE_URL}${entry.endpoint}?bbox=${encodeURIComponent(DEFAULT_BBOX)}${entry.querySuffix ?? ''}`;
  return smokeFeatureCollection(entry.key, entry.endpoint, url);
}

async function hitReferenceCatalog(): Promise<SmokeResult> {
  const url = `${BASE_URL}/api/reference/map-layers`;
  const started = Date.now();
  try {
    const res = await fetch(url);
    const durationMs = Date.now() - started;
    if (!res.ok) {
      return {
        key: 'reference_catalog',
        endpoint: '/api/reference/map-layers',
        status: 'fail',
        httpStatus: res.status,
        durationMs,
        error: `HTTP ${res.status}`,
      };
    }
    const body: any = await res.json();
    const ok = body && body.ok === true && Array.isArray(body.layers);
    return {
      key: 'reference_catalog',
      endpoint: '/api/reference/map-layers',
      status: ok ? 'ok' : 'degraded',
      httpStatus: res.status,
      durationMs,
      featureCount: Array.isArray(body?.layers) ? body.layers.length : undefined,
    };
  } catch (err) {
    return {
      key: 'reference_catalog',
      endpoint: '/api/reference/map-layers',
      status: 'fail',
      durationMs: Date.now() - started,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function main(): Promise<void> {
  console.log(`Smoketest: kartlager-API @ ${BASE_URL}`);
  console.log(`BBOX: ${DEFAULT_BBOX}`);
  console.log('─'.repeat(80));

  const results: SmokeResult[] = [];
  results.push(await hitReferenceCatalog());
  for (const entry of MAP_LAYER_CATALOG) {
    const r = await hitEndpoint(entry);
    results.push(r);
    const glyph = r.status === 'ok' ? '[OK]' : r.status === 'degraded' ? '[WARN]' : '[FAIL]';
    const featStr = r.featureCount !== undefined ? ` features=${r.featureCount}` : '';
    console.log(
      `${glyph} ${entry.key.padEnd(28)} ${entry.endpoint.padEnd(45)} ${r.durationMs}ms${featStr}${r.error ? ' — ' + r.error : ''}`,
    );
  }

  console.log('─'.repeat(80));
  console.log('/api/geodata/* (alias mot samma GeoJSON som kartlagren)');
  for (const entry of GEODATA_SMOKE_CATALOG) {
    const r = await hitGeodataEndpoint(entry);
    results.push(r);
    const glyph = r.status === 'ok' ? '[OK]' : r.status === 'degraded' ? '[WARN]' : '[FAIL]';
    const featStr = r.featureCount !== undefined ? ` features=${r.featureCount}` : '';
    console.log(
      `${glyph} ${entry.key.padEnd(28)} ${entry.endpoint.padEnd(45)} ${r.durationMs}ms${featStr}${r.error ? ' — ' + r.error : ''}`,
    );
  }

  const fails = results.filter((r) => r.status === 'fail').length;
  const warns = results.filter((r) => r.status === 'degraded').length;
  const oks = results.filter((r) => r.status === 'ok').length;
  console.log('─'.repeat(80));
  console.log(`Sammanfattning: ${oks} OK, ${warns} DEGRADED, ${fails} FAIL`);

  if (process.env.SMOKE_JSON_OUT) {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(process.env.SMOKE_JSON_OUT, JSON.stringify(results, null, 2));
    console.log(`JSON-rapport skriven: ${process.env.SMOKE_JSON_OUT}`);
  }

  process.exit(fails > 0 ? 1 : 0);
}

void main();
