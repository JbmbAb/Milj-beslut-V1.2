import {
  CONFIGURED_EXECUTION_ATTESTATION_KEY_ID,
  DEFAULT_DEV_EXECUTION_ATTESTATION_KEY_ID,
  EXECUTION_ATTESTATION_HMAC_SECRET_ENV,
  EXECUTION_ATTESTATION_SECRET_MIN_LENGTH,
  REJECT_EXECUTION_ATTESTATION_SECRET_INVALID,
  describeExecutionAttestationSecret,
} from '@miljobeslut/mps-runtime';
import { EXPLICIT_PROCESS_RULE_TEXT, isExplicitDevelopmentOrTestProcess } from './processClassification';

/**
 * W-U42 (U42a, point 4) -- the process start-up gate for the execution-outcome attestation secret.
 *
 * Owner decision 2026-10-03 night (5), BINDING: product runtime outside explicit dev must NOT be able to start
 * with the built-in development secret (DEFAULT_DEV_EXECUTION_ATTESTATION_SECRET, defined once in mps-runtime).
 * T1-ATTESTATION-REQUIREMENTS §3.4 (A0): refuse the start without a signer/key configuration; the built-in default
 * only in an explicit test/dev process.
 *
 * Decision, per process, before anything listens:
 *  - MPS_EXECUTION_ATTESTATION_HMAC_SECRET configured and valid -> the process signs with its own secret
 *    (the LU kernel client hands that signer to SecurityRuntime; key id hmac-execution-configured-v1);
 *  - configured but invalid (empty, the built-in value, too short, padded) -> refuses, in every process;
 *  - absent in an EXPLICIT development/test process (NODE_ENV and APP_ENV both set exactly, processClassification.ts)
 *    -> the built-in development signer is allowed, and the start-up line says so;
 *  - absent anywhere else -> refuses (REJECT_EXECUTION_ATTESTATION_DEFAULT_SECRET_OUTSIDE_DEV).
 *
 * Only the web process constructs SecurityRuntime (through the LU kernel client), so the gate is wired there
 * (server/index.ts); the LU workers never sign outcome attestations. The name "attestation" is the platform's
 * existing term for the producing process's own HMAC over an outcome hash -- it is not an authority over content.
 */

export const REJECT_EXECUTION_ATTESTATION_DEFAULT_SECRET_OUTSIDE_DEV = 'REJECT_EXECUTION_ATTESTATION_DEFAULT_SECRET_OUTSIDE_DEV' as const;

export type ExecutionAttestationSecretErrorCode =
  | typeof REJECT_EXECUTION_ATTESTATION_DEFAULT_SECRET_OUTSIDE_DEV
  | typeof REJECT_EXECUTION_ATTESTATION_SECRET_INVALID;

export class ExecutionAttestationSecretError extends Error {
  constructor(
    readonly code: ExecutionAttestationSecretErrorCode,
    detail: string,
  ) {
    super(`${code}: ${detail}`);
    this.name = 'ExecutionAttestationSecretError';
  }
}

export type ExecutionAttestationSignerDecision =
  | { readonly signer: 'configured'; readonly key_id: typeof CONFIGURED_EXECUTION_ATTESTATION_KEY_ID }
  | { readonly signer: 'default-dev'; readonly key_id: typeof DEFAULT_DEV_EXECUTION_ATTESTATION_KEY_ID };

export function assertExecutionAttestationSecretAtStartup(
  env: Readonly<Record<string, string | undefined>>,
  role: string,
): ExecutionAttestationSignerDecision {
  const described = describeExecutionAttestationSecret(env);
  if (described.state === 'configured') return { signer: 'configured', key_id: CONFIGURED_EXECUTION_ATTESTATION_KEY_ID };
  if (described.state === 'invalid') {
    throw new ExecutionAttestationSecretError(
      REJECT_EXECUTION_ATTESTATION_SECRET_INVALID,
      `${EXECUTION_ATTESTATION_HMAC_SECRET_ENV} ${described.reason}; the ${role} process refuses to start`,
    );
  }
  if (isExplicitDevelopmentOrTestProcess(env)) return { signer: 'default-dev', key_id: DEFAULT_DEV_EXECUTION_ATTESTATION_KEY_ID };
  throw new ExecutionAttestationSecretError(
    REJECT_EXECUTION_ATTESTATION_DEFAULT_SECRET_OUTSIDE_DEV,
    `${EXECUTION_ATTESTATION_HMAC_SECRET_ENV} is not set and this ${role} process is not an explicit development or test process ` +
      `(${EXPLICIT_PROCESS_RULE_TEXT}); outside those the execution-outcome attestation must not be signed with the built-in ` +
      `development secret. Configure ${EXECUTION_ATTESTATION_HMAC_SECRET_ENV} (at least ${EXECUTION_ATTESTATION_SECRET_MIN_LENGTH} characters, ` +
      `not the built-in value) or start an explicit development/test process.`,
  );
}
