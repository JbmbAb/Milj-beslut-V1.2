import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
const repoRoot = resolve(process.cwd());

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

const PRODUCTION_ROOTS = ["src", "server", "components", "packages"] as const;

function productionFiles(root: string, roots: readonly string[] = PRODUCTION_ROOTS): string[] {
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

      const rel = relative(root, full).split(sep).join("/");
      if (rel.startsWith("packages/") && !rel.includes("/src/")) continue;
      files.push(rel);
    }
  };

  for (const r of roots) walk(join(root, r));
  return files.sort();
}

/**
 * THE production bypass scanner. It is used, unchanged, both against the real repository roots
 * (the "no production module ..." test) and against a synthetic file tree (the negative fixture),
 * so the fixture proves the detector that actually guards production is live -- not a separate
 * regex applied to a string.
 *
 * Returns the repo-relative paths (under `root`) of production files, outside `allow`, whose
 * comment-stripped source references the general LU engine.
 */
function findGeneralEngineBypasses(
  root: string,
  options: { readonly roots?: readonly string[]; readonly allow?: readonly string[] } = {},
): string[] {
  const allow = new Set(options.allow ?? []);
  return productionFiles(root, options.roots)
    .filter((file) => !allow.has(file))
    .map((file) => ({
      file,
      source: stripComments(readFileSync(join(root, file), "utf8")),
    }))
    .filter(({ source }) => new RegExp(`\\b${GENERAL_ENGINE}\\b`).test(source))
    .map(({ file }) => file);
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
    const violations = findGeneralEngineBypasses(repoRoot, { allow: [ENGINE_IMPL] });

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

  it("negative fixture: the production scanner discovers a bypass in a synthetic file tree", () => {
    const tree = mkdtempSync(join(tmpdir(), "lu-canonical-scan-"));
    const put = (rel: string, source: string) => {
      const full = join(tree, rel);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, source);
    };
    try {
      const violating = `
        import { runLuAssessmentViaKernel } from "@miljobeslut/mps-lu";
        export const assess = (input: unknown) => runLuAssessmentViaKernel(input as never);
      `;
      // Violations the scanner must discover, through the same walk it applies to production.
      put("src/application/bypass.ts", violating);
      put("packages/mps-example/src/deep/bypass.ts", violating);
      // Things it must NOT flag: the allowed engine implementation, a comment-only mention, and
      // files the production walk deliberately excludes (tests, non-src package files).
      put(ENGINE_IMPL, violating);
      put(
        "src/application/comment-only.ts",
        "// runLuAssessmentViaKernel is documented here only\nexport const x = 1;\n",
      );
      put("src/application/bypass.test.ts", violating);
      put("src/tests/bypass.ts", violating);
      put("packages/mps-example/scripts/bypass.ts", violating);

      expect(findGeneralEngineBypasses(tree, { allow: [ENGINE_IMPL] })).toEqual([
        "packages/mps-example/src/deep/bypass.ts",
        "src/application/bypass.ts",
      ]);
      // Without the allow-list the engine implementation itself is (correctly) reported.
      expect(findGeneralEngineBypasses(tree)).toContain(ENGINE_IMPL);
    } finally {
      rmSync(tree, { recursive: true, force: true });
    }
  });
});
