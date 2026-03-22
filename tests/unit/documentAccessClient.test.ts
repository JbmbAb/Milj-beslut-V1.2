import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  deleteProjectDocument,
  downloadProjectDocument,
  openProjectDocument,
} from '../../services/documentAccessClient';

describe('openProjectDocument', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('throws when documentId is missing', async () => {
    await expect(
      openProjectDocument({
        documentId: '',
        token: 'token',
      }),
    ).rejects.toThrow(/documentId saknas/i);
  });

  it('fetches the document and opens a blob url', async () => {
    const createObjectURL = vi.fn(() => 'blob:test');
    const revokeObjectURL = vi.fn();
    const open = vi.fn(() => ({ closed: false }));
    vi.stubGlobal('window', {
      URL: { createObjectURL, revokeObjectURL },
      open,
      setTimeout,
      document: {
        createElement: vi.fn(() => ({
          click: vi.fn(),
        })),
      },
    });

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('/api/documents/doc-1/view');
      expect(init?.method).toBe('GET');
      expect(init?.headers).toMatchObject({
        Authorization: 'Bearer token-1',
      });
      return new Response(new Blob(['pdf-data'], { type: 'application/pdf' }), {
        status: 200,
        headers: { 'Content-Type': 'application/pdf' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    await openProjectDocument({
      documentId: 'doc-1',
      token: 'token-1',
      filename: 'ansokan.pdf',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith('blob:test', '_blank', 'noopener,noreferrer');
  });

  it('surfaces API errors', async () => {
    vi.stubGlobal('window', {
      URL: { createObjectURL: vi.fn(), revokeObjectURL: vi.fn() },
      open: vi.fn(),
      setTimeout,
      document: {
        createElement: vi.fn(() => ({
          click: vi.fn(),
        })),
      },
    });

    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ ok: false, error: 'Not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      openProjectDocument({
        documentId: 'doc-1',
        token: 'token-1',
      }),
    ).rejects.toThrow(/Not found/i);
  });

  it('downloads the document through the attachment endpoint', async () => {
    const createObjectURL = vi.fn(() => 'blob:download');
    const revokeObjectURL = vi.fn();
    const click = vi.fn();
    vi.stubGlobal('window', {
      URL: { createObjectURL, revokeObjectURL },
      open: vi.fn(),
      setTimeout,
      document: {
        createElement: vi.fn(() => ({
          click,
        })),
      },
    });

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('/api/documents/doc-2/download');
      expect(init?.method).toBe('GET');
      return new Response(new Blob(['pdf-data'], { type: 'application/pdf' }), {
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': 'attachment; filename="ansokan.pdf"',
        },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    await downloadProjectDocument({
      documentId: 'doc-2',
      token: 'token-2',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
  });

  it('deletes the document through the delete endpoint', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('/api/documents/doc-3');
      expect(init?.method).toBe('DELETE');
      expect(init?.headers).toMatchObject({
        Authorization: 'Bearer token-3',
      });
      return new Response(
        JSON.stringify({
          ok: true,
          documentId: 'doc-3',
          deletedSearchJobs: 2,
          fileDeleted: true,
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await deleteProjectDocument({
      documentId: 'doc-3',
      token: 'token-3',
    });

    expect(result.documentId).toBe('doc-3');
    expect(result.deletedSearchJobs).toBe(2);
    expect(result.fileDeleted).toBe(true);
  });
});
