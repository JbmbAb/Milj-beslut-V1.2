import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db.server', () => ({
  prisma: {
    submission: { findUnique: vi.fn() },
  },
}));

vi.mock('../../server/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../../server/services/authorityInboxService', () => ({
  authorityInbox: { registerInboundEvent: vi.fn() },
  AuthorityInboxEventType: {
    STATUS_UPDATE: 'STATUS_UPDATE',
    DECISION: 'DECISION',
    ACKNOWLEDGEMENT: 'ACKNOWLEDGEMENT',
  },
}));

vi.mock('../../src/domain/submission', () => ({
  SubmissionStatus: { PENDING_REVIEW: 'PENDING_REVIEW', RECEIVED: 'RECEIVED' },
  SubmissionChannel: { WEBHOOK: 'WEBHOOK' },
}));

import { prisma } from '../../db.server';
import { authorityInbox } from '../../server/services/authorityInboxService';
import {
  handleMunicipalityWebhook,
  pollMunicipalityStatuses,
  appealDecision,
  getStatusHistory,
} from '../../server/services/municipalityStatusPolling';
import type { MunicipalityStatusUpdate } from '../../server/services/municipalityStatusPolling';

const mockPrisma = prisma as any;
const mockInbox = authorityInbox as any;

const basePayload: MunicipalityStatusUpdate = {
  referenceNumber: 'AVLOPP-2024-001',
  status: 'RECEIVED',
  lastStatusUpdate: new Date().toISOString(),
  municipalityNotes: 'Ansökan mottagen och registrerad',
};

const mockSubmission = {
  id: 'sub-1',
  projectId: 'proj-1',
  organisationId: 'org-1',
  authorityName: 'Stockholms kommun',
  caseNumber: 'CASE-001',
  submissionKey: 'AVLOPP-2024-001',
};

describe('municipalityStatusPolling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInbox.registerInboundEvent.mockResolvedValue(undefined);
  });

  describe('handleMunicipalityWebhook', () => {
    it('returnerar ok:true för giltig payload med känd submission', async () => {
      mockPrisma.submission.findUnique.mockResolvedValue(mockSubmission);

      const result = await handleMunicipalityWebhook(basePayload);

      expect(result.ok).toBe(true);
      expect(result.acknowledged).toBe(true);
    });

    it('returnerar ok:false om referenceNumber saknar AVLOPP-prefix', async () => {
      const result = await handleMunicipalityWebhook({
        ...basePayload,
        referenceNumber: 'INVALID-001',
      });

      expect(result.ok).toBe(false);
      expect(result.acknowledged).toBe(false);
      expect(result.message).toContain('Invalid reference number');
    });

    it('returnerar ok:false om referenceNumber saknas', async () => {
      const result = await handleMunicipalityWebhook({
        ...basePayload,
        referenceNumber: '',
      });

      expect(result.ok).toBe(false);
    });

    it('returnerar ok:false om submission inte hittas', async () => {
      mockPrisma.submission.findUnique.mockResolvedValue(null);

      const result = await handleMunicipalityWebhook(basePayload);

      expect(result.ok).toBe(false);
      expect(result.message).toContain('not found');
    });

    it('anropar authorityInbox.registerInboundEvent', async () => {
      mockPrisma.submission.findUnique.mockResolvedValue(mockSubmission);

      await handleMunicipalityWebhook(basePayload);

      expect(mockInbox.registerInboundEvent).toHaveBeenCalledOnce();
    });

    it('hanterar decision-payload (APPROVED)', async () => {
      mockPrisma.submission.findUnique.mockResolvedValue(mockSubmission);

      const decisionPayload: MunicipalityStatusUpdate = {
        ...basePayload,
        status: 'APPROVED',
        decision: {
          type: 'APPROVED',
          reason: 'Uppfyller alla krav',
          signedBy: 'Handläggare Svensson',
        },
      };

      const result = await handleMunicipalityWebhook(decisionPayload);
      expect(result.ok).toBe(true);
    });

    it('returnerar ok:false vid oväntad exception', async () => {
      mockPrisma.submission.findUnique.mockRejectedValue(new Error('DB crash'));

      const result = await handleMunicipalityWebhook(basePayload);

      expect(result.ok).toBe(false);
      expect(result.message).toContain('Failed to process');
    });
  });

  describe('pollMunicipalityStatuses', () => {
    it('returnerar polled/updated/errors statistik', async () => {
      const result = await pollMunicipalityStatuses();

      expect(typeof result.polled).toBe('number');
      expect(typeof result.updated).toBe('number');
      expect(typeof result.errors).toBe('number');
    });

    it('returnerar 0 polled i nuvarande stub-implementation', async () => {
      const result = await pollMunicipalityStatuses();
      expect(result.polled).toBe(0);
    });
  });

  describe('appealDecision', () => {
    it('returnerar appeal-referensnummer', async () => {
      const result = await appealDecision('AVLOPP-2024-001', 'Beslutet är felaktigt');

      expect(result.ok).toBe(true);
      expect(result.appealReferenceNumber).toContain('APPELL-AVLOPP-2024-001');
    });

    it('returnerar nästa steg på svenska', async () => {
      const result = await appealDecision('AVLOPP-2024-001', 'Överklagande');
      expect(result.nextSteps).toBeTruthy();
      expect(result.municipalityContact).toBeTruthy();
    });
  });

  describe('getStatusHistory', () => {
    it('returnerar tom array (stub-implementation)', async () => {
      const result = await getStatusHistory('AVLOPP-2024-001');
      expect(result).toEqual([]);
    });
  });
});
