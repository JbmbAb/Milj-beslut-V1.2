/**
 * Vite client stub for `server/services/documentObjectStorage`
 */

export function isGcsUri(ref: string): boolean {
  return String(ref || '').trim().startsWith('gs://');
}

export function gcsDocumentsEnabled(): boolean {
  return false;
}

export function parseGsUri(ref: string): { bucket: string; name: string } {
  const s = String(ref || '').replace(/^gs:\/\//, '');
  const i = s.indexOf('/');
  if (i === -1 || i === 0) {
    throw new Error(`Ogiltig gs://-URI: ${ref}`);
  }
  return { bucket: s.slice(0, i), name: s.slice(i + 1) };
}

export function buildGcsObjectUri(projectId: string, diskName: string): string {
  return `gs://mock-bucket/documents/${projectId}/${diskName}`;
}

export async function writeStorageFile(_targetUri: string, _body: any, _contentType?: string): Promise<void> {
  throw new Error('documentObjectStorage write is not available in browser');
}

export async function readStorageFile(_absolutePath: string): Promise<any> {
  throw new Error('documentObjectStorage read is not available in browser');
}

export function createStorageReadStream(_absolutePath: string): any {
  throw new Error('documentObjectStorage stream is not available in browser');
}

export async function storageFileExists(_absolutePath: string): Promise<boolean> {
  return false;
}

export async function deleteStorageFile(_absolutePath: string): Promise<void> {
  throw new Error('documentObjectStorage delete is not available in browser');
}

export async function statStorageFile(_absolutePath: string): Promise<null> {
  return null;
}
