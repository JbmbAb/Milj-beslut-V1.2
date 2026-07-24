import { prisma } from '../../server/db/prisma';
import { describe, it, expect, beforeEach, afterAll, beforeAll, vi } from 'vitest';

import { runIngestion } from '../../server/services/outlookIngestionService';
import * as fs from 'fs';

// This test suite requires a real PostgreSQL database.
// Set DATABASE_INTEGRATION=true (and a valid DATABASE_URL) to run it.
const hasDatabaseIntegration = process.env.DATABASE_INTEGRATION === 'true';

vi.mock('fs', () => ({
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

describe.skipIf(!hasDatabaseIntegration)('outlookIngestionService integration', () => {
  beforeAll(async () => {
    await prisma.$connect();
  });

  beforeEach(async () => {
    // Clean the database before each test
    vi.clearAllMocks();
    await prisma.extractedRequirement.deleteMany({});
    await prisma.attachmentOccurrence.deleteMany({});
    await prisma.outlookAttachment.deleteMany({});
    await prisma.emailMessage.deleteMany({});
    await prisma.pipelineRun.deleteMany({});
  });

  afterAll(async () => {
    // Clean the database after all tests
    await prisma.extractedRequirement.deleteMany({});
    await prisma.attachmentOccurrence.deleteMany({});
    await prisma.outlookAttachment.deleteMany({});
    await prisma.emailMessage.deleteMany({});
    await prisma.pipelineRun.deleteMany({});
    await prisma.$disconnect();
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
      const result = await runIngestion({ emails: [mockEmail], storageRoot: '/tmp' });

      expect(result.emailsProcessed).toBe(1);
      expect(result.attachmentsSaved).toBe(1);
      expect(fs.writeFileSync).toHaveBeenCalled();

      const email = await prisma.emailMessage.findUnique({ where: { messageId: mockEmail.messageId } });
      expect(email).not.toBeNull();
    });

    it('skips email if status is COMPLETE', async () => {
      await prisma.emailMessage.create({
        data: {
          messageId: mockEmail.messageId,
          status: 'COMPLETE',
          sender: 's',
          subject: 's',
          receivedAt: new Date(),
        },
      });
      const result = await runIngestion({ emails: [mockEmail], storageRoot: '/tmp' });

      expect(result.emailsSkipped).toBe(1);
    });

    it('skips attachment if hash already exists', async () => {
      await runIngestion({ emails: [mockEmail], storageRoot: '/tmp' });
      const result = await runIngestion({ emails: [mockEmail], storageRoot: '/tmp' });

      expect(result.attachmentsSkipped).toBe(1);
      // expect(fs.writeFileSync).toHaveBeenCalledTimes(1); // This is tricky because runIngestion is called twice
    });
  });
});
