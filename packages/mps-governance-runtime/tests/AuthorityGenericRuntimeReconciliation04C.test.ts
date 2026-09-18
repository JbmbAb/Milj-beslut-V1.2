import { describe, expect, it } from "vitest";
import {
  LocalPemSigningKeyProvider,
  createArtifactAttestation,
  type ArtifactAttestation,
  type VerificationKeyProvider,
} from "../../mimers-brunn-core/src/index.js";
import type {
  ArtifactReference as PinnedArtifactReference,
  ContentReference,
} from "../../mps-core/src/types.js";
import type { ArtifactContract } from "../../mps-compliance/src/artifacts/ArtifactContract.js";
import type { ContentHash } from "../../mps-compliance/src/artifacts/ContentHash.js";
import { sha256ContentHash } from "../../mps-compliance/src/canonical/sha256Canonical.js";
import type { ActorArtifact } from "../../mps-governance/src/actors/ActorArtifact.js";
import type { ActorLifecycleArtifact } from "../../mps-governance/src/actors/ActorLifecycleArtifact.js";
import type { TrustAnchorArtifact } from "../../mps-governance/src/actors/TrustAnchorArtifact.js";
import type { TrustDelegationArtifact } from "../../mps-governance/src/actors/TrustDelegationArtifact.js";
import type { TrustDomainArtifact } from "../../mps-governance/src/actors/TrustDomainArtifact.js";
import type { CapabilityArtifact } from "../../mps-governance/src/capabilities/CapabilityArtifact.js";
import type { CapabilityGrantArtifact } from "../../mps-governance/src/capabilities/CapabilityGrantArtifact.js";
import type { CapabilityScopeArtifact } from "../../mps-governance/src/capabilities/CapabilityScopeArtifact.js";
import {
  DELEGATION_STATUS_PREDICATE_TYPE,
  DELEGATION_STATUS_SCHEMA_VERSION,
  verifyAuthorityAtDecisionTime,
  type AuthorityVerificationPort,
  type DelegationStatusPredicate,
  type VerifiedAuthorityArtifact,
} from "../src/AuthorityVerification.js";

const T_DECISION = "2026-09-16T00:00:00.000Z";

function h(value: string): ContentHash {
  return { algorithm: "sha256", value };
}

function base<TType extends string>(
  artifact_id: string,
  artifact_type: TType,
  value = artifact_id.padEnd(64, "0").slice(0, 64),
): ArtifactContract & { readonly artifact_type: TType } {
  return {
    artifact_id,
    artifact_type,
    content_hash: h(value),
    references: [],
  };
}

function loose(artifact: ArtifactContract) {
  return {
    artifact_id: artifact.artifact_id,
    artifact_type: artifact.artifact_type,
  };
}

function pinned(artifact: ArtifactContract): PinnedArtifactReference {
  return {
    artifact_id: artifact.artifact_id,
    artifact_type: artifact.artifact_type,
    content_hash: {
      algorithm: artifact.content_hash.algorithm,
      digest: artifact.content_hash.value,
    },
  };
}

describe("MINIMUM-AUTHORITY-DELTA-04C — actor-root runtime reconciliation", () => {
  it("permits the root Actor as delegation source without requiring root domain membership", async () => {
    const rootKey = LocalPemSigningKeyProvider.generate("authority-root-04c-runtime").provider;

    const rootIdentity = base("identity-root-04c", "identity", "1".repeat(64));
    const userIdentity = base("identity-user-04c", "identity", "2".repeat(64));

    const rootLifecycle = {
      ...base("lifecycle-root-04c", "actor_lifecycle", "3".repeat(64)),
      identity_ref: loose(rootIdentity),
      identity_hash: rootIdentity.content_hash,
      state: "ACTIVE",
      effective_from: "2026-01-01T00:00:00.000Z",
    } satisfies ActorLifecycleArtifact;

    const userLifecycle = {
      ...base("lifecycle-user-04c", "actor_lifecycle", "4".repeat(64)),
      identity_ref: loose(userIdentity),
      identity_hash: userIdentity.content_hash,
      state: "ACTIVE",
      effective_from: "2026-01-01T00:00:00.000Z",
    } satisfies ActorLifecycleArtifact;

    const rootActor = {
      ...base("actor-root-04c", "actor", "5".repeat(64)),
      kind: "system",
      identity_ref: loose(rootIdentity),
      identity_hash: rootIdentity.content_hash,
      trust_domain_refs: [],
      lifecycle_ref: loose(rootLifecycle),
    } satisfies ActorArtifact;

    const anchor = {
      ...base("anchor-04c", "trust_anchor", "6".repeat(64)),
      anchor_name: "actor-root-04c",
      governance_profile: "authority-v1",
      root_binding_type: "actor",
      root_ref: loose(rootActor),
      root_hash: rootActor.content_hash,
      verification_key_id: rootKey.keyId,
    } satisfies TrustAnchorArtifact;

    const domain = {
      ...base("domain-04c", "trust_domain", "7".repeat(64)),
      anchor_ref: loose(anchor),
      anchor_hash: anchor.content_hash,
      domain_name: "production",
      authority_scope: "production",
      constraints: [],
      allowed_actor_types: ["human"],
      delegation_rules: ["actor-delegation"],
    } satisfies TrustDomainArtifact;

    const userActor = {
      ...base("actor-user-04c", "actor", "8".repeat(64)),
      kind: "human",
      identity_ref: loose(userIdentity),
      identity_hash: userIdentity.content_hash,
      trust_domain_refs: [loose(domain)],
      lifecycle_ref: loose(userLifecycle),
    } satisfies ActorArtifact;

    const capability = {
      ...base("capability-04c", "capability", "9".repeat(64)),
      capability_name: "governance.approve",
      description: "Approve governed mutation",
    } satisfies CapabilityArtifact;

    const scope = {
      ...base("scope-04c", "capability_scope", "a".repeat(64)),
      capability_ref: loose(capability),
      scope_name: "production",
      constraints: {},
    } satisfies CapabilityScopeArtifact;

    const grant = {
      ...base("grant-04c", "capability_grant", "b".repeat(64)),
      actor_ref: loose(userActor),
      actor_hash: userActor.content_hash,
      capability_ref: loose(capability),
      capability_hash: capability.content_hash,
      scope_ref: loose(scope),
      scope_hash: scope.content_hash,
    } satisfies CapabilityGrantArtifact;

    const delegation = {
      ...base("delegation-04c", "trust_delegation", "c".repeat(64)),
      from_actor_ref: loose(rootActor),
      to_actor_ref: loose(userActor),
      domain_ref: loose(domain),
      authority_scope: "production",
      valid_from: "2026-01-01T00:00:00.000Z",
      valid_until: "2027-01-01T00:00:00.000Z",
    } satisfies TrustDelegationArtifact;

    const predicate: DelegationStatusPredicate = {
      delegation_artifact_id: delegation.artifact_id,
      delegation_content_hash: delegation.content_hash.value,
      status: "ACTIVE",
      evaluated_at: T_DECISION,
      attestation_schema_version: DELEGATION_STATUS_SCHEMA_VERSION,
      signer_key_id: rootKey.keyId,
    };
    const status = await createArtifactAttestation({
      subjectDigest: `sha256:${delegation.content_hash.value}`,
      predicateType: DELEGATION_STATUS_PREDICATE_TYPE,
      predicate: predicate as unknown as Record<string, unknown>,
      signing: rootKey,
    });
    const statusHash = sha256ContentHash(status);
    const statusRef: ContentReference = {
      id: "delegation-status-04c",
      content_hash: {
        algorithm: statusHash.algorithm,
        digest: statusHash.value,
      },
    };

    const artifacts: ArtifactContract[] = [
      rootIdentity,
      userIdentity,
      rootLifecycle,
      userLifecycle,
      rootActor,
      anchor,
      domain,
      userActor,
      capability,
      scope,
      grant,
      delegation,
    ];
    const artifactMap = new Map(artifacts.map((artifact) => [artifact.artifact_id, artifact]));
    const keys = new Map<string, VerificationKeyProvider>([[rootKey.keyId, rootKey]]);

    const port: AuthorityVerificationPort = {
      async resolveVerifiedArtifact<T extends ArtifactContract>(
        reference: PinnedArtifactReference,
      ): Promise<VerifiedAuthorityArtifact<T>> {
        const artifact = artifactMap.get(reference.artifact_id);
        if (!artifact) throw new Error("TEST_ARTIFACT_NOT_FOUND");
        if (
          artifact.artifact_type !== reference.artifact_type ||
          artifact.content_hash.algorithm !== reference.content_hash.algorithm ||
          artifact.content_hash.value !== reference.content_hash.digest
        ) {
          throw new Error("TEST_PIN_MISMATCH");
        }
        return { artifact: artifact as T };
      },
      async resolvePinnedAttestation(reference: ContentReference): Promise<ArtifactAttestation> {
        if (reference.id !== statusRef.id) throw new Error("TEST_ATTESTATION_NOT_FOUND");
        return status;
      },
      async resolveTrustedVerificationKey(keyId: string) {
        return keys.get(keyId) ?? null;
      },
      async assertCanonicalDelegationPath({ delegation_refs }) {
        return (
          delegation_refs.length === 1 &&
          delegation_refs[0]?.artifact_id === delegation.artifact_id
        );
      },
    };

    const result = await verifyAuthorityAtDecisionTime(port, {
      decision_time: T_DECISION,
      required_capability: "governance.approve",
      required_scope: "production",
      actor_ref: pinned(userActor),
      actor_lifecycle_ref: pinned(userLifecycle),
      capability_ref: pinned(capability),
      capability_scope_ref: pinned(scope),
      capability_grant_ref: pinned(grant),
      trust_domain_ref: pinned(domain),
      trust_anchor_ref: pinned(anchor),
      trust_root_actor_ref: pinned(rootActor),
      trust_root_actor_lifecycle_ref: pinned(rootLifecycle),
      delegation_path: [
        {
          delegation_ref: pinned(delegation),
          delegator_actor_ref: pinned(rootActor),
          delegator_lifecycle_ref: pinned(rootLifecycle),
          delegatee_actor_ref: pinned(userActor),
          delegatee_lifecycle_ref: pinned(userLifecycle),
          status_attestation_ref: statusRef,
        },
      ],
    });

    expect(result.ok).toBe(true);
  });
});
