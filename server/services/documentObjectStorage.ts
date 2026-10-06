/**
 * Persistent fil-lagring: lokal disk (utveckling) eller Google Cloud Storage (produktion).
 * I Cloud Run ska GCS (eller annan object store) användas — container-filsystemet är flyktigt.
 *
 * Spara `absolutePath` i DB som:
 *   - lokal: absolut sökväg, t.ex. /app/storage/...
 *   - GCS:   gs://<bucket>/<objectKey>
 */

import { createReadStream, promises as fsp } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { logger } from '../logger';

function rejectRetiredGcs(ref: string): void {
  if (isGcsUri(ref)) {
    throw new Error('GCS is retired. Use a local filesystem path.');
  }
}

export function isGcsUri(ref: string): boolean {
  return String(ref || '')
    .trim()
    .startsWith('gs://');
}

export function gcsDocumentsEnabled(): boolean {
  return false;
}

/** gs://bucket/object/key → { bucket, name } */
export function parseGsUri(ref: string): { bucket: string; name: string } {
  const s = String(ref || '').replace(/^gs:\/\//, '');
  const i = s.indexOf('/');
  if (i === -1 || i === 0) {
    throw new Error(`Ogiltig gs://-URI: ${ref}`);
  }
  return { bucket: s.slice(0, i), name: s.slice(i + 1) };
}

export function buildGcsObjectUri(projectId: string, diskName: string): string {
  const bucket = String(process.env.GCS_DOCUMENTS_BUCKET || '').trim();
  if (!bucket) {
    throw new Error('GCS_DOCUMENTS_BUCKET saknas');
  }
  const prefix = String(process.env.GCS_DOCUMENTS_PREFIX || 'documents').replace(/^\/+|\/+$/g, '');
  const safeProject = String(projectId || '').replace(/[^a-zA-Z0-9._-]+/g, '_');
  const key = `${prefix}/${safeProject}/${diskName}`;
  return `gs://${bucket}/${key}`;
}

/**
 * För uppladdning: skriv buffer till mål. Vid GCS: `targetUri` ska vara `buildGcsObjectUri(...)`.
 * Vid lokal: `targetUri` är absolut filesystem-path.
 */
export async function writeStorageFile(targetUri: string, body: Buffer, _contentType?: string): Promise<void> {
  rejectRetiredGcs(targetUri);

  if (process.env.K_SERVICE) {
    logger.warn('document-storage: writing to local filesystem in a Cloud Run environment', { targetUri });
  }

  await fsp.mkdir(path.dirname(targetUri), { recursive: true });
  await fsp.writeFile(targetUri, body);
}

export async function readStorageFile(absolutePath: string): Promise<Buffer> {
  rejectRetiredGcs(absolutePath);

  if (process.env.K_SERVICE) {
    logger.warn('document-storage: reading from local filesystem in a Cloud Run environment', {
      absolutePath,
    });
  }

  return fsp.readFile(absolutePath);
}

export function createStorageReadStream(absolutePath: string): Readable {
  rejectRetiredGcs(absolutePath);
  return createReadStream(absolutePath);
}

export async function storageFileExists(absolutePath: string): Promise<boolean> {
  try {
    if (isGcsUri(absolutePath)) return false;
    await fsp.access(absolutePath);
    return true;
  } catch {
    return false;
  }
}

export async function deleteStorageFile(absolutePath: string): Promise<void> {
  if (!absolutePath) return;
  try {
    rejectRetiredGcs(absolutePath);

    if (process.env.K_SERVICE) {
      logger.warn('document-storage: deleting from local filesystem in a Cloud Run environment', {
        absolutePath,
      });
    }

    await fsp.unlink(absolutePath);
  } catch (err) {
    logger.warn('deleteStorageFile', { path: absolutePath, err: String(err) });
  }
}

export async function statStorageFile(
  absolutePath: string,
): Promise<{ size: bigint; mtimeMs: number } | null> {
  try {
    rejectRetiredGcs(absolutePath);
    const s = await fsp.stat(absolutePath);
    return { size: BigInt(s.size), mtimeMs: s.mtimeMs };
  } catch {
    return null;
  }
}
