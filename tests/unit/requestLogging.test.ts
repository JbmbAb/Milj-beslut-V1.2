import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loggerInfo: vi.fn(),
}));

vi.mock('../../server/logger', () => ({
  logger: {
    info: mocks.loggerInfo,
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

import { requestLogger } from '../../server/security/requestLogging';

function buildApp(authenticated = false) {
  const app = express();
  app.use(requestLogger);
  if (authenticated) {
    app.use((req, _res, next) => {
      (req as typeof req & { authUser: unknown }).authUser = {
        id: 'user-1',
        organisationId: 'org-1',
        bankidId: 'user:one',
        role: 'ADMIN',
      };
      next();
    });
  }
  app.get('/test', (_req, res) => res.status(200).json({ ok: true }));
  app.get('/fail', (_req, res) => res.status(500).json({ ok: false }));
  return app;
}

describe('requestLogger middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sets X-Request-Id header on responses', async () => {
    const app = buildApp();
    const res = await request(app).get('/test');
    expect(res.headers['x-request-id']).toBeDefined();
    expect(typeof res.headers['x-request-id']).toBe('string');
    expect(res.headers['x-request-id'].length).toBeGreaterThan(0);
  });

  it('generates a unique request-id per request', async () => {
    const app = buildApp();
    const [r1, r2] = await Promise.all([request(app).get('/test'), request(app).get('/test')]);
    expect(r1.headers['x-request-id']).not.toBe(r2.headers['x-request-id']);
  });

  it('logs http_access after the response finishes', async () => {
    const app = buildApp();
    await request(app).get('/test');
    expect(mocks.loggerInfo).toHaveBeenCalledWith(
      'http_access',
      expect.objectContaining({
        method: 'GET',
        path: '/test',
        statusCode: 200,
      }),
    );
  });

  it('logs the correct status code for error responses', async () => {
    const app = buildApp();
    await request(app).get('/fail');
    expect(mocks.loggerInfo).toHaveBeenCalledWith(
      'http_access',
      expect.objectContaining({ statusCode: 500 }),
    );
  });

  it('logs userId as anonymous when no authUser is present', async () => {
    const app = buildApp(false);
    await request(app).get('/test');
    expect(mocks.loggerInfo).toHaveBeenCalledWith(
      'http_access',
      expect.objectContaining({ userId: 'anonymous', organisationId: 'none' }),
    );
  });

  it('logs userId and organisationId from authUser when authenticated', async () => {
    const app = buildApp(true);
    await request(app).get('/test');
    expect(mocks.loggerInfo).toHaveBeenCalledWith(
      'http_access',
      expect.objectContaining({ userId: 'user-1', organisationId: 'org-1' }),
    );
  });

  it('includes requestId in log entry', async () => {
    const app = buildApp();
    const res = await request(app).get('/test');
    const requestId = res.headers['x-request-id'];
    expect(mocks.loggerInfo).toHaveBeenCalledWith('http_access', expect.objectContaining({ requestId }));
  });

  it('includes durationMs in log entry', async () => {
    const app = buildApp();
    await request(app).get('/test');
    const logCall = mocks.loggerInfo.mock.calls[0][1] as Record<string, unknown>;
    expect(typeof logCall.durationMs).toBe('number');
    expect(logCall.durationMs).toBeGreaterThanOrEqual(0);
  });
});
