/**
 * Spawns each derived production entrypoint as the process main module under the isolation preload.
 * Subject identity is the git commit. The working directory is an empty temporary directory, so the
 * entry's env-file loader does not see the developer's .env. The generation result is whatever the
 * child recorded; this module does not rewrite it.
 */
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { deriveEntrypointSet } from '../entrypointSet.js';
import { iterateTreeEntries } from '../gitTree.js';
import { assertExactCheckout, blobIdAt } from './exactCheckout.js';
import type { ProbeObservation } from './seal.js';
import { REQUIRED_ISOLATION_HOOKS, type ChildReport, type DerivedProbeEntry } from './types.js';

function modulePath(relative: string): string {
  const spec = import.meta.url;
  if (spec.startsWith('file:')) return fileURLToPath(new URL(relative, spec));
  return path.resolve(path.dirname(spec), relative);
}

const PRELOAD = modulePath('./preload.ts');
const TSX_LOADER = modulePath('../../../../node_modules/tsx/dist/loader.mjs');
const LOOPBACK_DATABASE_URL = 'postgresql://u51_boot_probe:refused@127.0.0.1:9/u51_boot_probe_absent';
const ENV_ALLOW = [
  'PATH',
  'PATHEXT',
  'SYSTEMROOT',
  'WINDIR',
  'COMSPEC',
  'TEMP',
  'TMP',
  'TMPDIR',
  'HOME',
  'USERPROFILE',
  'APPDATA',
  'LOCALAPPDATA',
  'PROGRAMFILES',
  'COMMONPROGRAMFILES',
  'SYSTEMDRIVE',
  'HOMEDRIVE',
  'HOMEPATH',
] as const;

export interface BootAttempt {
  readonly entry: DerivedProbeEntry;
  readonly report?: ChildReport;
  readonly stderr_tail: string;
  readonly timed_out: boolean;
  readonly exit_code: number | null;
  readonly observation?: ProbeObservation;
  readonly problem?: string;
}

export interface BootProbeRun {
  readonly ok: boolean;
  readonly blocker?: string;
  readonly commit_sha?: string;
  readonly tree_sha?: string;
  readonly derived_sha256?: string;
  readonly attempts: readonly BootAttempt[];
}

export interface RunBootProbeOptions {
  readonly repo: string;
  readonly commit: string;
  readonly timeoutMs: number;
  readonly extraEnv?: Readonly<Record<string, string>>;
}

function samePath(a: string, b: string): boolean {
  const left = path.resolve(a);
  const right = path.resolve(b);
  return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
}

function redact(text: string): string {
  return text.replace(/[a-z][a-z0-9+.-]*:\/\/\S+/gi, '[redacted-url]');
}

function childEnv(input: {
  repo: string;
  commit: string;
  tree: string;
  entryId: string;
  nonce: string;
  resultPath: string;
  extraEnv?: Readonly<Record<string, string>>;
}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ENV_ALLOW) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  if (input.extraEnv !== undefined) {
    for (const [key, value] of Object.entries(input.extraEnv)) env[key] = value;
  }
  env.NODE_ENV = 'production';
  env.DATABASE_URL = LOOPBACK_DATABASE_URL;
  env.U51_BOOT_PROBE = '1';
  env.U51_BOOT_PROBE_NONCE = input.nonce;
  env.U51_BOOT_PROBE_RESULT = input.resultPath;
  env.U51_BOOT_PROBE_ENTRY_ID = input.entryId;
  env.U51_BOOT_PROBE_SUBJECT_COMMIT = input.commit;
  env.U51_BOOT_PROBE_SUBJECT_TREE = input.tree;
  env.U51_BOOT_PROBE_SUBJECT_ROOT = path.resolve(input.repo);
  delete env.NODE_OPTIONS;
  return env;
}

function parseReport(text: string): ChildReport | undefined {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof value !== 'object' || value === null) return undefined;
  const report = value as ChildReport;
  if (typeof report.nonce !== 'string' || typeof report.entry_id !== 'string' || typeof report.node_env !== 'string') return undefined;
  if (typeof report.registered_after_boot !== 'boolean') return undefined;
  if (typeof report.generate_attempt?.outcome !== 'string') return undefined;
  if (typeof report.isolation?.armed !== 'boolean' || !Array.isArray(report.isolation.hooks)) return undefined;
  if (typeof report.subject_commit !== 'string' || typeof report.subject_tree !== 'string') return undefined;
  if (typeof report.loaded_entry !== 'string' || typeof report.stop_kind !== 'string' || typeof report.stop_message !== 'string') return undefined;
  return report;
}

function isolationOk(report: ChildReport): boolean {
  const hooks = new Set(report.isolation.hooks);
  return (
    report.isolation.armed &&
    REQUIRED_ISOLATION_HOOKS.every((hook) => hooks.has(hook)) &&
    report.isolation.connect_attempts === 0 &&
    report.isolation.listen_attempts === 0 &&
    report.isolation.spawn_attempts === 0 &&
    report.isolation.refused_writes === 0 &&
    report.isolation.dns_external_attempts === 0
  );
}

function spawnEntry(input: {
  repo: string;
  commit: string;
  tree: string;
  entry: DerivedProbeEntry;
  probeHome: string;
  timeoutMs: number;
  extraEnv?: Readonly<Record<string, string>>;
}): Promise<BootAttempt> {
  const nonce = randomBytes(16).toString('hex');
  const resultPath = path.join(input.probeHome, `result-${input.entry.id}.json`);
  const entryPath = path.resolve(input.repo, input.entry.entry_file);
  const env = childEnv({ ...input, entryId: input.entry.id, nonce, resultPath });

  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    let timedOut = false;
    let settled = false;
    const child = spawn(process.execPath, ['--import', pathToFileURL(TSX_LOADER).href, '--import', pathToFileURL(PRELOAD).href, entryPath], {
      cwd: input.probeHome,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes <= 256_000) chunks.push(chunk);
    });
    child.stdout?.on('data', () => {
      /* entry logs are not evidence */
    });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, input.timeoutMs);
    const finish = (attempt: BootAttempt): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(attempt);
    };
    child.on('error', () => {
      finish({
        entry: input.entry,
        stderr_tail: '',
        timed_out: false,
        exit_code: null,
        problem: 'PROCESS_DID_NOT_START',
      });
    });
    child.on('close', (exitCode) => {
      const stderr = redact(Buffer.concat(chunks).toString('utf8')).slice(-16_000);
      if (timedOut) {
        finish({ entry: input.entry, stderr_tail: stderr, timed_out: true, exit_code: exitCode, problem: 'NO_RESULT_BEFORE_DEADLINE' });
        return;
      }
      let raw = '';
      try {
        raw = readFileSync(resultPath, 'utf8');
      } catch {
        finish({ entry: input.entry, stderr_tail: stderr, timed_out: false, exit_code: exitCode, problem: 'NO_RESULT' });
        return;
      }
      const report = parseReport(raw);
      if (report === undefined) {
        finish({ entry: input.entry, stderr_tail: stderr, timed_out: false, exit_code: exitCode, problem: 'MALFORMED_REPORT' });
        return;
      }
      const observation: ProbeObservation = {
        entry_id: input.entry.id,
        entry_file: input.entry.entry_file,
        argv: input.entry.argv,
        node_env: report.node_env,
        registered_after_boot: report.registered_after_boot,
        generate_attempt: report.generate_attempt,
        isolation_ok: isolationOk(report),
        subject_commit: report.subject_commit,
        subject_tree: report.subject_tree,
        nonce_ok: report.nonce === nonce && report.entry_id === input.entry.id,
        loaded_path_ok: samePath(report.loaded_entry, entryPath),
      };
      finish({ entry: input.entry, report, stderr_tail: stderr, timed_out: false, exit_code: exitCode, observation });
    });
  });
}

export async function runBootProbe(options: RunBootProbeOptions): Promise<BootProbeRun> {
  const checkout = assertExactCheckout(options.repo, options.commit);
  if (checkout.ok === false) return { ok: false, blocker: checkout.blocker, attempts: [] };

  const derived = deriveEntrypointSet([...iterateTreeEntries(options.repo, checkout.subject.tree_sha)]);
  if (derived.status !== 'DERIVED') return { ok: false, blocker: derived.blocker, commit_sha: checkout.subject.commit_sha, tree_sha: checkout.subject.tree_sha, attempts: [] };

  try {
    readFileSync(TSX_LOADER);
  } catch {
    return { ok: false, blocker: 'TSX_LOADER_ABSENT', commit_sha: checkout.subject.commit_sha, tree_sha: checkout.subject.tree_sha, attempts: [] };
  }

  const probeHome = mkdtempSync(path.join(tmpdir(), 'u51-boot-home-'));
  const attempts: BootAttempt[] = [];
  try {
    for (const entry of derived.entrypoints) {
      if (blobIdAt(options.repo, checkout.subject.commit_sha, entry.entry_file) === undefined) {
        attempts.push({
          entry,
          stderr_tail: '',
          timed_out: false,
          exit_code: null,
          problem: 'ENTRY_NOT_IN_TREE',
        });
        continue;
      }
      attempts.push(await spawnEntry({
        repo: options.repo,
        commit: checkout.subject.commit_sha,
        tree: checkout.subject.tree_sha,
        entry,
        probeHome,
        timeoutMs: options.timeoutMs,
        extraEnv: options.extraEnv,
      }));
    }
  } finally {
    rmSync(probeHome, { recursive: true, force: true });
  }

  return {
    ok: attempts.every((attempt) => attempt.observation !== undefined),
    commit_sha: checkout.subject.commit_sha,
    tree_sha: checkout.subject.tree_sha,
    derived_sha256: derived.derived_sha256,
    attempts,
  };
}
