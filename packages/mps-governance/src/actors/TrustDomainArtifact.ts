import { ArtifactContract } from "../../../mps-compliance/src/artifacts/ArtifactContract";
import { ArtifactReference } from "../../../mps-compliance/src/artifacts/ArtifactReference";
import { ContentHash } from "../../../mps-compliance/src/artifacts/ContentHash";
import { sha256ContentHash } from "../../../mps-compliance/src/canonical/sha256Canonical";
import type { ActorKind } from "./ActorArtifact";
import type { TrustAnchorArtifact } from "./TrustAnchorArtifact";

export interface TrustDomainArtifact extends ArtifactContract {
  readonly artifact_type: "trust_domain";
  readonly anchor_ref: ArtifactReference;
  readonly anchor_hash: ContentHash;
  readonly domain_name: string;
  readonly authority_scope: string;
  readonly constraints: readonly string[];
  readonly allowed_actor_types: readonly ActorKind[];
  readonly delegation_rules: readonly string[];
}

function required(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`REJECT_TRUST_DOMAIN: ${field} is required`);
  return normalized;
}

function canonicalStrings(values: readonly string[], field: string): readonly string[] {
  const result = values.map((value, index) => required(value, `${field}[${index}]`)).sort();
  if (new Set(result).size !== result.length) {
    throw new Error(`REJECT_TRUST_DOMAIN: duplicate ${field}`);
  }
  return result;
}

function canonicalActorTypes(values: readonly ActorKind[]): readonly ActorKind[] {
  if (values.length === 0) {
    throw new Error("REJECT_TRUST_DOMAIN: allowed_actor_types is required");
  }
  const allowed = new Set<ActorKind>(["human", "service", "system"]);
  if (values.some((value) => !allowed.has(value))) {
    throw new Error("REJECT_TRUST_DOMAIN: unsupported actor type");
  }
  const result = [...values].sort();
  if (new Set(result).size !== result.length) {
    throw new Error("REJECT_TRUST_DOMAIN: duplicate allowed_actor_types");
  }
  return result;
}

function body(input: {
  readonly anchor: TrustAnchorArtifact;
  readonly domain_name: string;
  readonly authority_scope: string;
  readonly constraints: readonly string[];
  readonly allowed_actor_types: readonly ActorKind[];
  readonly delegation_rules: readonly string[];
}): Omit<TrustDomainArtifact, "content_hash"> {
  const anchorRef: ArtifactReference = {
    artifact_id: input.anchor.artifact_id,
    artifact_type: input.anchor.artifact_type,
  };
  const canonical = {
    artifact_type: "trust_domain" as const,
    anchor_ref: anchorRef,
    anchor_hash: input.anchor.content_hash,
    domain_name: required(input.domain_name, "domain_name"),
    authority_scope: required(input.authority_scope, "authority_scope"),
    constraints: canonicalStrings(input.constraints, "constraints"),
    allowed_actor_types: canonicalActorTypes(input.allowed_actor_types),
    delegation_rules: canonicalStrings(input.delegation_rules, "delegation_rules"),
  };
  const identity = sha256ContentHash(canonical);
  return {
    artifact_id: `trust-domain-${identity.value.slice(0, 24)}`,
    references: [anchorRef],
    ...canonical,
  };
}

export function createTrustDomainArtifact(input: {
  readonly anchor: TrustAnchorArtifact;
  readonly domain_name: string;
  readonly authority_scope: string;
  readonly constraints?: readonly string[];
  readonly allowed_actor_types: readonly ActorKind[];
  readonly delegation_rules?: readonly string[];
}): TrustDomainArtifact {
  const artifact = body({
    ...input,
    constraints: input.constraints ?? [],
    delegation_rules: input.delegation_rules ?? [],
  });
  return { ...artifact, content_hash: sha256ContentHash(artifact) };
}

export function validateTrustDomainArtifact(
  artifact: TrustDomainArtifact,
  anchor: TrustAnchorArtifact,
): TrustDomainArtifact {
  const rebuilt = createTrustDomainArtifact({
    anchor,
    domain_name: artifact.domain_name,
    authority_scope: artifact.authority_scope,
    constraints: artifact.constraints,
    allowed_actor_types: artifact.allowed_actor_types,
    delegation_rules: artifact.delegation_rules,
  });
  if (
    artifact.artifact_type !== "trust_domain" ||
    artifact.artifact_id !== rebuilt.artifact_id ||
    artifact.content_hash.algorithm !== rebuilt.content_hash.algorithm ||
    artifact.content_hash.value !== rebuilt.content_hash.value
  ) {
    throw new Error("REJECT_TRUST_DOMAIN: canonical mismatch");
  }
  return artifact;
}
