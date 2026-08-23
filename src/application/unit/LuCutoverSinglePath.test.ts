import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");

function walkTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walkTsFiles(full));
    else if (name.endsWith(".ts") && !name.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

/**
 * LU Cutover gate: Localization Report has one execution path —
 * Evidence → ExecutionKernel → Admission → Capability → Artifacts.
 */
describe("LU cutover — single execution path", () => {
  it("usecase always calls runCanonicalLuProductAssessment and never bypasses admit", () => {
    const usecasePath = path.resolve(__dirname, "../generate-localization-report.usecase.ts");
    const src = readFileSync(usecasePath, "utf8");

    // ASSESSMENT-RELEASE-BINDING-RECON-01: the canonical wrapper (LuExecutionKernelClient.ts),
    // not the general engine directly -- its type makes identity_subject_v3 mandatory, so the
    // usecase can never omit it and silently fall back to a non-release-scoped manifest id.
    expect(src).toContain("runCanonicalLuProductAssessment");
    expect(src).not.toContain("runLuAssessmentViaKernel");
    expect(src).not.toContain("isLuMpsMotorEnabled");
    expect(src).not.toContain("LU_MPS_MOTOR");
    expect(src).not.toContain("LU_MPS_MOTOR_DISABLED");
    expect(src).not.toMatch(/new LURuleEngine\s*\(/);
    expect(src).not.toMatch(/ruleEngine\.evaluate/);
  });

  it("product LU source: LURuleEngine only constructed inside ExecutionKernel client", () => {
    const luSrcRoot = path.join(repoRoot, "packages/mps-lu/src");
    const allowed = path.normalize(
      path.join(luSrcRoot, "execution/LuExecutionKernelClient.ts"),
    );
    const engineDef = path.normalize(path.join(luSrcRoot, "rules/LURuleEngine.ts"));

    for (const file of walkTsFiles(luSrcRoot)) {
      const norm = path.normalize(file);
      if (norm === allowed || norm === engineDef) continue;
      const src = readFileSync(file, "utf8");
      expect(src, `${file} must not construct LURuleEngine`).not.toMatch(
        /new LURuleEngine\s*\(/,
      );
      expect(src, `${file} must not call .evaluate on RuleEngine`).not.toMatch(
        /\.evaluate\s*\(/,
      );
      expect(src).not.toContain("isLuMpsMotorEnabled");
      expect(src).not.toContain("LU_MPS_MOTOR");
    }

    const client = readFileSync(allowed, "utf8");
    expect(client).toContain("ExecutionKernel");
    expect(client).toContain("runLuAssessmentViaKernel");
    expect(client).not.toContain("isLuMpsMotorEnabled");
    expect(client).not.toContain("LU_MPS_MOTOR");
  });

  it("repo has no leftover LU_MPS_MOTOR / isLuMpsMotorEnabled symbols in TS", () => {
    const roots = [
      path.join(repoRoot, "src"),
      path.join(repoRoot, "packages/mps-lu"),
      path.join(repoRoot, "server/modules/localization"),
    ];
    for (const root of roots) {
      for (const file of walkTsFiles(root)) {
        if (file.includes(`${path.sep}unit${path.sep}`) || file.includes(".test.ts")) {
          continue;
        }
        const src = readFileSync(file, "utf8");
        expect(src, file).not.toContain("isLuMpsMotorEnabled");
        expect(src, file).not.toMatch(/\bLU_MPS_MOTOR\b/);
      }
    }
  });
});
