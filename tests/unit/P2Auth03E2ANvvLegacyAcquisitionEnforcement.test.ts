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
import {
  LEGACY_NATURVARDSVERKET_ACQUISITION_BLOCKED,
  NATURVARDSVERKET_LEGACY_CLASSIFICATION,
  downloadNaturvardsverketKnowledge,
} from '../../server/modules/legal/services/naturvardsverketDownloadService';

const REPO_ROOT = process.cwd();
const TSX_CLI = path.resolve(REPO_ROOT, 'node_modules/tsx/dist/cli.mjs');
const OPERATOR_SURFACES = [
  {
    path: 'scripts/fetch_nvv_brochures.ts',
    reason: 'P2-AUTH-03E2-A BLOCKED: the duplicate Naturvardsverket OAI brochure downloader',
  },
  {
    path: 'scripts/fetch_nvv_publications_site.ts',
    reason: 'P2-AUTH-03E2-A BLOCKED: the Naturvardsverket publication website crawler',
  },
] as const;

describe('P2-AUTH-03E2-A NVV legacy acquisition enforcement', () => {
  let rootDir: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    rootDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'p2-auth-03e2a-green-'));
  });

  afterEach(async () => {
    await fsPromises.rm(rootDir, { recursive: true, force: true });
  });

  it('classifies the mixed NVV service as legacy and non-authoritative', () => {
    expect(NATURVARDSVERKET_LEGACY_CLASSIFICATION).toBe('LEGACY_NON_AUTHORITATIVE');
  });

  it('blocks the mixed service before network, payload or manifest writes', async () => {
    const outputDir = path.join(rootDir, 'naturvardsverket');
    const fetchImpl = vi.fn();

    await expect(downloadNaturvardsverketKnowledge({ outputDir, fetchImpl })).rejects.toThrow(
      LEGACY_NATURVARDSVERKET_ACQUISITION_BLOCKED,
    );

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(fs.existsSync(outputDir)).toBe(false);
  });

  for (const surface of OPERATOR_SURFACES) {
    it(`blocks ${surface.path} before network or persistent output`, () => {
      const outputRoot = path.join(rootDir, path.basename(surface.path, '.ts'));
      const result = spawnSync(process.execPath, [TSX_CLI, path.resolve(REPO_ROOT, surface.path)], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        env: { ...process.env, KNOWLEDGE_BASE_ROOT: outputRoot },
        timeout: 10_000,
      });

      expect(result.status).toBe(1);
      expect(`${result.stdout}\n${result.stderr}`).toContain(surface.reason);
      expect(fs.existsSync(outputRoot)).toBe(false);
    });
  }

  it('places each containment gate before its first acquisition or write operation', () => {
    const expectations = [
      {
        path: 'server/modules/legal/services/naturvardsverketDownloadService.ts',
        pattern:
          /export async function downloadNaturvardsverketKnowledge\([^]*?\{\s*rejectLegacyNaturvardsverketAcquisition\(\);/,
      },
      {
        path: 'scripts/fetch_nvv_brochures.ts',
        pattern: /async function fetchAllNvvBrochures\(\)[^]*?\{\s*rejectLegacyNvvBrochuresAcquisition\(\);/,
      },
      {
        path: 'scripts/fetch_nvv_publications_site.ts',
        pattern: /async function main\(\)[^]*?\{\s*rejectLegacyNvvPublicationsSiteAcquisition\(\);/,
      },
    ] as const;

    for (const expectation of expectations) {
      const source = fs.readFileSync(path.resolve(REPO_ROOT, expectation.path), 'utf8');
      expect(source).toMatch(expectation.pattern);
      expect(source).not.toContain('loadVerifiedSourceRegistry');
    }
  });

  it('keeps existing NVV legacy material readable but outside canonical corpus persistence', async () => {
    const nvvDir = path.join(rootDir, 'naturvardsverket');
    await fsPromises.mkdir(nvvDir, { recursive: true });
    await fsPromises.writeFile(path.join(nvvDir, 'manifest.json'), JSON.stringify({ legacy: true }));
    await fsPromises.writeFile(path.join(nvvDir, 'oppnadata.html'), '<html>legacy portal</html>');
    await fsPromises.writeFile(path.join(nvvDir, 'geodatakatalogen.html'), '<html>legacy catalogue</html>');
    await fsPromises.writeFile(
      path.join(nvvDir, 'naturvardsregistret-wfs-capabilities.xml'),
      '<WFS_Capabilities version="2.0.0"/>',
    );

    const records = await collectDownloadedLegalCorpus({ rootDir, extractPdfText: false });
    expect(records.filter((record) => record.sourceFamily === 'NATURVARDSVERKET')).toHaveLength(3);

    await expect(importDownloadedLegalCorpus({ rootDir, extractPdfText: false })).rejects.toThrow(
      'P2-AUTH-03A BLOCKED',
    );
    expect(judgmentUpsert).not.toHaveBeenCalled();
    expect(legalSourceUpsert).not.toHaveBeenCalled();
    expect(legalCorpusUpsert).not.toHaveBeenCalled();
  });

  it('does not alter SourceRegistry authority or production adapter capability', () => {
    const registry = JSON.parse(
      fs.readFileSync(path.resolve(REPO_ROOT, 'source-registry/national-registry.json'), 'utf8'),
    ) as Array<{ adapter: string; lifecycle_state: string }>;
    const composition = fs.readFileSync(
      path.resolve(REPO_ROOT, 'packages/mps-data-governance/src/HarvestRuntimeCompositionRoot.ts'),
      'utf8',
    );

    expect(registry).toHaveLength(9);
    expect(registry.every((entry) => entry.lifecycle_state === 'APPROVED')).toBe(true);
    expect(composition).not.toMatch(/^\s*WFS_[A-Z0-9_]*\s*:/m);
  });

  it('keeps the executed red proof historical and outside the active test glob', () => {
    const historical = path.resolve(
      REPO_ROOT,
      'tests/unit/P2Auth03E2ANvvLegacyAcquisition.red.historical.ts',
    );

    expect(fs.existsSync(historical)).toBe(true);
    expect(historical.endsWith('.test.ts')).toBe(false);
  });
});
