import { ArtifactContract } from "../../../mps-compliance/src/artifacts/ArtifactContract";
import { ArtifactReference } from "../../../mps-compliance/src/artifacts/ArtifactReference";
import { ContentHash } from "../../../mps-compliance/src/artifacts/ContentHash";
import { sha256ContentHash } from "../../../mps-compliance/src/canonical/sha256Canonical";
import type {
  HumanIdentityArtifact,
  ServiceIdentityArtifact,
} from "./IdentityArtifacts";

export type ActorLifecycleState =
  | "CREATED"
  | "ACTIVE"
  | "SUSPENDED"
  | "REVOKED";

export type ActorLifecycleIdentity =
  | HumanIdentityArtifact
  | ServiceIdentityArtifact;

export interface ActorLifecycleArtifact extends ArtifactContract {
  readonly artifact_type: "actor_lifecycle";
  readonly identity_ref: ArtifactReference;
  readonly identity_hash: ContentHash;
  readonly state: ActorLifecycleState;
  readonly effective_from: string;
  readonly previous_lifecycle_ref?: ArtifactReference;
}

const PREVIOUS_STATE: Readonly<Record<Exclude<ActorLifecycleState, "CREATED">, ActorLifecycleState>> = {
  ACTIVE: "CREATED",
  SUSPENDED: "ACTIVE",
  REVOKED: "SUSPENDED",
};

function instant(value: string): string {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    throw new Error("REJECT_ACTOR_LIFECYCLE: effective_from must be ISO-8601");
  }
  return new Date(parsed).toISOString();
}

function sameIdentity(
  leftRef: ArtifactReference,
  leftHash: ContentHash,
  identity: ActorLifecycleIdentity,
): boolean {
  return (
    leftRef.artifact_id === identity.artifact_id &&
    leftRef.artifact_type === identity.artifact_type &&
    leftHash.algorithm === identity.content_hash.algorithm &&
    leftHash.value === identity.content_hash.value
  );
}

function body(input: {
  readonly identity: ActorLifecycleIdentity;
  readonly state: ActorLifecycleState;
  readonly effective_from: string;
  readonly previous?: ActorLifecycleArtifact;
}): Omit<ActorLifecycleArtifact, "content_hash"> {
  const identityRef: ArtifactReference = {
    artifact_id: input.identity.artifact_id,
    artifact_type: input.identity.artifact_type,
  };
  const effectiveFrom = instant(input.effective_from);

  if (input.state === "CREATED") {
    if (input.previous) {
      throw new Error("REJECT_ACTOR_LIFECYCLE: CREATED cannot have a previous state");
    }
  } else {
    if (!input.previous) {
      throw new Error(`REJECT_ACTOR_LIFECYCLE: ${input.state} requires previous state`);
    }
    if (!sameIdentity(input.previous.identity_ref, input.previous.identity_hash, input.identity)) {
      throw new Error("REJECT_ACTOR_LIFECYCLE: identity changed across transition");
    }
    if (input.previous.state !== PREVIOUS_STATE[input.state]) {
      throw new Error(
        `REJECT_ACTOR_LIFECYCLE: invalid transition ${input.previous.state} -> ${input.state}`,
      );
    }
    if (Date.parse(effectiveFrom) <= Date.parse(input.previous.effective_from)) {
      throw new Error("REJECT_ACTOR_LIFECYCLE: transition time must increase");
    }
  }

  const previousRef = input.previous
    ? {
        artifact_id: input.previous.artifact_id,
        artifact_type: input.previous.artifact_type,
      }
    : undefined;

  const canonical = {
    artifact_type: "actor_lifecycle" as const,
    identity_ref: identityRef,
    identity_hash: input.identity.content_hash,
    state: input.state,
    effective_from: effectiveFrom,
    ...(previousRef ? { previous_lifecycle_ref: previousRef } : {}),
  };
  const representationIdentity = sha256ContentHash(canonical);

  return {
    artifact_id: `actor-lifecycle-${representationIdentity.value.slice(0, 24)}`,
    references: [identityRef, ...(previousRef ? [previousRef] : [])],
    ...canonical,
  };
}

export function createActorLifecycleArtifact(input: {
  readonly identity: ActorLifecycleIdentity;
  readonly state: ActorLifecycleState;
  readonly effective_from: string;
  readonly previous?: ActorLifecycleArtifact;
}): ActorLifecycleArtifact {
  const artifact = body(input);
  return { ...artifact, content_hash: sha256ContentHash(artifact) };
}

export function validateActorLifecycleArtifact(
  artifact: ActorLifecycleArtifact,
  identity: ActorLifecycleIdentity,
  previous?: ActorLifecycleArtifact,
): ActorLifecycleArtifact {
  const rebuilt = createActorLifecycleArtifact({
    identity,
    state: artifact.state,
    effective_from: artifact.effective_from,
    previous,
  });
  if (
    artifact.artifact_id !== rebuilt.artifact_id ||
    artifact.content_hash.algorithm !== rebuilt.content_hash.algorithm ||
    artifact.content_hash.value !== rebuilt.content_hash.value
  ) {
    throw new Error("REJECT_ACTOR_LIFECYCLE: canonical mismatch");
  }
  return artifact;
}
