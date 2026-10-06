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
import organisationRouter from './routes/organisation.routes';
import generatorsRouter from './routes/generators.routes';
import logisticsRouter from './routes/logistics.routes';
import geminiRouter from './geminiApi.express';
import geminiDbRouter from './geminiDbApi.express';
import coreRouter from './coreApi.express';
import gisRouter from './routes/gis.routes';
import geodataRouter from './routes/geodata.routes';
import geoRouter from './routes/geo.routes';
import legalRouter from './routes/legal.routes';
import legalRetrievalRouter from './routes/legalRetrieval.routes';
import legalAnswerRouter from './routes/legalAnswer.routes';
import localizationRouter from './routes/localization.routes';
import documentRouter from './routes/document.routes';
import requirementsRouter from './routes/requirements.routes';
import classificationReviewRouter from './routes/classification-review.routes';
import sewageDocumentRouter from './routes/sewage.routes';
import sewageApplicationsRouter from './routes/sewage.applications.routes';
import sewageLegacyAliasRouter from './routes/sewage.legacy-alias.routes';
import { governanceRouter } from './routes/governance.routes';

import cNotificationMassRouter from './routes/cNotificationMass.routes';
import hydroRouter from './routes/hydro.routes';
import tilesRouter from './routes/tiles.routes';
import pdfExportRouter from './routes/pdf-export.routes';
import erpSyncRouter from './routes/erpSync.routes';
import searchRoutes from './routes/searchRoutes';
import recommendationRoutes from './routes/recommendationRoutes';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import compression from 'compression';
import { traceMiddleware } from './observability/trace';
import { requestLogger } from './security/requestLogging';
import { propertyLookupRouter } from './integrations/propertyLookup';
import { initializeSentry } from './sentry';
import { logger } from './logger';
import { csrfProtection } from './security/csrf';
import { secureErrorHandler } from './security/secureErrors';
import internalBackgroundRouter from './routes/internal.background.routes';
import { getReadinessPayload } from './services/readinessService';
import aiRouter from './routes/ai.routes';
import { handleMetricsRequest } from './security/metricsAccess';
import { isLegacyRoutesEnabled } from './security/legacyRoutes';

export function createApp() {
  const app = express();

  if (process.env.NODE_ENV === 'production') {
    app.set('trust proxy', 1);
  }

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
  app.use(requestLogger);

  app.use(compression());
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
  // PRODUCT-UI-LEGACY-ISOLATION-01: sewage/enskilt-avlopp (all three routers -- the
  // "canonical CRUD/export" comment on sewageApplicationsRouter describes an intended
  // architecture, not current reachability: traced 2026-08-23, zero client callers exist
  // anywhere in the app, canonical or legacy) and c-notification-mass are out of the frozen
  // LU+admin-console RC1 scope. A valid bearer token must not be enough to reach them --
  // mounting itself is now gated by an explicit, server-owned policy, never by
  // uiConfig.enableLegacyUi (client/Vite config is not a security boundary).
  if (isLegacyRoutesEnabled()) {
    app.use(sewageApplicationsRouter);
    app.use(sewageLegacyAliasRouter);
    app.use(sewageDocumentRouter);
    app.use(cNotificationMassRouter);
  }
  app.use(hydroRouter);
  app.use(tilesRouter);
  app.use(propertyLookupRouter);
  // POST /api/projects/:projectId/bank-compliance-index -- retired (W3b, C1/OD-04).
  // MAP-2-SEMANTICS.md Delta 2026-09-28: "Bank-endpointen ska avvecklas; den ska inte göras till
  // governed beslutsmotor." generateBankComplianceIndex() called evaluateComplianceRules with
  // permanently hardcoded empty inputs -- structurally unable to ever raise a flag -- with zero
  // frontend consumers anywhere. The underlying bankComplianceService.ts is left in place as
  // unreferenced, forward-only dead code (no other caller exists), per the established
  // no-drive-by-cleanup norm -- only the route registration that made it reachable is removed here.
  app.use(erpSyncRouter);

  // Legacy alias for Prometheus metrics (bearer token or localhost only)
  app.get('/metrics', handleMetricsRequest);

  // GIS & Legal Domain
  app.use(gisRouter);
  app.use(geodataRouter);
  app.use(geoRouter);
  app.use(localizationRouter);
  app.use(legalRouter);
  app.use(legalRetrievalRouter);
  app.use(legalAnswerRouter);
  app.use('/api/governance', governanceRouter);

  // Refactored V1 Routes
  app.use(authRouter);
  app.use(organisationRouter);
  app.use(projectLegacyRouter);
  app.use(projectV1Router);
  // PRODUCT-UI-LEGACY-ISOLATION-01: zero client callers found anywhere in the app; see
  // isLegacyRoutesEnabled() above.
  if (isLegacyRoutesEnabled()) {
    app.use(generatorsRouter);
    app.use(logisticsRouter);
  }
  app.use(datasourceRouter);
  app.use(searchRouter);
  app.use(searchRoutes);
  app.use(recommendationRoutes);
  app.use(aiRouter);
  app.use(gdprRouter);
  app.use(referenceRouter);
  app.use(adminLegacyRouter);
  app.use(adminV1Router);

  app.use(geminiRouter);
  app.use(geminiDbRouter);

  // Interactions prototype (Gemini) is retired and is not mounted.

  // Global felhantering (ska ligga sist)
  app.use(secureErrorHandler);

  return app;
}
