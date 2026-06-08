import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getNmdVectorTile: vi.fn(),
  loggerError: vi.fn(),
}));

vi.mock('../../server/modules/gis/public', () => ({
  getNmdVectorTile: mocks.getNmdVectorTile,
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
    mocks.getNmdVectorTile.mockResolvedValueOnce(buffer);

    const response = await request(app).get('/api/tiles/nmd/12/2200/1343.pbf');

    expect(response.status).toBe(200);
    expect(response.header['content-type']).toContain('application/x-protobuf');
    expect(Buffer.compare(response.body, buffer)).toBe(0);
  });

  it('returns 204 when the NMD tile has no data', async () => {
    const app = express();
    app.use(tilesRouter);
    mocks.getNmdVectorTile.mockResolvedValueOnce(null);

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
