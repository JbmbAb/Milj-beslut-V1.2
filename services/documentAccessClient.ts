function extractError(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== 'object') return fallback;
  const record = payload as Record<string, unknown>;
  if (typeof record.error === 'string' && record.error.trim()) return record.error;
  return fallback;
}

function filenameFromDisposition(header: string | null, fallback: string): string {
  const raw = String(header || '').trim();
  if (!raw) return fallback;

  const utf8Match = raw.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1]);
    } catch {
      return utf8Match[1];
    }
  }

  const plainMatch = raw.match(/filename="([^"]+)"/i) || raw.match(/filename=([^;]+)/i);
  if (plainMatch?.[1]) {
    try {
      return decodeURIComponent(plainMatch[1].trim());
    } catch {
      return plainMatch[1].trim();
    }
  }

  return fallback;
}

async function fetchProjectDocumentBlob(
  path: string,
  token: string,
  fallbackFilename: string,
): Promise<{ blob: Blob; filename: string }> {
  const response = await fetch(path, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(extractError(payload, `HTTP ${response.status}`));
  }

  return {
    blob: await response.blob(),
    filename: filenameFromDisposition(response.headers.get('Content-Disposition'), fallbackFilename),
  };
}

function triggerDownload(blobUrl: string, filename: string) {
  const link = window.document.createElement('a');
  link.href = blobUrl;
  link.download = filename;
  link.rel = 'noopener noreferrer';
  link.click();
}

export interface OpenProjectDocumentInput {
  documentId: string;
  token: string;
  filename?: string;
}

export async function openProjectDocument(input: OpenProjectDocumentInput): Promise<void> {
  const documentId = String(input.documentId || '').trim();
  const token = String(input.token || '').trim();

  if (!documentId) throw new Error('documentId saknas');
  if (!token) throw new Error('Admin-token saknas');
  if (typeof window === 'undefined') throw new Error('Dokument kan bara oppnas i webblasaren');

  const { blob, filename } = await fetchProjectDocumentBlob(
    `/api/documents/${encodeURIComponent(documentId)}/view`,
    token,
    input.filename || 'document',
  );

  const blobUrl = window.URL.createObjectURL(blob);
  const opened = window.open(blobUrl, '_blank', 'noopener,noreferrer');

  if (!opened) {
    triggerDownload(blobUrl, filename);
  }

  window.setTimeout(() => {
    window.URL.revokeObjectURL(blobUrl);
  }, 60_000);
}

export interface DownloadProjectDocumentInput {
  documentId: string;
  token: string;
  filename?: string;
}

export async function downloadProjectDocument(input: DownloadProjectDocumentInput): Promise<void> {
  const documentId = String(input.documentId || '').trim();
  const token = String(input.token || '').trim();

  if (!documentId) throw new Error('documentId saknas');
  if (!token) throw new Error('Admin-token saknas');
  if (typeof window === 'undefined') throw new Error('Dokument kan bara laddas ned i webblasaren');

  const { blob, filename } = await fetchProjectDocumentBlob(
    `/api/documents/${encodeURIComponent(documentId)}/download`,
    token,
    input.filename || 'document',
  );

  const blobUrl = window.URL.createObjectURL(blob);
  triggerDownload(blobUrl, filename);
  window.setTimeout(() => {
    window.URL.revokeObjectURL(blobUrl);
  }, 60_000);
}

export interface DeleteProjectDocumentInput {
  documentId: string;
  token: string;
}

export interface DeleteProjectDocumentResult {
  ok: true;
  documentId: string;
  deletedSearchJobs: number;
  fileDeleted: boolean;
}

export async function deleteProjectDocument(
  input: DeleteProjectDocumentInput,
): Promise<DeleteProjectDocumentResult> {
  const documentId = String(input.documentId || '').trim();
  const token = String(input.token || '').trim();

  if (!documentId) throw new Error('documentId saknas');
  if (!token) throw new Error('Admin-token saknas');

  const response = await fetch(`/api/documents/${encodeURIComponent(documentId)}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(extractError(payload, `HTTP ${response.status}`));
  }

  return payload as DeleteProjectDocumentResult;
}
