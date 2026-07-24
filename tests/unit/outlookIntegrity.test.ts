/**
 * Stage 3 verification: SHA-256 duplicates, soft-delete, DLQ for OCR failures.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findUniqueAttachment: vi.fn(),
  findManyAttachments: vi.fn(),
  updateEmail: vi.fn(),
  updateAttachment: vi.fn(),
  loggerWarn: vi.fn(),
}));

vi.mock('../../server/db/prisma', () => ({
  prisma: {
    outlookAttachment: {
      findUnique: mocks.findUniqueAttachment,
      findMany: mocks.findManyAttachments,
      update: mocks.updateAttachment,
    },
    emailMessage: {
      update: mocks.updateEmail,
    },
  },
}));

vi.mock('../../server/logger', () => ({
  logger: { warn: mocks.loggerWarn, info: vi.fn(), error: vi.fn() },
}));

describe('outlook integrity helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('detects SHA-256 duplicate attachments', async () => {
    const { sha256, isDuplicateAttachment } = await import('../../server/services/outlookIngestionService');
    const data = Buffer.from('same-bytes');
    const hash = sha256(data);
    mocks.findUniqueAttachment.mockResolvedValue({ attachmentHash: hash });

    await expect(isDuplicateAttachment(data)).resolves.toBe(true);
    expect(mocks.findUniqueAttachment).toHaveBeenCalledWith({
      where: { attachmentHash: hash },
    });
  });

  it('soft-deletes emails without hard delete', async () => {
    const { softDeleteEmail } = await import('../../server/services/outlookIngestionService');
    mocks.updateEmail.mockResolvedValue({ messageId: '<m1>', status: 'SOFT_DELETED' });

    const result = await softDeleteEmail('<m1>');
    expect(result.status).toBe('SOFT_DELETED');
    expect(mocks.updateEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { messageId: '<m1>' },
        data: expect.objectContaining({ status: 'SOFT_DELETED' }),
      }),
    );
  });

  it('lists DLQ attachments with parseFailureReason', async () => {
    const { listDlqAttachments, markAttachmentFailed } =
      await import('../../server/services/outlookIngestionService');
    mocks.updateAttachment.mockResolvedValue({});
    mocks.findManyAttachments.mockResolvedValue([
      { attachmentHash: 'h1', parseFailureReason: 'OCR failed', parsed: true },
    ]);

    await markAttachmentFailed('h1', 'OCR failed');
    const dlq = await listDlqAttachments(10);

    expect(dlq).toHaveLength(1);
    expect(dlq[0].parseFailureReason).toContain('OCR');
    expect(mocks.findManyAttachments).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { parsed: true, parseFailureReason: { not: null } },
      }),
    );
  });
});
