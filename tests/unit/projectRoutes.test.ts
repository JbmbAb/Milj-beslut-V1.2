import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  rateLimitByUser: vi.fn(),
  assertProjectMembership: vi.fn(),
  appendDomainAudit: vi.fn(),
  notifyStageGate: vi.fn(),
  sendProjectNotification: vi.fn(),
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
  isValidRole: vi.fn(),
}));

vi.mock('../../server/security/auth', () => ({
  requireAuth: (req: any, res: any, next: any) => {
    if (
      mocks.requireAuth.mock.results.length > 0 &&
      mocks.requireAuth.mock.results[mocks.requireAuth.mock.results.length - 1]?.value === false
    ) {
      res.status(401).json({ ok: false, error: 'Unauthorized' });
      return;
    }
    req.authUser = { id: 'user-1', organisationId: 'org-1', role: 'OWNER' };
    next();
  },
}));

vi.mock('../../server/security/rateLimit', () => ({
  rateLimitByUser: () => (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../../server/security/secureErrors', () => ({
  toSafeErrorResponse: (error: unknown) => ({
    ok: false,
    error: error instanceof Error ? error.message : 'Unknown error',
  }),
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

vi.mock('../../server/services/publicUiService', () => ({
  parseBbox: vi.fn(() => null),
}));

vi.mock('../../server/repositories/requirementsRepository', () => ({}));

import projectRouter from '../../server/routes/project.routes';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(projectRouter);
  return app;
}

describe('project.routes', () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    vi.clearAllMocks();
    app = buildApp();
    mocks.assertProjectMembership.mockResolvedValue(undefined);
    mocks.appendDomainAudit.mockResolvedValue(undefined);
    mocks.notifyStageGate.mockResolvedValue(undefined);
    mocks.sendProjectNotification.mockResolvedValue(undefined);
    mocks.isValidRole.mockReturnValue(true);
  });

  describe('GET /api/projects/:projectId/plan', () => {
    it('returns plan for authenticated project member', async () => {
      mocks.getProjectPlanSnapshot.mockResolvedValue({ name: 'Test Plan', stageGates: [] });

      const res = await request(app).get('/api/projects/proj-1/plan');

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.plan.name).toBe('Test Plan');
    });

    it('returns 400 when service throws', async () => {
      mocks.assertProjectMembership.mockRejectedValue(new Error('Access denied'));

      const res = await request(app).get('/api/projects/proj-1/plan');

      expect(res.status).toBe(400);
      expect(res.body.ok).toBe(false);
    });
  });

  describe('POST /api/projects/:projectId/plan/save', () => {
    it('saves plan and returns it', async () => {
      mocks.saveProjectPlanSnapshot.mockResolvedValue({
        name: 'Saved Plan',
        stageGates: [],
        templateId: 't1',
        projectType: 'MB',
      });

      const res = await request(app)
        .post('/api/projects/proj-1/plan/save')
        .send({ plan: { name: 'Saved Plan' } });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(mocks.appendDomainAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'PLAN_SAVE' }));
    });

    it('returns 400 when service throws', async () => {
      mocks.saveProjectPlanSnapshot.mockRejectedValue(new Error('Save failed'));

      const res = await request(app).post('/api/projects/proj-1/plan/save').send({});

      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/projects/:projectId/template/apply', () => {
    it('applies template and audits', async () => {
      mocks.applyTemplateForProject.mockResolvedValue({
        name: 'Templated',
        stageGates: [],
        projectType: 'MB',
      });

      const res = await request(app)
        .post('/api/projects/proj-1/template/apply')
        .send({ templateId: 'template-mb-standard' });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(mocks.appendDomainAudit).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'TEMPLATE_APPLY' }),
      );
    });

    it('returns 400 when templateId is missing', async () => {
      const res = await request(app).post('/api/projects/proj-1/template/apply').send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('required');
    });
  });

  describe('POST /api/projects/:projectId/stage-gates/:gateId/evaluate', () => {
    it('evaluates a valid gate and notifies if changed', async () => {
      mocks.evaluateGateForProject.mockResolvedValue({
        gate: { id: 'gate-PERMIT_REQUIRED', status: 'PASSED' },
        changed: true,
        idempotent: false,
        plan: {},
      });

      const res = await request(app)
        .post('/api/projects/proj-1/stage-gates/gate-PERMIT_REQUIRED/evaluate')
        .send({ permitType: 'A' });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.changed).toBe(true);
      expect(mocks.appendDomainAudit).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'STAGE_GATE_EVALUATE' }),
      );
    });

    it('returns 400 for invalid gateId', async () => {
      const res = await request(app)
        .post('/api/projects/proj-1/stage-gates/gate-INVALID_GATE_TYPE/evaluate')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid gateId');
    });

    it('skips audit and notification when idempotent', async () => {
      mocks.evaluateGateForProject.mockResolvedValue({
        gate: { id: 'gate-PERMIT_REQUIRED', status: 'PASSED' },
        changed: false,
        idempotent: true,
        plan: {},
      });

      const res = await request(app)
        .post('/api/projects/proj-1/stage-gates/gate-PERMIT_REQUIRED/evaluate')
        .send({});

      expect(res.status).toBe(200);
      expect(mocks.appendDomainAudit).not.toHaveBeenCalled();
    });
  });

  describe('GET /api/projects/:projectId/members', () => {
    it('lists project members', async () => {
      mocks.listProjectMembers.mockResolvedValue([
        { id: 'm1', userId: 'u1', bankidId: 'bid1', accessRole: 'OWNER', createdAt: '2026-01-01' },
      ]);

      const res = await request(app).get('/api/projects/proj-1/members');

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.members).toHaveLength(1);
    });
  });

  describe('PUT /api/projects/:projectId/members', () => {
    it('upserts a member with valid role', async () => {
      mocks.isValidRole.mockReturnValue(true);
      mocks.upsertProjectMember.mockResolvedValue({
        id: 'm1',
        userId: 'u1',
        bankidId: '191212121212',
        accessRole: 'REVIEWER',
        createdAt: '2026-01-01',
      });

      const res = await request(app)
        .put('/api/projects/proj-1/members')
        .send({ bankidId: '191212121212', role: 'REVIEWER' });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    });

    it('returns 400 when role is invalid', async () => {
      mocks.isValidRole.mockReturnValue(false);

      const res = await request(app)
        .put('/api/projects/proj-1/members')
        .send({ bankidId: '191212121212', role: 'ADMIN' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid role');
    });

    it('returns 400 when bankidId is missing', async () => {
      const res = await request(app).put('/api/projects/proj-1/members').send({ role: 'REVIEWER' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('required');
    });
  });

  describe('DELETE /api/projects/:projectId/members/:memberId', () => {
    it('removes member and notifies', async () => {
      mocks.removeProjectMember.mockResolvedValue(undefined);

      const res = await request(app).delete('/api/projects/proj-1/members/member-1');

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    });

    it('returns 400 when service throws', async () => {
      mocks.removeProjectMember.mockRejectedValue(new Error('Cannot remove last OWNER'));

      const res = await request(app).delete('/api/projects/proj-1/members/member-1');

      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/projects/:projectId/carbon/calculate', () => {
    it('calculates carbon and audits', async () => {
      mocks.calculateCarbonForProject.mockResolvedValue({
        result: { totalKgCo2e: 120, quality: 'ESTIMATED', method: 'STANDARD' },
        plan: {},
      });

      const res = await request(app)
        .post('/api/projects/proj-1/carbon/calculate')
        .send({ carbonInput: { tons: 100, transportMode: 'TRUCK', materialType: 'SOIL' } });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.result.totalKgCo2e).toBe(120);
      expect(mocks.appendDomainAudit).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'CARBON_CALCULATE' }),
      );
    });

    it('returns 400 for invalid transport mode', async () => {
      const res = await request(app)
        .post('/api/projects/proj-1/carbon/calculate')
        .send({ carbonInput: { tons: 10, transportMode: 'BICYCLE', materialType: 'SOIL' } });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid carbon input');
    });

    it('returns 400 for invalid material type', async () => {
      const res = await request(app)
        .post('/api/projects/proj-1/carbon/calculate')
        .send({ carbonInput: { tons: 10, transportMode: 'TRUCK', materialType: 'PLASTIC' } });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid carbon input');
    });
  });

  describe('POST /api/projects/:projectId/map-layers/recommend', () => {
    it('returns recommended map layers', async () => {
      mocks.recommendMapLayersForProject.mockResolvedValue({
        layers: ['WATER_BODY', 'PROTECTED_AREA'],
        plan: {},
      });

      const res = await request(app).post('/api/projects/proj-1/map-layers/recommend').send({});

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    });
  });

  describe('POST /api/projects/:projectId/dispatch/quote', () => {
    it('creates dispatch quote', async () => {
      mocks.createDispatchQuoteForProject.mockResolvedValue({
        quote: { id: 'q1', estimatedCostSek: 5000 },
        plan: {},
      });

      const res = await request(app).post('/api/projects/proj-1/dispatch/quote').send({
        receiverId: 'r1',
        receiverName: 'Receiver',
        wasteCode: '17 05 03*',
        tons: 9,
        distanceKm: 20,
      });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.quote.id).toBe('q1');
    });

    it('returns 400 when required fields missing', async () => {
      const res = await request(app).post('/api/projects/proj-1/dispatch/quote').send({});

      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/projects/:projectId/dispatch/book', () => {
    it('books transport', async () => {
      mocks.bookTransportForProject.mockResolvedValue({
        booking: { id: 'b1', status: 'BOOKED' },
        plan: {},
      });

      const res = await request(app).post('/api/projects/proj-1/dispatch/book').send({ quoteId: 'q1' });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.booking.id).toBe('b1');
    });

    it('returns 400 when quoteId missing', async () => {
      const res = await request(app).post('/api/projects/proj-1/dispatch/book').send({});

      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/projects/:projectId/driver-journals/upsert', () => {
    it('upserts driver journal', async () => {
      mocks.upsertDriverJournalForProject.mockResolvedValue({
        journal: { id: 'j1', status: 'DRAFT' },
        plan: {},
      });

      const res = await request(app)
        .post('/api/projects/proj-1/driver-journals/upsert')
        .send({
          journal: {
            bookingId: 'b1',
            driverName: 'Driver',
            vehicleId: 'ABC123',
            origin: 'Site A',
            destination: 'Site B',
            wasteCode: '17 05 03*',
            tons: 9,
            odometerStartKm: 1000,
          },
        });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    });

    it('returns 400 when bookingId missing', async () => {
      const res = await request(app)
        .post('/api/projects/proj-1/driver-journals/upsert')
        .send({ journal: {} });

      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/projects/:projectId/driver-journals/:journalId/sign', () => {
    it('signs driver journal', async () => {
      mocks.signDriverJournalForProject.mockResolvedValue({
        journal: { id: 'j1', status: 'VERIFIED' },
        plan: {},
      });

      const res = await request(app)
        .post('/api/projects/proj-1/driver-journals/j1/sign')
        .send({ signerRole: 'DRIVER', signatureId: 'sig-1' });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.journal.id).toBe('j1');
    });

    it('returns 400 when signerRole missing', async () => {
      const res = await request(app)
        .post('/api/projects/proj-1/driver-journals/j1/sign')
        .send({ signatureId: 'sig-1' });

      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/projects/:projectId/lims/ingest', () => {
    it('ingests LIMS report', async () => {
      mocks.ingestLimsReportForProject.mockResolvedValue({
        report: { id: 'r1', passed: true },
        plan: {},
      });

      const res = await request(app)
        .post('/api/projects/proj-1/lims/ingest')
        .send({
          report: {
            bookingId: 'b1',
            sampleId: 's1',
            labName: 'ALS',
            rawReference: 'als-123',
            metrics: [{ key: 'pH', value: 7.2, unit: '-' }],
          },
        });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    });
  });

  describe('POST /api/projects/:projectId/lims/:reportId/verify', () => {
    it('verifies LIMS report', async () => {
      mocks.verifyLimsReportForProject.mockResolvedValue({
        report: { id: 'r1', verifiedByHuman: true },
        plan: {},
      });

      const res = await request(app)
        .post('/api/projects/proj-1/lims/r1/verify')
        .send({ reviewer: 'QA Team', signatureId: 'sig-qa', approved: true });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    });
  });
});
