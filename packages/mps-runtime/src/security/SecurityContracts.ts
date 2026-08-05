/**
 * Execution Platform Security contracts — Epoch II §2.9.
 *
 * Identity → Admission → Authorization → Capability Invocation → Artifact Signing
 * Scope: execution-path trust only — not org IAM / SSO / federation.
 */

import type { ContentHash } from "../../../mps-compliance/src/artifacts/ContentHash.js";
import type { ArtifactReference } from "../../../mps-compliance/src/artifacts/ArtifactReference.js";

export const SECURITY_RUNTIME_VERSION = "1.0.0" as const;

/** Opaque execution principal — no SSO claims. */
export type ExecutionPrincipal = {
  readonly principal_id: string;
  readonly actor_ref: ArtifactReference | null;
};

export type SecurityContext = {
  readonly principal: ExecutionPrincipal;
  readonly bound_at_seed: string;
};

export type CapabilityGrant = {
  readonly principal_id: string;
  readonly capability_id: string;
};

export type AuthorizeDecision =
  | { readonly decision: "allow"; readonly reason_codes: readonly string[] }
  | { readonly decision: "deny"; readonly reason_codes: readonly string[] };

/**
 * Integrity attestation over an outcome content hash.
 * Not a second source of truth — binds principal + hash.
 */
export type OutcomeAttestation = {
  readonly artifact_type: "outcome_attestation";
  readonly attestation_id: string;
  readonly principal_id: string;
  readonly outcome_hash: ContentHash;
  readonly key_id: string;
  readonly signature: string;
  readonly content_hash: ContentHash;
};

export type SigningKeyProvider = {
  readonly key_id: string;
  sign(payload: string): string;
  verify(payload: string, signature: string): boolean;
};
