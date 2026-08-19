import { LocalPemVerificationKeyProvider, type VerificationKeyProvider } from '@miljobeslut/mimers-brunn-core';

/**
 * PROD-LU-ADMISSION-02B — LU admission-side consumer boundary.
 *
 * Reads ONLY the public key env var (`LU_EXECUTION_AUTHORITY_PUBLIC_KEY_PEM`). This file must
 * never import server/security/luExecutionAuthoritySigningKey.ts or reference
 * LU_EXECUTION_AUTHORITY_PRIVATE_KEY_PEM -- that is the entire point. The return type is
 * `VerificationKeyProvider`, which has no `sign` method at all (LocalPemVerificationKeyProvider
 * holds no private key material to sign with, by construction, not by refusing at runtime), so
 * the LU admission path is structurally unable to mint what it verifies, not merely convention-
 * bound not to.
 */
const REQUIRED_ENV_VARS = ['LU_EXECUTION_AUTHORITY_PUBLIC_KEY_PEM'] as const;
const DEFAULT_KEY_ID = 'ed25519:lu-execution-authority-v1';

let cachedVerifier: VerificationKeyProvider | null = null;

/**
 * Lazily constructs (and caches) the LU admission side's verification-only key provider from
 * env. Fails closed with a named-variable error if unconfigured.
 */
export function getLuExecutionAuthorityVerifier(): VerificationKeyProvider {
  if (cachedVerifier) return cachedVerifier;

  const missing = REQUIRED_ENV_VARS.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(
      `Missing LU execution authority verification key configuration: ${missing.join(', ')} ` +
        '(PEM-encoded Ed25519 public key). LU admission cannot verify execution-identity ' +
        'attestations without it -- see packages/mps-lu/src/execution/LuExecutionAuthorityVerifier.ts.',
    );
  }

  const keyId = process.env.LU_EXECUTION_AUTHORITY_SIGNING_KEY_ID || DEFAULT_KEY_ID;
  cachedVerifier = new LocalPemVerificationKeyProvider(
    keyId,
    process.env.LU_EXECUTION_AUTHORITY_PUBLIC_KEY_PEM as string,
  );
  return cachedVerifier;
}

/** Test-only escape hatch: reset the cached verifier between test runs / inject a fake one. */
export function __resetLuExecutionAuthorityVerifierForTests(
  verifier?: VerificationKeyProvider | null,
): void {
  cachedVerifier = verifier ?? null;
}
