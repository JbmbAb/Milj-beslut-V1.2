import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getOgcCatalogLayers,
  listOgcCatalogSummaries,
  resetOgcCapabilitiesCache,
} from '../../server/services/ogcCapabilitiesService';

const SAMPLE_WMS_CAPABILITIES = `<?xml version="1.0" encoding="UTF-8"?>
<WMS_Capabilities version="1.3.0">
  <Capability>
    <Layer>
      <Name>WMS</Name>
      <Layer>
        <Name>lst:grusinv</Name>
        <Title>Grusinventering</Title>
      </Layer>
      <Layer>
        <Name>lst:vatten</Name>
        <Title>Vatten</Title>
      </Layer>
    </Layer>
  </Capability>
</WMS_Capabilities>`;

describe('ogcCapabilitiesService', () => {
  beforeEach(() => {
    resetOgcCapabilitiesCache();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    resetOgcCapabilitiesCache();
  });

  it('listar federerade kataloger med WMS-flagga', () => {
    const catalogs = listOgcCatalogSummaries();
    expect(catalogs.length).toBeGreaterThanOrEqual(3);
    const geoserver = catalogs.find((c) => c.id === 'lst_geoserver_wms');
    expect(geoserver?.supportsMapToggle).toBe(true);
    expect(geoserver?.service).toBe('WMS');
  });

  it('parsar WMS GetCapabilities till kartlager', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        text: async () => SAMPLE_WMS_CAPABILITIES,
      })),
    );

    const result = await getOgcCatalogLayers('lst_geoserver_wms');
    expect(result.layers.length).toBeGreaterThanOrEqual(2);
    const names = result.layers.map((l) => l.name);
    expect(names).toContain('lst:grusinv');
    expect(names).toContain('lst:vatten');
    const tileLayer = result.layers.find((l) => l.name === 'lst:grusinv');
    expect(tileLayer?.mapMode).toBe('wms_tile');
    expect(tileLayer?.layerKey).toMatch(/^ogc_wms:lst_geoserver_wms:/);
    expect(tileLayer?.wms?.layers).toBe('lst:grusinv');
  });

  it('kastar för okänd katalog', async () => {
    await expect(getOgcCatalogLayers('does_not_exist')).rejects.toThrow(/Okänd/);
  });
});
