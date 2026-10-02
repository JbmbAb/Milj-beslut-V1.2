import fs from 'node:fs';
import path from 'node:path';

import {
  isDatabaseConnectionEnvKey,
  isHermeticTestProcess,
  isLocalEnvFile,
  isTestRuntime,
  noteTestEnvFileGuard,
} from './modules/test-db-guard/testDatabaseTargetPolicy';
import { isTestDataRootEnvKey } from './modules/test-db-guard/testDataRootIsolation';

type LoadEnvOptions = {
  includePrefixes?: string[];
  overrideExisting?: boolean;
};

function stripQuotes(value: string): string {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

// This loader is line-based (splits the file on real newlines), so a multi-line value -- e.g. a
// PEM-encoded key -- cannot be represented directly. The established convention for such values
// is to flatten real newlines to the literal two-character sequence \n on a single .env line; this
// unescapes that back to a real newline after quote-stripping. A value with no literal \n is
// returned unchanged.
function unescapeNewlines(value: string): string {
  return value.includes('\\n') ? value.replace(/\\n/g, '\n') : value;
}

export function loadEnvFile(fileName: string = '.env', options: LoadEnvOptions = {}): void {
  const filePath = path.resolve(process.cwd(), fileName);
  // TEST-DB-GUARD (OD-K0-5): a process marked MIMER_TEST_MODE (the Playwright API server, a test's
  // child process) reads no env file at all: its explicit process environment is its whole
  // configuration, whatever its working directory holds.
  if (isHermeticTestProcess(process.env)) {
    noteTestEnvFileGuard(filePath, 'MIMER_TEST_MODE: no env file is read in a marked test process');
    return;
  }
  // TEST-DB-GUARD (OD-K0-5): in a test runtime (NODE_ENV=test or a Vitest worker) a `*.local` env
  // file is never read at all -- in a developer worktree `.env.local` names the live database.
  const testRuntime = isTestRuntime(process.env);
  if (testRuntime && isLocalEnvFile(filePath)) {
    noteTestEnvFileGuard(filePath, 'a *.local env file is never read in a test runtime');
    return;
  }
  if (!fs.existsSync(filePath)) {
    return;
  }

  const includePrefixes = options.includePrefixes?.filter(Boolean) || [];
  const overrideExisting = options.overrideExisting === true;
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split(/\r?\n/);
  const droppedInTestRuntime: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;

    const key = trimmed.slice(0, eq).trim();
    if (!key) continue;
    if (includePrefixes.length > 0 && !includePrefixes.some((prefix) => key.startsWith(prefix))) continue;

    const rawValue = trimmed.slice(eq + 1).trim();
    // TEST-DB-GUARD (OD-K0-5): a test runtime never takes a database connection setting (or the
    // MIMER_TEST_DB_ALLOW opt-in) from any env file; those come from the explicit environment only.
    // TDG-4: nor a data root (QUARANTINE_ROOT, MIMERS_ROOT, ...): an env file cannot refill what the
    // test setup scrubbed (server/modules/test-db-guard/testDataRootIsolation.ts).
    if (
      testRuntime &&
      (isDatabaseConnectionEnvKey(key, stripQuotes(rawValue)) || isTestDataRootEnvKey(key))
    ) {
      droppedInTestRuntime.push(key);
      continue;
    }
    if (!overrideExisting && process.env[key]) continue;

    process.env[key] = unescapeNewlines(stripQuotes(rawValue));
  }
  if (droppedInTestRuntime.length > 0) {
    noteTestEnvFileGuard(
      filePath,
      `database connection and data-root keys not loaded in a test runtime: ${droppedInTestRuntime.join(', ')}`,
    );
  }
}
