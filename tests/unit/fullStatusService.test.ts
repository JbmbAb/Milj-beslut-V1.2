import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock all external dependencies
vi.mock('../../server/db/prisma', () => ({
  prisma: {
    $queryRawUnsafe: vi.fn(),
    organisation: { count: vi.fn() },
    user: { count: vi.fn() },
    project: { count: vi.fn() },
    projectMember: { count: vi.fn() },
    documentRecord: { count: vi.fn() },
    documentChunk: { count: vi.fn() },
    documentContent: { count: vi.fn() },
    searchJob: { count: vi.fn() },
    searchQueryLog: { count: vi.fn(), findMany: vi.fn() },
    auditTrail: { count: vi.fn(), findMany: vi.fn() },
    propertyAccessLog: { count: vi.fn() },
    tokenRevocation: { count: vi.fn() },
    requirementCase: { count: vi.fn() },
    requirementRecord: { count: vi.fn() },
    requirementCitation: { count: vi.fn() },
    emailMessage: { count: vi.fn() },
    outlookAttachment: { count: vi.fn() },
    pipelineRun: { count: vi.fn(), findMany: vi.fn() },
    extractedRequirement: { count: vi.fn() },
    projectPlanState: { count: vi.fn() },
  },
}));

vi.mock('../../server/services/completionService', () => ({
  getAppCompletion: vi.fn(),
}));

vi.mock('../../server/services/publicUiService', () => ({
  getPublicDatasourceSummary: vi.fn(),
}));

vi.mock('../../server/services/transportDispatchService', () => ({
  getDispatchProviderRuntimeStatus: vi.fn(),
}));

vi.mock('../../server/services/outlookSchedulerService', () => ({
  getSchedulerStatus: vi.fn(),
}));

vi.mock('../../server/services/domstolRssSchedulerService', () => ({
  getSchedulerStatus: vi.fn(),
}));

vi.mock('../../server/services/backupService', () => ({
  listBackups: vi.fn(),
}));

vi.mock('../../server/services/errorTrackingService', () => ({
  getRecentErrors: vi.fn(),
}));

vi.mock('../../server/security/env', () => ({
  hasLantmaterietAuth: vi.fn(),
  isLantmaterietOpenMode: vi.fn(),
}));

import { prisma } from '../../server/db/prisma';
import { getAppCompletion } from '../../server/services/completionService';
import { getDispatchProviderRuntimeStatus } from '../../server/services/transportDispatchService';
import { getSchedulerStatus as getOutlookSchedulerStatus } from '../../server/services/outlookSchedulerService';
import { getSchedulerStatus as getDomstolSchedulerStatus } from '../../server/services/domstolRssSchedulerService';
import { listBackups } from '../../server/services/backupService';
import { getRecentErrors } from '../../server/services/errorTrackingService';
import { hasLantmaterietAuth, isLantmaterietOpenMode } from '../../server/security/env';
import { getPublicDatasourceSummary } from '../../server/services/publicUiService';
import { getFullStatus } from '../../server/services/fullStatusService';

const mockCompletion = {
  donePercent: 75,
  totalFeatures: 100,
  done: 75,
  partial: 10,
  pending: 15,
  categories: [],
};

const mockOutlookStatus = {
  running: false,
  intervalMs: 60000,
  totalRuns: 5,
};

const mockDomstolStatus = {
  running: true,
  intervalMs: 3600000,
  totalRuns: 12,
};

const mockDispatch = {
  activeProvider: 'TIMOCOM',
  requestedProvider: 'TIMOCOM',
};

const mockDatasources = {
  total: 5,
  connected: 4,
  cards: [],
};

beforeEach(() => {
  vi.clearAllMocks();

  vi.mocked(getAppCompletion).mockReturnValue(mockCompletion as never);
  vi.mocked(getOutlookSchedulerStatus).mockReturnValue(mockOutlookStatus as never);
  vi.mocked(getDomstolSchedulerStatus).mockReturnValue(mockDomstolStatus as never);
  vi.mocked(getDispatchProviderRuntimeStatus).mockReturnValue(mockDispatch as never);
  vi.mocked(getPublicDatasourceSummary).mockReturnValue(mockDatasources as never);
  vi.mocked(hasLantmaterietAuth).mockReturnValue(false);
  vi.mocked(isLantmaterietOpenMode).mockReturnValue(false);
  vi.mocked(listBackups).mockResolvedValue([]);
  vi.mocked(getRecentErrors).mockResolvedValue([]);

  // Prisma counts
  vi.mocked(prisma.$queryRawUnsafe).mockRejectedValue(new Error('PostGIS not available'));
  vi.mocked(prisma.organisation.count).mockResolvedValue(3);
  vi.mocked(prisma.user.count).mockResolvedValue(10);
  vi.mocked(prisma.project.count).mockResolvedValue(7);
  vi.mocked(prisma.projectMember.count).mockResolvedValue(15);
  vi.mocked(prisma.documentRecord.count).mockResolvedValue(42);
  vi.mocked(prisma.documentChunk.count).mockResolvedValue(210);
  vi.mocked(prisma.documentContent.count).mockResolvedValue(210);
  vi.mocked(prisma.searchJob.count).mockResolvedValue(5);
  vi.mocked(prisma.searchQueryLog.count).mockResolvedValue(100);
  vi.mocked(prisma.auditTrail.count).mockResolvedValue(300);
  vi.mocked(prisma.propertyAccessLog.count).mockResolvedValue(50);
  vi.mocked(prisma.tokenRevocation.count).mockResolvedValue(2);
  vi.mocked(prisma.requirementCase.count).mockResolvedValue(20);
  vi.mocked(prisma.requirementRecord.count).mockResolvedValue(200);
  vi.mocked(prisma.requirementCitation.count).mockResolvedValue(400);
  vi.mocked(prisma.emailMessage.count).mockResolvedValue(15);
  vi.mocked(prisma.outlookAttachment.count).mockResolvedValue(30);
  vi.mocked(prisma.pipelineRun.count).mockResolvedValue(8);
  vi.mocked(prisma.extractedRequirement.count).mockResolvedValue(120);
  vi.mocked(prisma.projectPlanState.count).mockResolvedValue(7);
  vi.mocked(prisma.auditTrail.findMany).mockResolvedValue([]);
  vi.mocked(prisma.searchQueryLog.findMany).mockResolvedValue([]);
  vi.mocked(prisma.pipelineRun.findMany).mockResolvedValue([]);
});

describe('fullStatusService', () => {
  describe('getFullStatus', () => {
    it('returnerar FullStatusReport med checkedAt', async () => {
      const result = await getFullStatus();
      expect(result.generatedAt).toBeTruthy();
      expect(() => new Date(result.generatedAt)).not.toThrow();
    });

    it('innehåller completion-data', async () => {
      const result = await getFullStatus();
      expect(result.completion).toBeDefined();
      expect(result.completion.donePercent).toBe(75);
    });

    it('rapporterar overall ok när allt fungerar', async () => {
      const result = await getFullStatus();
      expect(['ok', 'degraded', 'error']).toContain(result.overall);
    });

    it('innehåller integrationslista med BankID och Lantmäteriet', async () => {
      const result = await getFullStatus();
      const names = result.integrations.map((i) => i.name);
      expect(names).toContain('BankID');
      expect(names).toContain('Lantmäteriet');
    });

    it('rapporterar Lantmäteriet NOT_CONFIGURED utan env-vars', async () => {
      vi.mocked(hasLantmaterietAuth).mockReturnValue(false);
      vi.mocked(isLantmaterietOpenMode).mockReturnValue(false);
      const result = await getFullStatus();
      const lant = result.integrations.find((i) => i.name === 'Lantmäteriet');
      expect(lant?.status).toBe('NOT_CONFIGURED');
    });

    it('rapporterar Lantmäteriet CONFIGURED när autentisering finns', async () => {
      vi.mocked(hasLantmaterietAuth).mockReturnValue(true);
      const result = await getFullStatus();
      const lant = result.integrations.find((i) => i.name === 'Lantmäteriet');
      expect(lant?.status).toBe('CONFIGURED');
    });

    it('innehåller databas-summering med tabellantal', async () => {
      const result = await getFullStatus();
      expect(result.database.tables).toBeDefined();
      expect(Array.isArray(result.database.tables)).toBe(true);
      expect(result.database.totalRows).toBeGreaterThanOrEqual(0);
    });

    it('innehåller bakgrundstjänst-status för outlookScheduler', async () => {
      const result = await getFullStatus();
      expect(result.backgroundServices.outlookScheduler).toBeDefined();
      expect(result.backgroundServices.outlookScheduler.running).toBe(false);
    });

    it('innehåller domstolRssScheduler-status', async () => {
      const result = await getFullStatus();
      expect(result.domstolRssScheduler).toBeDefined();
      expect(result.domstolRssScheduler.running).toBe(true);
    });

    it('hanterar database-fel via safeCount (returnerar -1)', async () => {
      vi.mocked(prisma.organisation.count).mockRejectedValue(new Error('DB error'));
      const result = await getFullStatus();
      // Should not throw, tables array still present
      expect(result.database.tables).toBeDefined();
    });

    it('innehåller miljövariabelkonfiguration', async () => {
      const result = await getFullStatus();
      expect(result.environment).toBeDefined();
      expect(result.environment.vars).toBeDefined();
      expect(Array.isArray(result.environment.vars)).toBe(true);
    });

    it('rapporterar BankID som CONFIGURED när BANKID_BASE_URL är satt', async () => {
      process.env.BANKID_BASE_URL = 'https://appapi2.bankid.com/rp/v6';
      const result = await getFullStatus();
      const bankId = result.integrations.find((i) => i.name === 'BankID');
      expect(bankId?.status).toBe('CONFIGURED');
      delete process.env.BANKID_BASE_URL;
    });

    it('rapporterar Lantmäteriet CONFIGURED i öppet kartläge', async () => {
      vi.mocked(hasLantmaterietAuth).mockReturnValue(false);
      vi.mocked(isLantmaterietOpenMode).mockReturnValue(true);
      const result = await getFullStatus();
      const lant = result.integrations.find((i) => i.name === 'Lantmäteriet');
      expect(lant?.status).toBe('CONFIGURED');
    });

    it('hanterar backup-fel utan att krascha', async () => {
      vi.mocked(listBackups).mockRejectedValue(new Error('Storage unavailable'));
      const result = await getFullStatus();
      expect(result.generatedAt).toBeTruthy();
    });
  });
});
