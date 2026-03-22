import { afterEach, describe, expect, it, vi } from 'vitest';
import { uploadProjectDocument } from '../../services/documentUploadClient';

describe('uploadProjectDocument', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('throws when projectId is missing', async () => {
    const file = Object.assign(new Blob(['test'], { type: 'application/pdf' }), { name: 'test.pdf' }) as File;

    await expect(
      uploadProjectDocument({
        file,
        projectId: '',
        token: 'token',
      }),
    ).rejects.toThrow(/projectId saknas/i);
  });

  it('posts the raw file to the upload endpoint and returns payload', async () => {
    const file = Object.assign(new Blob(['pdf-data'], { type: 'application/pdf' }), {
      name: 'ansokan.pdf',
    }) as File;
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(_input)).toContain('/api/documents/upload?');
      expect(String(_input)).toContain('projectId=proj-1');
      expect(String(_input)).toContain('originalName=ansokan.pdf');
      expect(String(_input)).toContain('subject=Permit+upload');
      expect(init?.method).toBe('POST');
      expect(init?.headers).toMatchObject({
        Authorization: 'Bearer token-1',
        'Content-Type': 'application/pdf',
      });
      expect(init?.body).toBe(file);

      return new Response(
        JSON.stringify({
          ok: true,
          document: {
            id: 'doc-1',
            projectId: 'proj-1',
            organisationId: 'org-1',
            originalName: 'ansokan.pdf',
            diskName: 'stored.pdf',
            absolutePath: 'C:/tmp/stored.pdf',
            mimeType: 'application/pdf',
            status: 'METADATA_ONLY',
            fileSize: 8,
            fileSha256: 'abc123',
            receivedTime: '2026-03-20T12:00:00.000Z',
            subject: 'Permit upload',
          },
          searchJobId: 'job-1',
          auditId: 'audit-1',
        }),
        {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    });

    vi.stubGlobal('fetch', fetchMock);

    const result = await uploadProjectDocument({
      file,
      projectId: 'proj-1',
      token: 'token-1',
      subject: 'Permit upload',
    });

    expect(result.document.id).toBe('doc-1');
    expect(result.searchJobId).toBe('job-1');
    expect(result.auditId).toBe('audit-1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('surfaces API errors', async () => {
    const file = Object.assign(new Blob(['pdf-data'], { type: 'application/pdf' }), {
      name: 'ansokan.pdf',
    }) as File;
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ ok: false, error: 'Upload blocked' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }),
    );

    vi.stubGlobal('fetch', fetchMock);

    await expect(
      uploadProjectDocument({
        file,
        projectId: 'proj-1',
        token: 'token-1',
      }),
    ).rejects.toThrow(/Upload blocked/i);
  });
});
