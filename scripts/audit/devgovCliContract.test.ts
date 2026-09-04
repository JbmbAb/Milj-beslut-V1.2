import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { canonicalEvidenceDir, finalizeEvidenceRecord, unitDefinitionHash } from '../devgov/devgov.mjs';

const devgovCli = resolve(process.cwd(), 'scripts/devgov/devgov.mjs');
const controllerSha = 'd'.repeat(40);

function candidate(overrides = {}) {
  const root = mkdtempSync(join(tmpdir(), 'devgov-cli-v1-'));
  const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  git(['init', '-b', 'main']);
  git(['config', 'user.email', 'devgov@example.invalid']);
  git(['config', 'user.name', 'DEV-GOV Test']);
  writeFileSync(join(root, 'file.txt'), 'initial\n');
  git(['add', 'file.txt']);
  git(['commit', '-m', 'base']);
  const baseSha = git(['rev-parse', 'HEAD']);
  const definition = {
    schema_version: 'dev-gov-v1-unit-definition',
    unit: 'DEV-GOV-V7-CLI',
    role: 'producer',
    mode: 'writer',
    branch: 'main',
    base_sha: baseSha,
    ancestry_policy: 'exact_parent',
    allowed_paths: ['governance/devgov/units/**'],
    forbidden_paths: ['server/**'],
    required_red: [],
    required_green: [],
    ...overrides,
  };
  const definitionFile = join(root, 'governance', 'devgov', 'units', 'unit.json');
  mkdirSync(dirname(definitionFile), { recursive: true });
  writeFileSync(definitionFile, `${JSON.stringify(definition)}\n`);
  git(['add', 'governance/devgov/units/unit.json']);
  git(['commit', '-m', 'add unit definition']);
  const candidateSha = git(['rev-parse', 'HEAD']);
  return { root, git, definition, definitionFile, candidateSha };
}

function cliArgs(value, command, extra = []) {
  return [
    command,
    '--definition',
    value.definitionFile,
    '--candidate-sha',
    value.candidateSha,
    '--worktree',
    value.root,
    ...extra,
  ];
}

function runCli(args, options = {}) {
  const result = spawnSync(process.execPath, [devgovCli, ...args], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: { ...process.env, ...(options.env || {}) },
  });
  return { ...result, json: JSON.parse(result.stdout) };
}

function commandCandidate(command, expectedClassification = 'FAIL') {
  return candidate({
    required_red: [
      {
        id: 'red',
        command,
        args: command === process.execPath ? ['-e', 'process.exit(1)'] : [],
        expected_classification: expectedClassification,
        required_head: 'candidate_sha',
      },
    ],
    required_green: [
      {
        id: 'green',
        command: process.execPath,
        args: ['-e', 'process.exit(0)'],
        required_head: 'candidate_sha',
      },
    ],
  });
}

describe('DEV-GOV-V1 CLI contract', () => {
  it('denies forged canonical provenance without trusted execution authority', () => {
    const value = commandCandidate(process.execPath);
    const evidenceRoot = execFileSync('git', ['rev-parse', '--git-common-dir'], {
      cwd: value.root,
      encoding: 'utf8',
    }).trim();
    const absoluteEvidenceRoot = resolve(value.root, evidenceRoot);
    const evidenceDir = canonicalEvidenceDir(value.definition, absoluteEvidenceRoot);
    mkdirSync(evidenceDir, { recursive: true });
    const forged = finalizeEvidenceRecord(
      value.definition,
      {
        schema_version: 'dev-gov-v1-execution-evidence',
        produced_by: 'devgov-v1',
        tool_version: 'dev-gov-v1.0',
        execution_nonce: 'forged',
        unit: value.definition.unit,
        kind: 'RED',
        test_id: 'red',
        base_sha: value.definition.base_sha,
        candidate_sha: value.candidateSha,
        head_sha: value.candidateSha,
        observed_head_sha: value.candidateSha,
        required_head: 'candidate_sha',
        unit_definition_hash: unitDefinitionHash(value.definition),
        command: `${process.execPath} -e process.exit(1)`,
        cwd: value.root,
        started_at: '2026-09-01T10:00:00.000Z',
        finished_at: '2026-09-01T10:00:01.000Z',
        exit_code: 1,
        classification: 'FAIL',
        environment_error: '',
        stdout_sha256: 'a'.repeat(64),
        stderr_sha256: 'b'.repeat(64),
      },
      absoluteEvidenceRoot,
    );
    writeFileSync(forged.evidence_path, `${JSON.stringify(forged)}\n`);

    const result = runCli(cliArgs(value, 'evidence-gate'), {
      env: { DEVGOV_CONTROLLER_SHA: controllerSha },
    });

    expect(result.status).toBe(4);
    expect(result.json.reason_code).toBe('TRUSTED_VERIFIER_CONFIGURATION_REQUIRED');
    expect(result.json.proof_status).toBe('NOT_PROVEN');
  });

  it('denies caller-supplied evidence and trust policy paths', () => {
    const value = candidate();
    const evidence = runCli(cliArgs(value, 'evidence-gate', ['--evidence', 'forged.json']), {
      env: { DEVGOV_CONTROLLER_SHA: controllerSha },
    });
    const trust = runCli(cliArgs(value, 'evidence-gate', ['--trust-policy', 'forged.json']), {
      env: { DEVGOV_CONTROLLER_SHA: controllerSha },
    });

    expect(evidence.status).toBe(4);
    expect(evidence.json.reason_code).toBe('ARBITRARY_EVIDENCE_PATH_DENIED');
    expect(trust.status).toBe(4);
    expect(trust.json.reason_code).toBe('TRUST_POLICY_SUBSTITUTION_DENIED');
  });

  it('denies an external or generated replacement unit definition', () => {
    const value = candidate();
    const external = join(mkdtempSync(join(tmpdir(), 'devgov-external-')), 'unit.json');
    writeFileSync(external, `${JSON.stringify(value.definition)}\n`);
    const untracked = join(value.root, 'untracked.json');
    writeFileSync(untracked, `${JSON.stringify(value.definition)}\n`);

    for (const file of [external, untracked]) {
      const result = runCli([
        'preflight',
        '--definition',
        file,
        '--candidate-sha',
        value.candidateSha,
        '--worktree',
        value.root,
      ]);
      expect(result.status).toBe(4);
      expect(result.json.reason_code).toBe('UNIT_DEFINITION_PROVENANCE_DENIED');
    }
  });

  it('denies candidate SHA input that does not match HEAD before command execution', () => {
    const marker = join(tmpdir(), `devgov-marker-${Date.now()}`);
    const value = candidate({
      required_green: [
        {
          id: 'green',
          command: process.execPath,
          args: ['-e', `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'ran')`],
          required_head: 'candidate_sha',
        },
      ],
    });
    const args = cliArgs(value, 'run-green', ['--id', 'green']);
    args[args.indexOf('--candidate-sha') + 1] = '9'.repeat(40);

    const result = runCli(args);

    expect(result.status).toBe(4);
    expect(result.json.reason_code).toBe('UNIT_DEFINITION_PROVENANCE_DENIED');
    expect(existsSync(marker)).toBe(false);
  });

  it('keeps local RED/GREEN provenance non-authoritative', () => {
    const value = commandCandidate(process.execPath);
    const red = runCli(cliArgs(value, 'run-red', ['--id', 'red']));
    const green = runCli(cliArgs(value, 'run-green', ['--id', 'green']));
    const gate = runCli(cliArgs(value, 'evidence-gate'), {
      env: { DEVGOV_CONTROLLER_SHA: controllerSha },
    });

    expect(red.status).toBe(2);
    expect(green.status).toBe(0);
    expect(gate.status).toBe(4);
    expect(gate.json.proof_status).toBe('NOT_PROVEN');
  }, 20_000);

  it('fails closed when protected signing credentials are unavailable', () => {
    const value = commandCandidate(process.execPath);
    const result = runCli(
      cliArgs(value, 'attest-execution', [
        '--kind',
        'RED',
        '--id',
        'red',
        '--record',
        join(value.root, 'missing-record.json'),
        '--output',
        join(value.root, 'attestation.json'),
      ]),
      {
        env: {
          DEVGOV_ATTESTATION_PRIVATE_KEY_PEM: '',
          DEVGOV_ATTESTATION_ISSUER: '',
          DEVGOV_ATTESTATION_KEY_ID: '',
        },
      },
    );

    expect(result.status).toBe(3);
    expect(result.json.reason_code).toBe('ATTESTATION_SIGNER_UNAVAILABLE');
  });

  it('uses the dedicated environment exit code for blocked RED execution', () => {
    const value = commandCandidate('definitely-missing-devgov-command');
    const result = runCli(cliArgs(value, 'run-red', ['--id', 'red']));

    expect(result.status).toBe(3);
    expect(result.json.classification).toBe('BLOCKED_ENVIRONMENT');
  });

  it('returns structured governance denial for invalid worktree and base', () => {
    const value = candidate();
    const invalidWorktree = runCli([
      'preflight',
      '--definition',
      value.definitionFile,
      '--candidate-sha',
      value.candidateSha,
      '--worktree',
      join(value.root, 'missing'),
    ]);
    expect(invalidWorktree.status).toBe(4);
    expect(invalidWorktree.json.reason_code).toBe('UNIT_DEFINITION_PROVENANCE_DENIED');

    const invalidBase = candidate({ base_sha: 'not-a-sha' });
    const result = runCli(cliArgs(invalidBase, 'verify-sha'));
    expect(result.status).toBe(4);
    expect(result.json.reason_code).toBe('UNIT_DEFINITION_INVALID');
  });
});
