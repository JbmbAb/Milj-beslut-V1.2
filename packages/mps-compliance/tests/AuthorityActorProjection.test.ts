import { describe, expect, it } from "vitest";
import {
  createActorArtifact,
  validateActorArtifact,
} from "../../mps-governance/src/actors/ActorArtifact";
import {
  createHumanIdentityArtifact,
  createServiceIdentityArtifact,
} from "../../mps-governance/src/actors/IdentityArtifacts";
import { LU_EXECUTION_PRINCIPAL_ID } from "../../mps-lu/src/execution/LuExecutionKernelClient";
import { LU_EXECUTION_AUTHORITY_SCOPE } from "../../mps-lu/src/artifacts/LuExecutionAuthorityArtifact";

const TRUST_DOMAIN_REF = {
  artifact_id: "trust-domain-existing-proof",
  artifact_type: "trust_domain",
} as const;

const OTHER_TRUST_DOMAIN_REF = {
  artifact_id: "trust-domain-other-proof",
  artifact_type: "trust_domain",
} as const;

const LIFECYCLE_REF = {
  artifact_id: "actor-lifecycle-existing-proof",
  artifact_type: "actor_lifecycle",
} as const;

describe("MINIMUM-AUTHORITY-DELTA-04A/04C — canonical Actor projection", () => {
  it("projects canonical LU ServiceIdentity without creating authority", () => {
    const identity = createServiceIdentityArtifact({
      service_namespace: "mimer.lu",
      principal_id: LU_EXECUTION_PRINCIPAL_ID,
    });

    const first = createActorArtifact({
      identity,
      trust_domain_refs: [TRUST_DOMAIN_REF],
      lifecycle_ref: LIFECYCLE_REF,
    });
    const second = createActorArtifact({
      identity,
      trust_domain_refs: [TRUST_DOMAIN_REF],
      lifecycle_ref: LIFECYCLE_REF,
    });

    expect(first).toEqual(second);
    expect(first.kind).toBe("service");
    expect(first.identity_ref).toEqual({
      artifact_id: identity.artifact_id,
      artifact_type: identity.artifact_type,
    });
    expect(first.identity_hash).toEqual(identity.content_hash);
    expect(first.references).toEqual([
      first.identity_ref,
      TRUST_DOMAIN_REF,
      LIFECYCLE_REF,
    ]);

    const serialized = JSON.stringify(first);
    expect(serialized).not.toContain(LU_EXECUTION_AUTHORITY_SCOPE);
    expect(serialized).not.toContain("capability");
    expect(serialized).not.toContain("grant");
    expect(serialized).not.toContain("issuer");
    expect(serialized).not.toContain("root_key");
  });

  it("derives actor kind from identity type rather than caller authority input", () => {
    const human = createHumanIdentityArtifact("user-actor-projection-proof");
    const service = createServiceIdentityArtifact({
      service_namespace: "mimer.lu",
      principal_id: LU_EXECUTION_PRINCIPAL_ID,
    });

    expect(
      createActorArtifact({
        identity: human,
        trust_domain_refs: [TRUST_DOMAIN_REF],
        lifecycle_ref: LIFECYCLE_REF,
      }).kind,
    ).toBe("human");

    expect(
      createActorArtifact({
        identity: service,
        trust_domain_refs: [TRUST_DOMAIN_REF],
        lifecycle_ref: LIFECYCLE_REF,
      }).kind,
    ).toBe("service");
  });

  it("supports multiple trust domains while preserving the same canonical identity binding", () => {
    const identity = createServiceIdentityArtifact({
      service_namespace: "mimer.lu",
      principal_id: LU_EXECUTION_PRINCIPAL_ID,
    });

    const oneDomain = createActorArtifact({
      identity,
      trust_domain_refs: [TRUST_DOMAIN_REF],
      lifecycle_ref: LIFECYCLE_REF,
    });
    const twoDomains = createActorArtifact({
      identity,
      trust_domain_refs: [OTHER_TRUST_DOMAIN_REF, TRUST_DOMAIN_REF],
      lifecycle_ref: LIFECYCLE_REF,
    });

    expect(twoDomains.trust_domain_refs).toEqual([
      OTHER_TRUST_DOMAIN_REF,
      TRUST_DOMAIN_REF,
    ].sort((a, b) =>
      `${a.artifact_type}\u0000${a.artifact_id}`.localeCompare(
        `${b.artifact_type}\u0000${b.artifact_id}`,
      ),
    ));
    expect(twoDomains.identity_ref).toEqual(oneDomain.identity_ref);
    expect(twoDomains.identity_hash).toEqual(oneDomain.identity_hash);
    expect(twoDomains.artifact_id).not.toBe(oneDomain.artifact_id);
  });

  it("keeps stable identity across lifecycle representation changes", () => {
    const identity = createServiceIdentityArtifact({
      service_namespace: "mimer.lu",
      principal_id: LU_EXECUTION_PRINCIPAL_ID,
    });

    const active = createActorArtifact({
      identity,
      trust_domain_refs: [TRUST_DOMAIN_REF],
      lifecycle_ref: LIFECYCLE_REF,
    });
    const changedLifecycle = createActorArtifact({
      identity,
      trust_domain_refs: [TRUST_DOMAIN_REF],
      lifecycle_ref: {
        artifact_id: "actor-lifecycle-revoked-proof",
        artifact_type: "actor_lifecycle",
      },
    });

    expect(changedLifecycle.identity_ref).toEqual(active.identity_ref);
    expect(changedLifecycle.identity_hash).toEqual(active.identity_hash);
    expect(changedLifecycle.artifact_id).not.toBe(active.artifact_id);
  });

  it("fails closed when actor identity binding is tampered", () => {
    const identity = createServiceIdentityArtifact({
      service_namespace: "mimer.lu",
      principal_id: LU_EXECUTION_PRINCIPAL_ID,
    });
    const actor = createActorArtifact({
      identity,
      trust_domain_refs: [TRUST_DOMAIN_REF],
      lifecycle_ref: LIFECYCLE_REF,
    });

    expect(() =>
      validateActorArtifact(
        {
          ...actor,
          identity_hash: {
            algorithm: "sha256",
            value: "f".repeat(64),
          },
        },
        identity,
      ),
    ).toThrow("REJECT_CANONICAL_ACTOR");
  });

  it("fails closed when references are changed without canonical recomputation", () => {
    const identity = createServiceIdentityArtifact({
      service_namespace: "mimer.lu",
      principal_id: LU_EXECUTION_PRINCIPAL_ID,
    });
    const actor = createActorArtifact({
      identity,
      trust_domain_refs: [TRUST_DOMAIN_REF],
      lifecycle_ref: LIFECYCLE_REF,
    });

    expect(() =>
      validateActorArtifact(
        {
          ...actor,
          references: [
            actor.identity_ref!,
            {
              artifact_id: "trust-domain-attacker",
              artifact_type: "trust_domain",
            },
            actor.lifecycle_ref,
          ],
        },
        identity,
      ),
    ).toThrow("REJECT_CANONICAL_ACTOR");
  });

  it("allows zero domains but rejects duplicate domains and empty lifecycle references", () => {
    const identity = createServiceIdentityArtifact({
      service_namespace: "mimer.lu",
      principal_id: LU_EXECUTION_PRINCIPAL_ID,
    });

    const unaffiliated = createActorArtifact({
      identity,
      trust_domain_refs: [],
      lifecycle_ref: LIFECYCLE_REF,
    });
    expect(unaffiliated.trust_domain_refs).toEqual([]);
    expect(unaffiliated.identity_ref?.artifact_id).toBe(identity.artifact_id);

    expect(() =>
      createActorArtifact({
        identity,
        trust_domain_refs: [TRUST_DOMAIN_REF, TRUST_DOMAIN_REF],
        lifecycle_ref: LIFECYCLE_REF,
      }),
    ).toThrow("duplicate trust_domain_ref");

    expect(() =>
      createActorArtifact({
        identity,
        trust_domain_refs: [TRUST_DOMAIN_REF],
        lifecycle_ref: {
          artifact_id: "",
          artifact_type: "actor_lifecycle",
        },
      }),
    ).toThrow("lifecycle_ref is required");
  });
});
