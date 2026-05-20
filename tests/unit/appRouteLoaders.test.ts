import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getLayer: vi.fn(),
  queryRawUnsafe: vi.fn(),
}));

vi.mock('../../db.server', () => ({
  prisma: {
    $queryRawUnsafe: mocks.queryRawUnsafe,
  },
}));

vi.mock('../../app/services/layerRegistry', () => ({
  getLayer: mocks.getLayer,
}));

describe('app route loaders', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('api.raster.query loader', () => {
    it('returns 400 when required params are missing', async () => {
      const { loader } = await import('../../app/routes/api.raster.query');

      const response = await loader({
        request: new Request('https://example.test/api/raster/query?lng=18.1'),
        params: {},
        context: {},
      } as any);

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({
        error: 'Missing required parameters: layerId or alias, lng, lat',
      });
    });

    it('supports bare alias query params and returns raster values', async () => {
      const { loader } = await import('../../app/routes/api.raster.query');
      mocks.getLayer.mockReturnValue({
        kind: 'raster',
        schema: 'staging',
        table: 'nmd2023bas_v2_1',
        rasterColumn: 'rast',
      });
      mocks.queryRawUnsafe.mockResolvedValue([{ val: 7 }]);

      const response = await loader({
        request: new Request('https://example.test/api/raster/query?nmd2023&lng=18.1&lat=59.3'),
        params: {},
        context: {},
      } as any);

      expect(mocks.getLayer).toHaveBeenCalledWith('nmd2023');
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        layerId: 'nmd2023',
        value: 7,
        coordinates: { lng: 18.1, lat: 59.3 },
      });
    });

    it('returns null payload when raster query has no value', async () => {
      const { loader } = await import('../../app/routes/api.raster.query');
      mocks.getLayer.mockReturnValue({
        kind: 'raster',
        schema: 'staging',
        table: 'nmd2023bas_v2_1',
        rasterColumn: 'rast',
      });
      mocks.queryRawUnsafe.mockResolvedValue([{ val: null }]);

      const response = await loader({
        request: new Request('https://example.test/api/raster/query?layerId=nmd2023&lng=18.1&lat=59.3'),
        params: {},
        context: {},
      } as any);

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        value: null,
        message: 'No data at this location',
      });
    });

    it('returns 404 when the layer is missing or not raster-compatible', async () => {
      const { loader } = await import('../../app/routes/api.raster.query');
      mocks.getLayer.mockReturnValue(undefined);

      const response = await loader({
        request: new Request('https://example.test/api/raster/query?layerId=missing&lng=18.1&lat=59.3'),
        params: {},
        context: {},
      } as any);

      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toEqual({
        error: 'Layer missing not found, not a raster layer, or missing raster column',
      });
    });
  });

  describe('api.tiles mvt loader', () => {
    it('returns 400 when tile params are incomplete', async () => {
      const { loader } = await import('../../app/routes/api.tiles.$schema.$table.$z.$x.$y');

      const response = await loader({
        params: { schema: 'sgu', table: 'jordarter', z: '10', x: '540' },
        request: new Request('https://example.test'),
        context: {},
      } as any);

      expect(response.status).toBe(400);
      await expect(response.text()).resolves.toBe('Missing tile parameters');
    });

    it('returns 204 for empty tiles', async () => {
      const { loader } = await import('../../app/routes/api.tiles.$schema.$table.$z.$x.$y');
      mocks.getLayer.mockReturnValue({
        id: 'sgu.jordarter',
        kind: 'mvt',
        schema: 'sgu',
        table: 'jordarter25k_100k',
        geomColumn: 'geom',
      });
      mocks.queryRawUnsafe.mockResolvedValue([]);

      const response = await loader({
        params: { schema: 'sgu', table: 'jordarter', z: '10', x: '540', y: '321.pbf' },
        request: new Request('https://example.test'),
        context: {},
      } as any);

      expect(response.status).toBe(204);
    });

    it('returns protobuf tiles with cache headers', async () => {
      const { loader } = await import('../../app/routes/api.tiles.$schema.$table.$z.$x.$y');
      const tile = Buffer.from('tile-data');
      mocks.getLayer.mockReturnValue({
        id: 'sgu.jordarter',
        kind: 'mvt',
        schema: 'sgu',
        table: 'jordarter25k_100k',
        geomColumn: 'geom',
      });
      mocks.queryRawUnsafe.mockResolvedValue([{ mvt: tile }]);

      const response = await loader({
        params: { schema: 'sgu', table: 'jordarter', z: '10', x: '540', y: '321.pbf' },
        request: new Request('https://example.test'),
        context: {},
      } as any);

      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toBe('application/x-protobuf');
      const body = Buffer.from(await response.arrayBuffer());
      expect(body.equals(tile)).toBe(true);
    });

    it('returns 500 when tile generation fails', async () => {
      const { loader } = await import('../../app/routes/api.tiles.$schema.$table.$z.$x.$y');
      mocks.getLayer.mockReturnValue({
        id: 'sgu.jordarter',
        kind: 'mvt',
        schema: 'sgu',
        table: 'jordarter25k_100k',
        geomColumn: 'geom',
      });
      mocks.queryRawUnsafe.mockRejectedValue(new Error('db down'));

      const response = await loader({
        params: { schema: 'sgu', table: 'jordarter', z: '10', x: '540', y: '321.pbf' },
        request: new Request('https://example.test'),
        context: {},
      } as any);

      expect(response.status).toBe(500);
      await expect(response.text()).resolves.toBe('Internal Server Error during tile generation');
    });
  });

  describe('api.tiles raster loader', () => {
    it('returns png payload for raster layers', async () => {
      const { loader } = await import('../../app/routes/api.tiles.raster.$schema.$table.$z.$x.$y.png');
      const png = Buffer.from('png-data');
      mocks.getLayer.mockReturnValue({
        id: 'nvr.marktacke_2023',
        kind: 'raster',
        schema: 'staging',
        table: 'nmd2023bas_v2_1',
        rasterColumn: 'rast',
      });
      mocks.queryRawUnsafe.mockResolvedValue([{ png }]);

      const response = await loader({
        params: { schema: 'staging', table: 'nmd2023', z: '10', x: '540', y: '321.png' },
        request: new Request('https://example.test'),
        context: {},
      } as any);

      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toBe('image/png');
      const body = Buffer.from(await response.arrayBuffer());
      expect(body.equals(png)).toBe(true);
    });

    it('returns 204 when no raster tile can be generated', async () => {
      const { loader } = await import('../../app/routes/api.tiles.raster.$schema.$table.$z.$x.$y.png');
      mocks.getLayer.mockReturnValue({
        id: 'nvr.marktacke_2023',
        kind: 'raster',
        schema: 'staging',
        table: 'nmd2023bas_v2_1',
        rasterColumn: 'rast',
      });
      mocks.queryRawUnsafe.mockResolvedValue([]);

      const response = await loader({
        params: { schema: 'staging', table: 'nmd2023', z: '10', x: '540', y: '321.png' },
        request: new Request('https://example.test'),
        context: {},
      } as any);

      expect(response.status).toBe(204);
    });
  });
});
