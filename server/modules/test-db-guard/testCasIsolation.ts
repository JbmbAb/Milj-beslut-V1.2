import { mkdirSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { TEST_DB_GUARD_LABEL } from './testDatabaseTargetPolicy';

/**
 * TEST-DB-GUARD (OD-K0-5), TDG-3 (MIMERS_ROOT): a test never touches live data. A MIMERS_ROOT set
 * in the caller's shell -- e.g. the demonstrator's CAS -- went as it was to the E2E API server
 * (playwright.config.ts), which then wrote into it; every other CAS setting was inherited the same
 * way, by the E2E servers and by every process a Vitest test starts.
 *
 * CAS settings are every `MIMERS_*` key (MIMERS_ROOT, MIMERS_NFS_ROOT, MIMERS_DURABILITY_MODE,
 * MIMERS_REQUIRED, ...) and every key that names a CAS (LU_MPS_CAS, ADMIN_ROLE_GRANT_CAS_ROOT, ...).
 * A test process never inherits them from the shell:
 *   - the Vitest setup file removes them from every worker before a test file runs, so no process
 *     a test starts inherits them either (a test that needs a CAS creates its own temp root, as
 *     tests/setup/casTestIsolationRoot.ts does);
 *   - playwright.config.ts removes them from its runner and workers -- Playwright starts both
 *     servers with `{ ...process.env, ...webServer.env }` -- and gives the API server a FRESH temp
 *     CAS root created by this run (an absolute path in the temp directory, never reused).
 */

export function isCasEnvKey(key: string): boolean {
  const upper = String(key).toUpperCase();
  return upper.startsWith('MIMERS_') || /(^|_)CAS(_|$)/.test(upper);
}

/** Removes every CAS setting from `env`; returns the removed key names (never values). */
export function removeInheritedCasEnv(env: NodeJS.ProcessEnv = process.env): string[] {
  const removed = Object.keys(env).filter(isCasEnvKey).sort();
  for (const key of removed) delete env[key];
  return removed;
}

const NOTED = Symbol.for('mimer.testDbGuard.casEnvRemovedNoted');

/** One stderr line per process when inherited CAS settings were removed; names keys, never values. */
export function noteRemovedCasEnv(removed: readonly string[], via: string): void {
  if (removed.length === 0) return;
  const g = globalThis as { [NOTED]?: true };
  if (g[NOTED]) return;
  g[NOTED] = true;
  process.stderr.write(
    `[${TEST_DB_GUARD_LABEL}] ${via}: inherited CAS settings removed (a test never uses the caller's CAS): ` +
      `${removed.join(', ')}\n`,
  );
}

export type FreshTestCasRoots = {
  /** The new, empty run directory (absolute, in the temp directory). */
  readonly runRoot: string;
  /** MIMERS_ROOT: an existing, empty, absolute directory (the server never creates it). */
  readonly mimersRoot: string;
  /** ADMIN_ROLE_GRANT_CAS_ROOT: otherwise `.data/admin-role-grants` in the server's cwd. */
  readonly adminRoleGrantCasRoot: string;
};

/** A fresh CAS for one E2E run: a new temp directory per call, never an existing one. */
export function createFreshTestCasRoots(tmp: string = os.tmpdir()): FreshTestCasRoots {
  const runRoot = mkdtempSync(path.join(path.resolve(tmp), 'miljobeslut-e2e-cas-'));
  const mimersRoot = path.join(runRoot, 'mimers');
  const adminRoleGrantCasRoot = path.join(runRoot, 'admin-role-grants');
  mkdirSync(mimersRoot);
  mkdirSync(adminRoleGrantCasRoot);
  return { runRoot, mimersRoot, adminRoleGrantCasRoot };
}
