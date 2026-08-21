import { ArtifactContract } from "../../../mps-compliance/src/artifacts/ArtifactContract";
import { ArtifactReference } from "../../../mps-compliance/src/artifacts/ArtifactReference";
import type {
  ExecutionIdentityScopeVersion,
  ExecutionIdentitySubjectV2,
} from "./ExecutionIdentityScopeV2";

/**
 * ExecutionIdentityArtifact
 *
 * Binds actor trust + signature + capability into a single
 * immutable execution identity.
 */
export interface ExecutionIdentityArtifact extends ArtifactContract {
  readonly artifact_type: "execution_identity";

  readonly actor_ref: ArtifactReference;
  readonly capability_ref: ArtifactReference;
  readonly signature_envelope_ref: ArtifactReference;

  /**
   * LU-EXECUTION-IDENTITY-SCOPE-V2. Absent (undefined) on every already-persisted artifact means
   * legacy V1 (site_id-only scoped, `artifact_id = "lu-identity-" + site_id`). Present means V2
   * (`site_id + project_context_binding_ref + product_release_ref + execution_contract_version`
   * scoped, `artifact_id = "lu-identity-v2-" + scope hash`).
   *
   * Deliberately optional rather than defaulted: `undefined` is dropped by the RFC8785
   * canonicalizer, so leaving this field genuinely absent on old artifacts keeps their
   * `content_hash` byte-identical to what was hashed before V2 existed. Never write V1 artifacts
   * with this field set, and never omit it on a V2 artifact.
   */
  readonly execution_identity_contract_version?: ExecutionIdentityScopeVersion;
  /** V2 only -- see `execution_identity_contract_version`. */
  readonly subject_v2?: ExecutionIdentitySubjectV2;
}
