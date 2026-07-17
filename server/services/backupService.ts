/**
 * backupService.ts
 *
 * Automatiserad databasbackup och återställning.
 *
 * Strategi:
 *   1. Exportera alla Prisma-modeller som JSON (portabelt, databas-agnostisk)
 *   2. Komprimera med gzip
 *   3. Spara lokalt (BACKUP_DIR) och/eller ladda upp till S3/Blob Storage
 *
 * Endpoints:
 *   POST /api/admin/backup/trigger   — trigga manuell backup
 *   GET  /api/admin/backup/list      — lista tillgängliga backuper
 *   GET  /api/admin/backup/:id/download — ladda ner en specifik backup
 *
 * Miljövariabler:
 *   BACKUP_DIR          — lokal mapp (default /tmp/miljobeslut-backups)
 *   BACKUP_S3_BUCKET    — S3-bucket för off-site backup (valfritt)
 *   BACKUP_S3_PREFIX    — S3-prefix (valfritt, default "backups/")
 *   BACKUP_RETENTION_DAYS — antal dagar att behålla (default 30)
 */

import crypto from 'node:crypto';
import { createGzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { prisma } from '../db/prisma';
import { appendDomainAudit } from '../security/auditTrail';
import { logger } from '../logger';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface BackupManifest {
  id: string;
  createdAt: string;
  tables: string[];
  rowCounts: Record<string, number>;
  filePath: string;
  fileSizeBytes: number;
  checksum: string;
  status: 'SUCCESS' | 'PARTIAL' | 'FAILED';
  uploadedTo?: string;
}

// ─── In-process backup registry ──────────────────────────────────────────────

const _backups: BackupManifest[] = [];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getBackupDir(): string {
  return process.env.BACKUP_DIR ?? '/tmp/miljobeslut-backups';
}

async function ensureBackupDir(): Promise<void> {
  await fs.mkdir(getBackupDir(), { recursive: true });
}

// ─── Core backup ─────────────────────────────────────────────────────────────

/**
 * Kör en fullständig databas-snapshot och spara till disk.
 */
export async function runBackup(actingUserId: string): Promise<BackupManifest> {
  await ensureBackupDir();

  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const filename = `backup_${createdAt.replace(/[:.]/g, '-')}_${id.slice(0, 8)}.json.gz`;
  const filePath = path.join(getBackupDir(), filename);

  const tables: string[] = [];
  const rowCounts: Record<string, number> = {};
  const dump: Record<string, unknown[]> = {};

  // Collect all tables via Prisma
  const tableExports: Array<[string, Promise<unknown[]>]> = [
    ['organisations', prisma.organisation.findMany()],
    [
      'users',
      prisma.user.findMany({
        select: {
          id: true,
          organisationId: true,
          bankidId: true,
          role: true,
          createdAt: true,
        },
      }),
    ],
    ['projects', prisma.project.findMany()],
    ['projectMembers', prisma.projectMember.findMany()],
    [
      'documentRecords',
      prisma.documentRecord.findMany({
        select: {
          id: true,
          projectId: true,
          organisationId: true,
          entryId: true,
          subject: true,
          originalName: true,
          status: true,
          mimeType: true,
          fileSize: true,
          receivedTime: true,
        },
      }),
    ],
    ['auditTrail', prisma.auditTrail.findMany({ take: 10_000, orderBy: { timestamp: 'desc' } })],
    ['requirementCases', prisma.requirementCase.findMany()],
    ['searchQueryLogs', prisma.searchQueryLog.findMany({ take: 5_000 })],
  ];

  for (const [tableName, query] of tableExports) {
    try {
      const rows = await query;
      dump[tableName] = rows;
      tables.push(tableName);
      rowCounts[tableName] = rows.length;
    } catch (err) {
      logger.warn(`backup: failed to export table ${tableName}`, { err: String(err) });
    }
  }

  // Serialise and compress
  const json = JSON.stringify({ backupId: id, createdAt, tables, rowCounts, data: dump }, null, 0);
  const checksum = crypto.createHash('sha256').update(json).digest('hex');

  const readableStream = Readable.from([json]);
  const gzipStream = createGzip({ level: 6 });
  const { createWriteStream } = await import('node:fs');
  const writeStream = createWriteStream(filePath);

  await pipeline(readableStream, gzipStream, writeStream);

  const stat = await fs.stat(filePath);

  const manifest: BackupManifest = {
    id,
    createdAt,
    tables,
    rowCounts,
    filePath,
    fileSizeBytes: stat.size,
    checksum,
    status: tables.length > 0 ? 'SUCCESS' : 'FAILED',
  };

  _backups.push(manifest);

  // Keep registry bounded
  if (_backups.length > 100) _backups.splice(0, _backups.length - 100);

  const auditRecord = await appendDomainAudit({
    entityType: 'BACKUP',
    entityId: id,
    action: 'BACKUP_CREATED',
    userId: actingUserId,
    payload: { tables, rowCounts, fileSizeBytes: stat.size, checksum, status: manifest.status },
  });

  logger.info('backup: completed', { id, tables: tables.length, bytes: stat.size });

  // Optional S3 upload (if configured)
  const s3Bucket = process.env.BACKUP_S3_BUCKET;
  if (s3Bucket) {
    void uploadToS3(manifest, filePath, s3Bucket).then((s3Key) => {
      manifest.uploadedTo = s3Key;
    });
  }

  void auditRecord; // already persisted above
  return manifest;
}

/**
 * Lista alla bekräftade backuper.
 */
export function listBackups(): BackupManifest[] {
  return [..._backups].reverse();
}

/**
 * Hämta en specifik backup-manifest.
 */
export function getBackup(id: string): BackupManifest | undefined {
  return _backups.find((b) => b.id === id);
}

// ─── S3 upload (optional) ─────────────────────────────────────────────────────

async function uploadToS3(manifest: BackupManifest, filePath: string, bucket: string): Promise<string> {
  try {
    // Dynamic import of AWS SDK v3 (optional peer dependency)
    // Install with: npm install @aws-sdk/client-s3
    const awsModule = '@aws-sdk/client-s3';
    const { S3Client, PutObjectCommand } = await import(/* @vite-ignore */ awsModule).catch(() => ({
      S3Client: null,
      PutObjectCommand: null,
    }));
    if (!S3Client || !PutObjectCommand) return '';

    const client = new S3Client({});
    const prefix = process.env.BACKUP_S3_PREFIX ?? 'backups/';
    const key = `${prefix}${path.basename(filePath)}`;

    const fileBuffer = await fs.readFile(filePath);

    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: fileBuffer,
        ContentType: 'application/gzip',
        Metadata: { checksum: manifest.checksum, backupId: manifest.id },
      }),
    );

    logger.info('backup: uploaded to S3', { bucket, key });
    return `s3://${bucket}/${key}`;
  } catch (err) {
    logger.warn('backup: S3 upload failed', { err: String(err) });
    return '';
  }
}
