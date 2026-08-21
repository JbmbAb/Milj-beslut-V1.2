import { LocalPemVerificationKeyProvider, type VerificationKeyProvider } from '@miljobeslut/mimers-brunn-core';

/**
 * PRODUCT-ADMIN-AUTHORITY-BOOTSTRAP-01 — ADMIN role-grant consumer/enforcement boundary.
 *
 * Reads ONLY the public key env var (`ADMIN_ROLE_ISSUER_PUBLIC_KEY_PEM`). This file must never
 * import server/security/adminRoleGrantSigningKey.ts or reference
 * ADMIN_ROLE_ISSUER_PRIVATE_KEY_PEM -- that is the entire point. The return type is
 * `VerificationKeyProvider`, which has no `sign` method at all (LocalPemVerificationKeyProvider
 * holds no private key material to sign with, by construction, not by refusing at runtime), so
 * anything that checks an ADMIN role grant is structurally unable to mint one, not merely
 * convention-bound not to.
 */
const REQUIRED_ENV_VARS = ['ADMIN_ROLE_ISSUER_PUBLIC_KEY_PEM'] as const;
const DEFAULT_KEY_ID = 'ed25519:product-admin-role-issuer-v1';

let cachedVerifier: VerificationKeyProvider | null = null;

/**
 * Lazily constructs (and caches) the ADMIN role-grant verification-only key provider from env.
 * Fails closed with a named-variable error if unconfigured.
 */
export function getAdminRoleGrantVerifier(): VerificationKeyProvider {
  if (cachedVerifier) return cachedVerifier;

  const missing = REQUIRED_ENV_VARS.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(
      `Missing ADMIN role-grant verification key configuration: ${missing.join(', ')} ` +
        '(PEM-encoded Ed25519 public key). ADMIN role cannot be verified/materialized without ' +
        'it -- see server/security/adminRoleGrantVerifier.ts.',
    );
  }

  const keyId = process.env.ADMIN_ROLE_ISSUER_SIGNING_KEY_ID || DEFAULT_KEY_ID;
  cachedVerifier = new LocalPemVerificationKeyProvider(
    keyId,
    process.env.ADMIN_ROLE_ISSUER_PUBLIC_KEY_PEM as string,
  );
  return cachedVerifier;
}

/** Test-only escape hatch: reset the cached verifier between test runs / inject a fake one. */
export function __resetAdminRoleGrantVerifierForTests(
  verifier?: VerificationKeyProvider | null,
): void {
  cachedVerifier = verifier ?? null;
}
