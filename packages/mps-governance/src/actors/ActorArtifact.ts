import { ArtifactContract } from "../../../mps-compliance/src/artifacts/ArtifactContract";
import { ArtifactReference } from "../../../mps-compliance/src/artifacts/ArtifactReference";
import { ContentHash } from "../../../mps-compliance/src/artifacts/ContentHash";
import { sha256ContentHash } from "../../../mps-compliance/src/canonical/sha256Canonical";
import type {
  HumanIdentityArtifact,
  ServiceIdentityArtifact,
} from "./IdentityArtifacts";

export type ActorKind = "human" | "service" | "system";

export interface ActorArtifact extends ArtifactContract {
  readonly artifact_type: "actor";
  readonly kind: ActorKind;

  /**
   * Stable canonical identity. Optional only for historical actor artifacts;
   * authority-critical verification rejects an actor that lacks this closure.
   */
  readonly identity_ref?: ArtifactReference;
  readonly identity_hash?: ContentHash;

  readonly trust_domain_ref: ArtifactReference;
  readonly lifecycle_ref: ArtifactReference;
}

export type CanonicalActorIdentity =
  | HumanIdentityArtifact
  | ServiceIdentityArtifact;

function reference(
  value: ArtifactReference,
  field: "trust_domain_ref" | "lifecycle_ref",
): ArtifactReference {
  const artifactId = value.artifact_id.trim();
  const artifactType = value.artifact_type.trim();
  if (!artifactId || !artifactType) {
    throw new Error(`REJECT_CANONICAL_ACTOR: ${field} is required`);
  }
  return { artifact_id: artifactId, artifact_type: artifactType };
}

function identityKind(identity: CanonicalActorIdentity): "human" | "service" {
  if (identity.artifact_type === "human_identity") return "human";
  if (identity.artifact_type === "service_identity") return "service";
  throw new Error("REJECT_CANONICAL_ACTOR: unsupported canonical identity type");
}

function actorBody(input: {
  readonly identity: CanonicalActorIdentity;
  readonly trust_domain_ref: ArtifactReference;
  readonly lifecycle_ref: ArtifactReference;
}): Omit<ActorArtifact, "content_hash"> {
  const kind = identityKind(input.identity);
  const identityRef: ArtifactReference = {
    artifact_id: input.identity.artifact_id,
    artifact_type: input.identity.artifact_type,
  };
  const trustDomainRef = reference(input.trust_domain_ref, "trust_domain_ref");
  const lifecycleRef = reference(input.lifecycle_ref, "lifecycle_ref");

  const identity = sha256ContentHash({
    artifact_type: "actor",
    kind,
    identity_ref: identityRef,
    identity_hash: input.identity.content_hash,
    trust_domain_ref: trustDomainRef,
    lifecycle_ref: lifecycleRef,
  });

  return {
    artifact_id: `actor-${identity.value.slice(0, 24)}`,
    artifact_type: "actor",
    references: [identityRef, trustDomainRef, lifecycleRef],
    kind,
    identity_ref: identityRef,
    identity_hash: input.identity.content_hash,
    trust_domain_ref: trustDomainRef,
    lifecycle_ref: lifecycleRef,
  };
}

/**
 * MINIMUM-AUTHORITY-DELTA-04A — canonical actor projection.
 *
 * This is a representation bridge only:
 * - actor kind is derived from the already-canonical identity type;
 * - identity bytes/hash are pinned into the actor;
 * - domain/lifecycle must already exist as canonical references supplied by
 *   the caller;
 * - no role, capability, grant, delegation, issuer, trust root or signature
 *   is created here.
 *
 * Therefore creating an ActorArtifact cannot by itself satisfy authority.
 */
export function createActorArtifact(input: {
  readonly identity: CanonicalActorIdentity;
  readonly trust_domain_ref: ArtifactReference;
  readonly lifecycle_ref: ArtifactReference;
}): ActorArtifact {
  const body = actorBody(input);
  return {
    ...body,
    content_hash: sha256ContentHash(body),
  };
}

/**
 * Canonical self-check for an ActorArtifact against the identity it claims.
 * Resolution of trust_domain_ref/lifecycle_ref remains the responsibility of
 * the authority/conformance boundary; this validator deliberately does not
 * reinterpret unresolved references as authority.
 */
export function validateActorArtifact(
  artifact: ActorArtifact,
  identity: CanonicalActorIdentity,
): ActorArtifact {
  if (artifact.artifact_type !== "actor") {
    throw new Error("REJECT_CANONICAL_ACTOR: contract mismatch");
  }
  const rebuilt = createActorArtifact({
    identity,
    trust_domain_ref: artifact.trust_domain_ref,
    lifecycle_ref: artifact.lifecycle_ref,
  });

  const sameReferences =
    artifact.references.length === rebuilt.references.length &&
    artifact.references.every(
      (ref, index) =>
        ref.artifact_id === rebuilt.references[index]?.artifact_id &&
        ref.artifact_type === rebuilt.references[index]?.artifact_type,
    );

  if (
    artifact.kind !== rebuilt.kind ||
    artifact.artifact_id !== rebuilt.artifact_id ||
    artifact.identity_ref?.artifact_id !== rebuilt.identity_ref?.artifact_id ||
    artifact.identity_ref?.artifact_type !== rebuilt.identity_ref?.artifact_type ||
    artifact.identity_hash?.algorithm !== rebuilt.identity_hash?.algorithm ||
    artifact.identity_hash?.value !== rebuilt.identity_hash?.value ||
    artifact.content_hash.algorithm !== rebuilt.content_hash.algorithm ||
    artifact.content_hash.value !== rebuilt.content_hash.value ||
    !sameReferences
  ) {
    throw new Error("REJECT_CANONICAL_ACTOR: canonical actor mismatch");
  }

  return artifact;
}
