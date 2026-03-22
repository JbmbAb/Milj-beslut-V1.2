import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTokenPair } from '../../server/security/auth';

const mocks = vi.hoisted(() => ({
  getProjectPlanSnapshot: vi.fn(),
  saveProjectPlanSnapshot: vi.fn(),
  applyTemplateForProject: vi.fn(),
  evaluateGateForProject: vi.fn(),
  calculateCarbonForProject: vi.fn(),
  recommendMapLayersForProject: vi.fn(),
  createDispatchQuoteForProject: vi.fn(),
  bookTransportForProject: vi.fn(),
  upsertDriverJournalForProject: vi.fn(),
  signDriverJournalForProject: vi.fn(),
  ingestLimsReportForProject: vi.fn(),
  verifyLimsReportForProject: vi.fn(),
  listProjectMembers: vi.fn(),
  upsertProjectMember: vi.fn(),
  removeProjectMember: vi.fn(),
  isValidRole: vi.fn(() => true),
  assertProjectMembership: vi.fn(),
  appendDomainAudit: vi.fn(),
  notifyStageGate: vi.fn(),
  sendProjectNotification: vi.fn(),
}));

vi.mock('../../server/repositories/tokenRepository', () => ({
  isTokenRevoked: vi.fn(async () => false),
  markRefreshTokenAsUsed: vi.fn(async () => undefined),
  revokeRefreshToken: vi.fn(async () => undefined),
  cleanupExpiredTokenRevocations: vi.fn(async () => 0),
}));

vi.mock('../../server/services/projectPlanService', () => ({
  getProjectPlanSnapshot: mocks.getProjectPlanSnapshot,
  saveProjectPlanSnapshot: mocks.saveProjectPlanSnapshot,
  applyTemplateForProject: mocks.applyTemplateForProject,
  evaluateGateForProject: mocks.evaluateGateForProject,
  calculateCarbonForProject: mocks.calculateCarbonForProject,
  recommendMapLayersForProject: mocks.recommendMapLayersForProject,
  createDispatchQuoteForProject: mocks.createDispatchQuoteForProject,
  bookTransportForProject: mocks.bookTransportForProject,
  upsertDriverJournalForProject: mocks.upsertDriverJournalForProject,
  signDriverJournalForProject: mocks.signDriverJournalForProject,
  ingestLimsReportForProject: mocks.ingestLimsReportForProject,
  verifyLimsReportForProject: mocks.verifyLimsReportForProject,
}));

vi.mock('../../server/services/projectMemberService', () => ({
  listProjectMembers: mocks.listProjectMembers,
  upsertProjectMember: mocks.upsertProjectMember,
  removeProjectMember: mocks.removeProjectMember,
  isValidRole: mocks.isValidRole,
}));

vi.mock('../../server/repositories/projectAccessRepository', () => ({
  assertProjectMembership: mocks.assertProjectMembership,
}));

vi.mock('../../server/security/auditTrail', () => ({
  appendDomainAudit: mocks.appendDomainAudit,
}));

vi.mock('../../server/services/notificationService', () => ({
  notifyStageGate: mocks.notifyStageGate,
  sendProjectNotification: mocks.sendProjectNotification,
}));

import projectRoutes from '../../server/routes/project.routes';

const app = express();
app.use(express.json());
app.use(projectRoutes);

function authHeader() {
  return `Bearer ${
    createTokenPair({
      id: 'admin-1',
      organisationId: 'org-1',
      bankidId: 'admin:one',
      role: 'ADMIN',
    }).accessToken
  }`;
}

describe('project.routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertProjectMembership.mockResolvedValue(undefined);
    mocks.getProjectPlanSnapshot.mockResolvedValue({ name: 'Loaded plan' });
    mocks.saveProjectPlanSnapshot.mockResolvedValue({
      name: 'Saved plan',
      templateId: 'ENV_PERMIT_CORE',
      projectType: 'ENV_PERMIT',
    });
    mocks.applyTemplateForProject.mockResolvedValue({
      name: 'Templated plan',
      templateId: 'ENV_PERMIT_CORE',
      projectType: 'ENV_PERMIT',
    });
    mocks.evaluateGateForProject.mockResolvedValue({
      gate: { id: 'gate-PERMIT_REQUIRED', status: 'PASSED' },
      changed: true,
      idempotent: false,
      plan: { stageGates: [] },
    });
    mocks.calculateCarbonForProject.mockResolvedValue({
      result: {
        totalKgCo2e: 12,
        quality: 'ESTIMATED',
        method: 'DEFAULT',
      },
      plan: { carbonSummary: { lastResult: { totalKgCo2e: 12 } } },
    });
    mocks.recommendMapLayersForProject.mockResolvedValue({
      plan: { mapLayerSelection: { enabled: ['GROUNDWATER'], blocked: [] } },
      recommendation: { enabled: ['GROUNDWATER'], blocked: [] },
    });
    mocks.listProjectMembers.mockResolvedValue([{ id: 'member-1' }]);
    mocks.upsertProjectMember.mockResolvedValue({ id: 'member-2', userId: 'user-2', role: 'OWNER' });
    mocks.removeProjectMember.mockResolvedValue(undefined);
    mocks.appendDomainAudit.mockResolvedValue({ id: 'audit-1' });
    mocks.notifyStageGate.mockResolvedValue(undefined);
    mocks.sendProjectNotification.mockResolvedValue(undefined);
    mocks.createDispatchQuoteForProject.mockResolvedValue({
      quote: { id: 'quote-1' },
      plan: { dispatchQuotes: [{ id: 'quote-1' }] },
    });
    mocks.bookTransportForProject.mockResolvedValue({
      booking: { id: 'booking-1' },
      plan: { transportBookings: [{ id: 'booking-1' }] },
    });
    mocks.upsertDriverJournalForProject.mockResolvedValue({
      journal: { id: 'journal-1' },
      plan: { driverJournals: [{ id: 'journal-1' }] },
    });
    mocks.signDriverJournalForProject.mockResolvedValue({
      journal: { id: 'journal-1', status: 'VERIFIED' },
      plan: { driverJournals: [{ id: 'journal-1', status: 'VERIFIED' }] },
    });
    mocks.ingestLimsReportForProject.mockResolvedValue({
      report: { id: 'report-1' },
      plan: { limsReports: [{ id: 'report-1' }] },
    });
    mocks.verifyLimsReportForProject.mockResolvedValue({
      report: { id: 'report-1', verifiedByHuman: true },
      plan: { limsReports: [{ id: 'report-1', verifiedByHuman: true }] },
    });
  });

  it('loads plans for authenticated project members', async () => {
    const res = await request(app).get('/api/projects/project-1/plan').set('Authorization', authHeader());

    expect(res.status).toBe(200);
    expect(res.body?.plan?.name).toBe('Loaded plan');
    expect(mocks.getProjectPlanSnapshot).toHaveBeenCalledWith('project-1', 'org-1');
  });

  it('saves plans and writes an audit event', async () => {
    const res = await request(app)
      .post('/api/projects/project-1/plan/save')
      .set('Authorization', authHeader())
      .send({
        plan: {
          name: 'My project',
        },
      });

    expect(res.status).toBe(200);
    expect(res.body?.plan?.name).toBe('Saved plan');
    expect(mocks.saveProjectPlanSnapshot).toHaveBeenCalledWith({
      projectId: 'project-1',
      organisationId: 'org-1',
      plan: { name: 'My project' },
    });
    expect(mocks.appendDomainAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'ProjectPlan',
        entityId: 'project-1:save',
        action: 'PLAN_SAVE',
      }),
    );
  });

  it('applies templates and validates missing template IDs', async () => {
    const missing = await request(app)
      .post('/api/projects/project-1/template/apply')
      .set('Authorization', authHeader())
      .send({});

    expect(missing.status).toBe(400);

    const res = await request(app)
      .post('/api/projects/project-1/template/apply')
      .set('Authorization', authHeader())
      .send({
        templateId: 'ENV_PERMIT_CORE',
      });

    expect(res.status).toBe(200);
    expect(res.body?.plan?.templateId).toBe('ENV_PERMIT_CORE');
    expect(mocks.applyTemplateForProject).toHaveBeenCalledWith({
      projectId: 'project-1',
      organisationId: 'org-1',
      templateId: 'ENV_PERMIT_CORE',
      plan: undefined,
    });
  });

  it('evaluates stage gates and emits audit plus notification for changed gates', async () => {
    const invalid = await request(app)
      .post('/api/projects/project-1/stage-gates/gate-UNKNOWN/evaluate')
      .set('Authorization', authHeader())
      .send({});

    expect(invalid.status).toBe(400);

    const res = await request(app)
      .post('/api/projects/project-1/stage-gates/gate-PERMIT_REQUIRED/evaluate')
      .set('Authorization', authHeader())
      .send({
        permitType: 'Anmalan 9 kap',
        permitSubmitted: true,
        codeType: 'SNI',
        mapLayerAvailable: ['CADASTRE', 'GROUNDWATER'],
        note: 'Ready',
      });

    expect(res.status).toBe(200);
    expect(res.body?.gate?.status).toBe('PASSED');
    expect(mocks.evaluateGateForProject).toHaveBeenCalledWith({
      projectId: 'project-1',
      organisationId: 'org-1',
      gateId: 'gate-PERMIT_REQUIRED',
      plan: undefined,
      context: {
        permitType: 'Anmalan 9 kap',
        codeType: 'SNI',
        permitSubmitted: true,
        mapLayerAvailable: ['CADASTRE', 'GROUNDWATER'],
        note: 'Ready',
      },
    });
    expect(mocks.appendDomainAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'STAGE_GATE_EVALUATE',
      }),
    );
    expect(mocks.notifyStageGate).toHaveBeenCalled();
  });

  it('lists and manages project members', async () => {
    const listRes = await request(app)
      .get('/api/projects/project-1/members')
      .set('Authorization', authHeader());
    expect(listRes.status).toBe(200);
    expect(listRes.body?.members).toEqual([{ id: 'member-1' }]);

    mocks.isValidRole.mockReturnValueOnce(false);
    const invalidRole = await request(app)
      .put('/api/projects/project-1/members')
      .set('Authorization', authHeader())
      .send({
        bankidId: 'user:2',
        role: 'NOPE',
      });
    expect(invalidRole.status).toBe(400);

    const addRes = await request(app)
      .put('/api/projects/project-1/members')
      .set('Authorization', authHeader())
      .send({
        bankidId: 'user:2',
        role: 'OWNER',
      });
    expect(addRes.status).toBe(200);
    expect(mocks.upsertProjectMember).toHaveBeenCalledWith({
      projectId: 'project-1',
      targetBankidId: 'user:2',
      role: 'OWNER',
      actingUserId: 'admin-1',
    });
    expect(mocks.sendProjectNotification).toHaveBeenCalled();

    const deleteRes = await request(app)
      .delete('/api/projects/project-1/members/member-2')
      .set('Authorization', authHeader());
    expect(deleteRes.status).toBe(200);
    expect(mocks.removeProjectMember).toHaveBeenCalledWith({
      projectId: 'project-1',
      memberId: 'member-2',
      actingUserId: 'admin-1',
    });
  });

  it('calculates carbon and validates invalid transport payloads', async () => {
    const invalid = await request(app)
      .post('/api/projects/project-1/carbon/calculate')
      .set('Authorization', authHeader())
      .send({
        carbonInput: {
          tons: 5,
          transportMode: 'PLANE',
          materialType: 'SOIL',
        },
      });
    expect(invalid.status).toBe(400);

    const res = await request(app)
      .post('/api/projects/project-1/carbon/calculate')
      .set('Authorization', authHeader())
      .send({
        carbonInput: {
          tons: 5,
          distanceKm: 25,
          transportMode: 'TRUCK',
          materialType: 'SOIL',
        },
      });

    expect(res.status).toBe(200);
    expect(res.body?.result?.totalKgCo2e).toBe(12);
    expect(mocks.calculateCarbonForProject).toHaveBeenCalledWith({
      projectId: 'project-1',
      organisationId: 'org-1',
      carbonInput: {
        tons: 5,
        distanceKm: 25,
        manualDistanceKm: undefined,
        transportMode: 'TRUCK',
        materialType: 'SOIL',
        emissionFactorKgCo2ePerTonKm: undefined,
      },
      plan: undefined,
    });
  });

  it('recommends map layers for authenticated members', async () => {
    const res = await request(app)
      .post('/api/projects/project-1/map-layers/recommend')
      .set('Authorization', authHeader())
      .send({});

    expect(res.status).toBe(200);
    expect(res.body?.recommendation?.enabled).toEqual(['GROUNDWATER']);
    expect(mocks.recommendMapLayersForProject).toHaveBeenCalledWith({
      projectId: 'project-1',
      organisationId: 'org-1',
      plan: undefined,
    });
  });

  it('rejects dispatch quote requests without auth', async () => {
    const res = await request(app).post('/api/projects/project-1/dispatch/quote').send({});
    expect(res.status).toBe(401);
  });

  it('creates dispatch quotes for valid project members', async () => {
    const res = await request(app)
      .post('/api/projects/project-1/dispatch/quote')
      .set('Authorization', authHeader())
      .send({
        receiverId: 'R2',
        receiverName: 'Haz Receiver',
        wasteCode: '17 05 03*',
        tons: 9,
        distanceKm: 20,
      });

    expect(res.status).toBe(200);
    expect(res.body?.ok).toBe(true);
    expect(res.body?.quote?.id).toBe('quote-1');
    expect(mocks.createDispatchQuoteForProject).toHaveBeenCalledWith({
      projectId: 'project-1',
      organisationId: 'org-1',
      receiverId: 'R2',
      receiverName: 'Haz Receiver',
      wasteCode: '17 05 03*',
      tons: 9,
      distanceKm: 20,
      plan: undefined,
    });
  });

  it('validates booking requests before reaching the service', async () => {
    const res = await request(app)
      .post('/api/projects/project-1/dispatch/book')
      .set('Authorization', authHeader())
      .send({});

    expect(res.status).toBe(400);
    expect(mocks.bookTransportForProject).not.toHaveBeenCalled();
  });

  it('upserts driver journals and normalizes optional fields', async () => {
    const res = await request(app)
      .post('/api/projects/project-1/driver-journals/upsert')
      .set('Authorization', authHeader())
      .send({
        journal: {
          bookingId: 'booking-1',
          driverName: 'Driver',
          vehicleId: 'ABC123',
          origin: 'Site A',
          destination: 'Site B',
          wasteCode: '17 05 04',
          tons: 5,
          odometerStartKm: 1000,
          endedAt: null,
          status: 'SUBMITTED',
        },
      });

    expect(res.status).toBe(200);
    expect(res.body?.journal?.id).toBe('journal-1');
    expect(mocks.upsertDriverJournalForProject).toHaveBeenCalledWith({
      projectId: 'project-1',
      organisationId: 'org-1',
      journal: {
        id: undefined,
        bookingId: 'booking-1',
        driverName: 'Driver',
        vehicleId: 'ABC123',
        origin: 'Site A',
        destination: 'Site B',
        wasteCode: '17 05 04',
        tons: 5,
        startedAt: undefined,
        endedAt: undefined,
        odometerStartKm: 1000,
        odometerEndKm: undefined,
        gpsTrackHash: undefined,
        status: 'SUBMITTED',
      },
      plan: undefined,
    });
  });

  it('signs journals with validated signer payloads', async () => {
    const res = await request(app)
      .post('/api/projects/project-1/driver-journals/journal-1/sign')
      .set('Authorization', authHeader())
      .send({
        signerRole: 'REVIEWER',
        signatureId: 'sig-review',
      });

    expect(res.status).toBe(200);
    expect(res.body?.journal?.status).toBe('VERIFIED');
    expect(mocks.signDriverJournalForProject).toHaveBeenCalledWith({
      projectId: 'project-1',
      organisationId: 'org-1',
      journalId: 'journal-1',
      signerRole: 'REVIEWER',
      signatureId: 'sig-review',
      plan: undefined,
    });
  });

  it('ingests lims reports and maps metric payloads', async () => {
    const res = await request(app)
      .post('/api/projects/project-1/lims/ingest')
      .set('Authorization', authHeader())
      .send({
        report: {
          bookingId: 'booking-1',
          sampleId: 'sample-1',
          labName: 'ALS',
          source: 'API',
          rawReference: 'als-1',
          metrics: [
            {
              key: 'Pb',
              value: 0.7,
              unit: 'mg/kg',
              maxAllowed: 1,
            },
          ],
        },
      });

    expect(res.status).toBe(200);
    expect(res.body?.report?.id).toBe('report-1');
    expect(mocks.ingestLimsReportForProject).toHaveBeenCalledWith({
      projectId: 'project-1',
      organisationId: 'org-1',
      report: {
        bookingId: 'booking-1',
        sampleId: 'sample-1',
        labName: 'ALS',
        source: 'API',
        analyzedAt: undefined,
        rawReference: 'als-1',
        metrics: [
          {
            key: 'Pb',
            value: 0.7,
            unit: 'mg/kg',
            maxAllowed: 1,
          },
        ],
        passed: undefined,
      },
      plan: undefined,
    });
  });

  it('verifies lims reports with reviewer metadata', async () => {
    const res = await request(app)
      .post('/api/projects/project-1/lims/report-1/verify')
      .set('Authorization', authHeader())
      .send({
        reviewer: 'QA Reviewer',
        signatureId: 'sig-lims',
        approved: true,
      });

    expect(res.status).toBe(200);
    expect(res.body?.report?.verifiedByHuman).toBe(true);
    expect(mocks.verifyLimsReportForProject).toHaveBeenCalledWith({
      projectId: 'project-1',
      organisationId: 'org-1',
      reportId: 'report-1',
      reviewer: 'QA Reviewer',
      signatureId: 'sig-lims',
      approved: true,
      plan: undefined,
    });
  });
});
