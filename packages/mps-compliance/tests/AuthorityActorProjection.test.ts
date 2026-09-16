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

const LIFECYCLE_REF = {
  artifact_id: "actor-lifecycle-existing-proof",
  artifact_type: "actor_lifecycle",
} as const;

describe("MINIMUM-AUTHORITY-DELTA-04A — canonical Actor projection", () => {
  it("projects the canonical LU ServiceIdentity deterministically without creating new authority", () => {
    const identity = createServiceIdentityArtifact({
      service_namespace: "mimer.lu",
      principal_id: LU_EXECUTION_PRINCIPAL_ID,
    });

    const first = createActorArtifact({
      identity,
      trust_domain_ref: TRUST_DOMAIN_REF,
      lifecycle_ref: LIFECYCLE_REF,
    });
    const second = createActorArtifact({
      identity,
      trust_domain_ref: TRUST_DOMAIN_REF,
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
        trust_domain_ref: TRUST_DOMAIN_REF,
        lifecycle_ref: LIFECYCLE_REF,
      }).kind,
    ).toBe("human");

    expect(
      createActorArtifact({
        identity: service,
        trust_domain_ref: TRUST_DOMAIN_REF,
        lifecycle_ref: LIFECYCLE_REF,
      }).kind,
    ).toBe("service");
  });

  it("keeps actor projection bound to exact identity/domain/lifecycle inputs", () => {
    const identity = createServiceIdentityArtifact({
      service_namespace: "mimer.lu",
      principal_id: LU_EXECUTION_PRINCIPAL_ID,
    });

    const baseline = createActorArtifact({
      identity,
      trust_domain_ref: TRUST_DOMAIN_REF,
      lifecycle_ref: LIFECYCLE_REF,
    });
    const otherDomain = createActorArtifact({
      identity,
      trust_domain_ref: {
        artifact_id: "trust-domain-other",
        artifact_type: "trust_domain",
      },
      lifecycle_ref: LIFECYCLE_REF,
    });
    const otherLifecycle = createActorArtifact({
      identity,
      trust_domain_ref: TRUST_DOMAIN_REF,
      lifecycle_ref: {
        artifact_id: "actor-lifecycle-other",
        artifact_type: "actor_lifecycle",
      },
    });

    expect(otherDomain.artifact_id).not.toBe(baseline.artifact_id);
    expect(otherLifecycle.artifact_id).not.toBe(baseline.artifact_id);
    expect(otherDomain.content_hash).not.toEqual(baseline.content_hash);
    expect(otherLifecycle.content_hash).not.toEqual(baseline.content_hash);
  });

  it("fails closed when actor identity binding is tampered", () => {
    const identity = createServiceIdentityArtifact({
      service_namespace: "mimer.lu",
      principal_id: LU_EXECUTION_PRINCIPAL_ID,
    });
    const actor = createActorArtifact({
      identity,
      trust_domain_ref: TRUST_DOMAIN_REF,
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
      trust_domain_ref: TRUST_DOMAIN_REF,
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

  it("rejects empty domain/lifecycle references instead of inventing defaults", () => {
    const identity = createServiceIdentityArtifact({
      service_namespace: "mimer.lu",
      principal_id: LU_EXECUTION_PRINCIPAL_ID,
    });

    expect(() =>
      createActorArtifact({
        identity,
        trust_domain_ref: {
          artifact_id: "",
          artifact_type: "trust_domain",
        },
        lifecycle_ref: LIFECYCLE_REF,
      }),
    ).toThrow("trust_domain_ref is required");

    expect(() =>
      createActorArtifact({
        identity,
        trust_domain_ref: TRUST_DOMAIN_REF,
        lifecycle_ref: {
          artifact_id: "",
          artifact_type: "actor_lifecycle",
        },
      }),
    ).toThrow("lifecycle_ref is required");
  });
});
