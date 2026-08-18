// packages/mps-data-governance/tests/ImportGate.test.ts

import { describe, it, expect } from "vitest";
import { ImportGate } from "../src/ImportGate";
import type { ImportGateEvidenceArtifact } from "../src/ImportGateTypes";
import type {
  ArtifactReference,
  CanonicalArtifactSerializer,
  CanonicalHashEngine,
  Signer,
  ArtifactIdentityStrategy,
} from "../../mps-core/src/types";

/**
 * Recursive key sort, so nested references survive serialization. The gate
 * previously relied on `JSON.stringify(obj, Object.keys(obj).sort())`, which
 * is a replacer allowlist and erased them.
 */
function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value === null || typeof value !== "object") return value;
  const entries = Object.entries(value as Record<string, unknown>).sort(
    ([a], [b]) => (a < b ? -1 : a > b ? 1 : 0),
  );
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
const signer: Signer = {
  sign: async (h) => ({ algorithm: "ed25519", signature: `sig:${h.digest}` }),
};
const identityStrategy: ArtifactIdentityStrategy = {
  createArtifactId: (h) => `id:${h.digest}`,
};

function makeStore() {
  const stored = new Map<string, ImportGateEvidenceArtifact>();
  return {
    put: async (artifact: ImportGateEvidenceArtifact): Promise<ArtifactReference> => {
      stored.set(artifact.artifact_id, artifact);
      return {
        artifact_id: artifact.artifact_id,
        artifact_type: artifact.artifact_type,
        content_hash: artifact.content_hash,
      };
    },
    get: (ref: ArtifactReference) => stored.get(ref.artifact_id),
  };
}

function fakeManifestRef(id = "m1", digest = "manifest-digest") {
  return { id, content_hash: { algorithm: "sha256", digest } };
}

describe("ImportGate", () => {
  it("blocks missing approval and still produces signed evidence (does not throw)", async () => {
    const gate = new ImportGate(serializer, hashEngine, signer, identityStrategy, makeStore());
    const result = await gate.evaluate(
      { manifest_ref: fakeManifestRef(), approval_artifact: null, compliance_results: [] },
      "2026-08-07T00:00:00Z",
    );
    expect(result.decision).toBe("BLOCK_IMPORT");
    expect(result.failed_controls).toEqual(["IMPORT_GATE_MISSING_APPROVAL"]);
    expect(result.evidence_ref).toBeDefined();
  });

  it("evaluated_at does not affect content_hash OR signature (non-binding)", async () => {
    const store1 = makeStore();
    const store2 = makeStore();
    const gate1 = new ImportGate(serializer, hashEngine, signer, identityStrategy, store1);
    const gate2 = new ImportGate(serializer, hashEngine, signer, identityStrategy, store2);

    const request = { manifest_ref: fakeManifestRef(), approval_artifact: null, compliance_results: [] };

    const r1 = await gate1.evaluate(request, "2026-08-07T00:00:00Z");
    const r2 = await gate2.evaluate(request, "2026-08-07T05:00:00Z");

    const a1 = store1.get(r1.evidence_ref)!;
    const a2 = store2.get(r2.evidence_ref)!;

    expect(a1.evaluated_at).not.toBe(a2.evaluated_at);
    expect(a1.content_hash).toEqual(a2.content_hash);
    expect(a1.signature).toEqual(a2.signature);
  });

  it("separates control failure from a valid REJECTED decision", async () => {
    const gate = new ImportGate(serializer, hashEngine, signer, identityStrategy, makeStore());
    const manifest_ref = fakeManifestRef();
    const approval_artifact: any = { approved_ref: manifest_ref, decision: "REJECTED" };

    const result = await gate.evaluate(
      { manifest_ref, approval_artifact, compliance_results: [{ control_id: "MB-006", result: "PASS" }] },
      "2026-08-07T00:00:00Z",
    );

    expect(result.decision).toBe("BLOCK_IMPORT");
    expect(result.failed_controls).toEqual(["IMPORT_GATE_DECISION_REJECTED"]);
  });

  it("REGRESSION: gate evidence binds the manifest it gated", async () => {
    const store = makeStore();
    const gate = new ImportGate(serializer, hashEngine, signer, identityStrategy, store);

    const a = await gate.evaluate(
      { manifest_ref: fakeManifestRef("m1", "digest-a"), approval_artifact: null, compliance_results: [] },
      "2026-08-07T00:00:00Z",
    );
    const b = await gate.evaluate(
      { manifest_ref: fakeManifestRef("m2", "digest-b"), approval_artifact: null, compliance_results: [] },
      "2026-08-07T00:00:00Z",
    );

    // Same decision, same failed controls, different dataset. The inline
    // serializer erased manifest_ref, so these two collided and one blocked
    // import could be presented as evidence for another.
    expect(a.evidence_ref.content_hash).not.toEqual(b.evidence_ref.content_hash);
    expect(store.get(a.evidence_ref)!.manifest_ref.content_hash.digest).toBe("digest-a");
  });

  it("blocks import when decision=APPROVED, manifest matches, compliance passes, but approver role is not GOVERNANCE_REVIEWER", async () => {
    const gate = new ImportGate(serializer, hashEngine, signer, identityStrategy, makeStore());
    const manifest_ref = fakeManifestRef();
    const approval_artifact: any = {
      approved_ref: manifest_ref,
      decision: "APPROVED",
      actor_ref: { identity_ref: { id: "actor-1", content_hash: { algorithm: "sha256", digest: "actor-digest" } }, role: "GOVERNOR" },
    };

    const result = await gate.evaluate(
      { manifest_ref, approval_artifact, compliance_results: [{ control_id: "MB-006", result: "PASS" }] },
      "2026-08-07T00:00:00Z",
    );

    expect(result.decision).toBe("BLOCK_IMPORT");
    expect(result.failed_controls).toEqual(["IMPORT_GATE_UNAUTHORIZED_APPROVER_ROLE"]);
  });

  it("allows import when decision=APPROVED, manifest matches, compliance passes, and approver role is GOVERNANCE_REVIEWER", async () => {
    const gate = new ImportGate(serializer, hashEngine, signer, identityStrategy, makeStore());
    const manifest_ref = fakeManifestRef();
    const approval_artifact: any = {
      approved_ref: manifest_ref,
      decision: "APPROVED",
      actor_ref: { identity_ref: { id: "actor-1", content_hash: { algorithm: "sha256", digest: "actor-digest" } }, role: "GOVERNANCE_REVIEWER" },
    };

    const result = await gate.evaluate(
      { manifest_ref, approval_artifact, compliance_results: [{ control_id: "MB-006", result: "PASS" }] },
      "2026-08-07T00:00:00Z",
    );

    expect(result.decision).toBe("ALLOW_IMPORT");
    expect(result.failed_controls).toEqual([]);
  });

  it("blocks (does not throw) when actor_ref or role is missing on an otherwise-approved artifact", async () => {
    const gate = new ImportGate(serializer, hashEngine, signer, identityStrategy, makeStore());
    const manifest_ref = fakeManifestRef();

    const missingActorRef: any = { approved_ref: manifest_ref, decision: "APPROVED" };
    const resultA = await gate.evaluate(
      { manifest_ref, approval_artifact: missingActorRef, compliance_results: [] },
      "2026-08-07T00:00:00Z",
    );
    expect(resultA.decision).toBe("BLOCK_IMPORT");
    expect(resultA.failed_controls).toEqual(["IMPORT_GATE_UNAUTHORIZED_APPROVER_ROLE"]);

    const missingRole: any = {
      approved_ref: manifest_ref,
      decision: "APPROVED",
      actor_ref: { identity_ref: { id: "actor-1", content_hash: { algorithm: "sha256", digest: "actor-digest" } } },
    };
    const resultB = await gate.evaluate(
      { manifest_ref, approval_artifact: missingRole, compliance_results: [] },
      "2026-08-07T00:00:00Z",
    );
    expect(resultB.decision).toBe("BLOCK_IMPORT");
    expect(resultB.failed_controls).toEqual(["IMPORT_GATE_UNAUTHORIZED_APPROVER_ROLE"]);
  });

  it("REGRESSION: programming errors bubble rather than becoming evidence", async () => {
    const brokenHashEngine: CanonicalHashEngine = {
      hash: () => {
        throw new TypeError("unexpected null in canonicalization");
      },
    };
    const gate = new ImportGate(serializer, brokenHashEngine, signer, identityStrategy, makeStore());
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
