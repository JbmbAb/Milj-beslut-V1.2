import { LocalPemSigningKeyProvider, type SigningKeyProvider } from '@miljobeslut/mimers-brunn-core';

/**
 * PRODUCT-ADMIN-AUTHORITY-BOOTSTRAP-01 — the ADMIN role-grant issuing authority.
 *
 * This Ed25519 key signs `AdminRoleGrantArtifact` attestations
 * (packages/mps-compliance/src/artifacts/AdminRoleGrantArtifact.ts). It is deliberately a
 * separate key from every other issuer in this repo -- PROJECT_CONTEXT_BINDING_ISSUER_V1, the
 * viewer-capability issuer, the dataset admission signer, LU_EXECUTION_AUTHORITY_* -- because
 * none of those authorities was ever scoped to grant product ADMIN role, and reusing one would
 * silently widen its authority beyond what it was actually issued for.
 *
 * This module is the ONLY place in the codebase that should ever hold this private key.
 * server/security/adminRoleGrantVerifier.ts (the consumer/enforcement side) reads only the
 * public key env var and never imports this file -- that asymmetry is the trust boundary this
 * unit exists to establish. Whatever process actually issues an ADMIN grant (an explicit,
 * owner-run issuance step -- never an HTTP-reachable "become admin" endpoint) imports this
 * module; runtime authorization enforcement must not.
 */
const REQUIRED_ENV_VARS = [
  'ADMIN_ROLE_ISSUER_PRIVATE_KEY_PEM',
  'ADMIN_ROLE_ISSUER_PUBLIC_KEY_PEM',
] as const;
const DEFAULT_KEY_ID = 'ed25519:product-admin-role-issuer-v1';

let cachedProvider: SigningKeyProvider | null = null;

/**
 * Lazily constructs (and caches) the ADMIN role-grant issuing authority's signing provider from
 * env. Fails closed with a named-variable error if unconfigured, rather than generating or
 * reusing an unrelated key.
 */
export function getAdminRoleGrantSigningProvider(): SigningKeyProvider {
  if (cachedProvider) return cachedProvider;

  const missing = REQUIRED_ENV_VARS.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(
      `Missing ADMIN role-grant issuer signing key configuration: ${missing.join(', ')} ` +
        '(PEM-encoded Ed25519 key pair). This key mints the AdminRoleGrantArtifact attestations ' +
        'that PRODUCT-ADMIN-AUTHORITY-BOOTSTRAP-01 requires before ADMIN role may be granted -- ' +
        'see server/security/adminRoleGrantSigningKey.ts.',
    );
  }

  const keyId = process.env.ADMIN_ROLE_ISSUER_SIGNING_KEY_ID || DEFAULT_KEY_ID;
  cachedProvider = new LocalPemSigningKeyProvider(
    keyId,
    process.env.ADMIN_ROLE_ISSUER_PRIVATE_KEY_PEM as string,
    process.env.ADMIN_ROLE_ISSUER_PUBLIC_KEY_PEM as string,
  );
  return cachedProvider;
}

/** Test-only escape hatch: reset the cached provider between test runs / inject a fake one. */
export function __resetAdminRoleGrantSigningProviderForTests(
  provider?: SigningKeyProvider | null,
): void {
  cachedProvider = provider ?? null;
}
