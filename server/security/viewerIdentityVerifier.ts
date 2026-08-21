import { LocalPemVerificationKeyProvider, type VerificationKeyProvider } from "@miljobeslut/mimers-brunn-core";

/**
 * VIEWER-IDENTITY-AUTHORITY-BOOTSTRAP-01 — viewer-identity consumer/enforcement boundary.
 *
 * Reads ONLY the public key env var. Never imports viewerIdentitySigningKey.ts. The return type,
 * `VerificationKeyProvider`, has no `sign` method -- structurally cannot mint what it verifies.
 * This key_id is the actual root of trust for the viewer-identity chain.
 */
const REQUIRED_ENV_VARS = ["VIEWER_IDENTITY_ISSUER_KEY_ID", "VIEWER_IDENTITY_ISSUER_PUBLIC_KEY_PEM"] as const;

let cachedVerifier: VerificationKeyProvider | null = null;

export function getViewerIdentityVerifier(env: NodeJS.ProcessEnv = process.env): VerificationKeyProvider {
  if (cachedVerifier) return cachedVerifier;
  const missing = REQUIRED_ENV_VARS.filter((name) => !env[name]?.trim());
  if (missing.length > 0) {
    throw new Error(`REJECT_VIEWER_IDENTITY_ISSUER_CONFIGURATION: missing ${missing.join(", ")} (PEM-encoded Ed25519 public key).`);
  }
  cachedVerifier = new LocalPemVerificationKeyProvider(
    env.VIEWER_IDENTITY_ISSUER_KEY_ID as string,
    env.VIEWER_IDENTITY_ISSUER_PUBLIC_KEY_PEM as string,
  );
  return cachedVerifier;
}

/** Test-only escape hatch: reset the cached verifier between test runs / inject a fake one. */
export function __resetViewerIdentityVerifierForTests(verifier?: VerificationKeyProvider | null): void {
  cachedVerifier = verifier ?? null;
}
