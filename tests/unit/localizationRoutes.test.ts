import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTokenPair } from '../../server/security/auth';

// U20-C: hermetic. The real database client is never evaluated, and the governed run has no
// spatial runtime here (it ends as EXECUTION_FAILED), so no pool is ever created.
vi.mock('../../server/db/prisma', async () => (await import('../helpers/hermeticPrismaGuard')).hermeticPrismaModule());
vi.mock('../../server/modules/localization/createLocalizationSpatialRuntime', () => ({
  createLocalizationSpatialRuntime: vi.fn(async () => {
    throw new Error('NO_SPATIAL_RUNTIME_IN_THIS_TEST');
  }),
}));

vi.mock('../../server/repositories/tokenRepository', () => ({
  isTokenRevoked: vi.fn(async () => false),
  markRefreshTokenAsUsed: vi.fn(async () => undefined),
  revokeRefreshToken: vi.fn(async () => undefined),
  cleanupExpiredTokenRevocations: vi.fn(async () => 0),
}));

vi.mock('../../server/security/projectAccess', () => ({
  assertProjectAccess: vi.fn(async () => undefined),
}));

const spatialMock = {
  protectedAreaHits: [],
  protectedAreaAvailable: true,
  isProtected: false,
  sgu: {
    coverageMode: 'complete' as const,
    manualReviewRequired: false,
    riskLevel: 'LOW' as const,
    groundLayer: {
      intersects: false,
      hit: null,
      advisory: 'Ingen träff',
    },
    landslideFeatures: {
      nearby: false,
      bufferMeters: 500,
      nearestDistanceMeters: null,
      hits: [],
      advisory: 'Inga skred i närheten',
    },
    flags: [],
    summary: 'SGU: låg risk (test)',
  },
  distanceToWaterMeters: 180,
  distanceToWaterAvailable: true,
  text: 'Test spatial audit',
  sources: [{ web: { title: 'SGU', uri: 'https://www.sgu.se' } }],
};

vi.mock('../../server/services/spatialAuditService', () => ({
  runSpatialAudit: vi.fn(async () => spatialMock),
}));

vi.mock('../../server/services/nvrService', () => ({
  fetchProtectedAreas: vi.fn(async () => [{ id: 'nvr-1', name: 'Testreservat', type: 'Naturreservat' }]),
}));

vi.mock('../../server/services/raaService', () => ({
  fetchAncientMonuments: vi.fn(async () => [
    { id: 'raa-1', name: 'Fornlämning', type: 'Fornlämning', distance: 450 },
  ]),
}));

vi.mock('../../server/services/vissService', () => ({
  queryVissPoint: vi.fn(async () => ({
    ok: true,
    primaryWaterStatus: { waterName: 'Testsjön', ecologicalStatus: 'Good', chemicalStatus: 'Good' },
  })),
}));

vi.mock('../../server/services/sluService', () => ({
  searchSluByCoordinates: vi.fn(async () => ({
    observations: [{ taxonName: 'Fröslända', redlistCategory: 'LC' }],
  })),
}));

vi.mock('../../server/services/pdfExportService', () => ({
  buildJsonPdfBuffer: vi.fn(async () => Buffer.from('%PDF-1.4 localization-test')),
}));

vi.mock('../../server/services/auditTrailService', () => ({
  auditTrail: { logAction: vi.fn(async () => ({ id: 'audit-loc-1' })) },
  getAuditTrail: vi.fn(async () => [
    { id: 'audit-loc-1', action: 'GIS_ANALYSIS_COMPLETED', timestamp: new Date().toISOString() },
  ]),
}));

import localizationRoutes from '../../server/routes/localization.routes';
import { fetchProtectedAreas } from '../../server/services/nvrService';
import { fetchAncientMonuments } from '../../server/services/raaService';
import { queryVissPoint } from '../../server/services/vissService';
import { searchSluByCoordinates } from '../../server/services/sluService';

const app = express();
app.use(express.json());
app.use(localizationRoutes);

function authHeader() {
  return `Bearer ${
    createTokenPair({
      id: 'user-1',
      organisationId: 'org-1',
      bankidId: 'bankid-user-1',
      role: 'ADMIN',
    }).accessToken
  }`;
}

const validBody = {
  projectId: 'proj-loc-1',
  siteAlternatives: [{ id: 'ALT-1', name: 'Plats A', lat: 59.33, lng: 18.06 }],
};

describe('localization.routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.LOCALIZATION_STRICT_SOURCES;
  });

  afterEach(() => {
    delete process.env.LOCALIZATION_STRICT_SOURCES;
  });

  it('returns 401 without auth on generate-report', async () => {
    const res = await request(app).post('/api/localization/generate-report').send(validBody);
    expect(res.status).toBe(401);
  });

  it('returns 400 when siteAlternatives missing', async () => {
    const res = await request(app)
      .post('/api/localization/generate-report')
      .set('Authorization', authHeader())
      .send({ projectId: 'proj-loc-1' });
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  it('generates the governed report envelope without any older, ungoverned observation (U20-C, DP-04)', async () => {
    const res = await request(app)
      .post('/api/localization/generate-report')
      .set('Authorization', authHeader())
      .send(validBody);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.projectId).toBe('proj-loc-1');
    expect(res.body.siteAnalyses).toHaveLength(1);
    expect(res.body.siteAnalyses[0].executionMotor.assessment_status).toBe('EXECUTION_FAILED');
    expect(res.body.siteAnalyses[0]).not.toHaveProperty('dataSources');
    expect(res.body.siteAnalyses[0]).not.toHaveProperty('legacyObservations');
    expect(fetchProtectedAreas).not.toHaveBeenCalled();
    expect(res.body.humanInTheLoop).toContain('Human in the loop');
  });

  it('generate-pdf-data still carries the older observations, labelled as not governed (U20-C)', async () => {
    const res = await request(app)
      .post('/api/localization/generate-pdf-data')
      .set('Authorization', authHeader())
      .send(validBody);
    expect(res.status).toBe(200);
    expect(res.body.pdfData.governance_note_sv).toMatch(/inte är styrd evidens/);
    expect(res.body.pdfData.sites[0].dataSources).toEqual(
      expect.arrayContaining([expect.objectContaining({ source: 'NVR API', status: 'ok' })]),
    );
  });

  it('returns audit trail for project', async () => {
    const res = await request(app)
      .get('/api/localization/proj-loc-1/audit-trail')
      .set('Authorization', authHeader());
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.referenceNumber).toBe('LOK-proj-loc-1');
    expect(res.body.entries).toHaveLength(1);
  });

  it('W3a: export-pdf has been retired (D-P5-5/Q3) -- no longer registered, returns 404', async () => {
    const res = await request(app)
      .post('/api/localization/export-pdf')
      .set('Authorization', authHeader())
      .send(validBody);
    expect(res.status).toBe(404);
  });

  // U20-C: this case used to assert a 503 (LOCALIZATION_DATA_UNAVAILABLE). The older sources no
  // longer gate anything: strict mode with every one of them down is an ordinary 200 whose
  // governed outcome is carried per site in executionMotor.
  it('strict mode with every older source down -> 200 on both routes, never 503 (U20-C)', async () => {
    process.env.LOCALIZATION_STRICT_SOURCES = 'true';
    for (const path of ['/api/localization/generate-report', '/api/localization/generate-pdf-data']) {
      vi.mocked(fetchProtectedAreas).mockRejectedValueOnce(new Error('NVR down'));
      vi.mocked(fetchAncientMonuments).mockRejectedValueOnce(new Error('RAA down'));
      vi.mocked(queryVissPoint).mockRejectedValueOnce(new Error('VISS down'));
      vi.mocked(searchSluByCoordinates).mockRejectedValueOnce(new Error('SLU down'));

      const res = await request(app).post(path).set('Authorization', authHeader()).send(validBody);
      expect(res.status).toBe(200);
      expect(res.body.code).toBeUndefined();
      expect(JSON.stringify(res.body)).not.toMatch(/NVR down|RAA down|VISS down|SLU down/);
    }
  });
});
