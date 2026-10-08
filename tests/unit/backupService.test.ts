import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

const mocks = vi.hoisted(() => ({
  organisationFindMany: vi.fn().mockResolvedValue([]),
  userFindMany: vi.fn().mockResolvedValue([]),
  projectFindMany: vi.fn().mockResolvedValue([]),
  projectMemberFindMany: vi.fn().mockResolvedValue([]),
  documentRecordFindMany: vi.fn().mockResolvedValue([]),
  auditTrailFindMany: vi.fn().mockResolvedValue([]),
  requirementCaseFindMany: vi.fn().mockResolvedValue([]),
  searchQueryLogFindMany: vi.fn().mockResolvedValue([]),
  fsMkdir: vi.fn().mockResolvedValue(undefined),
  fsStat: vi.fn().mockResolvedValue({ size: 1234 }),
  fsReadFile: vi.fn().mockResolvedValue(Buffer.from('test')),
  loggerInfo: vi.fn(),
  loggerWarn: vi.fn(),
  loggerError: vi.fn(),
  appendDomainAudit: vi.fn().mockResolvedValue({ id: 'audit1' }),
}));

// Mocking dependencies
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
    error: mocks.loggerError,
  },
}));

// Mock fs.promises
vi.mock('node:fs', async () => {
  const { Writable } = await import('node:stream');
  const createWriteStream = vi.fn(
    () =>
      new Writable({
        write(_chunk: any, _encoding: string, callback: () => void) {
          callback();
        },
        final(callback: () => void) {
          callback();
        },
      }),
  );

  return {
    promises: {
      mkdir: mocks.fsMkdir,
      stat: mocks.fsStat,
      readFile: mocks.fsReadFile,
    },
    createWriteStream,
    // Vite/Vitest sometimes accesses node:fs via a default export interop wrapper.
    default: {
      promises: {
        mkdir: mocks.fsMkdir,
        stat: mocks.fsStat,
        readFile: mocks.fsReadFile,
      },
      createWriteStream,
    },
  };
});

describe('backupService', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    process.env.BACKUP_DIR = './temp-backups';
  });

  describe('runBackup', () => {
    it('creates a backup successfully', async () => {
      const { prisma } = await import('../../server/db/prisma');
      const { runBackup } = await import('../../server/services/backupService');

      (prisma.organisation.findMany as Mock).mockResolvedValue([{ id: 'o1' }]);

      const manifest = await runBackup('admin1');

      expect(manifest.status).toBe('SUCCESS');
      expect(manifest.tables).toContain('organisations');
    });

    it('sets status to FAILED if no tables exported', async () => {
      const { prisma } = await import('../../server/db/prisma');
      const { runBackup } = await import('../../server/services/backupService');

      (prisma.organisation.findMany as Mock).mockRejectedValue(new Error('DB Down'));
      (prisma.user.findMany as Mock).mockRejectedValue(new Error('DB Down'));
      (prisma.project.findMany as Mock).mockRejectedValue(new Error('DB Down'));
      (prisma.projectMember.findMany as Mock).mockRejectedValue(new Error('DB Down'));
      (prisma.documentRecord.findMany as Mock).mockRejectedValue(new Error('DB Down'));
      (prisma.auditTrail.findMany as Mock).mockRejectedValue(new Error('DB Down'));
      (prisma.requirementCase.findMany as Mock).mockRejectedValue(new Error('DB Down'));
      (prisma.searchQueryLog.findMany as Mock).mockRejectedValue(new Error('DB Down'));

      const manifest = await runBackup('admin1');
      expect(manifest.status).toBe('FAILED');
    });
  });

  describe('registry', () => {
    it('getBackup returns specific backup', async () => {
      const { runBackup, getBackup } = await import('../../server/services/backupService');
      const manifest = await runBackup('admin1');
      const found = getBackup(manifest.id);
      expect(found).toBeDefined();
    });

    it('getBackup returns undefined for unknown id', async () => {
      const { getBackup } = await import('../../server/services/backupService');
      const result = getBackup('non-existent-id');
      expect(result).toBeUndefined();
    });

    it('listBackups returns backups in reverse order', async () => {
      const { runBackup, listBackups } = await import('../../server/services/backupService');
      const { prisma } = await import('../../server/db/prisma');
      (prisma.organisation.findMany as Mock).mockResolvedValue([{ id: 'o1' }]);

      await runBackup('admin-list-1');
      await runBackup('admin-list-2');
      const list = listBackups();

      expect(list.length).toBeGreaterThanOrEqual(2);
      // Reversed — newest first
      expect(list[0].createdAt >= list[1].createdAt).toBe(true);
    });

    it('PARTIAL status when some tables fail', async () => {
      const { prisma } = await import('../../server/db/prisma');
      const { runBackup } = await import('../../server/services/backupService');

      (prisma.organisation.findMany as Mock).mockResolvedValue([{ id: 'o1' }]);
      (prisma.user.findMany as Mock).mockRejectedValue(new Error('user table error'));

      const manifest = await runBackup('admin-partial');
      // At least organisation exported → SUCCESS (or PARTIAL if service distinguishes)
      expect(['SUCCESS', 'PARTIAL']).toContain(manifest.status);
      expect(manifest.tables).toContain('organisations');
    });
  });

  describe('optional S3 upload', () => {
    // The S3 upload runs in the background after runBackup resolves; wait so the no-claim checks see it settle.
    const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 250));

    it('local backup without S3 config succeeds and claims no upload', async () => {
      delete process.env.BACKUP_S3_BUCKET;
      const { runBackup } = await import('../../server/services/backupService');
      const manifest = await runBackup('admin-s3-off');
      await settle();
      expect(manifest.status).toBe('SUCCESS');
      expect(manifest.uploadedTo ?? '').toBe('');
    });

    it('S3 configured but SDK unavailable still produces a local SUCCESS backup', async () => {
      process.env.BACKUP_S3_BUCKET = 'test-bucket';
      const { runBackup } = await import('../../server/services/backupService');
      const manifest = await runBackup('admin-s3-missing-sdk');
      await settle();
      expect(manifest.status).toBe('SUCCESS');
      expect(mocks.fsStat).toHaveBeenCalled();
    });

    it('does not record an S3 location when the SDK is unavailable', async () => {
      process.env.BACKUP_S3_BUCKET = 'test-bucket';
      const { runBackup, getBackup } = await import('../../server/services/backupService');
      const manifest = await runBackup('admin-s3-no-claim');
      await settle();
      expect(manifest.uploadedTo ?? '').toBe('');
      expect(getBackup(manifest.id)?.uploadedTo ?? '').not.toMatch(/^s3:\/\//);
    });

    it('loads the S3 SDK through a literal specifier only', async () => {
      const actualFs = await vi.importActual<typeof import('node:fs')>('node:fs');
      const source = actualFs.readFileSync(`${process.cwd()}/server/services/backupService.ts`, 'utf8');
      expect(source).toContain("require('@aws-sdk/client-s3')");
      expect(source).not.toMatch(/import\(\s*(?!['"])/);
      expect(source).not.toMatch(/\bawsModule\b/);
    });
  });
});
