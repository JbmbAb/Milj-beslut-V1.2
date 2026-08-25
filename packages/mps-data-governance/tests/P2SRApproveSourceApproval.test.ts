import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { LocalPemSigningKeyProvider } from "@miljobeslut/mimers-brunn-core";

import { approveSourceRegistryEntry, SourceApprovalError } from "../src/SourceApproval";
import { unsignedDraftFixture } from "./fixtures/unsignedSourceRegistryDrafts";
import {
  calculateSourceRegistryContentHash,
  sourceRegistryArtifactForHash,
  verifySourceRegistryArtifact,
  SOURCE_APPROVAL_ACTION,
  SOURCE_REGISTRY_APPROVAL_PREDICATE_TYPE,
  type SourceRegistryArtifact,
} from "../src/SourceRegistry";

/**
 * ✅ P2-SR-APPROVE — APPROVAL TOOLING PROOF (fixture keys only).
 *
 *   Invariant under test:
 *     What the approval tool issues is exactly what the runtime accepts — and nothing else can
 *     be issued by accident.
 *
 *   ⚠️ FIXTURE KEYS ONLY. Every key here is generated inside the test. No production approval is
 *   performed, and none can be: the real key lives in SOURCE_REGISTRY_SIGNING_PRIVATE_KEY_PEM,
 *   which this file never reads. Signing the real registry is a GOVERNOR act.
 *
 *   @see ../src/SourceApproval.ts
 *   @see ../scripts/approve-source.ts
 */
describe("P2-SR-APPROVE — source approval tooling", () => {
  const REPO_ROOT = resolve(__dirname, "../../..");

  function draft(): SourceRegistryArtifact {
    return unsignedDraftFixture('puh');
  }

  function key(id = "ed25519:test-governor") {
    return LocalPemSigningKeyProvider.generate(id).provider;
  }

  const APPROVER = "governor:test-owner";

  // ------------------------------------------------------------------- POSITIVE

  it("approves the real PUH draft and the result passes the runtime's own verification", async () => {
    const signing = key();
    const approved = await approveSourceRegistryEntry({
      entry: draft(),
      approver_actor_id: APPROVER,
      signing,
    });

    expect(approved.lifecycle_state).toBe("APPROVED");
    expect(approved.approval_attestation).toBeDefined();

    // The function verifies internally; asserted again here so the test states the claim rather
    // than inheriting it.
    await expect(verifySourceRegistryArtifact(approved, signing)).resolves.toMatchObject({
      sourceId: "domstolsverket-puh-mmod",
      adapter: "PUH_RATTSPRAXIS_V1",
      allowedDomains: ["rattspraxis.etjanst.domstol.se"],
    });
  });

  it("binds the attestation to the content hash of the substantive fields", async () => {
    const signing = key();
    const entry = draft();
    const expected = calculateSourceRegistryContentHash(sourceRegistryArtifactForHash(entry));

    const approved = await approveSourceRegistryEntry({
      entry,
      approver_actor_id: APPROVER,
      signing,
    });

    expect(approved.approval_attestation.subjectDigest).toBe(`sha256:${expected}`);
    expect(approved.approval_attestation.predicateType).toBe(
      SOURCE_REGISTRY_APPROVAL_PREDICATE_TYPE,
    );
    expect(approved.approval_attestation.predicate).toMatchObject({
      action: SOURCE_APPROVAL_ACTION,
      source_id: "domstolsverket-puh-mmod",
      approver_actor_id: APPROVER,
      approver_role: "GOVERNANCE_REVIEWER",
      signer_key_id: signing.keyId,
    });
  });

  it("the policy is inside what was signed — changing it voids the approval", async () => {
    const signing = key();
    const approved = await approveSourceRegistryEntry({
      entry: draft(),
      approver_actor_id: APPROVER,
      signing,
    });

    const raised: SourceRegistryArtifact = {
      ...approved,
      policy: { ...approved.policy, rate_limit_requests_per_second: 20 },
    };

    await expect(
      verifySourceRegistryArtifact(raised, signing),
      "MIMER_OPERATIONAL_POLICY is bound by the attestation. Raising the rate limit is a new " +
        "policy version requiring a new signature, not a runtime adjustment.",
    ).rejects.toThrow(/source_content_hash|subject_digest/);
  });

  it("the scope is inside what was signed — widening beyond MMOD voids the approval", async () => {
    const signing = key();
    const approved = await approveSourceRegistryEntry({
      entry: draft(),
      approver_actor_id: APPROVER,
      signing,
    });

    const approvedChannel = approved.channel;
    if (approvedChannel.channel_type === "ARCHIVE_IMPORT") {
      throw new Error("Test fixture must remain a network source.");
    }
    const widened: SourceRegistryArtifact = {
      ...approved,
      channel: {
        ...approvedChannel,
        endpoint_url: approvedChannel.endpoint_url!.replace("domstolkod=MMOD", "domstolkod=MOD"),
      },
    };

    await expect(
      verifySourceRegistryArtifact(widened, signing),
      "Scope lives in endpoint_url, which is inside channel, which is inside the content hash. " +
        "Swapping MMOD for MOD is a different corpus and must require re-approval.",
    ).rejects.toThrow(/source_content_hash|subject_digest/);
  });

  // ------------------------------------------------------------------- NEGATIVE

  it("refuses to re-sign an already-approved entry", async () => {
    const signing = key();
    const approved = await approveSourceRegistryEntry({
      entry: draft(),
      approver_actor_id: APPROVER,
      signing,
    });

    await expect(
      approveSourceRegistryEntry({ entry: approved, approver_actor_id: "someone-else", signing }),
      "Re-signing would silently replace one approver's act with another's.",
    ).rejects.toThrow(/REJECT_ALREADY_APPROVED/);
  });

  it("refuses an unattributed approval", async () => {
    const signing = key();

    for (const approver of ["", "   "]) {
      await expect(
        approveSourceRegistryEntry({ entry: draft(), approver_actor_id: approver, signing }),
      ).rejects.toThrow(/REJECT_NO_APPROVER/);
    }
  });

  it("a signature from a different key is rejected by the runtime", async () => {
    const governor = key("ed25519:governor-a");
    const impostor = key("ed25519:governor-b");

    const approved = await approveSourceRegistryEntry({
      entry: draft(),
      approver_actor_id: APPROVER,
      signing: governor,
    });

    await expect(
      verifySourceRegistryArtifact(approved, impostor),
      "An approval is bound to the key that made it. Verifying against another key must fail.",
    ).rejects.toThrow(/signature_valid|signer_key/);
  });

  it("errors carry a machine-readable reason code", async () => {
    const signing = key();
    await approveSourceRegistryEntry({ entry: draft(), approver_actor_id: APPROVER, signing })
      .then((approved) =>
        approveSourceRegistryEntry({ entry: approved, approver_actor_id: APPROVER, signing }),
      )
      .catch((error: SourceApprovalError) => {
        expect(error).toBeInstanceOf(SourceApprovalError);
        expect(error.reason_code).toBe("REJECT_ALREADY_APPROVED");
      });
  });

  // -------------------------------------------------------------------- CLI SHAPE

  it("the CLI accepts no key on the command line", () => {
    const cli = readFileSync(
      join(REPO_ROOT, "packages", "mps-data-governance", "scripts", "approve-source.ts"),
      "utf8",
    );

    expect(
      /--private-key['"\s]*\]/.test(cli) || /arg\(['"]private-key['"]\)/.test(cli),
      "A key passed on the command line is visible in shell history and in the process list. " +
        "The CLI must read it from the environment only.",
    ).toBe(false);

    expect(cli).toContain("getSourceRegistrySigningKeyFromEnv");
    expect(
      cli,
      "The CLI must reload what it wrote through the production loader — verifying the " +
        "in-memory object would not prove the file on disk is loadable.",
    ).toContain("loadVerifiedSourceRegistry");
  });

  it("the CLI does not write to the production registry path", () => {
    const cli = readFileSync(
      join(REPO_ROOT, "packages", "mps-data-governance", "scripts", "approve-source.ts"),
      "utf8",
    );

    expect(
      /writeFileSync\([^)]*national-registry/.test(cli),
      "Installing an approved source into the production registry is a separate, visible act.",
    ).toBe(false);
  });
});
