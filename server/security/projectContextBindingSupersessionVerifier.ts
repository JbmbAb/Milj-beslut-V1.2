import { LocalPemVerificationKeyProvider, type VerificationKeyProvider } from "@miljobeslut/mimers-brunn-core";

/**
 * PROJECT-CONTEXT-BINDING-SUPERSESSION-ISSUER-V1 Phase B -- project-context-binding-supersession
 * consumer/enforcement boundary.
 *
 * Reads ONLY the public key env var (`PROJECT_CONTEXT_BINDING_SUPERSESSION_ISSUER_PUBLIC_KEY_PEM`).
 * This file must never import projectContextBindingSupersessionSigningKey.ts or reference
 * PROJECT_CONTEXT_BINDING_SUPERSESSION_ISSUER_PRIVATE_KEY_PEM. The return type,
 * `VerificationKeyProvider`, has no `sign` method at all -- anything that verifies a
 * project-context-binding supersession is structurally unable to mint one.
 *
 * This is a deliberately DIFFERENT trust root from `getProjectContextBindingIssuerVerifier()`
 * (server/security/projectContextBindingIssuerKey.ts) -- that is the ordinary binding issuer's
 * verifier, and it must never be used to check a supersession attestation. Mirrors
 * server/security/localizationGeometrySupersessionVerifier.ts exactly.
 */
const REQUIRED_ENV_VARS = [
  "PROJECT_CONTEXT_BINDING_SUPERSESSION_ISSUER_KEY_ID",
  "PROJECT_CONTEXT_BINDING_SUPERSESSION_ISSUER_PUBLIC_KEY_PEM",
] as const;

let cachedVerifier: VerificationKeyProvider | null = null;

export function getProjectContextBindingSupersessionVerifier(env: NodeJS.ProcessEnv = process.env): VerificationKeyProvider {
  if (cachedVerifier) return cachedVerifier;
  const missing = REQUIRED_ENV_VARS.filter((name) => !env[name]?.trim());
  if (missing.length > 0) {
    throw new Error(
      `REJECT_PROJECT_CONTEXT_BINDING_SUPERSESSION_ISSUER_CONFIGURATION: missing ${missing.join(", ")} (PEM-encoded Ed25519 public key).`,
    );
  }
  cachedVerifier = new LocalPemVerificationKeyProvider(
    env.PROJECT_CONTEXT_BINDING_SUPERSESSION_ISSUER_KEY_ID as string,
    env.PROJECT_CONTEXT_BINDING_SUPERSESSION_ISSUER_PUBLIC_KEY_PEM as string,
  );
  return cachedVerifier;
}

/** Test-only escape hatch: reset the cached verifier between test runs / inject a fake one. */
export function __resetProjectContextBindingSupersessionVerifierForTests(verifier?: VerificationKeyProvider | null): void {
  cachedVerifier = verifier ?? null;
}
