import { Buffer } from 'node:buffer';
import { createPrivateKey, generateKeyPairSync, sign as signBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  evaluateTrustedExecutionGate,
  proofContractHash,
  RESULT,
  signExecutionRecord,
  unitDefinitionHash,
} from '../devgov/devgov.mjs';
import {
  CONTROLLER_DISPATCH_BINDING_PATTERN,
  GATE_VERDICT_PROOF_STATUS,
  GATE_VERDICT_REASON,
  GATE_VERDICT_REQUIRED_STRING_FIELDS,
  GATE_VERDICT_RESULT,
  GATE_VERDICT_SCHEMA,
  GATE_VERDICT_VERSION,
  gateVerdictId,
  produceGateVerdict,
  signGateVerdict,
  validateGateVerdictPayload,
  validateGateVerdictTrustedSigners,
  verifyGateVerdict,
} from '../devgov/gate-verdict.mjs';
import {
  DEVGOV_GATE_AUDIENCE,
  GITHUB_OIDC_ISSUER,
  PINNED_VERIFIER_AUTHORITY,
} from '../devgov/github-oidc.mjs';
import {
  ATTESTATION_SCHEMA,
  executionResultDigest,
  sha256,
  stableJson,
  verifyExecutionAttestation,
} from '../devgov/trusted-attestation.mjs';

// ---------------------------------------------------------------------------
// Fixture: a full, trust-verified RED/GREEN attestation pair plus the gate's
// own trust root and runtime identity, mirroring the CLI happy path.
// ---------------------------------------------------------------------------

const attestationIssuer = 'github-actions:JbmbAb/Milj-beslut-V1.2:devgov-v0-attest';
const attestationKeyId = 'devgov-ci-ed25519-v1';
const attestationWorkflowRef =
  'JbmbAb/Milj-beslut-V1.2/.github/workflows/devgov-v0-attest.yml@refs/heads/main';
const gateWorkflowRef = PINNED_VERIFIER_AUTHORITY.workflow_ref;
const runnerIdentity = 'github-hosted:ubuntu-latest';
const candidateSha = 'b'.repeat(40);
const controllerSha = 'd'.repeat(40);
const orchestrationRunId = '100';
const gateRunId = '200';
const gateRunAttempt = '1';
const controllerDispatchBinding = 'GATE-VERDICT-UNIT:6:DEV_GOV';

const verdictIssuer = 'github-actions:JbmbAb/Milj-beslut-V1.2:devgov-v0-gate';
const verdictKeyId = 'devgov-gate-verdict-ed25519-v1';

const baseManifest = {
  schema_version: 'dev-gov-v1-unit-definition',
  unit: 'GATE-VERDICT-UNIT',
  role: 'producer',
  mode: 'writer',
  branch: 'codex/gate-verdict-test',
  base_sha: 'a'.repeat(40),
  ancestry_policy: 'exact_parent',
  allowed_paths: ['scripts/devgov/**'],
  forbidden_paths: ['server/**'],
  trusted_execution: { issuer: attestationIssuer, key_id: attestationKeyId },
  required_red: [{ id: 'red', command: 'node', args: ['red.mjs'], expected_classification: 'FAIL' }],
  required_green: [{ id: 'green', command: 'node', args: ['green.mjs'] }],
};

function keys() {
  return generateKeyPairSync('ed25519', {
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
}

const attestationKeys = keys();
const verdictKeys = keys();
const untrustedKeys = keys();

const policy = {
  schema_version: 'dev-gov-v0-trust-policy',
  authority: PINNED_VERIFIER_AUTHORITY,
  trusted_issuers: [
    {
      issuer: attestationIssuer,
      key_id: attestationKeyId,
      algorithm: 'ed25519',
      public_key_pem: attestationKeys.publicKey,
      workflow_ref: attestationWorkflowRef,
      runner_identity: runnerIdentity,
    },
  ],
};
const trustPolicySha256 = sha256(JSON.stringify(policy));
const expectedAudience = `${DEVGOV_GATE_AUDIENCE}:${trustPolicySha256}:${candidateSha}`;

function record(manifest, overrides = {}) {
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
    workflow_ref: attestationWorkflowRef,
    workflow_run_id: orchestrationRunId,
    workflow_run_attempt: '1',
    stdout_sha256: 'e'.repeat(64),
    stderr_sha256: 'f'.repeat(64),
    ...overrides,
  };
  return { ...value, result_digest: executionResultDigest(value) };
}

function signedPair(manifest) {
  const signer = { issuer: attestationIssuer, key_id: attestationKeyId };
  const red = signExecutionRecord(record(manifest), attestationKeys.privateKey, signer);
  const green = signExecutionRecord(
    record(manifest, {
      execution_sha: candidateSha,
      proof_type: 'GREEN',
      test_id: 'green',
      command: 'node green.mjs',
      exit_code: 0,
      classification: 'PASS',
      started_at: '2026-09-01T11:00:00.000Z',
      finished_at: '2026-09-01T11:00:01.000Z',
    }),
    attestationKeys.privateKey,
    signer,
  );
  return { red, green };
}

const trustRoot = {
  valid: true,
  errors: [],
  policy,
  trust_policy_sha256: trustPolicySha256,
  oidc_claims: {
    iss: GITHUB_OIDC_ISSUER,
    aud: expectedAudience,
    repository: PINNED_VERIFIER_AUTHORITY.repository,
    workflow_ref: gateWorkflowRef,
    ref: PINNED_VERIFIER_AUTHORITY.ref,
    environment: PINNED_VERIFIER_AUTHORITY.environment,
    runner_environment: PINNED_VERIFIER_AUTHORITY.runner_environment,
    run_id: gateRunId,
    run_attempt: gateRunAttempt,
    jti: 'jti-gate-verdict-1',
  },
};

const passingGate = {
  result: 'PASS',
  classification: 'PASS',
  reason_code: 'PASS',
  message: 'PASS',
  errors: [],
  proof_status: 'PROVEN',
};

function makeInput(manifest = baseManifest) {
  const { red, green } = signedPair(manifest);
  return {
    unitDefinition: manifest,
    unitDefinitionPath: 'governance/devgov/units/gate-verdict-unit.json',
    candidateSha,
    controllerSha,
    attestations: [red, green],
    trustRoot,
    gate: passingGate,
    runtime: {
      gateWorkflowRef,
      gateRunId,
      gateRunAttempt,
      attestationRunId: orchestrationRunId,
      controllerDispatchBinding,
    },
    signer: { privateKeyPem: verdictKeys.privateKey, issuer: verdictIssuer, keyId: verdictKeyId },
    now: () => new Date('2026-09-06T12:00:00.000Z'),
  };
}

const trustedSigners = [
  {
    purpose: GATE_VERDICT_SCHEMA,
    issuer: verdictIssuer,
    key_id: verdictKeyId,
    algorithm: 'ed25519',
    public_key_pem: verdictKeys.publicKey,
    gate_workflow_ref: gateWorkflowRef,
  },
];

const baseInput = makeInput();
const { red, green } = { red: baseInput.attestations[0], green: baseInput.attestations[1] };

function issue(input = baseInput) {
  const outcome = produceGateVerdict(input);
  if (!outcome.ok) throw new Error(`fixture verdict not issued: ${outcome.errors.join('; ')}`);
  return outcome.verdict;
}

function unsigned(verdict) {
  const { signature: _signature, ...payload } = verdict;
  return payload;
}

/** Sign arbitrary bytes as a verdict without the library's structural guard. */
function rawSign(payload, privateKeyPem) {
  const signature = signBytes(
    null,
    Buffer.from(stableJson(payload)),
    createPrivateKey(privateKeyPem),
  ).toString('base64');
  return { ...payload, signature };
}

const baseVerdict = issue();

// ---------------------------------------------------------------------------

describe('gate verdict: happy path round trip (mandate 17, library level)', () => {
  it('produces a verdict that verifies against the dedicated trusted signer', () => {
    const outcome = produceGateVerdict(baseInput);
    expect(outcome.ok).toBe(true);
    expect(verifyGateVerdict(outcome.verdict, trustedSigners)).toEqual({ valid: true, errors: [] });
  });

  it('carries every required string field as a non-empty string', () => {
    for (const field of GATE_VERDICT_REQUIRED_STRING_FIELDS) {
      expect(typeof baseVerdict[field], field).toBe('string');
      expect(baseVerdict[field].length, field).toBeGreaterThan(0);
    }
    expect(baseVerdict.attestation_proof_ids).toEqual([red.proof_id, green.proof_id].sort());
    expect(baseVerdict.orchestration_run_attempts).toEqual(['1']);
    expect(typeof baseVerdict.signature).toBe('string');
  });

  it('pins schema, version, algorithm, result and proof_status constants', () => {
    expect(GATE_VERDICT_SCHEMA).toBe('dev-gov-v1-gate-verdict');
    expect(GATE_VERDICT_VERSION).toBe('dev-gov-v1.0');
    expect(GATE_VERDICT_RESULT).toBe('PASS');
    expect(GATE_VERDICT_PROOF_STATUS).toBe('PROVEN');
    expect(baseVerdict.schema_version).toBe(GATE_VERDICT_SCHEMA);
    expect(baseVerdict.verdict_version).toBe(GATE_VERDICT_VERSION);
    expect(baseVerdict.signature_algorithm).toBe('ed25519');
    expect(baseVerdict.result).toBe(GATE_VERDICT_RESULT);
    expect(baseVerdict.proof_status).toBe(GATE_VERDICT_PROOF_STATUS);
    expect(baseVerdict.schema_version).not.toBe(ATTESTATION_SCHEMA);
  });

  it('binds the gate identity, orchestration run, controller binding and OIDC provenance', () => {
    expect(baseVerdict.unit_id).toBe(baseManifest.unit);
    expect(baseVerdict.candidate_sha).toBe(candidateSha);
    expect(baseVerdict.controller_sha).toBe(controllerSha);
    expect(baseVerdict.base_sha).toBe(baseManifest.base_sha);
    expect(baseVerdict.controller_dispatch_binding).toBe(controllerDispatchBinding);
    expect(baseVerdict.gate_workflow_ref).toBe(PINNED_VERIFIER_AUTHORITY.workflow_ref);
    expect(baseVerdict.gate_run_id).toBe(gateRunId);
    expect(baseVerdict.gate_run_attempt).toBe(gateRunAttempt);
    expect(baseVerdict.orchestration_run_id).toBe(orchestrationRunId);
    expect(baseVerdict.attestation_workflow_ref).toBe(attestationWorkflowRef);
    expect(baseVerdict.trust_policy_sha256).toBe(trustPolicySha256);
    expect(baseVerdict.oidc_provenance).toEqual({
      issuer: GITHUB_OIDC_ISSUER,
      audience: expectedAudience,
      repository: PINNED_VERIFIER_AUTHORITY.repository,
      workflow_ref: gateWorkflowRef,
      ref: PINNED_VERIFIER_AUTHORITY.ref,
      environment: PINNED_VERIFIER_AUTHORITY.environment,
      runner_environment: PINNED_VERIFIER_AUTHORITY.runner_environment,
      run_id: gateRunId,
      run_attempt: gateRunAttempt,
      jti: 'jti-gate-verdict-1',
    });
    expect(baseVerdict.issued_at).toBe('2026-09-06T12:00:00.000Z');
    expect(baseVerdict.issuer).toBe(verdictIssuer);
    expect(baseVerdict.key_id).toBe(verdictKeyId);
  });
});

describe('gate verdict: canonicalization and identity', () => {
  it('same input yields byte-identical canonical payload and the same verdict_id', () => {
    const again = issue();
    expect(stableJson(unsigned(again))).toBe(stableJson(unsigned(baseVerdict)));
    expect(again.verdict_id).toBe(baseVerdict.verdict_id);
    // Ed25519 is deterministic, so identical bytes even yield an identical signature.
    expect(again.signature).toBe(baseVerdict.signature);
  });

  it('verdict_id is a sha256 digest over the binding tuple, recomputable from the payload', () => {
    expect(baseVerdict.verdict_id).toMatch(/^[0-9a-f]{64}$/);
    expect(gateVerdictId(unsigned(baseVerdict))).toBe(baseVerdict.verdict_id);
    // The identity excludes itself, the signature and issued_at.
    expect(gateVerdictId(baseVerdict)).toBe(baseVerdict.verdict_id);
    expect(gateVerdictId({ ...unsigned(baseVerdict), issued_at: '1999-01-01T00:00:00.000Z' })).toBe(
      baseVerdict.verdict_id,
    );
  });

  it('verdict_id does NOT change when issued_at changes (signature bytes do)', () => {
    const later = issue({ ...baseInput, now: () => new Date('2026-09-07T08:30:00.000Z') });
    expect(later.issued_at).toBe('2026-09-07T08:30:00.000Z');
    expect(later.issued_at).not.toBe(baseVerdict.issued_at);
    expect(later.verdict_id).toBe(baseVerdict.verdict_id);
    expect(later.signature).not.toBe(baseVerdict.signature);
    expect(verifyGateVerdict(later, trustedSigners).valid).toBe(true);
  });

  it('verdict_id DOES change when a different unit definition is consumed', () => {
    const otherManifest = { ...baseManifest, allowed_paths: ['scripts/devgov/**', 'governance/devgov/**'] };
    const other = issue(makeInput(otherManifest));
    expect(other.unit_id).toBe(baseVerdict.unit_id);
    expect(other.unit_definition_hash).not.toBe(baseVerdict.unit_definition_hash);
    expect(other.verdict_id).not.toBe(baseVerdict.verdict_id);
  });

  const payload = unsigned(baseVerdict);
  const sensitivity = [
    ['unit_id', { unit_id: 'OTHER-UNIT' }],
    ['unit_definition_hash', { unit_definition_hash: '1'.repeat(64) }],
    ['proof_contract_hash', { proof_contract_hash: '2'.repeat(64) }],
    ['candidate_sha', { candidate_sha: 'c'.repeat(40) }],
    ['controller_dispatch_binding', { controller_dispatch_binding: 'GATE-VERDICT-UNIT:7:DEV_GOV' }],
    ['gate_run_id', { gate_run_id: '201' }],
    ['orchestration_run_id', { orchestration_run_id: '101' }],
    [
      'attestation_proof_ids',
      { attestation_proof_ids: [...payload.attestation_proof_ids, '9'.repeat(64)].sort() },
    ],
    ['trust_policy_sha256', { trust_policy_sha256: '3'.repeat(64) }],
    ['oidc_provenance.jti', { oidc_provenance: { ...payload.oidc_provenance, jti: 'jti-other' } }],
  ] as const;

  for (const [label, patch] of sensitivity) {
    it(`verdict_id changes when ${label} changes`, () => {
      const changed = gateVerdictId({ ...payload, ...patch });
      expect(changed).toMatch(/^[0-9a-f]{64}$/);
      expect(changed).not.toBe(baseVerdict.verdict_id);
    });
  }
});

describe('gate verdict: hash formula pins', () => {
  it('unit_definition_hash is sha256(stableJson(def)) and equals devgov.unitDefinitionHash', () => {
    expect(baseVerdict.unit_definition_hash).toBe(sha256(stableJson(baseManifest)));
    expect(baseVerdict.unit_definition_hash).toBe(unitDefinitionHash(baseManifest));
    expect(baseVerdict.unit_definition_hash).toBe(red.unit_definition_hash);
  });

  it('proof_contract_hash equals devgov.proofContractHash(def) and the consumed attestations', () => {
    expect(baseVerdict.proof_contract_hash).toBe(proofContractHash(baseManifest));
    expect(baseVerdict.proof_contract_hash).toBe(green.proof_contract_hash);
    // The proof contract is narrower than the definition: they are distinct digests.
    expect(baseVerdict.proof_contract_hash).not.toBe(baseVerdict.unit_definition_hash);
  });
});

describe('gate verdict: mandate 10 — removing any signed field invalidates the verdict', () => {
  const removableStringFields = GATE_VERDICT_REQUIRED_STRING_FIELDS.filter(
    (field) => field !== 'schema_version',
  );

  for (const field of removableStringFields) {
    it(`mandate 10: removing ${field} -> invalid`, () => {
      const { [field]: _removed, ...stripped } = baseVerdict;
      const verification = verifyGateVerdict(stripped, trustedSigners);
      expect(verification.valid).toBe(false);
      expect(verification.errors.length).toBeGreaterThan(0);
      if (field === 'issuer' || field === 'key_id') {
        expect(verification.errors).toContain('gate verdict issuer/key is not trusted');
      } else {
        expect(verification.errors).toContain('gate verdict signature verification failed');
      }
      expect(verification.errors).toContain(`${field} is required`);
    });
  }

  it('mandate 10: removing schema_version -> terminal schema error', () => {
    const { schema_version: _removed, ...stripped } = baseVerdict;
    expect(verifyGateVerdict(stripped, trustedSigners)).toEqual({
      valid: false,
      errors: [`schema_version must be ${GATE_VERDICT_SCHEMA}`],
    });
  });

  for (const field of ['attestation_proof_ids', 'orchestration_run_attempts', 'oidc_provenance']) {
    it(`mandate 10: removing ${field} -> invalid`, () => {
      const { [field]: _removed, ...stripped } = baseVerdict;
      const verification = verifyGateVerdict(stripped, trustedSigners);
      expect(verification.valid).toBe(false);
      expect(verification.errors).toContain('gate verdict signature verification failed');
      expect(verification.errors.some((error) => error.startsWith(field))).toBe(true);
    });
  }

  it('mandate 10: removing the signature itself -> invalid', () => {
    const verification = verifyGateVerdict(unsigned(baseVerdict), trustedSigners);
    expect(verification.valid).toBe(false);
    expect(verification.errors).toContain('signature is required');
  });
});

describe('gate verdict: mandate 11 — post-signing mutation is detected', () => {
  const mutations = [
    ['candidate_sha', { candidate_sha: 'c'.repeat(40) }],
    ['result', { result: 'FAIL' }],
    ['controller_dispatch_binding', { controller_dispatch_binding: 'GATE-VERDICT-UNIT:7:DEV_GOV' }],
    ['orchestration_run_id', { orchestration_run_id: '101' }],
    ['proof_status', { proof_status: 'NOT_PROVEN' }],
    [
      'gate_run_id + oidc run_id',
      { gate_run_id: '201', oidc_provenance: { ...baseVerdict.oidc_provenance, run_id: '201' } },
    ],
  ] as const;

  for (const [label, patch] of mutations) {
    it(`mandate 11: mutating ${label} after signing -> signature verification failed`, () => {
      const mutated = { ...baseVerdict, ...patch };
      const verification = verifyGateVerdict(mutated, trustedSigners);
      expect(verification.valid).toBe(false);
      expect(verification.errors).toContain('gate verdict signature verification failed');
    });
  }

  it('mandate 11: a mutated binding field also breaks the verdict identity', () => {
    const verification = verifyGateVerdict({ ...baseVerdict, candidate_sha: 'c'.repeat(40) }, trustedSigners);
    expect(verification.errors).toContain('verdict_id mismatch');
  });

  it('mandate 11: re-signing a mutated payload with an UNTRUSTED key under the trusted issuer/key_id -> invalid', () => {
    const resigned = signGateVerdict(
      { ...unsigned(baseVerdict), candidate_sha: 'c'.repeat(40) },
      untrustedKeys.privateKey,
      { issuer: verdictIssuer, key_id: verdictKeyId },
    );
    // The forger produced an internally consistent object...
    expect(resigned.issuer).toBe(verdictIssuer);
    expect(resigned.key_id).toBe(verdictKeyId);
    expect(gateVerdictId(unsigned(resigned))).toBe(resigned.verdict_id);
    // ...that still fails against the trusted key.
    const verification = verifyGateVerdict(resigned, trustedSigners);
    expect(verification.valid).toBe(false);
    expect(verification.errors).toEqual(['gate verdict signature verification failed']);
  });

  it('mandate 11: re-signing with the real key but a bogus verdict_id is impossible (id recomputed at sign time)', () => {
    const resigned = signGateVerdict(
      { ...unsigned(baseVerdict), verdict_id: '0'.repeat(64) },
      verdictKeys.privateKey,
      {
        issuer: verdictIssuer,
        key_id: verdictKeyId,
      },
    );
    expect(resigned.verdict_id).toBe(baseVerdict.verdict_id);
  });
});

describe('gate verdict: mandate 12 — unknown issuer/key_id is a denial, never a fallback', () => {
  it('mandate 12: verdict key_id not in the trusted signer list -> not trusted', () => {
    const signers = [{ ...trustedSigners[0], key_id: 'devgov-gate-verdict-ed25519-v2' }];
    const verification = verifyGateVerdict(baseVerdict, signers);
    expect(verification.valid).toBe(false);
    expect(verification.errors).toEqual(['gate verdict issuer/key is not trusted']);
  });

  it('mandate 12: verdict issuer not in the trusted signer list -> not trusted', () => {
    const signers = [{ ...trustedSigners[0], issuer: 'github-actions:someone-else/repo:devgov-v0-gate' }];
    const verification = verifyGateVerdict(baseVerdict, signers);
    expect(verification.valid).toBe(false);
    expect(verification.errors).toEqual(['gate verdict issuer/key is not trusted']);
  });

  it('mandate 12: a verdict claiming a foreign key_id is not matched against the trusted key', () => {
    const foreign = signGateVerdict(unsigned(baseVerdict), verdictKeys.privateKey, {
      issuer: verdictIssuer,
      key_id: 'devgov-gate-verdict-ed25519-v2',
    });
    const verification = verifyGateVerdict(foreign, trustedSigners);
    expect(verification.valid).toBe(false);
    expect(verification.errors).toEqual(['gate verdict issuer/key is not trusted']);
  });

  it('mandate 12: same issuer/key_id but a different trusted public key -> signature verification failed', () => {
    const signers = [{ ...trustedSigners[0], public_key_pem: untrustedKeys.publicKey }];
    const verification = verifyGateVerdict(baseVerdict, signers);
    expect(verification.valid).toBe(false);
    expect(verification.errors).toEqual(['gate verdict signature verification failed']);
  });
});

describe('gate verdict: mandate 13 — the execution-attestation key can never sign a verdict', () => {
  it('mandate 13: produceGateVerdict with the attestation private key -> rejected by the verdict signers', () => {
    const outcome = produceGateVerdict({
      ...baseInput,
      signer: { ...baseInput.signer, privateKeyPem: attestationKeys.privateKey },
    });
    // The producer only proves the verdict verifies under the key it was handed.
    expect(outcome.ok).toBe(true);
    const verification = verifyGateVerdict(outcome.verdict, trustedSigners);
    expect(verification.valid).toBe(false);
    expect(verification.errors).toEqual(['gate verdict signature verification failed']);
  });

  it('mandate 13: signGateVerdict with the attestation key under the attestation issuer/key_id -> not trusted', () => {
    const cross = signGateVerdict(unsigned(baseVerdict), attestationKeys.privateKey, {
      issuer: attestationIssuer,
      key_id: attestationKeyId,
    });
    const verification = verifyGateVerdict(cross, trustedSigners);
    expect(verification.valid).toBe(false);
    expect(verification.errors).toEqual(['gate verdict issuer/key is not trusted']);
  });

  it('mandate 13: an attestation trust policy is NOT a valid verdict signer list', () => {
    const errors = validateGateVerdictTrustedSigners(policy.trusted_issuers);
    expect(errors).toContain(`trusted gate verdict signer 0 purpose must be ${GATE_VERDICT_SCHEMA}`);
    expect(errors).toContain('trusted gate verdict signer 0 gate_workflow_ref is required');
  });

  it('mandate 13: verifying against attestation trusted_issuers never falls back to the attestation key', () => {
    const cross = signGateVerdict(unsigned(baseVerdict), attestationKeys.privateKey, {
      issuer: attestationIssuer,
      key_id: attestationKeyId,
    });
    // Correct key for that issuer/key_id in the attestation policy — still refused.
    const verification = verifyGateVerdict(cross, policy.trusted_issuers);
    expect(verification.valid).toBe(false);
    expect(verification.errors).toEqual(validateGateVerdictTrustedSigners(policy.trusted_issuers));
    expect(verification.errors).toContain(
      `trusted gate verdict signer 0 purpose must be ${GATE_VERDICT_SCHEMA}`,
    );
    // And the genuine verdict is refused against that list too: the list itself is invalid.
    expect(verifyGateVerdict(baseVerdict, policy.trusted_issuers).valid).toBe(false);
  });

  it('mandate 13: a signer entry with the attestation purpose is refused', () => {
    const signers = [{ ...trustedSigners[0], purpose: ATTESTATION_SCHEMA }];
    const verification = verifyGateVerdict(baseVerdict, signers);
    expect(verification.valid).toBe(false);
    expect(verification.errors).toEqual([
      `trusted gate verdict signer 0 purpose must be ${GATE_VERDICT_SCHEMA}`,
    ]);
  });

  it('mandate 13: empty or missing signer list is a denial', () => {
    expect(verifyGateVerdict(baseVerdict, [])).toEqual({
      valid: false,
      errors: ['trusted gate verdict signers must be a non-empty array'],
    });
    expect(verifyGateVerdict(baseVerdict, undefined).valid).toBe(false);
  });
});

describe('gate verdict: mandate 14 — schema domain separation in both directions', () => {
  it('mandate 14: a signed execution attestation passed to verifyGateVerdict -> terminal schema error only', () => {
    expect(verifyGateVerdict(red, trustedSigners)).toEqual({
      valid: false,
      errors: [`schema_version must be ${GATE_VERDICT_SCHEMA}`],
    });
    expect(verifyGateVerdict(green, trustedSigners).errors).toEqual([
      `schema_version must be ${GATE_VERDICT_SCHEMA}`,
    ]);
    // Terminal: the schema check runs before the signer list is even validated.
    expect(verifyGateVerdict(red, [])).toEqual({
      valid: false,
      errors: [`schema_version must be ${GATE_VERDICT_SCHEMA}`],
    });
    expect(verifyGateVerdict(red, policy.trusted_issuers).errors).toEqual([
      `schema_version must be ${GATE_VERDICT_SCHEMA}`,
    ]);
  });

  it('mandate 14: attestation relabelled as a verdict cannot be signed by signGateVerdict', () => {
    expect(() =>
      signGateVerdict({ ...unsigned(red), schema_version: GATE_VERDICT_SCHEMA }, verdictKeys.privateKey, {
        issuer: verdictIssuer,
        key_id: verdictKeyId,
      }),
    ).toThrow(/invalid gate verdict payload/);
  });

  it('mandate 14: attestation relabelled as a verdict and raw-signed with the verdict key -> invalid', () => {
    const relabelled = {
      ...unsigned(red),
      schema_version: GATE_VERDICT_SCHEMA,
      issuer: verdictIssuer,
      key_id: verdictKeyId,
    };
    const forged = rawSign(relabelled, verdictKeys.privateKey);
    const verification = verifyGateVerdict(forged, trustedSigners);
    expect(verification.valid).toBe(false);
    // Signature is genuine, so the refusal is structural.
    expect(verification.errors).not.toContain('gate verdict signature verification failed');
    expect(verification.errors).toContain(`verdict_version must be ${GATE_VERDICT_VERSION}`);
    expect(verification.errors).toContain('verdict_id is required');
    expect(verification.errors).toContain('controller_dispatch_binding is required');
    expect(verification.errors).toContain('gate_run_id is required');
    expect(verification.errors).toContain('orchestration_run_id is required');
    expect(verification.errors).toContain(
      'attestation_proof_ids must be a non-empty sorted array of unique proof ids',
    );
    expect(verification.errors).toContain('oidc_provenance is required');
  });

  it('mandate 14: a valid verdict passed to verifyExecutionAttestation -> invalid', () => {
    const verification = verifyExecutionAttestation(baseVerdict, policy);
    expect(verification.valid).toBe(false);
    expect(verification.errors).toContain('attestation issuer/key is not trusted');
    expect(verification.errors).toContain(`schema_version must be ${ATTESTATION_SCHEMA}`);
  });

  it('mandate 14: a verdict relabelled as an attestation and signed by the attestation key -> invalid', () => {
    const relabelled = {
      ...unsigned(baseVerdict),
      schema_version: ATTESTATION_SCHEMA,
      issuer: attestationIssuer,
      key_id: attestationKeyId,
    };
    const forged = rawSign(relabelled, attestationKeys.privateKey);
    const verification = verifyExecutionAttestation(forged, policy);
    expect(verification.valid).toBe(false);
    expect(verification.errors).not.toContain('attestation signature verification failed');
    expect(verification.errors.length).toBeGreaterThan(0);
  });

  it('mandate 14: evaluateTrustedExecutionGate refuses a verdict smuggled in among attestations', () => {
    const context = { candidateSha, controllerSha, expectedWorkflowRunId: orchestrationRunId };
    const clean = evaluateTrustedExecutionGate(baseManifest, [red, green], policy, context);
    expect(clean).toEqual({ result: RESULT.PASS, proof_status: 'PROVEN', errors: [] });

    const smuggled = evaluateTrustedExecutionGate(baseManifest, [red, green, baseVerdict], policy, context);
    expect(smuggled.result).toBe(RESULT.DENIED_GOVERNANCE);
    expect(smuggled.proof_status).toBe('NOT_PROVEN');
    expect(smuggled.errors).toContain('attestation issuer/key is not trusted');
    expect(smuggled.errors).toContain(`schema_version must be ${ATTESTATION_SCHEMA}`);
  });

  it('mandate 14: produceGateVerdict refuses to consume a verdict as an attestation', () => {
    const outcome = produceGateVerdict({ ...baseInput, attestations: [red, green, baseVerdict] });
    expect(outcome.ok).toBe(false);
    expect(outcome.reason_code).toBe(GATE_VERDICT_REASON.BINDING_DENIED);
    expect(outcome.errors).toContain('attestation 2 is not an execution attestation');
  });
});

describe('gate verdict: validateGateVerdictPayload structural rejections', () => {
  const payload = unsigned(baseVerdict);

  it('accepts the canonical produced payload, signed or unsigned', () => {
    expect(validateGateVerdictPayload(payload)).toEqual([]);
    expect(validateGateVerdictPayload(baseVerdict)).toEqual([]);
  });

  it('rejects non-object and wrong-schema payloads terminally', () => {
    expect(validateGateVerdictPayload(null)).toEqual(['gate verdict payload must be an object']);
    expect(validateGateVerdictPayload([])).toEqual(['gate verdict payload must be an object']);
    expect(validateGateVerdictPayload(red)).toEqual([`schema_version must be ${GATE_VERDICT_SCHEMA}`]);
    expect(validateGateVerdictPayload({ ...payload, schema_version: 'dev-gov-v2-gate-verdict' })).toEqual([
      `schema_version must be ${GATE_VERDICT_SCHEMA}`,
    ]);
  });

  it("rejects result 'FAIL'", () => {
    expect(validateGateVerdictPayload({ ...payload, result: 'FAIL' })).toEqual(['result must be PASS']);
    expect(validateGateVerdictPayload({ ...payload, result: 'DENIED_GOVERNANCE' })).toEqual([
      'result must be PASS',
    ]);
  });

  it("rejects proof_status 'NOT_PROVEN'", () => {
    expect(validateGateVerdictPayload({ ...payload, proof_status: 'NOT_PROVEN' })).toEqual([
      'proof_status must be PROVEN',
    ]);
  });

  it('rejects gate_run_id === orchestration_run_id', () => {
    const errors = validateGateVerdictPayload({
      ...payload,
      gate_run_id: orchestrationRunId,
      oidc_provenance: { ...payload.oidc_provenance, run_id: orchestrationRunId },
    });
    expect(errors).toEqual(['gate_run_id and orchestration_run_id must be distinct runs']);
  });

  it('rejects attestation_workflow_ref === gate_workflow_ref', () => {
    expect(validateGateVerdictPayload({ ...payload, attestation_workflow_ref: gateWorkflowRef })).toEqual([
      'attestation_workflow_ref must not be the gate workflow',
    ]);
  });

  it('rejects gate_workflow_ref / gate run fields that disagree with oidc_provenance', () => {
    const otherGateRef = `${gateWorkflowRef.split('@')[0]}@refs/heads/feature`;
    expect(validateGateVerdictPayload({ ...payload, gate_workflow_ref: otherGateRef })).toEqual([
      'gate_workflow_ref does not match oidc_provenance.workflow_ref',
    ]);
    // Pointing the gate ref at the attestation workflow trips both the OIDC mismatch and the
    // gate/attestation separation rule.
    expect(validateGateVerdictPayload({ ...payload, gate_workflow_ref: attestationWorkflowRef })).toEqual([
      'gate_workflow_ref does not match oidc_provenance.workflow_ref',
      'attestation_workflow_ref must not be the gate workflow',
    ]);
    expect(validateGateVerdictPayload({ ...payload, gate_run_id: '201' })).toEqual([
      'gate_run_id does not match oidc_provenance.run_id',
    ]);
    expect(validateGateVerdictPayload({ ...payload, gate_run_attempt: '2' })).toEqual([
      'gate_run_attempt does not match oidc_provenance.run_attempt',
    ]);
  });

  it('rejects unsorted, duplicate, empty or non-array attestation_proof_ids', () => {
    const sorted = payload.attestation_proof_ids;
    expect(sorted.length).toBe(2);
    const message = 'attestation_proof_ids must be a non-empty sorted array of unique proof ids';
    expect(validateGateVerdictPayload({ ...payload, attestation_proof_ids: [...sorted].reverse() })).toEqual([
      message,
    ]);
    expect(validateGateVerdictPayload({ ...payload, attestation_proof_ids: [sorted[0], sorted[0]] })).toEqual(
      [message],
    );
    expect(validateGateVerdictPayload({ ...payload, attestation_proof_ids: [] })).toEqual([message]);
    expect(validateGateVerdictPayload({ ...payload, attestation_proof_ids: sorted.join(',') })).toEqual([
      message,
    ]);
    expect(validateGateVerdictPayload({ ...payload, attestation_proof_ids: [sorted[0], ''] })).toEqual([
      message,
    ]);
  });

  it('rejects unsorted, duplicate or non-numeric orchestration_run_attempts', () => {
    const message = 'orchestration_run_attempts must be a non-empty sorted array of unique run attempts';
    expect(validateGateVerdictPayload({ ...payload, orchestration_run_attempts: ['2', '1'] })).toEqual([
      message,
    ]);
    expect(validateGateVerdictPayload({ ...payload, orchestration_run_attempts: ['1', '1'] })).toEqual([
      message,
    ]);
    expect(validateGateVerdictPayload({ ...payload, orchestration_run_attempts: ['one'] })).toEqual([
      'orchestration_run_attempts must be numeric',
    ]);
  });

  it('rejects non-hex sha256 digests', () => {
    for (const field of ['unit_definition_hash', 'proof_contract_hash', 'trust_policy_sha256']) {
      expect(validateGateVerdictPayload({ ...payload, [field]: 'g'.repeat(64) })).toEqual([
        `${field} must be a sha256 hex digest`,
      ]);
      expect(validateGateVerdictPayload({ ...payload, [field]: 'a'.repeat(63) })).toEqual([
        `${field} must be a sha256 hex digest`,
      ]);
    }
    expect(validateGateVerdictPayload({ ...payload, verdict_id: 'A'.repeat(64) })).toEqual([
      'verdict_id must be a sha256 hex digest',
    ]);
  });

  it('rejects non-40-hex Git SHAs', () => {
    for (const field of ['base_sha', 'candidate_sha', 'controller_sha']) {
      expect(validateGateVerdictPayload({ ...payload, [field]: 'B'.repeat(40) })).toEqual([
        `${field} must be a full 40-character lowercase Git SHA`,
      ]);
      expect(validateGateVerdictPayload({ ...payload, [field]: 'b'.repeat(39) })).toEqual([
        `${field} must be a full 40-character lowercase Git SHA`,
      ]);
      expect(validateGateVerdictPayload({ ...payload, [field]: 'bbbbbbb' })).toEqual([
        `${field} must be a full 40-character lowercase Git SHA`,
      ]);
    }
  });

  it('rejects a malformed controller_dispatch_binding', () => {
    for (const binding of ['bad binding with spaces', 'unit/6/DEV_GOV', 'x'.repeat(201), 'unit;drop']) {
      expect(CONTROLLER_DISPATCH_BINDING_PATTERN.test(binding)).toBe(false);
      expect(validateGateVerdictPayload({ ...payload, controller_dispatch_binding: binding })).toEqual([
        'controller_dispatch_binding is malformed',
      ]);
    }
    expect(validateGateVerdictPayload({ ...payload, controller_dispatch_binding: '' })).toEqual([
      'controller_dispatch_binding is required',
    ]);
  });

  it('rejects non-numeric run identifiers and a non-ISO issued_at', () => {
    expect(validateGateVerdictPayload({ ...payload, orchestration_run_id: '100a' })).toEqual([
      'orchestration_run_id must be numeric',
    ]);
    expect(validateGateVerdictPayload({ ...payload, issued_at: 'yesterday' })).toEqual([
      'issued_at must be an ISO-8601 timestamp',
    ]);
  });

  it('rejects wrong verdict_version / signature_algorithm and a present-but-empty signature', () => {
    expect(validateGateVerdictPayload({ ...payload, verdict_version: 'dev-gov-v0.9' })).toEqual([
      `verdict_version must be ${GATE_VERDICT_VERSION}`,
    ]);
    expect(validateGateVerdictPayload({ ...payload, signature_algorithm: 'rsa' })).toEqual([
      'signature_algorithm must be ed25519',
    ]);
    expect(validateGateVerdictPayload({ ...payload, signature: '' })).toEqual([
      'signature must be a non-empty string when present',
    ]);
  });

  it('rejects incomplete oidc_provenance', () => {
    const { jti: _jti, ...withoutJti } = payload.oidc_provenance;
    expect(validateGateVerdictPayload({ ...payload, oidc_provenance: withoutJti })).toEqual([
      'oidc_provenance.jti is required',
    ]);
    expect(validateGateVerdictPayload({ ...payload, oidc_provenance: 'claims' })).toEqual([
      'oidc_provenance is required',
    ]);
  });
});

describe('gate verdict: trusted signer workflow pinning', () => {
  it("a trusted signer whose gate_workflow_ref differs from the verdict's -> not trusted for this signer", () => {
    const signers = [{ ...trustedSigners[0], gate_workflow_ref: attestationWorkflowRef }];
    const verification = verifyGateVerdict(baseVerdict, signers);
    expect(verification.valid).toBe(false);
    expect(verification.errors).toEqual(['gate verdict workflow_ref is not trusted for this signer']);
  });

  it('a signer list with a second, correctly pinned entry for the same key still verifies', () => {
    const signers = [
      {
        ...trustedSigners[0],
        key_id: 'devgov-gate-verdict-ed25519-v0',
        public_key_pem: untrustedKeys.publicKey,
      },
      trustedSigners[0],
    ];
    expect(verifyGateVerdict(baseVerdict, signers)).toEqual({ valid: true, errors: [] });
  });

  it('validateGateVerdictTrustedSigners enumerates every structural defect per entry', () => {
    expect(validateGateVerdictTrustedSigners([])).toEqual([
      'trusted gate verdict signers must be a non-empty array',
    ]);
    expect(validateGateVerdictTrustedSigners([null])).toEqual([
      'trusted gate verdict signer 0 must be an object',
    ]);
    expect(validateGateVerdictTrustedSigners([trustedSigners[0]])).toEqual([]);
    expect(validateGateVerdictTrustedSigners([{ ...trustedSigners[0], algorithm: 'rsa' }])).toEqual([
      'trusted gate verdict signer 0 algorithm must be ed25519',
    ]);
    expect(validateGateVerdictTrustedSigners([{ ...trustedSigners[0], public_key_pem: '' }])).toEqual([
      'trusted gate verdict signer 0 public_key_pem is required',
    ]);
  });
});

describe('gate verdict: produceGateVerdict refusal reasons', () => {
  it('SIGNER_UNAVAILABLE when the dedicated signer is missing', () => {
    const outcome = produceGateVerdict({ ...baseInput, signer: { ...baseInput.signer, privateKeyPem: '' } });
    expect(outcome.ok).toBe(false);
    expect(outcome.reason_code).toBe(GATE_VERDICT_REASON.SIGNER_UNAVAILABLE);
  });

  it('RESULT_NOT_PASS when the gate did not PASS or PROVE', () => {
    const failed = produceGateVerdict({
      ...baseInput,
      gate: { ...passingGate, result: 'DENIED_GOVERNANCE', classification: 'DENIED_GOVERNANCE' },
    });
    expect(failed.ok).toBe(false);
    expect(failed.reason_code).toBe(GATE_VERDICT_REASON.RESULT_NOT_PASS);
    const unproven = produceGateVerdict({
      ...baseInput,
      gate: { ...passingGate, proof_status: 'NOT_PROVEN' },
    });
    expect(unproven.ok).toBe(false);
    expect(unproven.reason_code).toBe(GATE_VERDICT_REASON.RESULT_NOT_PASS);
  });

  it('BINDING_DENIED when the gate run equals the orchestration run', () => {
    const outcome = produceGateVerdict({
      ...baseInput,
      runtime: { ...baseInput.runtime, gateRunId: orchestrationRunId },
      trustRoot: { ...trustRoot, oidc_claims: { ...trustRoot.oidc_claims, run_id: orchestrationRunId } },
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.reason_code).toBe(GATE_VERDICT_REASON.BINDING_DENIED);
    expect(outcome.errors).toContain('gate run id must differ from the orchestration run id');
  });

  it('BINDING_DENIED when the gate workflow_ref is not the pinned verifier authority', () => {
    const outcome = produceGateVerdict({
      ...baseInput,
      runtime: { ...baseInput.runtime, gateWorkflowRef: attestationWorkflowRef },
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.reason_code).toBe(GATE_VERDICT_REASON.BINDING_DENIED);
    expect(outcome.errors).toContain('gate workflow_ref is not the pinned verifier authority');
  });
});
