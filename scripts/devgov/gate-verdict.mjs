import { Buffer } from 'node:buffer';
import { createPrivateKey, createPublicKey, sign as signBytes, verify as verifyBytes } from 'node:crypto';

import { DEVGOV_GATE_AUDIENCE, PINNED_VERIFIER_AUTHORITY } from './github-oidc.mjs';
import {
  ATTESTATION_SCHEMA,
  proofContractHash,
  sha256,
  stableJson,
  validateTrustPolicy,
  verifyExecutionAttestation,
} from './trusted-attestation.mjs';

/**
 * DEV-GOV-V1 GATE VERDICT — the authoritative statement that the protected
 * evidence gate accepted a candidate.
 *
 * This module exists because nothing DEV-GOV emitted before it carried the
 * gate's own verdict in a signed, structurally bound object. Execution
 * attestations (`dev-gov-v1-trusted-execution-attestation`) attest that ONE
 * declared RED or GREEN command ran with an observed classification; the
 * gate's PASS otherwise existed only as a commit status, a run conclusion and
 * a log line — none of which a consumer may treat as authority.
 *
 * Domain separation is deliberate and enforced in both directions:
 *
 *   - a verdict is signed by a DEDICATED gate-verdict key, never by the
 *     execution-attestation key; the trusted-signer entry a verifier holds
 *     must declare `purpose: dev-gov-v1-gate-verdict`, so an attestation
 *     trust-policy issuer can never be mistaken for a verdict signer;
 *   - `schema_version` is inside the signed bytes and is checked BEFORE any
 *     other field on both sides, so attestation bytes never parse as a verdict
 *     and verdict bytes never parse as an attestation.
 *
 * Canonical bytes are `stableJson(payload)`: same payload, same bytes. The
 * verdict identity (`verdict_id`) is a digest over the binding tuple only —
 * it does not depend on `issued_at`, on the signature, or on any mutable
 * GitHub metadata — so a byte-identical copy preserved elsewhere (a durable
 * content-addressed store) keeps the same identity and the same signature
 * without ever being re-signed.
 */

export const GATE_VERDICT_SCHEMA = 'dev-gov-v1-gate-verdict';
export const GATE_VERDICT_VERSION = 'dev-gov-v1.0';
export const GATE_VERDICT_RESULT = 'PASS';
export const GATE_VERDICT_PROOF_STATUS = 'PROVEN';

/**
 * Opaque controller dispatch binding. DEV-GOV embeds it verbatim and never
 * interprets it; the controller that supplied it compares the signed value
 * against its own exact expectation. Only the shape is checked here.
 */
export const CONTROLLER_DISPATCH_BINDING_PATTERN = /^[A-Za-z0-9._:-]{1,200}$/;

const SHA_PATTERN = /^[0-9a-f]{40}$/;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/;
const RUN_ID_PATTERN = /^[0-9]+$/;

const OIDC_PROVENANCE_FIELDS = Object.freeze([
  'issuer',
  'audience',
  'repository',
  'workflow_ref',
  'ref',
  'environment',
  'runner_environment',
  'run_id',
  'run_attempt',
  'jti',
]);

/** Every field that must be a non-empty string in a canonical verdict payload. */
export const GATE_VERDICT_REQUIRED_STRING_FIELDS = Object.freeze([
  'schema_version',
  'verdict_version',
  'signature_algorithm',
  'issuer',
  'key_id',
  'verdict_id',
  'unit_id',
  'unit_definition_path',
  'unit_definition_hash',
  'proof_contract_hash',
  'base_sha',
  'candidate_sha',
  'controller_sha',
  'controller_dispatch_binding',
  'gate_workflow_ref',
  'gate_run_id',
  'gate_run_attempt',
  'orchestration_run_id',
  'attestation_workflow_ref',
  'result',
  'proof_status',
  'trust_policy_sha256',
  'issued_at',
]);

/** Fields excluded from the verdict identity: identity, signature and issuance time. */
const VERDICT_ID_EXCLUDED_FIELDS = new Set(['verdict_id', 'signature', 'issued_at']);

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function sortedUnique(values) {
  return [...new Set(values)].sort();
}

function isSortedUniqueStringArray(value) {
  if (!Array.isArray(value) || value.length === 0) return false;
  if (!value.every(isNonEmptyString)) return false;
  return stableJson(value) === stableJson(sortedUnique(value));
}

/** Digest over the binding tuple. Same tuple, same identity. */
export function gateVerdictId(payload) {
  const tuple = {};
  for (const key of Object.keys(payload || {}).sort()) {
    if (VERDICT_ID_EXCLUDED_FIELDS.has(key)) continue;
    tuple[key] = payload[key];
  }
  return sha256(stableJson(tuple));
}

/**
 * Structural validation of an (unsigned or signed) verdict payload. The
 * schema check comes first and is terminal: bytes that are not a gate verdict
 * are refused before any other field is read as one.
 */
export function validateGateVerdictPayload(payload) {
  const errors = [];
  if (!isPlainObject(payload)) return ['gate verdict payload must be an object'];
  if (payload.schema_version !== GATE_VERDICT_SCHEMA) {
    return [`schema_version must be ${GATE_VERDICT_SCHEMA}`];
  }
  if (payload.verdict_version !== GATE_VERDICT_VERSION) {
    errors.push(`verdict_version must be ${GATE_VERDICT_VERSION}`);
  }
  if (payload.signature_algorithm !== 'ed25519') errors.push('signature_algorithm must be ed25519');
  for (const field of GATE_VERDICT_REQUIRED_STRING_FIELDS) {
    if (!isNonEmptyString(payload[field])) errors.push(`${field} is required`);
  }
  for (const field of ['base_sha', 'candidate_sha', 'controller_sha']) {
    if (isNonEmptyString(payload[field]) && !SHA_PATTERN.test(payload[field])) {
      errors.push(`${field} must be a full 40-character lowercase Git SHA`);
    }
  }
  for (const field of ['unit_definition_hash', 'proof_contract_hash', 'trust_policy_sha256', 'verdict_id']) {
    if (isNonEmptyString(payload[field]) && !DIGEST_PATTERN.test(payload[field])) {
      errors.push(`${field} must be a sha256 hex digest`);
    }
  }
  for (const field of ['gate_run_id', 'gate_run_attempt', 'orchestration_run_id']) {
    if (isNonEmptyString(payload[field]) && !RUN_ID_PATTERN.test(payload[field])) {
      errors.push(`${field} must be numeric`);
    }
  }
  if (
    isNonEmptyString(payload.controller_dispatch_binding) &&
    !CONTROLLER_DISPATCH_BINDING_PATTERN.test(payload.controller_dispatch_binding)
  ) {
    errors.push('controller_dispatch_binding is malformed');
  }
  if (payload.result !== GATE_VERDICT_RESULT) errors.push(`result must be ${GATE_VERDICT_RESULT}`);
  if (payload.proof_status !== GATE_VERDICT_PROOF_STATUS) {
    errors.push(`proof_status must be ${GATE_VERDICT_PROOF_STATUS}`);
  }
  if (!isSortedUniqueStringArray(payload.attestation_proof_ids)) {
    errors.push('attestation_proof_ids must be a non-empty sorted array of unique proof ids');
  }
  if (!isSortedUniqueStringArray(payload.orchestration_run_attempts)) {
    errors.push('orchestration_run_attempts must be a non-empty sorted array of unique run attempts');
  } else if (!payload.orchestration_run_attempts.every((value) => RUN_ID_PATTERN.test(value))) {
    errors.push('orchestration_run_attempts must be numeric');
  }
  if (!isPlainObject(payload.oidc_provenance)) {
    errors.push('oidc_provenance is required');
  } else {
    for (const field of OIDC_PROVENANCE_FIELDS) {
      if (!isNonEmptyString(payload.oidc_provenance[field])) {
        errors.push(`oidc_provenance.${field} is required`);
      }
    }
    if (
      isNonEmptyString(payload.oidc_provenance.workflow_ref) &&
      isNonEmptyString(payload.gate_workflow_ref) &&
      payload.oidc_provenance.workflow_ref !== payload.gate_workflow_ref
    ) {
      errors.push('gate_workflow_ref does not match oidc_provenance.workflow_ref');
    }
    if (
      isNonEmptyString(payload.oidc_provenance.run_id) &&
      isNonEmptyString(payload.gate_run_id) &&
      payload.oidc_provenance.run_id !== payload.gate_run_id
    ) {
      errors.push('gate_run_id does not match oidc_provenance.run_id');
    }
    if (
      isNonEmptyString(payload.oidc_provenance.run_attempt) &&
      isNonEmptyString(payload.gate_run_attempt) &&
      payload.oidc_provenance.run_attempt !== payload.gate_run_attempt
    ) {
      errors.push('gate_run_attempt does not match oidc_provenance.run_attempt');
    }
  }
  if (isNonEmptyString(payload.gate_run_id) && isNonEmptyString(payload.orchestration_run_id)) {
    if (payload.gate_run_id === payload.orchestration_run_id) {
      errors.push('gate_run_id and orchestration_run_id must be distinct runs');
    }
  }
  if (
    isNonEmptyString(payload.attestation_workflow_ref) &&
    isNonEmptyString(payload.gate_workflow_ref) &&
    payload.attestation_workflow_ref === payload.gate_workflow_ref
  ) {
    errors.push('attestation_workflow_ref must not be the gate workflow');
  }
  if (isNonEmptyString(payload.issued_at) && Number.isNaN(Date.parse(payload.issued_at))) {
    errors.push('issued_at must be an ISO-8601 timestamp');
  }
  if (payload.signature !== undefined && !isNonEmptyString(payload.signature)) {
    errors.push('signature must be a non-empty string when present');
  }
  return errors;
}

/**
 * Sign a canonical verdict payload with the DEDICATED gate-verdict key.
 * `signer` supplies issuer/key_id; the payload's identity is recomputed here
 * so a caller can never present a payload whose verdict_id disagrees with
 * the bytes that get signed.
 */
export function signGateVerdict(payload, privateKeyPem, signer) {
  if (!signer?.issuer || !signer?.key_id) throw new Error('gate verdict issuer and key_id are required');
  if (!isNonEmptyString(privateKeyPem)) throw new Error('gate verdict private key is required');
  const privateKey = createPrivateKey(privateKeyPem);
  if (privateKey.asymmetricKeyType !== 'ed25519') throw new Error('gate verdict key must be Ed25519');
  const { signature: _ignoredSignature, verdict_id: _ignoredId, ...fields } = payload || {};
  const unsigned = {
    ...fields,
    schema_version: GATE_VERDICT_SCHEMA,
    verdict_version: GATE_VERDICT_VERSION,
    signature_algorithm: 'ed25519',
    issuer: signer.issuer,
    key_id: signer.key_id,
  };
  const withId = { ...unsigned, verdict_id: gateVerdictId(unsigned) };
  const errors = validateGateVerdictPayload(withId);
  if (errors.length > 0) throw new Error(`invalid gate verdict payload: ${errors.join('; ')}`);
  const signature = signBytes(null, Buffer.from(stableJson(withId)), privateKey).toString('base64');
  return { ...withId, signature };
}

/**
 * The verifier-side list of signers whose verdicts are accepted. This is NOT
 * the attestation trust policy and cannot be derived from it: every entry
 * must declare its purpose, its own key, and the exact gate workflow ref it
 * is allowed to speak for.
 */
export function validateGateVerdictTrustedSigners(signers) {
  const errors = [];
  if (!Array.isArray(signers) || signers.length === 0) {
    return ['trusted gate verdict signers must be a non-empty array'];
  }
  signers.forEach((signer, index) => {
    const prefix = `trusted gate verdict signer ${index}`;
    if (!isPlainObject(signer)) {
      errors.push(`${prefix} must be an object`);
      return;
    }
    if (signer.purpose !== GATE_VERDICT_SCHEMA)
      errors.push(`${prefix} purpose must be ${GATE_VERDICT_SCHEMA}`);
    if (!isNonEmptyString(signer.issuer)) errors.push(`${prefix} issuer is required`);
    if (!isNonEmptyString(signer.key_id)) errors.push(`${prefix} key_id is required`);
    if (signer.algorithm !== 'ed25519') errors.push(`${prefix} algorithm must be ed25519`);
    if (!isNonEmptyString(signer.public_key_pem)) errors.push(`${prefix} public_key_pem is required`);
    if (!isNonEmptyString(signer.gate_workflow_ref)) errors.push(`${prefix} gate_workflow_ref is required`);
  });
  return errors;
}

/**
 * Verify a signed gate verdict against the trusted gate-verdict signers.
 * Order matters and is fail-closed at every step: schema first, then the
 * signer lookup (an unknown issuer/key_id is a denial, never a fallback),
 * then the Ed25519 signature over the canonical bytes, then structure, then
 * the signer's pinned gate workflow ref, then identity recomputation.
 */
export function verifyGateVerdict(verdict, trustedSigners) {
  const errors = [];
  if (!isPlainObject(verdict)) return { valid: false, errors: ['gate verdict must be an object'] };
  if (verdict.schema_version !== GATE_VERDICT_SCHEMA) {
    return { valid: false, errors: [`schema_version must be ${GATE_VERDICT_SCHEMA}`] };
  }
  const signerErrors = validateGateVerdictTrustedSigners(trustedSigners);
  if (signerErrors.length > 0) return { valid: false, errors: signerErrors };

  const { signature, ...payload } = verdict;
  const trustedSigner = trustedSigners.find(
    (candidate) => candidate.issuer === payload.issuer && candidate.key_id === payload.key_id,
  );
  if (!trustedSigner) errors.push('gate verdict issuer/key is not trusted');
  if (!isNonEmptyString(signature)) errors.push('signature is required');
  if (trustedSigner && isNonEmptyString(signature)) {
    try {
      const publicKey = createPublicKey(trustedSigner.public_key_pem);
      if (publicKey.asymmetricKeyType !== 'ed25519') {
        errors.push('trusted gate verdict public key must be Ed25519');
      } else if (
        !verifyBytes(null, Buffer.from(stableJson(payload)), publicKey, Buffer.from(signature, 'base64'))
      ) {
        errors.push('gate verdict signature verification failed');
      }
    } catch (error) {
      errors.push(`gate verdict signature verification failed: ${error.message}`);
    }
  }
  errors.push(...validateGateVerdictPayload(payload));
  if (trustedSigner && trustedSigner.gate_workflow_ref !== payload.gate_workflow_ref) {
    errors.push('gate verdict workflow_ref is not trusted for this signer');
  }
  if (isNonEmptyString(payload.verdict_id) && payload.verdict_id !== gateVerdictId(payload)) {
    errors.push('verdict_id mismatch');
  }
  return { valid: errors.length === 0, errors };
}

export const GATE_VERDICT_REASON = Object.freeze({
  SIGNER_UNAVAILABLE: 'GATE_VERDICT_SIGNER_UNAVAILABLE',
  RESULT_NOT_PASS: 'GATE_VERDICT_RESULT_NOT_PASS',
  BINDING_DENIED: 'GATE_VERDICT_BINDING_DENIED',
});

function audienceMatches(actual, expected) {
  return Array.isArray(actual) ? actual.includes(expected) : actual === expected;
}

/**
 * Produce a signed gate verdict — the single authority-creation point of
 * DEV-GOV. Pure: no I/O, no process state. Every condition below is
 * independently re-checked here even when the caller already established it,
 * so the verdict cannot be produced from a forged gate envelope, from
 * attestations that were never trust-verified, or for a run other than the
 * one whose attestations were consumed.
 *
 * Returns `{ ok: true, verdict }` or `{ ok: false, reason_code, errors }`.
 * There is no third outcome and no partial verdict.
 */
export function produceGateVerdict(input) {
  const {
    unitDefinition,
    unitDefinitionPath,
    candidateSha,
    controllerSha,
    attestations,
    trustRoot,
    gate,
    runtime = {},
    signer = {},
    now = () => new Date(),
  } = input || {};

  // The gate result is examined first: a verdict is never even considered
  // for anything but an authoritative PASS, regardless of signer state.
  const resultErrors = [];
  if (!isPlainObject(gate)) resultErrors.push('gate evaluation result is required');
  else {
    if (gate.result !== GATE_VERDICT_RESULT) resultErrors.push(`gate result is ${gate.result}, not PASS`);
    if (gate.classification !== GATE_VERDICT_RESULT) {
      resultErrors.push(`gate classification is ${gate.classification}, not PASS`);
    }
    if (gate.reason_code !== 'PASS') resultErrors.push(`gate reason_code is ${gate.reason_code}, not PASS`);
    if (gate.proof_status !== GATE_VERDICT_PROOF_STATUS) {
      resultErrors.push(`gate proof_status is ${gate.proof_status}, not PROVEN`);
    }
    if (Array.isArray(gate.errors) && gate.errors.length > 0) {
      resultErrors.push('gate evaluation reported errors');
    }
  }
  if (resultErrors.length > 0) {
    return { ok: false, reason_code: GATE_VERDICT_REASON.RESULT_NOT_PASS, errors: resultErrors };
  }

  if (
    !isNonEmptyString(signer.privateKeyPem) ||
    !isNonEmptyString(signer.issuer) ||
    !isNonEmptyString(signer.keyId)
  ) {
    return {
      ok: false,
      reason_code: GATE_VERDICT_REASON.SIGNER_UNAVAILABLE,
      errors: ['dedicated gate verdict signer (private key, issuer, key_id) is required'],
    };
  }

  const errors = [];

  // Trust root: the verifier-owned policy proven by the gate's own OIDC token.
  if (!isPlainObject(trustRoot) || trustRoot.valid !== true) errors.push('verified trust root is required');
  const policy = trustRoot?.policy;
  if (policy) errors.push(...validateTrustPolicy(policy));
  else errors.push('trust root policy is required');
  const claims = trustRoot?.oidc_claims;
  if (!isPlainObject(claims)) errors.push('trust root OIDC claims are required');
  if (
    !isNonEmptyString(trustRoot?.trust_policy_sha256) ||
    !DIGEST_PATTERN.test(trustRoot.trust_policy_sha256)
  ) {
    errors.push('trust root policy digest is required');
  }

  // Unit identity, recomputed from the provenance-verified definition.
  if (!isPlainObject(unitDefinition) || !isNonEmptyString(unitDefinition.unit)) {
    errors.push('unit definition is required');
  }
  if (!isNonEmptyString(unitDefinitionPath)) errors.push('unit definition path is required');
  if (!SHA_PATTERN.test(candidateSha || ''))
    errors.push('candidate_sha must be a full 40-character lowercase Git SHA');
  if (!SHA_PATTERN.test(controllerSha || ''))
    errors.push('controller_sha must be a full 40-character lowercase Git SHA');
  if (errors.length > 0) return { ok: false, reason_code: GATE_VERDICT_REASON.BINDING_DENIED, errors };

  const definitionHash = sha256(stableJson(unitDefinition));
  const contractHash = proofContractHash(unitDefinition);

  // Controller dispatch binding: opaque, mandatory, shape-checked only.
  const binding = runtime.controllerDispatchBinding;
  if (!isNonEmptyString(binding)) errors.push('controller_dispatch_binding is required');
  else if (!CONTROLLER_DISPATCH_BINDING_PATTERN.test(binding)) {
    errors.push('controller_dispatch_binding is malformed');
  }

  // Run binding: the orchestration run whose attestations were consumed.
  const orchestrationRunId = runtime.attestationRunId;
  if (!isNonEmptyString(orchestrationRunId) || !RUN_ID_PATTERN.test(orchestrationRunId)) {
    errors.push('orchestration run id (attestation_run_id) must be numeric');
  }

  // Gate identity: the real gate job workflow ref and run, asserted against
  // the OIDC claims the trust root was proven with and against the pinned
  // verifier authority.
  const gateWorkflowRef = runtime.gateWorkflowRef;
  if (!isNonEmptyString(gateWorkflowRef)) errors.push('gate workflow_ref is required');
  else {
    if (gateWorkflowRef !== claims.workflow_ref)
      errors.push('gate workflow_ref does not match OIDC workflow_ref');
    if (gateWorkflowRef !== PINNED_VERIFIER_AUTHORITY.workflow_ref) {
      errors.push('gate workflow_ref is not the pinned verifier authority');
    }
  }
  const gateRunId = runtime.gateRunId;
  const gateRunAttempt = runtime.gateRunAttempt;
  if (!isNonEmptyString(gateRunId) || !RUN_ID_PATTERN.test(gateRunId))
    errors.push('gate run id must be numeric');
  else if (String(claims.run_id) !== gateRunId) errors.push('gate run id does not match OIDC run_id');
  if (!isNonEmptyString(gateRunAttempt) || !RUN_ID_PATTERN.test(gateRunAttempt)) {
    errors.push('gate run attempt must be numeric');
  } else if (String(claims.run_attempt) !== gateRunAttempt) {
    errors.push('gate run attempt does not match OIDC run_attempt');
  }
  if (
    isNonEmptyString(gateRunId) &&
    isNonEmptyString(orchestrationRunId) &&
    gateRunId === orchestrationRunId
  ) {
    errors.push('gate run id must differ from the orchestration run id');
  }
  // Same formula as trustPolicyAudience(rawPolicy, candidateSha), expressed
  // over the digest the trust root already verified the token against.
  const expectedAudience = `${DEVGOV_GATE_AUDIENCE}:${trustRoot.trust_policy_sha256}:${candidateSha}`;
  if (!audienceMatches(claims.aud, expectedAudience)) {
    errors.push('OIDC audience does not bind the verified trust policy digest and candidate SHA');
  }
  if (!isNonEmptyString(claims.jti)) errors.push('OIDC jti claim is required');

  // Consumed attestations: each independently re-verified against the trust
  // root and bound to the same unit, candidate, controller and orchestration
  // run. The gate's own evaluation already did this; a verdict never relies
  // on the caller having done it.
  if (!Array.isArray(attestations) || attestations.length === 0) {
    errors.push('at least one consumed execution attestation is required');
  } else {
    attestations.forEach((attestation, index) => {
      const prefix = `attestation ${index}`;
      if (attestation?.schema_version !== ATTESTATION_SCHEMA) {
        errors.push(`${prefix} is not an execution attestation`);
        return;
      }
      const verification = verifyExecutionAttestation(attestation, policy);
      if (!verification.valid)
        errors.push(`${prefix} failed trust verification: ${verification.errors.join('; ')}`);
      if (attestation.unit_id !== unitDefinition.unit) errors.push(`${prefix} unit_id mismatch`);
      if (attestation.unit_definition_hash !== definitionHash)
        errors.push(`${prefix} unit_definition_hash mismatch`);
      if (attestation.proof_contract_hash !== contractHash)
        errors.push(`${prefix} proof_contract_hash mismatch`);
      if (attestation.base_sha !== unitDefinition.base_sha) errors.push(`${prefix} base_sha mismatch`);
      if (attestation.candidate_sha !== candidateSha) errors.push(`${prefix} candidate_sha mismatch`);
      if (attestation.controller_sha !== controllerSha) errors.push(`${prefix} controller_sha mismatch`);
      if (attestation.workflow_run_id !== orchestrationRunId) {
        errors.push(`${prefix} workflow_run_id does not match the orchestration run`);
      }
      if (attestation.workflow_ref === gateWorkflowRef) {
        errors.push(`${prefix} claims the gate workflow identity`);
      }
    });
    const workflowRefs = sortedUnique(attestations.map((attestation) => attestation?.workflow_ref));
    if (workflowRefs.length !== 1 || !isNonEmptyString(workflowRefs[0])) {
      errors.push('consumed attestations must share one trusted attestation workflow_ref');
    }
    const proofIds = attestations.map((attestation) => attestation?.proof_id);
    if (!proofIds.every(isNonEmptyString) || new Set(proofIds).size !== proofIds.length) {
      errors.push('consumed attestations must carry unique proof ids');
    }
  }

  if (errors.length > 0) return { ok: false, reason_code: GATE_VERDICT_REASON.BINDING_DENIED, errors };

  const payload = {
    schema_version: GATE_VERDICT_SCHEMA,
    verdict_version: GATE_VERDICT_VERSION,
    signature_algorithm: 'ed25519',
    unit_id: unitDefinition.unit,
    unit_definition_path: unitDefinitionPath,
    unit_definition_hash: definitionHash,
    proof_contract_hash: contractHash,
    base_sha: unitDefinition.base_sha,
    candidate_sha: candidateSha,
    controller_sha: controllerSha,
    controller_dispatch_binding: binding,
    gate_workflow_ref: gateWorkflowRef,
    gate_run_id: gateRunId,
    gate_run_attempt: gateRunAttempt,
    orchestration_run_id: orchestrationRunId,
    orchestration_run_attempts: sortedUnique(
      attestations.map((attestation) => attestation.workflow_run_attempt),
    ),
    attestation_workflow_ref: attestations[0].workflow_ref,
    attestation_proof_ids: sortedUnique(attestations.map((attestation) => attestation.proof_id)),
    result: GATE_VERDICT_RESULT,
    proof_status: GATE_VERDICT_PROOF_STATUS,
    trust_policy_sha256: trustRoot.trust_policy_sha256,
    oidc_provenance: {
      issuer: String(claims.iss),
      audience: expectedAudience,
      repository: String(claims.repository),
      workflow_ref: String(claims.workflow_ref),
      ref: String(claims.ref),
      environment: String(claims.environment),
      runner_environment: String(claims.runner_environment),
      run_id: String(claims.run_id),
      run_attempt: String(claims.run_attempt),
      jti: String(claims.jti),
    },
    issued_at: now().toISOString(),
  };

  // Embed-then-recompare: the binding inside the payload about to be signed
  // must be the exact bytes the gate received.
  if (payload.controller_dispatch_binding !== runtime.controllerDispatchBinding) {
    return {
      ok: false,
      reason_code: GATE_VERDICT_REASON.BINDING_DENIED,
      errors: ['controller_dispatch_binding changed between receipt and signing'],
    };
  }

  let verdict;
  try {
    verdict = signGateVerdict(payload, signer.privateKeyPem, { issuer: signer.issuer, key_id: signer.keyId });
  } catch (error) {
    return {
      ok: false,
      reason_code: GATE_VERDICT_REASON.SIGNER_UNAVAILABLE,
      errors: [error instanceof Error ? error.message : String(error)],
    };
  }

  // Post-condition: the verdict verifies under its own public key and the
  // gate identity it claims. A verdict that cannot be verified is not issued.
  const publicKeyPem = createPublicKey(createPrivateKey(signer.privateKeyPem))
    .export({ type: 'spki', format: 'pem' })
    .toString();
  const selfCheck = verifyGateVerdict(verdict, [
    {
      purpose: GATE_VERDICT_SCHEMA,
      issuer: signer.issuer,
      key_id: signer.keyId,
      algorithm: 'ed25519',
      public_key_pem: publicKeyPem,
      gate_workflow_ref: gateWorkflowRef,
    },
  ]);
  if (!selfCheck.valid) {
    return { ok: false, reason_code: GATE_VERDICT_REASON.BINDING_DENIED, errors: selfCheck.errors };
  }
  return { ok: true, verdict };
}
