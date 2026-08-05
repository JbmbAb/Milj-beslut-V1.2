import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { FROZEN_CORE_V1_MANIFEST } from "../../../mps-governance/src/release/reference/FrozenCoreV1";
import { createFrozenCoreReleaseProjection } from "../../../mps-governance/src/release/FrozenCoreReleaseManifestProjectionFactory";
import { sha256CanonicalJson } from "../canonical/sha256Canonical";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const goldenDir = path.resolve(__dirname, "../../tests/golden");

/**
 * CI gate (unit project):
 * Canonical Projection → SHA-256 → golden hash → EXACT MATCH
 * One-byte projection drift MUST fail.
 */
describe("Frozen Core SHA-256 golden exact match", () => {
  it("projection → sha256 equals golden hash byte-for-byte", () => {
    const goldenHash = fs.readFileSync(path.join(goldenDir, "frozen-core-v1.hash"), "utf8").trim();
    const projection = createFrozenCoreReleaseProjection(FROZEN_CORE_V1_MANIFEST);
    const recomputed = sha256CanonicalJson(projection);

    expect(recomputed).toBe(goldenHash);
    expect(FROZEN_CORE_V1_MANIFEST.release_hash.value).toBe(goldenHash);
    expect(recomputed).toMatch(/^[a-f0-9]{64}$/);
    expect(recomputed).not.toBe("mock-hash");
  });

  it("fails on single-byte projection drift", () => {
    const goldenHash = fs.readFileSync(path.join(goldenDir, "frozen-core-v1.hash"), "utf8").trim();
    const projection = createFrozenCoreReleaseProjection(FROZEN_CORE_V1_MANIFEST);
    const drifted = {
      ...projection,
      release_version: projection.release_version + " ",
    };
    const driftedHash = sha256CanonicalJson(drifted);
    expect(driftedHash).not.toBe(goldenHash);
    expect(driftedHash).toHaveLength(64);
  });

  it("golden JSON release_hash matches live manifest exactly", () => {
    const golden = JSON.parse(
      fs.readFileSync(path.join(goldenDir, "frozen-core-v1.json"), "utf8"),
    );
    expect(golden.release_hash.value).toBe(FROZEN_CORE_V1_MANIFEST.release_hash.value);
    expect(golden.content_hash.value).toBe(FROZEN_CORE_V1_MANIFEST.content_hash.value);
  });
});
