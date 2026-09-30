/**
 * ppe-cli (plan section 1, D3): `validate`, `run` and `schemas` exercised as a real child process
 * (tsx), in temp directories under os.tmpdir(), against the frozen section-5 artifacts and this
 * checkout. Exit codes: validate 0 ok / 1 inadmissible / 2 harness; run 0 stoppedByMode at
 * RED_SYNTHESIS / 3 terminal / 1 inadmissible artifact / 2 harness fault (incl. any non-BOOTSTRAP mode).
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { AUTHORITY_NOT_IN_DISCOVERY_OR_GRAPH } from '../src/state-machine';
import { PPE_ARTIFACT_SCHEMAS } from '../src/schemas';
import {
  FROZEN_TARGET_DECISION_GATE,
  FROZEN_TARGET_DEPENDENCY_GRAPH,
  FROZEN_TARGET_DISCOVERY,
  FROZEN_TARGET_RED_PLAN,
} from './fixtures/frozen-target-artifacts';
import { allLocatorsOf } from './fixtures/state';

const REPO_ROOT = process.cwd();
const TSX_CLI = path.resolve(REPO_ROOT, 'node_modules/tsx/dist/cli.mjs');
const CLI = path.resolve(REPO_ROOT, 'packages/mps-pattern-proof/scripts/ppe-cli.ts');
const SPAWN_TIMEOUT_MS = 120_000;
const TEST_TIMEOUT_MS = 180_000;

const RUNTIME_LEDGER: readonly string[] = allLocatorsOf(
  FROZEN_TARGET_DISCOVERY,
  FROZEN_TARGET_DEPENDENCY_GRAPH,
)
  .filter((locator) => locator.kind === 'runtime_result')
  .map((locator) => locator.ref);

interface CliRun {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly json: unknown;
}

function runCli(args: readonly string[], input?: string): CliRun {
  const result = spawnSync(process.execPath, [TSX_CLI, CLI, ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: process.env,
    timeout: SPAWN_TIMEOUT_MS,
    ...(input === undefined ? {} : { input }),
  });
  expect(result.error, `spawn error: ${String(result.error)}`).toBeUndefined();
  let json: unknown;
  try {
    json = JSON.parse(result.stdout) as unknown;
  } catch {
    json = undefined;
  }
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, json };
}

const tempDirs: string[] = [];

function tempDir(label: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `ppe-cli-${label}-`));
  tempDirs.push(dir);
  return dir;
}

function writeJson(dir: string, name: string, value: unknown): string {
  const file = path.join(dir, name);
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
  return file;
}

/** A temp evidence dir seeded with the four frozen section-5 artifacts (overridable) + the ledger. */
function seedEvidenceDir(
  label: string,
  overrides: Partial<Record<'discovery' | 'dependencyGraph' | 'decisionGate' | 'redPlan', unknown>> = {},
  options: { readonly redPlan?: boolean; readonly ledger?: boolean } = {},
): string {
  const dir = tempDir(label);
  writeJson(dir, 'discovery.json', overrides.discovery ?? FROZEN_TARGET_DISCOVERY);
  writeJson(dir, 'dependency-graph.json', overrides.dependencyGraph ?? FROZEN_TARGET_DEPENDENCY_GRAPH);
  writeJson(dir, 'decision-gate.json', overrides.decisionGate ?? FROZEN_TARGET_DECISION_GATE);
  if (options.redPlan !== false) writeJson(dir, 'red-plan.json', overrides.redPlan ?? FROZEN_TARGET_RED_PLAN);
  if (options.ledger !== false) writeJson(dir, 'runtime-ledger.json', RUNTIME_LEDGER);
  return dir;
}

function asRecord(value: unknown): Record<string, unknown> {
  expect(typeof value).toBe('object');
  expect(value).not.toBeNull();
  return value as Record<string, unknown>;
}

afterAll(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
});

describe('ppe-cli validate', () => {
  it(
    'ok: --file with the frozen DiscoveryArtifact prints {ok:true, kind, digest} and exits 0',
    () => {
      const dir = tempDir('validate-ok');
      const file = writeJson(dir, 'discovery.json', FROZEN_TARGET_DISCOVERY);
      const run = runCli(['validate', '--kind', 'discovery', '--file', file]);
      expect(run.status).toBe(0);
      const out = asRecord(run.json);
      expect(out.ok).toBe(true);
      expect(out.kind).toBe('discovery');
      expect(out.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'ok: stdin input for every frozen kind',
    () => {
      const cases: readonly (readonly [string, unknown])[] = [
        ['dependency-graph', FROZEN_TARGET_DEPENDENCY_GRAPH],
        ['decision-gate', FROZEN_TARGET_DECISION_GATE],
        ['red-plan', FROZEN_TARGET_RED_PLAN],
      ];
      for (const [kind, artifact] of cases) {
        const run = runCli(['validate', '--kind', kind], JSON.stringify(artifact));
        expect(run.status, run.stdout).toBe(0);
        expect(asRecord(run.json).kind).toBe(kind);
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'not ok: a finding without evidence prints the PPE code + message + path and exits 1 (never throws to the console)',
    () => {
      const inadmissible = { findings: [{ category: 'x', description: 'y', evidence: [] }] };
      const run = runCli(['validate', '--kind', 'discovery'], JSON.stringify(inadmissible));
      expect(run.status).toBe(1);
      const out = asRecord(run.json);
      expect(out.ok).toBe(false);
      const errors = out.errors as { code: string; message: string; path?: string }[];
      expect(errors).toHaveLength(1);
      expect(errors[0].code).toBe('PPE_EVIDENCE_REQUIRED');
      expect(errors[0].message).toContain('PPE_EVIDENCE_REQUIRED');
      expect(errors[0].path).toBe('discovery.findings[0].evidence');
      expect(run.stderr).not.toMatch(/at .*\.ts:\d+/);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'harness faults exit 2: unknown kind, unreadable JSON, missing --file',
    () => {
      expect(runCli(['validate', '--kind', 'nope'], '{}').status).toBe(2);
      expect(runCli(['validate', '--kind', 'discovery'], '{not json').status).toBe(2);
      expect(runCli(['validate', '--kind', 'discovery', '--file', '/nonexistent/x.json']).status).toBe(2);
      const bad = runCli(['validate', '--kind', 'discovery'], '{not json');
      expect(asRecord(asRecord(bad.json).error).code).toBe('PPE_CLI_HARNESS');
    },
    TEST_TIMEOUT_MS,
  );
});

describe('ppe-cli run (BOOTSTRAP_RED_ONLY over the frozen target artifacts)', () => {
  it(
    'happy path: exit 0, run-state.json written, printed summary stoppedAtPhase RED_SYNTHESIS with the four artifacts stored',
    () => {
      const dir = seedEvidenceDir('happy');
      const run = runCli([
        'run',
        '--dir',
        dir,
        '--mode',
        'BOOTSTRAP_RED_ONLY',
        '--repo-root',
        REPO_ROOT,
        '--run-id',
        'ppe-cli-test-happy',
        '--json',
      ]);
      expect(run.status, run.stdout + run.stderr).toBe(0);
      const summary = asRecord(run.json);
      expect(summary).toMatchObject({
        ok: true,
        exitCode: 0,
        runId: 'ppe-cli-test-happy',
        mode: 'BOOTSTRAP_RED_ONLY',
        phase: 'RED_SYNTHESIS',
        stoppedAtPhase: 'RED_SYNTHESIS',
        stoppedByMode: { atPhase: 'RED_SYNTHESIS', reason: 'BOOTSTRAP_RED_ONLY' },
        storedArtifacts: ['discovery', 'dependency-graph', 'decision-gate', 'red-plan'],
      });
      expect(summary.terminalState).toBeUndefined();
      // --json prints only the JSON summary on stdout
      expect(run.stdout.trim().startsWith('{')).toBe(true);

      const stateFile = path.join(dir, 'run-state.json');
      expect(summary.runStateFile).toBe(stateFile);
      expect(fs.existsSync(stateFile)).toBe(true);
      const state = asRecord(JSON.parse(fs.readFileSync(stateFile, 'utf8')));
      expect(state.mode).toBe('BOOTSTRAP_RED_ONLY');
      expect(state.phase).toBe('RED_SYNTHESIS');
      expect(state.stoppedByMode).toEqual({ atPhase: 'RED_SYNTHESIS', reason: 'BOOTSTRAP_RED_ONLY' });
      expect(state.terminal).toBeUndefined();
      const artifacts = asRecord(state.artifacts);
      expect(artifacts.redPlan).toEqual(FROZEN_TARGET_RED_PLAN);
      expect(artifacts.discovery).toEqual(FROZEN_TARGET_DISCOVERY);
      expect(artifacts.candidate).toBeUndefined();
      const history = state.history as { to: string }[];
      expect(history.map((t) => t.to)).toEqual([
        'BUILD_GRAPH',
        'DECISION_GATE',
        'RED_SYNTHESIS',
        'RED_SYNTHESIS',
      ]);
      expect(history.some((t) => t.to === 'WRITER')).toBe(false);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    '--out and --ledger override the defaults; without --json a human line goes to stderr and the JSON to stdout',
    () => {
      const dir = seedEvidenceDir('overrides', {}, { ledger: false });
      const ledger = writeJson(tempDir('ledger'), 'ledger.json', RUNTIME_LEDGER);
      const out = path.join(tempDir('out'), 'nested', 'state.json');
      const run = runCli([
        'run',
        '--dir',
        dir,
        '--mode',
        'BOOTSTRAP_RED_ONLY',
        '--repo-root',
        REPO_ROOT,
        '--ledger',
        ledger,
        '--out',
        out,
      ]);
      expect(run.status, run.stdout + run.stderr).toBe(0);
      expect(fs.existsSync(out)).toBe(true);
      expect(fs.existsSync(path.join(dir, 'run-state.json'))).toBe(false);
      expect(run.stderr).toContain('stopped by mode BOOTSTRAP_RED_ONLY at RED_SYNTHESIS');
      expect(asRecord(run.json).runStateFile).toBe(out);
      expect(asRecord(run.json).runId).toBe(`ppe-cli-run:${path.basename(dir)}`);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'a red plan citing a locator absent from discovery/graph: exit 3, terminal MISSING_AUTHORITY, run state written',
    () => {
      const invented = { kind: 'file_line', ref: 'services/mapLayerSelection.ts:1' };
      const redPlan = {
        probes: [
          FROZEN_TARGET_RED_PLAN.probes[0],
          {
            id: 'red-map-layer-unavailable',
            assertedBehavior: 'mapLayerSelection exposes an `unavailable` signal',
            authorityEvidence: invented,
            command: 'assert the signal exists',
          },
        ],
      };
      const dir = seedEvidenceDir('missing-authority', { redPlan });
      const run = runCli([
        'run',
        '--dir',
        dir,
        '--mode',
        'BOOTSTRAP_RED_ONLY',
        '--repo-root',
        REPO_ROOT,
        '--json',
      ]);
      expect(run.status, run.stdout + run.stderr).toBe(3);
      const summary = asRecord(run.json);
      expect(summary.exitCode).toBe(3);
      expect(summary.terminalState).toBe('MISSING_AUTHORITY');
      expect(summary.stoppedAtPhase).toBeUndefined();
      expect(asRecord(summary.terminal)).toMatchObject({
        state: 'MISSING_AUTHORITY',
        atPhase: 'RED_SYNTHESIS',
        evidence: [{ locator: invented, reason: AUTHORITY_NOT_IN_DISCOVERY_OR_GRAPH }],
      });
      expect(summary.storedArtifacts).toEqual(['discovery', 'dependency-graph', 'decision-gate']);
      const state = asRecord(JSON.parse(fs.readFileSync(path.join(dir, 'run-state.json'), 'utf8')));
      expect(asRecord(state.terminal).state).toBe('MISSING_AUTHORITY');
      expect(asRecord(state.artifacts).redPlan).toBeUndefined();
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'a non-MECHANICAL gate item stops the run terminally (exit 3) even when red-plan.json is absent',
    () => {
      const decisionGate = {
        items: [
          ...FROZEN_TARGET_DECISION_GATE.items,
          {
            item: 'Should C-anmälan show the whole verdict or a simplified projection?',
            classification: 'HUMAN_DECISION_REQUIRED',
            blockingReason: 'owner-level semantic decision',
          },
        ],
      };
      const dir = seedEvidenceDir('gate-stop', { decisionGate }, { redPlan: false });
      const run = runCli([
        'run',
        '--dir',
        dir,
        '--mode',
        'BOOTSTRAP_RED_ONLY',
        '--repo-root',
        REPO_ROOT,
        '--json',
      ]);
      expect(run.status, run.stdout + run.stderr).toBe(3);
      const summary = asRecord(run.json);
      expect(summary.terminalState).toBe('HUMAN_DECISION_REQUIRED');
      expect(asRecord(summary.terminal).blockingReason).toBe('owner-level semantic decision');
      expect(asRecord(summary.terminal).atPhase).toBe('DECISION_GATE');
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'red-plan.json absent while the gate passes is a harness fault (exit 2), not a verdict',
    () => {
      const dir = seedEvidenceDir('no-red-plan', {}, { redPlan: false });
      const run = runCli([
        'run',
        '--dir',
        dir,
        '--mode',
        'BOOTSTRAP_RED_ONLY',
        '--repo-root',
        REPO_ROOT,
        '--json',
      ]);
      expect(run.status).toBe(2);
      expect(asRecord(asRecord(run.json).error).message).toContain('red-plan.json is missing');
      expect(fs.existsSync(path.join(dir, 'run-state.json'))).toBe(false);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'an inadmissible discovery (finding without evidence): exit 1 with the PPE code; no run state written',
    () => {
      const discovery = { findings: [{ category: 'x', description: 'y', evidence: [] }] };
      const dir = seedEvidenceDir('inadmissible', { discovery });
      const run = runCli([
        'run',
        '--dir',
        dir,
        '--mode',
        'BOOTSTRAP_RED_ONLY',
        '--repo-root',
        REPO_ROOT,
        '--json',
      ]);
      expect(run.status, run.stdout + run.stderr).toBe(1);
      const out = asRecord(run.json);
      expect(out.ok).toBe(false);
      expect(out.exitCode).toBe(1);
      expect(asRecord(out.error).code).toBe('PPE_EVIDENCE_REQUIRED');
      expect(fs.existsSync(path.join(dir, 'run-state.json'))).toBe(false);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    '--mode FULL_PATTERN_PROOF is refused (exit 2) quoting BOOTSTRAP section 7, before anything is read or written',
    () => {
      const dir = seedEvidenceDir('full-mode');
      const run = runCli([
        'run',
        '--dir',
        dir,
        '--mode',
        'FULL_PATTERN_PROOF',
        '--repo-root',
        REPO_ROOT,
        '--json',
      ]);
      expect(run.status).toBe(2);
      const error = asRecord(asRecord(run.json).error);
      expect(error.code).toBe('PPE_CLI_HARNESS');
      expect(error.message).toContain('refused');
      expect(error.message).toContain('BOOTSTRAP design section 7');
      expect(error.message).toContain(
        'separate, later unit requiring its own review and its own separate go',
      );
      expect(fs.existsSync(path.join(dir, 'run-state.json'))).toBe(false);
      expect(runCli(['run', '--dir', dir, '--repo-root', REPO_ROOT]).status).toBe(2);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'missing input file / unreadable JSON / unknown command: exit 2',
    () => {
      expect(
        runCli([
          'run',
          '--dir',
          path.join(os.tmpdir(), 'ppe-cli-does-not-exist'),
          '--mode',
          'BOOTSTRAP_RED_ONLY',
        ]).status,
      ).toBe(2);
      const dir = seedEvidenceDir('bad-json');
      fs.writeFileSync(path.join(dir, 'dependency-graph.json'), '{not json');
      const run = runCli([
        'run',
        '--dir',
        dir,
        '--mode',
        'BOOTSTRAP_RED_ONLY',
        '--repo-root',
        REPO_ROOT,
        '--json',
      ]);
      expect(run.status).toBe(2);
      expect(asRecord(asRecord(run.json).error).message).toContain('dependency-graph artifact');
      expect(runCli(['frobnicate']).status).toBe(2);
      expect(runCli([]).status).toBe(2);
    },
    TEST_TIMEOUT_MS,
  );
});

describe('ppe-cli schemas', () => {
  it(
    'prints PPE_ARTIFACT_SCHEMAS (all kinds, or one kind)',
    () => {
      const all = runCli(['schemas']);
      expect(all.status).toBe(0);
      expect(all.json).toEqual(PPE_ARTIFACT_SCHEMAS);
      const one = runCli(['schemas', '--kind', 'red-plan']);
      expect(one.status).toBe(0);
      expect(one.json).toEqual(PPE_ARTIFACT_SCHEMAS['red-plan']);
      expect(runCli(['schemas', '--kind', 'nope']).status).toBe(2);
    },
    TEST_TIMEOUT_MS,
  );
});
