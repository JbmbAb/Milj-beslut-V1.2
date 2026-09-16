import type { ExecutionIdentityVerificationResult } from "./ExecutionIdentityAttestation.js";
import { LU_EXECUTION_PRINCIPAL_ID } from "./LuExecutionPrincipal.js";
import {
  createServiceIdentityArtifact,
  type ServiceIdentityArtifact,
} from "../../../mps-governance/src/actors/IdentityArtifacts.js";

/**
 * Converges the already-PROVEN LU execution-identity chain into ADR-24-21's
 * canonical ServiceIdentity without re-verifying or widening the LU issuer.
 *
 * The cryptographic authority decision stays in verifyExecutionIdentityAttestation
 * + verifyLuExecutionAuthorityChain. This function consumes only their verified
 * result and maps the stable logical principal to canonical identity.
 */
export function deriveLuCanonicalServiceIdentity(
  verification: ExecutionIdentityVerificationResult,
): ServiceIdentityArtifact {
  if ("reason" in verification) {
    throw new Error(`REJECT_LU_CANONICAL_SERVICE_IDENTITY: execution identity is not verified (${verification.reason})`);
  }

  const actorRef = verification.identity.actor_ref;
  if (
    actorRef.artifact_id !== LU_EXECUTION_PRINCIPAL_ID ||
    actorRef.artifact_type !== "execution_identity"
  ) {
    throw new Error("REJECT_LU_CANONICAL_SERVICE_IDENTITY: execution actor_ref is not the canonical LU principal");
  }

  return createServiceIdentityArtifact({
    service_namespace: "mimer.lu",
    principal_id: LU_EXECUTION_PRINCIPAL_ID,
  });
}
