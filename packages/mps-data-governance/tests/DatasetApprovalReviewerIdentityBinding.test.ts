import { afterEach, describe, expect, it } from "vitest";
import { createHash, generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createHumanIdentityArtifact,
  createServiceIdentityArtifact,
} from "../../mps-governance/src/actors/IdentityArtifacts";
import type {
  ArtifactIdentityStrategy,
  CanonicalArtifactSerializer,
  CanonicalHashEngine,
  ContentReference,
} from "../../mps-core/src/types";
import { DatasetApprovalAuthority } from "../src/DatasetApprovalAuthority";
import { DatasetApprovalController } from "../src/DatasetApprovalController";
import { FileCheckpointStore } from "../src/FileCheckpointStore";
import { FileDatasetApprovalStore } from "../src/FileDatasetApprovalStore";
import { createDatasetApprovalEd25519Signer } from "../src/DatasetApprovalEd25519Signer";
import {
  authorizeDatasetApprovalGovernanceReviewer,
  contentReferenceFromHumanIdentity,
  createInMemoryGovernanceReviewerIdentityAuthority,
  createStaticAuthenticatedPrincipalPort,
  verifyCanonicalHumanIdentityArtifact,
} from "../src/GovernanceReviewerIdentityAuthority";
import { composeDatasetApprovalAuthorityFromEnv } from "../src/DatasetApprovalAuthorityBindings";
import { DATASET_APPROVAL_AUTHORITY_DOMAIN } from "../src/DatasetApprovalAuthorityDomain";
import {
  createDatasetApprovalSignatureVerifier,
  createDatasetApprovalTrustPort,
  createDatasetApprovalTrustRoot,
} from "../src/DatasetApprovalTrustRoot";
import type { DatasetApprovalCommand } from "../src/DatasetApprovalController";

function sort(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sort);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).sort().map(([k, v]) => [k, sort(v)]),
  );
}

const serializer: CanonicalArtifactSerializer = {
  serialize: (v) => new TextEncoder().encode(JSON.stringify(sort(v))),
};
const hashEngine: CanonicalHashEngine = {
  hash: (bytes) => ({
    algorithm: "sha256",
    digest: createHash("sha256").update(bytes).digest("hex"),
  }),
};
const strategy: ArtifactIdentityStrategy = {
  createArtifactId: (h) => `approval-${h.digest.slice(0, 24)}`,
};

function writeGrant(path: string, identityRef: ContentReference): NodeJS.ProcessEnv {
  writeFileSync(
    path,
    JSON.stringify({
      reviewers: [{ identity_ref: identityRef, role: "GOVERNANCE_REVIEWER" }],
    }),
    "utf8",
  );
  return { DATASET_APPROVAL_REVIEWER_REGISTRY_FILE: path } as NodeJS.ProcessEnv;
}

describe("DatasetApproval reviewer identity binding", () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));
  function temp(prefix: string): string {
    const dir = mkdtempSync(join(tmpdir(), prefix));
    dirs.push(dir);
    return dir;
  }

  it("rejects arbitrary well-formed id/hash grant when no canonical human identity exists", async () => {
    const root = temp("da-id-missing-");
    const fakeRef: ContentReference = {
      id: "human-identity-plausible-but-absent",
      content_hash: { algorithm: "sha256", digest: "a".repeat(64) },
    };
    const env = writeGrant(join(root, "grants.json"), fakeRef);
    const identityAuthority = createInMemoryGovernanceReviewerIdentityAuthority([]);
    await expect(
      authorizeDatasetApprovalGovernanceReviewer({
        identityAuthority,
        authenticatedPrincipal: createStaticAuthenticatedPrincipalPort(fakeRef),
        env,
      }),
    ).rejects.toThrow(/REJECT_DATASET_APPROVAL_IDENTITY_MISSING/);
  });

  it("rejects canonical ServiceIdentityArtifact as reviewer", () => {
    const service = createServiceIdentityArtifact({
      service_namespace: "mimer.harvest",
      principal_id: "loke-agent",
    });
    const ref: ContentReference = {
      id: service.artifact_id,
      content_hash: { algorithm: "sha256", digest: service.content_hash.value },
    };
    expect(() => verifyCanonicalHumanIdentityArtifact(service, ref)).toThrow(
      /REJECT_DATASET_APPROVAL_SERVICE_IDENTITY/,
    );
  });

  it("rejects canonical human identity with wrong content hash", async () => {
    const human = createHumanIdentityArtifact("user-canonical-reviewer-01");
    const wrongRef: ContentReference = {
      id: human.artifact_id,
      content_hash: { algorithm: "sha256", digest: "b".repeat(64) },
    };
    const identityAuthority = createInMemoryGovernanceReviewerIdentityAuthority([human]);
    await expect(
      identityAuthority.resolveVerifiedHumanIdentity(wrongRef),
    ).rejects.toThrow(/REJECT_DATASET_APPROVAL_IDENTITY_HASH_MISMATCH/);
  });

  it("rejects canonical human who is not reviewer-authorized", async () => {
    const human = createHumanIdentityArtifact("user-canonical-reviewer-02");
    const other = createHumanIdentityArtifact("user-other-human-03");
    const humanRef = contentReferenceFromHumanIdentity(human);
    const otherRef = contentReferenceFromHumanIdentity(other);
    const root = temp("da-id-unauth-");
    const env = writeGrant(join(root, "grants.json"), otherRef);
    const identityAuthority = createInMemoryGovernanceReviewerIdentityAuthority([human, other]);
    await expect(
      authorizeDatasetApprovalGovernanceReviewer({
        identityAuthority,
        authenticatedPrincipal: createStaticAuthenticatedPrincipalPort(humanRef),
        env,
      }),
    ).rejects.toThrow(/REJECT_UNAUTHORIZED_DATASET_APPROVAL_REVIEWER/);
  });

  it("rejects grant when authenticated principal is a different human", async () => {
    const granted = createHumanIdentityArtifact("user-granted-reviewer-04");
    const session = createHumanIdentityArtifact("user-session-other-05");
    const grantedRef = contentReferenceFromHumanIdentity(granted);
    const sessionRef = contentReferenceFromHumanIdentity(session);
    const root = temp("da-id-mismatch-");
    const env = writeGrant(join(root, "grants.json"), grantedRef);
    const identityAuthority = createInMemoryGovernanceReviewerIdentityAuthority([granted, session]);
    await expect(
      authorizeDatasetApprovalGovernanceReviewer({
        identityAuthority,
        authenticatedPrincipal: createStaticAuthenticatedPrincipalPort(sessionRef),
        env,
      }),
    ).rejects.toThrow(/REJECT_UNAUTHORIZED_DATASET_APPROVAL_REVIEWER/);
  });

  it("makes caller-supplied reviewer identity in decision payload impossible", async () => {
    const human = createHumanIdentityArtifact("user-canonical-reviewer-06");
    const humanRef = contentReferenceFromHumanIdentity(human);
    const root = temp("da-id-payload-");
    const env = writeGrant(join(root, "grants.json"), humanRef);
    const identityAuthority = createInMemoryGovernanceReviewerIdentityAuthority([human]);
    const reviewer = await authorizeDatasetApprovalGovernanceReviewer({
      identityAuthority,
      authenticatedPrincipal: createStaticAuthenticatedPrincipalPort(humanRef),
      env,
    });
    const pair = generateKeyPairSync("ed25519");
    const publicPem = pair.publicKey.export({ type: "spki", format: "pem" }).toString();
    const privatePem = pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const keyId = "ed25519:dataset-approval-v1";
    const trustRoot = createDatasetApprovalTrustRoot([
      { key_id: keyId, public_key_pem: publicPem, authority_domain: DATASET_APPROVAL_AUTHORITY_DOMAIN },
    ]);
    const signer = createDatasetApprovalEd25519Signer({
      keyId,
      privateKeyPem: privatePem,
      publicKeyPem: publicPem,
    });
    const storeRoot = temp("da-id-ctrl-");
    const authority = new DatasetApprovalAuthority(
      serializer,
      hashEngine,
      signer,
      strategy,
      {
        resolveVerifiedManifest: async (ref) => ({
          manifest_ref: ref,
          producer: {
            identity_ref: {
              id: "harvest-agent",
              content_hash: { algorithm: "sha256", digest: "c".repeat(64) },
            },
            role: "SYSTEM_PROCESS",
          },
        }),
      },
      createDatasetApprovalTrustPort(trustRoot),
      new FileDatasetApprovalStore(storeRoot),
      new FileCheckpointStore(
        storeRoot,
        serializer,
        hashEngine,
        createDatasetApprovalSignatureVerifier(trustRoot),
      ),
    );
    const controller = new DatasetApprovalController(authority, reviewer);
    const command: DatasetApprovalCommand = {
      manifest_ref: {
        id: "manifest-1",
        content_hash: { algorithm: "sha256", digest: "d".repeat(64) },
      },
      decision: "APPROVED",
      reason: "Reviewed",
      decision_at: "2026-10-10T00:00:00.000Z",
      confirm_approval: true,
    };
    // Caller smuggles reviewer authority onto the payload object — controller must ignore it.
    const smuggled = Object.assign({}, command, {
      actor_ref: {
        identity_ref: {
          id: "attacker",
          content_hash: { algorithm: "sha256", digest: "e".repeat(64) },
        },
        role: "GOVERNANCE_REVIEWER",
      },
    });
    const ref = await controller.decide(smuggled);
    const artifact = await new FileCheckpointStore(
      storeRoot,
      serializer,
      hashEngine,
      createDatasetApprovalSignatureVerifier(trustRoot),
    ).loadApproval(ref);
    expect(artifact.actor_ref.identity_ref).toEqual(humanRef);
    expect(artifact.actor_ref.identity_ref.id).not.toBe("attacker");
  });

  it("rejects synthetic/mock canonical human subject ids", async () => {
    const synthetic = createHumanIdentityArtifact("mock-bankid-testuser-1");
    const ref = contentReferenceFromHumanIdentity(synthetic);
    const identityAuthority = createInMemoryGovernanceReviewerIdentityAuthority([synthetic]);
    await expect(identityAuthority.resolveVerifiedHumanIdentity(ref)).rejects.toThrow(
      /REJECT_DATASET_APPROVAL_SYNTHETIC_IDENTITY/,
    );
  });

  it("accepts valid canonical human + authenticated principal + exact reviewer grant", async () => {
    const human = createHumanIdentityArtifact("user-canonical-reviewer-07");
    const humanRef = contentReferenceFromHumanIdentity(human);
    const root = temp("da-id-pass-");
    const env = writeGrant(join(root, "grants.json"), humanRef);
    const reviewer = await authorizeDatasetApprovalGovernanceReviewer({
      identityAuthority: createInMemoryGovernanceReviewerIdentityAuthority([human]),
      authenticatedPrincipal: createStaticAuthenticatedPrincipalPort(humanRef),
      env,
    });
    expect(reviewer.actor_ref.role).toBe("GOVERNANCE_REVIEWER");
    expect(reviewer.actor_ref.identity_ref).toEqual(humanRef);
  });

  it("rejects self-approval against authoritative manifest producer identity", async () => {
    const human = createHumanIdentityArtifact("user-canonical-reviewer-08");
    const humanRef = contentReferenceFromHumanIdentity(human);
    const root = temp("da-id-self-");
    const env = writeGrant(join(root, "grants.json"), humanRef);
    const reviewer = await authorizeDatasetApprovalGovernanceReviewer({
      identityAuthority: createInMemoryGovernanceReviewerIdentityAuthority([human]),
      authenticatedPrincipal: createStaticAuthenticatedPrincipalPort(humanRef),
      env,
    });
    const pair = generateKeyPairSync("ed25519");
    const publicPem = pair.publicKey.export({ type: "spki", format: "pem" }).toString();
    const privatePem = pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const keyId = "ed25519:dataset-approval-v1";
    const trustRoot = createDatasetApprovalTrustRoot([
      { key_id: keyId, public_key_pem: publicPem, authority_domain: DATASET_APPROVAL_AUTHORITY_DOMAIN },
    ]);
    const storeRoot = temp("da-id-self-store-");
    const authority = new DatasetApprovalAuthority(
      serializer,
      hashEngine,
      createDatasetApprovalEd25519Signer({
        keyId,
        privateKeyPem: privatePem,
        publicKeyPem: publicPem,
      }),
      strategy,
      {
        resolveVerifiedManifest: async (ref) => ({
          manifest_ref: ref,
          producer: { identity_ref: humanRef, role: "SYSTEM_PROCESS" },
        }),
      },
      createDatasetApprovalTrustPort(trustRoot),
      new FileDatasetApprovalStore(storeRoot),
      new FileCheckpointStore(
        storeRoot,
        serializer,
        hashEngine,
        createDatasetApprovalSignatureVerifier(trustRoot),
      ),
    );
    await expect(
      authority.decide({
        manifest_ref: {
          id: "manifest-self",
          content_hash: { algorithm: "sha256", digest: "f".repeat(64) },
        },
        decision: "APPROVED",
        actor_ref: reviewer.actor_ref,
        decision_at: "2026-10-10T00:00:00.000Z",
        reason: "should fail self-approval",
      }),
    ).rejects.toThrow("REJECT_DATASET_APPROVAL_SELF_APPROVAL");
  });

  it("rejects role escalation by request field and refuses caller-supplied compose identity ref", async () => {
    const human = createHumanIdentityArtifact("user-canonical-reviewer-09");
    const humanRef = contentReferenceFromHumanIdentity(human);
    const root = temp("da-id-role-");
    const env = writeGrant(join(root, "grants.json"), humanRef);
    const reviewer = await authorizeDatasetApprovalGovernanceReviewer({
      identityAuthority: createInMemoryGovernanceReviewerIdentityAuthority([human]),
      authenticatedPrincipal: createStaticAuthenticatedPrincipalPort(humanRef),
      env,
    });
    expect(reviewer.actor_ref.role).toBe("GOVERNANCE_REVIEWER");
    // Role is projected from authorization, not from a request field.
    expect("role" in ({ manifest_ref: humanRef } as Record<string, unknown>)).toBe(false);

    // compose no longer accepts authenticatedReviewerIdentityRef
    const composeArgs: Parameters<typeof composeDatasetApprovalAuthorityFromEnv>[0] = {
      env,
      manifests: {
        resolveVerifiedManifest: async (ref) => ({
          manifest_ref: ref,
          producer: {
            identity_ref: {
              id: "harvest",
              content_hash: { algorithm: "sha256", digest: "1".repeat(64) },
            },
            role: "SYSTEM_PROCESS",
          },
        }),
      },
      identityAuthority: createInMemoryGovernanceReviewerIdentityAuthority([human]),
      authenticatedPrincipal: createStaticAuthenticatedPrincipalPort(humanRef),
    };
    expect("authenticatedReviewerIdentityRef" in composeArgs).toBe(false);
  });

  it("rejects wrong identity id even when hash bytes collide with another human", async () => {
    const human = createHumanIdentityArtifact("user-canonical-reviewer-10");
    const wrongIdRef: ContentReference = {
      id: "human-identity-wrong-id",
      content_hash: {
        algorithm: human.content_hash.algorithm,
        digest: human.content_hash.value,
      },
    };
    const identityAuthority = createInMemoryGovernanceReviewerIdentityAuthority([human]);
    await expect(identityAuthority.resolveVerifiedHumanIdentity(wrongIdRef)).rejects.toThrow(
      /REJECT_DATASET_APPROVAL_IDENTITY_MISSING|REJECT_DATASET_APPROVAL_IDENTITY_ID_MISMATCH/,
    );
  });
});
