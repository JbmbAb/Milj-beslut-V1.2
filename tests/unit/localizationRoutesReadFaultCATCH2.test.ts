/**
 * W-CATCH2: the LU routes' answers to a failed read (owner decisions 2026-10-02/03, OD-R2: a read error
 * is a technical error, never "missing" or "not authorized"; no raw text reaches the client).
 *
 *  - #13: GET viewer/evidence answers a typed LuReadFaultError (a capability or the current binding that
 *    could not be read or verified) with 503/409 VIEWER_CAPABILITY_UNRESOLVED, failureClass, retryable --
 *    never a generic 500 or a 404.
 *  - #14: bootstrap-status / bootstrap-retry answer 403 only for the access check's own typed denial; a
 *    failure to READ the access facts (database down) is 503 PROJECT_ACCESS_UNRESOLVED, retryable.
 *  - #4: bootstrap-status never sends the stored failureDetail as such (old rows can hold raw storage
 *    paths or SQL): a FAILED request is presented with the Swedish text of its stable failureCode and a
 *    `retryable` derived deterministically from that code; every other status is sent unchanged.
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
  assertProjectAccess: vi.fn(async () => undefined),
  getBootstrapRequestStatusForProject: vi.fn(),
  enqueueProjectContextBootstrapRequest: vi.fn(),
}));

vi.mock('../../server/db/prisma', async () => (await import('../helpers/hermeticPrismaGuard')).hermeticPrismaModule());
vi.mock('../../server/repositories/tokenRepository', () => ({
  isTokenRevoked: vi.fn(async () => false),
  markRefreshTokenAsUsed: vi.fn(async () => undefined),
  revokeRefreshToken: vi.fn(async () => undefined),
  cleanupExpiredTokenRevocations: vi.fn(async () => 0),
}));
vi.mock('../../server/security/projectAccess', () => ({ assertProjectAccess: h.assertProjectAccess }));
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
    enqueueProjectContextBootstrapRequest: h.enqueueProjectContextBootstrapRequest,
    getBootstrapRequestStatusForProject: h.getBootstrapRequestStatusForProject,
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
  h.assertProjectAccess.mockImplementation(async () => undefined);
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

/** The access check's own typed denial (server/repositories/projectAccessRepository.ts ProjectAccessDeniedError). */
const denial = (message: string) => Object.assign(new Error(message), { code: 'PROJECT_ACCESS_DENIED', name: 'ProjectAccessDeniedError' });
const dbDown = () =>
  Object.assign(new Error("Invalid `prisma.project.findUnique()` invocation: Can't reach database server at 10.0.0.5:5432 (SELECT * FROM projects)"), {
    name: 'PrismaClientInitializationError',
    errorCode: 'P1001',
  });

describe('W-CATCH2 #14: the bootstrap routes answer 403 only for a real denial; a failed access READ is a technical 503', () => {
  for (const [route, call] of [
    ['GET bootstrap-status', () => request(app).get('/api/localization/proj-1/bootstrap-status').set('Authorization', authHeader())],
    ['POST bootstrap-retry', () => request(app).post('/api/localization/proj-1/bootstrap-retry').set('Authorization', authHeader()).send({})],
  ] as const) {
    for (const message of ['User is not a member of this project', 'Cross-organisation access denied', 'Project is not active', 'Project not found']) {
      it(`${route}: the typed denial "${message}" -> 403 (unchanged)`, async () => {
        h.assertProjectAccess.mockRejectedValueOnce(denial(message));
        const res = await call();
        expect(res.status).toBe(403);
        expect(res.body).toEqual({ ok: false, error: 'Not authorized for this project.' });
      });
    }
    it(`${route}: the access facts cannot be read (database down) -> 503 PROJECT_ACCESS_UNRESOLVED, retryable, never 403`, async () => {
      h.assertProjectAccess.mockRejectedValueOnce(dbDown());
      const res = await call();
      expect(res.status).toBe(503);
      expect(res.body).toEqual({
        ok: false,
        error: expect.stringMatching(/^Behörigheten till projektet kunde inte läsas \(tekniskt fel\)\. Ett nytt försök kan lyckas\./),
        code: 'PROJECT_ACCESS_UNRESOLVED',
        failureClass: 'READ_ERROR',
        reasonCode: 'READ_ERROR',
        retryable: true,
      });
      expect(JSON.stringify(res.body)).not.toMatch(/prisma|10\.0\.0\.5|SELECT|P1001/);
      expect(h.getBootstrapRequestStatusForProject).not.toHaveBeenCalled();
      expect(h.enqueueProjectContextBootstrapRequest).not.toHaveBeenCalled();
    });
  }
});

describe('W-CATCH2 #4: bootstrap-status presents a FAILED request by its stable code -- never the stored text', () => {
  const base = {
    id: 'req-1', projectId: 'proj-1', requestedByUserId: 'user-1', propertyDesignation: 'GÄVLE 1:1',
    contextBindingArtifactId: null, createdAt: '2026-10-02T10:00:00.000Z', leasedAt: null, leaseExpiresAt: null, completedAt: null,
  };
  const failed = (failureCode: string | null, failureDetail: unknown) => ({ ...base, status: 'FAILED', failureCode, failureDetail, failedAt: '2026-10-02T10:01:00.000Z' });
  const RAW_DETAIL = "ENOENT: no such file or directory, open 'D:\\mimer-demo\\cas\\artifact-id-index\\4b6f.idx' / SELECT * FROM project_context_bindings";
  const UNKNOWN = 'Lokaliseringen kunde inte etableras (okänd felkod). Felet beskrivs inte närmare här.';

  const presented: Array<[string, boolean]> = [
    ['BOOTSTRAP_EXECUTION_ERROR', true],
    ['BOOTSTRAP_STORAGE_INTEGRITY_FAULT', false],
    ['BOOTSTRAP_REFUSED', false],
    ['CURRENT_BINDING_READ_ERROR', true],
    ['CURRENT_BINDING_INTEGRITY_FAULT', false],
    ['CURRENT_BINDING_REFUSED', false],
    ['PROPERTY_LOOKUP_AMBIGUOUS', false],
    ['LOCAL_PROPERTY_NOT_FOUND', false],
    ['PROJECT_NOT_FOUND', false],
    ['FRESH_VERIFICATION_FAILED', true],
  ];
  for (const [failureCode, retryable] of presented) {
    it(`${failureCode} -> its own Swedish text, retryable ${retryable}; the stored text never leaves the server`, async () => {
      h.getBootstrapRequestStatusForProject.mockResolvedValueOnce(failed(failureCode, RAW_DETAIL));
      const res = await request(app).get('/api/localization/proj-1/bootstrap-status').set('Authorization', authHeader());
      expect(res.status).toBe(200);
      expect(res.body.status).toEqual({ ...failed(failureCode, expect.any(String)), retryable });
      expect(res.body.status.failureDetail).not.toBe(UNKNOWN);
      expect(res.body.status.failureDetail).toMatch(/^[A-ZÅÄÖ]/);
      expect(JSON.stringify(res.body)).not.toMatch(/ENOENT|mimer-demo|SELECT|\.idx/);
    });
  }

  it('an unknown (legacy) code -> a neutral Swedish text, retryable false (no class is known, so no retry is promised)', async () => {
    h.getBootstrapRequestStatusForProject.mockResolvedValueOnce(failed('SOMETHING_FROM_AN_OLDER_WORKER', RAW_DETAIL));
    const res = await request(app).get('/api/localization/proj-1/bootstrap-status').set('Authorization', authHeader());
    expect(res.body.status.retryable).toBe(false);
    expect(res.body.status.failureDetail).toBe(UNKNOWN);
  });

  it('a FAILED row without a code -> the same neutral text, retryable false', async () => {
    h.getBootstrapRequestStatusForProject.mockResolvedValueOnce(failed(null, RAW_DETAIL));
    const res = await request(app).get('/api/localization/proj-1/bootstrap-status').set('Authorization', authHeader());
    expect(res.body.status).toEqual({ ...failed(null, UNKNOWN), retryable: false });
  });

  for (const status of ['PENDING', 'LEASED']) {
    it(`a ${status} request is sent unchanged (no retryable field, no rewritten detail)`, async () => {
      const row = { ...base, status, failureCode: null, failureDetail: null, failedAt: null };
      h.getBootstrapRequestStatusForProject.mockResolvedValueOnce(row);
      const res = await request(app).get('/api/localization/proj-1/bootstrap-status').set('Authorization', authHeader());
      expect(res.body).toEqual({ ok: true, status: row });
    });
  }
});
