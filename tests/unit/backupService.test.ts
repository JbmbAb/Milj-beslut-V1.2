import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  organisationFindMany: vi.fn(),
  userFindMany: vi.fn(),
  projectFindMany: vi.fn(),
  projectMemberFindMany: vi.fn(),
  documentRecordFindMany: vi.fn(),
  auditTrailFindMany: vi.fn(),
  requirementCaseFindMany: vi.fn(),
  searchQueryLogFindMany: vi.fn(),
  appendDomainAudit: vi.fn(),
  loggerInfo: vi.fn(),
  loggerWarn: vi.fn(),
  mkdir: vi.fn(),
  stat: vi.fn(),
  readFile: vi.fn(),
  createWriteStream: vi.fn(),
  pipeline: vi.fn(),
  createGzip: vi.fn(),
}));

vi.mock('../../server/db/prisma', () => ({
  prisma: {
    organisation: { findMany: mocks.organisationFindMany },
    user: { findMany: mocks.userFindMany },
    project: { findMany: mocks.projectFindMany },
    projectMember: { findMany: mocks.projectMemberFindMany },
    documentRecord: { findMany: mocks.documentRecordFindMany },
    auditTrail: { findMany: mocks.auditTrailFindMany },
    requirementCase: { findMany: mocks.requirementCaseFindMany },
    searchQueryLog: { findMany: mocks.searchQueryLogFindMany },
  },
}));

vi.mock('../../server/security/auditTrail', () => ({
  appendDomainAudit: mocks.appendDomainAudit,
}));

vi.mock('../../server/logger', () => ({
  logger: {
    info: mocks.loggerInfo,
    warn: mocks.loggerWarn,
  },
}));

vi.mock('node:fs', () => ({
  promises: {
    mkdir: mocks.mkdir,
    stat: mocks.stat,
    readFile: mocks.readFile,
  },
  createWriteStream: mocks.createWriteStream,
}));

vi.mock('node:stream/promises', () => ({
  pipeline: mocks.pipeline,
}));

vi.mock('node:zlib', () => ({
  createGzip: mocks.createGzip,
}));

describe('backupService', () => {
  const originalBackupDir = process.env.BACKUP_DIR;
  const originalS3Bucket = process.env.BACKUP_S3_BUCKET;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.resetModules();

    process.env.BACKUP_DIR = 'C:/tmp/backups';
    delete process.env.BACKUP_S3_BUCKET;

    const okRows = [{ id: 'row-1' }];
    mocks.organisationFindMany.mockResolvedValue(okRows);
    mocks.userFindMany.mockResolvedValue(okRows);
    mocks.projectFindMany.mockResolvedValue(okRows);
    mocks.projectMemberFindMany.mockResolvedValue(okRows);
    mocks.documentRecordFindMany.mockResolvedValue(okRows);
    mocks.auditTrailFindMany.mockResolvedValue(okRows);
    mocks.requirementCaseFindMany.mockResolvedValue(okRows);
    mocks.searchQueryLogFindMany.mockResolvedValue(okRows);
    mocks.appendDomainAudit.mockResolvedValue({ id: 'audit-1' });
    mocks.mkdir.mockResolvedValue(undefined);
    mocks.stat.mockResolvedValue({ size: 1234 });
    mocks.readFile.mockResolvedValue(Buffer.from('gzip'));
    mocks.createWriteStream.mockReturnValue({ path: 'C:/tmp/backups/file.json.gz' });
    mocks.pipeline.mockResolvedValue(undefined);
    mocks.createGzip.mockReturnValue({ kind: 'gzip' });
  });

  it('creates a backup manifest, writes audit data and stores the registry entry', async () => {
    const backupService = await import('../../server/services/backupService');

    const manifest = await backupService.runBackup('admin-1');

    expect(mocks.mkdir).toHaveBeenCalledWith('C:/tmp/backups', { recursive: true });
    expect(mocks.pipeline).toHaveBeenCalled();
    expect(manifest.status).toBe('SUCCESS');
    expect(manifest.tables.length).toBe(8);
    expect(manifest.fileSizeBytes).toBe(1234);
    expect(mocks.appendDomainAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'BACKUP',
        action: 'BACKUP_CREATED',
        userId: 'admin-1',
      }),
    );

    const listed = backupService.listBackups();
    expect(listed[0]?.id).toBe(manifest.id);
    expect(backupService.getBackup(manifest.id)?.checksum).toBe(manifest.checksum);
  });

  it('marks backups as failed when every table export fails', async () => {
    const failure = new Error('database offline');
    mocks.organisationFindMany.mockRejectedValue(failure);
    mocks.userFindMany.mockRejectedValue(failure);
    mocks.projectFindMany.mockRejectedValue(failure);
    mocks.projectMemberFindMany.mockRejectedValue(failure);
    mocks.documentRecordFindMany.mockRejectedValue(failure);
    mocks.auditTrailFindMany.mockRejectedValue(failure);
    mocks.requirementCaseFindMany.mockRejectedValue(failure);
    mocks.searchQueryLogFindMany.mockRejectedValue(failure);

    const backupService = await import('../../server/services/backupService');
    const manifest = await backupService.runBackup('admin-1');

    expect(manifest.status).toBe('FAILED');
    expect(manifest.tables).toEqual([]);
    expect(mocks.loggerWarn).toHaveBeenCalled();
  });

  afterEach(() => {
    if (originalBackupDir === undefined) {
      delete process.env.BACKUP_DIR;
    } else {
      process.env.BACKUP_DIR = originalBackupDir;
    }

    if (originalS3Bucket === undefined) {
      delete process.env.BACKUP_S3_BUCKET;
    } else {
      process.env.BACKUP_S3_BUCKET = originalS3Bucket;
    }
  });
});
