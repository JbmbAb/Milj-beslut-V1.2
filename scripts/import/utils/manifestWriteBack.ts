/**
 * Drive manifest write-back for Librarian QA lifecycle (async, non-blocking for PostGIS).
 */
import { execFileSync } from 'child_process';
import fs from 'fs';
import fsPromises from 'fs/promises';
import os from 'os';
import path from 'path';
import {
  type ArchiveManifestV2,
  applyQaPatch,
  ensureArchiveManifestV2,
  type QAStatus,
  validateArchiveManifestStructure,
} from '../types/manifestSchema';

export type ManifestQAUpdate = {
  qa_status: QAStatus;
  qa_at?: string;
  qa_error?: string;
  expected_columns?: string[];
  invalidated_by?: string;
};

export interface ManifestWriteBackOptions {
  rcloneRemote?: string;
  rcloneConfigDir?: string;
  /** When set, skip rclone download (manifest already validated in Librarian). */
  baseManifest?: ArchiveManifestV2;
  logger?: Pick<Console, 'log' | 'warn' | 'error'>;
}

const ROOT = process.cwd();
export const DEFAULT_RCLONE_CONFIG = path.join(ROOT, 'storage', 'rclone');
export const DEFAULT_DATA_REMOTE = 'drive:GEO_Master_Archive/Data';

export function resolveManifestRemotePath(
  provider: string,
  dataset: string,
  version: string,
  rcloneRemote: string = DEFAULT_DATA_REMOTE,
): string {
  return `${rcloneRemote}/${provider}/${dataset}/${version}/manifest.json`;
}

export function formatQaError(error: unknown): string {
  const err = error instanceof Error ? error : new Error(String(error));
  const code = (err as Error & { code?: string }).code;
  return `[${code || 'QA_ERROR'}] ${err.message}`;
}

export function mergeManifestQaUpdate(
  manifest: ArchiveManifestV2,
  update: ManifestQAUpdate,
): ArchiveManifestV2 {
  const merged = applyQaPatch(manifest, {
    qa_status: update.qa_status,
    qa_error: update.qa_error,
    invalidated_by: update.invalidated_by,
  });
  if (update.qa_at) merged.qa_at = update.qa_at;
  if (update.expected_columns?.length) merged.expected_columns = update.expected_columns;
  return merged;
}

/** Always persist QA state to the canonical manifest.json beside the bundle (H: / Master Archive). */
export function updateManifestStateLocal(
  manifestPath: string,
  baseManifest: ArchiveManifestV2,
  update: ManifestQAUpdate,
): ArchiveManifestV2 {
  const updated = mergeManifestQaUpdate(ensureArchiveManifestV2(baseManifest), {
    ...update,
    qa_at: update.qa_at ?? new Date().toISOString(),
  });
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, `${JSON.stringify(updated, null, 2)}\n`, 'utf8');
  return updated;
}

function rcloneDockerCopyto(localFile: string, remotePath: string, configDir: string): void {
  execFileSync(
    'docker',
    [
      'run',
      '--rm',
      '-v',
      `${configDir}:/config/rclone:ro`,
      '-v',
      `${path.resolve(localFile)}:/tmp/manifest.json:ro`,
      'rclone/rclone',
      'copyto',
      '/tmp/manifest.json',
      remotePath,
      '--config',
      '/config/rclone/rclone.conf',
    ],
    { stdio: 'pipe' },
  );
}

function rcloneDockerCopyfrom(remotePath: string, localFile: string, configDir: string): void {
  fs.mkdirSync(path.dirname(localFile), { recursive: true });
  const mountDir = path.dirname(localFile);
  execFileSync(
    'docker',
    [
      'run',
      '--rm',
      '-v',
      `${configDir}:/config/rclone:ro`,
      '-v',
      `${path.resolve(mountDir)}:/tmp/out`,
      'rclone/rclone',
      'copyto',
      remotePath,
      '/tmp/out/manifest.json',
      '--config',
      '/config/rclone/rclone.conf',
    ],
    { stdio: 'pipe' },
  );
}

function localTempManifestPath(provider: string, dataset: string, version: string): string {
  const safe = (s: string) => s.replace(/[^\w.-]+/g, '_');
  return path.join(
    os.tmpdir(),
    'librarian_manifests',
    safe(provider),
    ...dataset.split('/').map(safe),
    safe(version),
    'manifest.json',
  );
}

/**
 * Download (or reuse baseManifest), merge QA fields, upload to Drive.
 * Never throws — PostGIS success must not depend on Drive upload.
 */
export async function updateManifestStateOnDrive(
  provider: string,
  dataset: string,
  version: string,
  update: ManifestQAUpdate,
  options: ManifestWriteBackOptions = {},
): Promise<{ ok: boolean; remotePath: string; error?: string }> {
  const log = options.logger ?? console;
  const configDir = options.rcloneConfigDir ?? DEFAULT_RCLONE_CONFIG;
  const remotePath = resolveManifestRemotePath(provider, dataset, version, options.rcloneRemote);
  const localFile = localTempManifestPath(provider, dataset, version);

  try {
    let manifest: ArchiveManifestV2;

    if (options.baseManifest) {
      manifest = options.baseManifest;
    } else if (fs.existsSync(localFile)) {
      const raw = await fsPromises.readFile(localFile, 'utf8');
      const parsed = JSON.parse(raw) as unknown;
      const validated = validateArchiveManifestStructure(parsed);
      if (!validated.ok) {
        throw new Error((validated as { ok: false; errors: string[] }).errors.join('; '));
      }
      manifest = validated.manifest;
    } else {
      await fsPromises.mkdir(path.dirname(localFile), { recursive: true });
      rcloneDockerCopyfrom(remotePath, localFile, configDir);
      const raw = await fsPromises.readFile(localFile, 'utf8');
      const parsed = JSON.parse(raw) as unknown;
      const validated = validateArchiveManifestStructure(parsed);
      if (!validated.ok) {
        throw new Error((validated as { ok: false; errors: string[] }).errors.join('; '));
      }
      manifest = validated.manifest;
    }

    const updated = mergeManifestQaUpdate(ensureArchiveManifestV2(manifest), {
      ...update,
      qa_at: update.qa_at ?? new Date().toISOString(),
    });

    await fsPromises.mkdir(path.dirname(localFile), { recursive: true });
    await fsPromises.writeFile(localFile, `${JSON.stringify(updated, null, 2)}\n`, 'utf8');
    rcloneDockerCopyto(localFile, remotePath, configDir);

    log.log(`[Write-Back] OK ${provider}/${dataset} [${version}] -> ${update.qa_status}`);
    return { ok: true, remotePath };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error(`[Write-Back] Drive sync failed for ${remotePath}: ${message}`);
    return { ok: false, remotePath, error: message };
  }
}

/** Fire-and-forget wrapper; attach to a queue and await allSettled before process exit. */
export function scheduleManifestWriteBack(
  queue: Array<Promise<{ ok: boolean; remotePath: string; error?: string }>>,
  provider: string,
  dataset: string,
  version: string,
  update: ManifestQAUpdate,
  options: ManifestWriteBackOptions = {},
): void {
  queue.push(updateManifestStateOnDrive(provider, dataset, version, update, options));
}

export async function flushManifestWriteBackQueue(
  queue: Array<Promise<{ ok: boolean; remotePath: string; error?: string }>>,
): Promise<void> {
  if (queue.length === 0) return;
  const results = await Promise.allSettled(queue);
  const failed = results.filter(
    (r) => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value.ok),
  );
  if (failed.length > 0) {
    console.warn(`[Write-Back] ${failed.length}/${queue.length} manifest sync(s) did not complete OK`);
  }
}
