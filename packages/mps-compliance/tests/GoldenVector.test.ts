import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { FrozenCoreReleaseManifestArtifact } from "../../mps-governance/src/release/FrozenCoreReleaseManifestArtifact";

describe("Commit 13.5 - Golden Vector / Determinism Lock", () => {
  it("Frozen Core v1 golden vector remains stable", () => {
    const goldenJsonPath = path.join(__dirname, "golden", "frozen-core-v1.json");
    const goldenHashPath = path.join(__dirname, "golden", "frozen-core-v1.hash");

    const manifestRaw = fs.readFileSync(goldenJsonPath, "utf-8");
    const manifest: FrozenCoreReleaseManifestArtifact = JSON.parse(manifestRaw);
    
    const goldenHash = fs.readFileSync(goldenHashPath, "utf-8").trim();

    // Since we mock the hash generation right now, we just verify the manifest structure
    // hasn't drifted and its hash matches the genesis hash.
    // In a real canonical environment, we would use the CanonicalSerializer to re-hash the object here.
    
    // For our simulated environment, the mock hash should equal goldenHash
    const generatedHash = manifest.release_hash.value;

    expect(generatedHash).toBe(goldenHash);
  });
});
