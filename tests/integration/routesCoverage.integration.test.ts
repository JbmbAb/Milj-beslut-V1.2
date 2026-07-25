import path from 'node:path';
import fs from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../server/createApp';
import { prisma } from '../../server/db/prisma';
import { authRequest, documentsFixtureRoot, loginAsAdmin } from '../helpers/integrationAuth';
import { describeIfDatabaseIntegration } from './integrationTestEnv';

const app = createApp();

describeIfDatabaseIntegration('routesCoverage integration (createApp, no mocks)', () => {
  let adminToken = '';

  beforeAll(async () => {
    adminToken = await loginAsAdmin();
  });

  describe('datasource.routes', () => {
    it('GET /api/datasources/catalog returns source catalog for admin', async () => {
      const res = await authRequest(adminToken).get('/api/datasources/catalog');
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(Array.isArray(res.body.sources)).toBe(true);
      expect(res.body.sources.length).toBeGreaterThan(0);
    });

    it('GET /api/search/info returns search config', async () => {
      const res = await authRequest(adminToken).get('/api/search/info');
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    });
  });

  describe('legal.routes', () => {
    it('GET /api/legal/judgments returns paginated list', async () => {
      const res = await request(app).get('/api/legal/judgments');
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    });

    it('GET /api/legal/view serves local fixture file when sourcePath exists', async () => {
      const fixturePath = path.join(documentsFixtureRoot(), 'sample-legal.txt');
      const record = await prisma.legalCorpusRecord.upsert({
        where: { id: 'integration-legal-local-file' },
        update: {
          sourcePath: fixturePath,
          sourceUrl: null,
          mimeType: 'text/plain',
        },
        create: {
          id: 'integration-legal-local-file',
          title: 'Offline legal fixture',
          sourcePath: fixturePath,
          mimeType: 'text/plain',
          searchText: 'offline fixture',
          metadata: {},
          recordKey: 'integration-legal-key',
          canonicalKey: 'integration-legal-canonical',
          sourceFamily: 'TEST_FAMILY',
          sourceType: 'TEST_TYPE',
          sourceSystem: 'TEST_SYSTEM',
          language: 'sv',
        },
      });

      const res = await request(app).get(`/api/legal/view/${record.id}`);
      expect(res.status).toBe(200);
      expect(res.text).toContain('offline integration tests');

      await prisma.legalCorpusRecord.delete({ where: { id: record.id } }).catch(() => undefined);
    });

    it('POST /api/legal/search returns 401 if unauthorized', async () => {
      const res = await request(app).post('/api/legal/search').send({ query: 'strandskydd' });
      expect(res.status).toBe(401);
    });

    it('POST /api/legal/search returns 400 if query is too short', async () => {
      const res = await authRequest(adminToken).post('/api/legal/search').send({ query: 'a' });
      expect(res.status).toBe(400);
    });

    it('POST /api/legal/search returns search results and meta with admin token', async () => {
      const res = await authRequest(adminToken).post('/api/legal/search').send({ query: 'strandskydd' });
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(Array.isArray(res.body.results)).toBe(true);
      expect(res.body.meta).toBeDefined();
      expect(res.body.meta.rerankerEngine).toBeDefined();
      expect(res.body.meta.promptVersion).toBeDefined();
      expect(res.body.meta.rerankerStatus).toBeDefined();
    });
  });

  describe('sewage.legacy-alias.routes', () => {
    it('sets Deprecation and Link headers on legacy sewage routes', async () => {
      const res = await request(app)
        .post('/api/sewage/application/create')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          propertyDesignation: 'GÄVLE BRYNÄS 1:1',
          gisAnalysis: { coordinates: { lat: 60.67, lng: 17.14 } },
        });

      expect(res.headers.deprecation).toBe('true');
      expect(res.headers.link).toContain('successor-version');
      expect([201, 400]).toContain(res.status);
    });

    it('POST validate returns 404 for unknown application id', async () => {
      const res = await request(app)
        .post('/api/sewage/application/missing-id-xyz/validate')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({});

      expect(res.status).toBe(404);
      expect(res.headers.deprecation).toBe('true');
    });
  });

  describe('internal.background.routes', () => {
    it('returns 503 when INTERNAL_CRON_TOKEN is not configured', async () => {
      const prev = process.env.INTERNAL_CRON_TOKEN;
      delete process.env.INTERNAL_CRON_TOKEN;

      const res = await request(app).post('/api/internal/background/search-worker/tick').send({ maxJobs: 1 });

      expect(res.status).toBe(503);

      if (prev) process.env.INTERNAL_CRON_TOKEN = prev;
    });

    it('returns 401 with wrong internal token', async () => {
      process.env.INTERNAL_CRON_TOKEN = 'integration-cron-secret';

      const res = await request(app)
        .post('/api/internal/background/gdpr-maintenance')
        .set('X-Internal-Token', 'wrong-token');

      expect(res.status).toBe(401);

      delete process.env.INTERNAL_CRON_TOKEN;
    });

    it('runs search-worker tick with valid internal token', async () => {
      process.env.INTERNAL_CRON_TOKEN = 'integration-cron-secret';

      const res = await request(app)
        .post('/api/internal/background/search-worker/tick')
        .set('X-Internal-Token', 'integration-cron-secret')
        .send({ maxJobs: 1 });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(typeof res.body.processed).toBe('number');

      delete process.env.INTERNAL_CRON_TOKEN;
    });
  });
});
