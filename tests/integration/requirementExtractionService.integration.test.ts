import { prisma } from '../../server/db/prisma';
import { describe, it, expect, beforeEach, afterAll, beforeAll, vi } from 'vitest';

import {
  processPendingAttachments,
  queryRequirements,
  getRequirementStats,
} from '../../server/services/requirementExtractionService';

// This test suite requires a real PostgreSQL database.
// Set DATABASE_INTEGRATION=true (and a valid DATABASE_URL) to run it.
const hasDatabaseIntegration = process.env.DATABASE_INTEGRATION === 'true';

// ─── Mock documentObjectStorage ──────────────────────────────────────────────

const { mockReadStorageFile } = vi.hoisted(() => ({ mockReadStorageFile: vi.fn() }));

vi.mock('../../server/services/documentObjectStorage', () => ({
  readStorageFile: mockReadStorageFile,
}));

vi.mock('../../server/logger', () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe.skipIf(!hasDatabaseIntegration)('requirementExtractionService integration', () => {
  async function seedEmailMessage(messageId: string) {
    await prisma.emailMessage.upsert({
      where: { messageId },
      create: { messageId, status: 'NEW' },
      update: {},
    });
  }

  beforeAll(async () => {
    await prisma.$connect();
  });

  beforeEach(async () => {
    // Clean the database before each test
    vi.resetAllMocks();
    await prisma.extractedRequirement.deleteMany({});
    await prisma.attachmentOccurrence.deleteMany({});
    await prisma.outlookAttachment.deleteMany({});
    await prisma.emailMessage.deleteMany({});
    await prisma.pipelineRun.deleteMany({});

    await seedEmailMessage('default-msg');
    await seedEmailMessage('message1');
  });

  afterAll(async () => {
    await prisma.extractedRequirement.deleteMany({});
    await prisma.attachmentOccurrence.deleteMany({});
    await prisma.outlookAttachment.deleteMany({});
    await prisma.emailMessage.deleteMany({});
    await prisma.pipelineRun.deleteMany({});
    await prisma.$disconnect();
  });

  describe('processPendingAttachments', () => {
    it('returns zero stats when no pending attachments', async () => {
      const stats = await processPendingAttachments();
      expect(stats.processed).toBe(0);
      expect(stats.requirementsStored).toBe(0);
      expect(stats.errors).toEqual([]);
    });

    it('marks attachment failed when storedPath is null', async () => {
      await prisma.outlookAttachment.create({
        data: {
          attachmentHash: 'hash1',
          filename: 'test.pdf',
          storedPath: null,
          parsed: false,
          canonicalMessageId: 'message1',
          filesize: 1n,
          checksumSha256: 'hash1',
        },
      });

      const stats = await processPendingAttachments();
      expect(stats.errors.length).toBe(1);
      expect(stats.errors[0]).toContain('No extracted text source available for attachment');

      const updatedAttachment = await prisma.outlookAttachment.findUnique({
        where: { attachmentHash: 'hash1' },
      });
      expect(updatedAttachment?.parsed).toBe(true);
      expect(updatedAttachment?.parseFailureReason).toContain(
        'No extracted text source available for attachment',
      );
    });

    it('marks attachment failed when file extension is not supported', async () => {
      await prisma.outlookAttachment.create({
        data: {
          attachmentHash: 'hash2',
          filename: 'doc.pdf',
          storedPath: '/some/path/doc.pdf',
          parsed: false,
          canonicalMessageId: 'message1',
          filesize: 1n,
          checksumSha256: 'hash2',
        },
      });

      const stats = await processPendingAttachments();
      expect(stats.errors.length).toBe(1);
      expect(stats.errors[0]).toContain('No extracted text source available for attachment');
      const updatedAttachment = await prisma.outlookAttachment.findUnique({
        where: { attachmentHash: 'hash2' },
      });
      expect(updatedAttachment?.parsed).toBe(true);
      expect(updatedAttachment?.parseFailureReason).toContain(
        'No extracted text source available for attachment',
      );
    });

    it('processes attachment with valid .txt storedPath', async () => {
      await prisma.outlookAttachment.create({
        data: {
          attachmentHash: 'hash3',
          filename: 'krav.txt',
          storedPath: '/docs/krav.txt',
          parsed: false,
          canonicalMessageId: 'message1',
          filesize: 1n,
          checksumSha256: 'hash3',
        },
      });

      mockReadStorageFile.mockResolvedValue(
        Buffer.from('Dagvatten ska hanteras via oljeavskiljare och uppsamlingstank på anläggningen.'),
      );

      const stats = await processPendingAttachments();
      expect(stats.processed).toBe(1);
      expect(stats.requirementsStored).toBeGreaterThan(0);

      const updatedAttachment = await prisma.outlookAttachment.findUnique({
        where: { attachmentHash: 'hash3' },
      });
      expect(updatedAttachment?.parsed).toBe(true);
      expect(updatedAttachment?.extractedText).toContain('Dagvatten ska hanteras');

      const requirements = await prisma.extractedRequirement.findMany({ where: { attachmentHash: 'hash3' } });
      expect(requirements.length).toBeGreaterThan(0);
    });

    it('handles read errors and records in stats.errors', async () => {
      await prisma.outlookAttachment.create({
        data: {
          attachmentHash: 'hash4',
          filename: 'err.txt',
          storedPath: '/docs/err.txt',
          parsed: false,
          canonicalMessageId: 'message1',
          filesize: 1n,
          checksumSha256: 'hash4',
        },
      });

      mockReadStorageFile.mockRejectedValue(new Error('FileSystem read error'));

      const stats = await processPendingAttachments();
      expect(stats.errors.length).toBe(1);
      expect(stats.errors[0]).toContain('No extracted text source available for attachment');

      const updatedAttachment = await prisma.outlookAttachment.findUnique({
        where: { attachmentHash: 'hash4' },
      });
      expect(updatedAttachment?.parsed).toBe(true);
      expect(updatedAttachment?.parseFailureReason).toContain(
        'No extracted text source available for attachment',
      );
    });
  });

  describe('queryRequirements', () => {
    beforeEach(async () => {
      await prisma.outlookAttachment.create({
        data: {
          attachmentHash: 'default-hash',
          filename: 'default.txt',
          checksumSha256: 'default-sha',
          canonicalMessageId: 'default-msg',
          parsed: true,
        },
      });

      await prisma.extractedRequirement.createMany({
        data: [
          {
            attachmentHash: 'default-hash',
            category: 'soil',
            requirementLevel: 'mandatory',
            requirementText: 'Requirement 1',
            confidence: 0.9,
          },
          {
            attachmentHash: 'default-hash',
            category: 'sampling',
            requirementLevel: 'mandatory',
            requirementText: 'Requirement 2',
            confidence: 0.9,
          },
        ],
      });
    });

    it('returns all requirements when no filter', async () => {
      const results = await queryRequirements({});
      expect(results.length).toBe(2);
    });

    it('filters by category', async () => {
      const results = await queryRequirements({ category: 'soil' });
      expect(results.length).toBe(1);
      expect(results[0].category).toBe('soil');
    });
  });

  describe('getRequirementStats', () => {
    it('returns correct aggregated stats', async () => {
      await prisma.outlookAttachment.create({
        data: {
          attachmentHash: 'default-hash',
          filename: 'default.txt',
          checksumSha256: 'default-sha',
          canonicalMessageId: 'default-msg',
          parsed: true,
        },
      });

      await prisma.extractedRequirement.createMany({
        data: [
          {
            attachmentHash: 'default-hash',
            category: 'soil',
            requirementLevel: 'mandatory',
            requirementText: 'Req A',
            municipality: 'Stockholm',
          },
          {
            attachmentHash: 'default-hash',
            category: 'sampling',
            requirementLevel: 'mandatory',
            requirementText: 'Req B',
            municipality: 'Stockholm',
          },
          {
            attachmentHash: 'default-hash',
            category: 'sampling',
            requirementLevel: 'mandatory',
            requirementText: 'Req C',
            municipality: 'Uppsala',
          },
        ],
      });

      const stats = await getRequirementStats();
      expect(stats.total).toBe(3);
      expect(stats.byCategory.length).toBe(2);
      expect(stats.byMunicipality.length).toBe(2);
    });

    it('returns zero counts for empty database', async () => {
      const stats = await getRequirementStats();
      expect(stats.total).toBe(0);
      expect(stats.byCategory).toEqual([]);
      expect(stats.byMunicipality).toEqual([]);
    });
  });
});
