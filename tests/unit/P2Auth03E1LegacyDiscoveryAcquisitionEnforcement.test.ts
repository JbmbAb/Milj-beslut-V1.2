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
  LANSSTYRELSER_CORPUS_CLASSIFICATION,
  LEGACY_LANSSTYRELSER_CORPUS_ACQUISITION_BLOCKED,
  buildLansstyrelserCorpus,
} from '../../server/modules/legal/services/lansstyrelserCorpusService';
import { importDownloadedLegalCorpus } from '../../server/modules/legal/services/legalCorpusImportService';
import {
  LEGACY_MMD_CORPUS_ACQUISITION_BLOCKED,
  MMD_CORPUS_CLASSIFICATION,
  buildMmdCorpus,
} from '../../server/modules/legal/services/mmdCorpusService';

const REPO_ROOT = process.cwd();
const TSX_CLI = path.resolve(REPO_ROOT, 'node_modules/tsx/dist/cli.mjs');

const OPERATOR_SURFACES = [
  {
    path: 'scripts/fetch_sgu_portal_knowledge.ts',
    reason: 'P2-AUTH-03E1 BLOCKED: the broad SGU portal crawler is discovery-only',
  },
  {
    path: 'scripts/fetch_diva_knowledge.ts',
    reason: 'P2-AUTH-03E1 BLOCKED: operator-selected DIVA_DOMAIN is not admissible source authority',
  },
  {
    path: 'scripts/fetch_boverket_knowledge.ts',
    reason: 'P2-AUTH-03E1 BLOCKED: the mixed Boverket API/web/PDF downloader cannot act as source authority',
  },
] as const;

describe('P2-AUTH-03E1 legacy discovery acquisition enforcement', () => {
  let rootDir: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    rootDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'p2-auth-03e1-green-'));
  });

  afterEach(async () => {
    await fsPromises.rm(rootDir, { recursive: true, force: true });
  });

  it('classifies the MMD and Lansstyrelsen catalogues as discovery-only', () => {
    expect(MMD_CORPUS_CLASSIFICATION).toBe('DISCOVERY_ONLY');
    expect(LANSSTYRELSER_CORPUS_CLASSIFICATION).toBe('DISCOVERY_ONLY');
  });

  it('blocks the MMD catalogue before network, archive or manifest writes', async () => {
    const outputDir = path.join(rootDir, 'mmd');
    const fetchImpl = vi.fn();

    await expect(buildMmdCorpus({ outputDir, fetchImpl })).rejects.toThrow(
      LEGACY_MMD_CORPUS_ACQUISITION_BLOCKED,
    );

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(fs.existsSync(outputDir)).toBe(false);
  });

  it('blocks the Lansstyrelsen catalogue before network, archive or manifest writes', async () => {
    const outputDir = path.join(rootDir, 'lansstyrelserna');
    const fetchImpl = vi.fn();

    await expect(buildLansstyrelserCorpus({ outputDir, fetchImpl })).rejects.toThrow(
      LEGACY_LANSSTYRELSER_CORPUS_ACQUISITION_BLOCKED,
    );

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(fs.existsSync(outputDir)).toBe(false);
  });

  for (const surface of OPERATOR_SURFACES) {
    it(`blocks ${surface.path} before it creates persistent output`, () => {
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

  it('places every containment gate before the first acquisition or write operation', () => {
    const expectations = [
      {
        path: 'server/modules/legal/services/mmdCorpusService.ts',
        pattern: /export async function buildMmdCorpus\([^]*?\{\s*rejectLegacyMmdCorpusAcquisition\(\);/,
      },
      {
        path: 'server/modules/legal/services/lansstyrelserCorpusService.ts',
        pattern:
          /export async function buildLansstyrelserCorpus\([^]*?\{\s*rejectLegacyLansstyrelserCorpusAcquisition\(\);/,
      },
      {
        path: 'scripts/fetch_sgu_portal_knowledge.ts',
        pattern: /async function main\(\)[^]*?\{\s*rejectLegacySguPortalAcquisition\(\);/,
      },
      {
        path: 'scripts/fetch_diva_knowledge.ts',
        pattern: /async function main\(\)[^]*?\{\s*rejectLegacyDynamicDivaAcquisition\(\);/,
      },
      {
        path: 'scripts/fetch_boverket_knowledge.ts',
        pattern: /async function fetchAllKnowledge\(\)[^]*?\{\s*rejectLegacyBoverketMixedAcquisition\(\);/,
      },
    ] as const;

    for (const expectation of expectations) {
      const source = fs.readFileSync(path.resolve(REPO_ROOT, expectation.path), 'utf8');
      expect(source).toMatch(expectation.pattern);
      expect(source).not.toContain('loadVerifiedSourceRegistry');
    }
  });

  it('keeps legacy discovery material outside permanent legal corpus persistence', async () => {
    await expect(importDownloadedLegalCorpus({ rootDir })).rejects.toThrow('P2-AUTH-03A BLOCKED');

    expect(judgmentUpsert).not.toHaveBeenCalled();
    expect(legalSourceUpsert).not.toHaveBeenCalled();
    expect(legalCorpusUpsert).not.toHaveBeenCalled();
  });

  it('leaves the installed governed P2 authority intact', () => {
    const registry = JSON.parse(
      fs.readFileSync(path.resolve(REPO_ROOT, 'source-registry/national-registry.json'), 'utf8'),
    ) as Array<{ adapter: string; lifecycle_state: string }>;

    expect(registry).toHaveLength(9);
    expect(registry.every((entry) => entry.lifecycle_state === 'APPROVED')).toBe(true);
  });

  it('keeps the executed red proof historical and outside the active test glob', () => {
    const historical = path.resolve(
      REPO_ROOT,
      'tests/unit/P2Auth03E1LegacyDiscoveryAcquisition.red.historical.ts',
    );

    expect(fs.existsSync(historical)).toBe(true);
    expect(historical.endsWith('.test.ts')).toBe(false);
  });
});
