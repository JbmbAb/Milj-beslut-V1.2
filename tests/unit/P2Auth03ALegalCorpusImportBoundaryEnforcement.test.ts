import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { legalCorpusUpsert, legalSourceUpsert, judgmentUpsert } = vi.hoisted(() => ({
  legalCorpusUpsert: vi.fn(async (input: unknown) => input),
  legalSourceUpsert: vi.fn(async () => ({ id: 'legacy-source' })),
  judgmentUpsert: vi.fn(async () => ({ id: 'legacy-judgment' })),
}));

vi.mock('../../server/repositories/legalSourceRepository', () => ({
  upsertLegalSourceRecord: legalSourceUpsert,
}));

vi.mock('../../server/repositories/judgmentRepository', () => ({
  upsertJudgment: judgmentUpsert,
}));

vi.mock('../../server/db/prisma', () => ({
  prisma: { legalCorpusRecord: { upsert: legalCorpusUpsert } },
}));

import {
  collectDownloadedLegalCorpus,
  importDownloadedLegalCorpus,
  LEGACY_LEGAL_CORPUS_IMPORT_BLOCKED,
} from '../../server/modules/legal/services/legalCorpusImportService';

const REPO_ROOT = process.cwd();
const TSX_CLI = path.resolve(REPO_ROOT, 'node_modules/tsx/dist/cli.mjs');

describe('P2-AUTH-03A legal corpus import boundary enforcement', () => {
  let rootDir: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'p2-auth-03a-green-'));

    const sourceDir = path.join(rootDir, 'legal', 'foundation-sources');
    await fs.mkdir(sourceDir, { recursive: true });
    await fs.writeFile(
      path.join(sourceDir, 'manifest.json'),
      JSON.stringify({
        downloads: [
          {
            externalId: 'SFS:1998:808',
            title: 'Miljobalken (1998:808)',
            sourceUrl: 'https://rkrattsbaser.gov.se/sfst?bet=1998:808',
            contentType: 'text/html',
            savedAs: 'sfs-1998-808.html',
          },
        ],
      }),
      'utf8',
    );
    await fs.writeFile(
      path.join(sourceDir, 'sfs-1998-808.html'),
      '<html><body>Legacy downloaded legal material.</body></html>',
      'utf8',
    );
  });

  afterEach(async () => {
    await fs.rm(rootDir, { recursive: true, force: true });
  });

  it('keeps legacy material available for read-only reconciliation', async () => {
    const records = await collectDownloadedLegalCorpus({ rootDir, extractPdfText: false });

    expect(records).toHaveLength(1);
    expect(records[0]?.externalId).toBe('SFS:1998:808');
    expect(legalSourceUpsert).not.toHaveBeenCalled();
    expect(judgmentUpsert).not.toHaveBeenCalled();
    expect(legalCorpusUpsert).not.toHaveBeenCalled();
  });

  it('fails closed before Judgment, LegalSourceRecord, or LegalCorpusRecord writes', async () => {
    await expect(
      importDownloadedLegalCorpus({ rootDir, extractPdfText: false }),
    ).rejects.toThrow(LEGACY_LEGAL_CORPUS_IMPORT_BLOCKED);

    expect(judgmentUpsert).not.toHaveBeenCalled();
    expect(legalSourceUpsert).not.toHaveBeenCalled();
    expect(legalCorpusUpsert).not.toHaveBeenCalled();
  });

  it('places the fail-closed boundary before collection and write logic', async () => {
    const source = await fs.readFile(
      path.resolve(REPO_ROOT, 'server/modules/legal/services/legalCorpusImportService.ts'),
      'utf8',
    );

    expect(source).toMatch(
      /export async function importDownloadedLegalCorpus\([\s\S]*?\{\s*rejectLegacyLegalCorpusImport\(\);/,
    );
    expect(source).toMatch(
      /function rejectLegacyLegalCorpusImport\(\): never\s*\{\s*throw new Error\(LEGACY_LEGAL_CORPUS_IMPORT_BLOCKED\);/,
    );
  });

  it('keeps the operator entrypoint behind the blocked import function', async () => {
    const entrypoint = await fs.readFile(
      path.resolve(REPO_ROOT, 'scripts/import-downloaded-legal-corpus.ts'),
      'utf8',
    );

    expect(entrypoint).toContain('importDownloadedLegalCorpus');
    expect(entrypoint).not.toMatch(/prisma\.|upsertJudgment|upsertLegalSourceRecord/);
  });

  it('rejects the real operator CLI before it can process legacy material', () => {
    const result = spawnSync(
      process.execPath,
      [
        TSX_CLI,
        path.resolve(REPO_ROOT, 'scripts/import-downloaded-legal-corpus.ts'),
        '--root-dir',
        rootDir,
      ],
      {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        env: process.env,
        timeout: 10_000,
      },
    );

    expect(result.status).toBe(1);
    expect(`${result.stdout}\n${result.stderr}`).toContain(LEGACY_LEGAL_CORPUS_IMPORT_BLOCKED);
  });

  it('keeps the historical red proof outside the executable test glob', async () => {
    const historical = path.resolve(
      REPO_ROOT,
      'tests/unit/P2Auth03ALegalCorpusImportBoundary.red.historical.ts',
    );

    await expect(fs.access(historical)).resolves.toBeUndefined();
    expect(historical.endsWith('.test.ts')).toBe(false);
  });
});
