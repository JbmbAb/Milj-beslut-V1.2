import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  createLuExecutionAuthorityIssuerArtifact,
  createLuExecutionAuthorityRootArtifact,
  LU_EXECUTION_AUTHORITY_SCOPE,
} from "../../mps-lu/src/artifacts/LuExecutionAuthorityArtifact";

const ADR_PATH = "docs/architecture/ADR-24-21-Actor-Identity-Trust.md";
const ANCHOR_PATH = "packages/mps-governance/src/actors/TrustAnchorArtifact.ts";
const DOMAIN_PATH = "packages/mps-governance/src/actors/TrustDomainArtifact.ts";
const LIFECYCLE_PATH = "packages/mps-governance/src/actors/ActorLifecycleArtifact.ts";

function source(path: string): string {
  return readFileSync(path, "utf8");
}

describe("MINIMUM-AUTHORITY-DELTA-04B — LU/generic trust compatibility gate", () => {
  it("proves the existing LU root is a cryptographic authority artifact, not an ActorArtifact", () => {
    const root = createLuExecutionAuthorityRootArtifact({
      root_key_id: "ed25519:lu-root-proof",
      public_key_fingerprint: "root-fingerprint-proof",
    });
    const issuer = createLuExecutionAuthorityIssuerArtifact({
      issuer_key_id: "ed25519:lu-issuer-proof",
      public_key_fingerprint: "issuer-fingerprint-proof",
      root_ref: {
        artifact_id: root.artifact_id,
        artifact_type: root.artifact_type,
      },
    });

    expect(root.artifact_type).toBe("lu_execution_authority_root");
    expect(root.payload.delegated_scope).toBe(LU_EXECUTION_AUTHORITY_SCOPE);
    expect(root.payload.allowed_artifact_type).toBe("execution_identity");
    expect("kind" in root).toBe(false);
    expect("identity_ref" in root).toBe(false);

    expect(issuer.artifact_type).toBe("lu_execution_authority_issuer");
    expect(issuer.payload.root_ref).toEqual({
      artifact_id: root.artifact_id,
      artifact_type: root.artifact_type,
    });
    expect("kind" in issuer).toBe(false);
    expect("identity_ref" in issuer).toBe(false);
  });

  it("proves the frozen ADR defines TrustAnchor generically, while implementation narrows it to a root Actor", () => {
    const adr = source(ADR_PATH);
    const anchor = source(ANCHOR_PATH);

    expect(adr).toContain("Canonical rot av tillit inom ett trust");
    expect(anchor).toContain("root_actor_ref");
    expect(anchor).toContain("root_actor_hash");
    expect(anchor).not.toContain("root_authority_ref");
    expect(anchor).not.toContain("root_authority_hash");
  });

  it("proves the generic TrustDomain implementation cannot yet carry the frozen ADR's required semantics", () => {
    const adr = source(ADR_PATH);
    const domain = source(DOMAIN_PATH);

    expect(adr).toContain("Trust domain SHALL define:");
    expect(adr).toContain("- scope");
    expect(adr).toContain("- constraints");
    expect(adr).toContain("- allowed actor types");
    expect(adr).toContain("- delegation rules");

    expect(domain).toContain("anchor_ref");
    expect(domain).toContain("domain_name");
    expect(domain).not.toContain("authority_scope");
    expect(domain).not.toContain("constraints");
    expect(domain).not.toContain("allowed_actor_types");
    expect(domain).not.toContain("delegation_rules");
  });

  it("proves ActorLifecycle implementation vocabulary conflicts with the frozen ADR", () => {
    const adr = source(ADR_PATH);
    const lifecycle = source(LIFECYCLE_PATH);

    expect(adr).toContain("CREATED → ACTIVE → SUSPENDED → REVOKED");
    expect(lifecycle).toContain('"pending"');
    expect(lifecycle).toContain('"active"');
    expect(lifecycle).toContain('"suspended"');
    expect(lifecycle).toContain('"retired"');
    expect(lifecycle).not.toContain('"revoked"');
  });

  it("proves the frozen AuthorityEvidenceArtifact boundary is not implemented", () => {
    const adr = source(ADR_PATH);

    expect(adr).toContain("AuthorityEvidenceArtifact");
    expect(
      existsSync(
        "packages/mps-governance/src/actors/AuthorityEvidenceArtifact.ts",
      ),
    ).toBe(false);
    expect(
      existsSync(
        "packages/mps-governance/src/artifacts/AuthorityEvidenceArtifact.ts",
      ),
    ).toBe(false);
  });

  it("proves no canonical constructors exist that could safely materialize the missing trust graph", () => {
    const anchor = source(ANCHOR_PATH);
    const domain = source(DOMAIN_PATH);
    const lifecycle = source(LIFECYCLE_PATH);

    expect(anchor).not.toContain("createTrustAnchorArtifact");
    expect(domain).not.toContain("createTrustDomainArtifact");
    expect(lifecycle).not.toContain("createActorLifecycleArtifact");
  });

  it("records the fail-closed compatibility conclusion without fabricating authority", () => {
    const blockers = [
      "ROOT_AUTHORITY_IS_NOT_ROOT_ACTOR",
      "TRUST_DOMAIN_SEMANTICS_UNDER_SPECIFIED",
      "ACTOR_LIFECYCLE_CONTRACT_MISMATCH",
      "AUTHORITY_EVIDENCE_ARTIFACT_MISSING",
    ] as const;

    expect(blockers).toEqual([
      "ROOT_AUTHORITY_IS_NOT_ROOT_ACTOR",
      "TRUST_DOMAIN_SEMANTICS_UNDER_SPECIFIED",
      "ACTOR_LIFECYCLE_CONTRACT_MISMATCH",
      "AUTHORITY_EVIDENCE_ARTIFACT_MISSING",
    ]);

    // Deliberately no constructor/adapter is invoked here. 04B proves why
    // convergence must stop before any new authority artifact is materialized.
  });
});
