/**
 * W-CATCH2: the LU routes' answers to a failed read (owner decisions 2026-10-02/03, OD-R2: a read error
 * is a technical error, never "missing" or "not authorized"; no raw text reaches the client).
 *
 *  - #13: GET viewer/evidence answers a typed LuReadFaultError (a capability or the current binding that
 *    could not be read or verified) with 503/409 VIEWER_CAPABILITY_UNRESOLVED, failureClass, retryable --
 *    never a generic 500 or a 404.
 *
 * Hermetic: the module barrel the routes call is replaced (the real handlers are tested elsewhere);
 * server/db/prisma is the hermetic guard; tokens are minted locally.
 */
import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTokenPair } from '../../server/security/auth';

const h = vi.hoisted(() => ({
  resolveLuViewerPresentation: vi.fn(),
}));

vi.mock('../../server/db/prisma', async () => (await import('../helpers/hermeticPrismaGuard')).hermeticPrismaModule());
vi.mock('../../server/repositories/tokenRepository', () => ({
  isTokenRevoked: vi.fn(async () => false),
  markRefreshTokenAsUsed: vi.fn(async () => undefined),
  revokeRefreshToken: vi.fn(async () => undefined),
  cleanupExpiredTokenRevocations: vi.fn(async () => 0),
}));
vi.mock('../../server/security/projectAccess', () => ({ assertProjectAccess: vi.fn(async () => undefined) }));
vi.mock('../../server/modules/localization/public', () => {
  class LocalizationDataUnavailableError extends Error {
    readonly code = 'LOCALIZATION_DATA_UNAVAILABLE';
  }
  const never = (name: string) => vi.fn(async () => {
    throw new Error(`${name} is not part of this test`);
  });
  return {
    LocalizationDataUnavailableError,
    buildLocalizationPdfData: never('buildLocalizationPdfData'),
    fetchLocalizationAuditTrail: never('fetchLocalizationAuditTrail'),
    runLocalizationReport: never('runLocalizationReport'),
    resolveLuViewerPresentation: h.resolveLuViewerPresentation,
    resolveCurrentLuAssessmentSummary: never('resolveCurrentLuAssessmentSummary'),
    exportCurrentLuAssessmentPdf: never('exportCurrentLuAssessmentPdf'),
    verifyCurrentLuAssessment: never('verifyCurrentLuAssessment'),
    generateLocalizationReportLegacy: never('generateLocalizationReportLegacy'),
    listProjectsForProperty: never('listProjectsForProperty'),
    createLocalizationProject: never('createLocalizationProject'),
    enqueueProjectContextBootstrapRequest: never('enqueueProjectContextBootstrapRequest'),
    getBootstrapRequestStatusForProject: never('getBootstrapRequestStatusForProject'),
    saveUserLocalizationGeometry: never('saveUserLocalizationGeometry'),
    getCurrentLocalizationGeometryForProject: never('getCurrentLocalizationGeometryForProject'),
    retryLocalizationIdentityProvisioning: never('retryLocalizationIdentityProvisioning'),
    ensureViewerCapabilityProvisioningEnqueuedForCompletedBootstrap: never('ensureViewerCapabilityProvisioningEnqueuedForCompletedBootstrap'),
  };
});

import localizationRoutes from '../../server/routes/localization.routes';
import { LuReadFaultError, type ReadFaultClass } from '../../server/modules/localization/readFaultClassification';
import { hermeticPrismaTouches } from '../helpers/hermeticPrismaGuard';

const app = express();
app.use(express.json());
app.use(localizationRoutes);

function authHeader() {
  return `Bearer ${createTokenPair({ id: 'user-1', organisationId: 'org-1', bankidId: 'bankid-user-1', role: 'CONSULTANT' }).accessToken}`;
}

const RAW = /REJECT_|MIMERS_|Artifact not found|EIO|ECONNREFUSED|viewer-capability-|[A-Za-z]:[\\/]/;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('W-CATCH2 #13: GET viewer/evidence answers a capability that cannot be read or verified 503/409 with its own code', () => {
  const cases: Array<[string, ReadFaultClass, boolean, string | null, number]> = [
    ['viewer-capability', 'READ_ERROR', true, null, 503],
    ['viewer-capability', 'STORAGE_INTEGRITY_FAULT', false, null, 503],
    ['viewer-capability', 'MISSING_FROM_CAS', false, null, 503],
    ['viewer-capability', 'REFUSED', false, 'REJECT_VIEWER_CAPABILITY_SIGNATURE', 409],
    ['current-binding', 'READ_ERROR', true, null, 503],
    ['current-binding', 'BINDING_INDEX_INCONSISTENT', false, null, 503],
  ];
  for (const [subject, faultClass, retryable, refusalCode, status] of cases) {
    it(`${subject} ${faultClass} -> ${status} VIEWER_CAPABILITY_UNRESOLVED (retryable ${retryable})`, async () => {
      h.resolveLuViewerPresentation.mockRejectedValueOnce(
        new LuReadFaultError(subject, { faultClass, retryable, refusalCode }, Object.assign(new Error('EIO: raw C:\\cas\\x viewer-capability-123'), { code: 'EIO' })),
      );
      const res = await request(app).get('/api/localization/proj-1/viewer/evidence').set('Authorization', authHeader());
      expect(res.status).toBe(status);
      expect(res.body).toEqual({
        ok: false,
        error: expect.any(String),
        code: 'VIEWER_CAPABILITY_UNRESOLVED',
        failureClass: faultClass,
        reasonCode: refusalCode ?? subject.toUpperCase().replace(/-/g, '_'),
        retryable,
      });
      expect(res.body.error).toMatch(/^(Kartvisningens behörighet|Projektets koppling till fastigheten) /);
      expect(res.body.error).toContain('Ingen annan behörighet används i dess ställe.');
      expect(res.body.error).not.toMatch(RAW);
    });
  }

  it('the normal answer is unchanged', async () => {
    h.resolveLuViewerPresentation.mockResolvedValueOnce({ ok: true, geojson: { type: 'FeatureCollection', features: [] } });
    const res = await request(app).get('/api/localization/proj-1/viewer/evidence').set('Authorization', authHeader());
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ type: 'FeatureCollection', features: [] });
    expect(hermeticPrismaTouches).toEqual([]);
  });
});
