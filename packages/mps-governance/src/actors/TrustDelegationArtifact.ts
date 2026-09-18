import { ArtifactContract } from "../../../mps-compliance/src/artifacts/ArtifactContract";
import { ArtifactReference } from "../../../mps-compliance/src/artifacts/ArtifactReference";

/**
 * Immutable delegation grant.
 *
 * valid_from/valid_until define the grant's intrinsic time window. Early
 * revocation is intentionally NOT mutated into this artifact: it is expressed
 * by a separately signed ArtifactAttestation at authority-evaluation time so a
 * historical decision can preserve "authorized then" without being invalidated
 * by a later revocation.
 */
export interface TrustDelegationArtifact extends ArtifactContract {
  readonly artifact_type: "trust_delegation";
  readonly from_actor_ref: ArtifactReference;
  readonly to_actor_ref: ArtifactReference;
  readonly domain_ref: ArtifactReference;
  readonly authority_scope: string;

  /** ISO-8601. Optional only for historical artifacts; authority verification fails closed if absent. */
  readonly valid_from?: string;
  /** ISO-8601 exclusive upper bound; absence means no intrinsic expiry. */
  readonly valid_until?: string;
}
