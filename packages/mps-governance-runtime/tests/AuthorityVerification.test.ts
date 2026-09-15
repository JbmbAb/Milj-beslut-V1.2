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
  type AuthorityVerificationRequest,
  type DelegationStatusPredicate,
  type VerifiedAuthorityArtifact,
} from "../src/AuthorityVerification.js";

const T_DECISION = "2026-09-16T00:00:00.000Z";

function h(value: string): ContentHash {
  return { algorithm: "sha256", value };
}

function base(
  artifact_id: string,
  artifact_type: string,
  value = artifact_id.padEnd(64, "0").slice(0, 64),
): ArtifactContract {
  return {
    artifact_id,
    artifact_type,
    content_hash: h(value),
    references: [],
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

function attestationRef(id: string, attestation: ArtifactAttestation): ContentReference {
  const hash = sha256ContentHash(attestation);
  return {
    id,
    content_hash: { algorithm: hash.algorithm, digest: hash.value },
  };
}

type Fixture = Awaited<ReturnType<typeof fixture>>;

async function fixture(options: {
  readonly status?: "ACTIVE" | "REVOKED";
  readonly signer?: LocalPemSigningKeyProvider;
  readonly validUntil?: string;
  readonly canonicalPath?: boolean;
} = {}) {
  const rootKey = LocalPemSigningKeyProvider.generate("authority-root");
  const signing = options.signer ?? rootKey;

  const identity = base("identity-user", "identity", "1".repeat(64));
  const rootIdentity = base("identity-root", "identity", "2".repeat(64));

  const lifecycle = {
    ...base("lifecycle-user", "actor_lifecycle", "3".repeat(64)),
    state: "active",
    effective_from: "2026-01-01T00:00:00.000Z",
  } satisfies ActorLifecycleArtifact;

  const rootLifecycle = {
    ...base("lifecycle-root", "actor_lifecycle", "4".repeat(64)),
    state: "active",
    effective_from: "2020-01-01T00:00:00.000Z",
  } satisfies ActorLifecycleArtifact;

  const domain = {
    ...base("domain-1", "trust_domain", "5".repeat(64)),
    anchor_ref: { artifact_id: "anchor-1", artifact_type: "trust_anchor" },
    domain_name: "production",
  } satisfies TrustDomainArtifact;

  const actor = {
    ...base("actor-user", "actor", "6".repeat(64)),
    kind: "human",
    identity_ref: { artifact_id: identity.artifact_id, artifact_type: identity.artifact_type },
    identity_hash: identity.content_hash,
    trust_domain_ref: { artifact_id: domain.artifact_id, artifact_type: domain.artifact_type },
    lifecycle_ref: { artifact_id: lifecycle.artifact_id, artifact_type: lifecycle.artifact_type },
  } satisfies ActorArtifact;

  const rootActor = {
    ...base("actor-root", "actor", "7".repeat(64)),
    kind: "system",
    identity_ref: { artifact_id: rootIdentity.artifact_id, artifact_type: rootIdentity.artifact_type },
    identity_hash: rootIdentity.content_hash,
    trust_domain_ref: { artifact_id: domain.artifact_id, artifact_type: domain.artifact_type },
    lifecycle_ref: { artifact_id: rootLifecycle.artifact_id, artifact_type: rootLifecycle.artifact_type },
  } satisfies ActorArtifact;

  const anchor = {
    ...base("anchor-1", "trust_anchor", "8".repeat(64)),
    anchor_name: "production-root",
    governance_profile: "authority-v1",
    root_actor_ref: { artifact_id: rootActor.artifact_id, artifact_type: rootActor.artifact_type },
    root_actor_hash: rootActor.content_hash,
    verification_key_id: rootKey.keyId,
  } satisfies TrustAnchorArtifact;

  const capability = {
    ...base("capability-approve", "capability", "9".repeat(64)),
    capability_name: "governance.approve",
    description: "Approve governed mutation",
  } satisfies CapabilityArtifact;

  const scope = {
    ...base("scope-production", "capability_scope", "a".repeat(64)),
    capability_ref: { artifact_id: capability.artifact_id, artifact_type: capability.artifact_type },
    scope_name: "production",
    constraints: {},
  } satisfies CapabilityScopeArtifact;

  const grant = {
    ...base("grant-user", "capability_grant", "b".repeat(64)),
    actor_ref: { artifact_id: actor.artifact_id, artifact_type: actor.artifact_type },
    actor_hash: actor.content_hash,
    capability_ref: { artifact_id: capability.artifact_id, artifact_type: capability.artifact_type },
    capability_hash: capability.content_hash,
    scope_ref: { artifact_id: scope.artifact_id, artifact_type: scope.artifact_type },
    scope_hash: scope.content_hash,
  } satisfies CapabilityGrantArtifact;

  const delegation = {
    ...base("delegation-1", "trust_delegation", "c".repeat(64)),
    from_actor_ref: { artifact_id: rootActor.artifact_id, artifact_type: rootActor.artifact_type },
    to_actor_ref: { artifact_id: actor.artifact_id, artifact_type: actor.artifact_type },
    domain_ref: { artifact_id: domain.artifact_id, artifact_type: domain.artifact_type },
    authority_scope: "production",
    valid_from: "2026-01-01T00:00:00.000Z",
    valid_until: options.validUntil ?? "2027-01-01T00:00:00.000Z",
  } satisfies TrustDelegationArtifact;

  const status = options.status ?? "ACTIVE";
  const predicate: DelegationStatusPredicate = {
    delegation_artifact_id: delegation.artifact_id,
    delegation_content_hash: delegation.content_hash.value,
    status,
    evaluated_at: T_DECISION,
    ...(status === "REVOKED" ? { revoked_at: "2026-09-01T00:00:00.000Z" } : {}),
    attestation_schema_version: DELEGATION_STATUS_SCHEMA_VERSION,
    signer_key_id: signing.keyId,
  };
  const statusAttestation = await createArtifactAttestation({
    subjectDigest: `sha256:${delegation.content_hash.value}`,
    predicateType: DELEGATION_STATUS_PREDICATE_TYPE,
    predicate: predicate as unknown as Record<string, unknown>,
    signing,
  });
  const statusRef = attestationRef("att-delegation-status", statusAttestation);

  const artifacts: ArtifactContract[] = [
    identity,
    rootIdentity,
    lifecycle,
    rootLifecycle,
    domain,
    actor,
    rootActor,
    anchor,
    capability,
    scope,
    grant,
    delegation,
  ];
  const artifactMap = new Map(artifacts.map((item) => [item.artifact_id, item]));
  const attestationMap = new Map([[statusRef.id, statusAttestation]]);
  const keyMap = new Map<string, VerificationKeyProvider>([[rootKey.keyId, rootKey]]);
  if (signing.keyId !== rootKey.keyId) keyMap.set(signing.keyId, signing);

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
        throw new Error("REJECT_AUTHORITY_REFERENCE: test pinned mismatch");
      }
      return { artifact: artifact as T };
    },
    async resolvePinnedAttestation(reference: ContentReference): Promise<ArtifactAttestation> {
      const attestation = attestationMap.get(reference.id);
      if (!attestation) throw new Error("TEST_ATTESTATION_NOT_FOUND");
      const hash = sha256ContentHash(attestation);
      if (
        hash.algorithm !== reference.content_hash.algorithm ||
        hash.value !== reference.content_hash.digest
      ) {
        throw new Error("REJECT_AUTHORITY_REFERENCE: attestation pinned mismatch");
      }
      return attestation;
    },
    async resolveTrustedVerificationKey(keyId: string) {
      return keyMap.get(keyId) ?? null;
    },
    async assertCanonicalDelegationPath({ delegation_refs }) {
      return (
        (options.canonicalPath ?? true) &&
        delegation_refs.length === 1 &&
        delegation_refs[0]!.artifact_id === delegation.artifact_id
      );
    },
  };

  const request: AuthorityVerificationRequest = {
    decision_time: T_DECISION,
    required_capability: "governance.approve",
    required_scope: "production",
    actor_identity_ref: pinned(identity),
    actor_ref: pinned(actor),
    actor_lifecycle_ref: pinned(lifecycle),
    capability_ref: pinned(capability),
    capability_scope_ref: pinned(scope),
    capability_grant_ref: pinned(grant),
    trust_domain_ref: pinned(domain),
    trust_anchor_ref: pinned(anchor),
    trust_root_actor_ref: pinned(rootActor),
    delegation_path: [{ delegation_ref: pinned(delegation), status_attestation_ref: statusRef }],
  };

  return {
    port,
    request,
    rootKey,
    delegation,
    grant,
    actor,
    statusRef,
    statusAttestation,
  };
}

describe("MINIMUM-AUTHORITY-DELTA-01 — authority verification", () => {
  it("accepts one canonical, active, attested authority closure at T_decision", async () => {
    const f = await fixture();
    const result = await verifyAuthorityAtDecisionTime(f.port, f.request);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.closure.decision_time).toBe(T_DECISION);
    expect(result.closure.authority_refs.some((ref) => ref.artifact_id === "grant-user")).toBe(true);
    expect(result.closure.verification_evidence_refs).toContainEqual(f.statusRef);
  });

  it("rejects a valid signature from a key that is not the trust-anchor key", async () => {
    const attacker = LocalPemSigningKeyProvider.generate("attacker");
    const f = await fixture({ signer: attacker });
    const result = await verifyAuthorityAtDecisionTime(f.port, f.request);
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.reason).toContain("signer is not trust anchor key");
  });

  it("rejects an expired delegation at decision time", async () => {
    const f = await fixture({ validUntil: "2026-09-01T00:00:00.000Z" });
    const result = await verifyAuthorityAtDecisionTime(f.port, f.request);
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.reason).toContain("expired at decision_time");
  });

  it("rejects a revocation status attestation", async () => {
    const f = await fixture({ status: "REVOKED" });
    const result = await verifyAuthorityAtDecisionTime(f.port, f.request);
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.reason).toContain("delegation revoked");
  });

  it("rejects a tampered content-hash-pinned authority reference", async () => {
    const f = await fixture();
    const request: AuthorityVerificationRequest = {
      ...f.request,
      capability_grant_ref: {
        ...f.request.capability_grant_ref,
        content_hash: { algorithm: "sha256", digest: "f".repeat(64) },
      },
    };
    const result = await verifyAuthorityAtDecisionTime(f.port, request);
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.reason).toContain("pinned mismatch");
  });

  it("rejects a non-canonical/ambiguous delegation path", async () => {
    const f = await fixture({ canonicalPath: false });
    const result = await verifyAuthorityAtDecisionTime(f.port, f.request);
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.reason).toContain("non-canonical or ambiguous path");
  });

  it("uses persisted T_decision, not wall clock, for historical replay semantics", async () => {
    const f = await fixture({ validUntil: "2026-10-01T00:00:00.000Z" });

    const historical = await verifyAuthorityAtDecisionTime(f.port, f.request);
    expect(historical.ok).toBe(true);

    const replayAtNow: AuthorityVerificationRequest = {
      ...f.request,
      decision_time: "2026-11-01T00:00:00.000Z",
    };
    const current = await verifyAuthorityAtDecisionTime(f.port, replayAtNow);
    expect(current.ok).toBe(false);
    if (!current.ok) {
      // It may reject status-time binding before or after the intrinsic expiry check;
      // either way proves that the supplied evaluation instant is load-bearing.
      expect(current.reason).toMatch(/expired at decision_time|evaluated_at != decision_time/);
    }
  });
});
