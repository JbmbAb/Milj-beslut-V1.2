import { createPublicKey } from "node:crypto";
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
  // OD-R3: the key is checked here, at configuration time, the same way verification would read it
  // (createPublicKey on the PEM as given). An unparsable PEM used to throw only inside verification
  // (a 503 that looked like a CAS fault) and a PEM of another key type made every signature check
  // return false (every edge excluded -> AMBIGUOUS 409). Both are configuration errors. A refused
  // configuration is not cached, and the message never echoes the PEM.
  const publicKeyPem = env.LOCALIZATION_GEOMETRY_SUPERSESSION_ISSUER_PUBLIC_KEY_PEM as string;
  let keyType: string | undefined;
  try {
    keyType = createPublicKey(publicKeyPem).asymmetricKeyType;
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    throw new Error(
      "REJECT_LOCALIZATION_GEOMETRY_SUPERSESSION_ISSUER_CONFIGURATION: LOCALIZATION_GEOMETRY_SUPERSESSION_ISSUER_PUBLIC_KEY_PEM " +
        `cannot be parsed as a public key${typeof code === "string" ? ` (${code})` : ""}.`,
    );
  }
  if (keyType !== "ed25519") {
    throw new Error(
      "REJECT_LOCALIZATION_GEOMETRY_SUPERSESSION_ISSUER_CONFIGURATION: LOCALIZATION_GEOMETRY_SUPERSESSION_ISSUER_PUBLIC_KEY_PEM " +
        `is a ${keyType ?? "unknown"} key; an Ed25519 public key is required.`,
    );
  }
  cachedVerifier = new LocalPemVerificationKeyProvider(
    env.LOCALIZATION_GEOMETRY_SUPERSESSION_ISSUER_KEY_ID as string,
    publicKeyPem,
  );
  return cachedVerifier;
}

/** Test-only escape hatch: reset the cached verifier between test runs / inject a fake one. */
export function __resetLocalizationGeometrySupersessionVerifierForTests(verifier?: VerificationKeyProvider | null): void {
  cachedVerifier = verifier ?? null;
}
