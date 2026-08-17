import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { globSync } from "glob";
import { sha256ContentHash } from "../../packages/mps-compliance/src/canonical/sha256Canonical.js";

/**
 * Final Freeze Audit — Human Governance Interface v1.0
 *
 * Enforcement boundary for Frozen Core. No new domains.
 * Canonical identity MUST be: payload → RFC 8785 → SHA-256 → content identity.
 */
describe("Final Freeze Audit: Human Governance Interface v1.0", () => {
  it("1. All authority-bearing artifacts go via CAS", () => {
    const files = globSync("packages/**/*.ts", { ignore: "**/node_modules/**" });
    const directWrites = files.filter((f) => {
      const code = readFileSync(f, "utf8");
      return code.includes("fs.writeFileSync") && code.includes("artifact_type");
    });
    expect(directWrites.length).toBe(0);
  });

  it("2. Quarantine -> Approval -> CAS is the only governed ingestion path", () => {
    const files = globSync("packages/**/*.ts", { ignore: "**/node_modules/**" });
    const illegalDirectIngest = files.filter((f) => {
      if (f.includes("QuarantinePromoter") || f.includes("RawSourceIngestor") || f.includes("test")) {
        return false;
      }
      const code = readFileSync(f, "utf8");
      return code.includes('artifact_type: "DOCUMENT_EVIDENCE"') && code.includes("cas.put");
    });
    expect(illegalDirectIngest.length).toBe(0);
  });

  it("FF-01: Viewer resolution requires valid capability.release_hash", () => {
    const viewerKernelCode = readFileSync("packages/mps-lu/src/viewer/ViewerKernel.ts", "utf8");
    expect(viewerKernelCode).toContain("ViewerCapabilityArtifact");
    expect(viewerKernelCode).toContain("release_hash");
    expect(viewerKernelCode).toContain("lacks a verified release_hash");
  });

  it("FF-01b: ViewerCapabilityArtifact binds viewer_identity_ref provenance", () => {
    const capability = readFileSync(
      "packages/mps-compliance/src/artifacts/ViewerCapabilityArtifact.ts",
      "utf8",
    );
    const viewerKernelCode = readFileSync("packages/mps-lu/src/viewer/ViewerKernel.ts", "utf8");
    expect(capability).toContain("viewer_identity_ref");
    expect(viewerKernelCode).toContain("viewer_identity_ref");
    expect(viewerKernelCode).toContain("lacks viewer_identity_ref provenance");
  });

  it("FF-02: Every denied governance admission creates GovernanceRejectionArtifact in CAS", () => {
    const kernel = readFileSync("packages/mps-runtime/src/kernel/ExecutionKernel.ts", "utf8");
    expect(kernel).toContain("GovernanceRejectionArtifact");
    expect(kernel).toContain("artifactRepository.put");

    const files = globSync("packages/**/*.ts", { ignore: "**/node_modules/**" });
    const usages = files.filter((f) => {
      const code = readFileSync(f, "utf8");
      return code.includes("GovernanceRejectionArtifact") && !f.includes("GovernanceRejectionArtifact.ts");
    });
    expect(usages.length).toBeGreaterThan(0);
  });

  it("5. ViewerKernel cannot produce authority", () => {
    const viewerKernelCode = readFileSync("packages/mps-lu/src/viewer/ViewerKernel.ts", "utf8");
    expect(viewerKernelCode).not.toContain("this.cas.put");
    expect(viewerKernelCode).toContain("VERIFIED_OBSERVATION");
  });

  it("6. Replay can be run from artifacts without live external dependencies", () => {
    const replayCode = readFileSync("packages/mps-runtime/src/replay/DefaultReplayEngine.ts", "utf8");
    expect(replayCode).not.toContain("PostgisSpatialProvider");
    expect(replayCode).not.toContain("pg");
  });

  it("FF-03: sha256ContentHash is RFC 8785 and is the sole identity hasher for Frozen Core", async () => {
    const hashCode = readFileSync("packages/mps-compliance/src/canonical/sha256Canonical.ts", "utf8");
    expect(hashCode).toContain("json-canonicalize");
    expect(hashCode).toContain("canonicalize(");
    expect(hashCode).not.toMatch(/createHash\([^)]+\)\.update\([^)]*JSON\.stringify/);

    // Kernel re-exports the same enforcement surface
    const kernel = await import("../../packages/mps-runtime/src/kernel/ExecutionKernel.ts");
    expect(typeof kernel.sha256ContentHash).toBe("function");

    const objA = { z: 1, a: 2, arr: [1, 2] };
    const objB = { a: 2, arr: [1, 2], z: 1 };

    const fromCanonical = sha256ContentHash(objA);
    const fromKernelA = kernel.sha256ContentHash(objA);
    const fromKernelB = kernel.sha256ContentHash(objB);

    expect(fromKernelA.value).toBe(fromKernelB.value);
    expect(fromKernelA.value).toBe(fromCanonical.value);
    expect(fromKernelA.algorithm).toBe("sha256");
  });

  it("FF-04: No other canonical artifact identity path uses JSON.stringify hashing", () => {
    // Frozen Core packages that mint content identity
    const scope = globSync("packages/{mps-runtime,mps-lu,mps-compliance,mps-decision-governance,mps-materialization}/**/*.ts", {
      ignore: ["**/node_modules/**", "**/*.test.ts", "**/tests/**"],
    });

    const offenders: string[] = [];
    for (const f of scope) {
      const code = readFileSync(f, "utf8");
      // Direct hash of JSON.stringify
      if (/createHash\s*\(\s*['"]sha256['"]\s*\)[\s\S]{0,120}?JSON\.stringify/.test(code)) {
        offenders.push(f);
        continue;
      }
      // Local sha256ContentHash that still uses JSON.stringify
      if (
        /function\s+sha256ContentHash[\s\S]{0,200}?JSON\.stringify/.test(code) ||
        /const\s+sha256ContentHash\s*=[\s\S]{0,200}?JSON\.stringify/.test(code)
      ) {
        offenders.push(f);
      }
    }

    expect(offenders).toEqual([]);
  });

  it("FF-05: ExecutionKernel is the admission gate that emits GovernanceRejectionArtifact", () => {
    const kernel = readFileSync("packages/mps-runtime/src/kernel/ExecutionKernel.ts", "utf8");
    expect(kernel).toContain("admit(");
    expect(kernel).toContain('artifact_type: "GovernanceRejectionArtifact"');
    expect(kernel).toContain("sha256ContentHash");
  });
});
