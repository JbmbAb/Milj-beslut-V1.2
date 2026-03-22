import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  pipelineRunUpsert: vi.fn(),
  pipelineRunUpdate: vi.fn(),
  emailFindUnique: vi.fn(),
  emailUpsert: vi.fn(),
  emailUpdate: vi.fn(),
  attachmentFindUnique: vi.fn(),
  attachmentUpsert: vi.fn(),
  attachmentFindMany: vi.fn(),
  attachmentUpdate: vi.fn(),
  disconnect: vi.fn(),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  loggerWarn: vi.fn(),
}));

vi.mock('@prisma/client', () => ({
  PrismaClient: class MockPrismaClient {
    pipelineRun = {
      upsert: mocks.pipelineRunUpsert,
      update: mocks.pipelineRunUpdate,
    };

    emailMessage = {
      findUnique: mocks.emailFindUnique,
      upsert: mocks.emailUpsert,
      update: mocks.emailUpdate,
    };

    outlookAttachment = {
      findUnique: mocks.attachmentFindUnique,
      upsert: mocks.attachmentUpsert,
      findMany: mocks.attachmentFindMany,
      update: mocks.attachmentUpdate,
    };

    $disconnect = mocks.disconnect;
  },
}));

vi.mock('fs', () => ({
  mkdirSync: mocks.mkdirSync,
  writeFileSync: mocks.writeFileSync,
}));

vi.mock('../../server/logger', () => ({
  logger: {
    warn: mocks.loggerWarn,
    info: vi.fn(),
  },
}));

describe('outlookIngestionService', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.resetModules();

    mocks.pipelineRunUpsert.mockResolvedValue(undefined);
    mocks.pipelineRunUpdate.mockResolvedValue(undefined);
    mocks.emailFindUnique.mockResolvedValue(null);
    mocks.emailUpsert.mockResolvedValue(undefined);
    mocks.emailUpdate.mockResolvedValue(undefined);
    mocks.attachmentFindUnique.mockResolvedValue(null);
    mocks.attachmentUpsert.mockResolvedValue(undefined);
    mocks.attachmentFindMany.mockResolvedValue([{ attachmentHash: 'hash-1' }]);
    mocks.attachmentUpdate.mockResolvedValue(undefined);
    mocks.disconnect.mockResolvedValue(undefined);
    mocks.mkdirSync.mockReturnValue(undefined);
    mocks.writeFileSync.mockReturnValue(undefined);
  });

  it('skips already complete emails and stores new attachments idempotently', async () => {
    mocks.emailFindUnique.mockImplementation(async ({ where }: { where: { messageId: string } }) => {
      return where.messageId === '<existing@demo>' ? { status: 'COMPLETE' } : null;
    });

    const service = await import('../../server/services/outlookIngestionService');
    const result = await service.runIngestion({
      runId: 'run-1',
      storageRoot: 'C:/tmp/outlook',
      emails: [
        {
          messageId: '<existing@demo>',
          sender: 'one@example.com',
          subject: 'Already done',
          receivedAt: new Date('2026-01-01T10:00:00.000Z'),
          attachments: [],
        },
        {
          messageId: '<new@demo>',
          sender: 'two@example.com',
          subject: 'New mail',
          receivedAt: new Date('2026-01-02T10:00:00.000Z'),
          attachments: [{ filename: 'beslut.pdf', data: Buffer.from('pdf-data') }],
        },
      ],
    });

    expect(result).toEqual({
      runId: 'run-1',
      emailsProcessed: 1,
      emailsSkipped: 1,
      attachmentsSaved: 1,
      attachmentsSkipped: 0,
      errors: [],
    });
    expect(mocks.mkdirSync).toHaveBeenCalled();
    expect(mocks.writeFileSync).toHaveBeenCalled();
    expect(mocks.attachmentUpsert).toHaveBeenCalled();
    expect(mocks.pipelineRunUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { runId: 'run-1' },
        data: expect.objectContaining({
          status: 'SUCCESS',
          processedCount: 1,
        }),
      }),
    );
    expect(mocks.disconnect).toHaveBeenCalled();
  });

  it('tracks duplicate attachments plus email and attachment errors', async () => {
    mocks.emailUpsert.mockImplementation(async ({ where }: { where: { messageId: string } }) => {
      if (where.messageId === '<bad@demo>') {
        throw new Error('mail upsert failed');
      }
      return undefined;
    });
    mocks.attachmentFindUnique
      .mockResolvedValueOnce({ attachmentHash: 'duplicate-hash' })
      .mockResolvedValueOnce(null);
    mocks.writeFileSync.mockImplementationOnce(() => {
      throw new Error('disk full');
    });

    const service = await import('../../server/services/outlookIngestionService');
    const result = await service.runIngestion({
      runId: 'run-2',
      storageRoot: 'C:/tmp/outlook',
      emails: [
        {
          messageId: '<dup@demo>',
          sender: 'dup@example.com',
          subject: 'Duplicate attachment',
          receivedAt: new Date('2026-01-03T10:00:00.000Z'),
          attachments: [
            { filename: 'dup.pdf', data: Buffer.from('same-file') },
            { filename: 'fails.pdf', data: Buffer.from('broken-file') },
          ],
        },
        {
          messageId: '<bad@demo>',
          sender: 'bad@example.com',
          subject: 'Broken mail',
          receivedAt: new Date('2026-01-04T10:00:00.000Z'),
          attachments: [],
        },
      ],
    });

    expect(result.emailsProcessed).toBe(1);
    expect(result.attachmentsSkipped).toBe(1);
    expect(result.attachmentsSaved).toBe(0);
    expect(result.errors).toEqual([
      'Attachment error [fails.pdf]: disk full',
      'Email error [<bad@demo>]: mail upsert failed',
    ]);
    expect(mocks.pipelineRunUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'FAILED',
          errorCount: 2,
        }),
      }),
    );
  });

  it('exposes attachment helper functions and sha256 hashing', async () => {
    const service = await import('../../server/services/outlookIngestionService');

    expect(service.sha256(Buffer.from('abc'))).toHaveLength(64);

    const pending = await service.getPendingAttachments(5);
    expect(pending).toEqual([{ attachmentHash: 'hash-1' }]);
    expect(mocks.attachmentFindMany).toHaveBeenCalledWith({
      where: { parsed: false },
      orderBy: { createdAt: 'asc' },
      take: 5,
    });

    await service.markAttachmentParsed('hash-1', 'extracted text');
    expect(mocks.attachmentUpdate).toHaveBeenCalledWith({
      where: { attachmentHash: 'hash-1' },
      data: { parsed: true, extractedText: 'extracted text' },
    });

    await service.markAttachmentFailed('hash-2', 'ocr failed');
    expect(mocks.loggerWarn).toHaveBeenCalledWith('outlook-ingestion: attachment parse failed', {
      hash: 'hash-2',
      reason: 'ocr failed',
    });
    expect(mocks.attachmentUpdate).toHaveBeenLastCalledWith({
      where: { attachmentHash: 'hash-2' },
      data: { parsed: true, parseFailureReason: 'ocr failed' },
    });
  });
});
