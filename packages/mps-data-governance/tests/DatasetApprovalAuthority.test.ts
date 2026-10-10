import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { ArtifactIdentityStrategy, CanonicalArtifactSerializer, CanonicalHashEngine, SignatureVerifier } from "../../mps-core/src/types";
import { FileCheckpointStore } from "../src/FileCheckpointStore";
import { DatasetApprovalAuthority, type DatasetApprovalSigner } from "../src/DatasetApprovalAuthority";
import { DatasetApprovalController } from "../src/DatasetApprovalController";
import { FileDatasetApprovalStore } from "../src/FileDatasetApprovalStore";
import { ImportGate } from "../src/ImportGate";
import type { ImportGateEvidenceArtifact } from "../src/ImportGateTypes";

function sort(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sort);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort().map(([k, v]) => [k, sort(v)]));
}
const serializer: CanonicalArtifactSerializer = { serialize: v => new TextEncoder().encode(JSON.stringify(sort(v))) };
const hash: CanonicalHashEngine = { hash: bytes => ({ algorithm: "sha256", digest: createHash("sha256").update(bytes).digest("hex") }) };
const strategy: ArtifactIdentityStrategy = { createArtifactId: h => `approval-${h.digest.slice(0, 24)}` };
const trustedSigner: DatasetApprovalSigner = { keyId: "dataset-approval-trusted-v1", sign: async h => ({ algorithm: "ed25519", key_id: "dataset-approval-trusted-v1", signature: `trusted:${h.digest}` }) };
const verifier: SignatureVerifier = { verify: async (h, s) => s.key_id === trustedSigner.keyId && s.signature === `trusted:${h.digest}` };
const manifest = { id: "manifest-byggnader", content_hash: { algorithm: "sha256", digest: "a".repeat(64) } };
const producer = { identity_ref: { id: "harvest-agent", content_hash: { algorithm: "sha256", digest: "b".repeat(64) } }, role: "SYSTEM_PROCESS" as const };
const reviewer = { identity_ref: { id: "reviewer-1", content_hash: { algorithm: "sha256", digest: "c".repeat(64) } }, role: "GOVERNANCE_REVIEWER" as const };

describe("DatasetApprovalAuthority", () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach(d => rmSync(d, { recursive: true, force: true })));

  function setup(overrides: { signer?: DatasetApprovalSigner; trusted?: boolean; producer?: typeof producer } = {}) {
    const root = mkdtempSync(join(tmpdir(), "dataset-approval-")); dirs.push(root);
    const checkpoints = new FileCheckpointStore(root, serializer, hash, verifier);
    const authority = new DatasetApprovalAuthority(
      serializer, hash, overrides.signer ?? trustedSigner, strategy,
      { resolveVerifiedManifest: async ref => ({ manifest_ref: manifest, producer: overrides.producer ?? producer }) },
      { assertTrustedDatasetApprovalSigner: async key => { if (overrides.trusted === false || key !== trustedSigner.keyId) throw new Error("REJECT_UNTRUSTED_DATASET_APPROVAL_SIGNER"); } },
      new FileDatasetApprovalStore(root), checkpoints,
    );
    return { root, authority, checkpoints };
  }
  const request = (overrides: Record<string, unknown> = {}) => ({ manifest_ref: manifest, decision: "APPROVED" as const, actor_ref: reviewer, decision_at: "2026-10-09T12:00:00.000Z", reason: "Independent governance review approved this exact manifest.", ...overrides });

  function gate() {
    const stored = new Map<string, ImportGateEvidenceArtifact>();
    return new ImportGate(serializer, hash, trustedSigner, strategy, {
      put: async artifact => {
        stored.set(artifact.artifact_id, artifact);
        return { artifact_id: artifact.artifact_id, artifact_type: artifact.artifact_type, content_hash: artifact.content_hash };
      },
    });
  }

  it("creates, persists and reloads a canonical signed DATASET_APPROVAL", async () => {
    const { authority, checkpoints } = setup();
    const ref = await authority.decide(request());
    const artifact = await checkpoints.loadApproval(ref);
    expect(artifact.artifact_type).toBe("DATASET_APPROVAL");
    expect(artifact.approved_ref).toEqual(manifest);
    expect(artifact.decision).toBe("APPROVED");
    expect(artifact.actor_ref).toEqual(reviewer);
    expect(artifact.signature.key_id).toBe(trustedSigner.keyId);
    expect(ref).toEqual({ artifact_id: artifact.artifact_id, artifact_type: "DATASET_APPROVAL", content_hash: artifact.content_hash });
  });

  it.each([
    ["SYSTEM_PROCESS", { ...reviewer, role: "SYSTEM_PROCESS" }],
    ["EVOLUTION_AGENT", { ...reviewer, role: "EVOLUTION_AGENT" }],
    ["missing identity", { ...reviewer, identity_ref: { id: "", content_hash: reviewer.identity_ref.content_hash } }],
  ])("rejects %s as a reviewer", async (_name, actor_ref) => {
    await expect(setup().authority.decide(request({ actor_ref }))).rejects.toThrow(/REJECT_DATASET_APPROVAL_REVIEWER/);
  });

  it("rejects empty reason and self approval before signing", async () => {
    await expect(setup().authority.decide(request({ reason: " " }))).rejects.toThrow("REJECT_DATASET_APPROVAL_REASON_REQUIRED");
    await expect(setup({ producer: reviewer as any }).authority.decide(request())).rejects.toThrow("REJECT_DATASET_APPROVAL_SELF_APPROVAL");
  });

  it("rejects a valid signature from an untrusted signer before persistence", async () => {
    const untrusted: DatasetApprovalSigner = { keyId: "random-ed25519", sign: async h => ({ algorithm: "ed25519", key_id: "random-ed25519", signature: `random:${h.digest}` }) };
    const { authority, root } = setup({ signer: untrusted, trusted: false });
    await expect(authority.decide(request())).rejects.toThrow("REJECT_UNTRUSTED_DATASET_APPROVAL_SIGNER");
    expect(() => readFileSync(join(root, "National_Archive", "_quarantine", "approvals"))).toThrow();
  });

  it("rejects a signer that reports a signature under a different key id", async () => {
    const mismatched: DatasetApprovalSigner = { keyId: trustedSigner.keyId, sign: async h => ({ algorithm: "ed25519", key_id: "other-key", signature: `trusted:${h.digest}` }) };
    const { authority, root } = setup({ signer: mismatched });
    await expect(authority.decide(request())).rejects.toThrow("REJECT_DATASET_APPROVAL_SIGNER_KEY_MISMATCH");
    expect(() => readFileSync(join(root, "National_Archive", "_quarantine", "approvals"))).toThrow();
  });

  it("is idempotent for identical approval and rejects a divergent collision", async () => {
    const { authority, root } = setup();
    const one = await authority.decide(request());
    const two = await authority.decide(request());
    expect(two).toEqual(one);
    const path = join(root, "National_Archive", "_quarantine", "approvals", `${one.artifact_id}.json`);
    const altered = JSON.parse(readFileSync(path, "utf8")); altered.reason = "different"; writeFileSync(path, JSON.stringify(altered), "utf8");
    await expect(authority.decide(request())).rejects.toThrow("REJECT_DATASET_APPROVAL_COLLISION");
  });

  it("refuses a tampered persisted approval on independent reload", async () => {
    const { authority, checkpoints, root } = setup();
    const ref = await authority.decide(request());
    const path = join(root, "National_Archive", "_quarantine", "approvals", `${ref.artifact_id}.json`);
    const altered = JSON.parse(readFileSync(path, "utf8")); altered.reason = "tampered"; writeFileSync(path, JSON.stringify(altered), "utf8");
    await expect(checkpoints.loadApproval(ref)).rejects.toThrow(/content does not match/);
  });

  it("refuses an invalid signature from the persisted approval before the gate can see it", async () => {
    const { authority, checkpoints, root } = setup();
    const ref = await authority.decide(request());
    const path = join(root, "National_Archive", "_quarantine", "approvals", `${ref.artifact_id}.json`);
    const altered = JSON.parse(readFileSync(path, "utf8")); altered.signature.signature = "forged"; writeFileSync(path, JSON.stringify(altered), "utf8");
    await expect(checkpoints.loadApproval(ref)).rejects.toThrow(/signature does not verify/);
  });

  it("requires an explicit controller confirmation before an APPROVED governance act", async () => {
    const { authority, root } = setup();
    const controller = new DatasetApprovalController(authority, { actor_ref: reviewer });
    await expect(controller.decide({ manifest_ref: manifest, decision: "APPROVED", reason: "Reviewed", decision_at: "2026-10-09T12:00:00.000Z" })).rejects.toThrow("REJECT_DATASET_APPROVAL_EXPLICIT_CONFIRMATION_REQUIRED");
    expect(() => readFileSync(join(root, "National_Archive", "_quarantine", "approvals"))).toThrow();
  });

  it("allows the verified authority output through the real ImportGate", async () => {
    const { authority, checkpoints } = setup();
    const artifact = await checkpoints.loadApproval(await authority.decide(request()));
    await expect(gate().evaluate({ manifest_ref: manifest, approval_artifact: artifact, compliance_results: [{ control_id: "MB-006", result: "PASS" }] }, "2026-10-09T12:01:00.000Z"))
      .resolves.toMatchObject({ decision: "ALLOW_IMPORT", failed_controls: [] });
  });

  it.each([
    ["missing approval", null, manifest, [], "IMPORT_GATE_MISSING_APPROVAL"],
    ["wrong manifest", "approval", { ...manifest, id: "other-manifest" }, [], "IMPORT_GATE_APPROVAL_MANIFEST_MISMATCH"],
    ["rejected decision", "rejected", manifest, [], "IMPORT_GATE_DECISION_REJECTED"],
    ["failed compliance", "approval", manifest, [{ control_id: "MB-006", result: "FAIL" as const }], "MB-006"],
  ])("blocks ImportGate for %s", async (_name, variant, manifest_ref, compliance_results, code) => {
    const { authority, checkpoints } = setup();
    const valid = await checkpoints.loadApproval(await authority.decide(request()));
    const approval_artifact = variant === null ? null : variant === "rejected" ? { ...valid, decision: "REJECTED" as const } : valid;
    await expect(gate().evaluate({ manifest_ref, approval_artifact, compliance_results }, "2026-10-09T12:01:00.000Z"))
      .resolves.toMatchObject({ decision: "BLOCK_IMPORT", failed_controls: [code] });
  });
});
