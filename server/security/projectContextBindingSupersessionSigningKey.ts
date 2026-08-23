import { LocalPemSigningKeyProvider, type SigningKeyProvider } from "@miljobeslut/mimers-brunn-core";

/**
 * PROJECT-CONTEXT-BINDING-SUPERSESSION-ISSUER-V1 Phase B -- the project-context-binding
 * supersession issuing authority.
 *
 * This Ed25519 key signs `ProjectContextBindingSupersessionIssuerArtifact` self-attestations and
 * `project_context_binding_supersession` attestations. Deliberately a separate key from
 * PROJECT_CONTEXT_BINDING_ISSUER_V1 -- that issuer's `allowed_artifact_types` already grants
 * project_property_binding + project_context_binding authority; widening it to also cover
 * supersession would hand it authority it does not need (see
 * packages/mps-lu/src/artifacts/ProjectContextBindingSupersessionIssuerArtifact.ts). Mirrors
 * server/security/localizationGeometrySupersessionSigningKey.ts exactly.
 *
 * This module is the ONLY place in the codebase that should ever hold this private key, and it
 * must only ever be imported by an owner-side/worker-side minting path -- never by
 * server/createApp.ts or any request-handling route.
 * server/security/projectContextBindingSupersessionVerifier.ts (the consumer/enforcement side)
 * reads only the public key env var and never imports this file.
 */
const REQUIRED_ENV_VARS = [
  "PROJECT_CONTEXT_BINDING_SUPERSESSION_ISSUER_KEY_ID",
  "PROJECT_CONTEXT_BINDING_SUPERSESSION_ISSUER_PRIVATE_KEY_PEM",
  "PROJECT_CONTEXT_BINDING_SUPERSESSION_ISSUER_PUBLIC_KEY_PEM",
] as const;

let cachedProvider: SigningKeyProvider | null = null;

export function getProjectContextBindingSupersessionSigningProvider(env: NodeJS.ProcessEnv = process.env): SigningKeyProvider {
  if (cachedProvider) return cachedProvider;
  const missing = REQUIRED_ENV_VARS.filter((name) => !env[name]?.trim());
  if (missing.length > 0) {
    throw new Error(
      `REJECT_PROJECT_CONTEXT_BINDING_SUPERSESSION_ISSUER_CONFIGURATION: missing ${missing.join(", ")} (PEM-encoded Ed25519 key pair).`,
    );
  }
  cachedProvider = new LocalPemSigningKeyProvider(
    env.PROJECT_CONTEXT_BINDING_SUPERSESSION_ISSUER_KEY_ID as string,
    env.PROJECT_CONTEXT_BINDING_SUPERSESSION_ISSUER_PRIVATE_KEY_PEM as string,
    env.PROJECT_CONTEXT_BINDING_SUPERSESSION_ISSUER_PUBLIC_KEY_PEM as string,
  );
  return cachedProvider;
}

/** Test-only escape hatch: reset the cached provider between test runs / inject a fake one. */
export function __resetProjectContextBindingSupersessionSigningProviderForTests(provider?: SigningKeyProvider | null): void {
  cachedProvider = provider ?? null;
}
