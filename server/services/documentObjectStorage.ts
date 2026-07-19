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
import { Storage } from '@google-cloud/storage';
import { logger } from '../logger';

let storageClient: Storage | null = null;

function getGcsClient(): Storage {
  if (!storageClient) {
    storageClient = new Storage();
  }
  return storageClient;
}

export function isGcsUri(ref: string): boolean {
  return String(ref || '')
    .trim()
    .startsWith('gs://');
}

export function gcsDocumentsEnabled(): boolean {
  return Boolean(String(process.env.GCS_DOCUMENTS_BUCKET || '').trim());
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
export async function writeStorageFile(targetUri: string, body: Buffer, contentType?: string): Promise<void> {
  if (isGcsUri(targetUri)) {
    const { bucket, name } = parseGsUri(targetUri);
    const file = getGcsClient().bucket(bucket).file(name);
    await file.save(body, {
      resumable: false,
      metadata: contentType ? { contentType } : undefined,
    });
    return;
  }

  if (process.env.K_SERVICE) {
    logger.warn('document-storage: writing to local filesystem in a Cloud Run environment', { targetUri });
  }

  await fsp.mkdir(path.dirname(targetUri), { recursive: true });
  await fsp.writeFile(targetUri, body);
}

export async function readStorageFile(absolutePath: string): Promise<Buffer> {
  if (isGcsUri(absolutePath)) {
    const { bucket, name } = parseGsUri(absolutePath);
    const [buf] = await getGcsClient().bucket(bucket).file(name).download();
    return buf;
  }

  if (process.env.K_SERVICE) {
    logger.warn('document-storage: reading from local filesystem in a Cloud Run environment', {
      absolutePath,
    });
  }

  return fsp.readFile(absolutePath);
}

export function createStorageReadStream(absolutePath: string): Readable {
  if (isGcsUri(absolutePath)) {
    const { bucket, name } = parseGsUri(absolutePath);
    return getGcsClient().bucket(bucket).file(name).createReadStream();
  }
  return createReadStream(absolutePath);
}

export async function storageFileExists(absolutePath: string): Promise<boolean> {
  try {
    if (isGcsUri(absolutePath)) {
      const { bucket, name } = parseGsUri(absolutePath);
      const [exists] = await getGcsClient().bucket(bucket).file(name).exists();
      return Boolean(exists);
    }
    await fsp.access(absolutePath);
    return true;
  } catch {
    return false;
  }
}

export async function deleteStorageFile(absolutePath: string): Promise<void> {
  if (!absolutePath) return;
  try {
    if (isGcsUri(absolutePath)) {
      const { bucket, name } = parseGsUri(absolutePath);
      await getGcsClient().bucket(bucket).file(name).delete({ ignoreNotFound: true });
      return;
    }

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
    if (isGcsUri(absolutePath)) {
      const { bucket, name } = parseGsUri(absolutePath);
      const [meta] = await getGcsClient().bucket(bucket).file(name).getMetadata();
      const size = BigInt(String(meta.size ?? 0));
      const t = meta.updated ? Date.parse(String(meta.updated)) : Date.now();
      return { size, mtimeMs: t };
    }
    const s = await fsp.stat(absolutePath);
    return { size: BigInt(s.size), mtimeMs: s.mtimeMs };
  } catch {
    return null;
  }
}
