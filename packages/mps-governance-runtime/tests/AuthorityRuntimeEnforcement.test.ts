import { describe, expect, it } from "vitest";
import {
  LocalPemSigningKeyProvider,
  type SigningKeyProvider,
} from "../../mimers-brunn-core/src/index.js";
import type {
  ArtifactReference as PinnedArtifactReference,
  ContentReference,
} from "../../mps-core/src/types.js";
import type { ArtifactContract } from "../../mps-compliance/src/artifacts/ArtifactContract.js";
import type { ArtifactReference } from "../../mps-compliance/src/artifacts/ArtifactReference.js";
import type { ContentHash } from "../../mps-compliance/src/artifacts/ContentHash.js";
import { sha256ContentHash } from "../../mps-compliance/src/canonical/sha256Canonical.js";
import {
  CasBackedArtifactRepository,
  MemoryByteStorageBackend,
} from "../../mps-runtime/src/repository/CasBackedArtifactRepository.js";
import type { ActorArtifact } from "../../mps-governance/src/actors/ActorArtifact.js";
import type { ActorLifecycleArtifact } from "../../mps-governance/src/actors/ActorLifecycleArtifact.js";
import type { TrustAnchorArtifact } from "../../mps-governance/src/actors/TrustAnchorArtifact.js";
import type { TrustDelegationArtifact } from "../../mps-governance/src/actors/TrustDelegationArtifact.js";
import type { TrustDomainArtifact } from "../../mps-governance/src/actors/TrustDomainArtifact.js";
import type { CapabilityArtifact } from "../../mps-governance/src/capabilities/CapabilityArtifact.js";
import type { CapabilityGrantArtifact } from "../../mps-governance/src/capabilities/CapabilityGrantArtifact.js";
import type { CapabilityScopeArtifact } from "../../mps-governance/src/capabilities/CapabilityScopeArtifact.js";
import {
  verifyAuthorityAtDecisionTime,
  type AuthorityVerificationRequest,
} from "../src/AuthorityVerification.js";
import {
  DefaultAuthorityVerificationPort,
  createAuthorityTrustedKeyring,
  createInMemoryAuthorityArtifactAttestationIndex,
  createInMemoryAuthorityDelegationIndex,
} from "../src/DefaultAuthorityVerificationPort.js";
import { issueDelegationStatusEvidence } from "../src/DelegationStatusIssuer.js";
import { issueAuthorityArtifactIntegrityEvidence } from "../src/AuthorityArtifactIntegrityIssuer.js";

const T_DECISION = "2026-09-16T00:00:00.000Z";

function canonical<T extends {
  readonly artifact_id: string;
  readonly artifact_type: string;
  readonly references: readonly ArtifactReference[];
}>(draft: T): T & { readonly content_hash: ContentHash } {
  return {
    ...draft,
    content_hash: sha256ContentHash(draft),
  };
}

function loose(artifact: ArtifactContract): ArtifactReference {
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

async function persistAuthorityArtifact(
  repository: CasBackedArtifactRepository,
  artifact: ArtifactContract,
  signing: SigningKeyProvider,
): Promise<ContentReference> {
  await repository.put({
    artifact_id: artifact.artifact_id,
    content_hash: artifact.content_hash,
    body: artifact,
  });
  const issued = await issueAuthorityArtifactIntegrityEvidence({
    artifact_ref: pinned(artifact),
    signing,
    writer: repository,
  });
  return issued.reference;
}

async function fixture(extraGraph: "none" | "ambiguous" | "cycle" = "none") {
  const repository = new CasBackedArtifactRepository(new MemoryByteStorageBackend());
  const integrity = LocalPemSigningKeyProvider.generate("ed25519:authority-integrity");
  const root = LocalPemSigningKeyProvider.generate("ed25519:authority-root");

  const rootIdentity = canonical({
    artifact_id: "identity-root",
    artifact_type: "identity",
    references: [],
    identity_name: "authority-root",
  });
  const userIdentity = canonical({
    artifact_id: "identity-user",
    artifact_type: "identity",
    references: [],
    identity_name: "user-1",
  });

  const rootLifecycle = canonical({
    artifact_id: "lifecycle-root",
    artifact_type: "actor_lifecycle",
    references: [],
    state: "active",
    effective_from: "2026-01-01T00:00:00.000Z",
  }) satisfies ActorLifecycleArtifact;
  const userLifecycle = canonical({
    artifact_id: "lifecycle-user",
    artifact_type: "actor_lifecycle",
    references: [],
    state: "active",
    effective_from: "2026-01-01T00:00:00.000Z",
  }) satisfies ActorLifecycleArtifact;

  const domainDraft = {
    artifact_id: "domain-production",
    artifact_type: "trust_domain" as const,
    references: [],
    anchor_ref: { artifact_id: "anchor-production", artifact_type: "trust_anchor" },
    domain_name: "production",
  };
  const domain = canonical(domainDraft) satisfies TrustDomainArtifact;

  const rootActor = canonical({
    artifact_id: "actor-root",
    artifact_type: "actor",
    references: [],
    kind: "system",
    identity_ref: loose(rootIdentity),
    identity_hash: rootIdentity.content_hash,
    trust_domain_ref: loose(domain),
    lifecycle_ref: loose(rootLifecycle),
  }) satisfies ActorArtifact;
  const userActor = canonical({
    artifact_id: "actor-user",
    artifact_type: "actor",
    references: [],
    kind: "human",
    identity_ref: loose(userIdentity),
    identity_hash: userIdentity.content_hash,
    trust_domain_ref: loose(domain),
    lifecycle_ref: loose(userLifecycle),
  }) satisfies ActorArtifact;

  const anchor = canonical({
    artifact_id: "anchor-production",
    artifact_type: "trust_anchor",
    references: [],
    anchor_name: "production",
    governance_profile: "authority-v1",
    root_actor_ref: loose(rootActor),
    root_actor_hash: rootActor.content_hash,
    verification_key_id: root.provider.keyId,
  }) satisfies TrustAnchorArtifact;

  const capability = canonical({
    artifact_id: "capability-promote",
    artifact_type: "capability",
    references: [],
    capability_name: "governance.promote",
    description: "Promote governed content",
  }) satisfies CapabilityArtifact;
  const scope = canonical({
    artifact_id: "scope-production",
    artifact_type: "capability_scope",
    references: [],
    capability_ref: loose(capability),
    scope_name: "production",
    constraints: {},
  }) satisfies CapabilityScopeArtifact;
  const grant = canonical({
    artifact_id: "grant-user-promote",
    artifact_type: "capability_grant",
    references: [],
    actor_ref: loose(userActor),
    actor_hash: userActor.content_hash,
    capability_ref: loose(capability),
    capability_hash: capability.content_hash,
    scope_ref: loose(scope),
    scope_hash: scope.content_hash,
  }) satisfies CapabilityGrantArtifact;

  const direct = canonical({
    artifact_id: "delegation-root-user",
    artifact_type: "trust_delegation",
    references: [],
    from_actor_ref: loose(rootActor),
    to_actor_ref: loose(userActor),
    domain_ref: loose(domain),
    authority_scope: "production",
    valid_from: "2026-01-01T00:00:00.000Z",
    valid_until: "2027-01-01T00:00:00.000Z",
  }) satisfies TrustDelegationArtifact;

  const artifacts: ArtifactContract[] = [
    rootIdentity,
    userIdentity,
    rootLifecycle,
    userLifecycle,
    domain,
    rootActor,
    userActor,
    anchor,
    capability,
    scope,
    grant,
    direct,
  ];

  const graphDelegations: TrustDelegationArtifact[] = [direct];

  if (extraGraph === "ambiguous") {
    const mid = { artifact_id: "actor-mid", artifact_type: "actor" };
    graphDelegations.push(
      canonical({
        artifact_id: "delegation-root-mid",
        artifact_type: "trust_delegation",
        references: [],
        from_actor_ref: loose(rootActor),
        to_actor_ref: mid,
        domain_ref: loose(domain),
        authority_scope: "production",
        valid_from: "2026-01-01T00:00:00.000Z",
        valid_until: "2027-01-01T00:00:00.000Z",
      }) satisfies TrustDelegationArtifact,
      canonical({
        artifact_id: "delegation-mid-user",
        artifact_type: "trust_delegation",
        references: [],
        from_actor_ref: mid,
        to_actor_ref: loose(userActor),
        domain_ref: loose(domain),
        authority_scope: "production",
        valid_from: "2026-01-01T00:00:00.000Z",
        valid_until: "2027-01-01T00:00:00.000Z",
      }) satisfies TrustDelegationArtifact,
    );
  } else if (extraGraph === "cycle") {
    graphDelegations.push(
      canonical({
        artifact_id: "delegation-user-root",
        artifact_type: "trust_delegation",
        references: [],
        from_actor_ref: loose(userActor),
        to_actor_ref: loose(rootActor),
        domain_ref: loose(domain),
        authority_scope: "production",
        valid_from: "2026-01-01T00:00:00.000Z",
        valid_until: "2027-01-01T00:00:00.000Z",
      }) satisfies TrustDelegationArtifact,
    );
  }

  for (const delegation of graphDelegations.slice(1)) artifacts.push(delegation);

  const attestationEntries: Array<readonly [PinnedArtifactReference, ContentReference]> = [];
  for (const artifact of artifacts) {
    const attestationRef = await persistAuthorityArtifact(
      repository,
      artifact,
      integrity.provider,
    );
    attestationEntries.push([pinned(artifact), attestationRef]);
  }

  const status = await issueDelegationStatusEvidence({
    delegation_ref: pinned(direct),
    status: "ACTIVE",
    evaluated_at: T_DECISION,
    signing: root.provider,
    writer: repository,
  });

  const keyring = createAuthorityTrustedKeyring(
    new Map([
      [integrity.provider.keyId, integrity.publicKey],
      [root.provider.keyId, root.publicKey],
    ]),
  );
  const delegationIndex = createInMemoryAuthorityDelegationIndex(
    graphDelegations.map((delegation) => [pinned(domain), pinned(delegation)] as const),
  );
  const port = new DefaultAuthorityVerificationPort({
    artifactResolver: repository.resolver,
    trustedKeyring: keyring,
    artifactAttestations: createInMemoryAuthorityArtifactAttestationIndex(attestationEntries),
    delegationIndex,
  });

  const request: AuthorityVerificationRequest = {
    decision_time: T_DECISION,
    required_capability: "governance.promote",
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
        delegation_ref: pinned(direct),
        delegator_actor_ref: pinned(rootActor),
        delegator_lifecycle_ref: pinned(rootLifecycle),
        delegatee_actor_ref: pinned(userActor),
        delegatee_lifecycle_ref: pinned(userLifecycle),
        status_attestation_ref: status.reference,
      },
    ],
  };

  return { repository, port, request, status, direct };
}

describe("MINIMUM-AUTHORITY-DELTA-02 — concrete runtime enforcement", () => {
  it("verifies a complete CAS-backed, attested authority closure", async () => {
    const f = await fixture();
    const result = await verifyAuthorityAtDecisionTime(f.port, f.request);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.closure.decision_time).toBe(T_DECISION);
    expect(result.closure.verification_evidence_refs).toContainEqual(f.status.reference);
  });

  it("rejects an ambiguous graph even when the supplied path itself is valid", async () => {
    const f = await fixture("ambiguous");
    const result = await verifyAuthorityAtDecisionTime(f.port, f.request);
    expect(result.ok).toBe(false);
    if ("reason" in result) {
      expect(result.reason).toContain("non-canonical or ambiguous path");
    }
  });

  it("rejects every root-reachable cycle, including one that starts after target", async () => {
    const f = await fixture("cycle");
    const result = await verifyAuthorityAtDecisionTime(f.port, f.request);
    expect(result.ok).toBe(false);
    if ("reason" in result) {
      expect(result.reason).toContain("non-canonical or ambiguous path");
    }
  });

  it("binds delegation status to exact T_decision and rejects stale evidence", async () => {
    const f = await fixture();
    const result = await verifyAuthorityAtDecisionTime(f.port, {
      ...f.request,
      decision_time: "2026-09-17T00:00:00.000Z",
    });
    expect(result.ok).toBe(false);
    if ("reason" in result) {
      expect(result.reason).toContain("evaluated_at != decision_time");
    }
  });
});
