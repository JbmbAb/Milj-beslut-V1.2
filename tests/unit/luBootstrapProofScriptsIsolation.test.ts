import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isDatabaseConnectionEnvKey } from '../../server/modules/test-db-guard/testDatabaseTargetPolicy';

/**
 * LU-CANONICAL-RUNTIME-HARDENING-R1 -- claim 4.
 *
 * The two LU proof scripts enable MPS_LU_BOOTSTRAP_ADMIT=1, which is only acceptable if they can
 * never touch a persistent CAS. They previously opened whatever MIMERS_ROOT the caller had
 * configured. They must now run against an isolated temporary root of their own.
 *
 * The scripts are executed exactly as an operator runs them (a real subprocess, real
 * filesystem-backed Mimers CAS) with MIMERS_ROOT pointing at a sentinel directory that already
 * holds CAS-shaped content. The sentinel must be byte-for-byte unchanged afterwards.
 *
 * Deliberately NOT asserted: the scripts' own "ALL GREEN" verdict. The cold-verify script has an
 * unrelated, pre-existing stale outcome-id assertion (see the unit's completion report); this test
 * proves isolation, not that verdict.
 */

// The scripts read repository files relative to their working directory: the repository root of
// THIS checkout, independent of the directory Vitest was started from.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** Explicitly dead: port 1 on loopback never answers. */
const DEAD_DATABASE_URL = 'postgresql://x:x@127.0.0.1:1/none';

const SCRIPTS = [
  'scripts/ops/prove-lu-replay-cold-verify-01.ts',
  'scripts/ops/prove-lu-deterministic-reexecution-01.ts',
] as const;

/** relative path -> content digest (files) or "<dir>" (directories); recursive, sorted. */
function snapshot(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir).sort()) {
      const full = join(dir, entry);
      const rel = relative(root, full).split(sep).join('/');
      if (statSync(full).isDirectory()) {
        out[rel] = '<dir>';
        walk(full);
      } else {
        out[rel] = createHash('sha256').update(readFileSync(full)).digest('hex');
      }
    }
  };
  walk(root);
  return out;
}

/**
 * The operator's view of the product (no VITEST, no NODE_ENV=test), in a controlled test
 * environment (TEST-DB-GUARD, OD-K0-5): MIMER_TEST_MODE=1 makes the child a hermetic test process
 * -- server/loadEnvFirst reads no env file at all, so the worktree's `.env.local` (the live
 * database) is never loaded although the child's cwd is the repository root -- no database
 * setting is inherited, and the only DATABASE_URL is explicitly dead.
 */
function operatorEnv(sentinelRoot: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const [key, value] of Object.entries(env)) {
    if (key.startsWith('VITEST') || key.startsWith('MIMERS_') || key === 'NODE_ENV') delete env[key];
    else if (value !== undefined && isDatabaseConnectionEnvKey(key, value)) delete env[key];
  }
  delete env.MPS_LU_BOOTSTRAP_ADMIT;
  delete env.LU_MPS_CAS;
  env.MIMER_TEST_MODE = '1';
  env.DATABASE_URL = DEAD_DATABASE_URL;
  env.TEST_DATABASE_URL = DEAD_DATABASE_URL;
  env.MIMERS_ROOT = sentinelRoot;
  return env;
}

interface Isolation {
  readonly root: string;
  readonly mimers_backed: boolean;
  readonly cas_dir_present: boolean;
}

function runScript(script: string, sentinelRoot: string) {
  const result = spawnSync(process.execPath, ['--import', 'tsx', script], {
    cwd: repoRoot,
    env: operatorEnv(sentinelRoot),
    encoding: 'utf8',
    timeout: 170_000,
  });
  const stdout = result.stdout ?? '';
  const line = stdout.split(/\r?\n/).find((l) => l.startsWith('PROOF_ISOLATION '));
  const isolation: Isolation | null = line
    ? (JSON.parse(line.slice('PROOF_ISOLATION '.length)) as Isolation)
    : null;
  return { result, stdout, isolation };
}

describe('LU bootstrap proof scripts run in a controlled test environment (TEST-DB-GUARD, OD-K0-5)', () => {
  it('as a hermetic test process with an explicitly dead database and no inherited database setting', () => {
    const inherited = {
      POSTGRES_URL: 'postgresql://wtdg2:x@wtdg2-inherited.invalid:1/wtdg2_inherited',
      PGHOST: 'wtdg2-inherited.invalid',
      MIMER_TEST_DB_ALLOW: 'wtdg2_inherited_test',
    };
    const saved = Object.fromEntries(Object.keys(inherited).map((key) => [key, process.env[key]]));
    Object.assign(process.env, inherited);
    let env: NodeJS.ProcessEnv;
    try {
      env = operatorEnv('wtdg2-sentinel-root');
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
    expect(env.MIMER_TEST_MODE).toBe('1');
    expect(env.DATABASE_URL).toBe(DEAD_DATABASE_URL);
    expect(env.TEST_DATABASE_URL).toBe(DEAD_DATABASE_URL);
    const databaseKeys = Object.entries(env)
      .filter(([key, value]) => value !== undefined && isDatabaseConnectionEnvKey(key, value))
      .map(([key]) => key)
      .sort();
    expect(databaseKeys).toEqual(['DATABASE_URL', 'TEST_DATABASE_URL']);
    expect(Object.keys(env).filter((key) => key.startsWith('VITEST') || key === 'NODE_ENV')).toEqual([]);
  });
});

describe("LU bootstrap proof scripts never touch the caller's MIMERS_ROOT", () => {
  it.each(SCRIPTS)(
    '%s',
    (script) => {
      const sandbox = mkdtempSync(join(tmpdir(), 'lu-r1-sentinel-'));
      const sentinel = join(sandbox, 'caller-owned-mimers-root');
      try {
        // CAS-shaped, caller-owned content the proof must neither read, extend nor rewrite.
        mkdirSync(join(sentinel, 'cas', 'objects'), { recursive: true });
        writeFileSync(join(sentinel, 'MARKER'), 'caller-owned persistent root');
        writeFileSync(join(sentinel, 'cas', 'objects', 'keep.bin'), 'caller-owned object');
        const before = snapshot(sentinel);

        const { result, stdout, isolation } = runScript(script, sentinel);

        // The sentinel is unchanged: nothing added, removed or rewritten anywhere beneath it.
        expect(snapshot(sentinel), `${script}\n${stdout}\n${result.stderr}`).toEqual(before);

        // The proof still ran for real, against a filesystem-backed Mimers CAS at a DISTINCT root.
        expect(isolation, `no PROOF_ISOLATION attestation printed by ${script}`).not.toBeNull();
        const root = isolation!.root;
        const realTmp = realpathSync(tmpdir());
        expect(resolve(root)).not.toBe(resolve(sentinel));
        expect(resolve(root).startsWith(resolve(sentinel) + sep)).toBe(false);
        expect(resolve(root).startsWith(realTmp) || resolve(root).startsWith(resolve(tmpdir()))).toBe(true);
        expect(isolation!.mimers_backed, 'must be the real Mimers CAS, not the in-memory shortcut').toBe(
          true,
        );
        expect(isolation!.cas_dir_present, 'CAS directory must exist on disk during the proof').toBe(true);

        // The real assessment in STEP 1 was admitted through the general engine.
        expect(stdout).toMatch(/"originalRunAdmitted": true/);

        // The temporary root is cleaned up once the proof finishes.
        expect(existsSync(root), 'isolated temp root must be removed after the proof').toBe(false);
      } finally {
        rmSync(sandbox, { recursive: true, force: true });
      }
    },
    180_000,
  );
});
