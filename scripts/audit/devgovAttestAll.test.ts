import { execFileSync, spawnSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  EXIT_CODE,
  RESULT,
  evaluateTrustedExecutionGate,
  proofContractHash,
  sha256,
  unitDefinitionHash,
} from '../devgov/devgov.mjs';
import { EXECUTION_RECORD_SCHEMA, executionResultDigest, verifyExecutionAttestation } from '../devgov/trusted-attestation.mjs';
import { PINNED_VERIFIER_AUTHORITY } from '../devgov/github-oidc.mjs';

// V1-THROUGHPUT: attest-all is the one-approval batch signer invoked by devgov-v0-orchestrate.yml's
// same-run sign: job (see devgovTrustedWorkflow.test.ts for the workflow-shape assertions). These
// tests drive the real devgov.mjs CLI end to end -- a real throwaway git candidate, real unsigned
// execution-record artifacts on disk, the real signer path -- to prove the batch both signs
// correctly and fails entirely closed, matching the probe script this test formalizes.

const devgovCli = resolve(process.cwd(), 'scripts/devgov/devgov.mjs');

const ISSUER = 'devgov-attest-all-test-issuer';
const KEY_ID = 'devgov-attest-all-test-key-1';
// attest-all binds every signed record's workflow_ref to devgov.mjs's own internal
// TRUSTED_EXECUTION_WORKFLOW_REF constant, never to the signing job's own ambient
// GITHUB_WORKFLOW_REF (see that constant's definition for why). It is not exported -- duplicated
// here as a literal, same as the throwaway probe script this test formalizes.
const WORKFLOW_REF = 'JbmbAb/Milj-beslut-V1.2/.github/workflows/devgov-v0-attest.yml@refs/heads/main';
const RUNNER_IDENTITY = 'github-hosted:ubuntu-latest';
const CONTROLLER_SHA = 'c'.repeat(40);
const RUN_ID = '999999';
const RUN_ATTEMPT = '1';

function keys() {
  return generateKeyPairSync('ed25519', {
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
}

function policy(publicKey) {
  return {
    schema_version: 'dev-gov-v0-trust-policy',
    authority: PINNED_VERIFIER_AUTHORITY,
    trusted_issuers: [
      {
        issuer: ISSUER,
        key_id: KEY_ID,
        algorithm: 'ed25519',
        public_key_pem: publicKey,
        workflow_ref: WORKFLOW_REF,
        runner_identity: RUNNER_IDENTITY,
      },
    ],
  };
}

function candidate() {
  const root = mkdtempSync(join(tmpdir(), 'devgov-attest-all-'));
  const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  git(['init', '-q', '-b', 'main']);
  git(['config', 'user.email', 'devgov@example.invalid']);
  git(['config', 'user.name', 'DEV-GOV Test']);
  const definition = {
    schema_version: 'dev-gov-v1-unit-definition',
    unit: 'DEV-GOV-V1-ATTEST-ALL-TEST',
    role: 'producer',
    mode: 'writer',
    branch: 'main',
    base_sha: 'a'.repeat(40),
    ancestry_policy: 'descendant_of_base',
    allowed_paths: ['**/*'],
    forbidden_paths: [],
    required_red: [
      { id: 'red-1', command: 'true', args: [], expected_classification: 'FAIL', required_head: 'base_sha' },
    ],
    required_green: [{ id: 'green-1', command: 'true', args: [], required_head: 'candidate_sha' }],
    trusted_execution: { issuer: ISSUER, key_id: KEY_ID },
  };
  const definitionFile = join(root, 'governance', 'devgov', 'units', 'unit.json');
  mkdirSync(join(root, 'governance', 'devgov', 'units'), { recursive: true });
  writeFileSync(definitionFile, `${JSON.stringify(definition, null, 2)}\n`);
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'add unit definition']);
  const candidateSha = git(['rev-parse', 'HEAD']);
  return { root, definition, definitionFile, candidateSha };
}

function record(value, kind, id, classification, overrides = {}) {
  const { definition, candidateSha } = value;
  const base = {
    schema_version: EXECUTION_RECORD_SCHEMA,
    unit_id: definition.unit,
    unit_definition_hash: unitDefinitionHash(definition),
    proof_contract_hash: proofContractHash(definition),
    base_sha: definition.base_sha,
    candidate_sha: candidateSha,
    execution_sha: kind === 'RED' ? definition.base_sha : candidateSha,
    proof_type: kind,
    test_id: id,
    command: 'true',
    exit_code: classification === 'FAIL' ? 1 : 0,
    classification,
    environment_error: '',
    // GREEN must follow RED in wall-clock time for evaluateTrustedExecutionGate to accept the pair
    // (proves GREEN was genuinely executed after RED within the same run, not just independently
    // valid) -- mirrors devgovTrustedAttestation.test.ts's own signedPair() fixture.
    started_at: kind === 'RED' ? '2026-09-01T10:00:00.000Z' : '2026-09-01T11:00:00.000Z',
    finished_at: kind === 'RED' ? '2026-09-01T10:00:01.000Z' : '2026-09-01T11:00:01.000Z',
    runner_identity: RUNNER_IDENTITY,
    controller_sha: CONTROLLER_SHA,
    workflow_ref: WORKFLOW_REF,
    workflow_run_id: RUN_ID,
    workflow_run_attempt: RUN_ATTEMPT,
    stdout_sha256: sha256(''),
    stderr_sha256: sha256(''),
    ...overrides,
  };
  return { ...base, result_digest: executionResultDigest(base) };
}

function writeRecordArtifact(recordsRoot, kind, id, value) {
  const dir = join(recordsRoot, `devgov-execution-${RUN_ID}-${RUN_ATTEMPT}-${kind}-${id}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'execution-record.json'), `${JSON.stringify(value, null, 2)}\n`);
}

function runAttestAll(value, recordsRoot, outputDir, signer) {
  const result = spawnSync(
    process.execPath,
    [
      devgovCli,
      'attest-all',
      '--definition',
      value.definitionFile,
      '--candidate-sha',
      value.candidateSha,
      '--worktree',
      value.root,
      '--records-root',
      recordsRoot,
      '--output-dir',
      outputDir,
    ],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: {
        ...process.env,
        DEVGOV_ATTESTATION_PRIVATE_KEY_PEM: signer.privateKey,
        DEVGOV_ATTESTATION_ISSUER: ISSUER,
        DEVGOV_ATTESTATION_KEY_ID: KEY_ID,
        DEVGOV_RUNNER_IDENTITY: RUNNER_IDENTITY,
        DEVGOV_CONTROLLER_SHA: CONTROLLER_SHA,
        GITHUB_RUN_ID: RUN_ID,
        GITHUB_RUN_ATTEMPT: RUN_ATTEMPT,
      },
    },
  );
  return { ...result, json: JSON.parse(result.stdout) };
}

describe('DEV-GOV-V1 attest-all batch signer', () => {
  it('signs every declared record from the verified unit definition in one pass', () => {
    const trusted = keys();
    const value = candidate();
    const recordsRoot = mkdtempSync(join(tmpdir(), 'devgov-records-'));
    const outputDir = mkdtempSync(join(tmpdir(), 'devgov-output-'));
    writeRecordArtifact(recordsRoot, 'RED', 'red-1', record(value, 'RED', 'red-1', 'FAIL'));
    writeRecordArtifact(recordsRoot, 'GREEN', 'green-1', record(value, 'GREEN', 'green-1', 'PASS'));

    const result = runAttestAll(value, recordsRoot, outputDir, trusted);

    expect(result.status).toBe(EXIT_CODE.PASS);
    expect(result.json.classification).toBe(RESULT.PASS);
    expect(result.json.proof_ids).toHaveLength(2);
    expect(existsSync(join(outputDir, 'attestation-RED-red-1.json'))).toBe(true);
    expect(existsSync(join(outputDir, 'attestation-GREEN-green-1.json'))).toBe(true);

    // The batch signer's output must not just be "a file exists" -- it must be a real, independently
    // verifiable attestation the actual gate would accept as PROVEN.
    const redAttestation = JSON.parse(readFileSync(join(outputDir, 'attestation-RED-red-1.json'), 'utf8'));
    const greenAttestation = JSON.parse(
      readFileSync(join(outputDir, 'attestation-GREEN-green-1.json'), 'utf8'),
    );
    const trustPolicy = policy(trusted.publicKey);
    expect(verifyExecutionAttestation(redAttestation, trustPolicy)).toEqual({ valid: true, errors: [] });
    expect(verifyExecutionAttestation(greenAttestation, trustPolicy)).toEqual({ valid: true, errors: [] });
    expect(
      evaluateTrustedExecutionGate(value.definition, [redAttestation, greenAttestation], trustPolicy, {
        candidateSha: value.candidateSha,
        controllerSha: CONTROLLER_SHA,
      }),
    ).toEqual({ result: RESULT.PASS, proof_status: 'PROVEN', errors: [] });
  });

  it('fails the entire batch closed and writes zero output files when a declared record is missing', () => {
    const trusted = keys();
    const value = candidate();
    const recordsRoot = mkdtempSync(join(tmpdir(), 'devgov-records-'));
    const outputDir = mkdtempSync(join(tmpdir(), 'devgov-output-'));
    writeRecordArtifact(recordsRoot, 'RED', 'red-1', record(value, 'RED', 'red-1', 'FAIL'));
    // GREEN record intentionally absent -- a partially broken candidate must not walk away with
    // partial trusted-execution evidence.

    const result = runAttestAll(value, recordsRoot, outputDir, trusted);

    expect(result.status).toBe(EXIT_CODE.DENIED_GOVERNANCE);
    expect(result.json.classification).toBe(RESULT.DENIED_GOVERNANCE);
    expect(readdirSync(outputDir)).toHaveLength(0);
  });

  it('denies a record whose content does not match the id it is presented as', () => {
    const trusted = keys();
    const value = candidate();
    const recordsRoot = mkdtempSync(join(tmpdir(), 'devgov-records-'));
    const outputDir = mkdtempSync(join(tmpdir(), 'devgov-output-'));
    writeRecordArtifact(recordsRoot, 'RED', 'red-1', record(value, 'RED', 'red-1', 'FAIL'));
    const forged = record(value, 'GREEN', 'green-1', 'PASS', { test_id: 'some-other-id' });
    writeRecordArtifact(recordsRoot, 'GREEN', 'green-1', forged);

    const result = runAttestAll(value, recordsRoot, outputDir, trusted);

    expect(result.status).toBe(EXIT_CODE.DENIED_GOVERNANCE);
    expect(result.json.message).toContain('test_id mismatch');
    expect(readdirSync(outputDir)).toHaveLength(0);
  });

  it('denies a record forged under a different workflow_ref', () => {
    const trusted = keys();
    const value = candidate();
    const recordsRoot = mkdtempSync(join(tmpdir(), 'devgov-records-'));
    const outputDir = mkdtempSync(join(tmpdir(), 'devgov-output-'));
    const forged = record(value, 'RED', 'red-1', 'FAIL', {
      workflow_ref: 'attacker/forked-repo/.github/workflows/devgov-v0-attest.yml@refs/heads/evil',
    });
    writeRecordArtifact(recordsRoot, 'RED', 'red-1', forged);
    writeRecordArtifact(recordsRoot, 'GREEN', 'green-1', record(value, 'GREEN', 'green-1', 'PASS'));

    const result = runAttestAll(value, recordsRoot, outputDir, trusted);

    expect(result.status).toBe(EXIT_CODE.DENIED_GOVERNANCE);
    expect(result.json.message).toContain('workflow_ref mismatch');
    expect(readdirSync(outputDir)).toHaveLength(0);
  });
});
