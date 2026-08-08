// packages/mps-data-governance/src/GovernedWriteCapability.ts

import * as fs from "fs";
import * as path from "path";

/**
 * Executable form of the librarian-only import policy
 * (docs/architecture/import-librarian-only-policy.md).
 *
 * The policy has existed as prose since 2026-06-22 and says that new permanent
 * geodata SHALL reach PostGIS only through the librarian. Prose does not fail a
 * build. Thirty-odd scripts contradicted it in code, and a barrier that the
 * road goes around is not the system's barrier.
 *
 * The rule here is capability-based rather than statement-based. It does not
 * try to parse SQL and decide whether a particular statement writes; it asks
 * which files hold the *ability* to write at all. That is a weaker claim about
 * any single line and a much stronger claim about the system, because it cannot
 * be evaded by rephrasing a statement.
 *
 * MAT-I05 is deliberately not the barrier used here. That invariant governs who
 * may create DecisionImpactArtifact authority, and the import path never creates
 * one. Routing ingest through it would mean registering the harvester as a
 * materialization authority — the opposite of what the invariant protects.
 */
export interface GovernedWriteCapability {
  readonly id: string;

  /** What holding this capability lets a file do. */
  readonly description: string;

  /** Directories the capability is policed in, relative to the repo root. */
  readonly scope: readonly string[];

  /**
   * Paths excluded from policing, with the reason. Not debt: these are outside
   * what the policy governs.
   */
  readonly exempt: readonly { readonly path: string; readonly reason: string }[];

  /** The chokepoint. Files that are supposed to hold this capability. */
  readonly authorised: readonly string[];

  /**
   * Pre-existing holders, frozen at the count below. This list MAY shrink and
   * SHALL NOT grow: every entry is a road around the chokepoint, and the
   * capability check fails on any holder that is not already named here.
   */
  readonly legacy: readonly string[];

  /** Source patterns that indicate the capability is exercised. */
  readonly markers: readonly RegExp[];
}

export interface CapabilityAudit {
  readonly capability: string;

  /** Holders that are neither authorised nor known legacy. New debt. */
  readonly unauthorised: readonly string[];

  /** Legacy entries that no longer hold the capability. Removable. */
  readonly stale: readonly string[];

  /** Every file found holding the capability. */
  readonly holders: readonly string[];
}

const SOURCE_EXTENSIONS = new Set([".ts", ".mts", ".cts", ".mjs", ".cjs", ".js"]);

function collectSourceFiles(root: string, scope: readonly string[]): string[] {
  const found: string[] = [];

  const walk = (absolute: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(absolute, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const child = path.join(absolute, entry.name);
      if (entry.isDirectory()) {
        walk(child);
      } else if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
        found.push(path.relative(root, child).split(path.sep).join("/"));
      }
    }
  };

  for (const dir of scope) walk(path.join(root, dir));
  return found;
}

function isExempt(file: string, capability: GovernedWriteCapability): boolean {
  return capability.exempt.some((e) => file === e.path || file.startsWith(`${e.path}/`));
}

export function auditCapability(
  repoRoot: string,
  capability: GovernedWriteCapability,
): CapabilityAudit {
  const holders = collectSourceFiles(repoRoot, capability.scope)
    .filter((file) => !isExempt(file, capability))
    .filter((file) => {
      const source = fs.readFileSync(path.join(repoRoot, file), "utf8");
      return capability.markers.some((marker) => marker.test(source));
    })
    .sort();

  const permitted = new Set([...capability.authorised, ...capability.legacy]);

  return {
    capability: capability.id,
    unauthorised: holders.filter((file) => !permitted.has(file)),
    stale: capability.legacy.filter((file) => !holders.includes(file)),
    holders,
  };
}

/**
 * Raw SQL execution against the database.
 *
 * `$queryRaw` is not a marker. It is the read primitive, and the runtime uses it
 * heavily for spatial queries. A `$queryRaw` with a writing CTE would slip past
 * this rule; that is a known and accepted limit, recorded rather than papered
 * over, because widening the marker to all raw access would flag the entire
 * read path and the rule would be turned off.
 */
export const POSTGIS_RAW_WRITE: GovernedWriteCapability = {
  id: "postgis.raw_write",
  description:
    "Executes raw SQL against PostGIS. Permanent geodata SHALL enter prod only " +
    "through the librarian import path.",
  scope: ["scripts"],
  exempt: [
    {
      path: "scripts/db",
      reason:
        "Maintenance is an explicit exception in the policy: index, partition, " +
        "vacuum, schema DDL. These do not import datasets.",
    },
  ],
  authorised: [
    "scripts/import/import-librarian-manifest.ts",
    "scripts/import/importLibrarianQa.ts",
  ],
  legacy: [
    "scripts/add-geom-col.ts",
    "scripts/apply-best-guess-munis.ts",
    "scripts/backfill/_shared.ts",
    "scripts/backfill/build-case-candidates.ts",
    "scripts/backfill/extract-text-batch.ts",
    "scripts/backfill/materialize-cases.ts",
    "scripts/clean-road-data.ts",
    "scripts/clean-sgu-pipeline.ts",
    "scripts/gis-performance-benchmark.ts",
    "scripts/import-topo10-only.ts",
    "scripts/import/bulk-import-platform-all.ts",
    "scripts/import/bulk-import-sgu-api-all.ts",
    "scripts/import/bulk-import-sgu.ts",
    "scripts/import/import-d-geodata-vectors.ts",
    "scripts/import/import-downloads-vector.ts",
    "scripts/import/import-heavy-geodata.ts",
    "scripts/import/import-ingest-gpkg-batch.ts",
    "scripts/import/import-lantmateriet.ts",
    "scripts/import/import-lastkajen-all-downloaded.ts",
    "scripts/import/import-lastkajen-water.ts",
    "scripts/import/import-lst-grusinv.ts",
    "scripts/import/import-n2k-gml.ts",
    "scripts/import/import-raa-building-ruins.ts",
    "scripts/import/import-raster-outdb.ts",
    "scripts/import/import-sgu-risk-layers.ts",
    "scripts/import/import-slu-lake-catchments.ts",
    "scripts/import/import-smed-only.ts",
    "scripts/import/import-smhi-huvudavrinningsomraden.ts",
    "scripts/import/import-stability-mapping.ts",
    "scripts/import/import-viss-water.ts",
    "scripts/import/lastkajenImportEngine.ts",
    "scripts/import/sguBulkImportEngine.ts",
  ],
  markers: [/\$executeRaw(Unsafe)?\s*[(`]/],
};

/**
 * Writes to the case graph the decision layer reads from.
 *
 * `environmentalCase` and `caseEvidence` are the rows that later become
 * materialization input, so whoever writes them decides what the platform
 * believes happened.
 */
export const CASE_GRAPH_WRITE: GovernedWriteCapability = {
  id: "case_graph.write",
  description:
    "Creates or mutates environmentalCase / caseEvidence rows, which are " +
    "materialization input.",
  scope: ["scripts", "server", "src", "services"],
  exempt: [],
  authorised: ["scripts/import/mimer/mimerBindingAgent.ts"],
  legacy: ["server/modules/legal/services/evidenceExtractionService.ts"],
  markers: [
    /(environmentalCase|caseEvidence)\.(create|createMany|upsert|update|updateMany|delete|deleteMany)\s*\(/,
  ],
};

export const GOVERNED_WRITE_CAPABILITIES: readonly GovernedWriteCapability[] = [
  POSTGIS_RAW_WRITE,
  CASE_GRAPH_WRITE,
];
