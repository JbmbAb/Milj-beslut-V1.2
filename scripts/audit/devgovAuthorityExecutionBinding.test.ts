import { execFileSync } from 'node:child_process';
import { generateKeyPairSync, sign as signBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  AUTHORITY_CATALOG_SCHEMA,
  AUTHORITY_CONTENT_DIGEST_ALGORITHM,
  AUTHORITY_DENIAL,
  AUTHORITY_STATUS,
} from '../devgov/authority.mjs';
import {
  RESULT,
  evaluateTrustedExecutionGate,
  expectedAuthorityBinding,
  proofContractHash,
  runManifestCommand,
  signExecutionRecord,
  trustedExecutionRecord,
  unitDefinitionHash,
  validateExecutionRecordForManifest,
  validateUnitDefinition,
} from '../devgov/devgov.mjs';
import { PINNED_VERIFIER_AUTHORITY } from '../devgov/github-oidc.mjs';
import {
  EXECUTION_RECORD_SCHEMA,
  attestationProofId,
  authorityBindingDigest,
  executionResultDigest,
  stableJson,
  validateExecutionRecord,
  verifyExecutionAttestation,
} from '../devgov/trusted-attestation.mjs';

const AUTHORITY_ID = 'DEVGOV-AUTHORITY-FIXTURE-V1';
const ROOT_ENV = 'FIXTURE_AUTHORITY_ROOT';
const CONTENT_DIGEST = 'a1'.repeat(32);
const REFERENCE_DIGEST = 'b2'.repeat(32);

const issuer = 'github-actions:example/repo:devgov-v0-attest';
const keyId = 'devgov-ci-ed25519-v1';
const workflowRef = 'example/repo/.github/workflows/devgov-v0-attest.yml@refs/heads/main';
const runnerIdentity = 'github-hosted:ubuntu-latest';
const controllerSha = 'd'.repeat(40);

let scratch: string;
let repo: string;
let repoSha: string;
let authorityRoot: string;

const catalog = {
  schema_version: AUTHORITY_CATALOG_SCHEMA,
  authorities: {
    [AUTHORITY_ID]: {
      provider: 'github-release-asset',
      source: {
        repository: 'JbmbAb/Milj-beslut-V1.2',
        release_tag: 'devgov-authority-fixture-v1',
        asset_name: 'authority-fixture-v1.tar.gz',
      },
      archive: { format: 'tar.gz', sha256: 'c3'.repeat(32) },
      content: { digest_algorithm: AUTHORITY_CONTENT_DIGEST_ALGORITHM, digest: CONTENT_DIGEST },
      reference: { digest_algorithm: 'sha256', digest: REFERENCE_DIGEST, entry: 'contracts/ref.json' },
      capability_env: { root: ROOT_ENV },
    },
  },
};

/** Exactly what a verified resolution hands the controller. */
function verifiedAuthority(root: string) {
  return {
    status: AUTHORITY_STATUS.VERIFIED_READ_ONLY,
    authority_id: AUTHORITY_ID,
    content_digest: CONTENT_DIGEST,
    reference_digest: REFERENCE_DIGEST,
    materialization_result: AUTHORITY_STATUS.VERIFIED_READ_ONLY,
    materialization_root: root,
    source_identity: 'test-fixture',
    capability_env: { [ROOT_ENV]: root },
    probes: ['file-write'],
    reason_code: null,
    errors: [],
  };
}

function notRequired() {
  return {
    status: AUTHORITY_STATUS.NOT_REQUIRED,
    authority_id: '',
    content_digest: '',
    reference_digest: '',
    materialization_result: AUTHORITY_STATUS.NOT_REQUIRED,
    materialization_root: '',
    source_identity: '',
    capability_env: {},
    probes: [],
    reason_code: null,
    errors: [],
  };
}

/** Asserts, from inside the spawned proof process, what the capability granted. */
const SEES_AUTHORITY = [
  '-e',
  [
    'const fs = require("node:fs");',
    'const path = require("node:path");',
    `const root = process.env["${ROOT_ENV}"];`,
    'if (!root) process.exit(21);',
    'if (!fs.existsSync(path.join(root, "corpus", "capture-manifest-v1.json"))) process.exit(22);',
    'process.exit(0);',
  ].join(''),
];

const SEES_NO_AUTHORITY = [
  '-e',
  `if (process.env["${ROOT_ENV}"] !== undefined) process.exit(31); process.exit(0);`,
];

function manifest(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: 'dev-gov-v1-unit-definition',
    unit: 'DEV-GOV-AUTHORITY-CAPABILITY-TRANSPORT-V1',
    role: 'producer',
    mode: 'writer',
    branch: 'codex/devgov-authority-capability-transport-v1',
    base_sha: repoSha,
    ancestry_policy: 'descendant_of_base',
    allowed_paths: ['scripts/devgov/**'],
    forbidden_paths: ['server/**'],
    trusted_execution: { issuer, key_id: keyId },
    required_red: [
      { id: 'red', command: 'node', args: ['red.mjs'], expected_classification: 'FAIL', required_head: 'any' },
    ],
    required_green: [
      {
        id: 'green',
        command: 'node',
        args: ['green.mjs'],
        required_head: 'any',
        authority_requirement: { id: AUTHORITY_ID },
      },
    ],
    ...overrides,
  };
}

/** A manifest whose declared GREEN command is the exact command actually spawned. */
function runnableManifest() {
  return manifest({
    required_green: [
      {
        id: 'green',
        command: process.execPath,
        args: SEES_AUTHORITY,
        required_head: 'any',
        authority_requirement: { id: AUTHORITY_ID },
      },
    ],
  });
}

function keys() {
  return generateKeyPairSync('ed25519', {
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
}

function policy(publicKey: string) {
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

function record(unit: ReturnType<typeof manifest>, overrides: Record<string, unknown> = {}) {
  const value = {
    schema_version: EXECUTION_RECORD_SCHEMA,
    unit_id: unit.unit,
    unit_definition_hash: unitDefinitionHash(unit),
    proof_contract_hash: proofContractHash(unit),
    base_sha: unit.base_sha,
    candidate_sha: repoSha,
    execution_sha: repoSha,
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
    authority_id: '',
    authority_content_digest: '',
    authority_reference_digest: '',
    authority_materialization_result: 'NOT_REQUIRED',
    ...overrides,
  };
  return {
    ...value,
    result_digest: executionResultDigest(value),
    authority_binding_digest: authorityBindingDigest(value),
  };
}

function signedPair(privateKey: string, unit = manifest()) {
  const red = signExecutionRecord(record(unit), privateKey, { issuer, key_id: keyId });
  const green = signExecutionRecord(
    record(unit, {
      proof_type: 'GREEN',
      test_id: 'green',
      command: 'node green.mjs',
      exit_code: 0,
      classification: 'PASS',
      started_at: '2026-09-01T11:00:00.000Z',
      finished_at: '2026-09-01T11:00:01.000Z',
      authority_id: AUTHORITY_ID,
      authority_content_digest: CONTENT_DIGEST,
      authority_reference_digest: REFERENCE_DIGEST,
      authority_materialization_result: 'VERIFIED_READ_ONLY',
    }),
    privateKey,
    { issuer, key_id: keyId },
  );
  return [red, green];
}

function resign(attestation: Record<string, unknown>, privateKey: string, mutate: (p: any) => any) {
  const { signature: _signature, ...payload } = attestation;
  const changed = mutate({ ...payload });
  return {
    ...changed,
    signature: signBytes(null, Buffer.from(stableJson(changed)), privateKey).toString('base64'),
  };
}

/**
 * A maximally capable forger: re-derives every internal digest (authority
 * binding, proof id) and re-signs, so the forgery is entirely self-consistent.
 * Only a comparison against the protected catalog can reject it.
 */
function forgeAuthority(
  attestation: Record<string, unknown>,
  privateKey: string,
  authority: Record<string, string>,
) {
  return resign(attestation, privateKey, (payload) => {
    const changed = { ...payload, ...authority };
    changed.authority_binding_digest = authorityBindingDigest(changed);
    const {
      schema_version: _schema,
      attestation_version: _version,
      execution_record_schema_version: executionRecordSchemaVersion,
      signature_algorithm: _algorithm,
      issuer: recordIssuer,
      key_id: recordKeyId,
      proof_id: _proofId,
      ...executionRecordFields
    } = changed;
    changed.proof_id = attestationProofId(
      { schema_version: executionRecordSchemaVersion, ...executionRecordFields },
      { issuer: recordIssuer, key_id: recordKeyId },
    );
    return changed;
  });
}

beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), 'devgov-authority-binding-'));
  repo = join(scratch, 'repo');
  mkdirSync(repo, { recursive: true });
  const git = (args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
  git(['init', '--quiet', '--initial-branch', 'main']);
  git(['config', 'user.email', 'devgov@example.invalid']);
  git(['config', 'user.name', 'devgov']);
  writeFileSync(join(repo, 'file.txt'), 'proof surface\n');
  git(['add', '.']);
  git(['commit', '--quiet', '-m', 'proof surface']);
  repoSha = git(['rev-parse', 'HEAD']);

  authorityRoot = join(scratch, 'authority');
  mkdirSync(join(authorityRoot, 'corpus'), { recursive: true });
  writeFileSync(join(authorityRoot, 'corpus', 'capture-manifest-v1.json'), '{"cases":["alpha"]}\n');
});

afterAll(() => {
  try {
    rmSync(scratch, { recursive: true, force: true, maxRetries: 5 });
  } catch {
    // best effort
  }
});

describe('11 a verified authority capability reaches the proof process', () => {
  it('grants the capability the catalog declared, and only that', () => {
    const unit = runnableManifest();
    const evidence = runManifestCommand(unit, unit.required_green[0], 'GREEN', {
      worktree: repo,
      candidateSha: repoSha,
      authority: verifiedAuthority(authorityRoot),
      reservedEnvNames: new Set([ROOT_ENV]),
    });

    // Exit 0 means the proof read the corpus through the granted capability.
    expect({ exit: evidence.exit_code, classification: evidence.classification }).toEqual({
      exit: 0,
      classification: RESULT.PASS,
    });
    expect(evidence.authority_id).toBe(AUTHORITY_ID);
    expect(evidence.authority_materialization_result).toBe(AUTHORITY_STATUS.VERIFIED_READ_ONLY);
  });

  it('positive control: the same proof fails when the capability is absent', () => {
    const unit = manifest();
    const evidence = runManifestCommand(
      unit,
      { id: 'green', command: process.execPath, args: SEES_AUTHORITY, required_head: 'any' },
      'GREEN',
      { worktree: repo, candidateSha: repoSha, reservedEnvNames: new Set([ROOT_ENV]) },
    );
    expect(evidence.exit_code).toBe(21);
    expect(evidence.classification).toBe(RESULT.FAIL);
  });

  it('scrubs an inherited ambient value so it cannot stand in for verified authority', () => {
    const unit = manifest();
    process.env[ROOT_ENV] = join(scratch, 'ambient-not-authority');
    try {
      const evidence = runManifestCommand(
        unit,
        { id: 'green', command: process.execPath, args: SEES_NO_AUTHORITY, required_head: 'any' },
        'GREEN',
        { worktree: repo, candidateSha: repoSha, reservedEnvNames: new Set([ROOT_ENV]) },
      );
      expect(evidence.exit_code).toBe(0);
      expect(evidence.authority_materialization_result).toBe(AUTHORITY_STATUS.NOT_REQUIRED);
    } finally {
      delete process.env[ROOT_ENV];
    }
  });
});

describe('7 a candidate cannot override the authority environment', () => {
  it('denies a candidate command that binds a reserved capability name', () => {
    const unit = manifest();
    const evidence = runManifestCommand(
      unit,
      {
        id: 'green',
        command: process.execPath,
        args: SEES_AUTHORITY,
        required_head: 'any',
        env: { [ROOT_ENV]: join(scratch, 'candidate-controlled') },
      },
      'GREEN',
      { worktree: repo, candidateSha: repoSha, reservedEnvNames: new Set([ROOT_ENV]) },
    );

    expect(evidence.classification).toBe(RESULT.DENIED_GOVERNANCE);
    expect(evidence.environment_error).toContain(AUTHORITY_DENIAL.ENV_OVERRIDE_DENIED);
    expect(evidence.environment_error).toContain(ROOT_ENV);
    expect(evidence.exit_code).toBeNull();
  });

  it('denies a candidate command that binds the authority retrieval secret', () => {
    const unit = manifest();
    const evidence = runManifestCommand(
      unit,
      {
        id: 'green',
        command: process.execPath,
        args: SEES_AUTHORITY,
        required_head: 'any',
        env: { DEVGOV_AUTHORITY_TOKEN: 'stolen' },
      },
      'GREEN',
      { worktree: repo, candidateSha: repoSha, reservedEnvNames: new Set([ROOT_ENV]) },
    );
    expect(evidence.classification).toBe(RESULT.DENIED_GOVERNANCE);
    expect(evidence.environment_error).toContain('DEVGOV_AUTHORITY_TOKEN');
  });

  it('positive control: an unrelated candidate env key is not denied', () => {
    const unit = manifest();
    const evidence = runManifestCommand(
      unit,
      {
        id: 'green',
        command: process.execPath,
        args: SEES_AUTHORITY,
        required_head: 'any',
        authority_requirement: { id: AUTHORITY_ID },
        env: { UNRELATED_FIXTURE_FLAG: '1' },
      },
      'GREEN',
      {
        worktree: repo,
        candidateSha: repoSha,
        authority: verifiedAuthority(authorityRoot),
        reservedEnvNames: new Set([ROOT_ENV]),
      },
    );
    expect(evidence.classification).toBe(RESULT.PASS);
  });

  it('never leaks the retrieval secret into the proof environment', () => {
    const unit = manifest();
    process.env.DEVGOV_AUTHORITY_TOKEN = 'super-secret-token';
    try {
      const evidence = runManifestCommand(
        unit,
        {
          id: 'green',
          command: process.execPath,
          args: [
            '-e',
            'if (process.env.DEVGOV_AUTHORITY_TOKEN !== undefined) process.exit(41); process.exit(0);',
          ],
          required_head: 'any',
        },
        'GREEN',
        { worktree: repo, candidateSha: repoSha, reservedEnvNames: new Set([ROOT_ENV]) },
      );
      expect(evidence.exit_code).toBe(0);
    } finally {
      delete process.env.DEVGOV_AUTHORITY_TOKEN;
    }
  });
});

describe('14 an authority-bound proof cannot execute without verified authority', () => {
  it('refuses to run a proof that declares a requirement it was not granted', () => {
    const unit = manifest();
    expect(() =>
      runManifestCommand(unit, unit.required_green[0], 'GREEN', {
        worktree: repo,
        candidateSha: repoSha,
        authority: notRequired(),
      }),
    ).toThrow(/must not execute without verified authority/);
  });

  it('refuses to run a proof with a denied authority resolution', () => {
    const unit = manifest();
    expect(() =>
      runManifestCommand(unit, unit.required_green[0], 'GREEN', {
        worktree: repo,
        candidateSha: repoSha,
        authority: { ...notRequired(), status: AUTHORITY_STATUS.DENIED },
      }),
    ).toThrow(/denied authority capability must never reach proof execution/);
  });

  it('fails closed when the protected catalog is unavailable to a verifier', () => {
    const binding = expectedAuthorityBinding(manifest().required_green[0], {});
    expect(binding.ok).toBe(false);
    expect(binding.errors.join(' ')).toContain('protected authority catalog is required');
  });

  it('denies a unit definition whose candidate declares more than a capability id', () => {
    const errors = validateUnitDefinition(
      manifest({
        required_green: [
          {
            id: 'green',
            command: 'node',
            args: ['green.mjs'],
            authority_requirement: { id: AUTHORITY_ID, expected_digest: 'a'.repeat(64) },
          },
        ],
      }),
    );
    expect(errors.join(' ')).toContain('expected_digest');
  });
});

describe('the declared capability is part of the signed proof contract', () => {
  it('changing the requested capability id changes the proof contract hash', () => {
    const asked = manifest();
    const askedForSomethingElse = manifest({
      required_green: [
        {
          ...asked.required_green[0],
          authority_requirement: { id: 'DEVGOV-AUTHORITY-OTHER-V1' },
        },
      ],
    });
    const askedForNothing = manifest({
      required_green: [{ id: 'green', command: 'node', args: ['green.mjs'], required_head: 'any' }],
    });

    expect(proofContractHash(asked)).not.toBe(proofContractHash(askedForSomethingElse));
    expect(proofContractHash(asked)).not.toBe(proofContractHash(askedForNothing));
    expect(unitDefinitionHash(asked)).not.toBe(unitDefinitionHash(askedForNothing));
  });
});

describe('12 the execution record binds the exact authority identity', () => {
  it('carries the identity and a recomputable binding digest', () => {
    const unit = runnableManifest();
    const evidence = runManifestCommand(unit, unit.required_green[0], 'GREEN', {
      worktree: repo,
      candidateSha: repoSha,
      authority: verifiedAuthority(authorityRoot),
      reservedEnvNames: new Set([ROOT_ENV]),
    });
    const built = trustedExecutionRecord(unit, evidence, {
      runner_identity: runnerIdentity,
      controller_sha: controllerSha,
      workflow_ref: workflowRef,
      workflow_run_id: '100',
      workflow_run_attempt: '1',
    });

    expect(validateExecutionRecord(built)).toEqual([]);
    expect({
      authority_id: built.authority_id,
      authority_content_digest: built.authority_content_digest,
      authority_reference_digest: built.authority_reference_digest,
      authority_materialization_result: built.authority_materialization_result,
    }).toEqual({
      authority_id: AUTHORITY_ID,
      authority_content_digest: CONTENT_DIGEST,
      authority_reference_digest: REFERENCE_DIGEST,
      authority_materialization_result: 'VERIFIED_READ_ONLY',
    });
    expect(built.authority_binding_digest).toBe(authorityBindingDigest(built));

    // And the signer accepts it only against the protected catalog.
    expect(
      validateExecutionRecordForManifest(unit, built, 'GREEN', 'green', {
        candidateSha: repoSha,
        authorityCatalog: catalog,
      }),
    ).toEqual([]);
  });

  it('rejects a record whose authority identity does not match protected configuration', () => {
    const unit = manifest();
    const substituted = record(unit, {
      proof_type: 'GREEN',
      test_id: 'green',
      command: 'node green.mjs',
      exit_code: 0,
      classification: 'PASS',
      authority_id: AUTHORITY_ID,
      authority_content_digest: '9'.repeat(64),
      authority_reference_digest: REFERENCE_DIGEST,
      authority_materialization_result: 'VERIFIED_READ_ONLY',
    });
    const errors = validateExecutionRecordForManifest(unit, substituted, 'GREEN', 'green', {
      candidateSha: repoSha,
      authorityCatalog: catalog,
    });
    expect(errors).toContain('authority_content_digest mismatch');
    expect(errors).toContain('authority_binding_digest mismatch');
  });
});

describe('13 the gate independently rejects a substituted authority identity', () => {
  it('positive control: an untampered pair with the correct authority binding is PROVEN', () => {
    const { privateKey, publicKey } = keys();
    const unit = manifest();
    const result = evaluateTrustedExecutionGate(unit, signedPair(privateKey, unit), policy(publicKey), {
      candidateSha: repoSha,
      controllerSha,
      authorityCatalog: catalog,
    });
    expect(result).toEqual({ result: RESULT.PASS, proof_status: 'PROVEN', errors: [] });
  });

  it('denies a fully self-consistent forgery whose authority content digest was altered', () => {
    const { privateKey, publicKey } = keys();
    const unit = manifest();
    const [red, green] = signedPair(privateKey, unit);
    const replayed = forgeAuthority(green, privateKey, { authority_content_digest: '7'.repeat(64) });

    // The forgery survives signature, binding-digest and proof-id verification.
    expect(verifyExecutionAttestation(replayed, policy(publicKey))).toEqual({ valid: true, errors: [] });

    const result = evaluateTrustedExecutionGate(unit, [red, replayed], policy(publicKey), {
      candidateSha: repoSha,
      controllerSha,
      authorityCatalog: catalog,
    });
    expect(result.proof_status).toBe('NOT_PROVEN');
    expect(result.errors.join(' ')).toContain('authority_content_digest mismatch');
  });

  it('denies a self-consistent forgery that swaps the authority id', () => {
    const { privateKey, publicKey } = keys();
    const unit = manifest();
    const [red, green] = signedPair(privateKey, unit);
    const swapped = forgeAuthority(green, privateKey, { authority_id: 'DEVGOV-AUTHORITY-OTHER-V1' });
    expect(verifyExecutionAttestation(swapped, policy(publicKey)).valid).toBe(true);

    const result = evaluateTrustedExecutionGate(unit, [red, swapped], policy(publicKey), {
      candidateSha: repoSha,
      controllerSha,
      authorityCatalog: catalog,
    });
    expect(result.proof_status).toBe('NOT_PROVEN');
    expect(result.errors.join(' ')).toContain('authority_id mismatch');
  });

  it('denies a self-consistent authority downgrade to NOT_REQUIRED', () => {
    const { privateKey, publicKey } = keys();
    const unit = manifest();
    const [red, green] = signedPair(privateKey, unit);
    const downgraded = forgeAuthority(green, privateKey, {
      authority_id: '',
      authority_content_digest: '',
      authority_reference_digest: '',
      authority_materialization_result: 'NOT_REQUIRED',
    });
    expect(verifyExecutionAttestation(downgraded, policy(publicKey)).valid).toBe(true);

    const result = evaluateTrustedExecutionGate(unit, [red, downgraded], policy(publicKey), {
      candidateSha: repoSha,
      controllerSha,
      authorityCatalog: catalog,
    });
    expect(result.proof_status).toBe('NOT_PROVEN');
    expect(result.errors.join(' ')).toContain('authority_materialization_result mismatch');
  });

  it('denies a partial forgery that fails the signed proof-id binding first', () => {
    const { privateKey, publicKey } = keys();
    const unit = manifest();
    const [red, green] = signedPair(privateKey, unit);
    const partial = resign(green, privateKey, (payload) => {
      const changed = { ...payload, authority_content_digest: '7'.repeat(64) };
      return { ...changed, authority_binding_digest: authorityBindingDigest(changed) };
    });
    const result = evaluateTrustedExecutionGate(unit, [red, partial], policy(publicKey), {
      candidateSha: repoSha,
      controllerSha,
      authorityCatalog: catalog,
    });
    expect(result.proof_status).toBe('NOT_PROVEN');
    expect(result.errors.join(' ')).toContain('proof_id mismatch');
  });

  it('denies an unsigned tamper of the authority identity', () => {
    const { privateKey, publicKey } = keys();
    const unit = manifest();
    const [red, green] = signedPair(privateKey, unit);
    const tampered = { ...green, authority_content_digest: '5'.repeat(64) };
    const result = evaluateTrustedExecutionGate(unit, [red, tampered], policy(publicKey), {
      candidateSha: repoSha,
      controllerSha,
      authorityCatalog: catalog,
    });
    expect(result.proof_status).toBe('NOT_PROVEN');
    expect(result.errors.join(' ')).toContain('attestation signature verification failed');
  });

  it('fails closed when the gate has no protected catalog for an authority-bound proof', () => {
    const { privateKey, publicKey } = keys();
    const unit = manifest();
    const result = evaluateTrustedExecutionGate(unit, signedPair(privateKey, unit), policy(publicKey), {
      candidateSha: repoSha,
      controllerSha,
    });
    expect(result.proof_status).toBe('NOT_PROVEN');
    expect(result.errors.join(' ')).toContain('protected authority catalog is required');
  });
});
