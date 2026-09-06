import { generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  completeEvidenceGate,
  evaluateTrustedExecutionGate,
  EXIT_CODE,
  GATE_VERDICT_REASON,
  GATE_VERDICT_SCHEMA,
  proofContractHash,
  signExecutionRecord,
  unitDefinitionHash,
  verifyGateVerdict,
} from '../devgov/devgov.mjs';
import { executionResultDigest, sha256, stableJson } from '../devgov/trusted-attestation.mjs';
import {
  DEVGOV_GATE_AUDIENCE,
  GITHUB_OIDC_ISSUER,
  PINNED_VERIFIER_AUTHORITY,
} from '../devgov/github-oidc.mjs';

// ---------------------------------------------------------------------------
// Fixture: the same trusted RED/GREEN attestation pair, verifier-owned trust
// root and PASS/PROVEN gate evaluation as devgovGateVerdictProduction.test.ts,
// driven through the CLI completion seam `completeEvidenceGate` with an
// injected env — no network, no OIDC token, no git.
// ---------------------------------------------------------------------------

const issuer = 'github-actions:JbmbAb/Milj-beslut-V1.2:devgov-v0-attest';
const keyId = 'devgov-ci-ed25519-v1';
const attestRef = 'JbmbAb/Milj-beslut-V1.2/.github/workflows/devgov-v0-attest.yml@refs/heads/main';
const gateRef = PINNED_VERIFIER_AUTHORITY.workflow_ref;
const runner = 'github-hosted:ubuntu-latest';
const candidateSha = 'b'.repeat(40);
const controllerSha = 'd'.repeat(40);
const orchestrationRunId = '100';
const gateRunId = '200';
const dispatchBinding = 'SMOKE-UNIT:6:DEV_GOV';
const unitDefinitionPath = 'governance/devgov/units/smoke-unit.json';

const manifest = {
  schema_version: 'dev-gov-v1-unit-definition',
  unit: 'SMOKE-UNIT',
  role: 'producer',
  mode: 'writer',
  branch: 'codex/smoke-unit',
  base_sha: 'a'.repeat(40),
  ancestry_policy: 'exact_parent',
  allowed_paths: ['scripts/devgov/**'],
  forbidden_paths: ['server/**'],
  trusted_execution: { issuer, key_id: keyId },
  required_red: [{ id: 'red', command: 'node', args: ['red.mjs'], expected_classification: 'FAIL' }],
  required_green: [{ id: 'green', command: 'node', args: ['green.mjs'] }],
};

function ed25519Keys() {
  return generateKeyPairSync('ed25519', {
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
}

const attKeys = ed25519Keys();
const verdictKeys = ed25519Keys();

const policy = {
  schema_version: 'dev-gov-v0-trust-policy',
  authority: PINNED_VERIFIER_AUTHORITY,
  trusted_issuers: [
    {
      issuer,
      key_id: keyId,
      algorithm: 'ed25519',
      public_key_pem: attKeys.publicKey,
      workflow_ref: attestRef,
      runner_identity: runner,
    },
  ],
};
const policySha = sha256(JSON.stringify(policy));
const expectedAudience = `${DEVGOV_GATE_AUDIENCE}:${policySha}:${candidateSha}`;

function record(overrides: Record<string, unknown> = {}) {
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
    runner_identity: runner,
    controller_sha: controllerSha,
    workflow_ref: attestRef,
    workflow_run_id: orchestrationRunId,
    workflow_run_attempt: '1',
    stdout_sha256: 'e'.repeat(64),
    stderr_sha256: 'f'.repeat(64),
    ...overrides,
  };
  return { ...value, result_digest: executionResultDigest(value) };
}

const greenOverrides = {
  execution_sha: candidateSha,
  proof_type: 'GREEN',
  test_id: 'green',
  command: 'node green.mjs',
  exit_code: 0,
  classification: 'PASS',
  started_at: '2026-09-01T11:00:00.000Z',
  finished_at: '2026-09-01T11:00:01.000Z',
};

function signRecord(value) {
  return signExecutionRecord(value, attKeys.privateKey, { issuer, key_id: keyId });
}

const red = signRecord(record());
const green = signRecord(record(greenOverrides));
const attestations = [red, green];

const oidcClaims = {
  iss: GITHUB_OIDC_ISSUER,
  aud: expectedAudience,
  repository: PINNED_VERIFIER_AUTHORITY.repository,
  workflow_ref: gateRef,
  ref: PINNED_VERIFIER_AUTHORITY.ref,
  environment: PINNED_VERIFIER_AUTHORITY.environment,
  runner_environment: PINNED_VERIFIER_AUTHORITY.runner_environment,
  run_id: gateRunId,
  run_attempt: '1',
  jti: 'jti-gate-verdict-completion-1',
};

const trustRoot = {
  valid: true,
  errors: [],
  policy,
  trust_policy_sha256: policySha,
  oidc_claims: oidcClaims,
};

const trustRootProvenance = {
  issuer: oidcClaims.iss,
  audience: oidcClaims.aud,
  repository: oidcClaims.repository,
  workflow_ref: oidcClaims.workflow_ref,
  ref: oidcClaims.ref,
  environment: oidcClaims.environment,
  runner_environment: oidcClaims.runner_environment,
  run_id: oidcClaims.run_id,
  run_attempt: oidcClaims.run_attempt,
  jti: oidcClaims.jti,
};

/**
 * Shape the trusted-execution evaluation exactly as the `evidence-gate`
 * command does (resultEnvelope + the trust root fields it appends) before
 * handing it to completeEvidenceGate.
 */
function gateEnvelope(consumed = attestations) {
  const evaluation = evaluateTrustedExecutionGate(manifest, consumed, policy, {
    candidateSha,
    controllerSha,
    expectedWorkflowRunId: orchestrationRunId,
  });
  const passed = evaluation.result === 'PASS';
  return {
    result: evaluation.result,
    classification: evaluation.result,
    reason_code: passed ? 'PASS' : 'TRUSTED_EXECUTION_ATTESTATION_DENIED',
    message: passed ? 'PASS' : evaluation.errors.join('; '),
    errors: evaluation.errors,
    proof_status: evaluation.proof_status,
    trust_policy_sha256: policySha,
    proof_ids: consumed.map((item) => item.proof_id).filter(Boolean),
    trust_root_provenance: { ...trustRootProvenance },
  };
}

const verdictIssuer = 'github-actions:JbmbAb/Milj-beslut-V1.2:devgov-v0-gate';
const verdictKeyId = 'devgov-gate-verdict-ed25519-v1';

const fullEnv: Record<string, string> = {
  GITHUB_WORKFLOW_REF: gateRef,
  GITHUB_RUN_ID: gateRunId,
  GITHUB_RUN_ATTEMPT: '1',
  DEVGOV_CONTROLLER_DISPATCH_BINDING: dispatchBinding,
  DEVGOV_GATE_VERDICT_PRIVATE_KEY_PEM: verdictKeys.privateKey,
  DEVGOV_GATE_VERDICT_ISSUER: verdictIssuer,
  DEVGOV_GATE_VERDICT_KEY_ID: verdictKeyId,
};

const trustedSigners = [
  {
    purpose: GATE_VERDICT_SCHEMA,
    issuer: verdictIssuer,
    key_id: verdictKeyId,
    algorithm: 'ed25519',
    public_key_pem: verdictKeys.publicKey,
    gate_workflow_ref: gateRef,
  },
];

function envWithout(...keys: string[]) {
  const env = { ...fullEnv };
  for (const key of keys) delete env[key];
  return env;
}

function tempDir() {
  return mkdtempSync(join(tmpdir(), 'devgov-verdict-completion-'));
}

function completion(overrides: Record<string, unknown> = {}) {
  return completeEvidenceGate({
    gate: gateEnvelope(),
    trustRoot,
    unitDefinition: manifest,
    unitDefinitionPath,
    candidateSha,
    controllerSha,
    attestations,
    attestationRunId: orchestrationRunId,
    env: fullEnv,
    ...overrides,
  });
}

const fixedNow = () => new Date('2026-09-06T12:00:00.000Z');

function expectNotIssued(envelope, classification: string, reasonCode: string, exitCode: number) {
  expect(envelope.classification).toBe(classification);
  expect(envelope.result).toBe(classification);
  expect(envelope.reason_code).toBe(reasonCode);
  expect(envelope.verdict_status).toBe('NOT_ISSUED');
  expect(envelope.proof_status).toBe('NOT_PROVEN');
  expect(envelope.gate_evaluation_result).toBe('PASS');
  expect(envelope).not.toHaveProperty('verdict_id');
  expect(envelope).not.toHaveProperty('verdict_file');
  expect(Array.isArray(envelope.errors)).toBe(true);
  expect(envelope.errors.length).toBeGreaterThan(0);
  expect(EXIT_CODE[envelope.classification]).toBe(exitCode);
}

describe('completeEvidenceGate — fixture', () => {
  it('starts from a PASS/PROVEN gate envelope shaped like the evidence-gate command', () => {
    const gate = gateEnvelope();
    expect(gate.result).toBe('PASS');
    expect(gate.classification).toBe('PASS');
    expect(gate.reason_code).toBe('PASS');
    expect(gate.proof_status).toBe('PROVEN');
    expect(gate.errors).toEqual([]);
    expect(gate.trust_policy_sha256).toBe(policySha);
    expect(gate.proof_ids).toEqual([red.proof_id, green.proof_id]);
  });
});

describe('completeEvidenceGate — no verdict requested / gate not PASS', () => {
  it('case 1: returns the same gate object and writes nothing when verdictOutput is undefined', () => {
    const dir = tempDir();
    const gate = gateEnvelope();
    const envelope = completion({ gate, verdictOutput: undefined });
    expect(envelope).toBe(gate);
    expect(envelope).not.toHaveProperty('verdict_status');
    expect(readdirSync(dir)).toEqual([]);
  });

  it('case 2 (mandate 8, CLI level): a non-PASS gate returns unchanged and leaves no verdict bytes', () => {
    const dir = tempDir();
    const verdictOutput = join(dir, 'gate-verdict.json');
    const gate = {
      ...gateEnvelope(),
      result: 'DENIED_GOVERNANCE',
      classification: 'DENIED_GOVERNANCE',
      reason_code: 'TRUSTED_EXECUTION_ATTESTATION_DENIED',
      message: 'missing trusted GREEN attestation for green',
      errors: ['missing trusted GREEN attestation for green'],
      proof_status: 'NOT_PROVEN',
    };
    const envelope = completion({ gate, verdictOutput });
    expect(envelope).toBe(gate);
    expect(envelope).not.toHaveProperty('verdict_status');
    expect(envelope).not.toHaveProperty('verdict_id');
    expect(envelope).not.toHaveProperty('verdict_file');
    expect(existsSync(verdictOutput)).toBe(false);
    expect(readdirSync(dir)).toEqual([]);
    expect(EXIT_CODE[envelope.classification]).toBe(4);
  });

  it('case 2 (mandate 8, CLI level): a real denied evaluation (missing GREEN) returns unchanged, no file', () => {
    const dir = tempDir();
    const verdictOutput = join(dir, 'gate-verdict.json');
    const gate = gateEnvelope([red]);
    expect(gate.result).toBe('DENIED_GOVERNANCE');
    expect(gate.proof_status).toBe('NOT_PROVEN');
    const envelope = completion({ gate, attestations: [red], verdictOutput });
    expect(envelope).toBe(gate);
    expect(envelope).not.toHaveProperty('verdict_status');
    expect(existsSync(verdictOutput)).toBe(false);
  });
});

describe('completeEvidenceGate — issued verdict (mandate 17, CLI level)', () => {
  it('case 3: PASS + full env issues a signed, verifiable verdict written as canonical bytes', () => {
    const dir = tempDir();
    const verdictOutput = join(dir, 'out', 'gate-verdict.json');
    const envelope = completion({ verdictOutput });

    expect(envelope.verdict_status).toBe('ISSUED');
    expect(envelope.verdict_file).toBe(verdictOutput);
    expect(envelope.verdict_id).toMatch(/^[0-9a-f]{64}$/);
    expect(envelope.classification).toBe('PASS');
    expect(envelope.result).toBe('PASS');
    expect(envelope.reason_code).toBe('PASS');
    expect(EXIT_CODE[envelope.classification]).toBe(0);

    expect(existsSync(verdictOutput)).toBe(true);
    const bytes = readFileSync(verdictOutput, 'utf8');
    const parsedVerdict = JSON.parse(bytes);
    expect(bytes).toBe(`${stableJson(parsedVerdict)}\n`);

    expect(parsedVerdict.schema_version).toBe(GATE_VERDICT_SCHEMA);
    expect(parsedVerdict.verdict_id).toBe(envelope.verdict_id);
    expect(verifyGateVerdict(parsedVerdict, trustedSigners)).toEqual({ valid: true, errors: [] });
    expect(parsedVerdict.controller_dispatch_binding).toBe(fullEnv.DEVGOV_CONTROLLER_DISPATCH_BINDING);
    expect(parsedVerdict.orchestration_run_id).toBe(orchestrationRunId);
    expect(parsedVerdict.gate_workflow_ref).toBe(fullEnv.GITHUB_WORKFLOW_REF);
    expect(parsedVerdict.gate_run_id).toBe(fullEnv.GITHUB_RUN_ID);
    expect(parsedVerdict.gate_run_attempt).toBe(fullEnv.GITHUB_RUN_ATTEMPT);
    expect(parsedVerdict.issuer).toBe(fullEnv.DEVGOV_GATE_VERDICT_ISSUER);
    expect(parsedVerdict.key_id).toBe(fullEnv.DEVGOV_GATE_VERDICT_KEY_ID);
    expect(parsedVerdict.unit_id).toBe(manifest.unit);
    expect(parsedVerdict.unit_definition_path).toBe(unitDefinitionPath);
    expect(parsedVerdict.candidate_sha).toBe(candidateSha);
    expect(parsedVerdict.controller_sha).toBe(controllerSha);
    expect(parsedVerdict.attestation_proof_ids).toEqual([red.proof_id, green.proof_id].sort());
    expect(parsedVerdict.trust_policy_sha256).toBe(policySha);
  });

  it('case 9: the ISSUED envelope keeps the gate proof_status PROVEN and trust_root_provenance unchanged', () => {
    const dir = tempDir();
    const gate = gateEnvelope();
    const provenanceBefore = JSON.parse(JSON.stringify(gate.trust_root_provenance));
    const envelope = completion({ gate, verdictOutput: join(dir, 'gate-verdict.json') });

    expect(envelope.verdict_status).toBe('ISSUED');
    expect(envelope.proof_status).toBe('PROVEN');
    expect(envelope.trust_root_provenance).toEqual(provenanceBefore);
    expect(envelope.trust_root_provenance).toEqual(trustRootProvenance);
    expect(envelope.trust_policy_sha256).toBe(policySha);
    expect(envelope.proof_ids).toEqual(gate.proof_ids);
    expect(envelope.errors).toEqual([]);
    expect(envelope.message).toBe('PASS');
    // The input gate object itself is not mutated by completion.
    expect(gate).not.toHaveProperty('verdict_status');
    expect(gate.trust_root_provenance).toEqual(provenanceBefore);
  });
});

describe('completeEvidenceGate — controller dispatch binding (mandates 1, 2, CLI level)', () => {
  it('case 4 (mandate 1): env without DEVGOV_CONTROLLER_DISPATCH_BINDING denies and writes nothing', () => {
    const dir = tempDir();
    const verdictOutput = join(dir, 'gate-verdict.json');
    const envelope = completion({ verdictOutput, env: envWithout('DEVGOV_CONTROLLER_DISPATCH_BINDING') });
    expectNotIssued(envelope, 'DENIED_GOVERNANCE', GATE_VERDICT_REASON.BINDING_DENIED, 4);
    expect(envelope.reason_code).toBe('GATE_VERDICT_BINDING_DENIED');
    expect(envelope.errors).toContain('controller_dispatch_binding is required');
    expect(envelope.trust_policy_sha256).toBe(policySha);
    expect(envelope.trust_root_provenance).toEqual(trustRootProvenance);
    expect(existsSync(verdictOutput)).toBe(false);
    expect(readdirSync(dir)).toEqual([]);
  });

  it('case 4 (mandate 2): a malformed binding with spaces denies and writes nothing', () => {
    const dir = tempDir();
    const verdictOutput = join(dir, 'gate-verdict.json');
    const envelope = completion({
      verdictOutput,
      env: { ...fullEnv, DEVGOV_CONTROLLER_DISPATCH_BINDING: 'has spaces' },
    });
    expectNotIssued(envelope, 'DENIED_GOVERNANCE', GATE_VERDICT_REASON.BINDING_DENIED, 4);
    expect(envelope.errors).toContain('controller_dispatch_binding is malformed');
    expect(existsSync(verdictOutput)).toBe(false);
    expect(readdirSync(dir)).toEqual([]);
  });
});

describe('completeEvidenceGate — dedicated signer unavailable (CLI level)', () => {
  it.each([
    'DEVGOV_GATE_VERDICT_PRIVATE_KEY_PEM',
    'DEVGOV_GATE_VERDICT_ISSUER',
    'DEVGOV_GATE_VERDICT_KEY_ID',
  ])('case 5: env without %s blocks with SIGNER_UNAVAILABLE and writes nothing', (missing) => {
    const dir = tempDir();
    const verdictOutput = join(dir, 'gate-verdict.json');
    const envelope = completion({ verdictOutput, env: envWithout(missing) });
    expectNotIssued(envelope, 'BLOCKED_ENVIRONMENT', GATE_VERDICT_REASON.SIGNER_UNAVAILABLE, 3);
    expect(envelope.reason_code).toBe('GATE_VERDICT_SIGNER_UNAVAILABLE');
    expect(envelope.errors).toContain(
      'dedicated gate verdict signer (private key, issuer, key_id) is required',
    );
    expect(existsSync(verdictOutput)).toBe(false);
    expect(readdirSync(dir)).toEqual([]);
  });
});

describe('completeEvidenceGate — gate identity and run binding (mandates 3, 5, 6, CLI level)', () => {
  it('case 6 (mandate 5): GITHUB_WORKFLOW_REF equal to the attest ref denies and writes nothing', () => {
    const dir = tempDir();
    const verdictOutput = join(dir, 'gate-verdict.json');
    const envelope = completion({ verdictOutput, env: { ...fullEnv, GITHUB_WORKFLOW_REF: attestRef } });
    expectNotIssued(envelope, 'DENIED_GOVERNANCE', GATE_VERDICT_REASON.BINDING_DENIED, 4);
    expect(envelope.errors).toContain('gate workflow_ref is not the pinned verifier authority');
    expect(envelope.errors).toContain('gate workflow_ref does not match OIDC workflow_ref');
    expect(existsSync(verdictOutput)).toBe(false);
  });

  it('case 6 (mandate 6): GITHUB_RUN_ID that differs from the OIDC run_id denies and writes nothing', () => {
    const dir = tempDir();
    const verdictOutput = join(dir, 'gate-verdict.json');
    const envelope = completion({ verdictOutput, env: { ...fullEnv, GITHUB_RUN_ID: '201' } });
    expectNotIssued(envelope, 'DENIED_GOVERNANCE', GATE_VERDICT_REASON.BINDING_DENIED, 4);
    expect(envelope.errors).toContain('gate run id does not match OIDC run_id');
    expect(existsSync(verdictOutput)).toBe(false);
  });

  it('case 6 (mandate 3): attestationRunId that the attestations were not produced by denies', () => {
    const dir = tempDir();
    const verdictOutput = join(dir, 'gate-verdict.json');
    const envelope = completion({ verdictOutput, attestationRunId: '101' });
    expectNotIssued(envelope, 'DENIED_GOVERNANCE', GATE_VERDICT_REASON.BINDING_DENIED, 4);
    expect(envelope.errors).toContain('attestation 0 workflow_run_id does not match the orchestration run');
    expect(envelope.errors).toContain('attestation 1 workflow_run_id does not match the orchestration run');
    expect(existsSync(verdictOutput)).toBe(false);
  });
});

describe('completeEvidenceGate — create-once and determinism (mandate 15, CAS preservation)', () => {
  it('case 7 (mandate 15): a second completion to the same path throws EEXIST and preserves the bytes', () => {
    const dir = tempDir();
    const verdictOutput = join(dir, 'gate-verdict.json');

    const first = completion({ verdictOutput, now: fixedNow });
    expect(first.verdict_status).toBe('ISSUED');
    const firstBytes = readFileSync(verdictOutput);

    let thrown: unknown;
    try {
      completion({ verdictOutput, now: fixedNow });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeDefined();
    expect((thrown as NodeJS.ErrnoException).code).toBe('EEXIST');
    expect(readFileSync(verdictOutput).equals(firstBytes)).toBe(true);
    expect(readdirSync(dir)).toEqual(['gate-verdict.json']);
  });

  it('case 8: identical inputs with a fixed clock produce byte-identical verdicts and equal verdict_id', () => {
    const dir = tempDir();
    const outputA = join(dir, 'a', 'gate-verdict.json');
    const outputB = join(dir, 'b', 'gate-verdict.json');

    const first = completion({ verdictOutput: outputA, now: fixedNow });
    const second = completion({ verdictOutput: outputB, now: fixedNow });

    expect(first.verdict_status).toBe('ISSUED');
    expect(second.verdict_status).toBe('ISSUED');
    expect(first.verdict_id).toBe(second.verdict_id);

    const bytesA = readFileSync(outputA);
    const bytesB = readFileSync(outputB);
    expect(bytesA.equals(bytesB)).toBe(true);

    const parsed = JSON.parse(bytesA.toString('utf8'));
    expect(parsed.verdict_id).toBe(first.verdict_id);
    expect(parsed.issued_at).toBe('2026-09-06T12:00:00.000Z');
    expect(verifyGateVerdict(parsed, trustedSigners)).toEqual({ valid: true, errors: [] });
  });

  it('case 8: verdict_id is independent of issued_at (identity survives re-issuance at another time)', () => {
    const dir = tempDir();
    const outputA = join(dir, 'a', 'gate-verdict.json');
    const outputB = join(dir, 'b', 'gate-verdict.json');

    const first = completion({ verdictOutput: outputA, now: fixedNow });
    const second = completion({
      verdictOutput: outputB,
      now: () => new Date('2026-09-07T00:00:00.000Z'),
    });

    expect(first.verdict_id).toBe(second.verdict_id);
    const parsedA = JSON.parse(readFileSync(outputA, 'utf8'));
    const parsedB = JSON.parse(readFileSync(outputB, 'utf8'));
    expect(parsedA.issued_at).not.toBe(parsedB.issued_at);
    expect(parsedA.verdict_id).toBe(parsedB.verdict_id);
  });
});
