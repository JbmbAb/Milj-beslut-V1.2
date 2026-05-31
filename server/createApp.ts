import express from 'express';
import authRouter from './routes/auth.routes';
import referenceRouter from './routes/reference.routes';
import datasourceRouter from './routes/datasource.routes';
import searchRouter from './routes/search.routes';
import gdprRouter from './routes/gdpr.routes';
import adminV1Router from './routes/admin.v1.routes';
import adminLegacyRouter from './routes/admin.routes';
import projectV1Router from './routes/project.v1.routes';
import projectLegacyRouter from './routes/project.routes';
import generatorsRouter from './routes/generators.routes';
import logisticsRouter from './routes/logistics.routes';
import geminiRouter from './geminiApi.express';
import geminiDbRouter from './geminiDbApi.express';
import coreRouter from './coreApi.express';
import gisRouter from './routes/gis.routes';
import geodataRouter from './routes/geodata.routes';
import geoRouter from './routes/geo.routes';
import legalRouter from './routes/legal.routes';
import localizationRouter from './routes/localization.routes';
import documentRouter from './routes/document.routes';
import requirementsRouter from './routes/requirements.routes';
import classificationReviewRouter from './routes/classification-review.routes';
import sewageDocumentRouter from './routes/sewage.routes';
import sewageApplicationsRouter from './routes/sewage.applications.routes';
import sewageLegacyAliasRouter from './routes/sewage.legacy-alias.routes';
import cNotificationMassRouter from './routes/cNotificationMass.routes';
import hydroRouter from './routes/hydro.routes';
import pdfExportRouter from './routes/pdf-export.routes';
import bankComplianceRouter from './routes/bankCompliance.routes';
import erpSyncRouter from './routes/erpSync.routes';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { traceMiddleware } from './observability/trace';
import { propertyLookupRouter } from './integrations/propertyLookup';
import { initializeSentry } from './sentry';
import { logger } from './logger';
import { csrfProtection } from './security/csrf';
import { secureErrorHandler } from './security/secureErrors';
import internalBackgroundRouter from './routes/internal.background.routes';
import { getReadinessPayload } from './services/readinessService';

export function createApp() {
  const app = express();

  // Initialize Sentry error tracking
  initializeSentry(app);

  // Security Headers
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
    }),
  );

  // Global Rate Limiting
  app.use(
    rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 1000,
      standardHeaders: true,
      legacyHeaders: false,
      skip: (req) => process.env.NODE_ENV === 'test' || req.path === '/health',
    }),
  );

  // Trace ID across all routes (AI→audit→submission)
  app.use(traceMiddleware());

  app.use(express.json({ limit: '10mb' }));

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
   * GET /health — liveness
   */
  app.get('/health', (_req, res) => {
    res.status(200).json({
      ok: true,
      liveness: 'up',
      service: 'miljobeslut-secure-backend',
      version: process.env.npm_package_version ?? 'unknown',
      ts: new Date().toISOString(),
    });
  });

  /**
   * GET /ready — readiness
   */
  app.get('/ready', async (_req, res) => {
    try {
      const payload = await getReadinessPayload();
      res.status(payload.ok ? 200 : 503).json({
        ...payload,
        service: 'miljobeslut-secure-backend',
        version: process.env.npm_package_version ?? 'unknown',
        ts: new Date().toISOString(),
      });
    } catch (err) {
      logger.error('Readiness check failed', { err: String(err) });
      res.status(503).json({
        ok: false,
        service: 'miljobeslut-secure-backend',
        error: 'readiness_internal_error',
        ts: new Date().toISOString(),
      });
    }
  });

  app.use(internalBackgroundRouter);

  // CSRF-skydd
  app.use(csrfProtection);

  app.get('/api/csrf-token', (req, res) => {
    res.json({ csrfToken: res.locals.csrfToken });
  });

  // Core & Document Domain
  app.use(coreRouter);
  app.use(documentRouter);
  app.use(requirementsRouter);
  app.use(classificationReviewRouter);
  app.use(pdfExportRouter);
  // Enskilt avlopp: canonical CRUD/export före legacy submit/signatur-routes
  app.use(sewageApplicationsRouter);
  app.use(sewageLegacyAliasRouter);
  app.use(sewageDocumentRouter);
  app.use(cNotificationMassRouter);
  app.use(hydroRouter);
  app.use(propertyLookupRouter);
  app.use(bankComplianceRouter);
  app.use(erpSyncRouter);

  // Legacy alias for Prometheus metrics
  app.get('/metrics', async (_req, res, next) => {
    try {
      const { getMetricsText } = await import('./services/metricsService');
      const metrics = await getMetricsText();
      res.type('text/plain').send(metrics);
    } catch (error) {
      next(error);
    }
  });

  // GIS & Legal Domain
  app.use(gisRouter);
  app.use(geodataRouter);
  app.use(geoRouter);
  app.use(localizationRouter);
  app.use(legalRouter);

  // Refactored V1 Routes
  app.use(authRouter);
  app.use(projectLegacyRouter);
  app.use(projectV1Router);
  app.use(generatorsRouter);
  app.use(logisticsRouter);
  app.use(datasourceRouter);
  app.use(searchRouter);
  app.use(gdprRouter);
  app.use(referenceRouter);
  app.use(adminLegacyRouter);
  app.use(adminV1Router);

  app.use(geminiRouter);
  app.use(geminiDbRouter);

  // Global felhantering (ska ligga sist)
  app.use(secureErrorHandler);

  return app;
}
