import { LocalPemVerificationKeyProvider, type VerificationKeyProvider } from "@miljobeslut/mimers-brunn-core";

/**
 * VIEWER-CAPABILITY-ISSUER-TRUST-CHAIN-V1 — viewer-capability consumer/enforcement boundary.
 *
 * Reads ONLY the public key env var (`VIEWER_CAPABILITY_ISSUER_PUBLIC_KEY_PEM`). This file must
 * never import server/security/viewerCapabilitySigningKey.ts or reference
 * VIEWER_CAPABILITY_ISSUER_PRIVATE_KEY_PEM. The return type, `VerificationKeyProvider`, has no
 * `sign` method at all -- anything that verifies a viewer capability is structurally unable to
 * mint one, not merely convention-bound not to.
 *
 * This key_id is the actual root of trust for the viewer-capability chain: an issuer artifact
 * self-signed by any other key is rejected regardless of internal consistency.
 */
const REQUIRED_ENV_VARS = ["VIEWER_CAPABILITY_ISSUER_KEY_ID", "VIEWER_CAPABILITY_ISSUER_PUBLIC_KEY_PEM"] as const;

let cachedVerifier: VerificationKeyProvider | null = null;

export function getViewerCapabilityVerifier(env: NodeJS.ProcessEnv = process.env): VerificationKeyProvider {
  if (cachedVerifier) return cachedVerifier;
  const missing = REQUIRED_ENV_VARS.filter((name) => !env[name]?.trim());
  if (missing.length > 0) {
    throw new Error(
      `REJECT_VIEWER_CAPABILITY_ISSUER_CONFIGURATION: missing ${missing.join(", ")} (PEM-encoded Ed25519 public key).`,
    );
  }
  cachedVerifier = new LocalPemVerificationKeyProvider(
    env.VIEWER_CAPABILITY_ISSUER_KEY_ID as string,
    env.VIEWER_CAPABILITY_ISSUER_PUBLIC_KEY_PEM as string,
  );
  return cachedVerifier;
}

/** Test-only escape hatch: reset the cached verifier between test runs / inject a fake one. */
export function __resetViewerCapabilityVerifierForTests(verifier?: VerificationKeyProvider | null): void {
  cachedVerifier = verifier ?? null;
}
