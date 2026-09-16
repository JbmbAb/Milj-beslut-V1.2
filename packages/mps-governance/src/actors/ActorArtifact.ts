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
   * Stable canonical identity. ActorArtifact is a versioned representation of
   * domain participation/lifecycle state; identity_ref + identity_hash are the
   * stable actor identity required by ACT-21-I9.
   */
  readonly identity_ref?: ArtifactReference;
  readonly identity_hash?: ContentHash;

  /** ACT-21-I3 permits one actor to participate in multiple trust domains. */
  readonly trust_domain_refs: readonly ArtifactReference[];
  readonly lifecycle_ref: ArtifactReference;
}

export type CanonicalActorIdentity =
  | HumanIdentityArtifact
  | ServiceIdentityArtifact;

function reference(value: ArtifactReference, field: string): ArtifactReference {
  const artifactId = value.artifact_id.trim();
  const artifactType = value.artifact_type.trim();
  if (!artifactId || !artifactType) {
    throw new Error(`REJECT_CANONICAL_ACTOR: ${field} is required`);
  }
  return { artifact_id: artifactId, artifact_type: artifactType };
}

function domainReferences(values: readonly ArtifactReference[]): readonly ArtifactReference[] {
  if (values.length === 0) {
    throw new Error("REJECT_CANONICAL_ACTOR: trust_domain_refs is required");
  }
  const normalized = values
    .map((value, index) => reference(value, `trust_domain_refs[${index}]`))
    .sort((left, right) =>
      `${left.artifact_type}\u0000${left.artifact_id}`.localeCompare(
        `${right.artifact_type}\u0000${right.artifact_id}`,
      ),
    );

  for (let index = 1; index < normalized.length; index += 1) {
    const previous = normalized[index - 1]!;
    const current = normalized[index]!;
    if (
      previous.artifact_id === current.artifact_id &&
      previous.artifact_type === current.artifact_type
    ) {
      throw new Error("REJECT_CANONICAL_ACTOR: duplicate trust_domain_ref");
    }
  }
  return normalized;
}

function identityKind(identity: CanonicalActorIdentity): "human" | "service" {
  if (identity.artifact_type === "human_identity") return "human";
  if (identity.artifact_type === "service_identity") return "service";
  throw new Error("REJECT_CANONICAL_ACTOR: unsupported canonical identity type");
}

function actorBody(input: {
  readonly identity: CanonicalActorIdentity;
  readonly trust_domain_refs: readonly ArtifactReference[];
  readonly lifecycle_ref: ArtifactReference;
}): Omit<ActorArtifact, "content_hash"> {
  const kind = identityKind(input.identity);
  const identityRef: ArtifactReference = {
    artifact_id: input.identity.artifact_id,
    artifact_type: input.identity.artifact_type,
  };
  const trustDomainRefs = domainReferences(input.trust_domain_refs);
  const lifecycleRef = reference(input.lifecycle_ref, "lifecycle_ref");

  const representationIdentity = sha256ContentHash({
    artifact_type: "actor",
    kind,
    identity_ref: identityRef,
    identity_hash: input.identity.content_hash,
    trust_domain_refs: trustDomainRefs,
    lifecycle_ref: lifecycleRef,
  });

  return {
    artifact_id: `actor-${representationIdentity.value.slice(0, 24)}`,
    artifact_type: "actor",
    references: [identityRef, ...trustDomainRefs, lifecycleRef],
    kind,
    identity_ref: identityRef,
    identity_hash: input.identity.content_hash,
    trust_domain_refs: trustDomainRefs,
    lifecycle_ref: lifecycleRef,
  };
}

/**
 * Canonical Actor projection.
 *
 * ActorArtifact may change when domain participation or lifecycle evidence
 * changes. The actor's canonical identity does not: it remains the pinned
 * HumanIdentityArtifact/ServiceIdentityArtifact. This keeps ACT-21-I3 and
 * ACT-21-I9 compatible without making runtime authority part of identity.
 */
export function createActorArtifact(input: {
  readonly identity: CanonicalActorIdentity;
  readonly trust_domain_refs: readonly ArtifactReference[];
  readonly lifecycle_ref: ArtifactReference;
}): ActorArtifact {
  const body = actorBody(input);
  return {
    ...body,
    content_hash: sha256ContentHash(body),
  };
}

export function validateActorArtifact(
  artifact: ActorArtifact,
  identity: CanonicalActorIdentity,
): ActorArtifact {
  if (artifact.artifact_type !== "actor") {
    throw new Error("REJECT_CANONICAL_ACTOR: contract mismatch");
  }
  const rebuilt = createActorArtifact({
    identity,
    trust_domain_refs: artifact.trust_domain_refs,
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
