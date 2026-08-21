import { LocalPemSigningKeyProvider, type SigningKeyProvider } from "@miljobeslut/mimers-brunn-core";

/**
 * VIEWER-IDENTITY-AUTHORITY-BOOTSTRAP-01 — the viewer-identity issuing authority.
 *
 * This Ed25519 key signs `ViewerIdentityIssuerArtifact` self-attestations and
 * `ViewerIdentityArtifact` attestations (packages/mps-lu/src/artifacts/ViewerIdentityArtifact.ts).
 * Deliberately a separate key from VIEWER_CAPABILITY_ISSUER_V1 and every other issuer in this
 * repo: this authority attests to what the presenting runtime component IS; the capability
 * issuer grants presentation RIGHTS over a project/context. No delegation model exists between
 * issuer purposes elsewhere in this repo, so this is a new dedicated key, not a reused one.
 *
 * This module is the ONLY place in the codebase that should ever hold this private key.
 * server/security/viewerIdentityVerifier.ts reads only the public key env var and never imports
 * this file.
 */
const REQUIRED_ENV_VARS = [
  "VIEWER_IDENTITY_ISSUER_KEY_ID",
  "VIEWER_IDENTITY_ISSUER_PRIVATE_KEY_PEM",
  "VIEWER_IDENTITY_ISSUER_PUBLIC_KEY_PEM",
] as const;

let cachedProvider: SigningKeyProvider | null = null;

export function getViewerIdentitySigningProvider(env: NodeJS.ProcessEnv = process.env): SigningKeyProvider {
  if (cachedProvider) return cachedProvider;
  const missing = REQUIRED_ENV_VARS.filter((name) => !env[name]?.trim());
  if (missing.length > 0) {
    throw new Error(`REJECT_VIEWER_IDENTITY_ISSUER_CONFIGURATION: missing ${missing.join(", ")} (PEM-encoded Ed25519 key pair).`);
  }
  cachedProvider = new LocalPemSigningKeyProvider(
    env.VIEWER_IDENTITY_ISSUER_KEY_ID as string,
    env.VIEWER_IDENTITY_ISSUER_PRIVATE_KEY_PEM as string,
    env.VIEWER_IDENTITY_ISSUER_PUBLIC_KEY_PEM as string,
  );
  return cachedProvider;
}

/** Test-only escape hatch: reset the cached provider between test runs / inject a fake one. */
export function __resetViewerIdentitySigningProviderForTests(provider?: SigningKeyProvider | null): void {
  cachedProvider = provider ?? null;
}
