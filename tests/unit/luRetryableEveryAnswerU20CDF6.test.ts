/**
 * W-U20CDF6 item 4 (UI1 limit 1: "Försök igen" is shown ONLY on the server's `retryable: true`, and an answer without
 * the flag loses the button) -- EVERY failure answer of the LU routes carries `retryable` explicitly, derived from its
 * class with the shared classification (readFaultClassification.ts): a read fault / a transient condition true;
 * absence, a refusal, an integrity break, a configuration error, a bad request, missing authentication false.
 *
 * The real router (server/routes/localization.routes.ts) and the app's real error handler (secureErrors.ts) answer;
 * the orchestrator functions are stubbed to return the failure shapes or throw the errors under test (the orchestrator's
 * own explicit flags are pinned in luOrchestratorReadFaultU20CDF5). The rate limiter is replaced by one that answers
 * exactly the real limiter's 429 body (server/security/rateLimit.ts: { ok: false, error: 'Rate limit exceeded' }).
 * Hermetic: no database (the guard throws), no CAS, no network. All error texts are invented.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../server/db/prisma', async () => (await import('../helpers/hermeticPrismaGuard')).hermeticPrismaModule());
vi.mock('../../server/repositories/tokenRepository', () => ({
  isTokenRevoked: vi.fn(async () => false),
  markRefreshTokenAsUsed: vi.fn(async () => undefined),
  revokeRefreshToken: vi.fn(async () => undefined),
  cleanupExpiredTokenRevocations: vi.fn(async () => 0),
}));
const h = vi.hoisted(() => ({ rateLimited: false, accessError: null as null | (() => unknown) }));
vi.mock('../../server/security/rateLimit', () => ({
  rateLimitByUser: () => (_req: unknown, res: { status: (n: number) => { json: (b: unknown) => void } }, next: () => void) => {
    if (h.rateLimited) {
      res.status(429).json({ ok: false, error: 'Rate limit exceeded' });
      return;
    }
    next();
  },
}));
vi.mock('../../server/security/projectAccess', () => ({
  assertProjectAccess: vi.fn(async () => {
    if (h.accessError) throw h.accessError();
  }),
}));
const pub = vi.hoisted(() => ({
  runLocalizationReport: vi.fn(),
  resolveLuViewerPresentation: vi.fn(),
  resolveCurrentLuAssessmentSummary: vi.fn(),
  exportCurrentLuAssessmentPdf: vi.fn(),
  verifyCurrentLuAssessment: vi.fn(),
  listProjectsForProperty: vi.fn(),
  createLocalizationProject: vi.fn(),
  getBootstrapRequestStatusForProject: vi.fn(),
  saveUserLocalizationGeometry: vi.fn(),
  getCurrentLocalizationGeometryForProject: vi.fn(),
  retryLocalizationIdentityProvisioning: vi.fn(),
  fetchLocalizationAuditTrail: vi.fn(),
}));
vi.mock('../../server/modules/localization/public', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ...Object.fromEntries(Object.entries(pub).map(([name, fn]) => [name, (...args: unknown[]) => fn(...args)])),
}));
vi.mock('../../server/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import express from 'express';
import request from 'supertest';
import { createTokenPair } from '../../server/security/auth';
import { secureErrorHandler } from '../../server/security/secureErrors';
import localizationRoutes, { luFailureRetryable } from '../../server/routes/localization.routes';
import { LocalizationDataUnavailableError } from '../../server/modules/localization/localizationOrchestrator';
import { ProjectAccessDeniedError } from '../../server/repositories/projectAccessRepository';

const app = express();
app.use(express.json());
app.use(localizationRoutes);
// Outside the LU router's paths: its answers are not touched.
app.get('/api/other-surface', (_req, res) => {
  res.status(404).json({ ok: false, error: 'not here' });
});
app.use(secureErrorHandler);

const token = createTokenPair({ id: 'user-u20cdf6', organisationId: 'org-u20cdf6', bankidId: 'bankid:u20cdf6', role: 'CONSULTANT' }).accessToken;
const P = 'project-u20cdf6';
const get = (path: string) => request(app).get(path).set('Authorization', `Bearer ${token}`);
const post = (path: string, body: unknown = {}) => request(app).post(path).set('Authorization', `Bearer ${token}`).send(body as object);

class CASIntegrityError extends Error {
  constructor() {
    super('content hash mismatch at C:\\cas\\objects\\ab');
    this.name = 'CASIntegrityError';
  }
}
const prismaDown = () => Object.assign(new Error("Can't reach database server at db.internal:5432"), { name: 'PrismaClientInitializationError' });
const unknownBug = () => new TypeError("Cannot read properties of undefined (reading 'x')");

/** One request per LU route: [name, the stub that answers it (null: the route reads the database itself), method, path, body]. */
const ROUTES: ReadonlyArray<readonly [string, keyof typeof pub | null, 'GET' | 'POST', string, unknown]> = [
  ['POST generate-report', 'runLocalizationReport', 'POST', '/api/localization/generate-report', { projectId: P, siteAlternatives: [] }],
  ['POST generate-pdf-data', 'runLocalizationReport', 'POST', '/api/localization/generate-pdf-data', { projectId: P, siteAlternatives: [] }],
  ['GET audit-trail', 'fetchLocalizationAuditTrail', 'GET', `/api/localization/${P}/audit-trail`, undefined],
  ['GET property-projects', 'listProjectsForProperty', 'GET', '/api/localization/property-projects?propertyDesignation=X%201%3A1', undefined],
  ['POST localization-projects', 'createLocalizationProject', 'POST', '/api/localization/localization-projects', { propertyDesignation: 'X 1:1', name: 'n' }],
  ['GET bootstrap-status', 'getBootstrapRequestStatusForProject', 'GET', `/api/localization/${P}/bootstrap-status`, undefined],
  ['POST bootstrap-retry', null, 'POST', `/api/localization/${P}/bootstrap-retry`, {}],
  ['GET viewer/evidence', 'resolveLuViewerPresentation', 'GET', `/api/localization/${P}/viewer/evidence`, undefined],
  ['GET current-assessment', 'resolveCurrentLuAssessmentSummary', 'GET', `/api/localization/${P}/current-assessment`, undefined],
  ['GET export-assessment-pdf', 'exportCurrentLuAssessmentPdf', 'GET', `/api/localization/${P}/export-assessment-pdf`, undefined],
  ['POST verify-assessment', 'verifyCurrentLuAssessment', 'POST', `/api/localization/${P}/verify-assessment`, {}],
  ['GET geometry', 'getCurrentLocalizationGeometryForProject', 'GET', `/api/localization/${P}/geometry`, undefined],
  ['POST geometry', 'saveUserLocalizationGeometry', 'POST', `/api/localization/${P}/geometry`, { geometry_type: 'POINT', coordinates: [17, 60], srid: 4326 }],
  ['POST geometry-identity-retry', 'retryLocalizationIdentityProvisioning', 'POST', `/api/localization/${P}/geometry-identity-retry`, {}],
];
function send(method: 'GET' | 'POST', path: string, body: unknown, authenticated = true) {
  const req = method === 'GET' ? request(app).get(path) : request(app).post(path);
  const withAuth = authenticated ? req.set('Authorization', `Bearer ${token}`) : req;
  return method === 'POST' ? withAuth.send((body ?? {}) as object) : withAuth;
}
/** The routes whose repeat after an unknown failure could act twice (create or move something): never promised. */
const NON_REPEATABLE = new Set(['POST localization-projects', 'POST bootstrap-retry', 'POST geometry', 'POST geometry-identity-retry']);

beforeEach(() => {
  h.rateLimited = false;
  h.accessError = null;
  for (const fn of Object.values(pub)) fn.mockReset();
});

function throwing(stub: keyof typeof pub | null, error: () => unknown) {
  if (stub) pub[stub].mockImplementation(async () => { throw error(); });
}

describe('W-U20CDF6 item 4: every failure answer of the LU routes carries retryable, explicitly, from its class', () => {
  for (const [name, stub, method, path, body] of ROUTES) {
    const call = () => send(method, path, body);
    it(`${name}: missing authentication (401) -> false; the rate limit (429) -> true`, async () => {
      const unauthenticated = await send(method, path, body, false);
      expect(unauthenticated.status).toBe(401);
      expect(unauthenticated.body.retryable).toBe(false);
      h.rateLimited = true;
      const limited = await call();
      expect(limited.status).toBe(429);
      expect(limited.body).toEqual({ ok: false, error: 'Rate limit exceeded', retryable: true });
    });

    it(`${name}: an unknown failure while serving it (sanitized 500) -> ${NON_REPEATABLE.has(name) ? 'false (a repeat could act twice)' : 'true (a read of unknown persistence)'}`, async () => {
      throwing(stub, prismaDown);
      const res = await call();
      expect(res.status, JSON.stringify(res.body)).toBe(500);
      expect(res.body.retryable).toBe(!NON_REPEATABLE.has(name));
      throwing(stub, unknownBug);
      const bug = await call();
      expect(bug.status).toBe(500);
      expect(typeof bug.body.retryable).toBe('boolean');
    });

    if (stub) {
      it(`${name}: a lasting storage fault behind the sanitized 500 is never retryable`, async () => {
        throwing(stub, () => new CASIntegrityError());
        const res = await call();
        expect(res.status).toBe(500);
        expect(res.body.retryable).toBe(false);
      });
    }
  }

  it('LOCALIZATION_DATA_UNAVAILABLE (503): the data sources are unavailable for now -- retryable true, explicitly', async () => {
    throwing('runLocalizationReport', () => new LocalizationDataUnavailableError('För många datakällor var otillgängliga.'));
    for (const path of ['/api/localization/generate-report', '/api/localization/generate-pdf-data']) {
      const res = await post(path, { projectId: P, siteAlternatives: [] });
      expect(res.status).toBe(503);
      expect(res.body).toMatchObject({ ok: false, code: 'LOCALIZATION_DATA_UNAVAILABLE', retryable: true });
    }
  });

  it('a plain failure without a flag: 4xx (absence, refusal, integrity, bad request) -> false; a 5xx of the shared read-fault class READ_ERROR -> true', async () => {
    const cases: ReadonlyArray<readonly [Record<string, unknown>, boolean]> = [
      [{ ok: false, status: 404, error: 'Governed viewer capability is not configured for this project.' }, false],
      [{ ok: false, status: 424, error: 'Governed LU assessment failed tamper verification.' }, false],
      [{ ok: false, status: 409, error: 'x', code: 'ASSESSMENT_ID_MISMATCH', failureClass: 'ASSESSMENT_NOT_CURRENT' }, false],
      [{ ok: false, status: 400, error: 'projectId required' }, false],
      [{ ok: false, status: 503, error: 'x', code: 'SOME_CODE', failureClass: 'READ_ERROR' }, true],
      [{ ok: false, status: 503, error: 'x', code: 'SOME_CODE', failureClass: 'STORAGE_INTEGRITY_FAULT' }, false],
      [{ ok: false, status: 503, error: 'x', code: 'SOME_CODE', failureClass: 'MISSING_FROM_CAS' }, false],
      [{ ok: false, status: 409, error: 'x', code: 'SOME_CODE', failureClass: 'REFUSED' }, false],
    ];
    for (const [result, expected] of cases) {
      pub.resolveLuViewerPresentation.mockResolvedValueOnce(result);
      const res = await get(`/api/localization/${P}/viewer/evidence`);
      expect(res.status, JSON.stringify(result)).toBe(result.status);
      expect(res.body.retryable, JSON.stringify(result)).toBe(expected);
    }
  });

  it('an answer that states its flag keeps it -- never overridden by the derivation', async () => {
    pub.resolveCurrentLuAssessmentSummary.mockResolvedValueOnce({ ok: false, status: 503, error: 'x', code: 'C', failureClass: 'READ_ERROR', retryable: false });
    expect((await get(`/api/localization/${P}/current-assessment`)).body.retryable).toBe(false);
    pub.resolveCurrentLuAssessmentSummary.mockResolvedValueOnce({ ok: false, status: 404, error: 'x', retryable: true });
    expect((await get(`/api/localization/${P}/current-assessment`)).body.retryable).toBe(true);
  });

  it('the routes own answers: a bad id, missing parameters, no bootstrap request, a denial -- false, explicitly', async () => {
    const badId = await get(`/api/localization/${P}/export-assessment-pdf?assessmentArtifactId=${encodeURIComponent('a b')}`);
    expect(badId.status).toBe(400);
    expect(badId.body).toMatchObject({ code: 'INVALID_ASSESSMENT_ARTIFACT_ID', retryable: false });
    const noDesignation = await get('/api/localization/property-projects');
    expect(noDesignation.status).toBe(400);
    expect(noDesignation.body.retryable).toBe(false);
    const noName = await post('/api/localization/localization-projects', { propertyDesignation: 'X 1:1' });
    expect(noName.status).toBe(400);
    expect(noName.body.retryable).toBe(false);
    pub.getBootstrapRequestStatusForProject.mockResolvedValueOnce(null);
    const none = await get(`/api/localization/${P}/bootstrap-status`);
    expect(none.status).toBe(404);
    expect(none.body).toEqual({ ok: false, error: 'No bootstrap request exists for this project.', retryable: false });
    h.accessError = () => new ProjectAccessDeniedError('User is not a member of this project');
    const denied = await get(`/api/localization/${P}/bootstrap-status`);
    expect(denied.status).toBe(403);
    expect(denied.body).toEqual({ ok: false, error: 'Not authorized for this project.', retryable: false });
  });

  it('a successful answer gets no flag, and an answer outside the LU router is untouched', async () => {
    pub.getBootstrapRequestStatusForProject.mockResolvedValueOnce({ status: 'PENDING', id: 'r1' });
    const ok = await get(`/api/localization/${P}/bootstrap-status`);
    expect(ok.status).toBe(200);
    expect(ok.body).not.toHaveProperty('retryable');
    const other = await request(app).get('/api/other-surface');
    expect(other.status).toBe(404);
    expect(other.body).toEqual({ ok: false, error: 'not here' });
  });
});

describe('W-U20CDF6 item 4: luFailureRetryable (pure)', () => {
  const at = (status: number, body: Record<string, unknown> = {}, method = 'GET', path = `/api/localization/${P}/current-assessment`, caughtError?: unknown) =>
    luFailureRetryable({ method, path, status, body, caughtError });
  it('the answer flag wins; then the shared class; then 429 true, 4xx false; a 5xx from the caught error class, false on a non-repeatable POST', () => {
    expect(at(503, { retryable: false, failureClass: 'READ_ERROR' })).toBe(false);
    expect(at(404, { retryable: true })).toBe(true);
    expect(at(503, { failureClass: 'READ_ERROR' })).toBe(true);
    for (const failureClass of ['STORAGE_INTEGRITY_FAULT', 'MISSING_FROM_CAS', 'BINDING_INDEX_INCONSISTENT', 'REFUSED']) expect(at(503, { failureClass })).toBe(false);
    expect(at(429)).toBe(true);
    for (const status of [400, 401, 403, 404, 409, 422, 424]) expect(at(status), String(status)).toBe(false);
    expect(at(500, {}, 'GET', undefined, prismaDown())).toBe(true);
    expect(at(500, {}, 'GET', undefined, new CASIntegrityError())).toBe(false);
    expect(at(500, {}, 'GET', undefined, new Error('Artifact not found: x'))).toBe(false);
    expect(at(500, {}, 'GET', undefined, undefined)).toBe(true);
    for (const path of ['/api/localization/localization-projects', `/api/localization/${P}/bootstrap-retry`, `/api/localization/${P}/geometry`, `/api/localization/${P}/geometry-identity-retry`]) {
      expect(at(500, {}, 'POST', path, prismaDown()), path).toBe(false);
      expect(at(500, {}, 'post', path, prismaDown()), path).toBe(false);
    }
    for (const path of ['/api/localization/generate-report', `/api/localization/${P}/verify-assessment`]) expect(at(500, {}, 'POST', path, prismaDown()), path).toBe(true);
    // A read of the same path is repeatable (GET geometry).
    expect(at(500, {}, 'GET', `/api/localization/${P}/geometry`, prismaDown())).toBe(true);
  });
});
