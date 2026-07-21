import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db.server', () => ({
  prisma: {
    authorityInboxEvent: { create: vi.fn() },
    submission: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    submissionStatusEvent: { create: vi.fn() },
  },
}));

vi.mock('../../server/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Mock domain enums
vi.mock('../../src/domain/submission', () => ({
  SubmissionStatus: {
    RECEIVED: 'RECEIVED',
    PENDING_REVIEW: 'PENDING_REVIEW',
    SUBMITTED: 'SUBMITTED',
  },
  SubmissionChannel: {
    WEBHOOK: 'WEBHOOK',
    EMAIL: 'EMAIL',
    API: 'API',
  },
}));

import { prisma } from '../../db.server';
import {
  AuthorityInboxService,
  AuthorityInboxEventType,
  authorityInbox,
} from '../../server/services/authorityInboxService';
import { SubmissionChannel } from '../../src/domain/submission';

const mockPrisma = prisma as any;

const baseEvent = {
  submissionId: 'sub-1',
  projectId: 'proj-1',
  organisationId: 'org-1',
  sourceSystem: 'MUNICIPALITY_WEBHOOK',
  sourceChannel: SubmissionChannel.WEBHOOK,
  authorityName: 'Stockholms kommun',
  eventType: AuthorityInboxEventType.ACKNOWLEDGEMENT,
  summary: 'Ansökan mottagen',
  payload: { status: 'RECEIVED' },
  externalReference: 'AVLOPP-2024-001',
  caseNumber: 'CASE-123',
};

describe('authorityInboxService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.authorityInboxEvent.create.mockResolvedValue({ id: 'evt-1' });
    mockPrisma.submission.update.mockResolvedValue({ id: 'sub-1' });
    mockPrisma.submissionStatusEvent.create.mockResolvedValue({ id: 'sse-1' });
  });

  it('exporterar AuthorityInboxEventType enum', () => {
    expect(AuthorityInboxEventType.ACKNOWLEDGEMENT).toBe('ACKNOWLEDGEMENT');
    expect(AuthorityInboxEventType.STATUS_UPDATE).toBe('STATUS_UPDATE');
    expect(AuthorityInboxEventType.DECISION).toBe('DECISION');
    expect(AuthorityInboxEventType.INJUNCTION).toBe('INJUNCTION');
    expect(AuthorityInboxEventType.COMPLEMENT_REQUEST).toBe('COMPLEMENT_REQUEST');
    expect(AuthorityInboxEventType.GENERAL_MESSAGE).toBe('GENERAL_MESSAGE');
  });

  it('exporterar authorityInbox som singleton', () => {
    expect(authorityInbox).toBeInstanceOf(AuthorityInboxService);
  });

  describe('registerInboundEvent', () => {
    it('skapar authorityInboxEvent i databasen', async () => {
      const service = new AuthorityInboxService();
      await service.registerInboundEvent(baseEvent);
      expect(mockPrisma.authorityInboxEvent.create).toHaveBeenCalledOnce();
    });

    it('uppdaterar submission-status för ACKNOWLEDGEMENT', async () => {
      const service = new AuthorityInboxService();
      await service.registerInboundEvent({
        ...baseEvent,
        eventType: AuthorityInboxEventType.ACKNOWLEDGEMENT,
      });

      expect(mockPrisma.submission.update).toHaveBeenCalledOnce();
      expect(mockPrisma.submissionStatusEvent.create).toHaveBeenCalledOnce();
    });

    it('uppdaterar submission-status för STATUS_UPDATE', async () => {
      const service = new AuthorityInboxService();
      await service.registerInboundEvent({
        ...baseEvent,
        eventType: AuthorityInboxEventType.STATUS_UPDATE,
      });

      expect(mockPrisma.submission.update).toHaveBeenCalledOnce();
    });

    it('uppdaterar submission-status för DECISION', async () => {
      const service = new AuthorityInboxService();
      await service.registerInboundEvent({
        ...baseEvent,
        eventType: AuthorityInboxEventType.DECISION,
      });

      expect(mockPrisma.submission.update).toHaveBeenCalledOnce();
    });

    it('skapar ej submission-update för INJUNCTION (inget nytt status-map)', async () => {
      const service = new AuthorityInboxService();
      await service.registerInboundEvent({
        ...baseEvent,
        submissionId: 'sub-1',
        eventType: AuthorityInboxEventType.INJUNCTION,
      });

      // INJUNCTION has no mapped newStatus → no update
      expect(mockPrisma.submission.update).not.toHaveBeenCalled();
    });

    it('hanterar event utan submissionId (project-level)', async () => {
      const service = new AuthorityInboxService();
      await service.registerInboundEvent({
        ...baseEvent,
        submissionId: undefined,
        eventType: AuthorityInboxEventType.GENERAL_MESSAGE,
      });

      expect(mockPrisma.authorityInboxEvent.create).toHaveBeenCalledOnce();
      expect(mockPrisma.submission.update).not.toHaveBeenCalled();
    });

    it('kastar om authorityInboxEvent.create misslyckas', async () => {
      mockPrisma.authorityInboxEvent.create.mockRejectedValue(new Error('DB error'));
      const service = new AuthorityInboxService();
      await expect(service.registerInboundEvent(baseEvent)).rejects.toThrow('DB error');
    });
  });
});
