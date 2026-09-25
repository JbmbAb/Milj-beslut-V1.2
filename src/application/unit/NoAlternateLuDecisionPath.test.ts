import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

/**
 * ✅ NO_ALTERNATE_LU_DECISION_PATH_V1 — P3-LU-CANONICAL-CHAIN-01 closure guard.
 *
 *   Invariant under test:
 *     No production path may emit or expose an LU verdict without a governed
 *     LocalizationAssessmentArtifact.
 *
 *   This guard watches the FINAL boundary, not one file:
 *     usecase → facade → route → PDF → UI → audit
 *
 *   Why the existing gates were insufficient:
 *     - `LuCutoverSinglePath.test.ts` proves the ExecutionKernel is INVOKED and that no
 *       LU_MPS_MOTOR flag bypass survives. It does not prove the kernel's result is REQUIRED —
 *       the usecase called the kernel and then returned an ungoverned verdict anyway when the
 *       kernel denied or threw.
 *     - `P4ALU03NoAlternateSpatialPath.test.ts` scans only `packages/mps-lu/src` and guards
 *       SpatialEvidence production. The defect lived in `src/` and concerned the assessment
 *       verdict, so it fell outside both axes.
 *
 *   Capability-based, not a filename blacklist: the rules below describe what it means to
 *   PRODUCE a verdict, and are applied to every file that participates in the LU surface.
 *
 *   Scope: LU only. Sewage, mass-logistics and green-check surfaces carry their own
 *   `overallRisk`/`permitProbability` fields and are a separate governance question.
 */
describe("NO_ALTERNATE_LU_DECISION_PATH_V1", () => {
  const REPO_ROOT = resolve(__dirname, "../../..");
  const SCANNED_ROOTS = ["src", "server", "packages", "components"];
  const SKIP_DIRS = new Set(["node_modules", "dist", ".git", "coverage", ".tmp", "build", ".next"]);

  /** The two sanctioned producers, each independently proven. */
  const CANONICAL_USECASE = "src/application/generate-localization-report.usecase.ts";
  const CANONICAL_PDF = "server/services/localizationPdfService.ts";

  /** A file participates in the LU verdict surface if it handles these LU-specific types. */
  const LU_SURFACE = /\bLocalizationReport\b|\bSiteAnalysisResult\b|\bLocalizationPdfData\b|generate-localization-report/;

  /** Ungoverned verdict authority — the rule engine that produced the alternate verdict. */
  const UNGOVERNED_VERDICT_ENGINE = /\bevaluateComplianceRules\s*\(/;

  /**
   * A placeholder standing in for an absent verdict.
   *
   * `bestAlternativeId || 'N/A'` was the real defect at the PDF boundary: it rendered as
   * though a comparison had been made and produced nothing.
   */
  const VERDICT_PLACEHOLDER =
    /\b(?:overallRisk|permitProbability|bestAlternativeId)\b\s*(?:\|\||\?\?)\s*(?:['"`][^'"`]*['"`]|0\b)/;

  /**
   * A NUMERIC fallback reached through a ternary on a verdict field.
   *
   * This class was missed by the `??`/`||` rule above and hid the worst instance found:
   * `confidence: permitProbability ? Math.round(p * 100) : 85` displayed a fabricated 85%
   * permit likelihood for sites that had never been assessed.
   *
   * Numeric only. A STRING else-branch may be an honest non-assessment label
   * ("Ej beräknad", "Ej bedömd") and is left to the placeholder rule and to review.
   */
  const VERDICT_NUMERIC_TERNARY =
    /\b(?:overallRisk|permitProbability)\b[\s\S]{0,160}?\?[\s\S]{0,160}?:\s*\d+(?:\.\d+)?\s*[,;)\n}]/;

  /** A bare zero is the forbidden fail-open verdict fallback; governed fractions are valid. */
  const BARE_ZERO_PERMIT_PROBABILITY = /permitProbability\s*:\s*0\s*[,}]/;

  /**
   * NO_LEGACY_WATER_DISTANCE_FALLBACK_MECHANICAL_V1 — a fabricated 200 m distance-to-water
   * fallback, in its call-site form (`?? 200` / `|| 200`) or its default-parameter form
   * (`: number = 200`).
   *
   * `REBUILD-GATE-STATUS.md` bans this explicitly: "legacy fallback = 200 m ← DO NOT
   * REINTRODUCE as spatial semantics". 200 m sits just outside the < 100 m Strandskydd
   * threshold in `evaluate-compliance-rules.usecase.ts`, so a fabricated 200 m does not read
   * as "unknown" — it reads as "verified clear" and silently suppresses a Strandskydd flag
   * that should have stayed unresolved. An unknown distance must reach the compliance engine
   * as `null` (its new default), in every mode — there is no mode in which a fabricated
   * distance is an honest input to a legal compliance determination.
   *
   * Scoped to the three files that actually carry this value end to end (the usecase call
   * site and the two engine entrypoints), read directly rather than swept in via LU_SURFACE:
   * the engine files define/re-export `evaluateComplianceRules` themselves, so folding them
   * into the content-sniffed LU_SURFACE set would make the "no second verdict authority" scan
   * above trip on their own internal delegation call — a false positive, not a regression.
   */
  const FABRICATED_WATER_DISTANCE_FALLBACK_CALLSITE =
    /\b(?:distanceToWater\w*|distanceForCompliance)\b\s*(?:\?\?|\|\|)\s*200\b/;
  const FABRICATED_WATER_DISTANCE_FALLBACK_DEFAULT = /distanceToWater\s*(?::\s*number)?\s*=\s*200\b/;
  const WATER_DISTANCE_ENGINE_FILES = [
    "src/application/generate-localization-report.usecase.ts",
    "src/application/evaluate-compliance-rules.usecase.ts",
    "server/services/complianceRuleEngine.ts",
  ];

  function sourceFiles(): string[] {
    const found: string[] = [];
    const walk = (dir: string) => {
      let entries: string[];
      try {
        entries = readdirSync(dir);
      } catch {
        return;
      }
      for (const entry of entries) {
        if (SKIP_DIRS.has(entry)) continue;
        const full = join(dir, entry);
        let st;
        try {
          st = statSync(full);
        } catch {
          continue;
        }
        if (st.isDirectory()) walk(full);
        else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.|\.spec\.|\.historical\./.test(entry)) {
          found.push(full);
        }
      }
    };
    for (const root of SCANNED_ROOTS) walk(join(REPO_ROOT, root));
    return found;
  }

  const rel = (f: string) => relative(REPO_ROOT, f).split(sep).join("/");

  /**
   * Comments are stripped before any structural claim is evaluated.
   *
   * These files document the forbidden patterns in prose in order to explain why they are
   * absent — `permitProbability: 0` appears in a doc comment explaining why zeroing is wrong.
   * Prose must not be able to fail a structural test.
   */
  function stripComments(source: string): string {
    return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  }

  function luSurfaceFiles(): { file: string; contents: string }[] {
    return sourceFiles()
      .map((file) => ({ file: rel(file), contents: stripComments(readFileSync(file, "utf8")) }))
      .filter(({ contents }) => LU_SURFACE.test(contents));
  }

  // ------------------------------------------------------- the scan is not vacuous

  it("the scan reaches the real LU surface", () => {
    const files = luSurfaceFiles().map((f) => f.file);
    expect(files.length).toBeGreaterThan(2);
    expect(files, "the canonical usecase must be in scope").toContain(CANONICAL_USECASE);
    expect(files, "the PDF projection must be in scope").toContain(CANONICAL_PDF);
  });

  // ------------------------------------------- 1. no second verdict authority

  it("no LU-surface file outside the usecase derives a verdict from the ungoverned engine", () => {
    const violations = luSurfaceFiles()
      .filter(({ file }) => file !== CANONICAL_USECASE)
      .filter(({ contents }) => UNGOVERNED_VERDICT_ENGINE.test(contents))
      .map(({ file }) => file);

    expect(
      violations,
      "evaluateComplianceRules operates over ungoverned service data. Reaching it from the LU " +
        "surface outside the canonical usecase reintroduces the alternate decision authority " +
        "that P3-LU-CANONICAL-CHAIN-01 closed.",
    ).toEqual([]);
  });

  // ------------------------------------------- 2. no placeholder verdicts anywhere

  it("no LU-surface file substitutes a placeholder for a missing verdict", () => {
    const violations = luSurfaceFiles()
      .filter(({ contents }) => VERDICT_PLACEHOLDER.test(contents))
      .map(({ file, contents }) => `${file}: ${contents.match(VERDICT_PLACEHOLDER)?.[0]}`);

    expect(
      violations,
      "A missing verdict must be ABSENT, never defaulted. 'N/A' reads as a completed " +
        "comparison that found nothing; 0 reads as 'certainly refused'. Both are verdicts.",
    ).toEqual([]);
  });

  it("no LU-surface file fabricates a numeric verdict through a ternary fallback", () => {
    const violations = luSurfaceFiles()
      .filter(({ contents }) => VERDICT_NUMERIC_TERNARY.test(contents))
      .map(({ file, contents }) =>
        `${file}: ${contents.match(VERDICT_NUMERIC_TERNARY)?.[0].replace(/\s+/g, " ").slice(0, 90)}`,
      );

    expect(
      violations,
      "A hardcoded number standing in for an absent probability is the most dangerous form of " +
        "this defect: it renders as a confident result. `permitProbability ? … : 85` showed an " +
        "unassessed site as 85% likely to be permitted.",
    ).toEqual([]);
  });

  // ------------------------------------------- 2b. no fabricated water-distance fallback

  it("no fabricated 200 m water-distance fallback anywhere in the usecase or the compliance engine", () => {
    const violations: string[] = [];
    for (const relPath of WATER_DISTANCE_ENGINE_FILES) {
      const src = stripComments(readFileSync(join(REPO_ROOT, ...relPath.split("/")), "utf8"));
      const callsiteHit = src.match(FABRICATED_WATER_DISTANCE_FALLBACK_CALLSITE)?.[0];
      const defaultHit = src.match(FABRICATED_WATER_DISTANCE_FALLBACK_DEFAULT)?.[0];
      if (callsiteHit) violations.push(`${relPath}: ${callsiteHit}`);
      if (defaultHit) violations.push(`${relPath}: ${defaultHit}`);
    }

    expect(
      violations,
      "An unknown distance to water must reach the compliance engine as null, never as a " +
        "fabricated 200 m — that value sits just outside the < 100 m Strandskydd threshold and " +
        "silently reads as 'verified clear' instead of 'unverified'.",
    ).toEqual([]);
  });

  // ------------------------------------------- 3. the strip point cannot be removed

  it("the canonical usecase retains its single verdict strip point", () => {
    const src = stripComments(
      readFileSync(join(REPO_ROOT, ...CANONICAL_USECASE.split("/")), "utf8"),
    );

    expect(src, "verdict removal helper").toMatch(/function withoutVerdict\s*\(/);
    expect(src, "binding of verdict to governed artifact").toMatch(
      /hasGovernedAssessment\s*=\s*executionMotor\?\.assessment_artifact_id\s*!=\s*null/,
    );
    expect(src, "ranking population gate").toMatch(/function isAssessed\s*\(/);
    expect(src, "coverage semantics").toMatch(/comparison_status/);
    expect(
      src,
      "the pre-fix defect: catch/deny branches fell through to a verdict-bearing return",
    ).not.toMatch(BARE_ZERO_PERMIT_PROBABILITY);
  });

  // ------------------------------------------- 4. the PDF projection stays fail-closed

  it("the PDF projection emits verdict keys conditionally, never unconditionally", () => {
    const src = readFileSync(join(REPO_ROOT, ...CANONICAL_PDF.split("/")), "utf8");

    /*
     * LU_VERDICT_TYPE_BOUNDARY_V1 changed the idiom this rule watches for, and strengthened it.
     *
     * Previously each verdict key was spread behind its own `!== undefined` check. That was the
     * best available expression while absence was modelled as an optional field, but it was a
     * convention: nothing stopped a later edit from reading the field directly, because under
     * this repository's tsconfig `RiskLevel | undefined` is assignable to `RiskLevel`.
     *
     * The verdict fields now live only on the `ASSESSED` variant of a discriminated union, so
     * the narrowing is not a courtesy check — it is the only construct that makes the fields
     * readable at all. Asserting on the narrowing therefore asserts something the compiler also
     * enforces, rather than a spelling the compiler is indifferent to.
     */
    expect(src, "verdict emission gated by the type-level narrowing").toMatch(
      /\.\.\.\(\s*isGovernedVerdict\(\s*analysis\.complianceAnalysis\s*\)/,
    );
    expect(src, "conditional bestAlternativeId").toMatch(
      /\.\.\.\(\s*report\.summary\.bestAlternativeId\s*\?/,
    );
    expect(src, "status must accompany an absent verdict").toMatch(/assessment_status/);
  });

  // ------------------------------------------- 5. the guard itself is falsifiable

  it("NEGATIVE FIXTURES: the rules actually fire on violating code", () => {
    // If these ever stop matching, the guard above has silently become decorative.
    const fixtures: { name: string; code: string; rule: RegExp }[] = [
      {
        name: "ungoverned engine reached from LU surface",
        code: `import { LocalizationReport } from 'x';\nconst a = evaluateComplianceRules(site);`,
        rule: UNGOVERNED_VERDICT_ENGINE,
      },
      {
        name: "'N/A' placeholder for best alternative",
        code: `bestAlternativeId: report.summary.bestAlternativeId || 'N/A',`,
        rule: VERDICT_PLACEHOLDER,
      },
      {
        name: "zero-defaulted probability",
        code: `permitProbability: analysis.complianceAnalysis.permitProbability ?? 0,`,
        rule: VERDICT_PLACEHOLDER,
      },
      {
        name: "empty-string risk",
        code: `overallRisk: analysis.complianceAnalysis.overallRisk || "",`,
        rule: VERDICT_PLACEHOLDER,
      },
      {
        name: "fabricated confidence via ternary (the 85% defect)",
        code: `confidence: analysis?.complianceAnalysis?.permitProbability\n  ? Math.round(analysis.complianceAnalysis.permitProbability * 100)\n  : 85,`,
        rule: VERDICT_NUMERIC_TERNARY,
      },
      {
        name: "fabricated 200 m water-distance fallback at the call site (the actual regression)",
        code: `distanceForCompliance ?? 200,`,
        rule: FABRICATED_WATER_DISTANCE_FALLBACK_CALLSITE,
      },
      {
        name: "fabricated 200 m water-distance fallback via ||",
        code: `const d = spatialAudit.distanceToWaterMeters || 200;`,
        rule: FABRICATED_WATER_DISTANCE_FALLBACK_CALLSITE,
      },
      {
        name: "fabricated 200 m water-distance default parameter",
        code: `distanceToWater: number = 200,`,
        rule: FABRICATED_WATER_DISTANCE_FALLBACK_DEFAULT,
      },
    ];

    for (const { name, code, rule } of fixtures) {
      expect(rule.test(code), `negative fixture must be caught: ${name}`).toBe(true);
    }

    // POSITIVE CONTROL — the shape the fix actually uses must NOT trip the placeholder rule,
    // otherwise the guard would be unsatisfiable and would have to be weakened later.
    const compliant = [
      `...(report.summary.bestAlternativeId ? { bestAlternativeId: report.summary.bestAlternativeId } : {}),`,
      `...(analysis.complianceAnalysis.overallRisk !== undefined ? { overallRisk: analysis.complianceAnalysis.overallRisk } : {}),`,
    ];
    for (const code of compliant) {
      expect(VERDICT_PLACEHOLDER.test(code), `compliant form must pass: ${code}`).toBe(false);
    }

    // POSITIVE CONTROL — the actual post-fix shape (pass the real value through, default to
    // null) must NOT trip the water-distance guard.
    const compliantDistance = [`distanceToWaterMeters,`, `distanceToWater: number | null = null,`];
    for (const code of compliantDistance) {
      expect(
        FABRICATED_WATER_DISTANCE_FALLBACK_CALLSITE.test(code) ||
          FABRICATED_WATER_DISTANCE_FALLBACK_DEFAULT.test(code),
        `compliant distance form must pass: ${code}`,
      ).toBe(false);
    }
  });

  it("rejects only a bare zero permit probability, not governed decimal probabilities", () => {
    expect(BARE_ZERO_PERMIT_PROBABILITY.test("permitProbability: 0,")).toBe(true);

    for (const probability of ["0.2", "0.5", "0.95"]) {
      expect(
        BARE_ZERO_PERMIT_PROBABILITY.test(`permitProbability: ${probability},`),
        `governed probability must be allowed: ${probability}`,
      ).toBe(false);
    }
  });
});
