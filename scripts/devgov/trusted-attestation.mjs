import { Buffer } from 'node:buffer';
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign as signBytes,
  verify as verifyBytes,
} from 'node:crypto';

export const ATTESTATION_SCHEMA = 'dev-gov-v1-trusted-execution-attestation';
export const EXECUTION_RECORD_SCHEMA = 'dev-gov-v1-trusted-execution-record';
export const TRUST_POLICY_SCHEMA = 'dev-gov-v0-trust-policy';
export const ATTESTATION_VERSION = 'dev-gov-v1.0';

export function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function proofContract(unitDefinition) {
  return {
    schema_version: unitDefinition.schema_version,
    unit: unitDefinition.unit,
    role: unitDefinition.role,
    mode: unitDefinition.mode,
    branch: unitDefinition.branch,
    base_sha: unitDefinition.base_sha,
    ancestry_policy: unitDefinition.ancestry_policy,
    allowed_paths: unitDefinition.allowed_paths,
    forbidden_paths: unitDefinition.forbidden_paths,
    remote: unitDefinition.remote || null,
    required_red: unitDefinition.required_red || [],
    required_green: unitDefinition.required_green || [],
    trusted_execution: unitDefinition.trusted_execution || null,
  };
}

export function proofContractHash(unitDefinition) {
  return sha256(stableJson(proofContract(unitDefinition)));
}

export function executionResultDigest(record) {
  return sha256(
    stableJson({
      exit_code: record.exit_code,
      classification: record.classification,
      environment_error: record.environment_error || '',
      stdout_sha256: record.stdout_sha256,
      stderr_sha256: record.stderr_sha256,
    }),
  );
}

function requiredString(record, field, errors) {
  if (typeof record?.[field] !== 'string' || record[field].length === 0) {
    errors.push(`${field} is required`);
  }
}

export function validateExecutionRecord(record) {
  const errors = [];
  if (record?.schema_version !== EXECUTION_RECORD_SCHEMA) {
    errors.push(`schema_version must be ${EXECUTION_RECORD_SCHEMA}`);
  }
  for (const field of [
    'unit_id',
    'unit_definition_hash',
    'proof_contract_hash',
    'base_sha',
    'candidate_sha',
    'execution_sha',
    'proof_type',
    'test_id',
    'command',
    'started_at',
    'finished_at',
    'runner_identity',
    'controller_sha',
    'workflow_ref',
    'workflow_run_id',
    'workflow_run_attempt',
    'stdout_sha256',
    'stderr_sha256',
    'result_digest',
  ]) {
    requiredString(record, field, errors);
  }
  if (!['RED', 'GREEN'].includes(record?.proof_type)) errors.push('proof_type must be RED or GREEN');
  if (!['PASS', 'FAIL', 'BLOCKED_ENVIRONMENT', 'DENIED_GOVERNANCE'].includes(record?.classification)) {
    errors.push('classification is invalid');
  }
  if (record?.exit_code !== null && !Number.isInteger(record?.exit_code)) {
    errors.push('exit_code must be an integer or null');
  }
  if (record?.result_digest !== executionResultDigest(record)) errors.push('result_digest mismatch');
  return errors;
}

function proofId(record, signer) {
  return sha256(
    stableJson({
      issuer: signer.issuer,
      key_id: signer.key_id,
      unit_id: record.unit_id,
      unit_definition_hash: record.unit_definition_hash,
      candidate_sha: record.candidate_sha,
      proof_type: record.proof_type,
      test_id: record.test_id,
      execution_sha: record.execution_sha,
      workflow_run_id: record.workflow_run_id,
      workflow_run_attempt: record.workflow_run_attempt,
      result_digest: record.result_digest,
    }),
  );
}

function attestationPayload(record, signer) {
  const { schema_version: executionRecordSchemaVersion, ...executionRecordFields } = record;
  return {
    ...executionRecordFields,
    schema_version: ATTESTATION_SCHEMA,
    attestation_version: ATTESTATION_VERSION,
    execution_record_schema_version: executionRecordSchemaVersion,
    signature_algorithm: 'ed25519',
    issuer: signer.issuer,
    key_id: signer.key_id,
    proof_id: proofId(record, signer),
  };
}

export function signExecutionRecord(record, privateKeyPem, signer) {
  const errors = validateExecutionRecord(record);
  if (errors.length > 0) throw new Error(`invalid execution record: ${errors.join('; ')}`);
  if (!signer?.issuer || !signer?.key_id) throw new Error('issuer and key_id are required');
  const privateKey = createPrivateKey(privateKeyPem);
  if (privateKey.asymmetricKeyType !== 'ed25519') throw new Error('attestation key must be Ed25519');
  const payload = attestationPayload(record, signer);
  const signature = signBytes(null, Buffer.from(stableJson(payload)), privateKey).toString('base64');
  return { ...payload, signature };
}

export function validateTrustPolicy(policy) {
  const errors = [];
  if (policy?.schema_version !== TRUST_POLICY_SCHEMA) {
    errors.push(`schema_version must be ${TRUST_POLICY_SCHEMA}`);
  }
  if (!Array.isArray(policy?.trusted_issuers) || policy.trusted_issuers.length === 0) {
    errors.push('trusted_issuers must be a non-empty array');
  }
  if (policy?.authority?.type !== 'github-oidc-protected-environment') {
    errors.push('trust policy authority.type must be github-oidc-protected-environment');
  }
  for (const field of ['repository', 'workflow_ref', 'ref', 'environment', 'runner_environment']) {
    if (!policy?.authority?.[field]) errors.push(`trust policy authority.${field} is required`);
  }
  for (const issuer of policy?.trusted_issuers || []) {
    if (!issuer.issuer) errors.push('trusted issuer name is required');
    if (!issuer.key_id) errors.push('trusted issuer key_id is required');
    if (issuer.algorithm !== 'ed25519') errors.push('trusted issuer algorithm must be ed25519');
    if (!issuer.public_key_pem) errors.push('trusted issuer public_key_pem is required');
    if (!issuer.workflow_ref) errors.push('trusted issuer workflow_ref is required');
    if (!issuer.runner_identity) errors.push('trusted issuer runner_identity is required');
  }
  return errors;
}

export function verifyExecutionAttestation(attestation, trustPolicy) {
  const errors = validateTrustPolicy(trustPolicy);
  const { signature, ...payload } = attestation || {};
  const trustedIssuer = trustPolicy?.trusted_issuers?.find(
    (candidate) => candidate.issuer === payload.issuer && candidate.key_id === payload.key_id,
  );
  if (!trustedIssuer) errors.push('attestation issuer/key is not trusted');
  if (trustedIssuer && trustedIssuer.workflow_ref !== payload.workflow_ref) {
    errors.push('attestation workflow_ref is not trusted');
  }
  if (trustedIssuer && trustedIssuer.runner_identity !== payload.runner_identity) {
    errors.push('attestation runner_identity is not trusted');
  }
  if (!signature) errors.push('signature is required');
  if (trustedIssuer && signature) {
    try {
      const publicKey = createPublicKey(trustedIssuer.public_key_pem);
      if (publicKey.asymmetricKeyType !== 'ed25519') {
        errors.push('trusted attestation public key must be Ed25519');
      } else if (
        !verifyBytes(null, Buffer.from(stableJson(payload)), publicKey, Buffer.from(signature, 'base64'))
      ) {
        errors.push('attestation signature verification failed');
      }
    } catch (error) {
      errors.push(`attestation signature verification failed: ${error.message}`);
    }
  }

  const {
    schema_version: envelopeSchemaVersion,
    attestation_version: attestationVersion,
    execution_record_schema_version: executionRecordSchemaVersion,
    signature_algorithm: signatureAlgorithm,
    issuer: recordIssuer,
    key_id: recordKeyId,
    proof_id: recordProofId,
    ...executionRecordFields
  } = payload;
  if (envelopeSchemaVersion !== ATTESTATION_SCHEMA) {
    errors.push(`schema_version must be ${ATTESTATION_SCHEMA}`);
  }
  if (attestationVersion !== ATTESTATION_VERSION) {
    errors.push(`attestation_version must be ${ATTESTATION_VERSION}`);
  }
  if (signatureAlgorithm !== 'ed25519') {
    errors.push('signature_algorithm must be ed25519');
  }

  const executionRecord = {
    schema_version: executionRecordSchemaVersion,
    ...executionRecordFields,
  };
  errors.push(...validateExecutionRecord(executionRecord));
  if (recordProofId !== proofId(executionRecord, { issuer: recordIssuer, key_id: recordKeyId })) {
    errors.push('proof_id mismatch');
  }
  return { valid: errors.length === 0, errors };
}
