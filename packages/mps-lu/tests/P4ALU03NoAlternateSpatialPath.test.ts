import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(__dirname, "..", "src");

const ALLOWED_PRODUCTION_FILES = new Set([
  // Resolver is the authority boundary under test.
  "providers/SpatialProviderResolver.ts",
  // Artifact/hash modules are allowed to define SpatialEvidence identity, not produce it.
  "artifacts/SpatialEvidenceArtifact.ts",
  "artifacts/SpatialEvidenceIdentity.ts",
  "services/SpatialQueryContract.ts",
  "rules/LURuleEngine.ts",
  // Viewer is observation/projection only: it resolves existing CAS evidence and cannot produce
  // SpatialEvidenceArtifact or query PostGIS. F8 covers capability admission for this path.
  "viewer/ViewerKernel.ts",
  // LU-DETERMINISTIC-REEXECUTION-V1: calls buildSpatialEvidenceContentHash to VERIFY a resolved
  // SPATIAL_EVIDENCE artifact's own stored content_hash was not tampered with since it was
  // pinned -- read-only tamper detection on an already-resolved artifact, never construction of a
  // new SPATIAL_EVIDENCE artifact or a query against any provider.
  "execution/LuDeterministicReExecution.ts",
]);

type Violation = {
  readonly file: string;
  readonly rule: string;
  readonly match: string;
};

const FORBIDDEN = [
  {
    rule: "direct concrete PostGIS provider dependency",
    pattern: /\b(?:new\s+)?(?:PostgisSpatialProvider|SpatialProviderPostGIS)\b/g,
  },
  {
    rule: "raw PostGIS spatial predicate outside provider layer",
    pattern: /\bST_(?:DWithin|Intersects|Within|Contains|Distance|Buffer)\b/g,
  },
  {
    rule: "Prisma/raw SQL spatial evidence path",
    pattern:
      /\b(?:prisma\.|\$queryRaw|queryRaw)\b[\s\S]{0,500}\bST_(?:DWithin|Intersects|Within|Contains|Distance|Buffer)\b|\bST_(?:DWithin|Intersects|Within|Contains|Distance|Buffer)\b[\s\S]{0,500}\b(?:prisma\.|\$queryRaw|queryRaw)\b/g,
  },
  {
    rule: "alternate SpatialEvidenceArtifact producer",
    pattern:
      /artifact_type:\s*["']SPATIAL_EVIDENCE["'][\s\S]{0,500}\b(?:content_hash|payload|references)\b|\b(?:content_hash|payload|references)\b[\s\S]{0,500}artifact_type:\s*["']SPATIAL_EVIDENCE["']/g,
  },
  {
    rule: "direct spatial evidence hash producer",
    pattern: /\b(?:buildSpatialEvidenceContentHash|computeSpatialEvidenceHash)\s*\(/g,
  },
] as const;

function walkTs(dir: string): string[] {
  const fs = require("node:fs") as typeof import("node:fs");
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return walkTs(path);
    return entry.isFile() && entry.name.endsWith(".ts") ? [path] : [];
  });
}

function scanSource(sourceByFile: ReadonlyMap<string, string>): Violation[] {
  const violations: Violation[] = [];

  for (const [file, source] of sourceByFile) {
    const normalized = file.replace(/\\/g, "/");
    if (ALLOWED_PRODUCTION_FILES.has(normalized)) continue;

    for (const forbidden of FORBIDDEN) {
      for (const match of source.matchAll(forbidden.pattern)) {
        violations.push({
          file: normalized,
          rule: forbidden.rule,
          match: match[0],
        });
      }
    }
  }

  return violations;
}

function productionSources(): ReadonlyMap<string, string> {
  return new Map(
    walkTs(ROOT)
      .map((file) => relative(ROOT, file).replace(/\\/g, "/"))
      .filter((file) => !file.startsWith("unit/"))
      .map((file) => [file, readFileSync(join(ROOT, file), "utf8")]),
  );
}

/**
 * ✅ P4A-LU-03 — STATIC NO ALTERNATE LU SPATIAL PATH.
 *
 *   Invariant under test:
 *     LU production code SHALL NOT bypass SpatialProviderResolver through direct concrete
 *     provider construction, raw spatial SQL/Prisma, or an alternate SpatialEvidence producer.
 *
 *   Scope: static architecture boundary only. The real runtime-entrypoint proof is P4A-LU-05.
 */
describe("P4A-LU-03 — static no alternate LU spatial path", () => {
  it("LU production code has no direct concrete spatial provider dependency", () => {
    const localLegacyProvider = join(ROOT, "providers", "PostgisSpatialProvider.ts");

    expect(
      existsSync(localLegacyProvider),
      "P4A-LU-03: the old LU-local provider was a complete alternate ISpatialProvider and could " +
        "produce SpatialEvidence without SpatialProviderResolver. It must not remain production code.",
    ).toBe(false);
  });

  it("LU production code cannot create evidence-bearing spatial facts outside the resolver path", () => {
    const violations = scanSource(productionSources());

    expect(
      violations,
        "P4A-LU-03: LU production code must not contain direct concrete provider dependencies, raw " +
        "PostGIS predicates, Prisma/raw SQL spatial evidence paths, alternate SPATIAL_EVIDENCE " +
        "producers, or direct spatial evidence hash production outside the resolver/provider boundary.",
    ).toEqual([]);
  });

  it("the static proof detects a synthetic concrete-provider bypass", () => {
    const violations = scanSource(
      new Map([
        [
          "runtime/BadBypass.ts",
          `
            import { SpatialProviderPostGIS } from "@miljobeslut/spatial-provider-postgis";
            const provider = new SpatialProviderPostGIS(url, repo);
          `,
        ],
      ]),
    );

    expect(violations.map((v) => v.rule)).toContain(
      "direct concrete PostGIS provider dependency",
    );
  });

  it("the static proof detects synthetic raw spatial SQL and SpatialEvidence production", () => {
    const violations = scanSource(
      new Map([
        [
          "runtime/BadEvidence.ts",
          `
            await prisma.$queryRaw("SELECT * FROM env.sgu_well WHERE ST_DWithin(geom, $1, $2)");
            const artifact = { artifact_type: "SPATIAL_EVIDENCE", content_hash, payload: {} };
          `,
        ],
      ]),
    );

    expect(violations.map((v) => v.rule)).toEqual(
      expect.arrayContaining([
        "raw PostGIS spatial predicate outside provider layer",
        "Prisma/raw SQL spatial evidence path",
        "alternate SpatialEvidenceArtifact producer",
      ]),
    );
  });
});
