import { describe, expect, it } from "vitest";
import {
  createHumanIdentityArtifact,
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
import { deriveLuCanonicalServiceIdentity } from "../../mps-lu/src/execution/LuCanonicalServiceIdentity";
import { bindAuthUserToCanonicalHumanIdentity } from "../../../server/security/canonicalAuthorityIdentity";
import type { ExecutionIdentityArtifact } from "../../mps-runtime/src/execution/ExecutionIdentityArtifact";

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
  it("projects repeated authority grants for the same persistent Mimer subject to one stable HumanIdentity", () => {
    const firstGrant = adminGrant("bankid:stable-subject-01", "2026-01-01T00:00:00.000Z");
    const secondGrant = adminGrant("bankid:stable-subject-01", "2026-09-16T00:00:00.000Z");

    expect(firstGrant.artifact_id).not.toBe(secondGrant.artifact_id);

    const firstIdentity = createHumanIdentityArtifact(
      firstGrant.payload.subject_user_id,
    );
    const secondIdentity = createHumanIdentityArtifact(
      secondGrant.payload.subject_user_id,
    );

    expect(firstIdentity).toEqual(secondIdentity);
    expect(firstIdentity.artifact_id).toBe(secondIdentity.artifact_id);
    expect(firstIdentity.content_hash).toEqual(secondIdentity.content_hash);
  });

  it("does not persist the BankID personal number or authority semantics in HumanIdentity", () => {
    const bankid = "191212121212";
    const identity = createHumanIdentityArtifact("user-stable-subject-02");
    const serialized = JSON.stringify(identity);

    expect(serialized).not.toContain(bankid);
    expect(serialized).not.toContain("ADMIN");
    expect(serialized).not.toContain(ADMIN_ROLE_GRANT_AUTHORITY_SCOPE);
    expect(serialized).not.toContain("issuer");
    expect(serialized).not.toContain("capability");
    expect(serialized).not.toContain("trust_domain");
    expect(identity.references).toEqual([]);
  });

  it("separates distinct persistent Mimer subjects deterministically", () => {
    const left = createHumanIdentityArtifact("user-subject-left");
    const right = createHumanIdentityArtifact("user-subject-right");

    expect(left.artifact_id).not.toBe(right.artifact_id);
    expect(left.subject_id).not.toBe(right.subject_id);
  });

  it("fails closed when a canonical HumanIdentity body is tampered", () => {
    const identity = createHumanIdentityArtifact("user-subject-tamper");
    const tampered = {
      ...identity,
      subject_id: "user-attacker",
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


  it("binds an authenticated principal to canonical HumanIdentity only after exact persisted subject match", () => {
    const bound = bindAuthUserToCanonicalHumanIdentity(
      { id: "user-123", bankidId: "bankid:stable-subject-03" },
      { id: "user-123", bankidId: "bankid:stable-subject-03" },
    );
    const direct = createHumanIdentityArtifact("user-123");

    expect(bound).toEqual(direct);
  });

  it("fails closed when runtime user id and persisted principal diverge", () => {
    expect(() =>
      bindAuthUserToCanonicalHumanIdentity(
        { id: "user-presented", bankidId: "bankid:stable-subject-04" },
        { id: "user-persisted", bankidId: "bankid:stable-subject-04" },
      ),
    ).toThrow("authenticated user id does not match persisted principal");
  });

  it("fails closed when JWT BankID subject and persisted principal diverge", () => {
    expect(() =>
      bindAuthUserToCanonicalHumanIdentity(
        { id: "user-123", bankidId: "bankid:presented" },
        { id: "user-123", bankidId: "bankid:persisted" },
      ),
    ).toThrow("authenticated BankID subject does not match persisted principal");
  });

  it("rejects synthetic admin-console and mock identities as canonical human authority identities", () => {
    for (const bankidId of ["admin:operator", "mock-bankid-subject"]) {
      expect(() =>
        bindAuthUserToCanonicalHumanIdentity(
          { id: "user-123", bankidId },
          { id: "user-123", bankidId },
        ),
      ).toThrow("synthetic admin/mock identity");
    }
  });

  it("converges an already verified LU ExecutionIdentity to the canonical LU ServiceIdentity", () => {
    const executionIdentity: ExecutionIdentityArtifact = {
      artifact_id: "lu-identity-proof",
      artifact_type: "execution_identity",
      references: [],
      actor_ref: {
        artifact_id: LU_EXECUTION_PRINCIPAL_ID,
        artifact_type: "execution_identity",
      },
      capability_ref: {
        artifact_id: "capability-lu-proof",
        artifact_type: "CAPABILITY_DEFINITION",
      },
      signature_envelope_ref: {
        artifact_id: "attestation-lu-proof",
        artifact_type: "outcome_attestation",
      },
      content_hash: { algorithm: "sha256", value: "1".repeat(64) },
    };

    const converged = deriveLuCanonicalServiceIdentity({
      verified: true,
      identity: executionIdentity,
    });

    expect(converged).toEqual(
      createServiceIdentityArtifact({
        service_namespace: "mimer.lu",
        principal_id: LU_EXECUTION_PRINCIPAL_ID,
      }),
    );
  });

  it("never converges an unverified LU execution identity", () => {
    expect(() =>
      deriveLuCanonicalServiceIdentity({
        verified: false,
        reason: "INVALID_SIGNATURE",
      }),
    ).toThrow("execution identity is not verified");
  });

  it("rejects a verified execution identity for any principal other than the frozen LU principal", () => {
    const executionIdentity: ExecutionIdentityArtifact = {
      artifact_id: "lu-identity-wrong-principal",
      artifact_type: "execution_identity",
      references: [],
      actor_ref: {
        artifact_id: "attacker.actor",
        artifact_type: "execution_identity",
      },
      capability_ref: {
        artifact_id: "capability-lu-proof",
        artifact_type: "CAPABILITY_DEFINITION",
      },
      signature_envelope_ref: {
        artifact_id: "attestation-lu-proof",
        artifact_type: "outcome_attestation",
      },
      content_hash: { algorithm: "sha256", value: "2".repeat(64) },
    };

    expect(() =>
      deriveLuCanonicalServiceIdentity({
        verified: true,
        identity: executionIdentity,
      }),
    ).toThrow("execution actor_ref is not the canonical LU principal");
  });

  it("keeps existing authority scopes unchanged rather than widening issuer purpose", () => {
    expect(ADMIN_ROLE_GRANT_AUTHORITY_SCOPE).toBe("PRODUCT_ADMIN_ROLE_GRANT_V1");
    expect(LU_EXECUTION_AUTHORITY_SCOPE).toBe("LU_EXECUTION_AUTHORITY_V1");
  });
});
