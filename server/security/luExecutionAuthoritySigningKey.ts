import { LocalPemSigningKeyProvider, type SigningKeyProvider } from '@miljobeslut/mimers-brunn-core';

/**
 * PROD-LU-ADMISSION-02B — LU execution identity issuing authority.
 *
 * This Ed25519 key signs the `ArtifactAttestation`s that bind a real `execution_identity`
 * artifact to the exact run (site/capability/release) it authorizes -- see
 * packages/mps-lu/src/execution/ExecutionIdentityAttestation.ts. Deliberately a separate key
 * from GOVERNANCE_SIGNING_*: that key authorizes permanent CAS promotions (a different security
 * semantic), and reusing it here would couple two unrelated authorities for no reason beyond
 * convenience.
 *
 * This module is the ONLY place in the codebase that should ever hold this private key. The
 * LU admission/consumer side (packages/mps-lu/src/execution/LuExecutionAuthorityVerifier.ts)
 * reads only the public key env var and never imports this file -- that asymmetry is the trust
 * boundary PROD-LU-ADMISSION-02 exists to establish. Whatever process mints execution identities
 * (composition root / issuing service) imports this module; the LU kernel client that later
 * consumes and verifies them must not.
 */
const REQUIRED_ENV_VARS = [
  'LU_EXECUTION_AUTHORITY_PRIVATE_KEY_PEM',
  'LU_EXECUTION_AUTHORITY_PUBLIC_KEY_PEM',
] as const;
const DEFAULT_KEY_ID = 'ed25519:lu-execution-authority-v1';

let cachedProvider: SigningKeyProvider | null = null;

/**
 * Lazily constructs (and caches) the LU execution identity issuing authority's signing
 * provider from env. Fails closed with a named-variable error if unconfigured, rather than
 * generating or reusing an unrelated key.
 */
export function getLuExecutionAuthoritySigningProvider(): SigningKeyProvider {
  if (cachedProvider) return cachedProvider;

  const missing = REQUIRED_ENV_VARS.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(
      `Missing LU execution authority signing key configuration: ${missing.join(', ')} ` +
        '(PEM-encoded Ed25519 key pair). This key mints the execution-identity attestations ' +
        'that PROD-LU-ADMISSION-02 requires before LU admission may succeed -- see ' +
        'server/security/luExecutionAuthoritySigningKey.ts.',
    );
  }

  const keyId = process.env.LU_EXECUTION_AUTHORITY_SIGNING_KEY_ID || DEFAULT_KEY_ID;
  cachedProvider = new LocalPemSigningKeyProvider(
    keyId,
    process.env.LU_EXECUTION_AUTHORITY_PRIVATE_KEY_PEM as string,
    process.env.LU_EXECUTION_AUTHORITY_PUBLIC_KEY_PEM as string,
  );
  return cachedProvider;
}

/** Test-only escape hatch: reset the cached provider between test runs / inject a fake one. */
export function __resetLuExecutionAuthoritySigningProviderForTests(
  provider?: SigningKeyProvider | null,
): void {
  cachedProvider = provider ?? null;
}
