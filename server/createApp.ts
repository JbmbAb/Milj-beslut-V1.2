import express from 'express';
import secureApiRouter from './secureApi.express';
import geminiRouter from './geminiApi.express';
import geminiDbRouter from './geminiDbApi.express';
import mvpRouter from './mvpApi.express';
import { prisma } from './db/prisma';
import { logger } from './logger';

export function createApp() {
  const app = express();

  const corsAllowList = String(process.env.CORS_ALLOW_ORIGINS || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  const allowAnyCorsOrigin = corsAllowList.includes('*');

  app.use((req, res, next) => {
    const origin = typeof req.headers.origin === 'string' ? req.headers.origin : '';
    const allowOrigin = origin && (allowAnyCorsOrigin || corsAllowList.includes(origin));

    if (allowOrigin) {
      res.header('Access-Control-Allow-Origin', allowAnyCorsOrigin ? '*' : origin);
      res.header('Vary', 'Origin');
      res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    }

    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }

    next();
  });

  /**
   * GET /health
   *
   * Liveness + readiness probe.  Returns HTTP 200 when the application and
   * database are healthy, HTTP 503 when the database is unreachable.
   *
   * Response shape:
   *   { ok: true,  service: string, version: string, db: "ok",  ts: string }
   *   { ok: false, service: string, version: string, db: "error", ts: string }
   */
  app.get('/health', async (_req, res) => {
    let dbStatus: 'ok' | 'error' = 'error';
    try {
      await prisma.$queryRaw`SELECT 1`;
      dbStatus = 'ok';
    } catch (err) {
      logger.error('Health check DB query failed', { err: String(err) });
      // keep dbStatus = 'error'
    }
    const healthy = dbStatus === 'ok';
    res.status(healthy ? 200 : 503).json({
      ok: healthy,
      service: 'miljobeslut-secure-backend',
      version: process.env.npm_package_version ?? 'unknown',
      db: dbStatus,
      ts: new Date().toISOString(),
    });
  });

  app.use(mvpRouter);
  app.use(secureApiRouter);
  app.use(geminiRouter);
  app.use(geminiDbRouter);

  return app;
}

