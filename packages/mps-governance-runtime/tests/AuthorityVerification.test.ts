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
  AUTHORITY_DECISION_BINDING_VERSION,
  toAuthorityDecisionBinding,
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


async function fixture(options: {
  readonly status?: "ACTIVE" | "REVOKED";
  readonly signer?: LocalPemSigningKeyProvider;
  readonly validUntil?: string;
  readonly canonicalPath?: boolean;
} = {}) {
  const rootKeyPair = LocalPemSigningKeyProvider.generate("authority-root");
  const rootKey = rootKeyPair.provider;
  const signing = options.signer ?? rootKey;

  const identity = base("identity-user", "identity", "1".repeat(64));
  const rootIdentity = base("identity-root", "identity", "2".repeat(64));

  const lifecycle = {
    ...base("lifecycle-user", "actor_lifecycle", "3".repeat(64)),
    identity_ref: { artifact_id: identity.artifact_id, artifact_type: identity.artifact_type },
    identity_hash: identity.content_hash,
    state: "ACTIVE",
    effective_from: "2026-01-01T00:00:00.000Z",
  } satisfies ActorLifecycleArtifact;

  const rootLifecycle = {
    ...base("lifecycle-root", "actor_lifecycle", "4".repeat(64)),
    identity_ref: { artifact_id: rootIdentity.artifact_id, artifact_type: rootIdentity.artifact_type },
    identity_hash: rootIdentity.content_hash,
    state: "ACTIVE",
    effective_from: "2020-01-01T00:00:00.000Z",
  } satisfies ActorLifecycleArtifact;

  const domain = {
    ...base("domain-1", "trust_domain", "5".repeat(64)),
    anchor_ref: { artifact_id: "anchor-1", artifact_type: "trust_anchor" },
    anchor_hash: h("8".repeat(64)),
    domain_name: "production",
    authority_scope: "production",
    constraints: [],
    allowed_actor_types: ["human"],
    delegation_rules: ["actor-delegation"],
  } satisfies TrustDomainArtifact;

  const actor = {
    ...base("actor-user", "actor", "6".repeat(64)),
    kind: "human",
    identity_ref: { artifact_id: identity.artifact_id, artifact_type: identity.artifact_type },
    identity_hash: identity.content_hash,
    trust_domain_refs: [
      { artifact_id: domain.artifact_id, artifact_type: domain.artifact_type },
    ],
    lifecycle_ref: { artifact_id: lifecycle.artifact_id, artifact_type: lifecycle.artifact_type },
  } satisfies ActorArtifact;

  const rootActor = {
    ...base("actor-root", "actor", "7".repeat(64)),
    kind: "system",
    identity_ref: { artifact_id: rootIdentity.artifact_id, artifact_type: rootIdentity.artifact_type },
    identity_hash: rootIdentity.content_hash,
    trust_domain_refs: [],
    lifecycle_ref: { artifact_id: rootLifecycle.artifact_id, artifact_type: rootLifecycle.artifact_type },
  } satisfies ActorArtifact;

  const anchor = {
    ...base("anchor-1", "trust_anchor", "8".repeat(64)),
    anchor_name: "production-root",
    governance_profile: "authority-v1",
    root_binding_type: "actor",
    root_ref: { artifact_id: rootActor.artifact_id, artifact_type: rootActor.artifact_type },
    root_hash: rootActor.content_hash,
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
    actor_ref: pinned(actor),
    actor_lifecycle_ref: pinned(lifecycle),
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
        delegatee_actor_ref: pinned(actor),
        delegatee_lifecycle_ref: pinned(lifecycle),
        status_attestation_ref: statusRef,
      },
    ],
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
    const binding = toAuthorityDecisionBinding(result.closure);
    expect(binding.authority_binding_version).toBe(AUTHORITY_DECISION_BINDING_VERSION);
    expect(binding.decision_time).toBe(T_DECISION);
    expect(binding.authority_refs).toEqual(result.closure.authority_refs);
  });

  it("rejects a valid signature from a key that is not the trust-anchor key", async () => {
    const attacker = LocalPemSigningKeyProvider.generate("attacker").provider;
    const f = await fixture({ signer: attacker });
    const result = await verifyAuthorityAtDecisionTime(f.port, f.request);
    expect(result).toMatchObject({ ok: false });
    if ("reason" in result) expect(result.reason).toContain("signer is not trust anchor key");
  });

  it("rejects an expired delegation at decision time", async () => {
    const f = await fixture({ validUntil: "2026-09-01T00:00:00.000Z" });
    const result = await verifyAuthorityAtDecisionTime(f.port, f.request);
    expect(result).toMatchObject({ ok: false });
    if ("reason" in result) expect(result.reason).toContain("expired at decision_time");
  });

  it("rejects a revocation status attestation", async () => {
    const f = await fixture({ status: "REVOKED" });
    const result = await verifyAuthorityAtDecisionTime(f.port, f.request);
    expect(result).toMatchObject({ ok: false });
    if ("reason" in result) expect(result.reason).toContain("delegation revoked");
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
    if ("reason" in result) expect(result.reason).toContain("pinned mismatch");
  });

  it("rejects a non-canonical/ambiguous delegation path", async () => {
    const f = await fixture({ canonicalPath: false });
    const result = await verifyAuthorityAtDecisionTime(f.port, f.request);
    expect(result).toMatchObject({ ok: false });
    if ("reason" in result) expect(result.reason).toContain("non-canonical or ambiguous path");
  });


  it("rejects a grant bound to a different actor", async () => {
    const f = await fixture();
    const wrongGrant = {
      ...f.grant,
      actor_ref: { artifact_id: "actor-other", artifact_type: "actor" },
    };
    const wrongGrantRef = pinned(wrongGrant);
    const original = f.port.resolveVerifiedArtifact.bind(f.port);
    const port: AuthorityVerificationPort = {
      ...f.port,
      async resolveVerifiedArtifact<T extends ArtifactContract>(reference: PinnedArtifactReference) {
        if (reference.artifact_id === wrongGrant.artifact_id) {
          return { artifact: wrongGrant as unknown as T };
        }
        return original(reference) as Promise<VerifiedAuthorityArtifact<T>>;
      },
    };
    const result = await verifyAuthorityAtDecisionTime(port, {
      ...f.request,
      capability_grant_ref: wrongGrantRef,
    });
    expect(result).toMatchObject({ ok: false });
    if ("reason" in result) expect(result.reason).toContain("actor/capability/scope binding mismatch");
  });

  it("rejects the wrong capability for the requested action", async () => {
    const f = await fixture();
    const result = await verifyAuthorityAtDecisionTime(f.port, {
      ...f.request,
      required_capability: "governance.delete",
    });
    expect(result).toMatchObject({ ok: false });
    if ("reason" in result) expect(result.reason).toContain("capability name mismatch");
  });

  it("rejects a requested scope not bound by the trust-domain authority scope", async () => {
    const f = await fixture();
    const result = await verifyAuthorityAtDecisionTime(f.port, {
      ...f.request,
      required_scope: "staging",
    });
    expect(result).toMatchObject({ ok: false });
    if ("reason" in result) {
      expect(result.reason).toContain("REJECT_TRUST_ROOT");
    }
  });

  it("fails closed instead of recasting a source-authority root as an Actor root", async () => {
    const f = await fixture();
    const sourceRoot = base("source-root", "source_authority_root", "d".repeat(64));
    const sourceAnchor = {
      ...base("source-anchor", "trust_anchor", "e".repeat(64)),
      anchor_name: "source-authority-root",
      governance_profile: "authority-v1",
      root_binding_type: "authority_artifact",
      root_ref: {
        artifact_id: sourceRoot.artifact_id,
        artifact_type: sourceRoot.artifact_type,
      },
      root_hash: sourceRoot.content_hash,
    } satisfies TrustAnchorArtifact;
    const sourceDomain = {
      ...base("source-domain", "trust_domain", "f".repeat(64)),
      anchor_ref: {
        artifact_id: sourceAnchor.artifact_id,
        artifact_type: sourceAnchor.artifact_type,
      },
      anchor_hash: sourceAnchor.content_hash,
      domain_name: "production-source-root",
      authority_scope: "production",
      constraints: [],
      allowed_actor_types: ["human"],
      delegation_rules: ["source-authority-chain"],
    } satisfies TrustDomainArtifact;
    const sourceActor = {
      ...f.actor,
      content_hash: h("0".repeat(64)),
      trust_domain_refs: [
        {
          artifact_id: sourceDomain.artifact_id,
          artifact_type: sourceDomain.artifact_type,
        },
      ],
    } satisfies ActorArtifact;

    const original = f.port.resolveVerifiedArtifact.bind(f.port);
    const additional = new Map<string, ArtifactContract>([
      [sourceRoot.artifact_id, sourceRoot],
      [sourceAnchor.artifact_id, sourceAnchor],
      [sourceDomain.artifact_id, sourceDomain],
      [sourceActor.artifact_id, sourceActor],
    ]);
    const port: AuthorityVerificationPort = {
      ...f.port,
      async resolveVerifiedArtifact<T extends ArtifactContract>(
        reference: PinnedArtifactReference,
      ): Promise<VerifiedAuthorityArtifact<T>> {
        const artifact = additional.get(reference.artifact_id);
        if (artifact) {
          if (
            artifact.artifact_type !== reference.artifact_type ||
            artifact.content_hash.algorithm !== reference.content_hash.algorithm ||
            artifact.content_hash.value !== reference.content_hash.digest
          ) {
            throw new Error("REJECT_AUTHORITY_REFERENCE: source-root test pinned mismatch");
          }
          return { artifact: artifact as T };
        }
        return original(reference) as Promise<VerifiedAuthorityArtifact<T>>;
      },
    };

    const result = await verifyAuthorityAtDecisionTime(port, {
      ...f.request,
      actor_ref: pinned(sourceActor),
      trust_domain_ref: pinned(sourceDomain),
      trust_anchor_ref: pinned(sourceAnchor),
    });
    expect(result.ok).toBe(false);
    if ("reason" in result) {
      expect(result.reason).toContain(
        "source-authority root requires AuthorityEvidence source closure",
      );
    }
  });

  it("rejects an alternate trust root even when the rest of the closure is valid", async () => {
    const f = await fixture();
    const alternateRoot = {
      ...f.request.trust_root_actor_ref,
      artifact_id: "actor-alternate-root",
    };
    const result = await verifyAuthorityAtDecisionTime(f.port, {
      ...f.request,
      trust_root_actor_ref: alternateRoot,
      delegation_path: [
        {
          ...f.request.delegation_path[0]!,
          delegator_actor_ref: alternateRoot,
        },
      ],
    });
    expect(result).toMatchObject({ ok: false });
  });

  it("rejects missing delegation-status authority evidence", async () => {
    const f = await fixture();
    const missingStatus: ContentReference = {
      id: "missing-status",
      content_hash: { algorithm: "sha256", digest: "d".repeat(64) },
    };
    const result = await verifyAuthorityAtDecisionTime(f.port, {
      ...f.request,
      delegation_path: [
        {
          ...f.request.delegation_path[0]!,
          status_attestation_ref: missingStatus,
        },
      ],
    });
    expect(result).toMatchObject({ ok: false });
    if ("reason" in result) expect(result.reason).toContain("TEST_ATTESTATION_NOT_FOUND");
  });

  it("rejects a cryptographically tampered delegation-status signature", async () => {
    const f = await fixture();
    const tampered: ArtifactAttestation = {
      ...f.statusAttestation,
      signature: `${f.statusAttestation.signature.slice(0, -4)}AAAA`,
    };
    const tamperedRef = attestationRef("att-delegation-status-tampered", tampered);
    const originalAttestationResolver = f.port.resolvePinnedAttestation.bind(f.port);
    const port: AuthorityVerificationPort = {
      ...f.port,
      async resolvePinnedAttestation(reference: ContentReference) {
        if (reference.id === tamperedRef.id) return tampered;
        return originalAttestationResolver(reference);
      },
    };
    const result = await verifyAuthorityAtDecisionTime(port, {
      ...f.request,
      delegation_path: [
        {
          ...f.request.delegation_path[0]!,
          status_attestation_ref: tamperedRef,
        },
      ],
    });
    expect(result).toMatchObject({ ok: false });
    if ("reason" in result) expect(result.reason).toContain("invalid signature");
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
    if ("reason" in current) {
      // It may reject status-time binding before or after the intrinsic expiry check;
      // either way proves that the supplied evaluation instant is load-bearing.
      expect(current.reason).toMatch(/expired at decision_time|evaluated_at != decision_time/);
    }
  });
});
