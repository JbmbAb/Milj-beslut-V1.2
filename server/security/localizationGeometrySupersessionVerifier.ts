import { LocalPemVerificationKeyProvider, type VerificationKeyProvider } from "@miljobeslut/mimers-brunn-core";

/**
 * LU-PROJECTION-RECONCILIATION-AND-TOTAL-ORDER-V1 Phase B -- localization-geometry supersession
 * consumer/enforcement boundary.
 *
 * Reads ONLY the public key env var (`LOCALIZATION_GEOMETRY_SUPERSESSION_ISSUER_PUBLIC_KEY_PEM`).
 * This file must never import server/security/localizationGeometrySupersessionSigningKey.ts or
 * reference LOCALIZATION_GEOMETRY_SUPERSESSION_ISSUER_PRIVATE_KEY_PEM. The return type,
 * `VerificationKeyProvider`, has no `sign` method at all -- anything that verifies a geometry
 * supersession is structurally unable to mint one, not merely convention-bound not to.
 *
 * Safe to import from the live web server (used for read-path re-verification of the currentness
 * graph) -- only server/security/localizationGeometrySupersessionSigningKey.ts is worker-only.
 */
const REQUIRED_ENV_VARS = [
  "LOCALIZATION_GEOMETRY_SUPERSESSION_ISSUER_KEY_ID",
  "LOCALIZATION_GEOMETRY_SUPERSESSION_ISSUER_PUBLIC_KEY_PEM",
] as const;

let cachedVerifier: VerificationKeyProvider | null = null;

export function getLocalizationGeometrySupersessionVerifier(env: NodeJS.ProcessEnv = process.env): VerificationKeyProvider {
  if (cachedVerifier) return cachedVerifier;
  const missing = REQUIRED_ENV_VARS.filter((name) => !env[name]?.trim());
  if (missing.length > 0) {
    throw new Error(
      `REJECT_LOCALIZATION_GEOMETRY_SUPERSESSION_ISSUER_CONFIGURATION: missing ${missing.join(", ")} (PEM-encoded Ed25519 public key).`,
    );
  }
  cachedVerifier = new LocalPemVerificationKeyProvider(
    env.LOCALIZATION_GEOMETRY_SUPERSESSION_ISSUER_KEY_ID as string,
    env.LOCALIZATION_GEOMETRY_SUPERSESSION_ISSUER_PUBLIC_KEY_PEM as string,
  );
  return cachedVerifier;
}

/** Test-only escape hatch: reset the cached verifier between test runs / inject a fake one. */
export function __resetLocalizationGeometrySupersessionVerifierForTests(verifier?: VerificationKeyProvider | null): void {
  cachedVerifier = verifier ?? null;
}
