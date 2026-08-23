import { LocalPemSigningKeyProvider, type SigningKeyProvider } from "@miljobeslut/mimers-brunn-core";

/**
 * LU-PROJECTION-RECONCILIATION-AND-TOTAL-ORDER-V1 Phase B -- the localization-geometry
 * supersession issuing authority.
 *
 * This Ed25519 key signs `LocalizationGeometrySupersessionIssuerArtifact` self-attestations and
 * `LocalizationGeometrySupersessionArtifact` attestations
 * (packages/mps-lu/src/artifacts/LocalizationGeometrySupersessionArtifact.ts). Deliberately a
 * separate key from every other issuer in this repo, including PROJECT_CONTEXT_BINDING_ISSUER_V1
 * -- that issuer's `allowed_artifact_types` is a closed, structurally-validated tuple that does
 * not (and must not) include this artifact type.
 *
 * This module is the ONLY place in the codebase that should ever hold this private key, and it
 * must only ever be imported by the standalone geometry-supersession provisioning worker process
 * (server/workers/lu-geometry-supersession-worker.ts) -- never by server/createApp.ts or any
 * request-handling route. server/security/localizationGeometrySupersessionVerifier.ts (the
 * consumer/enforcement side) reads only the public key env var and never imports this file.
 */
const REQUIRED_ENV_VARS = [
  "LOCALIZATION_GEOMETRY_SUPERSESSION_ISSUER_KEY_ID",
  "LOCALIZATION_GEOMETRY_SUPERSESSION_ISSUER_PRIVATE_KEY_PEM",
  "LOCALIZATION_GEOMETRY_SUPERSESSION_ISSUER_PUBLIC_KEY_PEM",
] as const;

let cachedProvider: SigningKeyProvider | null = null;

export function getLocalizationGeometrySupersessionSigningProvider(env: NodeJS.ProcessEnv = process.env): SigningKeyProvider {
  if (cachedProvider) return cachedProvider;
  const missing = REQUIRED_ENV_VARS.filter((name) => !env[name]?.trim());
  if (missing.length > 0) {
    throw new Error(
      `REJECT_LOCALIZATION_GEOMETRY_SUPERSESSION_ISSUER_CONFIGURATION: missing ${missing.join(", ")} (PEM-encoded Ed25519 key pair).`,
    );
  }
  cachedProvider = new LocalPemSigningKeyProvider(
    env.LOCALIZATION_GEOMETRY_SUPERSESSION_ISSUER_KEY_ID as string,
    env.LOCALIZATION_GEOMETRY_SUPERSESSION_ISSUER_PRIVATE_KEY_PEM as string,
    env.LOCALIZATION_GEOMETRY_SUPERSESSION_ISSUER_PUBLIC_KEY_PEM as string,
  );
  return cachedProvider;
}

/** Test-only escape hatch: reset the cached provider between test runs / inject a fake one. */
export function __resetLocalizationGeometrySupersessionSigningProviderForTests(provider?: SigningKeyProvider | null): void {
  cachedProvider = provider ?? null;
}
