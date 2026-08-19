import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = process.cwd();
const TARGET = path.resolve(REPO_ROOT, 'scripts/import/seed-core-legal-sfs.ts');
const TSX_CLI = path.resolve(REPO_ROOT, 'node_modules/tsx/dist/cli.mjs');
const QUARANTINE_MESSAGE = 'P2-AUTH-02 QUARANTINED';

function runLegacySeed(allowLiveSeed: boolean) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'p2-auth-02-'));
  const result = spawnSync(process.execPath, [TSX_CLI, TARGET], {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      ALLOW_LIVE_SEED: allowLiveSeed ? 'true' : 'false',
    },
    timeout: 10_000,
  });

  const archiveCreated = fs.existsSync(path.join(cwd, 'archives'));
  const manifestDirectoryCreated = fs.existsSync(
    path.join(cwd, 'scripts', 'import', 'manifests'),
  );
  fs.rmSync(cwd, { recursive: true, force: true });

  return { archiveCreated, manifestDirectoryCreated, result };
}

describe('P2-AUTH-02 direct legal corpus write enforcement', () => {
  it('places the quarantine guard before all legacy acquisition and write logic', () => {
    const source = fs.readFileSync(TARGET, 'utf8');

    expect(source).toMatch(
      /async function main\(\)\s*\{\s*rejectNonCanonicalLegalCorpusSeed\(\);/,
    );
    expect(source).toMatch(
      /function rejectNonCanonicalLegalCorpusSeed\(\): never\s*\{\s*throw new Error\(/,
    );
  });

  it('rejects direct execution before the permanent live-seed branch is reachable', () => {
    const { archiveCreated, manifestDirectoryCreated, result } = runLegacySeed(true);

    expect(result.status).toBe(1);
    expect(`${result.stdout}\n${result.stderr}`).toContain(QUARANTINE_MESSAGE);
    expect(archiveCreated).toBe(false);
    expect(manifestDirectoryCreated).toBe(false);
  });

  it('rejects direct execution before the custom archive and manifest path is reachable', () => {
    const { archiveCreated, manifestDirectoryCreated, result } = runLegacySeed(false);

    expect(result.status).toBe(1);
    expect(`${result.stdout}\n${result.stderr}`).toContain(QUARANTINE_MESSAGE);
    expect(archiveCreated).toBe(false);
    expect(manifestDirectoryCreated).toBe(false);
  });

  it('keeps the historical red proof outside the executable test glob', () => {
    const historical = path.resolve(
      REPO_ROOT,
      'packages/mps-data-governance/tests/P2Auth02DirectLegalCorpusWrite.red.historical.ts',
    );

    expect(fs.existsSync(historical)).toBe(true);
    expect(historical.endsWith('.test.ts')).toBe(false);
  });
});
