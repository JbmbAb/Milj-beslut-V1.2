import { LocalPemSigningKeyProvider, type SigningKeyProvider } from "@miljobeslut/mimers-brunn-core";

/**
 * VIEWER-CAPABILITY-ISSUER-TRUST-CHAIN-V1 — the viewer-capability issuing authority.
 *
 * This Ed25519 key signs `ViewerCapabilityIssuerArtifact` self-attestations and
 * `ProductViewerCapabilityArtifact` attestations
 * (packages/mps-lu/src/artifacts/ProductViewerCapabilityArtifact.ts). Deliberately a separate key
 * from every other issuer in this repo (PROJECT_CONTEXT_BINDING_ISSUER_V1, LU_EXECUTION_AUTHORITY_*,
 * PRODUCT_ADMIN_ROLE_ISSUER_V1, product-release-issuer-v1) -- none of those authorities was ever
 * scoped to grant viewer-presentation capability.
 *
 * This module is the ONLY place in the codebase that should ever hold this private key.
 * server/security/viewerCapabilityVerifier.ts (the consumer/enforcement side) reads only the
 * public key env var and never imports this file.
 */
const REQUIRED_ENV_VARS = [
  "VIEWER_CAPABILITY_ISSUER_KEY_ID",
  "VIEWER_CAPABILITY_ISSUER_PRIVATE_KEY_PEM",
  "VIEWER_CAPABILITY_ISSUER_PUBLIC_KEY_PEM",
] as const;

let cachedProvider: SigningKeyProvider | null = null;

export function getViewerCapabilitySigningProvider(env: NodeJS.ProcessEnv = process.env): SigningKeyProvider {
  if (cachedProvider) return cachedProvider;
  const missing = REQUIRED_ENV_VARS.filter((name) => !env[name]?.trim());
  if (missing.length > 0) {
    throw new Error(
      `REJECT_VIEWER_CAPABILITY_ISSUER_CONFIGURATION: missing ${missing.join(", ")} (PEM-encoded Ed25519 key pair).`,
    );
  }
  cachedProvider = new LocalPemSigningKeyProvider(
    env.VIEWER_CAPABILITY_ISSUER_KEY_ID as string,
    env.VIEWER_CAPABILITY_ISSUER_PRIVATE_KEY_PEM as string,
    env.VIEWER_CAPABILITY_ISSUER_PUBLIC_KEY_PEM as string,
  );
  return cachedProvider;
}

/** Test-only escape hatch: reset the cached provider between test runs / inject a fake one. */
export function __resetViewerCapabilitySigningProviderForTests(provider?: SigningKeyProvider | null): void {
  cachedProvider = provider ?? null;
}
