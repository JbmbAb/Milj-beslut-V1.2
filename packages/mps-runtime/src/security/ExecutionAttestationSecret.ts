/**
 * W-U42 (U42a, point 4) -- the execution-outcome attestation secret, in ONE place.
 *
 * `SecurityRuntime.attestOutcome` signs `principal:alg:hash` with an HMAC signer. Until W-U42 the ONLY signer was a
 * built-in development secret hard-coded in SecurityRuntime, so every process (and everyone reading the source)
 * could produce the same attestation. Owner decision 2026-10-03 (5), BINDING: product runtime outside explicit dev
 * must NOT be able to start with that secret.
 *
 * This module is the single definition of:
 *  - the built-in development secret and its key id (used by SecurityRuntime as the default signer, and allowed in a
 *    process only when that process is an explicit development/test process -- decided by the start-up gate in
 *    server/modules/release/executionAttestationStartupGate.ts);
 *  - the environment variable that configures a process's OWN secret (MPS_EXECUTION_ATTESTATION_HMAC_SECRET), its
 *    minimum length, and the key id attestations carry when it is used;
 *  - the factory the LU kernel client uses to hand the configured signer to SecurityRuntime.
 *
 * An outcome attestation remains what it was: the producing process's own HMAC over the outcome hash, checked by the
 * same process at write time. Nothing here is an authority over the content, and no reader should present it as more.
 * A real execution signer (asymmetric, with its own lifecycle) is T1's A2 and replaces this later.
 */
import { createHmacSigningKeyProvider } from "./HmacSigningKeyProvider.js";
import type { SigningKeyProvider } from "./SecurityContracts.js";

export const EXECUTION_ATTESTATION_HMAC_SECRET_ENV = "MPS_EXECUTION_ATTESTATION_HMAC_SECRET" as const;
export const DEFAULT_DEV_EXECUTION_ATTESTATION_SECRET = "mps-execution-platform-default-dev-secret" as const;
export const DEFAULT_DEV_EXECUTION_ATTESTATION_KEY_ID = "hmac-execution-dev-v1" as const;
export const CONFIGURED_EXECUTION_ATTESTATION_KEY_ID = "hmac-execution-configured-v1" as const;
export const EXECUTION_ATTESTATION_SECRET_MIN_LENGTH = 32;
export const REJECT_EXECUTION_ATTESTATION_SECRET_INVALID = "REJECT_EXECUTION_ATTESTATION_SECRET_INVALID" as const;

/** The configured value is present but unusable. The message names the variable and the rule, never the value. */
export class ExecutionAttestationSecretInvalidError extends Error {
  readonly code = REJECT_EXECUTION_ATTESTATION_SECRET_INVALID;

  constructor(readonly reason: string) {
    super(`${REJECT_EXECUTION_ATTESTATION_SECRET_INVALID}: ${EXECUTION_ATTESTATION_HMAC_SECRET_ENV} ${reason}`);
    this.name = "ExecutionAttestationSecretInvalidError";
  }
}

export type ExecutionAttestationSecretState =
  | { readonly state: "absent" }
  | { readonly state: "invalid"; readonly reason: string }
  | { readonly state: "configured" };

/**
 * Classifies the configured secret. "Set" means present in the environment: an empty value counts as set (and is
 * invalid), the built-in development value is invalid wherever it is configured, and so is anything shorter than
 * EXECUTION_ATTESTATION_SECRET_MIN_LENGTH or padded with whitespace. Nothing is trimmed into validity.
 */
export function describeExecutionAttestationSecret(
  env: Readonly<Record<string, string | undefined>>,
): ExecutionAttestationSecretState {
  const raw = env[EXECUTION_ATTESTATION_HMAC_SECRET_ENV];
  if (raw === undefined) return { state: "absent" };
  if (raw.trim() === "") return { state: "invalid", reason: "is set but empty" };
  if (raw.trim() === DEFAULT_DEV_EXECUTION_ATTESTATION_SECRET) {
    return { state: "invalid", reason: "is the built-in development secret; a product process needs a secret of its own" };
  }
  if (raw !== raw.trim()) return { state: "invalid", reason: "has leading or trailing whitespace" };
  if (raw.length < EXECUTION_ATTESTATION_SECRET_MIN_LENGTH) {
    return { state: "invalid", reason: `is shorter than ${EXECUTION_ATTESTATION_SECRET_MIN_LENGTH} characters` };
  }
  return { state: "configured" };
}

/** The built-in development signer: SecurityRuntime's default when no signer is injected. */
export function createDefaultDevExecutionAttestationSigner(): SigningKeyProvider {
  return createHmacSigningKeyProvider(DEFAULT_DEV_EXECUTION_ATTESTATION_SECRET, DEFAULT_DEV_EXECUTION_ATTESTATION_KEY_ID);
}

/**
 * The process's configured signer: null when the variable is absent (the caller decides whether the development
 * default may be used -- the start-up gate does, per process), the signer when it is valid, and a typed error when it
 * is present but invalid (fail-closed: a misconfigured secret never silently falls back to the default).
 */
export function createConfiguredExecutionAttestationSigner(
  env: Readonly<Record<string, string | undefined>>,
): SigningKeyProvider | null {
  const described = describeExecutionAttestationSecret(env);
  if (described.state === "absent") return null;
  if (described.state === "invalid") throw new ExecutionAttestationSecretInvalidError(described.reason);
  return createHmacSigningKeyProvider(env[EXECUTION_ATTESTATION_HMAC_SECRET_ENV] as string, CONFIGURED_EXECUTION_ATTESTATION_KEY_ID);
}
