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
 *
 * ## What this proves, and what it does not
 *
 * This module establishes *uniqueness*: governed production state is reachable
 * through two doors and no others, and any third door fails the build by name.
 *
 * It does not establish *authorisation*: neither door is locked. The librarian
 * and `mimerBindingAgent` write production directly, and neither references
 * `mps-data-governance` — no approval is required, no gate evidence is produced,
 * nothing is quarantined on refusal. Both are chokepoints, not gates.
 *
 * The distinction matters because "the invariant holds" must not be read as
 * "writes are governed". Narrowing thirty-four write paths to two is what makes
 * locking them tractable; it is not the lock. That is the work the remaining
 * five orchestrator ports carry, and until it lands the honest claim is:
 *
 *     scripts/services -> arbitrary prod write        rejected
 *     scripts/services -> librarian -> prod write     permitted, ungoverned
 *     scripts/services -> binding agent -> prod write permitted, ungoverned
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

  /**
   * Holders that reach the primitive but cannot write data with it, because they
   * use it only for session configuration — `SET LOCAL statement_timeout`,
   * `SELECT set_config(...)` — which returns no rows and therefore cannot go
   * through the query primitive.
   *
   * These are listed rather than exempted. An exemption is invisible and would
   * let a real write appear in the same file unseen; a listed file is checked
   * further down by `dataModifyingKeywords`, which asserts the file contains no
   * data-modifying statement at all. The outer capability net still catches any
   * *new* file, so the keyword check only has to hold for this small frozen set.
   */
  readonly sessionOnly: readonly string[];

  /** Source patterns that indicate the capability is exercised. */
  readonly markers: readonly RegExp[];

  /**
   * Statements that modify data. Used only to constrain `sessionOnly`, never to
   * decide whether a file holds the capability — that decision stays
   * capability-based so it cannot be evaded by rephrasing a statement.
   */
  readonly dataModifyingKeywords: readonly RegExp[];
}

export interface CapabilityAudit {
  readonly capability: string;

  /** Holders that are neither authorised, known legacy, nor session-only. */
  readonly unauthorised: readonly string[];

  /** Listed entries that no longer hold the capability. Removable. */
  readonly stale: readonly string[];

  /**
   * Files claimed to be session-configuration only that nevertheless contain a
   * data-modifying statement. The claim is false and the file is a write path.
   */
  readonly falseSessionOnly: readonly string[];

  /** Every file found holding the capability. */
  readonly holders: readonly string[];
}

const SOURCE_EXTENSIONS = new Set([".ts", ".mts", ".cts", ".mjs", ".cjs", ".js"]);

/**
 * One scope for every capability, deliberately shared rather than declared per
 * capability.
 *
 * Enforcement SHALL NOT depend on which directory the caller lives in. The first
 * version of this module policed raw SQL under `scripts` only while policing the
 * case graph across the whole tree, which meant a runtime service could hold the
 * write capability and never be seen. Closing `script → PostGIS` while leaving
 * `service → PostGIS` open is not a closed boundary; it just moves the road.
 */
export const GOVERNED_WRITE_SCOPE: readonly string[] = [
  "scripts",
  "server",
  "src",
  "services",
  "packages",
];

/**
 * Test sources are not production write paths.
 *
 * Applied to every capability rather than as a per-capability exemption, so the
 * rule stays symmetric: no capability can quietly acquire a different notion of
 * what counts as production. A test that contains marker text in a fixture is
 * describing a violation, not committing one.
 */
const TEST_SOURCE = /(^|\/)(tests?|__tests__)\/|\.(test|spec)\.[cm]?[jt]s$/;

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
        const relative = path.relative(root, child).split(path.sep).join("/");
        if (!TEST_SOURCE.test(relative)) found.push(relative);
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
  const read = (file: string): string =>
    fs.readFileSync(path.join(repoRoot, file), "utf8");

  const holders = collectSourceFiles(repoRoot, capability.scope)
    .filter((file) => !isExempt(file, capability))
    .filter((file) => capability.markers.some((marker) => marker.test(read(file))))
    .sort();

  const listed = [
    ...capability.authorised,
    ...capability.legacy,
    ...capability.sessionOnly,
  ];
  const permitted = new Set(listed);

  return {
    capability: capability.id,
    unauthorised: holders.filter((file) => !permitted.has(file)),
    stale: listed.filter(
      (file) => !capability.authorised.includes(file) && !holders.includes(file),
    ),
    // Only holders are inspected. A listed file that is absent, or that no
    // longer reaches the primitive, is reported as stale instead.
    falseSessionOnly: capability.sessionOnly
      .filter((file) => holders.includes(file))
      .filter((file) =>
        capability.dataModifyingKeywords.some((keyword) => keyword.test(read(file))),
      ),
    holders,
  };
}

const SQL_DATA_MODIFYING: readonly RegExp[] = [
  /\bINSERT\s+INTO\b/i,
  /\bUPDATE\s+["\w.]+\s+SET\b/i,
  /\bDELETE\s+FROM\b/i,
  /\bTRUNCATE\b/i,
  /\bDROP\s+(TABLE|SCHEMA|VIEW)\b/i,
  /\bALTER\s+TABLE\b/i,
  /\bCREATE\s+(TABLE|SCHEMA)\b/i,
];

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
  scope: GOVERNED_WRITE_SCOPE,
  exempt: [
    {
      path: "scripts/db",
      reason:
        "Maintenance is an explicit exception in the policy: index, partition, " +
        "vacuum, schema DDL. These do not import datasets.",
    },
    {
      path: "packages/mps-data-governance/src/GovernedWriteCapability.ts",
      reason:
        "Declares the markers. Matching itself is a property of the regex, not " +
        "a write path.",
    },
  ],
  authorised: [
    "scripts/import/import-librarian-manifest.ts",
    "scripts/import/importLibrarianQa.ts",
  ],
  sessionOnly: [
    "server/modules/ai/orchestrator/tools/queryGeodataTool.ts",
    "server/modules/gis/nmdRasterService.ts",
    "server/modules/gis/nmdTileService.ts",
    "server/repositories/requirementsRepository.ts",
  ],
  dataModifyingKeywords: SQL_DATA_MODIFYING,
  legacy: [
    // Runtime services that write prod directly, outside the librarian.
    // P1 commit 025802e removed the four request-path INSERTs previously held by
    // propertyUnitService. The service remains runtime-reachable, but now performs
    // read-only property lookups and therefore holds no raw-write capability.
    "server/modules/legal/services/evidenceExtractionService.ts",
    "server/modules/search/adapters/searchRepository.ts",
    "server/modules/search/services/sleipnerSpatialService.ts",
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
    // GW-01 (owner decision 2026-08-13) — REGISTER_EXISTING_LEGACY_WRITE.
    //
    // Three `$executeRawUnsafe` UPDATEs setting DocumentChunk.embedding / .embeddingJson.
    // Registered as legacy rather than authorised, because the authorised set is the librarian
    // chokepoint and an embedding job does not belong there; calling it authorised would erode
    // what the word means.
    //
    // This writes a DERIVED index representation, not new authority-bearing domain data, and
    // it is offline tooling rather than the request path.
    //
    // The count moved 36 → 37 by DISCOVERY, not by new debt. The write arrived committed in
    // `1c55ac43 feat(knowledge): implement live Gemini-2 Matryoshka embeddings` and was simply
    // never entered in the ledger. Nothing was made worse by recording it; it was made visible.
    // Reducing the raw-write surface here is a separate migration unit.
    "scripts/import/generate-embeddings.ts",
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
  scope: GOVERNED_WRITE_SCOPE,
  exempt: [],
  authorised: ["scripts/import/mimer/mimerBindingAgent.ts"],
  sessionOnly: [],
  dataModifyingKeywords: SQL_DATA_MODIFYING,
  legacy: ["server/modules/legal/services/evidenceExtractionService.ts"],
  markers: [
    /(environmentalCase|caseEvidence)\.(create|createMany|upsert|update|updateMany|delete|deleteMany)\s*\(/,
  ],
};

export const GOVERNED_WRITE_CAPABILITIES: readonly GovernedWriteCapability[] = [
  POSTGIS_RAW_WRITE,
  CASE_GRAPH_WRITE,
];
