import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mkdirMock, rmMock, writeFileMock } = vi.hoisted(() => ({
  mkdirMock: vi.fn(),
  rmMock: vi.fn(),
  writeFileMock: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  default: { mkdir: mkdirMock, rm: rmMock, writeFile: writeFileMock },
  mkdir: mkdirMock,
  rm: rmMock,
  writeFile: writeFileMock,
}));

import {
  downloadDomstolRssFeed,
  LEGACY_DOMSTOL_RSS_DOWNLOAD_BLOCKED,
} from '../../server/modules/legal/services/domstolRssDownloadService';

const REPO_ROOT = process.cwd();
const TSX_CLI = path.resolve(REPO_ROOT, 'node_modules/tsx/dist/cli.mjs');

function runOperatorScript(relativePath: string) {
  return spawnSync(process.execPath, [TSX_CLI, path.resolve(REPO_ROOT, relativePath)], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: process.env,
    timeout: 10_000,
  });
}

describe('P2-AUTH-03B Domstol legacy download enforcement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('blocks the RSS service before network or filesystem access', async () => {
    const fetchImpl = vi.fn();

    await expect(
      downloadDomstolRssFeed({ outputDir: 'must-not-be-used', fetchImpl }),
    ).rejects.toThrow(LEGACY_DOMSTOL_RSS_DOWNLOAD_BLOCKED);

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(rmMock).not.toHaveBeenCalled();
    expect(mkdirMock).not.toHaveBeenCalled();
    expect(writeFileMock).not.toHaveBeenCalled();
  });

  it('places the RSS containment before authority and download logic', () => {
    const source = fs.readFileSync(
      path.resolve(REPO_ROOT, 'server/modules/legal/services/domstolRssDownloadService.ts'),
      'utf8',
    );

    expect(source).toMatch(
      /export async function downloadDomstolRssFeed\([\s\S]*?\{\s*rejectLegacyDomstolRssDownload\(\);/,
    );
  });

  it('blocks the real RSS operator CLI with the supersession reason', () => {
    const result = runOperatorScript('scripts/download-domstol-rss.ts');

    expect(result.status).toBe(1);
    expect(`${result.stdout}\n${result.stderr}`).toContain(LEGACY_DOMSTOL_RSS_DOWNLOAD_BLOCKED);
  });

  it('places the history containment before environment, network, and write logic', () => {
    const source = fs.readFileSync(
      path.resolve(REPO_ROOT, 'scripts/download-domstol-history.ts'),
      'utf8',
    );

    expect(source).toMatch(
      /async function main\(\)\s*\{\s*rejectLegacyDomstolHistoryDownload\(\);/,
    );
  });

  it('blocks the real history operator CLI with the supersession reason', () => {
    const result = runOperatorScript('scripts/download-domstol-history.ts');

    expect(result.status).toBe(1);
    expect(`${result.stdout}\n${result.stderr}`).toContain(
      'P2-AUTH-03B BLOCKED: legacy Domstol history download is superseded',
    );
  });

  it('removes the legacy RSS command as an active runbook step', () => {
    const runbook = fs.readFileSync(
      path.resolve(REPO_ROOT, 'docs/ops/legal-clean-run-v3.md'),
      'utf8',
    );

    expect(runbook).toContain('download-domstol-rss.ts` är superseded och fail-closed');
    expect(runbook).toContain('governade P2/PUH-runtimen');
  });

  it('keeps the historical red proof outside the executable test glob', () => {
    const historical = path.resolve(
      REPO_ROOT,
      'tests/unit/P2Auth03BDomstolLegacyDownloads.red.historical.ts',
    );

    expect(fs.existsSync(historical)).toBe(true);
    expect(historical.endsWith('.test.ts')).toBe(false);
  });
});
