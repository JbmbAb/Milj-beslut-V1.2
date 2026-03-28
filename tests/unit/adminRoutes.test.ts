import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTokenPair } from '../../server/security/auth';

const mocks = vi.hoisted(() => ({
  getAppStatus: vi.fn(),
  getAppCompletion: vi.fn(),
  getExternalHealth: vi.fn(),
  getDbStats: vi.fn(),
  getDbAnalysis: vi.fn(),
  getDbContents: vi.fn(),
  getAdminExamSummary: vi.fn(),
  getAdminDatabaseDump: vi.fn(),
  listProjectsForAdmin: vi.fn(),
  createOrGetAdminProject: vi.fn(),
  getDispatchProviderRuntimeStatus: vi.fn(),
  getOutlookSchedulerStatus: vi.fn(),
  triggerIngestionWebhook: vi.fn(),
  getMetricsText: vi.fn(),
  getRecentErrors: vi.fn(),
  captureException: vi.fn(),
  runBackup: vi.fn(),
  listBackups: vi.fn(),
  getBackup: vi.fn(),
  extractTextFromDocument: vi.fn(),
  batchExtractPendingDocuments: vi.fn(),
}));

vi.mock('../../server/repositories/tokenRepository', () => ({
  isTokenRevoked: vi.fn(async () => false),
  markRefreshTokenAsUsed: vi.fn(async () => undefined),
  revokeRefreshToken: vi.fn(async () => undefined),
  cleanupExpiredTokenRevocations: vi.fn(async () => 0),
}));

vi.mock('../../server/repositories/adminReportRepository', () => ({
  getAppStatus: mocks.getAppStatus,
  getAppCompletion: mocks.getAppCompletion,
  getExternalHealth: mocks.getExternalHealth,
  getDbStats: mocks.getDbStats,
  getDbAnalysis: mocks.getDbAnalysis,
  getDbContents: mocks.getDbContents,
  getAdminExamSummary: mocks.getAdminExamSummary,
  getAdminDatabaseDump: mocks.getAdminDatabaseDump,
}));

vi.mock('../../server/repositories/searchRepository', () => ({
  listProjectsForAdmin: mocks.listProjectsForAdmin,
  createOrGetAdminProject: mocks.createOrGetAdminProject,
}));

vi.mock('../../server/services/transportDispatchService', () => ({
  getDispatchProviderRuntimeStatus: mocks.getDispatchProviderRuntimeStatus,
}));

vi.mock('../../server/services/outlookSchedulerService', () => ({
  getSchedulerStatus: mocks.getOutlookSchedulerStatus,
  triggerIngestionWebhook: mocks.triggerIngestionWebhook,
}));

vi.mock('../../server/services/metricsService', () => ({
  getMetricsText: mocks.getMetricsText,
}));

vi.mock('../../server/services/errorTrackingService', () => ({
  getRecentErrors: mocks.getRecentErrors,
  captureException: mocks.captureException,
}));

vi.mock('../../server/services/backupService', () => ({
  runBackup: mocks.runBackup,
  listBackups: mocks.listBackups,
  getBackup: mocks.getBackup,
}));

vi.mock('../../server/services/ocrService', () => ({
  extractTextFromDocument: mocks.extractTextFromDocument,
  batchExtractPendingDocuments: mocks.batchExtractPendingDocuments,
}));

import adminRoutes from '../../server/routes/admin.routes';

const app = express();
app.use(express.json());
app.use(adminRoutes);

function authHeader(role: 'ADMIN' | 'CONSULTANT' = 'ADMIN') {
  return `Bearer ${
    createTokenPair({
      id: role === 'ADMIN' ? 'admin-1' : 'user-1',
      organisationId: 'org-1',
      bankidId: role === 'ADMIN' ? 'admin:one' : 'consultant:one',
      role,
    }).accessToken
  }`;
}

describe('admin.routes', () => {
  const originalMetricsToken = process.env.METRICS_BEARER_TOKEN;

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.METRICS_BEARER_TOKEN;

    mocks.listProjectsForAdmin.mockResolvedValue([{ id: 'project-1' }]);
    mocks.createOrGetAdminProject.mockResolvedValue({
      project: { id: 'project-1', propertyDesignation: 'Demo 1:1' },
      created: true,
    });
    mocks.getDbContents.mockResolvedValue([{ table: 'documents', rows: 3 }]);
    mocks.getAdminDatabaseDump.mockResolvedValue({ tables: [] });
    mocks.triggerIngestionWebhook.mockResolvedValue({ accepted: true });
    mocks.getOutlookSchedulerStatus.mockReturnValue({ enabled: true });
    mocks.getMetricsText.mockResolvedValue('metric_total 1');
    mocks.getRecentErrors.mockReturnValue([{ id: 'err-1', severity: 'warning' }]);
    mocks.captureException.mockResolvedValue('error-1');
    mocks.runBackup.mockResolvedValue({ id: 'backup-1' });
    mocks.listBackups.mockReturnValue([{ id: 'backup-1' }]);
    mocks.getBackup.mockReturnValue({ id: 'backup-1' });
    mocks.extractTextFromDocument.mockResolvedValue({ id: 'doc-1', status: 'EXTRACTED' });
    mocks.batchExtractPendingDocuments.mockResolvedValue({ processed: 2 });
    mocks.getDispatchProviderRuntimeStatus.mockReturnValue({ provider: 'mock', healthy: true });
  });

  afterEach(() => {
    if (originalMetricsToken === undefined) {
      delete process.env.METRICS_BEARER_TOKEN;
      return;
    }

    process.env.METRICS_BEARER_TOKEN = originalMetricsToken;
  });

  it('guards admin project access and lists projects for admins', async () => {
    const forbidden = await request(app)
      .get('/api/admin/projects')
      .set('Authorization', authHeader('CONSULTANT'));

    expect(forbidden.status).toBe(403);

    const res = await request(app).get('/api/admin/projects').set('Authorization', authHeader('ADMIN'));

    expect(res.status).toBe(200);
    expect(res.body?.projects).toEqual([{ id: 'project-1' }]);
    expect(mocks.listProjectsForAdmin).toHaveBeenCalledWith('org-1');
  });

  it('creates admin projects and falls back to a dated designation', async () => {
    const res = await request(app)
      .post('/api/admin/projects')
      .set('Authorization', authHeader('ADMIN'))
      .send({ propertyDesignation: '   ' });

    expect(res.status).toBe(200);
    expect(mocks.createOrGetAdminProject).toHaveBeenCalledWith({
      organisationId: 'org-1',
      userId: 'admin-1',
      propertyDesignation: expect.stringMatching(/^ADMIN-INDEX-\d{4}-\d{2}-\d{2}$/),
    });
  });

  it('parses db content limits and dump flags', async () => {
    const contents = await request(app)
      .get('/api/admin/db-contents?limit=not-a-number')
      .set('Authorization', authHeader('ADMIN'));

    expect(contents.status).toBe(200);
    expect(mocks.getDbContents).toHaveBeenCalledWith(10);

    const dump = await request(app)
      .get('/api/admin/database-dump?limitPerTable=15&includeSearchText=no&includeChunkText=0')
      .set('Authorization', authHeader('ADMIN'));

    expect(dump.status).toBe(200);
    expect(mocks.getAdminDatabaseDump).toHaveBeenCalledWith({
      limitPerTable: 15,
      includeSearchText: false,
      includeChunkText: false,
    });
  });

  it('handles outlook webhook validation, ingestion and scheduler status', async () => {
    const validation = await request(app).post('/api/admin/outlook/webhook?validationToken=verify-me');

    expect(validation.status).toBe(200);
    expect(validation.text).toBe('verify-me');
    expect(mocks.triggerIngestionWebhook).not.toHaveBeenCalled();

    const webhook = await request(app)
      .post('/api/admin/outlook/webhook')
      .set('x-ms-signature', 'sig-1')
      .send({ value: [{ id: 'n-1' }] });

    expect(webhook.status).toBe(200);
    expect(mocks.triggerIngestionWebhook).toHaveBeenCalledWith({
      rawBody: JSON.stringify({ value: [{ id: 'n-1' }] }),
      signature: 'sig-1',
    });

    const forbidden = await request(app)
      .get('/api/admin/outlook/scheduler/status')
      .set('Authorization', authHeader('CONSULTANT'));
    expect(forbidden.status).toBe(403);

    const allowed = await request(app)
      .get('/api/admin/outlook/scheduler/status')
      .set('Authorization', authHeader('ADMIN'));
    expect(allowed.status).toBe(200);
    expect(allowed.body?.status?.enabled).toBe(true);
  });

  it('protects metrics with bearer auth and returns prometheus text', async () => {
    process.env.METRICS_BEARER_TOKEN = 'secret-token';

    const unauthorized = await request(app).get('/metrics');
    expect(unauthorized.status).toBe(401);
    expect(unauthorized.headers['www-authenticate']).toBe('Bearer');

    const authorized = await request(app).get('/metrics').set('Authorization', 'Bearer secret-token');

    expect(authorized.status).toBe(200);
    expect(authorized.text).toContain('metric_total 1');
  });

  it('captures admin errors with severity normalization and capped limits', async () => {
    const recent = await request(app)
      .get('/api/admin/errors/recent?limit=600&severity=warning')
      .set('Authorization', authHeader('ADMIN'));

    expect(recent.status).toBe(200);
    expect(mocks.getRecentErrors).toHaveBeenCalledWith({ limit: 500, severity: 'warning' });

    const missingMessage = await request(app)
      .post('/api/admin/errors/capture')
      .set('Authorization', authHeader('ADMIN'))
      .send({});

    expect(missingMessage.status).toBe(400);

    const created = await request(app)
      .post('/api/admin/errors/capture')
      .set('Authorization', authHeader('ADMIN'))
      .send({
        message: 'boom',
        severity: 'warning',
        context: { source: 'unit-test' },
      });

    expect(created.status).toBe(200);
    expect(mocks.captureException).toHaveBeenCalledWith(expect.objectContaining({ message: 'boom' }), {
      userId: 'admin-1',
      extra: { source: 'unit-test' },
      severity: 'warning',
    });
  });

  it('covers backup, OCR and dispatch endpoints', async () => {
    const trigger = await request(app)
      .post('/api/admin/backup/trigger')
      .set('Authorization', authHeader('ADMIN'));
    expect(trigger.status).toBe(200);

    const list = await request(app).get('/api/admin/backup/list').set('Authorization', authHeader('ADMIN'));
    expect(list.status).toBe(200);
    expect(list.body?.backups).toEqual([{ id: 'backup-1' }]);

    mocks.getBackup.mockReturnValueOnce(null);
    const missing = await request(app)
      .get('/api/admin/backup/missing')
      .set('Authorization', authHeader('ADMIN'));
    expect(missing.status).toBe(404);

    const extract = await request(app)
      .post('/api/admin/ocr/extract/doc-1')
      .set('Authorization', authHeader('ADMIN'));
    expect(extract.status).toBe(200);
    expect(mocks.extractTextFromDocument).toHaveBeenCalledWith('doc-1', 'admin-1');

    const batch = await request(app)
      .post('/api/admin/ocr/batch')
      .set('Authorization', authHeader('ADMIN'))
      .send({ limit: 999 });
    expect(batch.status).toBe(200);
    expect(mocks.batchExtractPendingDocuments).toHaveBeenCalledWith('admin-1', 200);

    const dispatch = await request(app)
      .get('/api/admin/dispatch/provider')
      .set('Authorization', authHeader('ADMIN'));
    expect(dispatch.status).toBe(200);
    expect(dispatch.body?.dispatch?.provider).toBe('mock');
  });
});
