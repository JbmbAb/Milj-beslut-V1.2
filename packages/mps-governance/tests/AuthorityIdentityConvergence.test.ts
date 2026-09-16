import { describe, expect, it } from "vitest";
import {
  createHumanIdentityArtifactFromBankId,
  createServiceIdentityArtifact,
  validateHumanIdentityArtifact,
  validateServiceIdentityArtifact,
} from "../src/actors/IdentityArtifacts";
import {
  ADMIN_ROLE_GRANT_AUTHORITY_SCOPE,
  ADMIN_ROLE_GRANT_CONTRACT_VERSION,
  createAdminRoleGrantArtifact,
} from "../../mps-compliance/src/artifacts/AdminRoleGrantArtifact";
import {
  LU_EXECUTION_AUTHORITY_SCOPE,
} from "../../mps-lu/src/artifacts/LuExecutionAuthorityArtifact";
import { LU_EXECUTION_PRINCIPAL_ID } from "../../mps-lu/src/execution/LuExecutionKernelClient";

const ISSUER_REF = {
  artifact_id: "admin-role-grant-issuer-proof",
  artifact_type: "admin_role_grant_issuer",
} as const;

function adminGrant(bankidId: string, issuedAt: string) {
  return createAdminRoleGrantArtifact({
    subject_user_id: "user-123",
    subject_bankid_id: bankidId,
    granted_role: "ADMIN",
    issuer_ref: ISSUER_REF,
    issuer_key_id: "ed25519:admin-role-proof",
    authority_scope: ADMIN_ROLE_GRANT_AUTHORITY_SCOPE,
    issued_at: issuedAt,
    contract_version: ADMIN_ROLE_GRANT_CONTRACT_VERSION,
  });
}

describe("MINIMUM-AUTHORITY-DELTA-03B — existing authority identity convergence", () => {
  it("projects repeated authority grants for the same BankID subject to one stable HumanIdentity", () => {
    const firstGrant = adminGrant("bankid:stable-subject-01", "2026-01-01T00:00:00.000Z");
    const secondGrant = adminGrant("bankid:stable-subject-01", "2026-09-16T00:00:00.000Z");

    expect(firstGrant.artifact_id).not.toBe(secondGrant.artifact_id);

    const firstIdentity = createHumanIdentityArtifactFromBankId(
      firstGrant.payload.subject_bankid_id,
    );
    const secondIdentity = createHumanIdentityArtifactFromBankId(
      secondGrant.payload.subject_bankid_id,
    );

    expect(firstIdentity).toEqual(secondIdentity);
    expect(firstIdentity.artifact_id).toBe(secondIdentity.artifact_id);
    expect(firstIdentity.content_hash).toEqual(secondIdentity.content_hash);
  });

  it("does not persist the raw BankID subject or authority semantics in HumanIdentity", () => {
    const bankid = "bankid:sensitive-subject-02";
    const identity = createHumanIdentityArtifactFromBankId(bankid);
    const serialized = JSON.stringify(identity);

    expect(serialized).not.toContain(bankid);
    expect(serialized).not.toContain("ADMIN");
    expect(serialized).not.toContain(ADMIN_ROLE_GRANT_AUTHORITY_SCOPE);
    expect(serialized).not.toContain("issuer");
    expect(serialized).not.toContain("capability");
    expect(serialized).not.toContain("trust_domain");
    expect(identity.references).toEqual([]);
  });

  it("separates distinct BankID subjects deterministically", () => {
    const left = createHumanIdentityArtifactFromBankId("bankid:subject-left");
    const right = createHumanIdentityArtifactFromBankId("bankid:subject-right");

    expect(left.artifact_id).not.toBe(right.artifact_id);
    expect(left.subject_fingerprint.value).not.toBe(right.subject_fingerprint.value);
  });

  it("fails closed when a canonical HumanIdentity body is tampered", () => {
    const identity = createHumanIdentityArtifactFromBankId("bankid:subject-tamper");
    const tampered = {
      ...identity,
      subject_fingerprint: {
        algorithm: "sha256" as const,
        value: "f".repeat(64),
      },
    };

    expect(() => validateHumanIdentityArtifact(tampered)).toThrow(
      "REJECT_CANONICAL_HUMAN_IDENTITY",
    );
  });

  it("maps the already-proven LU logical execution principal to one stable ServiceIdentity", () => {
    const first = createServiceIdentityArtifact({
      service_namespace: "mimer.lu",
      principal_id: LU_EXECUTION_PRINCIPAL_ID,
    });
    const second = createServiceIdentityArtifact({
      service_namespace: "mimer.lu",
      principal_id: LU_EXECUTION_PRINCIPAL_ID,
    });

    expect(first).toEqual(second);
    expect(first.principal_id).toBe(LU_EXECUTION_PRINCIPAL_ID);
    expect(JSON.stringify(first)).not.toContain(LU_EXECUTION_AUTHORITY_SCOPE);
    expect(JSON.stringify(first)).not.toContain("issuer");
    expect(JSON.stringify(first)).not.toContain("root");
  });

  it("does not let key rotation or delegation authority become part of LU service identity", () => {
    const beforeRotation = createServiceIdentityArtifact({
      service_namespace: "mimer.lu",
      principal_id: LU_EXECUTION_PRINCIPAL_ID,
    });
    // There is deliberately no issuer/root/key input to the identity constructor.
    const afterRotation = createServiceIdentityArtifact({
      service_namespace: "mimer.lu",
      principal_id: LU_EXECUTION_PRINCIPAL_ID,
    });

    expect(beforeRotation.artifact_id).toBe(afterRotation.artifact_id);
    expect(beforeRotation.content_hash).toEqual(afterRotation.content_hash);
  });

  it("fails closed when a canonical ServiceIdentity body is tampered", () => {
    const identity = createServiceIdentityArtifact({
      service_namespace: "mimer.lu",
      principal_id: LU_EXECUTION_PRINCIPAL_ID,
    });
    const tampered = { ...identity, principal_id: "attacker.service" };

    expect(() => validateServiceIdentityArtifact(tampered)).toThrow(
      "REJECT_CANONICAL_SERVICE_IDENTITY",
    );
  });

  it("keeps existing authority scopes unchanged rather than widening issuer purpose", () => {
    expect(ADMIN_ROLE_GRANT_AUTHORITY_SCOPE).toBe("PRODUCT_ADMIN_ROLE_GRANT_V1");
    expect(LU_EXECUTION_AUTHORITY_SCOPE).toBe("LU_EXECUTION_AUTHORITY_V1");
  });
});
