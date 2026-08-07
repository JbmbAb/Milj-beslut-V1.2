// packages/mps-data-governance/tests/ImportGate.test.ts

import { describe, it, expect, vi } from "vitest";
import { ImportGate } from "../src/ImportGate";
import { GovernanceIntegrityViolation } from "../../mps-core/src/errors";
import type { CanonicalHashEngine, Signer, ArtifactIdentityStrategy } from "../../mps-core/src/types";

function fakeDigest(value: unknown): string {
  const s = JSON.stringify(value, Object.keys(value as object).sort());
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return `fake:${h}`;
}

const hashEngine: CanonicalHashEngine = {
  hash: (v) => ({ algorithm: "sha256", digest: fakeDigest(v) }),
};
const signer: Signer = {
  sign: async (h) => ({ algorithm: "ed25519", signature: `sig:${h.digest}` }),
};
const identityStrategy: ArtifactIdentityStrategy = {
  createArtifactId: (h) => `id:${h.digest}`,
};

function makeRepository() {
  const store = new Map<string, unknown>();
  return {
    put: async (artifact: any) => {
      store.set(artifact.artifact_id, artifact);
      return { reference: { id: artifact.artifact_id, content_hash: artifact.content_hash } };
    },
    get: async (ref: any) => store.get(ref.id),
  };
}

function fakeManifestRef() {
  return { id: "m1", content_hash: { algorithm: "sha256", digest: "manifest-digest" } };
}

describe("ImportGate", () => {
  it("blocks missing approval and still produces signed evidence (does not throw)", async () => {
    const gate = new ImportGate(hashEngine, signer, identityStrategy, makeRepository());
    const result = await gate.evaluate(
      { manifest_ref: fakeManifestRef(), approval_artifact: null, compliance_results: [] },
      "2026-08-07T00:00:00Z",
    );
    expect(result.decision).toBe("BLOCK_IMPORT");
    expect(result.failed_controls).toEqual(["IMPORT_GATE_MISSING_APPROVAL"]);
    expect(result.evidence_ref).toBeDefined();
  });

  it("evaluated_at does not affect content_hash OR signature (non-binding)", async () => {
    const repo1 = makeRepository();
    const repo2 = makeRepository();
    const gate1 = new ImportGate(hashEngine, signer, identityStrategy, repo1);
    const gate2 = new ImportGate(hashEngine, signer, identityStrategy, repo2);

    const request = { manifest_ref: fakeManifestRef(), approval_artifact: null, compliance_results: [] };

    const r1 = await gate1.evaluate(request, "2026-08-07T00:00:00Z");
    const r2 = await gate2.evaluate(request, "2026-08-07T05:00:00Z");

    const a1: any = await repo1.get(r1.evidence_ref);
    const a2: any = await repo2.get(r2.evidence_ref);

    expect(a1.evaluated_at).not.toBe(a2.evaluated_at);
    expect(a1.content_hash).toEqual(a2.content_hash);
    expect(a1.signature).toEqual(a2.signature);
  });

  it("separates control failure from a valid REJECTED decision", async () => {
    const gate = new ImportGate(hashEngine, signer, identityStrategy, makeRepository());
    const manifest_ref = fakeManifestRef();
    const approval_artifact: any = { approved_ref: manifest_ref, decision: "REJECTED" };

    const result = await gate.evaluate(
      { manifest_ref, approval_artifact, compliance_results: [{ control_id: "MB-006", result: "PASS" }] },
      "2026-08-07T00:00:00Z",
    );

    expect(result.decision).toBe("BLOCK_IMPORT");
    expect(result.failed_controls).toEqual(["IMPORT_GATE_DECISION_REJECTED"]);
  });

  it("REGRESSION: programming errors bubble rather than becoming evidence", async () => {
    const brokenHashEngine: CanonicalHashEngine = {
      hash: () => {
        throw new TypeError("unexpected null in canonicalization");
      },
    };
    const gate = new ImportGate(brokenHashEngine, signer, identityStrategy, makeRepository());
    const manifest_ref = fakeManifestRef();
    const approval_artifact: any = { approved_ref: manifest_ref, decision: "APPROVED" };

    await expect(
      gate.evaluate(
        { manifest_ref, approval_artifact, compliance_results: [] },
        "2026-08-07T00:00:00Z",
      ),
    ).rejects.toThrow(TypeError);
  });
});
