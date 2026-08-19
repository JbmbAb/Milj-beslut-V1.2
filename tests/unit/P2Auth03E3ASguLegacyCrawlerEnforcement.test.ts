import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import * as fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { judgmentUpsert, legalCorpusUpsert, legalSourceUpsert } = vi.hoisted(() => ({
  judgmentUpsert: vi.fn(),
  legalCorpusUpsert: vi.fn(),
  legalSourceUpsert: vi.fn(),
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
} from '../../server/modules/legal/services/legalCorpusImportService';

const REPO_ROOT = process.cwd();
const SCRIPT_PATH = 'scripts/fetch_sgu_anvandarstod_knowledge.ts';
const TSX_CLI = path.resolve(REPO_ROOT, 'node_modules/tsx/dist/cli.mjs');
const BLOCK_REASON = 'P2-AUTH-03E3-A BLOCKED: the broad SGU guidance crawler cannot act as source authority';

describe('P2-AUTH-03E3-A SGU broad crawler enforcement', () => {
  let rootDir: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    rootDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'p2-auth-03e3a-green-'));
  });

  afterEach(async () => {
    await fsPromises.rm(rootDir, { recursive: true, force: true });
  });

  it('blocks the operator surface before network or persistent output', () => {
    const outputRoot = path.join(rootDir, 'knowledge');
    const result = spawnSync(process.execPath, [TSX_CLI, path.resolve(REPO_ROOT, SCRIPT_PATH)], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env, KNOWLEDGE_BASE_ROOT: outputRoot },
      timeout: 10_000,
    });

    expect(result.status).toBe(1);
    expect(`${result.stdout}\n${result.stderr}`).toContain(BLOCK_REASON);
    expect(fs.existsSync(outputRoot)).toBe(false);
  });

  it('classifies the crawler as non-authoritative and gates main before its first write or fetch', () => {
    const source = fs.readFileSync(path.resolve(REPO_ROOT, SCRIPT_PATH), 'utf8');

    expect(source).toContain("SGU_ANVANDARSTOD_LEGACY_CLASSIFICATION = 'LEGACY_NON_AUTHORITATIVE'");
    expect(source).toMatch(/async function main\(\)[^]*?\{\s*rejectLegacySguAnvandarstodAcquisition\(\);/);
    expect(source).not.toContain('loadVerifiedSourceRegistry');
  });

  it('keeps existing SGU legacy material readable but outside canonical corpus persistence', async () => {
    const legacyDir = path.join(rootDir, 'sgu-anvandarstod');
    await fsPromises.mkdir(path.join(legacyDir, 'pages'), { recursive: true });
    await fsPromises.writeFile(path.join(legacyDir, 'pages', 'legacy.html'), '<html>legacy SGU</html>');
    await fsPromises.writeFile(
      path.join(legacyDir, 'manifest.json'),
      JSON.stringify({
        pages: [
          {
            title: 'Legacy SGU guidance',
            sourceUrl: 'https://www.sgu.se/anvandarstod-for-geologiska-fragor/',
            normalizedUrl: 'https://www.sgu.se/anvandarstod-for-geologiska-fragor/',
            savedAs: 'pages/legacy.html',
          },
        ],
        pdfs: [],
      }),
    );

    const records = await collectDownloadedLegalCorpus({ rootDir, extractPdfText: false });
    expect(records.filter((record) => record.sourceSystem === 'SGU_ANVANDARSTOD')).toHaveLength(1);

    await expect(importDownloadedLegalCorpus({ rootDir, extractPdfText: false })).rejects.toThrow(
      'P2-AUTH-03A BLOCKED',
    );
    expect(judgmentUpsert).not.toHaveBeenCalled();
    expect(legalSourceUpsert).not.toHaveBeenCalled();
    expect(legalCorpusUpsert).not.toHaveBeenCalled();
  });

  it('leaves the exact governed SGU source and production resolver unchanged', () => {
    const registry = JSON.parse(
      fs.readFileSync(path.resolve(REPO_ROOT, 'source-registry/national-registry.json'), 'utf8'),
    ) as Array<{
      source_id: string;
      adapter: string;
      lifecycle_state: string;
      channel: { endpoint_url: string };
    }>;
    const source = registry.find(
      (entry) => entry.source_id === 'sgu-groundwater-influence-analytical-models',
    );

    expect(registry).toHaveLength(11);
    expect(source).toMatchObject({
      adapter: 'SINGLE_ENDPOINT_V1',
      lifecycle_state: 'APPROVED',
      channel: {
        endpoint_url:
          'https://www.sgu.se/anvandarstod-for-geologiska-fragor/bedomning-av-influensomrade-avseende-grundvatten/berakningsmodeller/analytiska-modeller/',
      },
    });
  });

  it('keeps the executed red proof historical and outside the active test glob', () => {
    const historical = path.resolve(REPO_ROOT, 'tests/unit/P2Auth03E3ASguLegacyCrawler.red.historical.ts');

    expect(fs.existsSync(historical)).toBe(true);
    expect(historical.endsWith('.test.ts')).toBe(false);
  });
});
