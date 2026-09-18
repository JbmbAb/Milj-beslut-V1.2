import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = resolve(fileURLToPath(new URL(".", import.meta.url)));
const repoRoot = resolve(__dirname, "../../..");

const GENERAL_ENGINE = "runLuAssessmentViaKernel";
const CANONICAL_ENGINE = "runCanonicalLuProductAssessment";
const ENGINE_IMPL = "packages/mps-lu/src/execution/LuExecutionKernelClient.ts";
const PACKAGE_INDEX = "packages/mps-lu/src/index.ts";
const CANONICAL_USECASE = "src/application/generate-localization-report.usecase.ts";

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

function productionFiles(): string[] {
  const roots = ["src", "server", "components", "packages"];
  const skipDirs = new Set(["node_modules", "dist", "coverage", "build", ".next", "tests", "__tests__"]);
  const files: string[] = [];

  const walk = (dir: string) => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (skipDirs.has(entry)) continue;
      const full = join(dir, entry);
      let stat;
      try {
        stat = statSync(full);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(entry)) continue;
      if (/\.(?:test|spec)\.[^.]+$/.test(entry) || entry.includes(".historical.")) continue;

      const rel = relative(repoRoot, full).split(sep).join("/");
      if (rel.startsWith("packages/") && !rel.includes("/src/")) continue;
      files.push(rel);
    }
  };

  for (const root of roots) walk(join(repoRoot, root));
  return files.sort();
}

describe("LU-CANONICAL-PATH-01", () => {
  it("the package root exposes only the canonical product execution entrypoint", () => {
    const src = stripComments(readFileSync(join(repoRoot, PACKAGE_INDEX), "utf8"));

    expect(src).toContain(
      'export { runCanonicalLuProductAssessment } from "./execution/LuExecutionKernelClient";',
    );
    expect(src).toContain(
      'export type { CanonicalLuKernelRunInput, LuKernelRunResult } from "./execution/LuExecutionKernelClient";',
    );
    expect(src).not.toContain('export * from "./execution/LuExecutionKernelClient";');
    expect(src).not.toMatch(/\brunLuAssessmentViaKernel\b/);
    expect(src).not.toMatch(/\bcreateLuRuleEngineInvokeHandler\b/);
  });

  it("no production module outside the engine implementation can call the general LU engine", () => {
    const violations = productionFiles()
      .filter((file) => file !== ENGINE_IMPL)
      .map((file) => ({
        file,
        source: stripComments(readFileSync(join(repoRoot, file), "utf8")),
      }))
      .filter(({ source }) => new RegExp(`\\b${GENERAL_ENGINE}\\b`).test(source))
      .map(({ file }) => file);

    expect(
      violations,
      "The legacy/general engine may exist for internal tests and ops, but product code must enter " +
        "through runCanonicalLuProductAssessment so identity_subject_v3 cannot be omitted.",
    ).toEqual([]);
  });

  it("the canonical usecase reaches the canonical wrapper and never the general engine", () => {
    const src = stripComments(readFileSync(join(repoRoot, CANONICAL_USECASE), "utf8"));
    expect(src).toMatch(new RegExp(`\\b${CANONICAL_ENGINE}\\s*\\(`));
    expect(src).not.toMatch(new RegExp(`\\b${GENERAL_ENGINE}\\s*\\(`));
  });

  it("legacy report compatibility remains delegation, not a second assessment implementation", () => {
    const path = "server/services/localizationReportService.ts";
    const src = stripComments(readFileSync(join(repoRoot, path), "utf8"));

    expect(src).toContain("new GenerateLocalizationReportUseCase()");
    expect(src).toMatch(/return\s+useCase\.execute\s*\(/);
    expect(src).not.toMatch(/\bevaluateComplianceRules\s*\(/);
    expect(src).not.toMatch(/\brunLuAssessmentViaKernel\s*\(/);
    expect(src).not.toMatch(/\brunCanonicalLuProductAssessment\s*\(/);
  });

  it("negative fixture proves the production bypass detector is live", () => {
    const violating = `
      import { runLuAssessmentViaKernel } from "@miljobeslut/mps-lu";
      export const assess = (input: unknown) => runLuAssessmentViaKernel(input as never);
    `;
    expect(new RegExp(`\\b${GENERAL_ENGINE}\\b`).test(stripComments(violating))).toBe(true);
  });
});
