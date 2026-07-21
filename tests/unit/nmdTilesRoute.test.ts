import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getVectorTile: vi.fn(),
  loggerError: vi.fn(),
}));

vi.mock('../../server/modules/gis/vectorTileEngine.js', () => ({
  getVectorTile: mocks.getVectorTile,
}));

vi.mock('../../server/logger', () => ({
  logger: {
    error: mocks.loggerError,
  },
}));

import tilesRouter from '../../server/routes/tiles.routes';

describe('tiles.routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns protobuf data for valid NMD tile requests', async () => {
    const app = express();
    app.use(tilesRouter);
    const buffer = Buffer.from('mvt-tile');
    mocks.getVectorTile.mockResolvedValueOnce({ buffer, etag: 'etag-123' });

    const response = await request(app).get('/api/tiles/nmd/12/2200/1343.pbf').buffer(true);

    expect(response.status).toBe(200);
    expect(response.header['content-type']).toContain('application/vnd.mapbox-vector-tile');
    expect(response.text).toBe(buffer.toString('binary'));
  });

  it('returns 204 when the NMD tile has no data', async () => {
    const app = express();
    app.use(tilesRouter);
    mocks.getVectorTile.mockResolvedValueOnce(null);

    const response = await request(app).get('/api/tiles/nmd/12/2200/1343.pbf');

    expect(response.status).toBe(204);
  });

  it('rejects invalid tile coordinates', async () => {
    const app = express();
    app.use(tilesRouter);

    const response = await request(app).get('/api/tiles/nmd/not-a-z/2200/1343.pbf');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'Ogiltiga tile-koordinater.' });
  });
});
