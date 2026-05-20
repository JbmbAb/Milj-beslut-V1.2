import 'dotenv/config';
import * as fs from 'node:fs/promises';
import path from 'node:path';

export type ArchiveImportMode = 'auto' | 'copy' | 'move';
export type ReimportMode = 'import-in-place' | 'copy-to-cache-then-import';

export interface ArchiveImportedSourceOptions {
  sourcePath: string;
  archiveSubdirectory?: string;
  label?: string;
  mode?: ArchiveImportMode;
  now?: () => Date;
}

export interface ArchiveImportedSourceResult {
  sourcePath: string;
  archivedPath: string;
  manifestPath: string;
  archiveRoot: string;
  operation: 'copy' | 'move' | 'skip';
  archivedAt: string;
}

function readPathEnv(name: string): string | undefined {
  const value = String(process.env[name] || '').trim();
  return value ? path.resolve(value) : undefined;
}

function splitPathList(raw: string): string[] {
  return raw
    .split(/[;\r\n,]+/)
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => path.resolve(value));
}

function sanitizeSegment(value: string): string {
  const normalized = value
    .replace(/[\\/]+/g, '-')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-');
  return normalized.replace(/^-+|-+$/g, '') || 'import-source';
}

function formatArchiveStamp(date: Date): string {
  return date.toISOString().replace(/[:.]/g, '-');
}

export function resolveKnowledgeBaseRoot(): string {
  return readPathEnv('KNOWLEDGE_BASE_ROOT') ?? path.join(process.cwd(), 'dossiers', 'knowledge_base');
}

export function resolveKnowledgeBasePath(...segments: string[]): string {
  return path.join(resolveKnowledgeBaseRoot(), ...segments);
}

export function resolveImportArchiveRoot(): string {
  return readPathEnv('IMPORT_ARCHIVE_ROOT') ?? path.join(process.cwd(), 'storage', 'import-archive');
}

export function resolveImportSourceRoot(): string {
  return readPathEnv('IMPORT_SOURCE_ROOT') ?? path.join(process.cwd(), 'downloads');
}

export function resolveImportCacheRoot(): string {
  return readPathEnv('IMPORT_CACHE_ROOT') ?? path.join(process.cwd(), 'storage', 'import-cache');
}

export function resolveReimportScanRoots(): string[] {
  const configured = String(process.env.IMPORT_REIMPORT_SCAN_ROOTS || '').trim();
  if (configured) {
    return [...new Set(splitPathList(configured))];
  }

  return [...new Set([resolveImportArchiveRoot(), resolveImportSourceRoot()])];
}

export function isSubPath(parentPath: string, candidatePath: string): boolean {
  const relative = path.relative(path.resolve(parentPath), path.resolve(candidatePath));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export function recommendReimportMode(candidatePath: string): ReimportMode {
  const lower = candidatePath.toLowerCase();
  if (lower.endsWith('.zip') || lower.endsWith('.7z') || lower.endsWith('.rar') || lower.endsWith('.tar')) {
    return 'copy-to-cache-then-import';
  }

  return 'import-in-place';
}

export async function ensureImportDirectories(): Promise<void> {
  await fs.mkdir(resolveImportArchiveRoot(), { recursive: true });
  await fs.mkdir(resolveImportCacheRoot(), { recursive: true });
}

export async function archiveImportedSource(
  options: ArchiveImportedSourceOptions,
): Promise<ArchiveImportedSourceResult> {
  const sourcePath = path.resolve(options.sourcePath);
  const archiveRoot = resolveImportArchiveRoot();
  const sourceStat = await fs.stat(sourcePath);
  const now = options.now ?? (() => new Date());
  const archivedAt = now().toISOString();

  await fs.mkdir(archiveRoot, { recursive: true });

  const targetDirectory = options.archiveSubdirectory
    ? path.join(archiveRoot, options.archiveSubdirectory)
    : archiveRoot;
  await fs.mkdir(targetDirectory, { recursive: true });

  if (isSubPath(archiveRoot, sourcePath)) {
    const manifestPath = path.join(
      targetDirectory,
      `${formatArchiveStamp(new Date(archivedAt))}_${sanitizeSegment(options.label ?? path.basename(sourcePath))}.manifest.json`,
    );
    await fs.writeFile(
      manifestPath,
      JSON.stringify(
        {
          archivedAt,
          archiveRoot,
          sourcePath,
          archivedPath: sourcePath,
          operation: 'skip',
          reason: 'source-already-under-archive-root',
        },
        null,
        2,
      ),
      'utf8',
    );

    return {
      sourcePath,
      archivedPath: sourcePath,
      manifestPath,
      archiveRoot,
      operation: 'skip',
      archivedAt,
    };
  }

  const operation = resolveArchiveOperation(sourcePath, options.mode ?? 'auto');
  const stamp = formatArchiveStamp(new Date(archivedAt));
  const extension = sourceStat.isFile() ? path.extname(sourcePath) : '';
  const label = sanitizeSegment(options.label ?? path.basename(sourcePath, extension));
  const targetName = `${stamp}_${label}${extension}`;
  const archivedPath = path.join(targetDirectory, targetName);

  if (sourceStat.isDirectory()) {
    await fs.cp(sourcePath, archivedPath, {
      recursive: true,
      errorOnExist: true,
      force: false,
      preserveTimestamps: true,
    });
  } else {
    await fs.copyFile(sourcePath, archivedPath);
  }

  if (operation === 'move') {
    await fs.rm(sourcePath, { recursive: sourceStat.isDirectory(), force: false });
  }

  const manifestPath = path.join(targetDirectory, `${stamp}_${label}.manifest.json`);
  await fs.writeFile(
    manifestPath,
    JSON.stringify(
      {
        archivedAt,
        archiveRoot,
        sourcePath,
        archivedPath,
        archiveSubdirectory: options.archiveSubdirectory ?? null,
        operation,
        sourceType: sourceStat.isDirectory() ? 'directory' : 'file',
      },
      null,
      2,
    ),
    'utf8',
  );

  return {
    sourcePath,
    archivedPath,
    manifestPath,
    archiveRoot,
    operation,
    archivedAt,
  };
}

function resolveArchiveOperation(sourcePath: string, mode: ArchiveImportMode): 'copy' | 'move' {
  if (mode === 'copy' || mode === 'move') {
    return mode;
  }

  if (
    isSubPath(resolveImportCacheRoot(), sourcePath) ||
    isSubPath(path.join(process.cwd(), 'dossiers'), sourcePath) ||
    isSubPath(path.join(process.cwd(), 'downloads'), sourcePath)
  ) {
    return 'move';
  }

  return 'copy';
}
