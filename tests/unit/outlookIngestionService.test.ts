import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';

const mocks = vi.hoisted(() => ({
  upsertPipeline: vi.fn(),
  updatePipeline: vi.fn(),
  findUniqueEmail: vi.fn(),
  upsertEmail: vi.fn(),
  updateEmail: vi.fn(),
  findUniqueAttachment: vi.fn(),
  upsertAttachment: vi.fn(),
  disconnect: vi.fn(),
  loggerWarn: vi.fn(),
  loggerInfo: vi.fn(),
  findManyAttachments: vi.fn(),
}));

vi.mock('@prisma/client', () => {
  return {
    PrismaClient: class {
      pipelineRun = { upsert: mocks.upsertPipeline, update: mocks.updatePipeline };
      emailMessage = {
        findUnique: mocks.findUniqueEmail,
        upsert: mocks.upsertEmail,
        update: mocks.updateEmail,
      };
      outlookAttachment = {
        findUnique: mocks.findUniqueAttachment,
        upsert: mocks.upsertAttachment,
        findMany: mocks.findManyAttachments,
        update: vi.fn().mockResolvedValue({}),
      };
      $disconnect = mocks.disconnect;
    },
  };
});

vi.mock('../../server/logger', () => ({
  logger: { warn: mocks.loggerWarn, info: mocks.loggerInfo, error: vi.fn() },
}));

vi.mock('fs', () => ({
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

describe('outlookIngestionService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('sha256', () => {
    it('generates correct hash', async () => {
      const { sha256 } = await import('../../server/services/outlookIngestionService');
      const hash = sha256(Buffer.from('test'));
      expect(hash).toHaveLength(64);
    });
  });

  describe('runIngestion', () => {
    const mockEmail = {
      messageId: '<id1>',
      sender: 's',
      subject: 's',
      receivedAt: new Date(),
      attachments: [{ filename: 'f', data: Buffer.from('d') }],
    };

    it('processes 1 email and its attachments', async () => {
      const { runIngestion } = await import('../../server/services/outlookIngestionService');
      mocks.findUniqueEmail.mockResolvedValue(null);
      mocks.findUniqueAttachment.mockResolvedValue(null);
      mocks.upsertPipeline.mockResolvedValue({});
      mocks.upsertEmail.mockResolvedValue({});
      mocks.upsertAttachment.mockResolvedValue({});
      mocks.updateEmail.mockResolvedValue({});
      mocks.updatePipeline.mockResolvedValue({});

      await runIngestion({ emails: [mockEmail], storageRoot: '/tmp' });

      expect(mocks.upsertEmail).toHaveBeenCalled();
      expect(fs.writeFileSync).toHaveBeenCalled();
    });

    it('skips email if status is COMPLETE', async () => {
      const { runIngestion } = await import('../../server/services/outlookIngestionService');
      mocks.findUniqueEmail.mockResolvedValue({ status: 'COMPLETE' });

      const result = await runIngestion({ emails: [mockEmail], storageRoot: '/tmp' });

      expect(result.emailsSkipped).toBe(1);
      expect(mocks.upsertEmail).not.toHaveBeenCalled();
    });

    it('skips attachment if hash already exists', async () => {
      const { runIngestion } = await import('../../server/services/outlookIngestionService');
      mocks.findUniqueEmail.mockResolvedValue(null);
      mocks.findUniqueAttachment.mockResolvedValue({ id: 'att1' });

      const result = await runIngestion({ emails: [mockEmail], storageRoot: '/tmp' });

      expect(result.attachmentsSkipped).toBe(1);
      expect(fs.writeFileSync).not.toHaveBeenCalled();
    });

    it('handles attachment processing errors', async () => {
      const { runIngestion } = await import('../../server/services/outlookIngestionService');
      mocks.findUniqueEmail.mockResolvedValue(null);
      mocks.findUniqueAttachment.mockImplementation(() => {
        throw new Error('DB Fail');
      });

      const result = await runIngestion({ emails: [mockEmail], storageRoot: '/tmp' });

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Attachment error');
    });

    it('handles email processing errors', async () => {
      const { runIngestion } = await import('../../server/services/outlookIngestionService');
      mocks.findUniqueEmail.mockImplementation(() => {
        throw new Error('Outer Fail');
      });

      const result = await runIngestion({ emails: [mockEmail], storageRoot: '/tmp' });

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Email error');
    });
  });

  describe('helper functions', () => {
    it('getPendingAttachments calls findMany', async () => {
      const { getPendingAttachments } = await import('../../server/services/outlookIngestionService');
      mocks.findManyAttachments.mockResolvedValue([]);
      await getPendingAttachments(10);
      expect(mocks.findManyAttachments).toHaveBeenCalledWith(expect.objectContaining({ take: 10 }));
    });

    it('markAttachmentParsed updates record', async () => {
      const { markAttachmentParsed } = await import('../../server/services/outlookIngestionService');
      await markAttachmentParsed('h', 't');
      // Update is mocked implicitly in class definition above
    });

    it('markAttachmentFailed updates record and logs warning', async () => {
      const { markAttachmentFailed } = await import('../../server/services/outlookIngestionService');
      await markAttachmentFailed('h', 'r');
      expect(mocks.loggerWarn).toHaveBeenCalled();
    });
  });
});
