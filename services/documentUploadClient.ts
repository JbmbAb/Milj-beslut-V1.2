export interface ProjectDocumentUploadResult {
  ok: true;
  document: {
    id: string;
    projectId: string;
    organisationId: string;
    originalName: string;
    diskName: string;
    absolutePath: string;
    mimeType: string | null;
    status: string;
    fileSize: number;
    fileSha256: string;
    receivedTime: string | null;
    subject: string;
  };
  searchJobId: string;
  auditId: string;
}

export interface UploadProjectDocumentInput {
  file: File;
  projectId: string;
  token: string;
  subject?: string;
}

function extractError(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== 'object') return fallback;
  const record = payload as Record<string, unknown>;
  if (typeof record.error === 'string' && record.error.trim()) return record.error;
  return fallback;
}

export async function uploadProjectDocument(input: UploadProjectDocumentInput): Promise<ProjectDocumentUploadResult> {
  const projectId = String(input.projectId || '').trim();
  const token = String(input.token || '').trim();
  const originalName = String(input.file?.name || '').trim();

  if (!projectId) throw new Error('projectId saknas');
  if (!token) throw new Error('Admin-token saknas');
  if (!originalName) throw new Error('Filnamn saknas');

  const params = new URLSearchParams({
    projectId,
    originalName,
  });

  const subject = String(input.subject || '').trim();
  if (subject) {
    params.set('subject', subject);
  }

  const response = await fetch(`/api/documents/upload?${params.toString()}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': input.file.type || 'application/octet-stream',
    },
    body: input.file,
  });

  const payload = (await response.json().catch(() => null)) as ProjectDocumentUploadResult | { ok?: false; error?: string } | null;
  if (!response.ok || !payload || payload.ok !== true) {
    throw new Error(extractError(payload, `HTTP ${response.status}`));
  }

  return payload;
}
