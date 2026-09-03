import { generateKeyPairSync, sign as signBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  evaluateTrustedExecutionGate,
  proofContractHash,
  RESULT,
  signExecutionRecord,
  unitDefinitionHash,
} from '../devgov/devgov.mjs';
import {
  ATTESTATION_SCHEMA,
  ATTESTATION_VERSION,
  EXECUTION_RECORD_SCHEMA,
  executionResultDigest,
  stableJson,
  verifyExecutionAttestation,
} from '../devgov/trusted-attestation.mjs';
import { PINNED_VERIFIER_AUTHORITY } from '../devgov/github-oidc.mjs';

const issuer = 'github-actions:example/repo:devgov-v0-attest';
const keyId = 'devgov-ci-ed25519-v1';
const workflowRef = 'example/repo/.github/workflows/devgov-v0-attest.yml@refs/heads/main';
const runnerIdentity = 'github-hosted:ubuntu-latest';
const candidateSha = 'b'.repeat(40);
const controllerSha = 'd'.repeat(40);
const gateContext = { candidateSha, controllerSha };

const manifest = {
  schema_version: 'dev-gov-v1-unit-definition',
  unit: 'DEV-GOV-V0-TRUSTED-ATTESTATION',
  role: 'verifier',
  mode: 'read_only',
  branch: 'codex/dev-gov-v0-test',
  base_sha: 'a'.repeat(40),
  ancestry_policy: 'exact_parent',
  allowed_paths: ['scripts/devgov/**'],
  forbidden_paths: ['server/**'],
  trusted_execution: { issuer, key_id: keyId },
  required_red: [
    {
      id: 'red',
      command: 'node',
      args: ['red.mjs'],
      expected_classification: 'FAIL',
    },
  ],
  required_green: [{ id: 'green', command: 'node', args: ['green.mjs'] }],
};

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
        issuer,
        key_id: keyId,
        algorithm: 'ed25519',
        public_key_pem: publicKey,
        workflow_ref: workflowRef,
        runner_identity: runnerIdentity,
      },
    ],
  };
}

function record(overrides = {}) {
  const value = {
    schema_version: 'dev-gov-v1-trusted-execution-record',
    unit_id: manifest.unit,
    unit_definition_hash: unitDefinitionHash(manifest),
    proof_contract_hash: proofContractHash(manifest),
    base_sha: manifest.base_sha,
    candidate_sha: candidateSha,
    execution_sha: manifest.base_sha,
    proof_type: 'RED',
    test_id: 'red',
    command: 'node red.mjs',
    exit_code: 1,
    classification: 'FAIL',
    environment_error: '',
    started_at: '2026-09-01T10:00:00.000Z',
    finished_at: '2026-09-01T10:00:01.000Z',
    runner_identity: runnerIdentity,
    controller_sha: controllerSha,
    workflow_ref: workflowRef,
    workflow_run_id: '100',
    workflow_run_attempt: '1',
    stdout_sha256: 'e'.repeat(64),
    stderr_sha256: 'f'.repeat(64),
    ...overrides,
  };
  return { ...value, result_digest: executionResultDigest(value) };
}

function signedPair(privateKey) {
  const red = signExecutionRecord(record(), privateKey, { issuer, key_id: keyId });
  const green = signExecutionRecord(
    record({
      execution_sha: candidateSha,
      proof_type: 'GREEN',
      test_id: 'green',
      command: 'node green.mjs',
      exit_code: 0,
      classification: 'PASS',
      started_at: '2026-09-01T11:00:00.000Z',
      finished_at: '2026-09-01T11:00:01.000Z',
    }),
    privateKey,
    { issuer, key_id: keyId },
  );
  return [red, green];
}

function resignAttestation(attestation, privateKey, mutate) {
  const { signature: _signature, ...payload } = attestation;
  const changedPayload = mutate({ ...payload });
  const signature = signBytes(null, Buffer.from(stableJson(changedPayload)), privateKey).toString('base64');
  return { ...changedPayload, signature };
}

describe('DEV-GOV-V0 trusted execution authority', () => {
  it('binds the exact current execution-record schema inside the signed envelope', () => {
    const trusted = keys();
    const [red] = signedPair(trusted.privateKey);

    expect(red.schema_version).toBe(ATTESTATION_SCHEMA);
    expect(red.attestation_version).toBe(ATTESTATION_VERSION);
    expect(red.execution_record_schema_version).toBe(EXECUTION_RECORD_SCHEMA);
    expect(verifyExecutionAttestation(red, policy(trusted.publicKey))).toEqual({
      valid: true,
      errors: [],
    });
  });

  it.each([
    ['old', 'dev-gov-v0-trusted-execution-record'],
    ['future', 'dev-gov-v2-trusted-execution-record'],
    ['wrong type', 1],
  ])('denies a legitimately signed %s inner schema version', (_label, schemaVersion) => {
    const trusted = keys();
    const [red] = signedPair(trusted.privateKey);
    const changed = resignAttestation(red, trusted.privateKey, (payload) => ({
      ...payload,
      execution_record_schema_version: schemaVersion,
    }));

    const result = verifyExecutionAttestation(changed, policy(trusted.publicKey));

    expect(result.valid).toBe(false);
    expect(result.errors).toContain(`schema_version must be ${EXECUTION_RECORD_SCHEMA}`);
  });

  it('denies a legitimately signed missing inner schema version', () => {
    const trusted = keys();
    const [red] = signedPair(trusted.privateKey);
    const changed = resignAttestation(red, trusted.privateKey, (payload) => {
      delete payload.execution_record_schema_version;
      return payload;
    });

    const result = verifyExecutionAttestation(changed, policy(trusted.publicKey));

    expect(result.valid).toBe(false);
    expect(result.errors).toContain(`schema_version must be ${EXECUTION_RECORD_SCHEMA}`);
  });

  it('denies a legitimately signed envelope/inner version mismatch', () => {
    const trusted = keys();
    const [red] = signedPair(trusted.privateKey);
    const changed = resignAttestation(red, trusted.privateKey, (payload) => ({
      ...payload,
      schema_version: 'dev-gov-v0-trusted-execution-attestation',
      execution_record_schema_version: EXECUTION_RECORD_SCHEMA,
    }));

    const result = verifyExecutionAttestation(changed, policy(trusted.publicKey));

    expect(result.valid).toBe(false);
    expect(result.errors).toContain(`schema_version must be ${ATTESTATION_SCHEMA}`);
  });

  it('accepts exact RED/GREEN claims signed by the externally trusted issuer', () => {
    const { privateKey, publicKey } = keys();

    const result = evaluateTrustedExecutionGate(
      manifest,
      signedPair(privateKey),
      policy(publicKey),
      gateContext,
    );

    expect(result).toEqual({ result: RESULT.PASS, proof_status: 'PROVEN', errors: [] });
  });

  it('denies a producer self-signed attestation under an untrusted key', () => {
    const trusted = keys();
    const producer = keys();

    const result = evaluateTrustedExecutionGate(
      manifest,
      signedPair(producer.privateKey),
      policy(trusted.publicKey),
      gateContext,
    );

    expect(result.result).toBe(RESULT.DENIED_GOVERNANCE);
    expect(result.proof_status).toBe('NOT_PROVEN');
    expect(result.errors.join('\n')).toContain('signature verification failed');
  });

  it('denies a signed payload changed after protected execution', () => {
    const trusted = keys();
    const [red, green] = signedPair(trusted.privateKey);

    const result = evaluateTrustedExecutionGate(
      manifest,
      [red, { ...green, classification: 'FAIL' }],
      policy(trusted.publicKey),
      gateContext,
    );

    expect(result.result).toBe(RESULT.DENIED_GOVERNANCE);
    expect(result.errors.join('\n')).toContain('attestation signature verification failed');
  });

  it('denies correctly signed execution for the wrong SHA or command', () => {
    const trusted = keys();
    const red = signExecutionRecord(record(), trusted.privateKey, { issuer, key_id: keyId });
    const wrongGreen = signExecutionRecord(
      record({
        execution_sha: '9'.repeat(40),
        proof_type: 'GREEN',
        test_id: 'green',
        command: 'node another-command.mjs',
        exit_code: 0,
        classification: 'PASS',
        started_at: '2026-09-01T11:00:00.000Z',
        finished_at: '2026-09-01T11:00:01.000Z',
      }),
      trusted.privateKey,
      { issuer, key_id: keyId },
    );

    const result = evaluateTrustedExecutionGate(
      manifest,
      [red, wrongGreen],
      policy(trusted.publicKey),
      gateContext,
    );

    expect(result.result).toBe(RESULT.DENIED_GOVERNANCE);
    expect(result.errors).toContain('missing trusted GREEN attestation for green');
  });

  it('denies attestations from an unexpected protected workflow or runner identity', () => {
    const trusted = keys();
    const attestations = signedPair(trusted.privateKey);
    const wrongPolicy = policy(trusted.publicKey);
    wrongPolicy.trusted_issuers[0].workflow_ref = 'example/repo/.github/workflows/other.yml@refs/heads/main';

    const result = evaluateTrustedExecutionGate(manifest, attestations, wrongPolicy, gateContext);

    expect(result.result).toBe(RESULT.DENIED_GOVERNANCE);
    expect(result.errors.join('\n')).toContain('workflow_ref is not trusted');
  });

  it('denies a changed or cross-candidate unit definition after attestation', () => {
    const trusted = keys();
    const attestations = signedPair(trusted.privateKey);
    const changedDefinition = { ...manifest, allowed_paths: ['scripts/audit/**'] };

    const result = evaluateTrustedExecutionGate(
      changedDefinition,
      attestations,
      policy(trusted.publicKey),
      gateContext,
    );

    expect(result.result).toBe(RESULT.DENIED_GOVERNANCE);
    expect(result.errors).toContain('missing trusted RED attestation for red');
    expect(result.errors).toContain('missing trusted GREEN attestation for green');
  });

  it('denies reuse against another candidate SHA and RED/GREEN cross-binding', () => {
    const trusted = keys();
    const [red, green] = signedPair(trusted.privateKey);
    const otherCandidate = '9'.repeat(40);
    const crossBoundGreen = signExecutionRecord(
      record({
        candidate_sha: otherCandidate,
        execution_sha: otherCandidate,
        proof_type: 'GREEN',
        test_id: 'green',
        command: 'node green.mjs',
        exit_code: 0,
        classification: 'PASS',
        started_at: '2026-09-01T11:00:00.000Z',
        finished_at: '2026-09-01T11:00:01.000Z',
      }),
      trusted.privateKey,
      { issuer, key_id: keyId },
    );

    const replay = evaluateTrustedExecutionGate(manifest, [red, green], policy(trusted.publicKey), {
      ...gateContext,
      candidateSha: otherCandidate,
    });
    const crossBinding = evaluateTrustedExecutionGate(
      manifest,
      [red, crossBoundGreen],
      policy(trusted.publicKey),
      gateContext,
    );

    expect(replay.result).toBe(RESULT.DENIED_GOVERNANCE);
    expect(crossBinding.result).toBe(RESULT.DENIED_GOVERNANCE);
    expect(crossBinding.errors).toContain('missing trusted GREEN attestation for green');
  });

  it('denies attestations produced by a different controller SHA', () => {
    const trusted = keys();

    const result = evaluateTrustedExecutionGate(
      manifest,
      signedPair(trusted.privateKey),
      policy(trusted.publicKey),
      { ...gateContext, controllerSha: '8'.repeat(40) },
    );

    expect(result.result).toBe(RESULT.DENIED_GOVERNANCE);
    expect(result.errors).toContain('missing trusted RED attestation for red');
  });

  it('denies missing trusted execution without downgrading it to local evidence', () => {
    const trusted = keys();

    const result = evaluateTrustedExecutionGate(manifest, [], policy(trusted.publicKey), gateContext);

    expect(result.result).toBe(RESULT.DENIED_GOVERNANCE);
    expect(result.proof_status).toBe('NOT_PROVEN');
    expect(result.errors).toContain('trusted execution attestation is required');
  });
});
