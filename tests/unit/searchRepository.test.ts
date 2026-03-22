import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  documentRecordUpsert: vi.fn(),
  documentRecordFindUnique: vi.fn(),
  documentRecordDelete: vi.fn(),
  documentRecordUpdate: vi.fn(),
  documentRecordFindMany: vi.fn(),
  documentRecordGroupBy: vi.fn(),
  documentRecordCount: vi.fn(),
  documentContentUpsert: vi.fn(),
  documentChunkDeleteMany: vi.fn(),
  documentChunkCreate: vi.fn(),
  documentChunkUpdate: vi.fn(),
  documentChunkFindMany: vi.fn(),
  documentChunkCount: vi.fn(),
  searchJobFindMany: vi.fn(),
  searchJobFindFirst: vi.fn(),
  searchJobCreate: vi.fn(),
  searchJobUpdate: vi.fn(),
  searchJobFindUnique: vi.fn(),
  searchJobGroupBy: vi.fn(),
  searchJobCount: vi.fn(),
  searchJobUpdateMany: vi.fn(),
  projectFindMany: vi.fn(),
  projectFindFirst: vi.fn(),
  projectCreate: vi.fn(),
  projectFindUnique: vi.fn(),
  projectMemberUpsert: vi.fn(),
  transaction: vi.fn(),
  executeRawUnsafe: vi.fn(),
  queryRawUnsafe: vi.fn(),
}));

vi.mock('../../server/db/prisma', () => ({
  prisma: {
    documentRecord: {
      upsert: mocks.documentRecordUpsert,
      findUnique: mocks.documentRecordFindUnique,
      delete: mocks.documentRecordDelete,
      update: mocks.documentRecordUpdate,
      findMany: mocks.documentRecordFindMany,
      groupBy: mocks.documentRecordGroupBy,
      count: mocks.documentRecordCount,
    },
    documentContent: {
      upsert: mocks.documentContentUpsert,
    },
    documentChunk: {
      deleteMany: mocks.documentChunkDeleteMany,
      create: mocks.documentChunkCreate,
      update: mocks.documentChunkUpdate,
      findMany: mocks.documentChunkFindMany,
      count: mocks.documentChunkCount,
    },
    searchJob: {
      findMany: mocks.searchJobFindMany,
      findFirst: mocks.searchJobFindFirst,
      create: mocks.searchJobCreate,
      update: mocks.searchJobUpdate,
      findUnique: mocks.searchJobFindUnique,
      groupBy: mocks.searchJobGroupBy,
      count: mocks.searchJobCount,
      updateMany: mocks.searchJobUpdateMany,
    },
    project: {
      findMany: mocks.projectFindMany,
      findFirst: mocks.projectFindFirst,
      create: mocks.projectCreate,
      findUnique: mocks.projectFindUnique,
    },
    projectMember: {
      upsert: mocks.projectMemberUpsert,
    },
    $transaction: mocks.transaction,
    $executeRawUnsafe: mocks.executeRawUnsafe,
    $queryRawUnsafe: mocks.queryRawUnsafe,
  },
}));

import {
  createOrGetAdminProject,
  deleteDocumentById,
  enqueueSearchJob,
  getNextPendingJob,
  getSearchStatus,
  markJobFailedOrRetry,
  recoverStaleRunningJobs,
  replaceDocumentChunks,
  requeueFailedJobs,
  upsertDocumentFromManifest,
} from '../../server/repositories/searchRepository';

describe('searchRepository', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.documentRecordUpsert.mockResolvedValue({ id: 'doc-1' });
    mocks.searchJobFindMany.mockResolvedValue([]);
    mocks.searchJobCreate.mockResolvedValue({ id: 'job-1', status: 'PENDING' });
    mocks.searchJobFindFirst.mockResolvedValue(null);
    mocks.searchJobFindUnique.mockResolvedValue({ attempts: 1 });
    mocks.searchJobUpdate.mockResolvedValue(undefined);
    mocks.searchJobUpdateMany.mockResolvedValue({ count: 0 });
    mocks.documentRecordFindUnique.mockResolvedValue(null);
    mocks.transaction.mockImplementation(async (callback: (tx: any) => Promise<void>) =>
      callback({
        $executeRawUnsafe: vi.fn(async () => 2),
        documentRecord: {
          delete: vi.fn(async () => undefined),
        },
      }),
    );
    mocks.documentChunkDeleteMany.mockResolvedValue(undefined);
    mocks.documentChunkCreate.mockResolvedValue(undefined);
    mocks.documentRecordGroupBy.mockResolvedValue([
      { status: 'METADATA_ONLY', _count: { _all: 2 } },
      { status: 'EMBEDDED', _count: { _all: 3 } },
      { status: 'FAILED', _count: { _all: 1 } },
    ]);
    mocks.searchJobGroupBy.mockResolvedValue([
      { status: 'PENDING', _count: { _all: 4 } },
      { status: 'RUNNING', _count: { _all: 2 } },
      { status: 'DONE', _count: { _all: 7 } },
      { status: 'FAILED', _count: { _all: 1 } },
    ]);
    mocks.documentRecordCount.mockResolvedValue(6);
    mocks.documentChunkCount.mockResolvedValueOnce(20).mockResolvedValueOnce(15);
    mocks.searchJobCount.mockResolvedValue(1);
    mocks.projectFindFirst.mockResolvedValue(null);
    mocks.projectCreate.mockResolvedValue({ id: 'project-2' });
    mocks.projectFindUnique.mockResolvedValue({
      id: 'project-2',
      propertyDesignation: 'Demo 2:2',
      status: 'ACTIVE',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      organisation: { id: 'org-1', name: 'Org 1', orgNumber: '556677-8899' },
      _count: { documents: 0, members: 1, accessLogs: 0 },
    });
    mocks.projectMemberUpsert.mockResolvedValue(undefined);
    mocks.projectFindMany.mockResolvedValue([{ id: 'project-2' }]);
  });

  it('upserts manifest documents and preserves status only when requested', async () => {
    await upsertDocumentFromManifest({
      projectId: 'project-1',
      organisationId: 'org-1',
      entryId: 'entry-1',
      receivedTime: new Date('2026-01-01T00:00:00.000Z'),
      subject: 'Ärende',
      originalName: 'doc.pdf',
      diskName: 'doc-1.pdf',
      absolutePath: 'C:/docs/doc-1.pdf',
      preserveStatusOnUpdate: true,
    });

    expect(mocks.documentRecordUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { diskName: 'doc-1.pdf' },
        create: expect.objectContaining({
          status: 'METADATA_ONLY',
        }),
        update: expect.not.objectContaining({
          status: 'METADATA_ONLY',
        }),
      }),
    );
  });

  it('deduplicates active jobs by document and creates new jobs when needed', async () => {
    mocks.searchJobFindMany.mockResolvedValueOnce([
      {
        id: 'job-existing',
        payload: { documentId: 'doc-1' },
      },
    ]);

    const existing = await enqueueSearchJob({
      type: 'EXTRACT_TEXT',
      projectId: 'project-1',
      payload: { documentId: 'doc-1' },
    });

    expect(existing.id).toBe('job-existing');
    expect(mocks.searchJobCreate).not.toHaveBeenCalled();

    mocks.searchJobFindMany.mockResolvedValueOnce([]);
    const created = await enqueueSearchJob({
      type: 'SYNC_MANIFEST',
      projectId: 'project-1',
      payload: {},
    });

    expect(created.id).toBe('job-1');
    expect(mocks.searchJobCreate).toHaveBeenCalledWith({
      data: {
        type: 'SYNC_MANIFEST',
        projectId: 'project-1',
        payload: {},
        status: 'PENDING',
      },
    });
  });

  it('prefers prioritized pending jobs and falls back when none exist', async () => {
    mocks.searchJobFindFirst
      .mockResolvedValueOnce({ id: 'job-embed', type: 'EMBED_DOC' })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'job-any', type: 'EXTRACT_TEXT' });

    const prioritized = await getNextPendingJob('EMBED_DOC');
    expect(prioritized).toEqual({ id: 'job-embed', type: 'EMBED_DOC' });

    const fallback = await getNextPendingJob('EMBED_DOC');
    expect(fallback).toEqual({ id: 'job-any', type: 'EXTRACT_TEXT' });
  });

  it('requeues, fails and handles missing jobs based on attempt counts', async () => {
    const requeued = await markJobFailedOrRetry('job-1', 'temporary error', 3);
    expect(requeued).toEqual({ status: 'REQUEUED', attempts: 1 });

    mocks.searchJobFindUnique.mockResolvedValueOnce({ attempts: 3 });
    const failed = await markJobFailedOrRetry('job-2', 'fatal error', 3);
    expect(failed).toEqual({ status: 'FAILED', attempts: 3 });

    mocks.searchJobFindUnique.mockResolvedValueOnce(null);
    const missing = await markJobFailedOrRetry('job-missing', 'missing', 3);
    expect(missing).toEqual({ status: 'FAILED', attempts: 0 });
  });

  it('deletes documents transactionally and returns null for unknown IDs', async () => {
    const missing = await deleteDocumentById('missing-doc');
    expect(missing).toBeNull();

    mocks.documentRecordFindUnique.mockResolvedValueOnce({
      id: 'doc-1',
      projectId: 'project-1',
      organisationId: 'org-1',
      originalName: 'doc.pdf',
      absolutePath: 'C:/docs/doc.pdf',
      mimeType: 'application/pdf',
    });

    const deleted = await deleteDocumentById('doc-1');
    expect(deleted).toEqual(
      expect.objectContaining({
        id: 'doc-1',
        deletedSearchJobs: 2,
      }),
    );
  });

  it('replaces document chunks by clearing old rows and inserting new ones', async () => {
    await replaceDocumentChunks({
      documentId: 'doc-1',
      chunks: [
        { chunkIndex: 0, chunkText: 'Första chunken' },
        { chunkIndex: 1, chunkText: 'Andra chunken', embeddingJson: [0.1, 0.2] },
      ],
    });

    expect(mocks.documentChunkDeleteMany).toHaveBeenCalledWith({
      where: { documentId: 'doc-1' },
    });
    expect(mocks.documentChunkCreate).toHaveBeenCalledTimes(2);
  });

  it('builds search status summaries and recovers stale or failed jobs', async () => {
    const status = await getSearchStatus('project-1');
    expect(status.summary).toEqual({
      documentsTotal: 6,
      metadataOnlyDocuments: 2,
      textExtractedDocuments: 0,
      embeddedDocuments: 3,
      failedDocuments: 1,
      jobsPending: 4,
      jobsRunning: 2,
      jobsDone: 7,
      jobsFailed: 1,
      staleRunningJobs: 1,
      totalChunks: 20,
      embeddedChunks: 15,
      chunkEmbeddingCoveragePct: 75,
    });

    mocks.searchJobFindMany.mockResolvedValueOnce([]);
    const recoveredNone = await recoverStaleRunningJobs({ projectId: 'project-1', limit: 5 });
    expect(recoveredNone).toBe(0);

    mocks.searchJobFindMany.mockResolvedValueOnce([{ id: 'job-1' }, { id: 'job-2' }]);
    const recovered = await recoverStaleRunningJobs({ projectId: 'project-1', maxAgeMinutes: 10, limit: 5 });
    expect(recovered).toBe(2);
    expect(mocks.searchJobUpdateMany).toHaveBeenCalled();

    mocks.searchJobFindMany.mockResolvedValueOnce([]);
    expect(await requeueFailedJobs('project-1', 10)).toBe(0);

    mocks.searchJobFindMany.mockResolvedValueOnce([{ id: 'job-3' }, { id: 'job-4' }]);
    expect(await requeueFailedJobs('project-1', 10)).toBe(2);
  });

  it('creates admin projects or attaches owners to existing ones', async () => {
    mocks.projectFindFirst.mockResolvedValueOnce({
      id: 'project-existing',
      propertyDesignation: 'Demo 1:1',
      status: 'ACTIVE',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      organisation: { id: 'org-1', name: 'Org 1', orgNumber: '556677-8899' },
      _count: { documents: 2, members: 1, accessLogs: 0 },
    });

    const existing = await createOrGetAdminProject({
      organisationId: 'org-1',
      userId: 'admin-1',
      propertyDesignation: 'Demo 1:1',
    });

    expect(existing.created).toBe(false);
    expect(mocks.projectMemberUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          projectId_userId: {
            projectId: 'project-existing',
            userId: 'admin-1',
          },
        },
      }),
    );

    const created = await createOrGetAdminProject({
      organisationId: 'org-1',
      userId: 'admin-1',
      propertyDesignation: 'Demo 2:2',
    });

    expect(created.created).toBe(true);
    expect(created.project.id).toBe('project-2');
  });
});
