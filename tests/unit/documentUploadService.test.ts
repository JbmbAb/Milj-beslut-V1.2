import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  fsMkdir: vi.fn(),
  fsWriteFile: vi.fn(),
  fsUnlink: vi.fn(),
  upsertDocumentFromManifest: vi.fn(),
  enqueueSearchJob: vi.fn(),
  appendDomainAudit: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  default: {
    mkdir: mocks.fsMkdir,
    writeFile: mocks.fsWriteFile,
    unlink: mocks.fsUnlink,
  },
}));

vi.mock('../../server/repositories/searchRepository', () => ({
  upsertDocumentFromManifest: mocks.upsertDocumentFromManifest,
  enqueueSearchJob: mocks.enqueueSearchJob,
}));

vi.mock('../../server/security/auditTrail', () => ({
  appendDomainAudit: mocks.appendDomainAudit,
}));

import { uploadDocumentToProject } from '../../server/services/documentUploadService';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeInput(overrides: Partial<Parameters<typeof uploadDocumentToProject>[0]> = {}) {
  return {
    projectId: 'proj-1',
    organisationId: 'org-1',
    actingUserId: 'user-1',
    buffer: Buffer.from('PDF content'),
    originalName: 'report.pdf',
    mimeType: 'application/pdf',
    receivedTime: new Date('2024-01-01T00:00:00Z'),
    subject: 'Miljörapport',
    ...overrides,
  };
}

function setupHappyPath() {
  mocks.fsMkdir.mockResolvedValue(undefined);
  mocks.fsWriteFile.mockResolvedValue(undefined);
  mocks.upsertDocumentFromManifest.mockResolvedValue({
    id: 'doc-1',
    projectId: 'proj-1',
    organisationId: 'org-1',
    originalName: 'report.pdf',
    diskName: 'disk-report.pdf',
    absolutePath: '/storage/uploads/proj-1/disk-report.pdf',
    mimeType: 'application/pdf',
    status: 'PENDING',
  });
  mocks.enqueueSearchJob.mockResolvedValue({ id: 'job-1' });
  mocks.appendDomainAudit.mockResolvedValue({ id: 'audit-1' });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('documentUploadService – uploadDocumentToProject', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uploads a document and returns structured result', async () => {
    setupHappyPath();

    const result = await uploadDocumentToProject(makeInput());

    expect(mocks.fsMkdir).toHaveBeenCalledOnce();
    expect(mocks.fsWriteFile).toHaveBeenCalledOnce();
    expect(mocks.upsertDocumentFromManifest).toHaveBeenCalledOnce();
    expect(mocks.enqueueSearchJob).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'EXTRACT_TEXT', projectId: 'proj-1' }),
    );
    expect(mocks.appendDomainAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'DOCUMENT_UPLOADED', userId: 'user-1' }),
    );

    expect(result.document.id).toBe('doc-1');
    expect(result.searchJobId).toBe('job-1');
    expect(result.auditId).toBe('audit-1');
  });

  it('throws when buffer is empty', async () => {
    await expect(uploadDocumentToProject(makeInput({ buffer: Buffer.alloc(0) }))).rejects.toThrow(
      'Upload body is empty',
    );

    expect(mocks.fsWriteFile).not.toHaveBeenCalled();
  });

  it('sanitises malicious filenames', async () => {
    setupHappyPath();

    await uploadDocumentToProject(makeInput({ originalName: '../../../etc/passwd' }));

    // upsertDocumentFromManifest should receive sanitised name (no path traversal)
    const call = mocks.upsertDocumentFromManifest.mock.calls[0][0];
    expect(call.originalName).not.toContain('..');
    expect(call.originalName).not.toContain('/');
  });

  it('strips dangerous characters from filename', async () => {
    setupHappyPath();

    await uploadDocumentToProject(makeInput({ originalName: 'file<bad>:name?.pdf' }));

    const call = mocks.upsertDocumentFromManifest.mock.calls[0][0];
    expect(call.originalName).not.toMatch(/[<>:?]/);
  });

  it('infers mimeType from extension when mimeType is null', async () => {
    setupHappyPath();

    await uploadDocumentToProject(makeInput({ originalName: 'photo.png', mimeType: null }));

    const call = mocks.upsertDocumentFromManifest.mock.calls[0][0];
    expect(call.mimeType).toBe('image/png');
  });

  it('computes a SHA-256 hash of the file contents', async () => {
    setupHappyPath();

    const buf = Buffer.from('specific-content');
    await uploadDocumentToProject(makeInput({ buffer: buf }));

    const call = mocks.upsertDocumentFromManifest.mock.calls[0][0];
    expect(call.fileSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('deletes the written file when upsertDocumentFromManifest fails', async () => {
    mocks.fsMkdir.mockResolvedValue(undefined);
    mocks.fsWriteFile.mockResolvedValue(undefined);
    mocks.upsertDocumentFromManifest.mockRejectedValue(new Error('DB error'));
    mocks.fsUnlink.mockResolvedValue(undefined);

    await expect(uploadDocumentToProject(makeInput())).rejects.toThrow('DB error');

    expect(mocks.fsUnlink).toHaveBeenCalledOnce();
  });

  it('uses provided receivedTime in the result', async () => {
    setupHappyPath();
    const receivedTime = new Date('2023-06-15T12:00:00Z');

    const result = await uploadDocumentToProject(makeInput({ receivedTime }));

    expect(result.document.receivedTime).toBe(receivedTime.toISOString());
  });

  it('creates upload directory inside projectId subfolder', async () => {
    setupHappyPath();

    await uploadDocumentToProject(makeInput({ projectId: 'proj-XYZ' }));

    const mkdirArg = mocks.fsMkdir.mock.calls[0][0] as string;
    expect(mkdirArg).toContain('proj-XYZ');
  });

  it('uses subject from input if provided', async () => {
    setupHappyPath();

    await uploadDocumentToProject(makeInput({ subject: 'Tillståndsansökan' }));

    const call = mocks.upsertDocumentFromManifest.mock.calls[0][0];
    expect(call.subject).toBe('Tillståndsansökan');
  });

  it('generates a default subject when none is provided', async () => {
    setupHappyPath();

    await uploadDocumentToProject(makeInput({ subject: undefined, originalName: 'report.pdf' }));

    const call = mocks.upsertDocumentFromManifest.mock.calls[0][0];
    expect(call.subject).toContain('report.pdf');
  });
});
