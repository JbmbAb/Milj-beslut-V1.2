import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

import {
  GovernedQuarantineBridge,
  type GovernedQuarantineRecord,
  type VerifiedSourceAuthorityLookup,
} from "../src/ingestion/GovernedQuarantineBridge";

/**
 * ✅ P3-LU-QUARANTINE-BRIDGE-01 — QUARANTINE_BRIDGE_PROVENANCE_V1.
 *
 *   Invariant under test:
 *     Every field of an LU RawSourceArtifact is derivable from stored bytes, stored quarantine
 *     metadata, or the signed SourceRegistry artifact the object was acquired under. Anything
 *     unsourceable FAILS CLOSED — it is never defaulted, inferred or reconstructed.
 *
 *   Why this is a unit and not a type adapter: it translates between two authority-bearing
 *   contracts that happen to share type NAMES while having different shapes and different
 *   meanings. `authority: "Domstolsverket"` filled from a lookup table would read as attested
 *   provenance while being a constant in code — the defect class P2-AUTH-00 closed when it
 *   caught the deleted harvester emitting a placeholder string in place of a real registry
 *   signature.
 *
 *   The positive proof uses REAL material: an actual MMÖD judgment acquired through the proven
 *   P2 governed chain and still resident in `.quarantine/`. No fixture substitution.
 */
describe("P3-LU-QUARANTINE-BRIDGE-01 — governed quarantine → LU raw source", () => {
  const REPO_ROOT = resolve(__dirname, "../../..");
  const QUARANTINE = join(REPO_ROOT, ".quarantine");

  /** A verified-registry stub. Real signature verification is the registry's job, not ours. */
  function lookup(
    entries: { registryArtifactId: string; sourceId: string; authorityName: string }[],
  ): VerifiedSourceAuthorityLookup {
    return {
      findByArtifactId: (id) => entries.find((e) => e.registryArtifactId === id) ?? null,
    };
  }

  const PUH = {
    registryArtifactId: "reg-dv-puh-mmod-003",
    sourceId: "domstolsverket-puh-mmod",
    authorityName: "Domstolsverket",
  };

  const BYTES = new TextEncoder().encode("%PDF-1.5 fake judgment bytes");
  const HASH = createHash("sha256").update(BYTES).digest("hex");

  function record(over: Partial<GovernedQuarantineRecord> = {}): GovernedQuarantineRecord {
    return {
      quarantine_id: "q-1",
      source_id: PUH.sourceId,
      source_url: "https://rattspraxis.etjanst.domstol.se/api/v1/bilagor/abc",
      file_name: "MMOD_2026-03-27_M_10760-24_Dom.pdf",
      retrieved_at: "2026-08-14T13:13:57.374Z",
      content_hash: HASH,
      custom_metadata: { registry_artifact_id: PUH.registryArtifactId },
      ...over,
    };
  }

  // ------------------------------------------------------------------ RED-4

  it("RED-4: rejects when the referenced registry artifact is missing", () => {
    const bridge = new GovernedQuarantineBridge(lookup([PUH]));

    expect(() =>
      bridge.materialize(record({ custom_metadata: {} }), BYTES),
    ).toThrow(/REJECT_MISSING_GOVERNANCE_REF/);

    expect(() =>
      bridge.materialize(record({ custom_metadata: undefined }), BYTES),
    ).toThrow(/REJECT_MISSING_GOVERNANCE_REF/);
  });

  // ------------------------------------------------------------------ RED-5

  it("RED-5: rejects when the registry artifact is not verified/approved", () => {
    // Empty lookup = the id resolves to no APPROVED, signature-verified entry.
    const bridge = new GovernedQuarantineBridge(lookup([]));

    expect(() => bridge.materialize(record(), BYTES)).toThrow(/REJECT_UNVERIFIED_AUTHORITY/);
  });

  it("RED-5b: rejects when the authority governs a different source", () => {
    const bridge = new GovernedQuarantineBridge(
      lookup([{ ...PUH, sourceId: "some-other-source" }]),
    );

    expect(() => bridge.materialize(record(), BYTES)).toThrow(/REJECT_SOURCE_BINDING/);
  });

  // ------------------------------------------------------------------ RED-6

  it("RED-6: rejects a content hash mismatch", () => {
    const bridge = new GovernedQuarantineBridge(lookup([PUH]));
    const tampered = new TextEncoder().encode("%PDF-1.5 different bytes");

    expect(() => bridge.materialize(record(), tampered)).toThrow(/REJECT_CONTENT_HASH/);
  });

  // ------------------------------------------------------------------ RED-7

  it("RED-7: rejects any provenance field that cannot be sourced", () => {
    const bridge = new GovernedQuarantineBridge(lookup([PUH]));

    for (const field of ["file_name", "source_url", "retrieved_at"] as const) {
      expect(
        () => bridge.materialize(record({ [field]: "" }), BYTES),
        `${field} must fail closed rather than being defaulted`,
      ).toThrow(/REJECT_UNSOURCEABLE_FIELD/);
    }

    expect(() =>
      bridge.materialize(record(), BYTES) &&
      new GovernedQuarantineBridge(lookup([{ ...PUH, authorityName: "" }])).materialize(
        record(),
        BYTES,
      ),
    ).toThrow(/REJECT_UNSOURCEABLE_AUTHORITY/);
  });

  // ------------------------------------------------- legacy policy is never fabricated

  it("never populates the semantically-unspecified legacy `policy` field", () => {
    const bridge = new GovernedQuarantineBridge(lookup([PUH]));
    const artifact = bridge.materialize(record(), BYTES);

    expect(
      Object.prototype.hasOwnProperty.call(artifact.payload, "policy"),
      "`policy` has no defined meaning and no authoritative source. Populating it — with the " +
        "registry artifact id, the acquisition policy, or a literal — would manufacture provenance.",
    ).toBe(false);
  });

  // ------------------------------------------------- the two hashes stay distinct

  it("binds byte identity and canonical identity as SEPARATE hashes", () => {
    const bridge = new GovernedQuarantineBridge(lookup([PUH]));
    const artifact = bridge.materialize(record(), BYTES);

    expect(artifact.payload.source_content_hash).toBe(HASH);
    expect(
      artifact.content_hash.value,
      "content_hash hashes the canonical payload; source_content_hash hashes the acquired " +
        "bytes. Equal values would mean one of the two identities is not being computed.",
    ).not.toBe(HASH);
  });

  // ------------------------------------------------- historical authority is preserved

  it("resolves the authority the object was ACQUIRED under, not the active one", () => {
    const superseded = {
      registryArtifactId: "reg-dv-puh-mmod-002",
      sourceId: PUH.sourceId,
      authorityName: "Domstolsverket",
    };
    const bridge = new GovernedQuarantineBridge(lookup([PUH, superseded]));

    const artifact = bridge.materialize(
      record({ custom_metadata: { registry_artifact_id: "reg-dv-puh-mmod-002" } }),
      BYTES,
    );

    expect(
      artifact.payload.source_governance_artifact_id,
      "The 144 objects harvested before the PUH size reissue legitimately carry -002. " +
        "Rewriting them to the active -003 would falsify which signed scope authorised them.",
    ).toBe("reg-dv-puh-mmod-002");
  });

  // ------------------------------------------------------ REAL MATERIAL (no fixtures)

  describe("real governed material from the P2 harvest", () => {
    const available =
      existsSync(QUARANTINE) &&
      readdirSync(QUARANTINE).some((f) => f.endsWith(".metadata.json"));

    it.runIf(available)("materializes a REAL quarantined MMÖD judgment", () => {
      const metaFile = readdirSync(QUARANTINE).filter((f) => f.endsWith(".metadata.json"))[0];
      const meta = JSON.parse(readFileSync(join(QUARANTINE, metaFile), "utf8"));
      const bytes = new Uint8Array(
        readFileSync(join(QUARANTINE, `${meta.quarantine_id}.bin`)),
      );

      // The authority is whatever this object was actually acquired under.
      const bridge = new GovernedQuarantineBridge(
        lookup([
          { registryArtifactId: "reg-dv-puh-mmod-002", sourceId: meta.source_id, authorityName: "Domstolsverket" },
          { registryArtifactId: "reg-dv-puh-mmod-003", sourceId: meta.source_id, authorityName: "Domstolsverket" },
        ]),
      );

      const artifact = bridge.materialize(meta, bytes);

      // Byte identity reconciles against material acquired through the proven P2 chain.
      expect(artifact.payload.source_content_hash).toBe(meta.content_hash);
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(meta.content_hash);

      expect(artifact.payload.filename).toBe(meta.file_name);
      expect(artifact.payload.original_path).toBe(meta.source_url);
      expect(artifact.payload.observed_at).toBe(meta.retrieved_at);
      expect(artifact.payload.authority).toBe("Domstolsverket");
      expect(artifact.payload.source_governance_artifact_id).toBe(
        meta.custom_metadata.registry_artifact_id,
      );
      expect(Object.prototype.hasOwnProperty.call(artifact.payload, "policy")).toBe(false);

      // Real PDF, not a fixture.
      expect(Buffer.from(bytes.subarray(0, 5)).toString("latin1")).toBe("%PDF-");
      expect(bytes.byteLength).toBeGreaterThan(10_000);
      expect(artifact.artifact_type).toBe("RAW_SOURCE_ARTIFACT");
    });

    /**
     * The real-material proof is environment-dependent by nature: `.quarantine/` is gitignored,
     * so a fresh clone or a CI runner has no governed bytes and the proof above cannot run.
     *
     * A hard assertion here would fail every checkout that has not executed a live harvest —
     * which is not a defect being caught, only an absent fixture-free input. But letting it
     * skip unconditionally would let the unit's central claim evaporate silently.
     *
     * So: it skips visibly by default (vitest prints the skip), and a lane that provisions
     * real material sets REQUIRE_REAL_QUARANTINE=1 to make absence a failure.
     */
    it.runIf(!available && process.env.REQUIRE_REAL_QUARANTINE === "1")(
      "REQUIRE_REAL_QUARANTINE=1 but no governed material is present",
      () => {
        expect(
          available,
          "REQUIRE_REAL_QUARANTINE=1 demands a real-material proof, but `.quarantine/` holds " +
            "no governed bytes. Run the P2 harvest first — this unit's positive proof must use " +
            "real acquired material, never a fixture.",
        ).toBe(true);
      },
    );
  });
});
