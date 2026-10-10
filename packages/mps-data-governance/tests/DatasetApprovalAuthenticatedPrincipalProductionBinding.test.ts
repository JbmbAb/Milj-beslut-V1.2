import { afterEach, describe, expect, it, vi } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHumanIdentityArtifact, createServiceIdentityArtifact } from "../../mps-governance/src/actors/IdentityArtifacts";
import {
  contentReferenceFromHumanIdentity,
  verifyCanonicalHumanIdentityArtifact,
} from "../src/GovernanceReviewerIdentityAuthority";

const canonicalBridge = vi.hoisted(() => ({ resolve: vi.fn() }));

vi.mock("../../../server/security/canonicalAuthorityIdentity", () => ({
  resolveCanonicalHumanIdentityForAuthUser: canonicalBridge.resolve,
}));

import {
  composeDatasetApprovalAuthorityForAuthenticatedRequest,
  createDatasetApprovalRequestIdentityBindings,
} from "../../../server/security/datasetApprovalAuthenticatedPrincipal";

function authUser(id: string, bankidId = `bankid:${id}`) {
  return { id, bankidId, organisationId: null, role: "CONSULTANT" as const };
}

function pair() {
  const keys = generateKeyPairSync("ed25519");
  return {
    keyId: "ed25519:dataset-approval-fixture",
    privateKeyPem: keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    publicKeyPem: keys.publicKey.export({ type: "spki", format: "pem" }).toString(),
  };
}

describe("DatasetApproval authenticated-principal production binding", () => {
  const dirs: string[] = [];
  afterEach(() => {
    canonicalBridge.resolve.mockReset();
    dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }));
  });

  function canonicalFromAuthenticatedUser(user: ReturnType<typeof authUser>) {
    return createHumanIdentityArtifact(user.id);
  }

  it("rejects a request that has not passed requireAuth", () => {
    expect(() => createDatasetApprovalRequestIdentityBindings({})).toThrow(
      "REJECT_DATASET_APPROVAL_MISSING_AUTHENTICATED_PRINCIPAL",
    );
  });

  it("derives the principal from req.authUser and ignores caller-supplied identity fields", async () => {
    const user = authUser("real-user-a", "bankid:real-a");
    canonicalBridge.resolve.mockImplementation(async (presented) => canonicalFromAuthenticatedUser(presented));
    const forged = contentReferenceFromHumanIdentity(createHumanIdentityArtifact("other-user"));
    const request = { authUser: user, body: { identity_ref: forged, reviewerId: "other-user" } } as any;

    const bindings = createDatasetApprovalRequestIdentityBindings(request);
    expect(await bindings.authenticatedPrincipal.currentIdentityRef()).toEqual(
      contentReferenceFromHumanIdentity(canonicalFromAuthenticatedUser(user)),
    );
    expect(canonicalBridge.resolve).toHaveBeenCalledWith(user);
  });

  it("keeps two concurrent authenticated requests identity-isolated", async () => {
    const userA = authUser("real-user-a", "bankid:real-a");
    const userB = authUser("real-user-b", "bankid:real-b");
    canonicalBridge.resolve.mockImplementation(async (presented) => {
      await Promise.resolve();
      return canonicalFromAuthenticatedUser(presented);
    });
    const a = createDatasetApprovalRequestIdentityBindings({ authUser: userA });
    const b = createDatasetApprovalRequestIdentityBindings({ authUser: userB });
    const [aRef, bRef] = await Promise.all([
      a.authenticatedPrincipal.currentIdentityRef(),
      b.authenticatedPrincipal.currentIdentityRef(),
    ]);
    expect(aRef).toEqual(contentReferenceFromHumanIdentity(canonicalFromAuthenticatedUser(userA)));
    expect(bRef).toEqual(contentReferenceFromHumanIdentity(canonicalFromAuthenticatedUser(userB)));
    expect(aRef).not.toEqual(bRef);
  });

  it("fails closed when the existing canonical bridge rejects a missing, mismatched, revoked, or synthetic principal", async () => {
    const user = authUser("real-user-a", "bankid:real-a");
    canonicalBridge.resolve.mockRejectedValueOnce(new Error("authenticated principal no longer exists"));
    await expect(
      createDatasetApprovalRequestIdentityBindings({ authUser: user }).authenticatedPrincipal.currentIdentityRef(),
    ).rejects.toThrow("authenticated principal no longer exists");

    canonicalBridge.resolve.mockRejectedValueOnce(new Error("authenticated BankID subject does not match persisted principal"));
    await expect(
      createDatasetApprovalRequestIdentityBindings({ authUser: user }).authenticatedPrincipal.currentIdentityRef(),
    ).rejects.toThrow("BankID subject does not match");

    canonicalBridge.resolve.mockRejectedValueOnce(new Error("synthetic admin/mock identity cannot become canonical human authority identity"));
    await expect(
      createDatasetApprovalRequestIdentityBindings({ authUser: user }).authenticatedPrincipal.currentIdentityRef(),
    ).rejects.toThrow("synthetic admin/mock identity");
  });

  it("preserves the canonical bridge's exact persisted User.id and BankID-subject checks", async () => {
    const actual = await vi.importActual<typeof import("../../../server/security/canonicalAuthorityIdentity")>(
      "../../../server/security/canonicalAuthorityIdentity",
    );
    const user = authUser("real-user-a", "bankid:real-a");
    expect(actual.bindAuthUserToCanonicalHumanIdentity(user, { id: user.id, bankidId: user.bankidId }).subject_id)
      .toBe(user.id);
    expect(() => actual.bindAuthUserToCanonicalHumanIdentity(user, { id: "other-user", bankidId: user.bankidId }))
      .toThrow("authenticated user id does not match");
    expect(() => actual.bindAuthUserToCanonicalHumanIdentity(user, { id: user.id, bankidId: "bankid:other" }))
      .toThrow("authenticated BankID subject does not match");
    expect(() => actual.bindAuthUserToCanonicalHumanIdentity(authUser("real-user-a", "mock-bankid"), { id: "real-user-a", bankidId: "mock-bankid" }))
      .toThrow("synthetic admin/mock identity");
  });

  it("reconstructs and exactly verifies the authenticated canonical human identity", async () => {
    const user = authUser("real-user-a", "bankid:real-a");
    const human = canonicalFromAuthenticatedUser(user);
    canonicalBridge.resolve.mockResolvedValue(human);
    const bindings = createDatasetApprovalRequestIdentityBindings({ authUser: user });
    const ref = contentReferenceFromHumanIdentity(human);
    await expect(bindings.identityAuthority.resolveVerifiedHumanIdentity(ref)).resolves.toMatchObject({
      identity: human,
      identity_ref: ref,
    });
    await expect(bindings.identityAuthority.resolveVerifiedHumanIdentity({
      ...ref,
      content_hash: { ...ref.content_hash, digest: "0".repeat(64) },
    })).rejects.toThrow("REJECT_DATASET_APPROVAL_IDENTITY_HASH_MISMATCH");
    await expect(bindings.identityAuthority.resolveVerifiedHumanIdentity({
      ...ref,
      id: "human-identity-unknown",
    })).rejects.toThrow("REJECT_DATASET_APPROVAL_IDENTITY_ID_MISMATCH");
  });

  it("rejects service, malformed, and synthetic identities at the canonical authority boundary", () => {
    const user = authUser("real-user-a", "bankid:real-a");
    const human = canonicalFromAuthenticatedUser(user);
    const ref = contentReferenceFromHumanIdentity(human);
    const service = createServiceIdentityArtifact({ service_namespace: "mimer.loke", principal_id: "loke" });
    expect(() => verifyCanonicalHumanIdentityArtifact(service, ref)).toThrow(
      "REJECT_DATASET_APPROVAL_SERVICE_IDENTITY",
    );
    expect(() => verifyCanonicalHumanIdentityArtifact({ artifact_type: "human_identity" }, ref)).toThrow(
      "REJECT_DATASET_APPROVAL_IDENTITY_UNVERIFIED",
    );
    const synthetic = createHumanIdentityArtifact("mock-reviewer");
    expect(() => verifyCanonicalHumanIdentityArtifact(synthetic, contentReferenceFromHumanIdentity(synthetic))).toThrow(
      "REJECT_DATASET_APPROVAL_SYNTHETIC_IDENTITY",
    );
  });

  it("keeps the reviewer registry authorization-only after successful authentication and identity resolution", async () => {
    const user = authUser("real-user-a", "bankid:real-a");
    canonicalBridge.resolve.mockImplementation(async (presented) => canonicalFromAuthenticatedUser(presented));
    const root = mkdtempSync(join(tmpdir(), "dataset-approval-authz-")); dirs.push(root);
    const env = { DATASET_APPROVAL_REVIEWER_REGISTRY_FILE: join(root, "missing-grants.json") } as NodeJS.ProcessEnv;
    await expect(
      composeDatasetApprovalAuthorityForAuthenticatedRequest({
        request: { authUser: user },
        env,
        manifests: { resolveVerifiedManifest: async () => { throw new Error("not reached"); } },
      }),
    ).rejects.toThrow(/BLOCKED_BY_GOVERNANCE_REVIEWER_IDENTITY/);
  });

  it("composes DatasetApproval from one authenticated request without request signer, root, or identity overrides", async () => {
    const user = authUser("real-user-a", "bankid:real-a");
    const human = canonicalFromAuthenticatedUser(user);
    canonicalBridge.resolve.mockResolvedValue(human);
    const root = mkdtempSync(join(tmpdir(), "dataset-approval-compose-")); dirs.push(root);
    const master = join(root, "Master");
    const cas = join(root, "CAS");
    const quarantine = join(root, "Quarantine");
    mkdirSync(master); mkdirSync(cas); mkdirSync(quarantine);
    const key = pair();
    const grants = join(root, "reviewer-grants.json");
    writeFileSync(grants, JSON.stringify({ reviewers: [{ identity_ref: contentReferenceFromHumanIdentity(human), role: "GOVERNANCE_REVIEWER" }] }), "utf8");
    const composed = await composeDatasetApprovalAuthorityForAuthenticatedRequest({
      request: { authUser: user, body: { signer: "attacker", masterRoot: "attacker", identity_ref: "attacker" } } as any,
      manifests: { resolveVerifiedManifest: async () => { throw new Error("not reached"); } },
      env: {
        DATASET_APPROVAL_SIGNING_KEY_ID: key.keyId,
        DATASET_APPROVAL_SIGNING_PRIVATE_KEY_PEM: key.privateKeyPem,
        DATASET_APPROVAL_SIGNING_PUBLIC_KEY_PEM: key.publicKeyPem,
        DATASET_APPROVAL_REVIEWER_REGISTRY_FILE: grants,
        GOVERNED_MASTER_ROOT: master,
        CAS_ROOT: cas,
        QUARANTINE_ROOT: quarantine,
      } as NodeJS.ProcessEnv,
    });
    expect(composed.signer.keyId).toBe(key.keyId);
    expect(composed.masterRoot).toBe(master);
    expect(composed.controller).toBeDefined();
  });
});
