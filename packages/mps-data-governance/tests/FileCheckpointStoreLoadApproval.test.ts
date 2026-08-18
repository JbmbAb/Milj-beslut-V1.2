// packages/mps-data-governance/tests/FileCheckpointStoreLoadApproval.test.ts
//
// PR 2 — FileCheckpointStore.loadApproval() signature/authenticity verification.
//
// Before this PR, loadApproval() did a bare JSON.parse of whatever file sat at
// _quarantine/approvals/<id>.json and returned it. ImportGate's role check
// (PR 1) only inspects the field's *value*, not its provenance — so a
// hand-authored file with a self-declared actor_ref.role: "GOVERNANCE_REVIEWER"
// would have passed both checks. These tests prove loadApproval() itself now
// refuses to hand back an artifact whose content or signature don't check out.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { FileCheckpointStore } from "../src/FileCheckpointStore";
import type {
  ArtifactReference,
  CanonicalArtifactSerializer,
  CanonicalHashEngine,
  SignatureVerifier,
  HashDescriptor,
} from "../../mps-core/src/types";
import { HashVerificationViolation, SignatureVerificationViolation } from "../../mps-core/src/errors";

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value === null || typeof value !== "object") return value;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return Object.fromEntries(entries.map(([k, v]) => [k, sortDeep(v)]));
}

const serializer: CanonicalArtifactSerializer = {
  serialize: (value) => new TextEncoder().encode(JSON.stringify(sortDeep(value))),
};

function fnv1a(bytes: Uint8Array): string {
  let h = 0x811c9dc5;
  for (const b of bytes) {
    h ^= b;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `fake:${h.toString(16)}`;
}

const hashEngine: CanonicalHashEngine = {
  hash: (bytes) => ({ algorithm: "sha256", digest: fnv1a(bytes as Uint8Array) }),
};

/** Accepts only signatures of the exact form `sig:<digest>` for the hash it was asked to verify. */
const realSignatureVerifier: SignatureVerifier = {
  verify: async (hash, signature) => signature.signature === `sig:${hash.digest}`,
};

const alwaysRejectVerifier: SignatureVerifier = {
  verify: async () => false,
};

describe("FileCheckpointStore.loadApproval() — signature/authenticity verification", () => {
  let tempDir: string;
  let approvalsDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "loadapproval-test-"));
    approvalsDir = path.join(tempDir, "National_Archive", "_quarantine", "approvals");
    fs.mkdirSync(approvalsDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  /** Writes a validly-hashed-and-signed approval file, returns the reference that resolves it. */
  function writeValidApproval(artifact_id: string, envelopeOverrides: Record<string, unknown> = {}): ArtifactReference {
    const envelope = {
      artifact_type: "DATASET_APPROVAL",
      approved_ref: { id: "manifest-1", content_hash: { algorithm: "sha256", digest: "manifest-digest" } },
      decision: "APPROVED",
      actor_ref: {
        identity_ref: { id: "reviewer-1", content_hash: { algorithm: "sha256", digest: "reviewer-digest" } },
        role: "GOVERNANCE_REVIEWER",
      },
      decision_at: "2026-08-10T00:00:00Z",
      reason: "looks fine",
      ...envelopeOverrides,
    };
    const content_hash: HashDescriptor = hashEngine.hash(serializer.serialize(envelope));
    const artifact = { ...envelope, artifact_id, content_hash, signature: { algorithm: "fake", signature: `sig:${content_hash.digest}` } };
    fs.writeFileSync(path.join(approvalsDir, `${artifact_id}.json`), JSON.stringify(artifact, null, 2), "utf8");
    return { artifact_id, artifact_type: "DATASET_APPROVAL", content_hash };
  }

  it("loads and returns an artifact whose hash and signature both verify", async () => {
    const store = new FileCheckpointStore(tempDir, serializer, hashEngine, realSignatureVerifier);
    const ref = writeValidApproval("approval-ok");

    const artifact = await store.loadApproval(ref);

    expect(artifact.decision).toBe("APPROVED");
    expect((artifact as any).actor_ref.role).toBe("GOVERNANCE_REVIEWER");
  });

  it("rejects a file whose content was edited after signing (hash mismatch)", async () => {
    const store = new FileCheckpointStore(tempDir, serializer, hashEngine, realSignatureVerifier);
    const ref = writeValidApproval("approval-tampered");

    // Simulate tampering: rewrite the file with the decision flipped, but keep
    // the original content_hash/signature — exactly what a forged approval
    // looks like (attacker doesn't have the signing key, so they leave the old
    // signature in place and hope nothing checks it against the new content).
    const filePath = path.join(approvalsDir, "approval-tampered.json");
    const onDisk = JSON.parse(fs.readFileSync(filePath, "utf8"));
    onDisk.actor_ref.role = "GOVERNANCE_REVIEWER"; // unchanged
    onDisk.decision = "APPROVED"; // unchanged
    onDisk.reason = "changed after signing"; // tampered field, hash now stale
    fs.writeFileSync(filePath, JSON.stringify(onDisk, null, 2), "utf8");

    await expect(store.loadApproval(ref)).rejects.toThrow(HashVerificationViolation);
  });

  it("rejects an artifact with no signature", async () => {
    const store = new FileCheckpointStore(tempDir, serializer, hashEngine, realSignatureVerifier);
    const ref = writeValidApproval("approval-no-sig");

    const filePath = path.join(approvalsDir, "approval-no-sig.json");
    const onDisk = JSON.parse(fs.readFileSync(filePath, "utf8"));
    delete onDisk.signature;
    fs.writeFileSync(filePath, JSON.stringify(onDisk, null, 2), "utf8");

    // Recompute the reference's expected hash to match the now-signature-less
    // envelope, isolating this test to the "no signature" failure mode rather
    // than also tripping the hash-mismatch check.
    const { content_hash, signature, artifact_id, ...envelope } = onDisk;
    const recomputed = hashEngine.hash(serializer.serialize(envelope));
    const isolatedRef: ArtifactReference = { artifact_id, artifact_type: "DATASET_APPROVAL", content_hash: recomputed };
    onDisk.content_hash = recomputed;
    fs.writeFileSync(filePath, JSON.stringify(onDisk, null, 2), "utf8");

    await expect(store.loadApproval(isolatedRef)).rejects.toThrow(SignatureVerificationViolation);
  });

  it("rejects a syntactically valid but cryptographically invalid signature", async () => {
    const store = new FileCheckpointStore(tempDir, serializer, hashEngine, alwaysRejectVerifier);
    const ref = writeValidApproval("approval-bad-sig");

    await expect(store.loadApproval(ref)).rejects.toThrow(SignatureVerificationViolation);
  });

  it("still throws the original not-found error when no file exists at the path", async () => {
    const store = new FileCheckpointStore(tempDir, serializer, hashEngine, realSignatureVerifier);
    const ref: ArtifactReference = {
      artifact_id: "does-not-exist",
      artifact_type: "DATASET_APPROVAL",
      content_hash: { algorithm: "sha256", digest: "irrelevant" },
    };

    await expect(store.loadApproval(ref)).rejects.toThrow(/hittades inte/);
  });
});
