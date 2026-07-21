/**
 * Staging E2E: Kartlager och geodata-katalog
 * Kör: npm run e2e:staging:map-layers
 */

import { expect, test } from '@playwright/test';
import { GEODATA_SMOKE_CATALOG, MAP_LAYER_CATALOG } from '../../server/datasources/mapLayerCatalog';
import { createApiContext, isStagingModuleE2ETarget, parseJson } from './support';

const DEFAULT_BBOX = '17.55,59.82,17.75,59.92';

function envBbox(): string {
  const lat = String(process.env.E2E_LOC_LAT ?? '59.82').trim();
  const lng = String(process.env.E2E_LOC_LNG ?? '17.65').trim();
  const delta = 0.1;
  const minLat = Number(lat) - delta;
  const maxLat = Number(lat) + delta;
  const minLng = Number(lng) - delta;
  const maxLng = Number(lng) + delta;
  if (![minLat, maxLat, minLng, maxLng].every(Number.isFinite)) {
    return DEFAULT_BBOX;
  }
  return `${minLng},${minLat},${maxLng},${maxLat}`;
}

type LayerProbeResult = 'ok' | 'degraded' | 'fail';

async function probeFeatureCollection(
  url: string,
): Promise<{ status: LayerProbeResult; httpStatus: number; body?: unknown }> {
  const api = await createApiContext();
  try {
    const response = await api.get(url);
    const httpStatus = response.status();
    if (!response.ok()) {
      return { status: 'fail', httpStatus };
    }
    const body = await parseJson<{ type?: string; features?: unknown[]; meta?: { available?: boolean } }>(
      response,
    );
    const isCollection = body?.type === 'FeatureCollection' && Array.isArray(body.features);
    if (!isCollection) {
      return { status: 'degraded', httpStatus, body };
    }
    if (body.meta?.available === false) {
      return { status: 'degraded', httpStatus, body };
    }
    return { status: 'ok', httpStatus, body };
  } finally {
    await api.dispose();
  }
}

test.describe('Staging map layers and geodata', () => {
  test.skip(!isStagingModuleE2ETarget(), 'Requires staging URL or E2E_ALLOW_LOCAL=true');

  test('GET /api/reference/map-layers returns catalog', async () => {
    const api = await createApiContext();
    try {
      const response = await api.get('/api/reference/map-layers');
      expect(response.ok(), await response.text()).toBeTruthy();
      const body = await parseJson<{ ok?: boolean; layers?: Array<{ key: string }> }>(response);
      expect(body.ok).toBe(true);
      expect(Array.isArray(body.layers)).toBe(true);
      expect((body.layers ?? []).length).toBeGreaterThan(0);
      expect((body.layers ?? []).some((layer) => layer.key === 'postgis_nvr')).toBe(true);
    } finally {
      await api.dispose();
    }
  });

  test('sample MAP_LAYER_CATALOG endpoints respond with FeatureCollection or degraded meta', async () => {
    const bbox = encodeURIComponent(envBbox());
    const sample = MAP_LAYER_CATALOG.filter((entry) => entry.bboxRequired).slice(0, 6);

    for (const entry of sample) {
      const url = `${entry.endpoint}?bbox=${bbox}`;
      const result = await probeFeatureCollection(url);
      expect(
        result.status !== 'fail',
        `${entry.key} ${entry.endpoint} failed with HTTP ${result.httpStatus}`,
      ).toBeTruthy();
    }
  });

  test('GEODATA_SMOKE_CATALOG aliases respond with FeatureCollection or degraded meta', async () => {
    const bbox = encodeURIComponent(envBbox());

    for (const entry of GEODATA_SMOKE_CATALOG.slice(0, 6)) {
      const url = `${entry.endpoint}?bbox=${bbox}${entry.querySuffix ?? ''}`;
      const result = await probeFeatureCollection(url);
      expect(
        result.status !== 'fail',
        `${entry.key} ${entry.endpoint} failed with HTTP ${result.httpStatus}`,
      ).toBeTruthy();
    }
  });
});
