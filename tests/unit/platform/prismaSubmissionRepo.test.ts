import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PrismaSubmissionRepository } from '../../../src/infrastructure/prisma-submission-repository';
import { prisma } from '../../../db.server';
import { SubmissionStatus, SubmissionChannel, SubmissionArtifactRole } from '../../../src/domain/submission';

vi.mock('../../../db.server', () => ({
  prisma: {
    submission: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
    },
    submissionArtifact: {
      create: vi.fn(),
    },
    submissionStatusEvent: {
      create: vi.fn(),
    },
  },
}));

describe('PrismaSubmissionRepository', () => {
  let repo: PrismaSubmissionRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = new PrismaSubmissionRepository();
  });

  it('should save a submission', async () => {
    const mockSubmission = {
      id: 'sub-1',
      submissionKey: 'AVLOPP-1',
      projectId: 'proj-1',
      organisationId: 'org-1',
      domain: 'SEWAGE',
      authorityName: 'Municipality',
      recipientChannel: SubmissionChannel.REST,
      status: SubmissionStatus.PREPARED,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    (prisma.submission.upsert as any).mockResolvedValue(mockSubmission);

    const result = await repo.save(mockSubmission as any);

    expect(prisma.submission.upsert).toHaveBeenCalled();
    expect(result.id).toBe('sub-1');
  });

  it('should log a status event', async () => {
    const mockEvent = {
      id: 'evt-1',
      submissionId: 'sub-1',
      status: SubmissionStatus.DISPATCHED,
      sourceSystem: 'TEST',
      summary: 'Test event',
      occurredAt: new Date(),
    };

    (prisma.submissionStatusEvent.create as any).mockResolvedValue(mockEvent);

    const result = await repo.logStatusEvent({
      submissionId: 'sub-1',
      status: SubmissionStatus.DISPATCHED,
      sourceSystem: 'TEST',
      summary: 'Test event',
      occurredAt: new Date(),
    });

    expect(prisma.submissionStatusEvent.create).toHaveBeenCalled();
    expect(result.status).toBe(SubmissionStatus.DISPATCHED);
  });

  it('should add an artifact', async () => {
    const mockArtifact = {
      id: 'art-1',
      submissionId: 'sub-1',
      role: SubmissionArtifactRole.PRIMARY_DOCUMENT,
      label: 'Doc 1',
    };

    (prisma.submissionArtifact.create as any).mockResolvedValue(mockArtifact);

    const result = await repo.addArtifact({
      submissionId: 'sub-1',
      role: SubmissionArtifactRole.PRIMARY_DOCUMENT,
      label: 'Doc 1',
    });

    expect(prisma.submissionArtifact.create).toHaveBeenCalled();
    expect(result.id).toBe('art-1');
  });
});
