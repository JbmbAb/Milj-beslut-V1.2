import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../server/createApp';
import { getDatasetMapLayer } from '../../server/services/postgisLayerService';
import { authRequest, loginAsAdmin } from '../helpers/integrationAuth';
import { GAVLE_BRYNAS_BBOX } from '../helpers/postgisSeed';
import { describeIfDatabaseIntegration } from './integrationTestEnv';

const app = createApp();

describeIfDatabaseIntegration('branch scenarios integration (negative paths, no mocks)', () => {
  let adminToken = '';

  beforeAll(async () => {
    adminToken = await loginAsAdmin();
  });

  describe('auth and authorization branches', () => {
    it('GET /api/datasources/catalog returns 401 without token', async () => {
      const res = await request(app).get('/api/datasources/catalog');
      expect(res.status).toBe(401);
    });

    it('GET /api/admin/projects returns 401 for missing auth', async () => {
      const res = await request(app).get('/api/admin/projects');
      expect(res.status).toBe(401);
    });
  });

  describe('validation branches', () => {
    it('legacy sewage create returns 400 when propertyDesignation missing', async () => {
      const res = await request(app)
        .post('/api/sewage/application/create')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ gisAnalysis: { coordinates: { lat: 60.67, lng: 17.14 } } });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('propertyDesignation');
    });

    it('legacy sewage create returns 422 for coordinates outside Sweden', async () => {
      const res = await request(app)
        .post('/api/sewage/application/create')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          propertyDesignation: 'FOREIGN 1:1',
          gisAnalysis: { coordinates: { lat: 40, lng: -74 } },
        });

      expect(res.status).toBe(422);
      expect(res.body.error).toBe('coordinates_outside_sweden');
    });

    it('GET /api/legal/view returns 404 for unknown document id', async () => {
      const res = await request(app).get('/api/legal/view/does-not-exist-branch-test');
      expect(res.status).toBe(404);
      expect(res.body.ok).toBe(false);
    });
  });

  describe('GIS / PostGIS branches', () => {
    it('unknown dataset layer key marks available=false', async () => {
      const layer = await getDatasetMapLayer('invalid_layer_key_xyz', GAVLE_BRYNAS_BBOX);
      expect(layer.meta?.available).toBe(false);
      expect(layer.features).toEqual([]);
    });

    it('GET /api/layers/dataset/invalid_layer_key_xyz returns unavailable collection', async () => {
      const bbox = `${GAVLE_BRYNAS_BBOX.minLng},${GAVLE_BRYNAS_BBOX.minLat},${GAVLE_BRYNAS_BBOX.maxLng},${GAVLE_BRYNAS_BBOX.maxLat}`;
      const res = await authRequest(adminToken).get(
        `/api/layers/dataset/invalid_layer_key_xyz?bbox=${bbox}`,
      );

      expect(res.status).toBe(503);
      expect(res.body.meta?.available).toBe(false);
    });

    it('GET /api/geo/markcover returns 400 for invalid bbox', async () => {
      const res = await authRequest(adminToken).get('/api/geo/markcover?bbox=not-a-bbox');
      expect([400, 422]).toContain(res.status);
    });
  });

  describe('internal cron branches', () => {
    it('POST internal gdpr-maintenance returns 401 without token when configured', async () => {
      process.env.INTERNAL_CRON_TOKEN = 'branch-test-token';
      const res = await request(app).post('/api/internal/background/gdpr-maintenance');
      expect(res.status).toBe(401);
      delete process.env.INTERNAL_CRON_TOKEN;
    });
  });
});
