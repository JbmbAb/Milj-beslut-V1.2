import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migratedOpsScripts = [
  "scripts/ops/orsa-execution-identity-reissue-01.ts",
  "scripts/ops/reconcile-lu-assessment-projection.ts",
  "scripts/ops/prove-lu-localization-geometry-phase-b.ts",
] as const;

describe("PRODUCT-RELEASE-RESOLVER-CONSOLIDATION-01", () => {
  it.each(migratedOpsScripts)("routes %s through the canonical fail-closed resolver", (script) => {
    const source = readFileSync(resolve(process.cwd(), script), "utf8");

    expect(source).toContain("resolveCanonicalProductRelease");
    expect(source).not.toContain("resolveCurrentProductRelease");
  });

  it("does not retain the old hardcoded release fallback in the migrated callers", () => {
    for (const script of migratedOpsScripts) {
      const source = readFileSync(resolve(process.cwd(), script), "utf8");
      expect(source).not.toContain("product-release-772aceb600c4690777593ea8");
      expect(source).not.toContain("772aceb600c4690777593ea89255ce20c062648eadf6ef6e0ecee3e36808c0fa");
    }
  });
});
