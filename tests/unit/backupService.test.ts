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
  });
});
