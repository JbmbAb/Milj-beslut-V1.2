import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

interface ProofEntry {
  readonly file: string;
  readonly expected_tests: number;
}

interface SupersededProof {
  readonly historical_file: string;
  readonly sha256: string;
  readonly replacement_proofs: readonly string[];
}

interface Hm1ProofRegistry {
  readonly lane: {
    readonly runner_file: string;
    readonly command: string;
    readonly ci_workflow: string;
  };
  readonly required_support_files: readonly string[];
  readonly required_proofs: readonly ProofEntry[];
  readonly superseded_proofs: readonly SupersededProof[];
}

const root = process.cwd();
const registryPath = path.join(root, "docs", "architecture", "HM1-PROOF-REGISTRY-2026-08-13.json");
const registry = JSON.parse(readFileSync(registryPath, "utf8")) as Hm1ProofRegistry;
const requiredPaths = new Set(registry.required_proofs.map((proof) => proof.file));

function isTracked(file: string): boolean {
  try {
    execFileSync("git", ["ls-files", "--error-unmatch", "--", file], {
      cwd: root,
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

function declaredTestCount(file: string): number {
  const source = readFileSync(path.join(root, file), "utf8");
  return [...source.matchAll(/^\s*(?:it|test)\s*\(/gm)].length;
}

describe("HM1-D proof registry integrity", () => {
  it("registers unique required proofs that exist and are tracked", () => {
    for (const releaseArtifact of [
      "docs/architecture/HM1-PROOF-REGISTRY-2026-08-13.json",
      registry.lane.runner_file,
      registry.lane.ci_workflow,
      ...registry.required_support_files,
    ]) {
      expect(existsSync(path.join(root, releaseArtifact)), releaseArtifact).toBe(true);
      expect(isTracked(releaseArtifact), releaseArtifact).toBe(true);
    }
    expect(requiredPaths.size).toBe(registry.required_proofs.length);
    for (const proof of registry.required_proofs) {
      expect(existsSync(path.join(root, proof.file)), proof.file).toBe(true);
      expect(isTracked(proof.file), proof.file).toBe(true);
    }
  });

  it("cross-validates each required proof's declared test count", () => {
    for (const proof of registry.required_proofs) {
      expect(declaredTestCount(proof.file), proof.file).toBe(proof.expected_tests);
    }
  });

  it("is reachable through the named CI lane", () => {
    const workflow = readFileSync(path.join(root, registry.lane.ci_workflow), "utf8");
    expect(workflow).toContain(registry.lane.command);
    expect(workflow).not.toContain("packages/mps-lu/tests/LUMagicMoment.test.ts\n");
    expect(workflow).not.toContain("packages/mps-lu/tests/LuEnforcementReplay.test.ts\n");
  });

  it("preserves superseded proof content as tracked historical evidence", () => {
    for (const proof of registry.superseded_proofs) {
      const source = readFileSync(path.join(root, proof.historical_file), "utf8").replace(
        /\r\n/g,
        "\n",
      );
      expect(isTracked(proof.historical_file), proof.historical_file).toBe(true);
      expect(createHash("sha256").update(source).digest("hex"), proof.historical_file).toBe(
        proof.sha256,
      );
    }
  });

  it("maps every superseded invariant only to active required proofs", () => {
    for (const proof of registry.superseded_proofs) {
      expect(proof.replacement_proofs.length, proof.historical_file).toBeGreaterThan(0);
      for (const replacement of proof.replacement_proofs) {
        expect(requiredPaths.has(replacement), replacement).toBe(true);
        expect(replacement.endsWith(".historical"), replacement).toBe(false);
      }
    }
  });
});
