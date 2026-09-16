import { describe, expect, it } from "vitest";
import { sha256ContentHash } from "../src/canonical/sha256Canonical";
import { ACT_21_I3 } from "../src/validators/ACT_21_I3";
import { ACT_21_I5 } from "../src/validators/ACT_21_I5";
import type { ArtifactContract } from "../src/artifacts/ArtifactContract";
import type { ValidationContext } from "../src/conformance/ValidationContext";
import {
  createActorArtifact,
} from "../../mps-governance/src/actors/ActorArtifact";
import {
  createActorLifecycleArtifact,
} from "../../mps-governance/src/actors/ActorLifecycleArtifact";
import {
  createAuthorityEvidenceArtifact,
} from "../../mps-governance/src/actors/AuthorityEvidenceArtifact";
import {
  createServiceIdentityArtifact,
} from "../../mps-governance/src/actors/IdentityArtifacts";
import {
  createTrustAnchorArtifact,
  validateTrustAnchorArtifact,
} from "../../mps-governance/src/actors/TrustAnchorArtifact";
import {
  createTrustDomainArtifact,
} from "../../mps-governance/src/actors/TrustDomainArtifact";
import {
  createLuExecutionAuthorityIssuerArtifact,
  createLuExecutionAuthorityRootArtifact,
  LU_EXECUTION_AUTHORITY_SCOPE,
} from "../../mps-lu/src/artifacts/LuExecutionAuthorityArtifact";
import { LU_EXECUTION_PRINCIPAL_ID } from "../../mps-lu/src/execution/LuExecutionKernelClient";

function sourceChain() {
  const root = createLuExecutionAuthorityRootArtifact({
    root_key_id: "ed25519:lu-root-04c",
    public_key_fingerprint: "lu-root-fingerprint-04c",
  });
  const issuer = createLuExecutionAuthorityIssuerArtifact({
    issuer_key_id: "ed25519:lu-issuer-04c",
    public_key_fingerprint: "lu-issuer-fingerprint-04c",
    root_ref: {
      artifact_id: root.artifact_id,
      artifact_type: root.artifact_type,
    },
  });

  const executionBody = {
    artifact_id: "execution-identity-04c-proof",
    artifact_type: "execution_identity",
    references: [
      {
        artifact_id: issuer.artifact_id,
        artifact_type: issuer.artifact_type,
      },
    ],
    actor_ref: {
      artifact_id: LU_EXECUTION_PRINCIPAL_ID,
      artifact_type: "execution_identity",
    },
  } as const;
  const executionIdentity = {
    ...executionBody,
    content_hash: sha256ContentHash(executionBody),
  };

  return { root, issuer, executionIdentity };
}


function validationContext(
  artifacts: readonly ArtifactContract[],
): ValidationContext {
  const byRef = new Map(
    artifacts.map((artifact) => [
      `${artifact.artifact_type}\u0000${artifact.artifact_id}`,
      artifact,
    ]),
  );
  return {
    artifacts,
    resolve(reference) {
      return byRef.get(
        `${reference.artifact_type}\u0000${reference.artifact_id}`,
      );
    },
  };
}

function genericModel() {
  const source = sourceChain();
  const identity = createServiceIdentityArtifact({
    service_namespace: "mimer.lu",
    principal_id: LU_EXECUTION_PRINCIPAL_ID,
  });
  const created = createActorLifecycleArtifact({
    identity,
    state: "CREATED",
    effective_from: "2026-09-01T00:00:00Z",
  });
  const active = createActorLifecycleArtifact({
    identity,
    state: "ACTIVE",
    effective_from: "2026-09-01T00:01:00Z",
    previous: created,
  });
  const anchor = createTrustAnchorArtifact({
    anchor_name: "LU execution authority",
    governance_profile: "ADR-24-21",
    root: source.root,
  });
  const domain = createTrustDomainArtifact({
    anchor,
    domain_name: "LU execution",
    authority_scope: LU_EXECUTION_AUTHORITY_SCOPE,
    constraints: [
      "allowed_artifact_type=execution_identity",
      "owner_provisioning=OWNER_PROVISIONED",
    ],
    allowed_actor_types: ["service"],
    delegation_rules: ["source-authority-chain"],
  });
  const actor = createActorArtifact({
    identity,
    trust_domain_refs: [
      {
        artifact_id: domain.artifact_id,
        artifact_type: domain.artifact_type,
      },
    ],
    lifecycle_ref: {
      artifact_id: active.artifact_id,
      artifact_type: active.artifact_type,
    },
  });

  return { ...source, identity, created, active, anchor, domain, actor };
}

describe("MINIMUM-AUTHORITY-DELTA-04C — generic trust model reconciliation", () => {

  it("validates zero-or-more ACT-21-I3 domain participation", () => {
    const model = genericModel();
    const unaffiliated = createActorArtifact({
      identity: model.identity,
      trust_domain_refs: [],
      lifecycle_ref: {
        artifact_id: model.active.artifact_id,
        artifact_type: model.active.artifact_type,
      },
    });

    const noDomainContext = validationContext([
      model.identity,
      model.created,
      model.active,
      unaffiliated,
    ]);
    expect(ACT_21_I3.validate(noDomainContext).passed).toBe(true);

    const domainContext = validationContext([
      model.root,
      model.anchor,
      model.domain,
      model.identity,
      model.created,
      model.active,
      model.actor,
    ]);
    expect(ACT_21_I3.validate(domainContext).passed).toBe(true);
  });

  it("validates ACT-21-I5 source-authority root-only closure without a root Actor", () => {
    const model = genericModel();
    const context = validationContext([
      model.root,
      model.anchor,
      model.domain,
      model.identity,
      model.created,
      model.active,
      model.actor,
    ]);

    const result = ACT_21_I5.validate(context);
    expect(result.passed).toBe(true);
    expect(result.evidence.some((entry) =>
      entry.observation.includes("source-authority root is hash-bound"),
    )).toBe(true);

    const mislabeledAnchor = {
      ...model.anchor,
      root_binding_type: "actor" as const,
    };
    const tamperedContext = validationContext([
      model.root,
      mislabeledAnchor,
      model.domain,
      model.identity,
      model.created,
      model.active,
      model.actor,
    ]);
    expect(ACT_21_I5.validate(tamperedContext).passed).toBe(false);
  });

  it("binds the proven LU cryptographic root as a generic source-authority TrustAnchor without fabricating an Actor", () => {
    const { root, anchor } = genericModel();

    expect(anchor.root_binding_type).toBe("authority_artifact");
    expect(anchor.root_ref).toEqual({
      artifact_id: root.artifact_id,
      artifact_type: root.artifact_type,
    });
    expect(anchor.root_hash).toEqual(root.content_hash);
    expect(JSON.stringify(anchor)).not.toContain("root_actor_ref");
    expect(JSON.stringify(anchor)).not.toContain("root_actor_hash");

    expect(() => validateTrustAnchorArtifact(anchor, root)).not.toThrow();
  });

  it("carries the frozen TrustDomain semantics canonically", () => {
    const { domain, anchor } = genericModel();

    expect(domain.anchor_ref).toEqual({
      artifact_id: anchor.artifact_id,
      artifact_type: anchor.artifact_type,
    });
    expect(domain.anchor_hash).toEqual(anchor.content_hash);
    expect(domain.authority_scope).toBe(LU_EXECUTION_AUTHORITY_SCOPE);
    expect(domain.constraints).toEqual([
      "allowed_artifact_type=execution_identity",
      "owner_provisioning=OWNER_PROVISIONED",
    ]);
    expect(domain.allowed_actor_types).toEqual(["service"]);
    expect(domain.delegation_rules).toEqual(["source-authority-chain"]);
  });

  it("implements the frozen lifecycle exactly and keeps canonical identity stable through transitions", () => {
    const { identity, created, active } = genericModel();
    const suspended = createActorLifecycleArtifact({
      identity,
      state: "SUSPENDED",
      effective_from: "2026-09-10T00:00:00Z",
      previous: active,
    });
    const revoked = createActorLifecycleArtifact({
      identity,
      state: "REVOKED",
      effective_from: "2026-09-11T00:00:00Z",
      previous: suspended,
    });

    expect([created.state, active.state, suspended.state, revoked.state]).toEqual([
      "CREATED",
      "ACTIVE",
      "SUSPENDED",
      "REVOKED",
    ]);
    for (const lifecycle of [created, active, suspended, revoked]) {
      expect(lifecycle.identity_ref).toEqual({
        artifact_id: identity.artifact_id,
        artifact_type: identity.artifact_type,
      });
      expect(lifecycle.identity_hash).toEqual(identity.content_hash);
    }
  });

  it("fails closed if lifecycle skips the frozen transition sequence", () => {
    const { identity, active } = genericModel();

    expect(() =>
      createActorLifecycleArtifact({
        identity,
        state: "REVOKED",
        effective_from: "2026-09-11T00:00:00Z",
        previous: active,
      }),
    ).toThrow("invalid transition ACTIVE -> REVOKED");
  });

  it("keeps Actor identity separate from multi-domain participation and lifecycle representation", () => {
    const { identity, active, domain } = genericModel();
    const secondDomain = createTrustDomainArtifact({
      anchor: genericModel().anchor,
      domain_name: "Secondary proof domain",
      authority_scope: "SECONDARY_PROOF_SCOPE",
      allowed_actor_types: ["service"],
    });

    const actor = createActorArtifact({
      identity,
      trust_domain_refs: [
        {
          artifact_id: secondDomain.artifact_id,
          artifact_type: secondDomain.artifact_type,
        },
        {
          artifact_id: domain.artifact_id,
          artifact_type: domain.artifact_type,
        },
      ],
      lifecycle_ref: {
        artifact_id: active.artifact_id,
        artifact_type: active.artifact_type,
      },
    });

    expect(actor.trust_domain_refs).toHaveLength(2);
    expect(actor.identity_ref).toEqual({
      artifact_id: identity.artifact_id,
      artifact_type: identity.artifact_type,
    });
    expect(actor.identity_hash).toEqual(identity.content_hash);
  });

  it("creates deterministic AuthorityEvidence for the exact LU root→issuer→execution identity path at decision time", () => {
    const model = genericModel();

    const first = createAuthorityEvidenceArtifact({
      actor: model.actor,
      trust_domain: model.domain,
      trust_anchor: model.anchor,
      lifecycle: model.active,
      action: "lu.execute.site_assessment",
      decision_time: "2026-09-02T12:00:00Z",
      authority_path: [
        { role: "root", artifact: model.root },
        { role: "issuer", artifact: model.issuer },
        { role: "subject", artifact: model.executionIdentity },
      ],
    });
    const second = createAuthorityEvidenceArtifact({
      actor: model.actor,
      trust_domain: model.domain,
      trust_anchor: model.anchor,
      lifecycle: model.active,
      action: "lu.execute.site_assessment",
      decision_time: "2026-09-02T12:00:00Z",
      authority_path: [
        { role: "root", artifact: model.root },
        { role: "issuer", artifact: model.issuer },
        { role: "subject", artifact: model.executionIdentity },
      ],
    });

    expect(first).toEqual(second);
    expect(first.authorized_at_decision_time).toBe(true);
    expect(first.authority_scope).toBe(LU_EXECUTION_AUTHORITY_SCOPE);
    expect(first.action).toBe("lu.execute.site_assessment");
    expect(first.authority_path.map((entry) => entry.role)).toEqual([
      "root",
      "issuer",
      "subject",
    ]);
    expect(first.authority_path[0]?.artifact_ref).toEqual(model.anchor.root_ref);
    expect(first.authority_path[0]?.content_hash).toEqual(model.anchor.root_hash);
    expect(JSON.stringify(first)).not.toContain("authorized_now");
  });

  it("preserves historical authorization evidence after later suspension/revocation", () => {
    const model = genericModel();
    const historical = createAuthorityEvidenceArtifact({
      actor: model.actor,
      trust_domain: model.domain,
      trust_anchor: model.anchor,
      lifecycle: model.active,
      action: "lu.execute.site_assessment",
      decision_time: "2026-09-02T12:00:00Z",
      authority_path: [
        { role: "root", artifact: model.root },
        { role: "issuer", artifact: model.issuer },
        { role: "subject", artifact: model.executionIdentity },
      ],
    });

    const suspended = createActorLifecycleArtifact({
      identity: model.identity,
      state: "SUSPENDED",
      effective_from: "2026-09-10T00:00:00Z",
      previous: model.active,
    });
    const revoked = createActorLifecycleArtifact({
      identity: model.identity,
      state: "REVOKED",
      effective_from: "2026-09-11T00:00:00Z",
      previous: suspended,
    });

    expect(revoked.state).toBe("REVOKED");
    expect(historical.authorized_at_decision_time).toBe(true);
    expect(historical.lifecycle_ref.artifact_id).toBe(model.active.artifact_id);
  });

  it("rejects authority evidence if the source path is rooted somewhere other than the TrustAnchor", () => {
    const model = genericModel();
    const rogueRoot = createLuExecutionAuthorityRootArtifact({
      root_key_id: "ed25519:rogue-root-04c",
      public_key_fingerprint: "rogue-root-fingerprint-04c",
    });

    expect(() =>
      createAuthorityEvidenceArtifact({
        actor: model.actor,
        trust_domain: model.domain,
        trust_anchor: model.anchor,
        lifecycle: model.active,
        action: "lu.execute.site_assessment",
        decision_time: "2026-09-02T12:00:00Z",
        authority_path: [
          { role: "root", artifact: rogueRoot },
          { role: "issuer", artifact: model.issuer },
          { role: "subject", artifact: model.executionIdentity },
        ],
      }),
    ).toThrow("authority path root does not match trust anchor");
  });

  it("rejects new authority evidence from a non-ACTIVE lifecycle state", () => {
    const model = genericModel();
    const suspended = createActorLifecycleArtifact({
      identity: model.identity,
      state: "SUSPENDED",
      effective_from: "2026-09-10T00:00:00Z",
      previous: model.active,
    });
    const suspendedActor = createActorArtifact({
      identity: model.identity,
      trust_domain_refs: model.actor.trust_domain_refs,
      lifecycle_ref: {
        artifact_id: suspended.artifact_id,
        artifact_type: suspended.artifact_type,
      },
    });

    expect(() =>
      createAuthorityEvidenceArtifact({
        actor: suspendedActor,
        trust_domain: model.domain,
        trust_anchor: model.anchor,
        lifecycle: suspended,
        action: "lu.execute.site_assessment",
        decision_time: "2026-09-10T01:00:00Z",
        authority_path: [
          { role: "root", artifact: model.root },
          { role: "issuer", artifact: model.issuer },
          { role: "subject", artifact: model.executionIdentity },
        ],
      }),
    ).toThrow("actor was not ACTIVE");
  });

  it("does not widen the LU root or issuer key purpose", () => {
    const { root, issuer, anchor } = genericModel();

    expect(root.payload.delegated_scope).toBe(LU_EXECUTION_AUTHORITY_SCOPE);
    expect(root.payload.allowed_artifact_type).toBe("execution_identity");
    expect(issuer.payload.delegated_scope).toBe(LU_EXECUTION_AUTHORITY_SCOPE);
    expect(issuer.payload.allowed_artifact_type).toBe("execution_identity");
    expect(anchor.verification_key_id).toBeUndefined();
    expect(() =>
      createTrustAnchorArtifact({
        anchor_name: "forbidden-key-widening",
        governance_profile: "ADR-24-21",
        root,
        verification_key_id: root.payload.root_key_id,
      }),
    ).toThrow("source-authority root key purpose cannot be widened");
    expect(JSON.stringify(root)).not.toContain("trust_anchor");
    expect(JSON.stringify(issuer)).not.toContain("authority_evidence");
  });
});
