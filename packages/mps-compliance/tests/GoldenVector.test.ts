import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { FROZEN_CORE_V1_MANIFEST } from "../../mps-governance/src/release/reference/FrozenCoreV1";
import { createFrozenCoreReleaseProjection } from "../../mps-governance/src/release/FrozenCoreReleaseManifestProjectionFactory";
import { sha256CanonicalJson } from "../src/canonical/sha256Canonical";

describe("Commit 13.5 - Golden Vector / Determinism Lock", () => {
  it("Canonical Projection → SHA-256 → golden hash → EXACT MATCH", () => {
    const goldenJsonPath = path.join(__dirname, "golden", "frozen-core-v1.json");
    const goldenHashPath = path.join(__dirname, "golden", "frozen-core-v1.hash");

    const goldenHash = fs.readFileSync(goldenHashPath, "utf-8").trim();
    const goldenManifest = JSON.parse(fs.readFileSync(goldenJsonPath, "utf-8"));
    const projection = createFrozenCoreReleaseProjection(FROZEN_CORE_V1_MANIFEST);
    const recomputed = sha256CanonicalJson(projection);

    expect(recomputed).toBe(goldenHash);
    expect(FROZEN_CORE_V1_MANIFEST.release_hash.value).toBe(goldenHash);
    expect(goldenManifest.release_hash.value).toBe(goldenHash);

    const drifted = sha256CanonicalJson({
      ...projection,
      matrix_id: projection.matrix_id + "\0",
    });
    expect(drifted).not.toBe(goldenHash);
  });
});
