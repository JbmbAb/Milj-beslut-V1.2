import crypto from 'node:crypto';
import path from 'node:path';
import { appendDomainAudit } from '../security/auditTrail';
import { enqueueSearchJob, upsertDocumentFromManifest } from '../repositories/searchRepository';
import {
  buildGcsObjectUri,
  deleteStorageFile,
  gcsDocumentsEnabled,
  writeStorageFile,
} from './documentObjectStorage';

const DEFAULT_UPLOAD_ROOT = path.join(process.cwd(), 'storage', 'uploads');

function resolveDocumentStorageRoot(): string {
  return process.env.DOCUMENT_STORAGE_ROOT?.trim() || DEFAULT_UPLOAD_ROOT;
}

export interface UploadDocumentInput {
  projectId: string;
  organisationId: string;
  actingUserId: string;
  buffer: Buffer;
  originalName: string;
  subject?: string;
  mimeType?: string | null;
  receivedTime?: Date | null;
}

export interface UploadDocumentResult {
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

function sanitizeFilename(input: string): string {
  const base = path.basename(String(input || '').trim() || 'document.bin');
  const sanitized = base.replace(/[<>:"/\\|?*\u0000-\u001F]+/g, '_').trim();
  return sanitized || 'document.bin';
}

function extensionFromMimeType(mimeType: string | null | undefined): string {
  const normalized = String(mimeType || '')
    .trim()
    .toLowerCase();
  const map: Record<string, string> = {
    'application/pdf': '.pdf',
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/jpg': '.jpg',
    'image/tiff': '.tif',
    'image/webp': '.webp',
    'text/plain': '.txt',
    'text/markdown': '.md',
    'application/json': '.json',
  };
  return map[normalized] || '.bin';
}

function normalizeMimeType(mimeType: string | null | undefined, filename: string): string | null {
  const cleaned = String(mimeType || '')
    .trim()
    .toLowerCase();
  if (cleaned && cleaned !== 'application/octet-stream') {
    return cleaned;
  }

  const ext = path.extname(filename).toLowerCase();
  const map: Record<string, string> = {
    '.pdf': 'application/pdf',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.tif': 'image/tiff',
    '.tiff': 'image/tiff',
    '.webp': 'image/webp',
    '.txt': 'text/plain',
    '.md': 'text/markdown',
    '.json': 'application/json',
  };
  return map[ext] || null;
}

function createDiskName(filename: string, mimeType: string | null): string {
  const ext = path.extname(filename).toLowerCase() || extensionFromMimeType(mimeType);
  return `${Date.now()}-${crypto.randomUUID()}${ext}`;
}

export async function uploadDocumentToProject(input: UploadDocumentInput): Promise<UploadDocumentResult> {
  if (!Buffer.isBuffer(input.buffer) || input.buffer.length === 0) {
    throw new Error('Upload body is empty');
  }

  const originalName = sanitizeFilename(input.originalName);
  const mimeType = normalizeMimeType(input.mimeType, originalName);
  const diskName = createDiskName(originalName, mimeType);
  const entryId = `UPLOAD-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const uploadDir = path.join(resolveDocumentStorageRoot(), input.projectId);
  const localAbsolutePath = path.join(uploadDir, diskName);
  const absolutePath = gcsDocumentsEnabled()
    ? buildGcsObjectUri(input.projectId, diskName)
    : localAbsolutePath;
  const fileSha256 = crypto.createHash('sha256').update(input.buffer).digest('hex');
  const receivedTime = input.receivedTime ?? new Date();
  const subject = String(input.subject || '').trim() || `Uppladdat dokument: ${originalName}`;

  let fileWritten = false;
  try {
    await writeStorageFile(absolutePath, input.buffer, mimeType || 'application/octet-stream');
    fileWritten = true;

    const document = await upsertDocumentFromManifest({
      projectId: input.projectId,
      organisationId: input.organisationId,
      entryId,
      receivedTime,
      subject,
      originalName,
      diskName,
      absolutePath,
      fileSize: BigInt(input.buffer.length),
      fileSha256,
      mimeType,
      manifestMeta: {
        source: 'api.documents.upload',
        uploadedBy: input.actingUserId,
        uploadedAt: new Date().toISOString(),
      },
    });

    const job = await enqueueSearchJob({
      type: 'EXTRACT_TEXT',
      projectId: input.projectId,
      payload: { documentId: String(document.id) },
    });

    const audit = await appendDomainAudit({
      entityType: 'DOCUMENT',
      entityId: String(document.id),
      action: 'DOCUMENT_UPLOADED',
      userId: input.actingUserId,
      payload: {
        projectId: input.projectId,
        originalName,
        diskName,
        mimeType,
        fileSize: input.buffer.length,
        fileSha256,
      },
    });

    return {
      document: {
        id: String(document.id),
        projectId: String(document.projectId),
        organisationId: String(document.organisationId),
        originalName: String(document.originalName),
        diskName: String(document.diskName),
        absolutePath: String(document.absolutePath),
        mimeType: document.mimeType ? String(document.mimeType) : null,
        status: String(document.status),
        fileSize: input.buffer.length,
        fileSha256,
        receivedTime: receivedTime ? receivedTime.toISOString() : null,
        subject,
      },
      searchJobId: String(job.id),
      auditId: String(audit.id),
    };
  } catch (error) {
    if (fileWritten) {
      await deleteStorageFile(absolutePath).catch(() => undefined);
    }
    throw error;
  }
}
