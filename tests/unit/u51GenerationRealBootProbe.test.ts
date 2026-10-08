/**
 * Trust boundary of the real boot probe. Process tests use a synthetic composition in a temporary
 * git repository. They do not start the five production entrypoints; the proof runner does that.
 */
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { deriveEntrypointSetSha256 } from '../../packages/mps-release-entrypoints/src/entrypointSet';
import type { EntrypointEntry } from '../../packages/mps-release-entrypoints/src/types';
import { LOCAL_GENERATION_BLOCKER } from '../../server/modules/ai/generation/LocalGenerationPort';
import { REGISTRATION_IDENTIFIER } from '../../packages/mps-u51-generation-absence/src/index';
import { assertExactCheckout } from '../../packages/mps-u51-generation-absence/src/bootProbe/exactCheckout';
import { runBootProbe } from '../../packages/mps-u51-generation-absence/src/bootProbe/harness';
import { productionStartupGateSeen } from '../../packages/mps-u51-generation-absence/src/bootProbe/productionGates';
import {
  assembleGenerationDerivation,
  checkDeclaredAbsent,
} from '../../packages/mps-u51-generation-absence/src/bootProbe/prove';
import { sealBootObservations, type ProbeObservation } from '../../packages/mps-u51-generation-absence/src/bootProbe/seal';
import { validateGenerationDerivation } from '../../packages/mps-u51-manifest/src/evidenceSchemas';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const COMMIT = 'a'.repeat(40);
const TREE = 'b'.repeat(40);
const PORT_SHA = 'c'.repeat(40);

const derived: EntrypointEntry[] = [
  { id: 'web', role: 'web', argv: ['npm', 'start'], entry_file: 'server/index.ts' },
  { id: 'worker-a', role: 'worker', argv: ['node', '--import', 'tsx', 'server/workers/a-worker.ts'], entry_file: 'server/workers/a-worker.ts' },
];

function observation(entry: EntrypointEntry, patch: Partial<ProbeObservation> = {}): ProbeObservation {
  return {
    entry_id: entry.id,
    entry_file: entry.entry_file,
    argv: entry.argv,
    node_env: 'production',
    registered_after_boot: false,
    generate_attempt: { outcome: 'FAIL_CLOSED', code: LOCAL_GENERATION_BLOCKER },
    isolation_ok: true,
    subject_commit: COMMIT,
    subject_tree: TREE,
    nonce_ok: true,
    loaded_path_ok: true,
    ...patch,
  };
}

function seal(observations: ProbeObservation[], derivedSha = deriveEntrypointSetSha256(derived)) {
  return sealBootObservations({
    derived,
    derived_sha256: derivedSha,
    observations,
    subject_commit: COMMIT,
    subject_tree: TREE,
    fail_closed_code: LOCAL_GENERATION_BLOCKER,
  });
}

describe('seal rejects boot-probe mutations', () => {
  const both = derived.map((entry) => observation(entry));

  it('accepts the derived set and hashes that set', () => {
    const sealed = seal(both);
    expect(sealed.ok).toBe(true);
    if (!sealed.ok) return;
    expect(sealed.claimed_sha256).toBe(deriveEntrypointSetSha256(derived));
    expect(sealed.entrypoints.map((entry) => entry.entry_id)).toEqual(['web', 'worker-a']);
    expect(sealed.entrypoints.every((entry) => entry.registered_after_boot === false)).toBe(true);
    expect(sealed.entrypoints.every((entry) => entry.generate_attempt.code === LOCAL_GENERATION_BLOCKER)).toBe(true);
  });

  it('rejects an omitted entrypoint', () => {
    expect(seal([both[0]!]).blocker).toBe('OMITTED_ENTRYPOINT');
  });

  it('rejects an extra entrypoint', () => {
    expect(seal([...both, observation({ id: 'extra', role: 'worker', argv: ['node', 'x'], entry_file: 'server/x.ts' })]).blocker).toBe('EXTRA_ENTRYPOINT');
  });

  it('rejects a non-production profile', () => {
    expect(seal([observation(derived[0]!, { node_env: 'test' }), both[1]!]).blocker).toBe('PROFILE_NOT_PRODUCTION');
  });

  it('rejects a registered runtime', () => {
    expect(seal([observation(derived[0]!, { registered_after_boot: true }), both[1]!]).blocker).toBe('RUNTIME_REGISTERED');
  });

  it('rejects a successful generation call', () => {
    expect(seal([observation(derived[0]!, { generate_attempt: { outcome: 'SUCCESS' } }), both[1]!]).blocker).toBe('GENERATION_RETURNED_SUCCESS');
  });

  it('rejects any other failure code', () => {
    expect(seal([observation(derived[0]!, { generate_attempt: { outcome: 'FAIL_CLOSED', code: 'OTHER_CODE' } }), both[1]!]).blocker).toBe('UNEXPECTED_GENERATION_CODE');
  });

  it('rejects a claimed hash that is not the hash of the accepted entries', () => {
    expect(seal(both, 'd'.repeat(64)).blocker).toBe('HASH_NOT_EQUAL');
  });

  it('rejects a result stamped with another commit', () => {
    expect(seal([observation(derived[0]!, { subject_commit: 'e'.repeat(40) }), both[1]!]).blocker).toBe('FOREIGN_SUBJECT');
  });

  it('rejects a result whose nonce does not match this run', () => {
    expect(seal([observation(derived[0]!, { nonce_ok: false }), both[1]!]).blocker).toBe('FOREIGN_SUBJECT');
  });

  it('rejects a broken isolation boundary', () => {
    expect(seal([observation(derived[0]!, { isolation_ok: false }), both[1]!]).blocker).toBe('ISOLATION_BROKEN');
  });
});

describe('production startup gates', () => {
  it('recognises the web security-env refusal and each worker PEM refusal', () => {
    expect(productionStartupGateSeen('web', 'Error: Missing required security env variables: JWT_ACCESS_SECRET')).toBe(true);
    for (const id of ['lu-execution-identity-v3', 'lu-geometry-supersession', 'lu-project-context-bootstrap', 'lu-viewer-capability']) {
      expect(productionStartupGateSeen(id, 'worker: SOME_PEM is not set -- refusing to start.')).toBe(true);
    }
  });

  it('does not treat an earlier crash, or an unknown id, as the gate', () => {
    expect(productionStartupGateSeen('web', 'DATABASE_URL_REQUIRED')).toBe(false);
    expect(productionStartupGateSeen('lu-execution-identity-v3', 'durable Mimers CAS is not ready')).toBe(false);
    expect(productionStartupGateSeen('not-a-derived-id', 'is not set -- refusing to start.')).toBe(false);
  });
});

describe('C6 accepts a sealed DECLARED_ABSENT payload and rejects a mutated one', () => {
  const sealed = seal(derived.map((entry) => observation(entry)));
  if (!sealed.ok) throw new Error(sealed.blocker);
  const assembled = assembleGenerationDerivation({
    treeSha: TREE,
    portBlobSha1: PORT_SHA,
    census: { registration_identifier_files: 0, nonliteral_dynamic_imports: 0, test_registration_files: 0 },
    claimedSha256: sealed.claimed_sha256,
    derivedSha256: sealed.claimed_sha256,
    entrypoints: sealed.entrypoints,
  });
  if (!assembled.ok) throw new Error(assembled.blocker);

  it('schema-valid payload passes C6', () => {
    expect(validateGenerationDerivation(assembled.payload)).toBe(true);
    expect(checkDeclaredAbsent(TREE, assembled.payload)).toBeUndefined();
  });

  it('a different failure code fails C6', () => {
    const mutated = structuredClone(assembled.payload);
    mutated.boot_probe.entrypoints[0]!.generate_attempt = { outcome: 'FAIL_CLOSED', code: 'OTHER_CODE' };
    expect(checkDeclaredAbsent(TREE, mutated)).not.toBeUndefined();
  });

  it('a census that found a registration is not assembled', () => {
    const refused = assembleGenerationDerivation({
      treeSha: TREE,
      portBlobSha1: PORT_SHA,
      census: { registration_identifier_files: 1, nonliteral_dynamic_imports: 0, test_registration_files: 0 },
      claimedSha256: sealed.claimed_sha256,
      derivedSha256: sealed.claimed_sha256,
      entrypoints: sealed.entrypoints,
    });
    expect(refused.ok).toBe(false);
  });
});

const gitEnv = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };

function git(dir: string, args: string[]): string {
  const run = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8', env: gitEnv });
  if (run.status !== 0) throw new Error(`git ${args.join(' ')}: ${run.stderr}`);
  return run.stdout.trim();
}

function fixtureSource(registerPortUrl?: string): string {
  const register = registerPortUrl === undefined
    ? ''
    : `import { ${REGISTRATION_IDENTIFIER} } from ${JSON.stringify(registerPortUrl)};\nif (process.env.U51_FIXTURE_MODE === 'register') {\n  ${REGISTRATION_IDENTIFIER}({ runtime_id: 'probe-fixture', model_id: 'probe-fixture', model_version: '0', async generateText() { return 'ok'; } });\n}\n`;
  return `${register}import net from 'node:net';
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const mode = process.env.U51_FIXTURE_MODE ?? 'exit';
if (mode === 'connect') net.connect(Number(process.env.U51_FIXTURE_PORT), '127.0.0.1');
if (mode === 'listen') net.createServer().listen(0, '127.0.0.1');
if (mode === 'spawn') spawnSync(process.execPath, ['-e', 'require("fs").writeFileSync(process.env.U51_SPAWN_MARKER, "ran")']);
if (mode === 'profile') process.env.NODE_ENV = 'development';
process.exit(0);
`;
}

function commitComposition(dir: string, source: string): string {
  const files: Record<string, string> = {
    'deploy/onprem/entrypoints.json': JSON.stringify({
      schema: 'u51-entrypoints-1',
      entries: [
        { id: 'web', role: 'web', argv: ['npm', 'start'], entry_file: 'server/index.ts' },
        { id: 'worker-a', role: 'worker', argv: ['node', '--import', 'tsx', 'server/workers/a-worker.ts'], entry_file: 'server/workers/a-worker.ts' },
      ],
      not_production: [
        { entry_file: 'server/workers/b-worker.ts', reason: 'Synthetic non-production worker used only to exercise U51 composition derivation.' },
      ],
    }),
    'Dockerfile': 'FROM node:22 AS web\nCMD ["npm","start"]\nFROM node:22 AS b\nCMD ["npx","tsx","server/workers/b-worker.ts"]\n',
    'package.json': JSON.stringify({ scripts: { start: 'node --import tsx server/index.ts', 'worker:a': 'node --import tsx server/workers/a-worker.ts' } }),
    'deploy/onprem/image-smoke/smoke.mjs': "const ENTRYPOINTS = ['server/index.ts', 'server/workers/a-worker.ts'];\n",
    'server/index.ts': source,
    'server/workers/a-worker.ts': source,
    'server/workers/b-worker.ts': 'function main() {}\nmain();\n',
    'server/workers/bootstrap.ts': 'export function boot(): void {}\n',
    'server/workers/registry.ts': 'export function startAll(): void {}\n',
  };
  for (const [rel, text] of Object.entries(files)) {
    const target = path.join(dir, ...rel.split('/'));
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, text);
  }
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'fixture']);
  return git(dir, ['rev-parse', 'HEAD']);
}

describe('boot probe process boundary', () => {
  const dirs: string[] = [];
  afterAll(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  });

  function repo(): string {
    const dir = mkdtempSync(path.join(tmpdir(), 'u51-boot-subject-'));
    dirs.push(dir);
    git(dir, ['init', '-q']);
    return dir;
  }

  it('refuses a dirty subject before spawning', async () => {
    const dir = repo();
    commitComposition(dir, fixtureSource());
    writeFileSync(path.join(dir, 'server', 'index.ts'), 'process.exit(0);\n');
    const run = await runBootProbe({ repo: dir, commit: 'HEAD', timeoutMs: 30_000 });
    expect(run.blocker).toBe('DIRTY_SUBJECT');
    expect(run.attempts).toEqual([]);
  });

  it('a clean fixture entry fails closed on the real generation port', async () => {
    const dir = repo();
    const commit = commitComposition(dir, fixtureSource());
    const run = await runBootProbe({ repo: dir, commit, timeoutMs: 60_000 });
    expect(run.blocker).toBeUndefined();
    expect(run.attempts).toHaveLength(2);
    for (const attempt of run.attempts) {
      expect(attempt.problem).toBeUndefined();
      expect(attempt.observation?.node_env).toBe('production');
      expect(attempt.observation?.registered_after_boot).toBe(false);
      expect(attempt.observation?.generate_attempt).toEqual({ outcome: 'FAIL_CLOSED', code: LOCAL_GENERATION_BLOCKER });
      expect(attempt.observation?.isolation_ok).toBe(true);
      expect(attempt.observation?.subject_commit).toBe(commit);
    }
    const observations = run.attempts.map((attempt) => attempt.observation!);
    const sealed = sealBootObservations({
      derived: run.attempts.map((attempt) => attempt.entry),
      derived_sha256: run.derived_sha256!,
      observations,
      subject_commit: run.commit_sha!,
      subject_tree: run.tree_sha!,
      fail_closed_code: LOCAL_GENERATION_BLOCKER,
    });
    expect(sealed.ok).toBe(true);
  }, 120_000);

  it('a connect attempt is refused before the socket is established', async () => {
    const seen: string[] = [];
    const server = createServer((socket) => {
      seen.push('connected');
      socket.end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('no port');
    try {
      const dir = repo();
      const commit = commitComposition(dir, fixtureSource());
      const run = await runBootProbe({
        repo: dir,
        commit,
        timeoutMs: 60_000,
        extraEnv: { U51_FIXTURE_MODE: 'connect', U51_FIXTURE_PORT: String(address.port) },
      });
      expect(seen).toEqual([]);
      expect(run.attempts.every((attempt) => attempt.report?.isolation.connect_attempts === 1)).toBe(true);
      expect(run.attempts.every((attempt) => attempt.observation?.isolation_ok === false)).toBe(true);
      const sealed = sealBootObservations({
        derived: run.attempts.map((attempt) => attempt.entry),
        derived_sha256: run.derived_sha256!,
        observations: run.attempts.map((attempt) => attempt.observation!),
        subject_commit: run.commit_sha!,
        subject_tree: run.tree_sha!,
        fail_closed_code: LOCAL_GENERATION_BLOCKER,
      });
      expect(sealed.ok).toBe(false);
      if (sealed.ok) return;
      expect(sealed.blocker).toBe('ISOLATION_BROKEN');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }, 120_000);

  it('a child process is refused and does not write the marker', async () => {
    const dir = repo();
    const commit = commitComposition(dir, fixtureSource());
    const marker = path.join(dir, 'spawn-marker.txt');
    const run = await runBootProbe({
      repo: dir,
      commit,
      timeoutMs: 60_000,
      extraEnv: { U51_FIXTURE_MODE: 'spawn', U51_SPAWN_MARKER: marker },
    });
    let markerExists = true;
    try {
      readFileSync(marker);
    } catch {
      markerExists = false;
    }
    expect(markerExists).toBe(false);
    expect(run.attempts.every((attempt) => (attempt.report?.isolation.spawn_attempts ?? 0) >= 1)).toBe(true);
    expect(run.attempts.every((attempt) => attempt.observation?.isolation_ok === false)).toBe(true);
  }, 120_000);

  it('a development profile reported by the entry is not sealed as production', async () => {
    const dir = repo();
    const commit = commitComposition(dir, fixtureSource());
    const run = await runBootProbe({ repo: dir, commit, timeoutMs: 60_000, extraEnv: { U51_FIXTURE_MODE: 'profile' } });
    expect(run.attempts.every((attempt) => attempt.observation?.node_env === 'development')).toBe(true);
    const sealed = sealBootObservations({
      derived: run.attempts.map((attempt) => attempt.entry),
      derived_sha256: run.derived_sha256!,
      observations: run.attempts.map((attempt) => attempt.observation!),
      subject_commit: run.commit_sha!,
      subject_tree: run.tree_sha!,
      fail_closed_code: LOCAL_GENERATION_BLOCKER,
    });
    expect(sealed.ok).toBe(false);
    if (sealed.ok) return;
    expect(sealed.blocker).toBe('PROFILE_NOT_PRODUCTION');
  }, 120_000);

  it('refuses HEAD when the requested commit is not the checkout', async () => {
    const dir = repo();
    const first = commitComposition(dir, fixtureSource());
    writeFileSync(path.join(dir, 'server', 'workers', 'registry.ts'), 'export function startAll(): void { return; }\n');
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-q', '-m', 'second']);
    const checkout = assertExactCheckout(dir, first);
    expect(checkout.ok).toBe(false);
    if (checkout.ok) return;
    expect(checkout.blocker).toBe('HEAD_IS_NOT_SUBJECT');
  });
});
