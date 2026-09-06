import { execFileSync, spawnSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  evaluateTrustedExecutionGate,
  GATE_VERDICT_REASON,
  GATE_VERDICT_SCHEMA,
  produceGateVerdict,
  proofContractHash,
  signExecutionRecord,
  unitDefinitionHash,
  verifyGateVerdict,
  writeJsonExclusive,
} from '../devgov/devgov.mjs';
import {
  executionResultDigest,
  sha256,
  stableJson,
  verifyExecutionAttestation,
} from '../devgov/trusted-attestation.mjs';
import {
  DEVGOV_GATE_AUDIENCE,
  GITHUB_OIDC_ISSUER,
  PINNED_VERIFIER_AUTHORITY,
} from '../devgov/github-oidc.mjs';

// ---------------------------------------------------------------------------
// Fixture: a fully trusted RED/GREEN attestation pair, the verifier-owned
// trust root proven by the gate's OIDC identity, and a PASS/PROVEN gate
// evaluation. Every negative below is a single, named deviation from it.
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
const dispatchBinding = 'GATE-VERDICT-UNIT:6:DEV_GOV';

const manifest = {
  schema_version: 'dev-gov-v1-unit-definition',
  unit: 'GATE-VERDICT-UNIT',
  role: 'producer',
  mode: 'writer',
  branch: 'codex/gate-verdict',
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
const otherKeys = ed25519Keys();

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
const rawPolicy = JSON.stringify(policy);
const policySha = sha256(rawPolicy);
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

function signRecord(value, privateKey = attKeys.privateKey) {
  return signExecutionRecord(value, privateKey, { issuer, key_id: keyId });
}

const red = signRecord(record());
const green = signRecord(record(greenOverrides));

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
  jti: 'jti-gate-verdict-1',
};

const trustRoot = {
  valid: true,
  errors: [],
  policy,
  trust_policy_sha256: policySha,
  oidc_claims: oidcClaims,
};

function passingGate(attestations = [red, green]) {
  const evaluation = evaluateTrustedExecutionGate(manifest, attestations, policy, {
    candidateSha,
    controllerSha,
    expectedWorkflowRunId: orchestrationRunId,
  });
  return {
    result: evaluation.result,
    classification: evaluation.result,
    reason_code: 'PASS',
    message: 'PASS',
    errors: evaluation.errors,
    proof_status: evaluation.proof_status,
  };
}

const gate = passingGate();

const signer = {
  privateKeyPem: verdictKeys.privateKey,
  issuer: 'github-actions:JbmbAb/Milj-beslut-V1.2:devgov-v0-gate',
  keyId: 'devgov-gate-verdict-ed25519-v1',
};

const runtime = {
  gateWorkflowRef: gateRef,
  gateRunId,
  gateRunAttempt: '1',
  attestationRunId: orchestrationRunId,
  controllerDispatchBinding: dispatchBinding,
};

const base = {
  unitDefinition: manifest,
  unitDefinitionPath: 'governance/devgov/units/gate-verdict.json',
  candidateSha,
  controllerSha,
  attestations: [red, green],
  trustRoot,
  gate,
  runtime,
  signer,
  now: () => new Date('2026-09-06T12:00:00.000Z'),
};

const trustedSigners = [
  {
    purpose: GATE_VERDICT_SCHEMA,
    issuer: signer.issuer,
    key_id: signer.keyId,
    algorithm: 'ed25519',
    public_key_pem: verdictKeys.publicKey,
    gate_workflow_ref: gateRef,
  },
];

function withRuntime(patch: Record<string, unknown>) {
  return { ...base, runtime: { ...runtime, ...patch } };
}

function withClaims(patch: Record<string, unknown>) {
  return { ...base, trustRoot: { ...trustRoot, oidc_claims: { ...oidcClaims, ...patch } } };
}

function withGate(patch: Record<string, unknown>) {
  return { ...base, gate: { ...gate, ...patch } };
}

function withSigner(patch: Record<string, unknown>) {
  return { ...base, signer: { ...signer, ...patch } };
}

function expectDenied(input, reasonCode: string) {
  const outcome = produceGateVerdict(input);
  expect(outcome.ok).toBe(false);
  expect(outcome.reason_code).toBe(reasonCode);
  expect(outcome).not.toHaveProperty('verdict');
  expect(Array.isArray(outcome.errors)).toBe(true);
  expect(outcome.errors.length).toBeGreaterThan(0);
  return outcome;
}

describe('DEV-GOV-V1 gate verdict production fixture', () => {
  it('starts from a PASS/PROVEN gate evaluation so every negative is a single deviation', () => {
    expect(gate.result).toBe('PASS');
    expect(gate.proof_status).toBe('PROVEN');
    expect(gate.errors).toEqual([]);
  });
});

describe('produceGateVerdict — controller dispatch binding (mandates 1, 2)', () => {
  it('mandate 1: denies when runtime.controllerDispatchBinding is undefined', () => {
    const outcome = expectDenied(
      withRuntime({ controllerDispatchBinding: undefined }),
      GATE_VERDICT_REASON.BINDING_DENIED,
    );
    expect(outcome.errors).toContain('controller_dispatch_binding is required');
  });

  it('mandate 1: denies when runtime.controllerDispatchBinding is the empty string', () => {
    const outcome = expectDenied(
      withRuntime({ controllerDispatchBinding: '' }),
      GATE_VERDICT_REASON.BINDING_DENIED,
    );
    expect(outcome.errors).toContain('controller_dispatch_binding is required');
  });

  it.each([
    ['contains spaces', 'bad binding with spaces'],
    ['is 201 characters long', 'a'.repeat(201)],
    ['contains unicode', 'UNIT:6:DEV_GÖV'],
    ['contains a slash', 'UNIT/6/DEV_GOV'],
  ])('mandate 2: denies a malformed binding that %s', (_label, binding) => {
    const outcome = expectDenied(
      withRuntime({ controllerDispatchBinding: binding }),
      GATE_VERDICT_REASON.BINDING_DENIED,
    );
    expect(outcome.errors).toContain('controller_dispatch_binding is malformed');
  });

  it('mandate 2: accepts a binding of exactly 200 allowed characters', () => {
    const outcome = produceGateVerdict(
      withRuntime({ controllerDispatchBinding: 'A1._:-'.repeat(33) + 'ab' }),
    );
    expect(outcome.ok).toBe(true);
    expect(outcome.verdict.controller_dispatch_binding).toHaveLength(200);
  });
});

describe('produceGateVerdict — orchestration run binding (mandates 3, 4)', () => {
  it('mandate 3: denies when attestationRunId differs from the attestations workflow_run_id', () => {
    const outcome = expectDenied(
      withRuntime({ attestationRunId: '101' }),
      GATE_VERDICT_REASON.BINDING_DENIED,
    );
    expect(outcome.errors).toContain('attestation 0 workflow_run_id does not match the orchestration run');
    expect(outcome.errors).toContain('attestation 1 workflow_run_id does not match the orchestration run');
  });

  it('mandate 3: denies a non-numeric attestationRunId', () => {
    const outcome = expectDenied(
      withRuntime({ attestationRunId: '100a' }),
      GATE_VERDICT_REASON.BINDING_DENIED,
    );
    expect(outcome.errors).toContain('orchestration run id (attestation_run_id) must be numeric');
  });

  it('mandate 3: denies a missing attestationRunId', () => {
    const outcome = expectDenied(
      withRuntime({ attestationRunId: undefined }),
      GATE_VERDICT_REASON.BINDING_DENIED,
    );
    expect(outcome.errors).toContain('orchestration run id (attestation_run_id) must be numeric');
  });

  it('mandate 4: denies when one re-signed attestation was produced by a different run, naming it', () => {
    const foreignGreen = signRecord(record({ ...greenOverrides, workflow_run_id: '999' }));
    const outcome = expectDenied(
      { ...base, attestations: [red, foreignGreen] },
      GATE_VERDICT_REASON.BINDING_DENIED,
    );
    expect(outcome.errors).toContain('attestation 1 workflow_run_id does not match the orchestration run');
    expect(outcome.errors).not.toContain(
      'attestation 0 workflow_run_id does not match the orchestration run',
    );
  });
});

describe('produceGateVerdict — gate identity (mandates 5, 6)', () => {
  it('mandate 5: denies when gateWorkflowRef is the attestation workflow ref', () => {
    const outcome = expectDenied(
      withRuntime({ gateWorkflowRef: attestRef }),
      GATE_VERDICT_REASON.BINDING_DENIED,
    );
    expect(outcome.errors).toContain('gate workflow_ref is not the pinned verifier authority');
    expect(outcome.errors).toContain('gate workflow_ref does not match OIDC workflow_ref');
  });

  it('mandate 5: denies any gateWorkflowRef other than the pinned verifier authority', () => {
    const outcome = expectDenied(
      withRuntime({ gateWorkflowRef: `${gateRef}-not-pinned` }),
      GATE_VERDICT_REASON.BINDING_DENIED,
    );
    expect(outcome.errors).toContain('gate workflow_ref is not the pinned verifier authority');
  });

  it('mandate 5: denies when oidc_claims.workflow_ref differs from the gate workflow ref', () => {
    const outcome = expectDenied(withClaims({ workflow_ref: attestRef }), GATE_VERDICT_REASON.BINDING_DENIED);
    expect(outcome.errors).toContain('gate workflow_ref does not match OIDC workflow_ref');
  });

  it('mandate 6: denies when gateRunId differs from oidc_claims.run_id', () => {
    const outcome = expectDenied(withRuntime({ gateRunId: '201' }), GATE_VERDICT_REASON.BINDING_DENIED);
    expect(outcome.errors).toContain('gate run id does not match OIDC run_id');
  });

  it('mandate 6: denies when gateRunAttempt differs from oidc_claims.run_attempt', () => {
    const outcome = expectDenied(withRuntime({ gateRunAttempt: '2' }), GATE_VERDICT_REASON.BINDING_DENIED);
    expect(outcome.errors).toContain('gate run attempt does not match OIDC run_attempt');
  });

  it('mandate 6: denies when the gate run id equals the orchestration run id', () => {
    const input = {
      ...withRuntime({ gateRunId: orchestrationRunId }),
      trustRoot: { ...trustRoot, oidc_claims: { ...oidcClaims, run_id: orchestrationRunId } },
    };
    const outcome = expectDenied(input, GATE_VERDICT_REASON.BINDING_DENIED);
    expect(outcome.errors).toContain('gate run id must differ from the orchestration run id');
  });
});

describe('produceGateVerdict — trust verification (mandate 7)', () => {
  it('mandate 7: denies when the policy public key is replaced by a different key', () => {
    const substituted = {
      ...policy,
      trusted_issuers: [{ ...policy.trusted_issuers[0], public_key_pem: otherKeys.publicKey }],
    };
    const outcome = expectDenied(
      { ...base, trustRoot: { ...trustRoot, policy: substituted } },
      GATE_VERDICT_REASON.BINDING_DENIED,
    );
    expect(outcome.errors.some((error) => error.startsWith('attestation 0 failed trust verification'))).toBe(
      true,
    );
    expect(outcome.errors.some((error) => error.startsWith('attestation 1 failed trust verification'))).toBe(
      true,
    );
  });

  it('mandate 7: denies when an attestation signature is tampered', () => {
    const tamperedSignature = Buffer.from(red.signature, 'base64');
    tamperedSignature[0] ^= 0xff;
    const tampered = { ...red, signature: tamperedSignature.toString('base64') };
    const outcome = expectDenied(
      { ...base, attestations: [tampered, green] },
      GATE_VERDICT_REASON.BINDING_DENIED,
    );
    expect(outcome.errors.some((error) => error.startsWith('attestation 0 failed trust verification'))).toBe(
      true,
    );
    expect(outcome.errors.some((error) => error.startsWith('attestation 1 failed trust verification'))).toBe(
      false,
    );
  });

  it('mandate 7: denies when the attestation issuer is not in the trust policy', () => {
    const foreignPolicy = {
      ...policy,
      trusted_issuers: [{ ...policy.trusted_issuers[0], issuer: 'github-actions:someone/else:attest' }],
    };
    const outcome = expectDenied(
      { ...base, trustRoot: { ...trustRoot, policy: foreignPolicy } },
      GATE_VERDICT_REASON.BINDING_DENIED,
    );
    expect(outcome.errors.some((error) => error.includes('attestation issuer/key is not trusted'))).toBe(
      true,
    );
  });

  it('mandate 7: denies when the trust root itself is not valid', () => {
    const outcome = expectDenied(
      { ...base, trustRoot: { ...trustRoot, valid: false } },
      GATE_VERDICT_REASON.BINDING_DENIED,
    );
    expect(outcome.errors).toContain('verified trust root is required');
  });
});

describe('produceGateVerdict — gate result (mandates 8, 9)', () => {
  it.each(['DENIED_GOVERNANCE', 'FAIL', 'BLOCKED_ENVIRONMENT'])(
    'mandate 8: denies when gate.result is %s',
    (result) => {
      const outcome = expectDenied(
        withGate({ result, classification: result }),
        GATE_VERDICT_REASON.RESULT_NOT_PASS,
      );
      expect(outcome.errors).toContain(`gate result is ${result}, not PASS`);
    },
  );

  it('mandate 8: denies when gate.classification does not match a PASS result', () => {
    const outcome = expectDenied(
      withGate({ classification: 'DENIED_GOVERNANCE' }),
      GATE_VERDICT_REASON.RESULT_NOT_PASS,
    );
    expect(outcome.errors).toContain('gate classification is DENIED_GOVERNANCE, not PASS');
  });

  it('mandate 8: denies when gate.reason_code is not PASS', () => {
    const outcome = expectDenied(
      withGate({ reason_code: 'SHA_VERIFICATION_DENIED' }),
      GATE_VERDICT_REASON.RESULT_NOT_PASS,
    );
    expect(outcome.errors).toContain('gate reason_code is SHA_VERIFICATION_DENIED, not PASS');
  });

  it('mandate 8: denies when gate.errors is non-empty even though result says PASS', () => {
    const outcome = expectDenied(withGate({ errors: ['late error'] }), GATE_VERDICT_REASON.RESULT_NOT_PASS);
    expect(outcome.errors).toContain('gate evaluation reported errors');
  });

  it('mandate 9: denies when gate.proof_status is NOT_PROVEN', () => {
    const outcome = expectDenied(
      withGate({ proof_status: 'NOT_PROVEN' }),
      GATE_VERDICT_REASON.RESULT_NOT_PASS,
    );
    expect(outcome.errors).toContain('gate proof_status is NOT_PROVEN, not PROVEN');
  });
});

describe('produceGateVerdict — dedicated signer availability', () => {
  it.each([
    ['privateKeyPem', { privateKeyPem: '' }],
    ['issuer', { issuer: '' }],
    ['keyId', { keyId: '' }],
  ])('denies with SIGNER_UNAVAILABLE when signer.%s is empty', (_field, patch) => {
    const outcome = expectDenied(withSigner(patch), GATE_VERDICT_REASON.SIGNER_UNAVAILABLE);
    expect(outcome.errors).toContain(
      'dedicated gate verdict signer (private key, issuer, key_id) is required',
    );
  });

  it('denies with SIGNER_UNAVAILABLE when the signer key is not Ed25519', () => {
    const rsa = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    });
    const outcome = expectDenied(
      withSigner({ privateKeyPem: rsa.privateKey }),
      GATE_VERDICT_REASON.SIGNER_UNAVAILABLE,
    );
    expect(outcome.errors).toContain('gate verdict key must be Ed25519');
  });
});

describe('produceGateVerdict — OIDC audience binding', () => {
  it('denies when the audience binds a different candidate SHA', () => {
    const outcome = expectDenied(
      withClaims({ aud: `${DEVGOV_GATE_AUDIENCE}:${policySha}:${'c'.repeat(40)}` }),
      GATE_VERDICT_REASON.BINDING_DENIED,
    );
    expect(outcome.errors).toContain(
      'OIDC audience does not bind the verified trust policy digest and candidate SHA',
    );
  });

  it('denies when the audience binds a different trust policy digest', () => {
    const outcome = expectDenied(
      withClaims({ aud: `${DEVGOV_GATE_AUDIENCE}:${sha256('other-policy')}:${candidateSha}` }),
      GATE_VERDICT_REASON.BINDING_DENIED,
    );
    expect(outcome.errors).toContain(
      'OIDC audience does not bind the verified trust policy digest and candidate SHA',
    );
  });

  it('accepts an audience array that contains the expected audience', () => {
    const outcome = produceGateVerdict(withClaims({ aud: ['unrelated-audience', expectedAudience] }));
    expect(outcome.ok).toBe(true);
    expect(outcome.verdict.oidc_provenance.audience).toBe(expectedAudience);
  });
});

describe('produceGateVerdict — attestation workflow identity', () => {
  it('denies an attestation that claims the gate workflow identity', () => {
    const gateIdentityRed = signRecord(record({ workflow_ref: gateRef }));
    const outcome = expectDenied(
      { ...base, attestations: [gateIdentityRed, green] },
      GATE_VERDICT_REASON.BINDING_DENIED,
    );
    expect(outcome.errors).toContain('attestation 0 claims the gate workflow identity');
    // The policy pins the attest ref, so trust verification independently rejects it as well.
    expect(outcome.errors.some((error) => error.startsWith('attestation 0 failed trust verification'))).toBe(
      true,
    );
  });
});

describe('produceGateVerdict — per-attestation identity binding (mandate 18 negatives)', () => {
  // Every case below hands the producer the UNCHANGED PASS/PROVEN gate
  // envelope from the fixture. A denial therefore proves the producer
  // re-derives the binding itself and does not trust the envelope.
  function withAttestations(attestations: unknown[]) {
    expect(base.gate.result).toBe('PASS');
    expect(base.gate.proof_status).toBe('PROVEN');
    expect(base.gate.errors).toEqual([]);
    return { ...base, attestations };
  }

  it.each([
    ['unit_id', 'OTHER-UNIT'],
    ['unit_definition_hash', 'f'.repeat(64)],
    ['proof_contract_hash', 'f'.repeat(64)],
    ['base_sha', '1'.repeat(40)],
    ['candidate_sha', 'c'.repeat(40)],
    ['controller_sha', '2'.repeat(40)],
  ])('denies a re-signed GREEN whose %s differs, naming attestation 1', (field, altered) => {
    const alteredGreen = signRecord(record({ ...greenOverrides, [field]: altered }));
    expect(alteredGreen[field]).toBe(altered);
    const outcome = expectDenied(withAttestations([red, alteredGreen]), GATE_VERDICT_REASON.BINDING_DENIED);
    expect(outcome.errors).toContain(`attestation 1 ${field} mismatch`);
    expect(outcome.errors).not.toContain(`attestation 0 ${field} mismatch`);
  });

  it('denies when no attestation was consumed', () => {
    const outcome = expectDenied(withAttestations([]), GATE_VERDICT_REASON.BINDING_DENIED);
    expect(outcome.errors).toContain('at least one consumed execution attestation is required');
  });

  it('denies when the same attestation is consumed twice (duplicate proof ids)', () => {
    const outcome = expectDenied(withAttestations([red, red]), GATE_VERDICT_REASON.BINDING_DENIED);
    expect(outcome.errors).toContain('consumed attestations must carry unique proof ids');
  });

  it('denies when the consumed attestations come from two different trusted attest workflows', () => {
    const issuerB = 'github-actions:JbmbAb/Milj-beslut-V1.2:devgov-v0-attest-b';
    const keyIdB = 'devgov-ci-ed25519-b1';
    const attestRefB = 'JbmbAb/Milj-beslut-V1.2/.github/workflows/devgov-v0-attest-b.yml@refs/heads/main';
    const keysB = ed25519Keys();
    const policyWithB = {
      ...policy,
      trusted_issuers: [
        ...policy.trusted_issuers,
        {
          issuer: issuerB,
          key_id: keyIdB,
          algorithm: 'ed25519',
          public_key_pem: keysB.publicKey,
          workflow_ref: attestRefB,
          runner_identity: runner,
        },
      ],
    };
    const greenB = signExecutionRecord(
      record({ ...greenOverrides, workflow_ref: attestRefB }),
      keysB.privateKey,
      { issuer: issuerB, key_id: keyIdB },
    );
    // Each attestation is individually trusted under the widened policy ...
    expect(verifyExecutionAttestation(red, policyWithB).valid).toBe(true);
    expect(verifyExecutionAttestation(greenB, policyWithB).valid).toBe(true);
    // ... yet the verdict must still be denied: one verdict, one attest workflow.
    const outcome = expectDenied(
      { ...withAttestations([red, greenB]), trustRoot: { ...trustRoot, policy: policyWithB } },
      GATE_VERDICT_REASON.BINDING_DENIED,
    );
    expect(outcome.errors).toContain('consumed attestations must share one trusted attestation workflow_ref');
    expect(outcome.errors.some((error) => error.startsWith('attestation 1 failed trust verification'))).toBe(
      false,
    );
  });

  it('denies when the OIDC jti claim is empty', () => {
    const outcome = expectDenied(withClaims({ jti: '' }), GATE_VERDICT_REASON.BINDING_DENIED);
    expect(outcome.errors).toContain('OIDC jti claim is required');
  });
});

describe('evaluateTrustedExecutionGate — per-attestation run binding (mandate 4)', () => {
  const greenFromRun999 = signRecord(record({ ...greenOverrides, workflow_run_id: '999' }));

  it('mandate 4: denies a GREEN from another run when the orchestration run is expected, naming green', () => {
    const evaluation = evaluateTrustedExecutionGate(manifest, [red, greenFromRun999], policy, {
      candidateSha,
      controllerSha,
      expectedWorkflowRunId: orchestrationRunId,
    });
    expect(evaluation.result).toBe('DENIED_GOVERNANCE');
    expect(evaluation.proof_status).toBe('NOT_PROVEN');
    expect(evaluation.errors).toContain('missing trusted GREEN attestation for green');
    expect(evaluation.errors).not.toContain('missing trusted RED attestation for red');
  });

  it('legacy tolerance (explicit): WITHOUT expectedWorkflowRunId a cross-run RED/GREEN pair still passes', () => {
    const evaluation = evaluateTrustedExecutionGate(manifest, [red, greenFromRun999], policy, {
      candidateSha,
      controllerSha,
    });
    expect(evaluation.result).toBe('PASS');
    expect(evaluation.proof_status).toBe('PROVEN');
    expect(evaluation.errors).toEqual([]);
  });
});

describe('verifyExecutionAttestation — reverse-key domain separation', () => {
  it('rejects a record signed with the VERDICT private key under the attestation issuer/key_id', () => {
    const crossSigned = signRecord(record(greenOverrides), verdictKeys.privateKey);
    expect(crossSigned.issuer).toBe(issuer);
    expect(crossSigned.key_id).toBe(keyId);
    const verification = verifyExecutionAttestation(crossSigned, policy);
    expect(verification.valid).toBe(false);
    expect(verification.errors).toContain('attestation signature verification failed');
  });
});

describe('produceGateVerdict — happy path (mandates 17, 18)', () => {
  it('mandate 17: issues a verdict that verifies against the dedicated verdict public key', () => {
    const outcome = produceGateVerdict(base);
    expect(outcome.ok).toBe(true);
    expect(outcome.reason_code).toBeUndefined();
    const verification = verifyGateVerdict(outcome.verdict, trustedSigners);
    expect(verification).toEqual({ valid: true, errors: [] });
  });

  it('mandate 17: the issued verdict does not verify against a signer entry with another key', () => {
    const outcome = produceGateVerdict(base);
    expect(outcome.ok).toBe(true);
    const verification = verifyGateVerdict(outcome.verdict, [
      { ...trustedSigners[0], public_key_pem: otherKeys.publicKey },
    ]);
    expect(verification.valid).toBe(false);
    expect(verification.errors).toContain('gate verdict signature verification failed');
  });

  it('mandate 18: binds every verdict field to the consumed attestations, gate identity and OIDC claims', () => {
    const attemptTwoGreen = signRecord(record({ ...greenOverrides, workflow_run_attempt: '2' }));
    const attestations = [red, attemptTwoGreen];
    const outcome = produceGateVerdict({ ...base, attestations, gate: passingGate(attestations) });
    expect(outcome.ok).toBe(true);
    const verdict = outcome.verdict;

    expect(verdict.schema_version).toBe(GATE_VERDICT_SCHEMA);
    expect(verdict.result).toBe('PASS');
    expect(verdict.proof_status).toBe('PROVEN');

    expect(verdict.unit_id).toBe(red.unit_id);
    expect(verdict.unit_id).toBe(attemptTwoGreen.unit_id);
    expect(verdict.candidate_sha).toBe(red.candidate_sha);
    expect(verdict.candidate_sha).toBe(attemptTwoGreen.candidate_sha);
    expect(verdict.unit_definition_hash).toBe(red.unit_definition_hash);
    expect(verdict.unit_definition_hash).toBe(attemptTwoGreen.unit_definition_hash);
    expect(verdict.proof_contract_hash).toBe(red.proof_contract_hash);
    expect(verdict.proof_contract_hash).toBe(attemptTwoGreen.proof_contract_hash);
    expect(verdict.orchestration_run_id).toBe(red.workflow_run_id);
    expect(verdict.orchestration_run_id).toBe(attemptTwoGreen.workflow_run_id);
    expect(verdict.controller_sha).toBe(red.controller_sha);
    expect(verdict.controller_sha).toBe(attemptTwoGreen.controller_sha);
    expect(verdict.base_sha).toBe(red.base_sha);
    expect(verdict.base_sha).toBe(attemptTwoGreen.base_sha);

    expect(verdict.attestation_proof_ids).toEqual([red.proof_id, attemptTwoGreen.proof_id].sort());
    expect(verdict.orchestration_run_attempts).toEqual(['1', '2']);
    expect(verdict.attestation_workflow_ref).toBe(attestRef);
    expect(verdict.gate_workflow_ref).toBe(gateRef);
    expect(verdict.gate_run_id).toBe(oidcClaims.run_id);
    expect(verdict.gate_run_attempt).toBe(oidcClaims.run_attempt);
    expect(verdict.controller_dispatch_binding).toBe(dispatchBinding);
    expect(verdict.unit_definition_path).toBe(base.unitDefinitionPath);
    expect(verdict.trust_policy_sha256).toBe(policySha);
    expect(verdict.issued_at).toBe('2026-09-06T12:00:00.000Z');

    expect(verdict.oidc_provenance).toEqual({
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
    });

    expect(verifyGateVerdict(verdict, trustedSigners)).toEqual({ valid: true, errors: [] });
  });

  it('mandate 18: identical attempts collapse to one orchestration run attempt', () => {
    const outcome = produceGateVerdict(base);
    expect(outcome.ok).toBe(true);
    expect(outcome.verdict.orchestration_run_attempts).toEqual(['1']);
    expect(outcome.verdict.attestation_proof_ids).toEqual([red.proof_id, green.proof_id].sort());
  });
});

describe('evaluateTrustedExecutionGate — orchestration run binding', () => {
  const context = { candidateSha, controllerSha };

  it('passes when expectedWorkflowRunId matches every consumed attestation', () => {
    const evaluation = evaluateTrustedExecutionGate(manifest, [red, green], policy, {
      ...context,
      expectedWorkflowRunId: '100',
    });
    expect(evaluation.result).toBe('PASS');
    expect(evaluation.proof_status).toBe('PROVEN');
    expect(evaluation.errors).toEqual([]);
  });

  it('denies when the attestations come from a different run than expected', () => {
    const evaluation = evaluateTrustedExecutionGate(manifest, [red, green], policy, {
      ...context,
      expectedWorkflowRunId: '101',
    });
    expect(evaluation.result).toBe('DENIED_GOVERNANCE');
    expect(evaluation.proof_status).toBe('NOT_PROVEN');
    expect(evaluation.errors).toContain('missing trusted RED attestation for red');
    expect(evaluation.errors).toContain('missing trusted GREEN attestation for green');
  });

  it('denies a non-numeric expected run id before consuming any attestation', () => {
    const evaluation = evaluateTrustedExecutionGate(manifest, [red, green], policy, {
      ...context,
      expectedWorkflowRunId: 'abc',
    });
    expect(evaluation.result).toBe('DENIED_GOVERNANCE');
    expect(evaluation.proof_status).toBe('NOT_PROVEN');
    expect(evaluation.errors).toContain('expected workflow run id must be numeric');
  });

  it('keeps legacy behaviour when no expected run id is given', () => {
    const evaluation = evaluateTrustedExecutionGate(manifest, [red, green], policy, context);
    expect(evaluation.result).toBe('PASS');
    expect(evaluation.proof_status).toBe('PROVEN');
  });
});

describe('writeJsonExclusive — create-once verdict bytes (mandate 15, producer side)', () => {
  it('refuses a second write with EEXIST and preserves the first bytes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'devgov-verdict-once-'));
    const file = join(dir, 'nested', 'verdict.json');

    writeJsonExclusive(file, { a: 1 });
    const firstBytes = readFileSync(file);
    expect(firstBytes.toString('utf8')).toBe(`${stableJson({ a: 1 })}\n`);

    let thrown: unknown;
    try {
      writeJsonExclusive(file, { a: 2 });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeDefined();
    expect((thrown as NodeJS.ErrnoException).code).toBe('EEXIST');
    expect(readFileSync(file).equals(firstBytes)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// CLI: no verdict bytes may exist after any deny path.
// Helpers mirror scripts/audit/devgovCliContract.test.ts.
// ---------------------------------------------------------------------------

const devgovCli = resolve(process.cwd(), 'scripts/devgov/devgov.mjs');

function candidate(overrides: Record<string, unknown> = {}) {
  const root = mkdtempSync(join(tmpdir(), 'devgov-verdict-cli-'));
  const git = (args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  git(['init', '-b', 'main']);
  git(['config', 'user.email', 'devgov@example.invalid']);
  git(['config', 'user.name', 'DEV-GOV Test']);
  writeFileSync(join(root, 'file.txt'), 'initial\n');
  git(['add', 'file.txt']);
  git(['commit', '-m', 'base']);
  const baseSha = git(['rev-parse', 'HEAD']);
  const definition = {
    schema_version: 'dev-gov-v1-unit-definition',
    unit: 'DEV-GOV-V7-VERDICT-CLI',
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
  const cliCandidateSha = git(['rev-parse', 'HEAD']);
  return { root, git, definition, definitionFile, candidateSha: cliCandidateSha };
}

function cliArgs(value: ReturnType<typeof candidate>, command: string, extra: string[] = []) {
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

function runCli(args: string[], options: { env?: Record<string, string> } = {}) {
  const result = spawnSync(process.execPath, [devgovCli, ...args], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: { ...process.env, ...(options.env || {}) },
  });
  return { ...result, json: JSON.parse(result.stdout) };
}

function verdictArgs(value: ReturnType<typeof candidate>, extra: string[] = []) {
  const verdictFile = join(value.root, 'out', 'gate-verdict.json');
  return { verdictFile, args: cliArgs(value, 'evidence-gate', ['--verdict-output', verdictFile, ...extra]) };
}

describe('DEV-GOV-V1 CLI evidence-gate — no verdict on deny', () => {
  it('writes no verdict when the trusted verifier configuration is missing', () => {
    const value = candidate();
    const { verdictFile, args } = verdictArgs(value);
    const result = runCli(args, { env: { DEVGOV_CONTROLLER_SHA: controllerSha } });

    expect(result.status).toBe(4);
    expect(result.json.reason_code).toBe('TRUSTED_VERIFIER_CONFIGURATION_REQUIRED');
    expect(result.json.proof_status).toBe('NOT_PROVEN');
    expect(existsSync(verdictFile)).toBe(false);
  }, 20_000);

  it('writes no verdict when a caller-supplied evidence path is denied', () => {
    const value = candidate();
    const { verdictFile, args } = verdictArgs(value, ['--evidence', 'forged.json']);
    const result = runCli(args, { env: { DEVGOV_CONTROLLER_SHA: controllerSha } });

    expect(result.status).toBe(4);
    expect(result.json.reason_code).toBe('ARBITRARY_EVIDENCE_PATH_DENIED');
    expect(existsSync(verdictFile)).toBe(false);
  }, 20_000);

  it('writes no verdict when a caller-supplied trust policy is denied', () => {
    const value = candidate();
    const { verdictFile, args } = verdictArgs(value, ['--trust-policy', 'x']);
    const result = runCli(args, { env: { DEVGOV_CONTROLLER_SHA: controllerSha } });

    expect(result.status).toBe(4);
    expect(result.json.reason_code).toBe('TRUST_POLICY_SUBSTITUTION_DENIED');
    expect(existsSync(verdictFile)).toBe(false);
  }, 20_000);

  it('writes no verdict when the gate OIDC token cannot prove the trust root', () => {
    const value = candidate();
    const { verdictFile, args } = verdictArgs(value);
    const result = runCli(args, {
      env: {
        DEVGOV_CONTROLLER_SHA: controllerSha,
        DEVGOV_ATTESTATION_RUN_ID: 'abc',
        DEVGOV_CONTROLLER_DISPATCH_BINDING: dispatchBinding,
        DEVGOV_VERIFIER_TRUST_POLICY_JSON: rawPolicy,
        DEVGOV_GATE_OIDC_TOKEN: 'not-a-jwt',
      },
    });

    expect([3, 4]).toContain(result.status);
    expect(['TRUST_ROOT_PROVENANCE_DENIED', 'GITHUB_OIDC_PROVIDER_UNAVAILABLE']).toContain(
      result.json.reason_code,
    );
    expect(result.json.proof_status).toBe('NOT_PROVEN');
    expect(result.json.verdict_status).not.toBe('ISSUED');
    expect(existsSync(verdictFile)).toBe(false);
  }, 20_000);
});
