import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTokenPair } from '../../server/security/auth';
import { __clearMassCaseStoreForTests } from '../../server/repositories/cNotificationMassRepository';

vi.mock('../../server/repositories/tokenRepository', () => ({
  isTokenRevoked: vi.fn(async () => false),
  markRefreshTokenAsUsed: vi.fn(async () => undefined),
  revokeRefreshToken: vi.fn(async () => undefined),
  cleanupExpiredTokenRevocations: vi.fn(async () => 0),
}));

vi.mock('../../server/security/projectAccess', () => ({
  assertProjectAccess: vi.fn(async () => undefined),
}));

vi.mock('../../server/services/propertyUnitService', () => ({
  lookupPropertyByDesignationFromPostgis: vi.fn(async () => ({
    propertyDesignation: 'GÄVLE BRYNÄS 1:1',
    centroid: { lat: 60.67, lng: 17.14 },
  })),
}));

vi.mock('../../server/repositories/massFlowService', () => ({
  getMassFlowSnapshot: vi.fn(async () => ({ projectId: 'proj-1', storageAreas: [] })),
  recordMassMovement: vi.fn(async () => undefined),
}));

vi.mock('../../server/services/logisticsGeneratorService', () => ({
  generateLogisticsPlan: vi.fn(async () => ({
    id: 'log-1',
    projectId: 'proj-1',
    generatedAt: new Date().toISOString(),
    waybills: [],
    drivingLog: [],
    depots: [],
    co2Calculation: { totalKg: 0, perTon: 0 },
    externalSourcesUsed: [],
    integrationsAvailable: [],
  })),
}));

vi.mock('../../server/services/auditTrailService', () => ({
  auditTrail: {
    logAction: vi.fn(async () => ({ id: 'a1' })),
    logSubmission: vi.fn(async () => undefined),
  },
  getAuditTrail: vi.fn(async () => [{ id: 'a1', action: 'APPLICATION_SUBMITTED' }]),
}));

import cNotificationMassRoutes from '../../server/routes/cNotificationMass.routes';

const app = express();
app.use(express.json());
app.use(cNotificationMassRoutes);

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

const baseOps = {
  projectId: 'proj-1',
  propertyDesignation: 'GÄVLE BRYNÄS 1:1',
  operations: [
    {
      operationType: 'MELLANLAGRING' as const,
      ewcCode: '17 05 08',
      quantityPerYear: 12000,
      receiverName: 'Mottagare A',
      capacityM3: 5000,
      transportChain: ['Transportör X'],
    },
    {
      operationType: 'DEPONI' as const,
      ewcCode: '17 05 03*',
      quantityPerYear: 20,
      receiverName: 'Deponi B',
      capacityM3: 10000,
    },
  ],
};

describe('cNotificationMass.routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __clearMassCaseStoreForTests();
  });

  afterEach(() => {
    __clearMassCaseStoreForTests();
  });

  it('returns 401 when auth is missing', async () => {
    const res = await request(app).post('/api/c-notification/mass/validate-codes').send({});
    expect(res.status).toBe(401);
  });

  it('returns NOTIFICATION_REQUIRED for C-level EWC over threshold', async () => {
    const res = await request(app)
      .post('/api/c-notification/mass/validate-codes')
      .set('Authorization', authHeader())
      .send({
        propertyDesignation: 'GÄVLE BRYNÄS 1:1',
        operationType: 'MELLANLAGRING',
        quantityPerYear: 12000,
        ewcCode: '17 05 08',
      });

    expect(res.status).toBe(200);
    expect(res.body.gateDecision).toBe('NOTIFICATION_REQUIRED');
    expect(res.body.mpfDecision.activityCode).toBeTruthy();
    expect(res.body.mpfDecision.ewcEvaluation.code).toBe('17 05 08');
    expect(res.body.mpfDecision.requiredMapLayers.length).toBeGreaterThan(0);
    expect(res.body.mpfDecision.registryVersion).toBeTruthy();
  });

  it('gis-analysis returns deterministic vitest payload', async () => {
    const previousVitest = process.env.VITEST;
    process.env.VITEST = 'true';
    try {
      const res = await request(app)
        .post('/api/c-notification/mass/gis-analysis')
        .set('Authorization', authHeader())
        .send({ projectId: 'proj-1', propertyDesignation: 'GÄVLE BRYNÄS 1:1' });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.analysis.propertyDesignation).toBe('GÄVLE BRYNÄS 1:1');
      expect(res.body.siteProfile.recommendedZones.length).toBeGreaterThan(0);
    } finally {
      if (previousVitest === undefined) {
        delete process.env.VITEST;
      } else {
        process.env.VITEST = previousVitest;
      }
    }
  });

  it('property-search returns result', async () => {
    const res = await request(app)
      .post('/api/c-notification/mass/property-search')
      .set('Authorization', authHeader())
      .send({ projectId: 'proj-1', propertyDesignation: 'GÄVLE BRYNÄS 1:1' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('creates case with separate mellanlagring and deponi decisions', async () => {
    const res = await request(app)
      .post('/api/c-notification/mass/operations')
      .set('Authorization', authHeader())
      .send(baseOps);
    expect(res.status).toBe(201);
    expect(res.body.caseId).toMatch(/^cmass-/);
    expect(res.body.decisions.mellanlagring.operationType).toBe('MELLANLAGRING');
    expect(res.body.decisions.deponi.operationType).toBe('DEPONI');
    expect(res.body.decisions.mellanlagring.gateDecision).toBeTruthy();
    expect(res.body.decisions.mellanlagring.mpfDecision).toBeTruthy();
  });

  it('full flow: operations → documents → export → submit', async () => {
    const created = await request(app)
      .post('/api/c-notification/mass/operations')
      .set('Authorization', authHeader())
      .send(baseOps);
    const caseId = created.body.caseId;

    const docs = await request(app)
      .post('/api/c-notification/mass/generate-documents')
      .set('Authorization', authHeader())
      .send({ caseId });
    expect(docs.status).toBe(200);

    const exp = await request(app)
      .get(`/api/c-notification/mass/${caseId}/export`)
      .set('Authorization', authHeader());
    expect(exp.status).toBe(200);
    
    const exported = exp.body?.export;
    expect(exported).toBeTruthy();
    expect(exported.decisions).toBeTruthy();
    expect(exported.decisions.mellanlagring).toBeDefined();
    expect(exported.decisions.deponi).toBeDefined();
    expect(exported.decisions.mellanlagring[0].mpfDecision.activityCode).toBeTruthy();
    expect(exported.humanInTheLoop).toContain('verifiera');

    const sub = await request(app)
      .post('/api/c-notification/mass/submit')
      .set('Authorization', authHeader())
      .send({ caseId });
    expect(sub.status).toBe(200);
    expect(sub.body.referenceNumber).toMatch(/^C-ANM-MASS-/);
  });
});
