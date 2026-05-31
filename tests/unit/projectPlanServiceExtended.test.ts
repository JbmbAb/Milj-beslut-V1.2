/**
 * projectPlanServiceExtended.test.ts
 *
 * Supplementary tests for server/services/projectPlanService.ts covering:
 *  - evaluateGateForProject (including idempotency)
 *  - calculateCarbonForProject
 *  - recommendMapLayersForProject
 *  - applyTemplateForProject
 *  - DB error fallback (dbPlanStorageAvailable = false path)
 *  - Memory cache hits in getOrCreatePlan / getProjectPlanSnapshot
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getStoredProjectPlan: vi.fn(),
  createDispatchQuote: vi.fn(),
  createTransportBooking: vi.fn(),
  upsertDriverJournal: vi.fn(),
  signDriverJournal: vi.fn(),
  createLimsReport: vi.fn(),
  verifyLimsReport: vi.fn(),
  prisma: {
    projectPlanState: {
      upsert: vi.fn(),
    },
    project: {
      update: vi.fn(),
    },
  },
  logger: {
    warn: vi.fn(),
  },
}));

vi.mock('../../server/repositories/projectPlanRepository', () => ({
  getStoredProjectPlan: mocks.getStoredProjectPlan,
}));

vi.mock('../../server/services/transportDispatchService', () => ({
  createDispatchQuote: mocks.createDispatchQuote,
  createTransportBooking: mocks.createTransportBooking,
  upsertDriverJournal: mocks.upsertDriverJournal,
  signDriverJournal: mocks.signDriverJournal,
}));

vi.mock('../../server/services/limsService', () => ({
  createLimsReport: mocks.createLimsReport,
  verifyLimsReport: mocks.verifyLimsReport,
}));

vi.mock('../../server/db/prisma', () => ({
  prisma: mocks.prisma,
}));

vi.mock('../../server/logger', () => ({
  logger: mocks.logger,
}));

async function loadService() {
  return import('../../server/services/projectPlanService');
}

describe('projectPlanService – extended branch coverage', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.getStoredProjectPlan.mockResolvedValue(null);
    mocks.prisma.projectPlanState.upsert.mockResolvedValue(undefined);
    mocks.prisma.project.update.mockResolvedValue(undefined);
  });

  // ─── evaluateGateForProject ────────────────────────────────────────────────

  describe('evaluateGateForProject', () => {
    it('evaluates CARBON_CHECK gate and persists updated plan', async () => {
      const service = await loadService();

      // Pre-save a plan with a carbon result so CARBON_CHECK can pass
      const carbonInput = {
        tons: 10,
        distanceKm: 20,
        transportMode: 'TRUCK' as const,
        materialType: 'SOIL' as const,
      };
      const { plan: planWithCarbon } = await service.calculateCarbonForProject({
        projectId: 'proj-gate-1',
        organisationId: 'org-1',
        carbonInput,
      });

      // Now evaluate the CARBON_CHECK gate
      const result = await service.evaluateGateForProject({
        projectId: 'proj-gate-1',
        organisationId: 'org-1',
        gateId: 'CARBON_CHECK',
        plan: planWithCarbon,
      });

      expect(result.gate.status).toBe('PASSED');
      expect(typeof result.idempotent).toBe('boolean');
      expect(mocks.prisma.projectPlanState.upsert).toHaveBeenCalled();
    }, 20000);

    it('returns idempotent:true when gate result hash is unchanged', async () => {
      const service = await loadService();

      const carbonInput = {
        tons: 5,
        distanceKm: 10,
        transportMode: 'TRUCK' as const,
        materialType: 'ROCK' as const,
      };
      const { plan: planWithCarbon } = await service.calculateCarbonForProject({
        projectId: 'proj-gate-2',
        organisationId: 'org-1',
        carbonInput,
      });

      // First evaluation
      await service.evaluateGateForProject({
        projectId: 'proj-gate-2',
        organisationId: 'org-1',
        gateId: 'CARBON_CHECK',
      });

      // Second evaluation — same inputs → same hash → idempotent
      const second = await service.evaluateGateForProject({
        projectId: 'proj-gate-2',
        organisationId: 'org-1',
        gateId: 'CARBON_CHECK',
      });

      expect(second.idempotent).toBe(true);
      void planWithCarbon;
    }, 20000);

    it('evaluates PERMIT_REQUIRED gate - blocked when no permit type', async () => {
      const service = await loadService();

      const result = await service.evaluateGateForProject({
        projectId: 'proj-gate-3',
        organisationId: 'org-1',
        gateId: 'PERMIT_REQUIRED',
        context: {},
      });

      expect(result.gate.status).toBe('BLOCKED');
      expect(result.gate.reason).toMatch(/missing/i);
    }, 20000);

    it('throws for completely unknown gateId', async () => {
      const service = await loadService();

      await expect(
        service.evaluateGateForProject({
          projectId: 'proj-gate-4',
          organisationId: 'org-1',
          gateId: 'GATE-NONEXISTENT-XYZ',
        }),
      ).rejects.toThrow(/unknown stage gate/i);
    }, 20000);
  });

  // ─── calculateCarbonForProject ─────────────────────────────────────────────

  describe('calculateCarbonForProject', () => {
    it('calculates carbon and stores result in plan summary', async () => {
      const service = await loadService();

      const { plan, result } = await service.calculateCarbonForProject({
        projectId: 'proj-carbon-1',
        organisationId: 'org-1',
        carbonInput: {
          tons: 20,
          distanceKm: 30,
          transportMode: 'TRUCK',
          materialType: 'WASTE',
        },
      });

      expect(result.totalKgCo2e).toBeGreaterThan(0);
      expect(plan.carbonSummary.lastResult?.totalKgCo2e).toBe(result.totalKgCo2e);
      expect(plan.carbonSummary.history.length).toBe(1);
      expect(mocks.prisma.projectPlanState.upsert).toHaveBeenCalled();
    }, 20000);

    it('accumulates history on repeated carbon calculations', async () => {
      const service = await loadService();

      await service.calculateCarbonForProject({
        projectId: 'proj-carbon-2',
        organisationId: 'org-1',
        carbonInput: { tons: 5, distanceKm: 10, transportMode: 'TRUCK', materialType: 'SOIL' },
      });

      const { plan } = await service.calculateCarbonForProject({
        projectId: 'proj-carbon-2',
        organisationId: 'org-1',
        carbonInput: { tons: 10, distanceKm: 20, transportMode: 'TRUCK', materialType: 'ROCK' },
      });

      expect(plan.carbonSummary.history.length).toBe(2);
    }, 20000);
  });

  // ─── recommendMapLayersForProject ─────────────────────────────────────────

  describe('recommendMapLayersForProject', () => {
    it('returns layers for REMEDIATION project type', async () => {
      const service = await loadService();

      const { plan, recommendation } = await service.recommendMapLayersForProject({
        projectId: 'proj-layers-1',
        organisationId: 'org-1',
        projectType: 'REMEDIATION',
      });

      expect(Array.isArray(recommendation.base)).toBe(true);
      expect(recommendation.base.length).toBeGreaterThan(0);
      expect(plan.projectType).toBe('REMEDIATION');
    }, 20000);

    it('falls back to plan.projectType when no explicit projectType given', async () => {
      const service = await loadService();

      // Save a VA plan first
      await service.saveProjectPlanSnapshot({
        projectId: 'proj-layers-2',
        organisationId: 'org-1',
        plan: { projectType: 'VA' },
      });

      const { plan } = await service.recommendMapLayersForProject({
        projectId: 'proj-layers-2',
        organisationId: 'org-1',
      });

      expect(plan.projectType).toBe('VA');
    }, 20000);
  });

  // ─── applyTemplateForProject ───────────────────────────────────────────────

  describe('applyTemplateForProject', () => {
    it('applies VA_STANDARD template and updates project type', async () => {
      const service = await loadService();

      const result = await service.applyTemplateForProject({
        projectId: 'proj-tmpl-1',
        organisationId: 'org-1',
        templateId: 'VA_STANDARD',
      });

      expect(result.projectType).toBe('VA');
      expect(result.templateId).toBe('VA_STANDARD');
      expect(mocks.prisma.projectPlanState.upsert).toHaveBeenCalled();
    }, 20000);

    it('applies REMEDIATION_STANDARD template', async () => {
      const service = await loadService();

      const result = await service.applyTemplateForProject({
        projectId: 'proj-tmpl-2',
        organisationId: 'org-1',
        templateId: 'REMEDIATION_STANDARD',
      });

      expect(result.projectType).toBe('REMEDIATION');
    }, 20000);
  });

  // ─── DB error fallback ─────────────────────────────────────────────────────

  describe('DB error fallback (dbPlanStorageAvailable)', () => {
    it('warns and falls back to memory when DB throws on persist', async () => {
      mocks.prisma.projectPlanState.upsert.mockRejectedValue(new Error('DB connection lost'));

      const service = await loadService();

      // Should not throw — falls back to memory
      const plan = await service.saveProjectPlanSnapshot({
        projectId: 'proj-err-1',
        organisationId: 'org-1',
        plan: { name: 'Memory plan' },
      });

      expect(plan.name).toBe('Memory plan');
      expect(mocks.logger.warn).toHaveBeenCalled();
    }, 20000);

    it('skips DB on subsequent calls after initial failure', async () => {
      mocks.prisma.projectPlanState.upsert.mockRejectedValue(new Error('DB down'));

      const service = await loadService();

      // First call triggers DB error
      await service.saveProjectPlanSnapshot({
        projectId: 'proj-err-2',
        organisationId: 'org-1',
        plan: { name: 'Plan A' },
      });

      const callCountAfterFirst = mocks.prisma.projectPlanState.upsert.mock.calls.length;

      // Second call — after flag is false, DB should NOT be called again
      await service.saveProjectPlanSnapshot({
        projectId: 'proj-err-2',
        organisationId: 'org-1',
        plan: { name: 'Plan B' },
      });

      const callCountAfterSecond = mocks.prisma.projectPlanState.upsert.mock.calls.length;
      expect(callCountAfterSecond).toBe(callCountAfterFirst); // no new DB calls
    }, 20000);

    it('skips DB read when dbPlanStorageAvailable is false', async () => {
      // Force DB into "unavailable" state by making first persist fail
      mocks.prisma.projectPlanState.upsert.mockRejectedValueOnce(new Error('DB down'));
      mocks.getStoredProjectPlan.mockResolvedValue(null);

      const service = await loadService();

      // Trigger DB failure
      await service.saveProjectPlanSnapshot({
        projectId: 'proj-err-3',
        organisationId: 'org-1',
        plan: { name: 'Init' },
      });

      // Reset mocks so we can count DB reads
      vi.clearAllMocks();
      mocks.prisma.projectPlanState.upsert.mockResolvedValue(undefined);
      mocks.prisma.project.update.mockResolvedValue(undefined);

      // Snapshot for a new project should skip DB read entirely
      const snap = await service.getProjectPlanSnapshot('new-proj-abc', 'org-1');
      // Returns null because DB is skipped and memory has nothing
      expect(snap).toBeNull();
      expect(mocks.getStoredProjectPlan).not.toHaveBeenCalled();
    }, 20000);
  });

  // ─── Memory cache hits ─────────────────────────────────────────────────────

  describe('memory cache hits', () => {
    it('getProjectPlanSnapshot returns plan from memory without DB call', async () => {
      const service = await loadService();

      // Prime the memory cache
      await service.saveProjectPlanSnapshot({
        projectId: 'proj-cache-1',
        organisationId: 'org-1',
        plan: { name: 'Cached Plan' },
      });

      vi.clearAllMocks();

      // Second call should come from memory
      const cached = await service.getProjectPlanSnapshot('proj-cache-1', 'org-1');
      expect(cached?.name).toBe('Cached Plan');
      expect(mocks.getStoredProjectPlan).not.toHaveBeenCalled();
    }, 20000);

    it('getOrCreatePlan (via saveProjectPlanSnapshot) hits memory on second call', async () => {
      const service = await loadService();

      await service.saveProjectPlanSnapshot({
        projectId: 'proj-cache-2',
        organisationId: 'org-1',
        plan: { name: 'First Save' },
      });

      vi.clearAllMocks();
      mocks.prisma.projectPlanState.upsert.mockResolvedValue(undefined);
      mocks.prisma.project.update.mockResolvedValue(undefined);

      // Save again to trigger getOrCreatePlan → finds in memory
      const result = await service.saveProjectPlanSnapshot({
        projectId: 'proj-cache-2',
        organisationId: 'org-1',
        plan: { name: 'Second Save' },
      });

      expect(result.name).toBe('Second Save');
      expect(mocks.getStoredProjectPlan).not.toHaveBeenCalled();
    }, 20000);
  });
});

// End of file
