/**
 * U30F2 H1 (PRES-05) -- the REVIEWED parts of the protected-write channel inventory.
 *
 * tests/unit/protectedRelationGateInventory.test.ts scans every repository file with
 * tests/unit/protectedWriteChannels.ts. A channel site that is not gated and not statically ALLOWED must
 * be explained HERE, exactly (its verdict, kind, channel and source excerpt), with a justification -- or
 * the file must be retired (RETIRED_DESTRUCTIVE_SCRIPTS) or be a pinned historical migration. Every list
 * below is pinned by count and sha256 in the test: a change here is a reviewed change of both files, and
 * a new, changed or removed site fails the test until this list is updated with it.
 *
 * Policies (what a reviewed entry may hold):
 *   DYNAMIC_REVIEWED    only UNRESOLVABLE / DYNAMIC sites (never a PROTECTED one);
 *   GOVERNED            the governed import path (markers: its governed gate doors; or callers);
 *   SANCTIONED_REBUILD  the definition's sanctioned rebuilder; PROTECTED sites only on `relation`;
 *   TEST_DB_GUARD       writes the disposable test database behind TEST-DB-GUARD (marker or callers);
 *   GATED_VIA           PROTECTED literals that reach a channel only through the named gate call (marker);
 *   SEPARATELY_GUARDED  guarded by its own protected-relation check (marker);
 *   TEST_HARNESS        a file in a test tree that only the test runner reaches (U30F3 M-2): every file that imports
 *                       or names it is itself in a test tree and reached the same way, or is a runner configuration
 *                       (checked recursively); no marker.
 * A `markers` entry is a regular expression the file must match; `callers` lists the only non-test files
 * that may import the module (the test checks every importer).
 */

export type ReviewedPolicy = "DYNAMIC_REVIEWED" | "GOVERNED" | "SANCTIONED_REBUILD" | "TEST_DB_GUARD" | "GATED_VIA" | "SEPARATELY_GUARDED" | "TEST_HARNESS";

export interface ReviewedChannels {
  readonly file: string;
  readonly policy: ReviewedPolicy;
  readonly markers?: readonly string[];
  readonly callers?: readonly string[];
  readonly relation?: string;
  readonly justification: string;
  /** `<VERDICT> <KIND> <channel> | <excerpt>` -- exactly the scanner's sites of the file (a multiset). */
  readonly sites: readonly string[];
  /**
   * U30F8 (G6-2): DYNAMIC_REVIEWED only -- sha256 of what the scan reads of the file (package.json: its command-bearing
   * fields, U30F9 G8-7; any other file: its whole text, line endings normalised). Any change fails until the entry is
   * reviewed again -- see docs/architecture/U30-PROTECTED-WRITE-INVENTORY-REREVIEW.md (U30F9 G8-9).
   */
  readonly contentSha256?: string;
  /**
   * U30F9 (G8-9): DYNAMIC_REVIEWED only -- how the file is reached (an npm script, a CI step, a runbook, an operator run, a
   * caller), or why it is shown unreachable from the product, CI and operator paths. The test requires it on every pin.
   */
  readonly reachability?: string;
  /** U30F9 (G8-9): the ISO date of the last review of this entry (the pin's date). */
  readonly reviewedOn?: string;
  /** U30F9 (G8-9): who reviewed the entry (the unit and the agent, e.g. "U30F8 W-U30F3 (Claude Opus 5.5)"). */
  readonly reviewedBy?: string;
}

/**
 * U30F3 (U30F2-VERIFICATION L-1): what a reviewed entry's marker may be -- a call of one of its policy's own gate
 * doors, from this closed list (the marker is `<door>` or `<door>\(...`). An arbitrary pattern the file happens to
 * contain ("pg") whitelists nothing. The list is pinned in the test (LOCKS.markerDoorsSha256). KNOWN LIMIT: a
 * door's call elsewhere in the file still satisfies a marker; one commit that edits this list, the entry and the
 * lock together still passes -- a CODEOWNERS / Dev-Gov binding of these files is the owner's decision.
 */
export const REVIEW_MARKER_DOORS: Readonly<Record<string, readonly string[]>> = {
  GATED_VIA: [
    "gatedSql", "assertSqlWriteAllowed", "assertCommandWriteAllowed", "assertOgr2ogrWriteAllowed", "assertOgr2ogrCommandAllowed",
    "assertUngovernedDestructiveWriteAllowed", "gated_sql", "assert_command_write_allowed", "assert_ungoverned_write_allowed",
    "assert_ogr2ogr_write_allowed", "Get-GatedSql", "Assert-CommandWriteAllowed", "Assert-UngovernedWriteAllowed", "Assert-Ogr2ogrWriteAllowed",
  ],
  GOVERNED: ["retainOutgoingThenReplace", "assertStagingImportOverwriteAllowed", "planStagingCleanup", "dropStagingRelationGoverned", "assertFirstImportAdmitted"],
  SANCTIONED_REBUILD: ["assertSanctionedDerivedRebuild"],
  TEST_DB_GUARD: ["assertDisposableGisTestDatabase", "admitDisposableGisTestDatabase"],
  SEPARATELY_GUARDED: ["assertPendingFilesMayRun"],
  DYNAMIC_REVIEWED: [],
  TEST_HARNESS: [],
};

/** The gate itself, its classifier and its bindings: they hold destructive statements on purpose. */
export const GATE_IMPLEMENTATION: readonly { readonly file: string; readonly justification: string }[] = [
  { file: "packages/spatial-provider-postgis/src/ProtectedRelationGate.ts", justification: "The protected relation gate (TypeScript)." },
  { file: "packages/spatial-provider-postgis/src/ProtectedRelations.ts", justification: "The protected relations definition loader and classification." },
  { file: "packages/spatial-provider-postgis/src/ProtectedWriteClassifier.ts", justification: "The shared write classifier (SQL, ogr2ogr, command lines)." },
  { file: "packages/spatial-provider-postgis/src/ProtectedRelationSpec.ts", justification: "The classification specification loader." },
  { file: "packages/spatial-provider-postgis/src/SpatialDatasetRetention.ts", justification: "The governed door: retain-before-replace and first-import admission." },
  { file: "packages/spatial-provider-postgis/src/StagingCleanupProtection.ts", justification: "The governed door: per-relation staging cleanup decisions." },
  { file: "packages/spatial-provider-postgis/src/FirstImportAdmission.ts", justification: "The committed first-import admissions (H3)." },
  { file: "scripts/data-pipeline/protected_relation_gate.py", justification: "The protected relation gate (Python binding)." },
  { file: "scripts/lib/ProtectedRelationGate.ps1", justification: "The protected relation gate (PowerShell binding)." },
  { file: "tests/unit/protectedWriteChannels.ts", justification: "The channel inventory scanner itself (U30F3 M-2: scanned now that a test tree no longer exempts it): pure, it reads files and runs nothing; its synthetic statements render asyncpg COPY and pandas to_sql calls for classification." },
];

/**
 * Test sources: executed only by the test runner, whose database access is held to the disposable test
 * database by TEST-DB-GUARD (W-TDG). One rule, never per file. A script in a directory that merely has a
 * test-like name (scripts/test/) is NOT a test source.
 *
 * U30F3 M-2 (U30F2-VERIFICATION V72-V74; owner decision 2026-10-02: no general residual risk): a name or a directory
 * an author can choose never exempts a file. A file is a test source only when a configured test runner RUNS it: it
 * matches one of the include globs below (each copied from its runner configuration -- the test checks that every
 * `literal` still stands in its `config`) and is not on `excluded`. Everything else -- an operator script named
 * *.test.ts outside every runner glob, a helper or script in a test tree without a test name (tests/ops/purge.ts),
 * *.spec.* outside tests/e2e, __tests__/ helpers -- is scanned like any other file.
 */
export const TEST_SOURCES = {
  runners: [
    { config: "vitest.config.ts", literal: "'**/unit/**/*.test.ts'", globs: ["**/unit/**/*.test.ts"] },
    { config: "vitest.config.ts", literal: "'**/unit/**/*.test.tsx'", globs: ["**/unit/**/*.test.tsx"] },
    { config: "vitest.config.ts", literal: "'tests/components/**/*.test.tsx'", globs: ["tests/components/**/*.test.tsx"] },
    { config: "vitest.config.ts", literal: "'tests/integration/**/*.test.ts'", globs: ["tests/integration/**/*.test.ts"] },
    { config: "vitest.config.ts", literal: "'tests/smoke/**/*.test.ts'", globs: ["tests/smoke/**/*.test.ts"] },
    ...[
      "mps-compliance", "mps-runtime", "mps-artifact-store", "mps-lu", "mps-data-governance", "mps-decision-governance", "mps-materialization",
      "mps-diagnostics", "mps-retrieval-governance", "mps-query-budget", "mps-retrieval-trace", "mps-runtime-snapshot", "mps-cas-boundary",
      "mps-governance-runtime", "mps-chunking", "mps-text-projection", "mps-legal-corpus", "mps-embedding-identity", "mps-legal-retrieval-contract",
      "mps-legal-answer-contract", "spatial-provider-postgis", "mps-knowledge-corpus", "mps-knowledge-index", "mps-knowledge-eval", "mps-pattern-proof",
    ].map((p) => ({ config: "vitest.config.ts", literal: `'packages/${p}/**/*.test.ts'`, globs: [`packages/${p}/**/*.test.ts`] })),
    { config: "vitest.config.ts", literal: "'scripts/audit/**/*.test.ts'", globs: ["scripts/audit/**/*.test.ts"] },
    { config: "packages/alpha-runtime/vitest.config.ts", literal: "'src/**/*.test.ts'", globs: ["packages/alpha-runtime/src/**/*.test.ts"] },
    { config: "scripts/devgov/vitest.config.mjs", literal: "'scripts/audit/devgov*.test.ts'", globs: ["scripts/audit/devgov*.test.ts"] },
    { config: "playwright.config.ts", literal: "testDir: 'tests/e2e'", globs: ["tests/e2e/**/*.spec.ts", "tests/e2e/**/*.test.ts"] },
  ],
  excluded: [
    { file: "tests/unit/server.services.bankIdService.test.ts", config: "vitest.config.ts", literal: "'tests/unit/server.services.bankIdService.test.ts'" },
  ],
  justification:
    "A test source is a file a configured runner (vitest projects, playwright) runs, under TEST-DB-GUARD; its protected writes (fixtures, setup) hit the disposable test database. Nothing is exempt by its name or directory alone (U30F3 M-2).",
} as const;

/** Paths the walk does not enter. Generated, vendored, or other checkouts of this repository. */
export const PATH_EXCLUSIONS: readonly { readonly pattern: string; readonly justification: string }[] = [
  { pattern: String.raw`(^|/)node_modules/`, justification: "Third-party packages (npm); not repository code." },
  { pattern: String.raw`^\.git/`, justification: "Git's object store; holds no code that runs." },
  { pattern: String.raw`^\.claude/worktrees/`, justification: "Other agents' checkouts of this repository; each is scanned in its own checkout." },
  { pattern: String.raw`^\.worktrees/`, justification: "Other checkouts of this repository; each is scanned in its own checkout." },
  { pattern: String.raw`^packages/[^/]+/dist/`, justification: "Build output of packages/*/src (gitignored); the source is scanned." },
  { pattern: String.raw`^public/cesium/`, justification: "Vendored CesiumJS browser build; runs in the browser, opens no database or process." },
  { pattern: String.raw`^coverage/`, justification: "Generated coverage report (gitignored)." },
  { pattern: String.raw`^tmp-artifacts/`, justification: "Generated test artefacts (gitignored)." },
];

/** File types that run code but are not scanned: every repository file of one of these must be listed. */
export const UNSCANNED_EXECUTABLE_TYPES: readonly string[] = [
  ".rb", ".pl", ".php", ".go", ".rs", ".java", ".kt", ".cs", ".lua", ".r", ".jl", ".swift", ".scala", ".groovy",
  ".vbs", ".vba", ".bas", ".wsf", ".awk", ".tcl", ".ex", ".exs", ".clj", ".dart", ".fish", ".ksh", ".csh", ".nu",
  ".ipynb", ".ddl", ".dml", ".hql", ".gradle", ".mk", ".makefile",
  "Makefile", "Rakefile", "Justfile", "justfile", "Procfile", "Jenkinsfile", "Earthfile",
  // U30F4 (B5): configuration that can run commands or name a datasource (systemd, Terraform/HCL, ini/conf/cfg,
  // XML build/VRT files, Prisma schema, plist/desktop/registry, PowerShell data, MSBuild) and renamed retired code
  ".service", ".timer", ".socket", ".tf", ".tfvars", ".hcl", ".conf", ".ini", ".cfg", ".xml", ".vrt", ".prisma",
  ".plist", ".desktop", ".reg", ".psd1", ".csproj", ".vbproj", ".targets", ".props", ".sln", ".nix", ".historical",
];

export const UNSCANNED_EXECUTABLES: readonly { readonly file: string; readonly justification: string }[] = [
  { file: "docs/ops/OutlookExportToIdempotent.vba", justification: "Outlook macro (runs inside Outlook): ADODB.Stream writes a CSV file; no database connection, no process." },
  { file: "docs/ops/OutlookMoveToSingleFolder.vba", justification: "Outlook macro (runs inside Outlook): moves mail items between folders; no database connection, no process." },
  { file: "docs/ops/OutlookTriageScan.vba", justification: "Outlook macro (runs inside Outlook): FileSystemObject / ADODB.Stream / RegExp over mail; no database connection, no process." },
  // U30F4 (B5): the present files of the newly listed types, each read
  { file: "tests/fixtures/domstol-rss-miljo-feed-sample.xml", justification: "RSS 2.0 feed sample read by the domstol RSS tests: data, no command, no SQL, no datasource." },
  { file: "scripts/db/xyz_template.vrt", justification: "OGR VRT template for point CSV layers ({{FILE_PATH}} placeholder, no PG: datasource); GDAL reads a VRT as a source, it writes no database." },
  { file: "prisma/schema.prisma", justification: "The Prisma schema of the public schema (no multiSchema): only the prisma CLI applies it, and every prisma subcommand that changes a database is a classified command (migrate reset/dev, db push: UNRESOLVABLE; db execute: its --file)." },
  { file: "packages/mps-lu/tests/A1AuthorityBypass.red.test.ts.historical", justification: "A retired test kept as history (renamed from *.test.ts): no runner includes *.historical and no script runs it." },
  { file: "packages/mps-lu/tests/LUMagicMoment.test.ts.historical", justification: "A retired test kept as history (renamed from *.test.ts): no runner includes *.historical and no script runs it." },
  { file: "packages/mps-lu/tests/LuEnforcementReplay.test.ts.historical", justification: "A retired test kept as history (renamed from *.test.ts): no runner includes *.historical and no script runs it." },
  { file: "tests/unit/import/SR1SourceRegistryParallelAuthority.red.test.ts.historical", justification: "A retired test kept as history (renamed from *.test.ts): no runner includes *.historical and no script runs it." },
  { file: "tests/unit/legalDomstolRssAuthority.red.test.ts.historical", justification: "A retired test kept as history (renamed from *.test.ts): no runner includes *.historical and no script runs it." },
];

/**
 * U30F4 (B5): every file type in the repository has a decision. A type is scanned (languageOf), an unscanned
 * executable type above (each file listed), or decided DATA here -- a file of a type with none of the three fails
 * the inventory, so a new type (and with it a new way to run something) never passes without a decision.
 * The key is the extension, or the whole file name when it has none.
 */
export const FILE_TYPE_DECISIONS: readonly { readonly key: string; readonly decision: "DATA"; readonly justification: string }[] = [
  { key: ".md", decision: "DATA", justification: "Markdown documents; read, never executed by a runner or script." },
  { key: ".mdc", decision: "DATA", justification: "Cursor editor rules (Markdown); read by an editor, never executed." },
  { key: ".txt", decision: "DATA", justification: "Plain text fixtures, requirement lists and notes." },
  { key: ".csv", decision: "DATA", justification: "Tabular data (requirements, QA, fixtures)." },
  { key: ".json", decision: "DATA", justification: "JSON data and configuration; the command-bearing JSON (package.json scripts, .vscode/.claude/.devcontainer) is scanned." },
  { key: ".jsonl", decision: "DATA", justification: "JSON-lines evidence and benchmark data." },
  { key: ".jsonc", decision: "DATA", justification: "Architecture maps with comments (docs/architecture); data." },
  { key: ".geojson", decision: "DATA", justification: "GeoJSON fixture data." },
  { key: ".html", decision: "DATA", justification: "Browser documents and snapshots; any script in them runs in a browser, without database or process access." },
  { key: ".css", decision: "DATA", justification: "Stylesheets, applied by a browser; no code path to a database." },
  { key: ".svg", decision: "DATA", justification: "Vector images, rendered by a browser or viewer." },
  { key: ".png", decision: "DATA", justification: "Raster images (screenshots, assets)." },
  { key: ".pdf", decision: "DATA", justification: "PDF documents and snapshots." },
  { key: ".xlsx", decision: "DATA", justification: "Spreadsheets (requirements model)." },
  { key: ".mp4", decision: "DATA", justification: "Video asset of the user interface." },
  { key: ".stderr", decision: "DATA", justification: "Captured process output kept as audit evidence." },
  { key: ".example", decision: "DATA", justification: "Environment templates (.env*.example): variable names and placeholders, never executed." },
  { key: ".tsbuildinfo", decision: "DATA", justification: "TypeScript incremental build state." },
  { key: ".hash", decision: "DATA", justification: "Reference hashes of golden vectors." },
  { key: ".cbor", decision: "DATA", justification: "CBOR reference vectors." },
  { key: ".bin", decision: "DATA", justification: "Binary golden fixture of the artifact store tests." },
  { key: ".lock", decision: "DATA", justification: "Python dependency lock (uv.lock): versions and hashes." },
  { key: ".gitignore", decision: "DATA", justification: "Git ignore patterns." },
  { key: ".gitattributes", decision: "DATA", justification: "Git attributes (line endings, diff and merge settings)." },
  { key: ".prettierignore", decision: "DATA", justification: "Formatter ignore patterns." },
  { key: ".dockerignore", decision: "DATA", justification: "Docker build-context ignore patterns." },
  { key: ".cursorignore", decision: "DATA", justification: "Editor ignore patterns." },
  { key: ".agyignore", decision: "DATA", justification: "Agent ignore patterns." },
  { key: ".flake8", decision: "DATA", justification: "flake8 linter settings (ini form): no command." },
  { key: ".coveragerc", decision: "DATA", justification: "coverage.py settings (ini form): no command." },
  { key: "CODEOWNERS", decision: "DATA", justification: "GitHub code owners (placeholder today; see L-1)." },
];

/**
 * Historical SQL in prisma/migrations and prisma/spatial whose statements write protected relations or
 * targets that are not static. Pinned by content (sha256 of the LF-normalised text): a changed file, or a
 * NEW migration with such a statement, fails the inventory.
 */
export const HISTORICAL_SQL: readonly { readonly file: string; readonly sha256: string; readonly writes: string; readonly justification: string }[] = [
  {
    file: "prisma/migrations/20260512194513_gis_schemas_and_stubs/migration.sql",
    sha256: "8734f108920e730ef08ce4190e29b3362685987501ce8dcc2c0c0483ac6420fd",
    writes: "PROTECTED: CREATE env.natura2000_area, CREATE env.protected_area, CREATE env.sgu_landslide_feature, CREATE env.sgu_soil_type_25k_100k, CREATE env.sgu_well, CREATE env.water_protection_area",
    justification: "Historical Prisma migration (by its name 2026-05-12): CREATE of the env/core GIS stubs. prisma migrate deploy applies a migration once and never again; this content is pinned.",
  },
  {
    file: "prisma/migrations/20260513044100_rename_filename_to_name_in_spatial_migrations/migration.sql",
    sha256: "9c25bdb394f88834aa27afe7b2fa453aa0f81fd306f27b474206d72f7927cf65",
    writes: "PROTECTED: DROP env.natura2000_area, DROP env.protected_area, DROP env.sgu_landslide_feature, DROP env.sgu_soil_type_25k_100k, DROP env.sgu_well, DROP env.water_protection_area",
    justification: "Historical Prisma migration (by its name 2026-05-13): DROP of those GIS stubs (spatial DDL owns env/core, SPATIAL-SCHEMA-OWNERSHIP). Applied once by prisma migrate deploy; this content is pinned.",
  },
  {
    file: "prisma/migrations/20260721180000_legal_corpus_chunks/migration.sql",
    sha256: "8a9650524f29dbb3ad3ed95906a3c4a4f4ab92f5401378f6c4b81b2e0e89c0f8",
    writes: "UNRESOLVABLE: CASCADE (DROP TABLE IF EXISTS public.legal_corpus_chunks CASCADE)",
    justification: "U30F5 (D-7): historical Prisma migration (by its name 2026-07-21) of the public legal corpus (Prisma owns public). Only the prisma CLI runs it: migrate deploy applies it once (on a fresh database before anything depends on the table), and the commands that re-run applied migrations (migrate reset, migrate dev, db push) are classified UNRESOLVABLE wherever a scanned file holds them. This content is pinned.",
  },
  {
    file: "prisma/spatial/001_gist_indexes.sql",
    sha256: "c72a7eb7118c25610c6222fee9f68323b2e6a0fb5b970a4b66d68f11fab8c5d3",
    writes: "UNRESOLVABLE: DYNAMIC_SQL",
    justification: "Versioned spatial DDL: GiST indexes created in DO blocks with EXECUTE format; applied through spatial-bootstrap, which refuses a protected-touching pending file on a database holding protected relations (H2).",
  },
  {
    file: "prisma/spatial/002_partition_large_geo_tables.sql",
    sha256: "c86a260e2cf4690128f2bd352ab08589d2266626964455538e7d1f5f880206a0",
    writes: "UNRESOLVABLE: DYNAMIC_SQL",
    justification: "Versioned spatial DDL: partitioning helpers in DO blocks with EXECUTE format; applied only through spatial-bootstrap (H2 guard).",
  },
  {
    file: "prisma/spatial/003_sgu_compat_views.sql",
    sha256: "212ba2018283d95e64ef1d0f74d07f339e632d89d8feb8bb18ab790b00913f44",
    writes: "PROTECTED: CREATE env.sgu_soil_type_25k_100k, CREATE env.sgu_well",
    justification: "Versioned spatial DDL: SGU compatibility objects env.sgu_soil_type_25k_100k and env.sgu_well; applied only through spatial-bootstrap (H2 guard).",
  },
  {
    file: "prisma/spatial/004_property_unit_core.sql",
    sha256: "c75353b078d9f18aba00a8f20e19676d30e3e059fd671dadb57b45b4b1af42f2",
    writes: "PROTECTED: ALTER core.property_unit, CREATE core.property_unit, DROP core.property_unit",
    justification: "Versioned spatial DDL of core.property_unit (DROP/CREATE): applied only through spatial-bootstrap (H2 guard: never on a database that holds protected relations) and by the sanctioned rebuild --recreate.",
  },
  {
    file: "prisma/spatial/005_ebh_potentiellt_fororenade_omraden.sql",
    sha256: "83496285060988c7127f5e3a93e348e3decd0208dd4d091f5575c6be2d2b4909",
    writes: "PROTECTED: CREATE env.ebh_potentiellt_fororenade_omraden, DROP env.ebh_potentiellt_fororenade_omraden",
    justification: "Versioned spatial DDL (RC6) of env.ebh_potentiellt_fororenade_omraden: applied only through spatial-bootstrap (H2 guard) and the test provisioners.",
  },
  {
    file: "prisma/spatial/006_protected_area_physical_boundary.sql",
    sha256: "4c2432d6d4e87ffbb4ad663c76688dfeb03a9fdbd751ba6bedddf4e0f9a93b73",
    writes: "PROTECTED: CREATE env.protected_area, DROP env.protected_area",
    justification: "Versioned spatial DDL (RC6) of env.protected_area: applied only through spatial-bootstrap (H2 guard) and the test provisioners.",
  },
  {
    file: "prisma/spatial/01_setup_partitioned_properties.sql",
    sha256: "bcdc4d76afd0fb3e13374119ac1584b1a0d51167739658ef320ad644c59eaac6",
    writes: "UNRESOLVABLE: ALTER, CREATE, DYNAMIC_SQL, UPDATE",
    justification: "Versioned spatial DDL: partitioned property setup in DO blocks (dynamic targets); applied only through spatial-bootstrap (H2 guard).",
  },
];

/** Every channel site that is neither gated nor statically ALLOWED, per file, with its review. */
export const REVIEWED_CHANNELS: readonly ReviewedChannels[] = [
  {
    file: ".github/workflows/deploy-staging.yml",
    policy: "DYNAMIC_REVIEWED",
    contentSha256: "beff42eccc34d079a12f61cd925193691be660833e018bd793d32812bc33f5cf",
    reachability: "GitHub Actions workflow: workflow_run after CI completes on main/master, and workflow_dispatch. Job deploy-staging, step Prisma migrate (staging).",
    reviewedOn: "2026-10-06",
    reviewedBy: "G814REP1 WRITER (Grok 4.7)",
    justification:
      "G814REP1 F-1a: the Prisma migrate (staging) step runs npx prisma migrate deploy with DATABASE_URL taken from the GitHub Actions secret STAGING_DATABASE_URL. The value is not in the file, so the connection is non-literal and the site is UNRESOLVABLE with detail NON_LITERAL. The Vercel step forwards the same secret to npm and vercel, which are not a database tool and are not a site. This review does not close environment inheritance into launched scripts, npm scripts or make targets (F-1h), other carriers (F-1b through F-1g), or gcloud --set-secrets (G814-N1).",
    sites: [
      "UNRESOLVABLE PROCESS yaml | export DATABASE_URL=\"⟦DYN:actions⟧\"; npx prisma migrate deploy",
    ],
  },
  {
    file: ".github/workflows/devgov-v0-attest.yml",
    policy: "DYNAMIC_REVIEWED",
    contentSha256: "d189451ca61c1c8d057dcdfb9d50c6b4135ebadb8eab893306cc9187a10dd1fe",
    reachability: "Reached as a GitHub Actions workflow of Dev-Gov (workflow_dispatch and the orchestrate workflow); named by the devgov-v0-orchestrate and devgov-v0 workflows and by governance/devgov/units/*.json records.",
    reviewedOn: "2026-10-03",
    reviewedBy: "U30F9 W-U30F9 (Claude Fable 5.1)",
    justification:
      "U30F9 (G6-1 reached through the code-runner channel): the attest workflow pipes the JSON result of devgov.mjs resolve-execution-sha (a here-string, `<<<\"$result\"`) into a static `node -e` one-liner that parses it and prints execution_sha. The node code is static and in the file; only its stdin is a value (the JSON record), which is G6-1's 'a code runner reads a here-document with values the text does not hold'. No database client, no DB tool; the workflow is Dev-Gov's.",
    sites: [
      "UNRESOLVABLE PROCESS yaml | execution_sha=\"$(node -e \"let s='';process.stdin.on('data',d=>s+=d).on('end',()=>process.stdout.write(JSON.parse(s).execution_sha))\" <<<\"$result\")\"",
    ],
  },

  {
    file: ".github/workflows/devgov-v0-rebase-reverify.yml",
    policy: "DYNAMIC_REVIEWED",
    contentSha256: "fe6e5fbaf82133476c64a3df6bb1126b73d025280add48ea0096e4dfc1433f11",
    reachability: "Reached as a GitHub Actions workflow of Dev-Gov (workflow_dispatch / the orchestrate workflow); named by governance/devgov/units/automated-rebase-reverify-01-v1.json and the AUTOMATED-REBASE-REVERIFY-01 audit; no npm script runs it.",
    reviewedOn: "2026-10-03",
    reviewedBy: "U30F8 W-U30F3 (Claude Opus 5.5): content pin (G6-2) -- the entry's review is the unit its justification names; the reachability field was added by U30F9 W-U30F9 (Claude Fable 5.1) from the justification and a repository grep (reachability-grep.json), without re-reading the file",
    justification:
      "U30F8 (G6-1): the reverify-phases step runs a node script from a here-document (<<'NODE', quoted: no expansion), now scanned as JavaScript. It import()s the PROTECTED controller checkout's scripts/dev-helpers/automated-rebase-reverify.mjs (the same repository file, scanned and itself DYNAMIC_REVIEWED with a content pin) by a path built at run time, and runs only git (execFileSync/spawnSync 'git' with argument arrays) and gh api (a GitHub REST read): no database client, no DB tool. The workflow is Dev-Gov's; this entry pins its content so any change is reviewed again.",
    sites: [
      "UNRESOLVABLE PROCESS yaml | node - \"$GITHUB_OUTPUT\" <<'NODE' const { execFileSync, spawnSync } = require('node:child_process'); const fs = require('node:fs'); const path = require('node:path'); const { pathToFileURL } = require…",
    ],
  },
  {
    file: "benchmarks/alpha_evolve_bibbi_harvest/evaluator.py",
    policy: "DYNAMIC_REVIEWED",
    contentSha256: "b3b41e7db71d6f0b252bea568b26c6e4327f6c4fa2b687ad941eddfbb1453a7c",
    reachability: "No npm script, CI workflow, Dockerfile or runbook runs it (grep 2026-10-03: named only by its own test_evaluator.py and the mps-compliance/mps-dep contract tests as a path string); a developer experiment run by hand.",
    reviewedOn: "2026-10-03",
    reviewedBy: "U30F8 W-U30F3 (Claude Opus 5.5): content pin (G6-2) -- the entry's review is the unit its justification names; the reachability field was added by U30F9 W-U30F9 (Claude Fable 5.1) from the justification and a repository grep (reachability-grep.json), without re-reading the file",
    justification:
      "U30F3 M-2 (exec now fails closed): the AlphaEvolve benchmark evaluator exec()s a candidate program (generated code) into a namespace and calls its evaluate(); a developer experiment harness, on no product, CI or release path. What a candidate could do against a database is not constrained here -- the database-level protection is the layer for that.",
    sites: [
      "DYNAMIC PROCESS exec | exec(code, namespace)",
    ],
  },
  {
    file: "deploy/onprem/image-smoke/smoke.mjs",
    policy: "DYNAMIC_REVIEWED",
    contentSha256: "bc3ca26ba120750f0fa2387479282df6eba3232c4bb8c9292423f85712b2d597",
    reachability: "Reached from deploy/onprem/smoke-image.sh (the on-prem image smoke) and npm test:e2e:staging; it runs the built image's entry points, not a DB tool.",
    reviewedOn: "2026-10-03",
    reviewedBy: "U30F8 W-U30F3 (Claude Opus 5.5): content pin (G6-2) -- the entry's review is the unit its justification names; the reachability field was added by U30F9 W-U30F9 (Claude Fable 5.1) from the justification and a repository grep (reachability-grep.json), without re-reading the file",
    justification:
      "On-prem image smoke: runs node --import tsx on a server entry point of the image under test (entryAbs = path.join(APP, entry), entry from the smoke matrix); a smoke check of the built image, not a database tool.",
    sites: [
      "DYNAMIC PROCESS spawnSync | spawnSync(process.execPath, ['--import', 'tsx', '--import', REGISTER, entryAbs], { cwd: APP, env: { ...process.env, ...extraEnv, LINK_ONLY_ENTRY: entryAbs }, encoding: 'utf8', timeout: 600000, maxBuf…",
    ],
  },
  {
    file: "deploy/onprem/smoke-image.sh",
    policy: "DYNAMIC_REVIEWED",
    contentSha256: "89791c77e8064ef8f1f46c5b11f713012723fd02e35ca9b2348f53abc1ff1884",
    reachability: "Operator-run on-prem image smoke (deploy/onprem/README); invoked by hand after a docker build; no npm script or CI step runs it (grep 2026-10-03).",
    reviewedOn: "2026-10-03",
    reviewedBy: "U30F8 W-U30F3 (Claude Opus 5.5): content pin (G6-2) -- the entry's review is the unit its justification names; the reachability field was added by U30F9 W-U30F9 (Claude Fable 5.1) from the justification and a repository grep (reachability-grep.json), without re-reading the file",
    justification:
      "On-prem image smoke: docker run --network none \"$image\" sh -c \"$run <case>\" -- the image is the one just built and the command an in-file function name; without a network the container reaches no database.",
    sites: [
      "DYNAMIC PROCESS sh | smoke_tar | docker run --rm -i --network none \"$image\" sh -c \"$run main\" || main_rc=$?",
      "DYNAMIC PROCESS sh | smoke_tar | docker run --rm -i --network none --tmpfs /app/packages \"$image\" sh -c \"$run packages-hidden\" || hidden_rc=$?",
    ],
  },
  {
    file: "package.json",
    policy: "DYNAMIC_REVIEWED",
    contentSha256: "1035ad3adae2ba90378bd9f872f16903428e3626e7d346d75ce4d9e90186460b",
    reachability: "The repository's npm scripts: reached by every `npm run` of a developer, by CI (.github/workflows/*.yml) and by the Dockerfile; the two pinned sites are developer-only database scripts (db:test:reset against .env.test, prisma:migrate).",
    reviewedOn: "2026-10-03",
    reviewedBy: "U30F9 W-U30F9 (Claude Fable 5.1) (re-review: the pin now covers the command-bearing fields, G8-7; sites unchanged)",
    justification:
      "db:test:reset runs prisma migrate reset against .env.test (the disposable test database, TEST-DB-GUARD); prisma:migrate is the developer migration workflow (prisma migrate dev). Neither is a release path (deploy runs prisma migrate deploy, whose files are the historical list).",
    sites: [
      "UNRESOLVABLE PROCESS npm script | dotenv -e .env.test -- prisma migrate reset --force --skip-seed",
      "UNRESOLVABLE PROCESS npm script | prisma migrate dev",
    ],
  },
  {
    file: "packages/mps-control-plane/src/multi-agent/ProcessAgentWorker.ts",
    policy: "DYNAMIC_REVIEWED",
    contentSha256: "0773126da2f781b77aeff26e5b3637813edaa913c72fff64676e7d0fdababc03",
    reachability: "Imported by packages/mps-control-plane/src/multi-agent/index.ts (the control-plane package); exercised by tests/unit/control-plane/MultiAgentProcessWorkerV1.test.ts; the worker spawns operator-configured agent processes, no DB tool.",
    reviewedOn: "2026-10-03",
    reviewedBy: "U30F8 W-U30F3 (Claude Opus 5.5): content pin (G6-2) -- the entry's review is the unit its justification names; the reachability field was added by U30F9 W-U30F9 (Claude Fable 5.1) from the justification and a repository grep (reachability-grep.json), without re-reading the file",
    justification:
      "Multi-agent control plane: spawns the agent process of a worker profile (profile.command / profile.args, operator configuration); a generic launcher with no database tool of its own.",
    sites: [
      "DYNAMIC PROCESS spawn | spawn(profile.command, [...(profile.args ?? [])], { cwd: profile.cwd, env, shell: false, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, })",
    ],
  },
  {
    file: "packages/mps-data-governance/scripts/materialize-legacy-lm-byggnader-pilot-1762.ts",
    policy: "DYNAMIC_REVIEWED",
    contentSha256: "e265fcba0e8b1b494a4c0bc75cfcbb037907a63a3cdf1fd43e129b5b552b0f2a",
    reachability: "Operator-run pilot (tsx packages/mps-data-governance/scripts/materialize-legacy-lm-byggnader-pilot-1762.ts); named only by the GovernedWriteCapability legacy-script list; no npm script, CI step or runbook runs it (grep 2026-10-03).",
    reviewedOn: "2026-10-03",
    reviewedBy: "U30F9 W-U30F9 (Claude Fable 5.1)",
    justification:
      "U30F9 default-deny: execFileSync(OGR2OGR, ['-f', 'PostgreSQL', `PG:${pgConnectionString(databaseUrl)}`, <zip path>, '-nln', <static lm_staging? no: see sites>, '-overwrite', ...]) writes the pilot's static, unprotected target with a connection string from the environment and a source path from its arguments: the values are the connection and the path (NON_LITERAL), the target is a static name the gate judges ALLOWED.",
    sites: [
      "UNRESOLVABLE PROCESS execFileSync | execFileSync( OGR2OGR, [ '-f', 'PostgreSQL', `PG:${pgConnectionString(databaseUrl)}`, ogrZipPath(zipPath), 'byggnad', '-nln', TARGET_TABLE, '-overwrite', '-nlt', 'PROMOTE_TO_MULTI', '-lco', 'GEOMETRY…",
    ],
  },

  {
    file: "packages/mps-pattern-proof/src/docker/executors.ts",
    policy: "DYNAMIC_REVIEWED",
    contentSha256: "68abcc2984f9e5acb94900e6532aee6843cfc48aa1f09456d1d930a6ba1ce803",
    reachability: "Imported by packages/mps-pattern-proof/src/docker/index.ts, classify.ts and red-probe.ts (the PPE lane); its executors run docker build/run of a candidate image; PPE V1 is BOOTSTRAP_RED_ONLY and on no product path.",
    reviewedOn: "2026-10-03",
    reviewedBy: "U30F8 W-U30F3 (Claude Opus 5.5): content pin (G6-2) -- the entry's review is the unit its justification names; the reachability field was added by U30F9 W-U30F9 (Claude Fable 5.1) from the justification and a repository grep (reachability-grep.json), without re-reading the file",
    justification:
      "Pattern-proof (PPE) Docker executors: run the command and arguments of a pattern-proof plan (docker build / run of a candidate image); the generic executor of the PPE lane.",
    sites: [
      "DYNAMIC PROCESS spawn | spawn(command, [...args], { cwd: options.cwd, env: options.env, detached: options.detached, stdio: ['ignore', 'pipe', 'pipe'], })",
      "DYNAMIC PROCESS spawnSync | spawnSync(command, [...args], { encoding: 'utf8', env, timeout: 20_000 })",
    ],
  },
  {
    file: "prompt_optimizer/manifest.py",
    policy: "DYNAMIC_REVIEWED",
    contentSha256: "b3e5bbbe8a718df4a67cc031b27aee810e222339141f2a1e6d4866270cd16c8e",
    reachability: "Imported by prompt_optimizer/main.py (build_manifest) and prompt_optimizer/tests/test_config.py, and copied by prompt_optimizer/Dockerfile. The 2026-10-03 CI launchers release-prompt-optimizer.yml and vertex_prompt_optimize.yml were deleted in W-NO-GOOGLE-01 and are not a current path. File bytes and the __import__ site are unchanged.",
    reviewedOn: "2026-10-06",
    reviewedBy: "W-NO-GOOGLE-01 (Cursor Grok): reachability re-checked after the CI launchers were deleted. Prior content pin U30F8 W-U30F3 (Claude Opus 5.5); reachability field added by U30F9 W-U30F9 (Claude Fable 5.1). This pass did not change the file or its sites.",
    justification:
      "U30F3 M-2 (__import__ now fails closed): _optional_pkg_version(module_name) imports httpx, tenacity and diskcache (the only in-file callers) to read their __version__ for a run manifest; no database or process client.",
    sites: [
      "DYNAMIC PROCESS __import__ | __import__(module_name)",
    ],
  },
  {
    file: "scripts/alphaevolve/experiments/legal_search_params/src/evaluate.py",
    policy: "DYNAMIC_REVIEWED",
    contentSha256: "2d18f00c0e3eb209f2fa969a1168b7fe3e9a7cf2a77360c0cffdfc8032ad4b8d",
    reachability: "No npm script, CI workflow, Dockerfile or runbook runs it (grep 2026-10-03: no repository file names it besides this list); a developer experiment run by hand.",
    reviewedOn: "2026-10-03",
    reviewedBy: "U30F8 W-U30F3 (Claude Opus 5.5): content pin (G6-2) -- the entry's review is the unit its justification names; the reachability field was added by U30F9 W-U30F9 (Claude Fable 5.1) from the justification and a repository grep (reachability-grep.json), without re-reading the file",
    justification:
      "U30F3 M-2 (exec now fails closed): the AlphaEvolve legal-search experiment exec()s a candidate program (generated code) with an injected evaluation set and calls its evaluate(); a developer experiment harness, on no product, CI or release path. What a candidate could do against a database is not constrained here -- the database-level protection is the layer for that.",
    sites: [
      "DYNAMIC PROCESS exec | exec(code, exec_namespace)",
    ],
  },
  // W-NO-GOOGLE-01B (2026-10-06): withdrew scripts/alphaevolve/setup.ps1.
  // The GCP/AlphaEvolve setup script was deleted. Its content pin remains in git history through 177909ea.
  {
    file: "scripts/build-requirements-verification-priority-workbook.ps1",
    policy: "DYNAMIC_REVIEWED",
    contentSha256: "742b9f2eac4f71f0546a2543700e2d173963c66c9d2e7454addca40648ddb1ca",
    reachability: "Operator-run document builder (no npm script, CI step or runbook names it, grep 2026-10-03); Start-Process opens the produced workbook.",
    reviewedOn: "2026-10-03",
    reviewedBy: "U30F8 W-U30F3 (Claude Opus 5.5): content pin (G6-2) -- the entry's review is the unit its justification names; the reachability field was added by U30F9 W-U30F9 (Claude Fable 5.1) from the justification and a repository grep (reachability-grep.json), without re-reading the file",
    justification:
      "Opens the generated Excel workbook with its default application (Start-Process on the output document path); no database tool.",
    sites: [
      "DYNAMIC PROCESS powershell | Start-Process $outputPath",
    ],
  },
  {
    file: "scripts/build-requirements-verification-workbook-fast.ps1",
    policy: "DYNAMIC_REVIEWED",
    contentSha256: "9a81f2566b1d99abcce9e265cd1eeed72f47aebb0401ba533d432648ef041889",
    reachability: "Operator-run document builder (no npm script, CI step or runbook names it, grep 2026-10-03); Start-Process opens the produced workbook.",
    reviewedOn: "2026-10-03",
    reviewedBy: "U30F8 W-U30F3 (Claude Opus 5.5): content pin (G6-2) -- the entry's review is the unit its justification names; the reachability field was added by U30F9 W-U30F9 (Claude Fable 5.1) from the justification and a repository grep (reachability-grep.json), without re-reading the file",
    justification:
      "Opens the generated Excel workbook with its default application (Start-Process on the output document path); no database tool.",
    sites: [
      "DYNAMIC PROCESS powershell | Start-Process $outFull",
    ],
  },
  {
    file: "scripts/build-requirements-verification-workbook-lite.ps1",
    policy: "DYNAMIC_REVIEWED",
    contentSha256: "376c745de51db6c624cb3be67f5857b2ed61ce4a7fe95dec01c3755db1a5b0c1",
    reachability: "Operator-run document builder (no npm script, CI step or runbook names it, grep 2026-10-03); Start-Process opens the produced workbook.",
    reviewedOn: "2026-10-03",
    reviewedBy: "U30F8 W-U30F3 (Claude Opus 5.5): content pin (G6-2) -- the entry's review is the unit its justification names; the reachability field was added by U30F9 W-U30F9 (Claude Fable 5.1) from the justification and a repository grep (reachability-grep.json), without re-reading the file",
    justification:
      "Opens the generated Excel workbook with its default application (Start-Process on the output document path); no database tool.",
    sites: [
      "DYNAMIC PROCESS powershell | Start-Process $outFull",
    ],
  },
  {
    file: "scripts/build-requirements-verification-workbook.ps1",
    policy: "DYNAMIC_REVIEWED",
    contentSha256: "96456b63c170966ee9751b04fb58d2feaf6ba0bf93020dc38899d2d7cd52c55c",
    reachability: "Operator-run document builder (no npm script, CI step or runbook names it, grep 2026-10-03); Start-Process opens the produced workbook.",
    reviewedOn: "2026-10-03",
    reviewedBy: "U30F8 W-U30F3 (Claude Opus 5.5): content pin (G6-2) -- the entry's review is the unit its justification names; the reachability field was added by U30F9 W-U30F9 (Claude Fable 5.1) from the justification and a repository grep (reachability-grep.json), without re-reading the file",
    justification:
      "Opens the generated Excel workbook with its default application (Start-Process on the output document path); no database tool.",
    sites: [
      "DYNAMIC PROCESS powershell | Start-Process $resolvedOutput",
    ],
  },
  {
    file: "scripts/data-pipeline/import_all_datasets.py",
    policy: "DYNAMIC_REVIEWED",
    contentSha256: "e5eb12093df8af9e6c18cdb1ef3fd4731db63c0b303e2a0a2581669d7cde6e5c",
    reachability: "Operator import pipeline: run by scripts/import/run-import-focus.ps1 and run-import-session.ps1 (Run-Step), scripts/import/keep-awake.ps1 and scripts/data-pipeline/nmd_optimized_import.ps1; the ogr2ogr targets are relation-gated (assert_ungoverned_write_allowed) before each run.",
    reviewedOn: "2026-10-03",
    reviewedBy: "U30F8 W-U30F3 (Claude Opus 5.5): content pin (G6-2) -- the entry's review is the unit its justification names; the reachability field was added by U30F9 W-U30F9 (Claude Fable 5.1) from the justification and a repository grep (reachability-grep.json), without re-reading the file",
    justification:
      "Legacy dataset importer, gated per target: _run_psql(sql) and run_sql(sql) are SQL forwarders (its callers pass in-file literals, which the literal surface classifies where they are written; the TRUNCATE goes through gated_sql); the two ogr2ogr runs build their argv in _build_ogr_args for the f\"{schema}.{table}\" that assert_ungoverned_write_allowed checked at the top of the import.",
    sites: [
      "UNRESOLVABLE PROCESS subprocess.run | subprocess.run(cmd, capture_output=True, text=True, env=env)",
      "DYNAMIC SQL_CALL cur.execute | cur.execute(sql)",
      "DYNAMIC PROCESS subprocess.run | subprocess.run(cmd, capture_output=True, text=True, env=_LOCAL_GDAL_ENV)",
      "DYNAMIC PROCESS subprocess.run | subprocess.run(cmd, capture_output=True, text=True)",
    ],
  },
  {
    file: "scripts/data-pipeline/import_lm_stac.py",
    policy: "DYNAMIC_REVIEWED",
    contentSha256: "40b0167410eac04218c643430e1cf218ade0a1552d3396ff3c879b3b23628113",
    reachability: "Run by scripts/import/lm_import_manager.py and the orchestrators scripts/import/run-geodata-gap-pipeline.ts, run-national-reharvest.ts and run-import-focus.ps1; also by hand (python scripts/data-pipeline/import_lm_stac.py).",
    reviewedOn: "2026-10-03",
    reviewedBy: "U30F9 W-U30F9 (Claude Fable 5.1)",
    justification:
      "U30F9 default-deny: the two subprocess.run calls -- ogr2ogr -f PostgreSQL PG:{DB_OGR} <gpkg> -nln <table> (-overwrite|-append) and the index psql -- carry the connection string, the input path and the table as values (NON_LITERAL; the ogr2ogr target is also OGR2OGR_WRITE unresolved). Each table is checked by assert_ungoverned_write_allowed(GATE_CALLER, 'OGR2OGR_WRITE', table) before the run, so a protected target is refused at run time; the inventory now records the sites because the connection and paths are values.",
    sites: [
      "UNRESOLVABLE PROCESS subprocess.run | subprocess.run(cmd, capture_output=True, text=True)",
      "UNRESOLVABLE PROCESS subprocess.run | subprocess.run(idx_cmd, capture_output=True)",
    ],
  },
  {
    file: "scripts/data-pipeline/import_lm_stac_resume.py",
    policy: "DYNAMIC_REVIEWED",
    contentSha256: "22dac94e6de9c05555be758878ee6996992eabf307de34329a09274cbfb64633",
    reachability: "Run by scripts/import/lm_import_manager.py and the orchestrators scripts/import/run-geodata-gap-pipeline.ts and run-national-reharvest.ts; also by hand.",
    reviewedOn: "2026-10-03",
    reviewedBy: "U30F9 W-U30F9 (Claude Fable 5.1)",
    justification:
      "U30F9 default-deny: the resumable twin of import_lm_stac.py -- subprocess.run of ogr2ogr -f PostgreSQL PG:{DB_OGR} <gpkg> -nln <table> with connection, path and table values (NON_LITERAL, OGR2OGR_WRITE); the table is checked by assert_ungoverned_write_allowed before the run; its ogrinfo -ro -so probe is read-only and no site.",
    sites: [
      "UNRESOLVABLE PROCESS subprocess.run | subprocess.run(cmd, capture_output=True, text=True)",
    ],
  },
  {
    file: "scripts/data-pipeline/import_nv_vardetrakter.py",
    policy: "DYNAMIC_REVIEWED",
    contentSha256: "c3201d011ef8f7344f85177d9ee772a949b071b88141b42366f3cfa61d02d851",
    reachability: "Operator-run importer (python scripts/data-pipeline/import_nv_vardetrakter.py); no npm script, CI step or runbook names it (grep 2026-10-03).",
    reviewedOn: "2026-10-03",
    reviewedBy: "U30F9 W-U30F9 (Claude Fable 5.1) (re-review: sites changed by the default-deny rule)",
    justification:
      "run_psql(query) is a psql -c forwarder; its callers pass in-file literals, which the literal surface classifies where they are written. U30F9 default-deny: the psql forwarder and the ogr2ogr run carry connection and path values, so the sites read UNRESOLVABLE (NON_LITERAL) now.",
    sites: [
      "UNRESOLVABLE PROCESS subprocess.run | subprocess.run(cmd, capture_output=True)",
      "UNRESOLVABLE PROCESS subprocess.run | subprocess.run(cmd, capture_output=True, text=True)",
    ],
  },
  {
    file: "scripts/data-pipeline/lm_local_import.ps1",
    policy: "DYNAMIC_REVIEWED",
    contentSha256: "e22722043b194b3c855974c2eca6c2325c3798cf79fd56e8564d23eff2390048",
    reachability: "Operator-run by hand (pwsh -File scripts/data-pipeline/lm_local_import.ps1); no npm script, CI step, runbook or other script names it (grep 2026-10-03).",
    reviewedOn: "2026-10-03",
    reviewedBy: "U30F9 W-U30F9 (Claude Fable 5.1)",
    justification:
      "U30F9 default-deny: a local LM import that runs & $ogr2ogrPath -f PostgreSQL $db <file> -nln lm.fastighet|lm.byggnad|lm.adress (-overwrite then -append) and & $psqlPath -h 127.0.0.1 ... -c <static SQL> (CREATE SCHEMA lm, CREATE INDEX, SELECT counts): the tool paths and the connection are PowerShell variables (NON_LITERAL); every target is static and in the unprotected schema lm, every psql statement static and non-protected. An operator script, unchanged here (U30F9 touches no ops script).",
    sites: [
      "UNRESOLVABLE PROCESS powershell | & $psqlPath -h 127.0.0.1 -U miljobeslut -d miljobeslut -c \"CREATE SCHEMA IF NOT EXISTS lm;\"",
      "UNRESOLVABLE PROCESS powershell | & $ogr2ogrPath -f PostgreSQL $db $firstFile.FullName -nln lm.fastighet -t_srs EPSG:3006 -nlt PROMOTE_TO_MULTI --config PG_USE_COPY YES -skipfailures -overwrite",
      "UNRESOLVABLE PROCESS powershell | & $ogr2ogrPath -f PostgreSQL $db $file.FullName -nln lm.fastighet -t_srs EPSG:3006 -nlt PROMOTE_TO_MULTI --config PG_USE_COPY YES -skipfailures -append",
      "UNRESOLVABLE PROCESS powershell | & $ogr2ogrPath -f PostgreSQL $db $firstFile.FullName -nln lm.byggnad -t_srs EPSG:3006 -nlt PROMOTE_TO_MULTI --config PG_USE_COPY YES -skipfailures -overwrite",
      "UNRESOLVABLE PROCESS powershell | & $ogr2ogrPath -f PostgreSQL $db $file.FullName -nln lm.byggnad -t_srs EPSG:3006 -nlt PROMOTE_TO_MULTI --config PG_USE_COPY YES -skipfailures -append",
      "UNRESOLVABLE PROCESS powershell | & $ogr2ogrPath -f PostgreSQL $db $firstFile.FullName -nln lm.adress -t_srs EPSG:3006 -nlt PROMOTE_TO_MULTI --config PG_USE_COPY YES -skipfailures -overwrite",
      "UNRESOLVABLE PROCESS powershell | & $ogr2ogrPath -f PostgreSQL $db $file.FullName -nln lm.adress -t_srs EPSG:3006 -nlt PROMOTE_TO_MULTI --config PG_USE_COPY YES -skipfailures -append",
      "UNRESOLVABLE PROCESS powershell | & $psqlPath -h 127.0.0.1 -U miljobeslut -d miljobeslut -c \" CREATE INDEX IF NOT EXISTS fastighet_shape_idx ON lm.fastighet USING GIST (wkb_geometry); CREATE INDEX IF NOT EXISTS byggnad_shape_idx ON l…",
      "UNRESOLVABLE PROCESS powershell | & $psqlPath -h 127.0.0.1 -U miljobeslut -d miljobeslut -c \" SELECT 'fastighet' AS tabell, COUNT(*) as rader FROM lm.fastighet UNION ALL SELECT 'byggnad', COUNT(*) FROM lm.byggnad UNION ALL SELECT 'ad…",
    ],
  },
  {
    file: "scripts/data-pipeline/nmd_optimized_import.ps1",
    policy: "DYNAMIC_REVIEWED",
    contentSha256: "62aae58080a50c4f418663d5c91385df6de7b55b3c12fe4e8a7929c011763644",
    reachability: "Operator-run NMD import documented in STARTA_NMD_OPTIMERAD_IMPORT.md; runs import_all_datasets.py and psql via Invoke-Psql; no npm script or CI step runs it.",
    reviewedOn: "2026-10-03",
    reviewedBy: "U30F8 W-U30F3 (Claude Opus 5.5): content pin (G6-2) -- the entry's review is the unit its justification names; the reachability field was added by U30F9 W-U30F9 (Claude Fable 5.1) from the justification and a repository grep (reachability-grep.json), without re-reading the file",
    justification:
      "Invoke-Psql is a psql -c forwarder (& $psqlPath @dbArgs -c $Sql); its callers pass in-file literals, which the literal surface classifies where they are written.",
    sites: [
      "UNRESOLVABLE PROCESS powershell | & $psqlPath @dbArgs '-c' $Sql",
    ],
  },
  {
    file: "scripts/db/apply-raster-migration.ts",
    policy: "DYNAMIC_REVIEWED",
    contentSha256: "927dca125a68ed16ebbe887bcfe3fe6f7fd3d6101b6c57f3e6ddf663a6cb0deb",
    reachability: "Operator-run (tsx scripts/db/apply-raster-migration.ts); applies prisma/migrations/20260628_raster_outdb_infrastructure.sql, which is scanned as SQL; no npm script, CI step or runbook names it (grep 2026-10-03).",
    reviewedOn: "2026-10-03",
    reviewedBy: "U30F8 W-U30F3 (Claude Opus 5.5): content pin (G6-2) -- the entry's review is the unit its justification names; the reachability field was added by U30F9 W-U30F9 (Claude Fable 5.1) from the justification and a repository grep (reachability-grep.json), without re-reading the file",
    justification:
      "Applies prisma/migrations/20260628_raster_outdb_infrastructure.sql statement by statement (split on \";\"); that file is scanned itself as SQL and holds no protected write.",
    sites: [
      "DYNAMIC SQL_CALL p.$executeRawUnsafe | p.$executeRawUnsafe(query)",
    ],
  },
  {
    file: "scripts/db/archive-manifest-audit.mjs",
    policy: "DYNAMIC_REVIEWED",
    contentSha256: "ff7087c203ccbeec7fce402c18d8abd67397cb5ecc9a97ebe8b509b814c0ee90",
    reachability: "Operator-run archive audit; imported by scripts/import/types/manifestSchema.mjs for its schema; runs rclone in docker against the archive drive, no DB.",
    reviewedOn: "2026-10-03",
    reviewedBy: "U30F8 W-U30F3 (Claude Opus 5.5): content pin (G6-2) -- the entry's review is the unit its justification names; the reachability field was added by U30F9 W-U30F9 (Claude Fable 5.1) from the justification and a repository grep (reachability-grep.json), without re-reading the file",
    justification:
      "Archive audit: docker run rclone/rclone with the rclone subcommand and paths passed in by its callers (...args); a file-sync tool against the archive drive, no database.",
    sites: [
      "DYNAMIC PROCESS execFileSync | execFileSync( 'docker', [ 'run', '--rm', '--dns', '8.8.8.8', '-v', `${RCLONE_CONFIG}:/config/rclone:ro`, 'rclone/rclone', ...args, '--config', '/config/rclone/rclone.conf', ], { encoding: 'utf8', max…",
    ],
  },
  {
    file: "scripts/db/import-nmd-outofdb.sh",
    policy: "DYNAMIC_REVIEWED",
    contentSha256: "4173c9a4fbfc513d1e4859bc7fe276d267521997121ea47e98046b73f5ec68d5",
    reachability: "Operator-run shell importer (no npm script, CI step or runbook names it, grep 2026-10-03); raster2pgsql | psql into $TARGET_TABLE; U30F9 default-deny marks its connection and table values as NON_LITERAL.",
    reviewedOn: "2026-10-03",
    reviewedBy: "U30F9 W-U30F9 (Claude Fable 5.1) (re-review: sites changed by the default-deny rule)",
    justification:
      "raster2pgsql | psql into $TARGET_TABLE (default env.nmd_2023, not protected; overridable by NMD_TARGET_TABLE). A shell script cannot call the gate: an override to a protected name is not refused (owner decision: retire or move into a gated script). U30F9 default-deny: the psql CREATE SCHEMA line and the raster2pgsql | psql line carry connection and table values (NON_LITERAL); the schema literal env is not a protected relation.",
    sites: [
      "UNRESOLVABLE PROCESS sh | psql -U miljobeslut -d \"$PSQL_TARGET\" -c 'CREATE SCHEMA IF NOT EXISTS env;'",
      "UNRESOLVABLE PROCESS sh | raster2pgsql -s 3006 -t 256x256 -R -I -C -M \"$file\" \"$TARGET_TABLE\" | psql -U miljobeslut -d \"$PSQL_TARGET\"",
    ],
  },
  {
    file: "scripts/db/lib/applyRc6VersionedSpatialDdl.ts",
    policy: "TEST_DB_GUARD",
    callers: ["scripts/db/provision-spatial-test-db.ts", "tests/setup/seedGisStubs.ts"],
    justification:
      "Runs prisma/spatial/005 and 006 (which DROP and recreate env.ebh_potentiellt_fororenade_omraden and env.protected_area) on the client it is given. Its only non-test caller is provision-spatial-test-db.ts behind assertDisposableGisTestDatabase (checked); tests/setup uses it under the vitest TEST-DB-GUARD.",
    sites: [
      "PROTECTED SQL_CALL client.query | client.query(sql)",
    ],
  },
  {
    file: "scripts/db/ogrinfo-local.ps1",
    policy: "DYNAMIC_REVIEWED",
    contentSha256: "3436d71d7c6b73cc745b6fe6aeb126c2848c0e3a200a39e0a5622876c223bab3",
    reachability: "Operator-run ogrinfo wrapper (no npm script, CI step or runbook names it, grep 2026-10-03); forwards the operator's arguments to a locally installed ogrinfo.exe.",
    reviewedOn: "2026-10-03",
    reviewedBy: "U30F8 W-U30F3 (Claude Opus 5.5): content pin (G6-2) -- the entry's review is the unit its justification names; the reachability field was added by U30F9 W-U30F9 (Claude Fable 5.1) from the justification and a repository grep (reachability-grep.json), without re-reading the file",
    justification:
      "Local ogrinfo wrapper: resolves an installed ogrinfo.exe and forwards the arguments the operator gives (@ArgsList). ogrinfo -sql can write and the wrapper cannot see what it runs (owner decision: gate with Assert-CommandWriteAllowed).",
    sites: [
      "DYNAMIC PROCESS powershell | & $ogrinfo @ArgsList",
    ],
  },
  {
    file: "scripts/db/partition-realtime-tables.sql",
    policy: "DYNAMIC_REVIEWED",
    contentSha256: "1c7c0a6b9b907250630251fd191c0e2b5db6beb738e431fe3c139122a9c25a58",
    reachability: "Named by docs/architecture/postgis_scalability_report.md; applied by hand (psql -f) if at all; no npm script, spatial-bootstrap file list or CI step runs it (it is not under prisma/spatial).",
    reviewedOn: "2026-10-03",
    reviewedBy: "U30F8 W-U30F3 (Claude Opus 5.5): content pin (G6-2) -- the entry's review is the unit its justification names; the reachability field was added by U30F9 W-U30F9 (Claude Fable 5.1) from the justification and a repository grep (reachability-grep.json), without re-reading the file",
    justification:
      "Time-series partitioning of the public application tables GpsPosition, AuditTrail, SearchQueryLog and PropertyAccessLog; its DO blocks EXECUTE format(...) for monthly partitions of those public tables only.",
    sites: [
      "UNRESOLVABLE SQL_FILE sql file | (whole file)",
    ],
  },
  {
    file: "scripts/db/promote-raster-cog.mjs",
    policy: "DYNAMIC_REVIEWED",
    contentSha256: "8e5b3a1d8c7d7f30bb6ca6b935dec9f2a572a9b766683bfe83f40b0ec2ae8d3a",
    reachability: "Operator-run COG promotion (node scripts/db/promote-raster-cog.mjs); referenced by the test-db-guard data-root isolation list; gdal_translate file in, file out, no PG datasource.",
    reviewedOn: "2026-10-03",
    reviewedBy: "U30F8 W-U30F3 (Claude Opus 5.5): content pin (G6-2) -- the entry's review is the unit its justification names; the reachability field was added by U30F9 W-U30F9 (Claude Fable 5.1) from the justification and a repository grep (reachability-grep.json), without re-reading the file",
    justification:
      "gdal_translate (GDAL_TRANSLATE, resolved at run time) converts a raster file to COG on disk; file in, file out, no database datasource.",
    sites: [
      // U30F8 (G6-7): the same site -- a command line whose program is a value is now UNRESOLVABLE in the gate (was DYNAMIC)
      "UNRESOLVABLE PROCESS execSync | execSync(gdalCmd, { stdio: 'inherit' })",
    ],
  },
  {
    file: "scripts/db/provision-spatial-test-db.ts",
    policy: "TEST_DB_GUARD",
    markers: ["assertDisposableGisTestDatabase"],
    justification:
      "Provisions the disposable GIS test database (TEST-DB-GUARD lane W-TDG): CREATE/INSERT/DELETE of env.sgu_well and core.property_unit stubs and DROP DATABASE of the test database itself, all after assertDisposableGisTestDatabase refuses any target that is not the configured disposable test database. U30F5 (B8): its GRANT and ALTER DEFAULT PRIVILEGES give the provisioned role rights on the provisioned schemas of that same test database.",
    sites: [
      "PROTECTED SQL_TEXT literal | ` CREATE TABLE IF NOT EXISTS env.sgu_well ( id integer PRIMARY KEY, geom geometry(Geometry, 3006) )`",
      "PROTECTED SQL_TEXT literal | ` CREATE TABLE IF NOT EXISTS core.property_unit ( id integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, source_key text UNIQUE, designation text, designation_norm text, municipality_code text, mun…",
      "UNRESOLVABLE SQL_TEXT literal | `DROP DATABASE IF EXISTS \"${targetDb}\"`",
      "UNRESOLVABLE SQL_CALL adminClient.query | adminClient.query(`DROP DATABASE IF EXISTS \"${targetDb}\"`)",
      "PROTECTED SQL_CALL dbClient.query | dbClient.query(table.ddl)",
      "PROTECTED SQL_CALL dbClient.query | dbClient.query(object.ddl)",
      "PROTECTED SQL_CALL verify.query | verify.query( 'INSERT INTO env.sgu_well (id, geom) VALUES (999999, ST_SetSRID(ST_MakePoint(0,0), 3006)) ' + 'ON CONFLICT (id) DO NOTHING', )",
      "PROTECTED SQL_TEXT literal | 'INSERT INTO env.sgu_well (id, geom) VALUES (999999, ST_SetSRID(ST_MakePoint(0,0), 3006)) ' + 'ON CONFLICT (id) DO NOTHING'",
      "PROTECTED SQL_TEXT literal | 'DELETE FROM env.sgu_well WHERE id = 999999'",
      "PROTECTED SQL_CALL verify.query | verify.query('DELETE FROM env.sgu_well WHERE id = 999999')",
      // U30F5 (B8): the provisioned role's privileges on the provisioned schemas -- the same disposable test database, after the same door
      "PROTECTED SQL_CALL dbClient.query | dbClient.query(`GRANT ALL ON SCHEMA ${schema} TO \"${targetRole}\"`)",
      "PROTECTED SQL_TEXT literal | `GRANT ALL ON SCHEMA ${schema} TO \"${targetRole}\"`",
      "PROTECTED SQL_CALL dbClient.query | dbClient.query(`GRANT ALL ON ALL TABLES IN SCHEMA ${schema} TO \"${targetRole}\"`)",
      "PROTECTED SQL_TEXT literal | `GRANT ALL ON ALL TABLES IN SCHEMA ${schema} TO \"${targetRole}\"`",
      "PROTECTED SQL_CALL dbClient.query | dbClient.query( `ALTER DEFAULT PRIVILEGES IN SCHEMA ${schema} GRANT ALL ON TABLES TO \"${targetRole}\"`, )",
      "PROTECTED SQL_TEXT literal | `ALTER DEFAULT PRIVILEGES IN SCHEMA ${schema} GRANT ALL ON TABLES TO \"${targetRole}\"`",
    ],
  },
  {
    file: "scripts/db/spatial-bootstrap.ts",
    policy: "SEPARATELY_GUARDED",
    markers: ["assertPendingFilesMayRun\\(pool, files, process\\.argv\\)"],
    justification:
      "U30F2 H2: applies prisma/spatial/*.sql (deploy release step). Every pending file is classified by the gate classifier first; one that writes a protected relation runs only with --init-new-database on a database that holds no protected relation, otherwise nothing is applied.",
    sites: [
      "DYNAMIC SQL_CALL client.query | client.query(file.contents)",
    ],
  },
  {
    file: "scripts/db/sync-property-unit-from-env.ts",
    policy: "SANCTIONED_REBUILD",
    markers: ["assertSanctionedDerivedRebuild\\("],
    relation: "core.property_unit",
    justification:
      "The sanctioned rebuild of the derived relation core.property_unit from env.registerenhetsomradesytor (protected-relations.v1.json sanctioned_rebuild names this file; assertSanctionedDerivedRebuild refuses any other caller). Its writes touch core.property_unit only (checked); --recreate runs prisma/spatial/004 (the core DDL).",
    sites: [
      "PROTECTED SQL_CALL pool.query | pool.query(ddl)",
      "PROTECTED SQL_TEXT literal | ` CREATE SCHEMA IF NOT EXISTS core; CREATE OR REPLACE FUNCTION core.normalize_designation(input text) RETURNS text LANGUAGE plpgsql IMMUTABLE AS $function$ BEGIN RETURN UPPER(REGEXP_REPLACE(UNACCENT(…",
      "PROTECTED SQL_CALL pool.query | pool.query(` CREATE SCHEMA IF NOT EXISTS core; CREATE OR REPLACE FUNCTION core.normalize_designation(input text) RETURNS text LANGUAGE plpgsql IMMUTABLE AS $function$ BEGIN RETURN UPPER(REGEXP_REPLAC…",
      "PROTECTED SQL_TEXT literal | ` INSERT INTO core.property_unit ( source_key, designation, designation_norm, municipality_code, municipality_name, county_code, source_dataset, source_updated_at, raw_properties, geom ) SELECT r.obj…",
      "PROTECTED SQL_TEXT literal | ` INSERT INTO core.property_unit ( source_key, designation, designation_norm, municipality_code, municipality_name, county_code, source_dataset, source_updated_at, raw_properties, geom ) SELECT ('mer…",
      "DYNAMIC SQL_CALL pool.query | pool.query(sql, [lan])",
      "PROTECTED SQL_TEXT literal | 'TRUNCATE core.property_unit RESTART IDENTITY;'",
      "PROTECTED SQL_CALL pool.query | pool.query('TRUNCATE core.property_unit RESTART IDENTITY;')",
      "PROTECTED SQL_TEXT literal | `DELETE FROM core.property_unit WHERE source_dataset = 'lm_fastighetsytor_merged';`",
      "PROTECTED SQL_CALL pool.query | pool.query(`DELETE FROM core.property_unit WHERE source_dataset = 'lm_fastighetsytor_merged';`)",
    ],
  },
  {
    file: "scripts/dev-helpers/automated-rebase-reverify.mjs",
    policy: "DYNAMIC_REVIEWED",
    contentSha256: "3cd412993e2b1c547856edd39e7f6e01b418cc2346e1f1c6d9f7499bd01a4ddd",
    reachability: "Reached from the Dev-Gov workflow .github/workflows/devgov-v0-rebase-reverify.yml (import()ed by its node step) and named by governance/devgov/units/automated-rebase-reverify-01-v1.json; runs git / gh / npm only.",
    reviewedOn: "2026-10-03",
    reviewedBy: "U30F8 W-U30F3 (Claude Opus 5.5): content pin (G6-2) -- the entry's review is the unit its justification names; the reachability field was added by U30F9 W-U30F9 (Claude Fable 5.1) from the justification and a repository grep (reachability-grep.json), without re-reading the file",
    justification:
      "Dev-Gov automated rebase re-verify: run(cmd, args) executes the git / gh / npm commands its own code paths choose.",
    sites: [
      "DYNAMIC PROCESS spawnSync | spawnSync(cmd, args, { encoding: 'utf8', timeout: DEFAULT_TIMEOUT_MS, maxBuffer: MAX_OUTPUT_BYTES, ...opts })",
      "DYNAMIC PROCESS spawnSync | spawnSync(cmd, args, { encoding: 'utf8', timeout: DEFAULT_TIMEOUT_MS, maxBuffer: MAX_OUTPUT_BYTES, ...opts })",
    ],
  },
  {
    file: "scripts/devgov/devgov.mjs",
    policy: "DYNAMIC_REVIEWED",
    contentSha256: "232125c4356105b5a3de2c037868f13078db559ff779d69024a66a9a4f726856",
    reachability: "Reached from the Dev-Gov workflows (.github/workflows/devgov-v0*.yml: attest, gate, orchestrate, rebase-reverify) and from npm devgov:* scripts; runs the proof commands of governance/devgov/units/*.json under the controller.",
    reviewedOn: "2026-10-03",
    reviewedBy: "U30F8 W-U30F3 (Claude Opus 5.5): content pin (G6-2) -- the entry's review is the unit its justification names; the reachability field was added by U30F9 W-U30F9 (Claude Fable 5.1) from the justification and a repository grep (reachability-grep.json), without re-reading the file",
    justification:
      "Dev-Gov runner: executes the proof commands a unit definition declares (commandSpec.command / args) under the Dev-Gov controller.",
    sites: [
      "DYNAMIC PROCESS spawnSync | spawnSync(commandSpec.command, commandSpec.args || [], { cwd, encoding: 'utf8', env: { ...process.env, ...(commandSpec.env || {}), ...(options.env || {}) }, timeout: commandSpec.timeout_ms || 120_000…",
    ],
  },
  {
    file: "scripts/hm1/run-proof-lane.mjs",
    policy: "DYNAMIC_REVIEWED",
    contentSha256: "91d927218a75e2319557e0d731bfae97dde64cdcebb85ba2485a99c9cb5b85b6",
    reachability: "Reached from CI (.github/workflows/ci.yml) for the HM1 proof lane; runs vitest on registered proof files, under TEST-DB-GUARD.",
    reviewedOn: "2026-10-03",
    reviewedBy: "U30F8 W-U30F3 (Claude Opus 5.5): content pin (G6-2) -- the entry's review is the unit its justification names; the reachability field was added by U30F9 W-U30F9 (Claude Fable 5.1) from the justification and a repository grep (reachability-grep.json), without re-reading the file",
    justification:
      "Runs vitest (node <vitest entrypoint> run --config vitest.config.ts --project <lane>) for a registered proof lane; the tests run under the TEST-DB-GUARD.",
    sites: [
      "DYNAMIC PROCESS spawnSync | spawnSync( process.execPath, [ vitestEntrypoint, \"run\", \"--config\", \"vitest.config.ts\", \"--project\", registry.lane.vitest_project, ...registry.required_proofs.map((proof) => proof.file), ], { cwd: ro…",
    ],
  },
  {
    file: "scripts/import-office-docs.ts",
    policy: "DYNAMIC_REVIEWED",
    contentSha256: "381c55fc1d514726489bf1936af7b3787bd4da8b3056d462b535bdfc21d83708",
    reachability: "Operator-run document importer (tsx scripts/import-office-docs.ts), noted in docs/architecture/RC2-WORKTREE-PARKING-RECORD.md; no npm script or CI step runs it; its PowerShell COM command is built in-file.",
    reviewedOn: "2026-10-03",
    reviewedBy: "U30F8 W-U30F3 (Claude Opus 5.5): content pin (G6-2) -- the entry's review is the unit its justification names; the reachability field was added by U30F9 W-U30F9 (Claude Fable 5.1) from the justification and a repository grep (reachability-grep.json), without re-reading the file",
    justification:
      "Runs a PowerShell COM command (cleanCommand, built in-file) to read Office documents; no database tool. U30F6 (F5-1): the same site now reads UNRESOLVABLE (a shell running a command that is a value), not DYNAMIC -- reclassified, not added.",
    sites: [
      "UNRESOLVABLE PROCESS execSync | execSync(`powershell -NoProfile -Command \"${cleanCommand}\"`, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 })",
    ],
  },
  {
    file: "scripts/import-topo10-only.ts",
    policy: "DYNAMIC_REVIEWED",
    contentSha256: "a257a51a3a434c314d7855ed39f0743af8a18a7d112cece204316c92bd8408eb",
    reachability: "Operator-run (tsx scripts/import-topo10-only.ts); named by the GovernedWriteCapability legacy-script list and the test-db-guard write-guard list; no npm script, CI step or runbook runs it (grep 2026-10-03).",
    reviewedOn: "2026-10-03",
    reviewedBy: "U30F9 W-U30F9 (Claude Fable 5.1)",
    justification:
      "U30F9 default-deny: spawnSync(OGR2OGR_PATH, args) with args = ['-f', 'PostgreSQL', pgConn, ..., '-nln', <topo10 item.table>, '-overwrite', '-lco', ...] where pgConn is built from DATABASE_URL: the connection is a value (NON_LITERAL); the targets are the static topo10.* items of the in-file list, none protected (topo10 is not a protected schema).",
    sites: [
      "UNRESOLVABLE PROCESS spawnSync | spawnSync(OGR2OGR_PATH, args, { encoding: 'utf8', stdio: 'inherit' })",
    ],
  },
  {
    file: "scripts/import/diagnose-system.ts",
    policy: "DYNAMIC_REVIEWED",
    contentSha256: "a069f4a812cba81796053f39375b91f7674c45df426ce662eef1be8f18e80266",
    reachability: "Operator-run diagnostics (tsx scripts/import/diagnose-system.ts); named by scripts/ci/assert-mimers-brunn-policy.ts and the test-db-guard write-guard list; its probes are in-file literals.",
    reviewedOn: "2026-10-03",
    reviewedBy: "U30F8 W-U30F3 (Claude Opus 5.5): content pin (G6-2) -- the entry's review is the unit its justification names; the reachability field was added by U30F9 W-U30F9 (Claude Fable 5.1) from the justification and a repository grep (reachability-grep.json), without re-reading the file",
    justification:
      "runCmd(cmd) helper for diagnostic probes (tool versions, disk, docker ps); its callers pass in-file literals, which the literal surface classifies where they are written.",
    sites: [
      "DYNAMIC PROCESS execSync | execSync(cmd, { encoding: 'utf8', timeout: 10000 })",
    ],
  },
  {
    file: "scripts/import/geo.spec.ts",
    policy: "DYNAMIC_REVIEWED",
    contentSha256: "b096b1c0ecc93416a3c24276fc75bc20681c3009512047f25586ff360d020023",
    reachability: "Run by no configured test runner (scripts/import is in no include glob) and by no npm script (grep 2026-10-03); a stale spec whose prisma is vi.mock()ed.",
    reviewedOn: "2026-10-03",
    reviewedBy: "U30F8 W-U30F3 (Claude Opus 5.5): content pin (G6-2) -- the entry's review is the unit its justification names; the reachability field was added by U30F9 W-U30F9 (Claude Fable 5.1) from the justification and a repository grep (reachability-grep.json), without re-reading the file",
    justification:
      "U30F3 M-2: a vitest spec that no configured runner includes (scripts/import is in no include glob), so it is scanned. It vi.mock()s server/db/prisma; `prisma.$queryRaw` is used as a mock handle (mockResolvedValue), never called against a database.",
    sites: [
      "DYNAMIC SQL_CALL $queryRaw | $queryRaw",
    ],
  },
  {
    file: "scripts/import/import-librarian-manifest.ts",
    policy: "GOVERNED",
    markers: ["retainOutgoingThenReplace\\(", "assertStagingImportOverwriteAllowed\\("],
    justification:
      "The governed Mimers Brunn import (import-staging / promote / bootstrap). It writes a NEW lm_staging relation (assertStagingImportOverwriteAllowed refuses an existing or retained one), loads it with ogr2ogr / raster2pgsql (docker), sets its SRID, and promotes only through retainOutgoingThenReplace (retention record, CAS claim, F4 precondition, first-import admission); the bootstrap CREATE TABLE AS runs only after assertFirstImportAdmitted. client.$executeRawUnsafe(sql, ...params) is the executor of statements built by SpatialDatasetRetention; client.$queryRawUnsafe<T[]>(sql, ...params) is its query port (seen since U30F3 M-2 reads calls with type arguments).",
    sites: [
      "DYNAMIC SQL_CALL client.$queryRawUnsafe | client.$queryRawUnsafe<T[]>(sql, ...params)",
      "DYNAMIC SQL_CALL client.$executeRawUnsafe | client.$executeRawUnsafe(sql, ...params)",
      "UNRESOLVABLE PROCESS spawnSync | spawnSync('docker', rasterArgs, { encoding: 'utf-8', maxBuffer: 1024 * 1024 * 50 })",
      "DYNAMIC SQL_CALL prisma.$executeRawUnsafe | prisma.$executeRawUnsafe(stmt + ';')",
      "UNRESOLVABLE PROCESS spawnSync | spawnSync(OGR2OGR_PATH, ogrArgs, { stdio: 'inherit', env: { ...process.env, PGOPTIONS: OGR2OGR_PGOPTIONS }, })",
      "UNRESOLVABLE SQL_CALL prisma.$executeRawUnsafe | prisma.$executeRawUnsafe( `SELECT UpdateGeometrySRID('${stagingSchema}', '${stagingTable}', 'geom', 3006);` )",
      "UNRESOLVABLE SQL_TEXT literal | `SELECT UpdateGeometrySRID('${stagingSchema}', '${stagingTable}', 'geom', 3006);`",
      "DYNAMIC SQL_CALL prisma.$executeRawUnsafe | prisma.$executeRawUnsafe(insertSql)",
      "UNRESOLVABLE SQL_CALL prisma.$executeRawUnsafe | prisma.$executeRawUnsafe( `CREATE TABLE ${target_schema}.${target_table} AS SELECT * FROM ${stagingSchema}.${stagingTable}`, )",
      "UNRESOLVABLE SQL_TEXT literal | `CREATE TABLE ${target_schema}.${target_table} AS SELECT * FROM ${stagingSchema}.${stagingTable}`",
    ],
  },
  {
    file: "scripts/import/import-lst-grusinv.ts",
    policy: "DYNAMIC_REVIEWED",
    contentSha256: "24e655838af80ffda0a116fd0de6f1c5cc2bc9e42355383d0a7a68e13003cc79",
    reachability: "Operator-run (tsx scripts/import/import-lst-grusinv.ts); named only by the GovernedWriteCapability legacy-script list; no npm script, CI step or runbook runs it (grep 2026-10-03).",
    reviewedOn: "2026-10-03",
    reviewedBy: "U30F9 W-U30F9 (Claude Fable 5.1)",
    justification:
      "U30F9 default-deny: spawn(OGR2OGR_PATH, pgArgs) with pgArgs = ['-f', 'PostgreSQL', pgConn, <gpkg>, '-nln', <static unprotected name>, '-overwrite', '-lco', 'SCHEMA=env', ...]: the connection (built from DATABASE_URL) and the source path are values (NON_LITERAL); the target env.<name> is static and not in the protected definition.",
    sites: [
      "UNRESOLVABLE PROCESS spawn | spawn(OGR2OGR_PATH, pgArgs, { stdio: 'inherit', shell: false })",
    ],
  },
  {
    file: "scripts/import/import-raa-building-ruins.ts",
    policy: "DYNAMIC_REVIEWED",
    contentSha256: "5aeb1045a55dbdb4d7dee03192490e0e94218ab4a8bb42bd06025d663b34b286",
    reachability: "Operator-run (tsx scripts/import/import-raa-building-ruins.ts); named only by the GovernedWriteCapability legacy-script list; no npm script, CI step or runbook runs it (grep 2026-10-03).",
    reviewedOn: "2026-10-03",
    reviewedBy: "U30F9 W-U30F9 (Claude Fable 5.1)",
    justification:
      "U30F9 default-deny: spawn(OGR2OGR_PATH, pgArgs) with a connection built from DATABASE_URL and a source path as values (NON_LITERAL); the target env.<static name> is not in the protected definition.",
    sites: [
      "UNRESOLVABLE PROCESS spawn | spawn(OGR2OGR_PATH, pgArgs, { stdio: 'inherit', shell: false })",
    ],
  },
  {
    file: "scripts/import/import-raster-outdb.ts",
    policy: "DYNAMIC_REVIEWED",
    contentSha256: "adc47d55221be2a9f020561f0cbefd994b11e37c6afa3de6d2d5bc14fe7bd779",
    reachability: "Operator raster import: run from scripts/import/run-full-raster-pipeline.ps1 and the root import-raster-data.ts; named in the GovernedWriteCapability legacy list; raster2pgsql | psql in docker exec against the local container.",
    reviewedOn: "2026-10-03",
    reviewedBy: "U30F8 W-U30F3 (Claude Opus 5.5): content pin (G6-2) -- the entry's review is the unit its justification names; the reachability field was added by U30F9 W-U30F9 (Claude Fable 5.1) from the justification and a repository grep (reachability-grep.json), without re-reading the file",
    justification:
      "Out-of-db raster import: raster2pgsql (docker exec) into tableRef from the in-file raster job list, piped into psql (stdin = the generated raster2pgsql SQL). Owner decision: gate the raster2pgsql argv (assertCommandWriteAllowed) once the raster targets are in the protected definition.",
    sites: [
      "UNRESOLVABLE PROCESS spawnSync | spawnSync( 'docker', ['exec', 'miljobeslut-postgres', 'raster2pgsql', '-R', createOrAppend, '-s', `${epsg}`, '-t', TILE_SIZE, containerPath, tableRef], { maxBuffer: 256 * 1024 * 1024, encoding: 'buff…",
      "UNRESOLVABLE PROCESS spawnSync | spawnSync('docker', ['exec', '-i', 'miljobeslut-postgres', 'psql', '-U', 'miljobeslut', '-d', 'miljobeslut'], { input: r2p.stdout, maxBuffer: 256 * 1024 * 1024, encoding: 'buffer', })",
    ],
  },
  {
    file: "scripts/import/import-sgu-risk-layers.ts",
    policy: "GATED_VIA",
    markers: ["gatedSql\\(GATE_CALLER, targetInsertSql\\)", "gatedSql\\(GATE_CALLER, `CREATE TABLE IF NOT EXISTS \\$\\{table\\.name\\}"],
    justification:
      "The two INSERT literals are the sql: of the SGU landslide and well layer configs, passed to genericImport as targetInsertSql; genericImport refuses the target first (assertUngovernedDestructiveWriteAllowed) and runs exactly that value through gatedSql(GATE_CALLER, targetInsertSql). Both targets are protected, so the gate refuses them at run time. Re-reviewed U30F3 H-1: the fail-open fold cap hid an ungated CREATE TABLE IF NOT EXISTS over envTables that held env.sgu_landslide_feature and env.sgu_well (empty protected stubs no admitted version backs); both entries are removed (versioned spatial DDL owns env/*) and the env CREATE goes through gatedSql (second marker), so it is gated, not listed here.",
    sites: [
      "PROTECTED SQL_TEXT literal | ` INSERT INTO env.sgu_landslide_feature (source_key, source_object_id, feature_code, feature_label, symbol, length_m, raw_properties, geom) SELECT source_key, source_object_id, feature_code, feature_…",
      "PROTECTED SQL_TEXT literal | ` INSERT INTO env.sgu_well (well_id, property_designation, capacity, depth, use_type, geom) SELECT well_id, property_designation, capacity, depth, use_type, ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON…",
    ],
  },
  {
    file: "scripts/import/import-smhi-huvudavrinningsomraden.ts",
    policy: "DYNAMIC_REVIEWED",
    contentSha256: "636410484707cb5cf0165a2d060d9ec5ec78dd7f74c15bc1926f3441e43022a5",
    reachability: "Operator-run (tsx scripts/import/import-smhi-huvudavrinningsomraden.ts); named only by the GovernedWriteCapability legacy-script list; no npm script, CI step or runbook runs it (grep 2026-10-03).",
    reviewedOn: "2026-10-03",
    reviewedBy: "U30F9 W-U30F9 (Claude Fable 5.1)",
    justification:
      "U30F9 default-deny: spawn(OGR2OGR_PATH, pgArgs) with a connection built from DATABASE_URL and a source path as values (NON_LITERAL); the target hydro.<static name> is not in the protected definition (hydro.water_catchment is; this is another relation).",
    sites: [
      "UNRESOLVABLE PROCESS spawn | spawn(OGR2OGR_PATH, pgArgs, { stdio: 'inherit', shell: false })",
    ],
  },
  {
    file: "scripts/import/importLibrarianQa.ts",
    policy: "GOVERNED",
    callers: ["scripts/import/import-librarian-manifest.ts"],
    justification:
      "QA helpers of the governed import, imported only by import-librarian-manifest.ts (checked): repairInvalidGeometries UPDATEs the NEW staging relation before QA, and buildPromoteInsertSql builds the promote INSERT that only retainOutgoingThenReplace executes (under the retention lock).",
    sites: [
      "UNRESOLVABLE SQL_CALL prisma.$executeRawUnsafe | prisma.$executeRawUnsafe( `UPDATE ${qualifiedStagingTable} SET geom = ST_MakeValid(geom) WHERE geom IS NOT NULL AND NOT ST_IsValid(geom)`, )",
      "UNRESOLVABLE SQL_TEXT literal | `UPDATE ${qualifiedStagingTable} SET geom = ST_MakeValid(geom) WHERE geom IS NOT NULL AND NOT ST_IsValid(geom)`",
      "UNRESOLVABLE SQL_TEXT literal | `INSERT INTO ${targetSchema}.${targetTable} (${quoted}) SELECT ${quoted} FROM ${stagingSchema}.${stagingTable}`",
    ],
  },
  {
    file: "scripts/import/prepare-ebh-gpkg.ts",
    policy: "DYNAMIC_REVIEWED",
    contentSha256: "58207ccf1e79b5ae22b7f3ac3e3e3578361bc8c0315cc1ae8035bb7737cd8cde",
    reachability: "Run by the orchestrator scripts/import/run-geodata-gap-pipeline.ts (runTsx) and by hand; its PowerShell commands are in-file literals (Expand-Archive).",
    reviewedOn: "2026-10-03",
    reviewedBy: "U30F8 W-U30F3 (Claude Opus 5.5): content pin (G6-2) -- the entry's review is the unit its justification names; the reachability field was added by U30F9 W-U30F9 (Claude Fable 5.1) from the justification and a repository grep (reachability-grep.json), without re-reading the file",
    justification:
      "runPowerShell(command) helper for Expand-Archive and file operations; its callers pass in-file literals, which the literal surface classifies where they are written.",
    sites: [
      "DYNAMIC PROCESS spawnSync | spawnSync('powershell', ['-NoProfile', '-Command', command], { encoding: 'utf8', stdio: 'pipe', })",
    ],
  },
  {
    file: "scripts/import/prepare-mcf-stability-national.ts",
    policy: "DYNAMIC_REVIEWED",
    contentSha256: "46437641d8a1b18445acf7b99a974702a550b7e79b80a38473c48efe272067a4",
    reachability: "Run by the orchestrator scripts/import/run-mcf-stability-librarian-pipeline.ts and by hand; its PowerShell commands are in-file literals (Expand-Archive).",
    reviewedOn: "2026-10-03",
    reviewedBy: "U30F8 W-U30F3 (Claude Opus 5.5): content pin (G6-2) -- the entry's review is the unit its justification names; the reachability field was added by U30F9 W-U30F9 (Claude Fable 5.1) from the justification and a repository grep (reachability-grep.json), without re-reading the file",
    justification:
      "runPowerShell(command) helper for Expand-Archive and file operations; its callers pass in-file literals, which the literal surface classifies where they are written.",
    sites: [
      "DYNAMIC PROCESS spawnSync | spawnSync('powershell', ['-NoProfile', '-Command', command], { encoding: 'utf8', stdio: 'pipe', timeout: ZIP_EXTRACT_TIMEOUT_MS, })",
    ],
  },
  {
    file: "scripts/import/prepare-mcf-stability-pilot.ts",
    policy: "DYNAMIC_REVIEWED",
    contentSha256: "0d11f02cd54dc9c132b606b982346e2f78d9ee4af7e911749929e4bec674d74a",
    reachability: "Operator-run pilot preparation (tsx scripts/import/prepare-mcf-stability-pilot.ts); no npm script, CI step or runbook names it (grep 2026-10-03).",
    reviewedOn: "2026-10-03",
    reviewedBy: "U30F8 W-U30F3 (Claude Opus 5.5): content pin (G6-2) -- the entry's review is the unit its justification names; the reachability field was added by U30F9 W-U30F9 (Claude Fable 5.1) from the justification and a repository grep (reachability-grep.json), without re-reading the file",
    justification:
      "runPowerShell(command) helper for Expand-Archive and file operations; its callers pass in-file literals, which the literal surface classifies where they are written.",
    sites: [
      "DYNAMIC PROCESS spawnSync | spawnSync('powershell', ['-NoProfile', '-Command', command], { encoding: 'utf8', stdio: 'pipe', })",
    ],
  },
  {
    file: "scripts/import/run-geodata-gap-pipeline.ts",
    policy: "DYNAMIC_REVIEWED",
    contentSha256: "8f47da429e8e207a4f13cbd3e969f529b04aeec7aeb340232bececfa069fd512",
    reachability: "Operator-run orchestrator (tsx scripts/import/run-geodata-gap-pipeline.ts); every step it runs is a static repository script that is scanned itself (listed in the justification).",
    reviewedOn: "2026-10-03",
    reviewedBy: "U30F8 W-U30F3 (Claude Opus 5.5): content pin (G6-2) -- the entry's review is the unit its justification names; the reachability field was added by U30F9 W-U30F9 (Claude Fable 5.1) from the justification and a repository grep (reachability-grep.json), without re-reading the file",
    justification:
      "Orchestrator: runs python -u <script> for the steps listed in-file (script is the step of that list); every step is a repository script that is scanned itself. U30F6 (F5-4): runTsx(label, script, extra) = node <cwd>/node_modules/tsx/dist/cli.mjs <script> -- the tsx CLI is package code (B3) and <script> is a parameter: every in-file call passes a static repository script (import-librarian-manifest, run-lm-stac-librarian-pipeline, run-mcf-stability-librarian-pipeline, harvest-viss-zip-to-master, harvest-smhi-svar-to-master, harvest-ebh-to-master, prepare-ebh-gpkg, harvest-msb-oversvamning-to-master, prepare-msb-oversvamning-gpkg, harvest-mcf-oversvamning-pdfs-to-master; all scripts/import/*.ts, each run by tsx as TypeScript and scanned itself).",
    sites: [
      "DYNAMIC PROCESS spawnSync | spawnSync('python', ['-u', script, arg], { stdio: 'inherit', cwd: process.cwd(), env: process.env, })",
      "DYNAMIC PROCESS spawnSync | spawnSync(process.execPath, [TSX_CLI, script, ...extra], { stdio: 'inherit', cwd: process.cwd(), env: process.env, })",
    ],
  },
  {
    file: "scripts/import/run-import-focus.ps1",
    policy: "DYNAMIC_REVIEWED",
    contentSha256: "e3b10f7162d9ffd8439cdd23e53b39aaaeaa15e80b5a8f83f5d6cdfa68211379",
    reachability: "Operator import pipeline (pwsh -File scripts/import/run-import-focus.ps1), named by scripts/ci/assert-mimers-brunn-policy.ts and run-import-session.ps1; every Run-Step command is an in-file literal naming a repository script.",
    reviewedOn: "2026-10-03",
    reviewedBy: "U30F8 W-U30F3 (Claude Opus 5.5): content pin (G6-2) -- the entry's review is the unit its justification names; the reachability field was added by U30F9 W-U30F9 (Claude Fable 5.1) from the justification and a repository grep (reachability-grep.json), without re-reading the file",
    justification:
      "Operator import pipeline: Run-Step runs the in-file step command strings with Invoke-Expression; every step is a repository script that is scanned itself (its import-n2k-gml step is retired and now fails by design).",
    sites: [
      "DYNAMIC PROCESS powershell | Invoke-Expression $Command *>&1",
    ],
  },
  {
    file: "scripts/import/run-import-session.ps1",
    policy: "DYNAMIC_REVIEWED",
    contentSha256: "59fe1d2bf9fe297d5f5137efce43bf4ef30428d29bb22eff7740d3253f6e490f",
    reachability: "Operator import session (pwsh -File), named by scripts/ci/assert-mimers-brunn-policy.ts and scripts/import/keep-awake.ps1; every Run-Step command is an in-file literal naming a repository script.",
    reviewedOn: "2026-10-03",
    reviewedBy: "U30F8 W-U30F3 (Claude Opus 5.5): content pin (G6-2) -- the entry's review is the unit its justification names; the reachability field was added by U30F9 W-U30F9 (Claude Fable 5.1) from the justification and a repository grep (reachability-grep.json), without re-reading the file",
    justification:
      "Operator import session: Run-Step runs the in-file step command strings with Invoke-Expression; every step is a repository script that is scanned itself (its import-n2k-gml step is retired and now fails by design).",
    sites: [
      "DYNAMIC PROCESS powershell | Invoke-Expression $command *>&1",
    ],
  },
  {
    file: "scripts/import/run-lm-stac-librarian-pipeline.ts",
    policy: "DYNAMIC_REVIEWED",
    contentSha256: "6ed816541f6514221961da4b058802738d272802c30afe7fed379d016103b08d",
    reachability: "Run by the orchestrators run-geodata-gap-pipeline.ts, run-national-reharvest.ts and scripts/import/run-full-raster-pipeline.ps1, and by hand; its three steps are static repository scripts.",
    reviewedOn: "2026-10-03",
    reviewedBy: "U30F8 W-U30F3 (Claude Opus 5.5): content pin (G6-2) -- the entry's review is the unit its justification names; the reachability field was added by U30F9 W-U30F9 (Claude Fable 5.1) from the justification and a repository grep (reachability-grep.json), without re-reading the file",
    justification:
      "U30F6 (F5-4): orchestrator run(label, args) = node <cwd>/node_modules/tsx/dist/cli.mjs ...args -- the tsx CLI is package code (B3); its three in-file calls pass static repository scripts first (scripts/import/merge-stac-national.ts, scripts/import/import-librarian-manifest.ts twice), each run by tsx as TypeScript and scanned itself.",
    sites: [
      "DYNAMIC PROCESS spawnSync | spawnSync(process.execPath, [TSX_CLI, ...args], { stdio: 'inherit', cwd: process.cwd(), env: process.env, shell: false, })",
    ],
  },
  {
    file: "scripts/import/run-mcf-stability-librarian-pipeline.ts",
    policy: "DYNAMIC_REVIEWED",
    contentSha256: "a20bda43bfa4cef40e35dfa2f03ed4ee4f76c8f869af590108c059b034a24100",
    reachability: "Run by the orchestrators run-geodata-gap-pipeline.ts and run-national-reharvest.ts, and by hand; its three steps are static repository scripts.",
    reviewedOn: "2026-10-03",
    reviewedBy: "U30F8 W-U30F3 (Claude Opus 5.5): content pin (G6-2) -- the entry's review is the unit its justification names; the reachability field was added by U30F9 W-U30F9 (Claude Fable 5.1) from the justification and a repository grep (reachability-grep.json), without re-reading the file",
    justification:
      "U30F6 (F5-4): orchestrator run(label, args) = node <cwd>/node_modules/tsx/dist/cli.mjs ...args -- the tsx CLI is package code (B3); its three in-file calls pass static repository scripts first (scripts/import/prepare-mcf-stability-national.ts, scripts/import/import-librarian-manifest.ts twice), each run by tsx as TypeScript and scanned itself.",
    sites: [
      "DYNAMIC PROCESS spawnSync | spawnSync(process.execPath, [TSX_CLI, ...args], { stdio: 'inherit', cwd: process.cwd(), env: process.env, })",
    ],
  },
  {
    file: "scripts/import/run-national-reharvest.ts",
    policy: "DYNAMIC_REVIEWED",
    contentSha256: "3674d9b5efaabada57974233c73bebeb73d954c1af0a035b27556b5321a424e6",
    reachability: "Operator-run national reharvest orchestrator (tsx scripts/import/run-national-reharvest.ts), named by scripts/import/bibbi/sguCatalog.ts; every step is a static repository script.",
    reviewedOn: "2026-10-03",
    reviewedBy: "U30F8 W-U30F3 (Claude Opus 5.5): content pin (G6-2) -- the entry's review is the unit its justification names; the reachability field was added by U30F9 W-U30F9 (Claude Fable 5.1) from the justification and a repository grep (reachability-grep.json), without re-reading the file",
    justification:
      "Orchestrator: runs python -u <script> for the steps listed in-file (script is the step of that list); every step is a repository script that is scanned itself. U30F6 (F5-4): runTsx(label, script, extra) = node <cwd>/node_modules/tsx/dist/cli.mjs <script> -- the tsx CLI is package code (B3) and <script> is a parameter: every in-file call passes a static repository script (harvest-sgu-to-master, harvest-polite-pipeline, harvest-naturvardsverket-geodata, harvest-msb-to-master, harvest-viss-zip-to-master, harvest-smhi-svar-to-master, harvest-ebh-to-master, harvest-msb-oversvamning-to-master, harvest-mcf-oversvamning-pdfs-to-master, run-mcf-stability-librarian-pipeline, run-lm-stac-librarian-pipeline, harvest-sks-geodata, harvest-sks-markfuktighet; all scripts/import/*.ts, each run by tsx as TypeScript and scanned itself).",
    sites: [
      "DYNAMIC PROCESS spawnSync | spawnSync('python', ['-u', script, arg], { stdio: 'inherit', cwd: process.cwd(), env: process.env, })",
      "DYNAMIC PROCESS spawnSync | spawnSync(process.execPath, [TSX_CLI, script, ...extra], { stdio: 'inherit', cwd: process.cwd(), env: process.env, })",
    ],
  },
  {
    file: "scripts/import/run-sgu-librarian-pipeline.ts",
    policy: "DYNAMIC_REVIEWED",
    contentSha256: "e18d4abbb321ab6d62041a02569385b9c21505072f2edf2c71217f2d9bb5cd65",
    reachability: "Operator-run SGU orchestrator (tsx scripts/import/run-sgu-librarian-pipeline.ts); no npm script or CI step runs it (grep 2026-10-03); every step is a static repository script.",
    reviewedOn: "2026-10-03",
    reviewedBy: "U30F8 W-U30F3 (Claude Opus 5.5): content pin (G6-2) -- the entry's review is the unit its justification names; the reachability field was added by U30F9 W-U30F9 (Claude Fable 5.1) from the justification and a repository grep (reachability-grep.json), without re-reading the file",
    justification:
      "Orchestrator: run(label, args) = npx tsx <args> for the steps listed in-file; every step is a repository script that is scanned itself.",
    sites: [
      "DYNAMIC PROCESS spawnSync | spawnSync('npx', ['tsx', ...args], { stdio: 'inherit', cwd: process.cwd(), env: process.env, shell: process.platform === 'win32', })",
    ],
  },
  {
    file: "scripts/import/run-sgu-quad-import.ts",
    policy: "DYNAMIC_REVIEWED",
    contentSha256: "264e4771ee14c06adff26e3fc2950644b1fe15588a60d9ae0f1c0d931b72eb48",
    reachability: "Operator-run SGU quad orchestrator (tsx scripts/import/run-sgu-quad-import.ts); no npm script or CI step runs it (grep 2026-10-03); every step is a static repository script.",
    reviewedOn: "2026-10-03",
    reviewedBy: "U30F8 W-U30F3 (Claude Opus 5.5): content pin (G6-2) -- the entry's review is the unit its justification names; the reachability field was added by U30F9 W-U30F9 (Claude Fable 5.1) from the justification and a repository grep (reachability-grep.json), without re-reading the file",
    justification:
      "Orchestrator: run(label, args) = npx tsx <args> for the steps listed in-file; every step is a repository script that is scanned itself.",
    sites: [
      "DYNAMIC PROCESS spawnSync | spawnSync('npx', ['tsx', ...args], { stdio: 'inherit', cwd: process.cwd(), env: process.env, shell: process.platform === 'win32', })",
    ],
  },
  {
    file: "scripts/import/run-sks-import.ts",
    policy: "DYNAMIC_REVIEWED",
    contentSha256: "02297042d12095650c90fc1b40d0c46a3047dc82b9b9cd351a34a9b3228173f1",
    reachability: "Operator-run SKS orchestrator (tsx scripts/import/run-sks-import.ts), named by the test-db-guard write-guard list; every step is a static repository script.",
    reviewedOn: "2026-10-03",
    reviewedBy: "U30F8 W-U30F3 (Claude Opus 5.5): content pin (G6-2) -- the entry's review is the unit its justification names; the reachability field was added by U30F9 W-U30F9 (Claude Fable 5.1) from the justification and a repository grep (reachability-grep.json), without re-reading the file",
    justification:
      "Orchestrator: run(label, args) = npx tsx <args> for the steps listed in-file; every step is a repository script that is scanned itself.",
    sites: [
      "DYNAMIC PROCESS spawnSync | spawnSync('npx', ['tsx', ...args], { stdio: 'inherit', cwd: process.cwd(), env: process.env, shell: process.platform === 'win32', })",
    ],
  },
  {
    file: "scripts/import/sync-sgu-tier1-to-drive.ps1",
    policy: "DYNAMIC_REVIEWED",
    contentSha256: "76fe695dae11a08d3eb9a6c932c55aa7b82bde3adb4eca023e7337031bb307a8",
    reachability: "Operator-run archive sync (pwsh -File); no npm script, CI step or runbook names it (grep 2026-10-03); rclone in docker, no DB.",
    reviewedOn: "2026-10-03",
    reviewedBy: "U30F8 W-U30F3 (Claude Opus 5.5): content pin (G6-2) -- the entry's review is the unit its justification names; the reachability field was added by U30F9 W-U30F9 (Claude Fable 5.1) from the justification and a repository grep (reachability-grep.json), without re-reading the file",
    justification:
      "Archive sync: docker run rclone/rclone with rclone arguments built in-file and passed as a splat (@args); a file-sync tool against the archive drive, no database.",
    sites: [
      "DYNAMIC PROCESS powershell | docker run --rm --dns 8.8.8.8 ` -v \"${rcloneConfig}:/config/rclone:ro\" ` @args ` rclone/rclone @args ` --config /config/rclone/rclone.conf",
    ],
  },
  {
    file: "scripts/import/test-harvest-sgu-jordart-norrland.ts",
    policy: "DYNAMIC_REVIEWED",
    contentSha256: "17048374dec9a3a5b965319447a46a9c90e0b1e94f4a5c7abe7f11fc3c8f422c",
    reachability: "Operator-run by hand (tsx scripts/import/test-harvest-sgu-jordart-norrland.ts); no npm script, CI step, runbook or other script names it (grep 2026-10-03).",
    reviewedOn: "2026-10-03",
    reviewedBy: "U30F9 W-U30F9 (Claude Fable 5.1)",
    justification:
      "U30F9 default-deny: a developer harvest test that runs ogr2ogr (OGR2OGR_PATH from the environment) into a local GPKG and ogrinfo -sql 'SELECT COUNT(*) ...' / -dialect SQLite -sql 'SELECT MIN(...)...' on that GPKG: the program paths come from the environment (NON_LITERAL); the SQL is static reads and the datasource a local file (no PG: datasource anywhere).",
    sites: [
      "UNRESOLVABLE PROCESS spawnSync | spawnSync( OGRINFO_PATH, ['-sql', 'SELECT COUNT(*) AS n FROM grundlager_test', OUT_GPKG], { encoding: 'utf-8' }, )",
      "UNRESOLVABLE PROCESS spawnSync | spawnSync( OGRINFO_PATH, [ '-dialect', 'SQLite', '-sql', 'SELECT MIN(ST_MinX(geom)), MAX(ST_MaxX(geom)), MIN(ST_MinY(geom)), MAX(ST_MaxY(geom)) FROM grundlager_test', OUT_GPKG, ], { encoding: 'utf-8'…",
    ],
  },
  {
    file: "scripts/import/utils/sguOapifHarvest.ts",
    policy: "DYNAMIC_REVIEWED",
    contentSha256: "88f763399790a908df55e6ed161228bf299adce6052ea7248cf95ce72607cbdb",
    reachability: "Imported by scripts/import/harvest-sgu-quad.ts and scripts/import/harvest-sgu-to-master.ts (the SGU harvests run by the SGU orchestrators and by hand).",
    reviewedOn: "2026-10-03",
    reviewedBy: "U30F9 W-U30F9 (Claude Fable 5.1)",
    justification:
      "U30F9 default-deny: the SGU OAPIF harvest utility runs ogr2ogr (OGR2OGR_PATH from the environment) into a local GPKG (-f GPKG: no database, no site) and ogrinfo -sql `SELECT COUNT(*) AS n FROM \"${layerName}\"` on that GPKG: the program path and the layer name are values (NON_LITERAL); the SQL is a read and the datasource a local file (no PG: datasource).",
    sites: [
      "UNRESOLVABLE PROCESS spawnSync | spawnSync( OGRINFO_PATH, ['-sql', `SELECT COUNT(*) AS n FROM \"${layerName}\"`, outputGpkg], { encoding: 'utf-8' }, )",
    ],
  },
  {
    file: "scripts/import/utils/sguZipHarvest.ts",
    policy: "DYNAMIC_REVIEWED",
    contentSha256: "eed2f56800b4973e131f546d07e955b9b323b501f9384f5bc50e325b62760268",
    reachability: "Imported by scripts/import/harvest-sgu-to-master.ts (the SGU harvest run by the SGU orchestrators and by hand).",
    reviewedOn: "2026-10-03",
    reviewedBy: "U30F9 W-U30F9 (Claude Fable 5.1)",
    justification:
      "U30F9 default-deny: the SGU zip harvest utility runs ogrinfo -sql `SELECT COUNT(*) AS n FROM \"${layer}\"` <gpkgPath> on a local GPKG: the program path (OGRINFO_PATH from the environment), the layer name and the path are values (NON_LITERAL); the SQL is a read and the datasource a local file (no PG: datasource); its ogrinfo -ro -so probe is read-only and no site.",
    sites: [
      "UNRESOLVABLE PROCESS spawnSync | spawnSync( OGRINFO_PATH, ['-sql', `SELECT COUNT(*) AS n FROM \"${layer}\"`, gpkgPath], { encoding: 'utf-8' }, )",
    ],
  },
  {
    file: "scripts/import_mark_sverige.ps1",
    policy: "DYNAMIC_REVIEWED",
    contentSha256: "ac44f73872d0488594e2766aeb630ace2b6ee3a3bf655b8c251e3e683fcd7423",
    reachability: "Operator-run by hand (pwsh -File scripts/import_mark_sverige.ps1); no npm script, CI step, runbook or other script names it (grep 2026-10-03).",
    reviewedOn: "2026-10-03",
    reviewedBy: "U30F9 W-U30F9 (Claude Fable 5.1)",
    justification:
      "U30F9 default-deny: & ogr2ogr -f PostgreSQL \"PG:host=localhost user=miljobeslut dbname=miljobeslut password=...\" \"$($geoFile.FullName)\" -nln $TABLE_NAME ... -overwrite: the source path and the table name are PowerShell values (NON_LITERAL; the -nln value is also OGR2OGR_WRITE unresolved). An operator script, unchanged here (U30F9 touches no ops script); the hard-coded local credentials are an ops hygiene note for the owner, not a U30 site.",
    sites: [
      "UNRESOLVABLE PROCESS powershell | & ogr2ogr -f \"PostgreSQL\" \"PG:host=localhost user=miljobeslut dbname=miljobeslut password=miljobeslut\" \"$($geoFile.FullName)\" -nln $TABLE_NAME -nlt GEOMETRY -overwrite -gt 131072 -lco GEOMETRY_NAME=g…",
    ],
  },
  {
    file: "scripts/ops/check-postgis-prerequisites.cjs",
    policy: "DYNAMIC_REVIEWED",
    contentSha256: "c8d4809f836e54df0e5632c3f0817db0aeefbfe7c7529ec7961b1c1158a5cfcf",
    reachability: "Operator check documented in docs/ops/postgis-prerequisites-checklist.md and the mimers-postgis-cold-start skill; node scripts/ops/check-postgis-prerequisites.cjs; its probes are in-file read-only literals.",
    reviewedOn: "2026-10-03",
    reviewedBy: "U30F8 W-U30F3 (Claude Opus 5.5): content pin (G6-2) -- the entry's review is the unit its justification names; the reachability field was added by U30F9 W-U30F9 (Claude Fable 5.1) from the justification and a repository grep (reachability-grep.json), without re-reading the file",
    justification:
      "sh(cmd) helper for read-only prerequisite probes (docker exec ... psql -Atc \"SELECT ...\"); its callers pass in-file literals, which the literal surface classifies where they are written.",
    sites: [
      "DYNAMIC PROCESS execSync | execSync(cmd, { encoding: \"utf8\", stdio: [\"ignore\", \"pipe\", \"pipe\"], windowsHide: true, maxBuffer: 16 * 1024 * 1024, })",
    ],
  },
  {
    file: "scripts/ops/restore-prod-db.ps1",
    policy: "DYNAMIC_REVIEWED",
    contentSha256: "346b1f50d9a22a3aa283e950a532536bd14bf0c1a79b9c80c73157666af09e7a",
    reachability: "Owner-run disaster-recovery restore documented in docs/ops/local-prod-fas1.md and scripts/ops/README.md (requires -Confirm); on no release, CI or product path.",
    reviewedOn: "2026-10-03",
    reviewedBy: "U30F8 W-U30F3 (Claude Opus 5.5): content pin (G6-2) -- the entry's review is the unit its justification names; the reachability field was added by U30F9 W-U30F9 (Claude Fable 5.1) from the justification and a repository grep (reachability-grep.json), without re-reading the file",
    justification:
      "Disaster-recovery restore of the local prod container from a pg_dump backup (owner-run, requires -Confirm): it replaces the whole database by design and is on no release path. Owner decision: keep as the DR tool or retire.",
    sites: [
      "UNRESOLVABLE PROCESS powershell | docker compose -f $ComposeFile exec -T db psql -U miljobeslut -d miljobeslut_prod -v ON_ERROR_STOP=1 -f -",
    ],
  },
  {
    file: "scripts/ops/retain-spatial-dataset-versions.ts",
    policy: "DYNAMIC_REVIEWED",
    contentSha256: "03d5f8bfd2a669788764ba5e8d6fa9431862db629ade895a7e51cf4c1a8ea6b4",
    reachability: "The retention CLI (tsx scripts/ops/retain-spatial-dataset-versions.ts): imported by scripts/import/import-librarian-manifest.ts (the governed import) and exercised by tests/unit/retainSpatialDatasetVersionsCli.test.ts; its port is query-only (execute refused) and --measure-digest is NOT PROPOSED (owner decision).",
    reviewedOn: "2026-10-03",
    reviewedBy: "U30F8 W-U30F3 (Claude Opus 5.5): content pin (G6-2) -- the entry's review is the unit its justification names; the reachability field was added by U30F9 W-U30F9 (Claude Fable 5.1) from the justification and a repository grep (reachability-grep.json), without re-reading the file",
    justification:
      "createReadOnlySqlPort: the retention CLI's query-only port (execute is refused); the statements it forwards are SpatialDatasetRetention's (gate implementation).",
    sites: [
      "DYNAMIC SQL_CALL pool.query | pool.query(sql, params as unknown[])",
    ],
  },
  {
    file: "scripts/ops/verify-prod.ps1",
    policy: "DYNAMIC_REVIEWED",
    contentSha256: "cd1c316e567b65ec81a9beaaf1db3b80fc3408babec01d83db49da5aebe1750c",
    reachability: "Operator verification run by scripts/ops/prod-daily.ps1 and documented in docs/ops/local-prod-fas1.md, dual-track-a.md and scripts/ops/README.md; its blocks are in-file script blocks.",
    reviewedOn: "2026-10-03",
    reviewedBy: "U30F8 W-U30F3 (Claude Opus 5.5): content pin (G6-2) -- the entry's review is the unit its justification names; the reachability field was added by U30F9 W-U30F9 (Claude Fable 5.1) from the justification and a repository grep (reachability-grep.json), without re-reading the file",
    justification:
      "Test-Step runs the in-file script blocks of the prod verification (& $Block).",
    sites: [
      "DYNAMIC PROCESS powershell | & $Block",
    ],
  },
  {
    file: "scripts/staging-setup.sh",
    policy: "DYNAMIC_REVIEWED",
    contentSha256: "7280dee9cd6fa00b44fe4aa96644f4182a6d034d13b2ca49f1ee4482e90da908",
    reachability: "Operator-run staging setup (bash scripts/staging-setup.sh); no npm script, CI step or runbook names it (grep 2026-10-03); the expansion loads .env.staging assignments.",
    reviewedOn: "2026-10-03",
    reviewedBy: "U30F8 W-U30F3 (Claude Opus 5.5): content pin (G6-2) -- the entry's review is the unit its justification names; the reachability field was added by U30F9 W-U30F9 (Claude Fable 5.1) from the justification and a repository grep (reachability-grep.json), without re-reading the file",
    justification:
      "export $(cat .env.staging | xargs): loads the staging environment variables; the expansion is assignments, not a program.",
    sites: [
      "DYNAMIC PROCESS sh | export $(cat .env.staging | xargs)",
    ],
  },
  {
    file: "server/services/nmdService.ts",
    policy: "DYNAMIC_REVIEWED",
    contentSha256: "0f974d094697d41dc86c7a1692fb2f3abb902429b1ff8986ea2a0c249b71c208",
    reachability: "Product server code: imported by server/services/markCoverService.ts and sguJordartRasterService.ts (the LU evidence services); spawns gdallocationinfo read-only against a raster file; no DB tool.",
    reviewedOn: "2026-10-03",
    reviewedBy: "U30F8 W-U30F3 (Claude Opus 5.5): content pin (G6-2) -- the entry's review is the unit its justification names; the reachability field was added by U30F9 W-U30F9 (Claude Fable 5.1) from the justification and a repository grep (reachability-grep.json), without re-reading the file",
    justification:
      "Runs gdallocationinfo (tool path resolved at run time) to read one NMD raster value at a point; read-only, no database.",
    sites: [
      "DYNAMIC PROCESS spawn | spawn(tool, ['-valonly', '-l_srs', 'EPSG:4326', NMD_RASTER_PATH, String(lng), String(lat)])",
    ],
  },
  {
    file: "server/services/sguJordartRasterService.ts",
    policy: "DYNAMIC_REVIEWED",
    contentSha256: "cd6bb56c48a4e704863fbe0905a333717d39950aefc8eb3dc00c6e9cd45723a0",
    reachability: "Product server code (LU soil evidence), tested by tests/unit/sguJordartRasterService.test.ts; spawns gdallocationinfo read-only against a raster file; no DB tool.",
    reviewedOn: "2026-10-03",
    reviewedBy: "U30F8 W-U30F3 (Claude Opus 5.5): content pin (G6-2) -- the entry's review is the unit its justification names; the reachability field was added by U30F9 W-U30F9 (Claude Fable 5.1) from the justification and a repository grep (reachability-grep.json), without re-reading the file",
    justification:
      "Runs gdallocationinfo (tool path resolved at run time) to read one SGU soil raster value at a point; read-only, no database.",
    sites: [
      "DYNAMIC PROCESS spawn | spawn(tool, ['-valonly', '-l_srs', 'EPSG:4326', rasterPath, String(lng), String(lat)])",
    ],
  },
  {
    file: "src/infrastructure/geo/static-map-generator.ts",
    policy: "DYNAMIC_REVIEWED",
    contentSha256: "dc7d5bb05af6b14e9bc9f39a03f8e4db8a6302d676990dc7fe0673a3b9e18c8a",
    reachability: "Product code imported by server/services/sewagePdfService.ts (the PDF report) and tested by tests/unit/sewagePdfService.test.ts; its only sites are SVG template literals past the fold cap; its DB channels are $queryRaw SELECT tagged templates.",
    reviewedOn: "2026-10-03",
    reviewedBy: "U30F8 W-U30F3 (Claude Opus 5.5): content pin (G6-2) -- the entry's review is the unit its justification names; the reachability field was added by U30F9 W-U30F9 (Claude Fable 5.1) from the justification and a repository grep (reachability-grep.json), without re-reading the file",
    justification:
      "U30F3 H-1 (the fold cap now fails closed): two SVG markup template literals (a layer <g> element and the <svg> document) whose interpolations (layer styles, width, height) have more combinations than the scan enumerates (FOLD_CAP_EXCEEDED). They are markup, not SQL or a command; the file's database channels are $queryRaw SELECT tagged templates (bind parameters, judged statically ALLOWED) and it has no process channel.",
    sites: [
      "UNRESOLVABLE SQL_TEXT literal | ` <g id=\"layer-${layer.layerName}\" fill=\"${layer.color}\" fill-opacity=\"${layer.fillOpacity}\" stroke=\"${layer.strokeColor}\" stroke-width=\"${layer.strokeWidth}\">\\n`",
      "UNRESOLVABLE SQL_TEXT literal | `<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"no\"?> <svg width=\"${width}\" height=\"${height}\" viewBox=\"0 0 ${width} ${height}\" xmlns=\"http://www.w3.org/2000/svg\"> <!-- Bakgrund --> <rect width=\"10…",
    ],
  },
  {
    file: "tests/fixtures/postgis/registerenhets-seed.sql",
    policy: "TEST_HARNESS",
    justification:
      "U30F3 M-2 (a test tree no longer exempts a file): a reference seed (INSERT into env.registerenhetsomradesytor) whose header says tests/setup/database.ts applies it; no code file reads or names it any more (checked: nothing outside the test trees reaches it) -- an orphaned fixture, run by nothing; a hand-run psql -f of it is not an operator path.",
    sites: [
      "PROTECTED SQL_FILE sql file | (whole file)",
    ],
  },
  {
    file: "tests/helpers/postgisSeed.ts",
    policy: "TEST_HARNESS",
    justification:
      "U30F3 M-2: integration-test seed helpers ($executeRaw INSERTs into core.property_unit, env.protected_area, env.sgu_well, env.sgu_soil_type_25k_100k) on the PrismaClient a test hands them; imported only from tests/integration (checked recursively), where the vitest connection guard (TEST-DB-GUARD) holds every client to the disposable test database.",
    sites: [
      "PROTECTED SQL_TEXT literal | ` INSERT INTO core.property_unit ( source_key, designation, designation_norm, municipality_name, source_dataset, geom ) VALUES ( ${params.sourceKey}, ${params.designation}, core.normalize_designation…",
      "PROTECTED SQL_CALL $executeRaw | $executeRaw` INSERT INTO core.property_unit ( source_key, designation, designation_norm, municipality_name, source_dataset, geom ) VALUES ( ${params.sourceKey}, ${params.designation}, core.normalize_…",
      "PROTECTED SQL_TEXT literal | ` INSERT INTO env.protected_area (nvr_id, name, protection_type, geom) VALUES ( ${params.nvrId}, ${params.name}, ${params.protectionType}, ST_Multi(ST_Transform( ST_SetSRID(ST_GeomFromText('POLYGON((…",
      "PROTECTED SQL_CALL $executeRaw | $executeRaw` INSERT INTO env.protected_area (nvr_id, name, protection_type, geom) VALUES ( ${params.nvrId}, ${params.name}, ${params.protectionType}, ST_Multi(ST_Transform( ST_SetSRID(ST_GeomFromText…",
      "PROTECTED SQL_TEXT literal | ` INSERT INTO env.sgu_well (geom) VALUES (ST_Transform(ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326), 3006)); `",
      "PROTECTED SQL_CALL $executeRaw | $executeRaw` INSERT INTO env.sgu_well (geom) VALUES (ST_Transform(ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326), 3006)); `",
      "PROTECTED SQL_TEXT literal | ` INSERT INTO env.sgu_soil_type_25k_100k (id, jordart, jg2_tx, jy1, jy1_tx, karttyp, geom) VALUES ( ${id}, 'Morän', 'Medel permeabilitet', ${jy1}, ${jy1Tx}, ${karttyp}, ST_Multi(ST_Transform( ST_SetS…",
      "PROTECTED SQL_CALL $executeRaw | $executeRaw` INSERT INTO env.sgu_soil_type_25k_100k (id, jordart, jg2_tx, jy1, jy1_tx, karttyp, geom) VALUES ( ${id}, 'Morän', 'Medel permeabilitet', ${jy1}, ${jy1Tx}, ${karttyp}, ST_Multi(ST_Transfo…",
    ],
  },
  {
    file: "tests/setup/database.ts",
    policy: "TEST_DB_GUARD",
    markers: ["admitDisposableGisTestDatabase"],
    justification:
      "U30F3 M-2: the vitest integration globalSetup (vitest.config.ts globalSetup): it installs the TEST-DB-GUARD connection guard and admits its target with admitDisposableGisTestDatabase before it drops the public tables and the env/core/climate/lm_staging/hydro schemas of the disposable test database and truncates its Prisma tables (TEST-DB-GUARD lane W-TDG).",
    sites: [
      "UNRESOLVABLE SQL_TEXT literal | `DROP TABLE IF EXISTS \"public\".\"${row.tablename}\" CASCADE`",
      "UNRESOLVABLE SQL_CALL preClient.query | preClient.query(`DROP TABLE IF EXISTS \"public\".\"${row.tablename}\" CASCADE`)",
      "PROTECTED SQL_TEXT literal | 'DROP SCHEMA IF EXISTS \"env\" CASCADE'",
      "PROTECTED SQL_CALL preClient.query | preClient.query('DROP SCHEMA IF EXISTS \"env\" CASCADE')",
      "PROTECTED SQL_TEXT literal | 'DROP SCHEMA IF EXISTS \"core\" CASCADE'",
      "PROTECTED SQL_CALL preClient.query | preClient.query('DROP SCHEMA IF EXISTS \"core\" CASCADE')",
      "PROTECTED SQL_TEXT literal | 'DROP SCHEMA IF EXISTS \"climate\" CASCADE'",
      "PROTECTED SQL_CALL preClient.query | preClient.query('DROP SCHEMA IF EXISTS \"climate\" CASCADE')",
      "PROTECTED SQL_TEXT literal | 'DROP SCHEMA IF EXISTS \"lm_staging\" CASCADE'",
      "PROTECTED SQL_CALL preClient.query | preClient.query('DROP SCHEMA IF EXISTS \"lm_staging\" CASCADE')",
      "PROTECTED SQL_TEXT literal | 'DROP SCHEMA IF EXISTS \"hydro\" CASCADE'",
      "PROTECTED SQL_CALL preClient.query | preClient.query('DROP SCHEMA IF EXISTS \"hydro\" CASCADE')",
      "UNRESOLVABLE SQL_TEXT literal | `TRUNCATE TABLE ${tablesToTruncate .map((name) => `\"public\".\"${name}\"`) .join(', ')} RESTART IDENTITY CASCADE;`",
      "UNRESOLVABLE SQL_CALL prisma.$executeRawUnsafe | prisma.$executeRawUnsafe(truncateQuery)",
      // U30F5 (D-7): CASCADE drops of the admitted disposable test database, after the same admitDisposableGisTestDatabase door
      "UNRESOLVABLE SQL_TEXT literal | 'DROP SCHEMA IF EXISTS \"topo10\" CASCADE'",
      "UNRESOLVABLE SQL_CALL preClient.query | preClient.query('DROP SCHEMA IF EXISTS \"topo10\" CASCADE')",
      "UNRESOLVABLE SQL_TEXT literal | `DROP TYPE IF EXISTS \"public\".\"${row.typname}\" CASCADE`",
      "UNRESOLVABLE SQL_CALL preClient.query | preClient.query(`DROP TYPE IF EXISTS \"public\".\"${row.typname}\" CASCADE`)",
    ],
  },
  {
    file: "tests/setup/seedGisStubs.ts",
    policy: "TEST_DB_GUARD",
    markers: ["admitDisposableGisTestDatabase"],
    callers: ["scripts/db/seed-gis-for-e2e.ts", "tests/setup/database.ts"],
    justification:
      "U30F3 M-2: the GIS test stubs (DROP/CREATE of the env/core stub tables, core.normalize_designation) applied only after admitDisposableGisTestDatabase admits the disposable test database; its only importers are tests/setup/database.ts and scripts/db/seed-gis-for-e2e.ts (npm db:test:seed:gis with .env.test), both checked.",
    sites: [
      "PROTECTED SQL_TEXT literal | ` DROP TABLE IF EXISTS env.registerenhetsomradesytor CASCADE; DROP TABLE IF EXISTS env.registerenhetsomradeslinjer CASCADE; DROP TABLE IF EXISTS env.protected_area CASCADE; DROP TABLE IF EXISTS env.n…",
      "PROTECTED SQL_CALL client.query | client.query(` DROP TABLE IF EXISTS env.registerenhetsomradesytor CASCADE; DROP TABLE IF EXISTS env.registerenhetsomradeslinjer CASCADE; DROP TABLE IF EXISTS env.protected_area CASCADE; DROP TABLE IF…",
      "PROTECTED SQL_TEXT literal | ` CREATE OR REPLACE FUNCTION core.normalize_designation(input_text text) RETURNS text AS $$ BEGIN -- Convert to uppercase, unaccent, and replace non-alphanumeric with spaces RETURN trim(regexp_replac…",
      "PROTECTED SQL_CALL client.query | client.query(` CREATE OR REPLACE FUNCTION core.normalize_designation(input_text text) RETURNS text AS $$ BEGIN -- Convert to uppercase, unaccent, and replace non-alphanumeric with spaces RETURN trim(…",
    ],
  },
];

// =============================================================================================
// U30F6 (F5-3): launches that resolve to no repository file -- each reviewed, never dropped silently
// =============================================================================================

export type UnresolvedLaunchCategory = "INSTALLED_MODULE" | "CONTROLLER_CHECKOUT" | "MISSING_FILE" | "HOST_PATH" | "CONTAINER_PATH" | "NOT_A_LAUNCH";

/** Why a launch of each category runs no repository file the scan has not read (the reachability argument). */
export const UNRESOLVED_LAUNCH_CATEGORIES: Readonly<Record<UnresolvedLaunchCategory, string>> = {
  INSTALLED_MODULE:
    "python -m of a module no repository file provides (pytest, unittest, a module of a separate checkout), or a package a node runtime preloads (--import/-r <specifier>, never a repository path): the code that runs is an installed package's or another checkout's, not this repository's (unknown package code is BLOCKERARE B3, so each such entry names the package and why it is the expected one). A repository module of that name would resolve a python -m launch (a.b -> a/b.py or a/b/__main__.py) and be scanned, and the entry would go stale.",
  CONTROLLER_CHECKOUT:
    "Dev-Gov workflows run the PROTECTED CONTROLLER's checkout (actions/checkout path: controller) of this same repository: controller/<p> is the repository file <p> at the controller revision, which exists here and is scanned at <p> as its own language (.mjs run by node). Nothing else lives under controller/.",
  MISSING_FILE:
    "A repository path that no tracked file has (git ls-files: 0 matches, also under another directory): the line runs nothing of the repository -- it fails with file-not-found. Adding the file resolves the launch, which then scans it as run, and makes this entry stale (the test fails until the entry is removed).",
  HOST_PATH:
    "A path outside the repository -- an absolute host, temp or other-checkout path, a gitignored local file (.env*, .venv) or a tool installed on the host (aria2c, the Cloud SDK, a downloaded installer): what runs there is host content, not repository content (host tools and downloads are BLOCKERARE B3/B6). The repository's own file of the same name, where one exists, is scanned at its own path.",
  CONTAINER_PATH:
    "A path inside a container image that a package of the base image provides (no COPY of a repository file to it in the Dockerfile): the image's code, not repository content.",
  NOT_A_LAUNCH:
    "Runbook text the line reader takes for a launch but that runs nothing: a psql meta command (\\copy), an IAM role name on a continuation line, a directory listing.",
};

/**
 * `by` is the launcher (a scanned file or a runbook), `runs` what it runs as written (a path, `python -m <module>`, or
 * `<dynamic directory>/<static tail>`). A launch that resolves to no repository file and is not listed here fails the
 * inventory; an entry no launch answers any more (the file was added, the line removed) is stale and fails too.
 */
export const UNRESOLVED_LAUNCHES: readonly { readonly by: string; readonly runs: string; readonly category: UnresolvedLaunchCategory; readonly justification: string }[] = [
  // ---- CONTROLLER_CHECKOUT (7): the protected controller checkout of scripts/devgov/*.mjs ----
  { by: ".github/workflows/devgov-invariant-packs.yml", runs: "controller/scripts/devgov/invariant-packs.mjs", category: "CONTROLLER_CHECKOUT", justification: "scripts/devgov/invariant-packs.mjs at the controller revision; scanned at scripts/devgov/invariant-packs.mjs (js)." },
  { by: ".github/workflows/devgov-v0-gate.yml", runs: "controller/scripts/devgov/invariant-packs.mjs", category: "CONTROLLER_CHECKOUT", justification: "scripts/devgov/invariant-packs.mjs at the controller revision (checkout path: controller); scanned at its own path (js)." },
  { by: ".github/workflows/devgov-v0-gate.yml", runs: "controller/scripts/devgov/devgov.mjs", category: "CONTROLLER_CHECKOUT", justification: "scripts/devgov/devgov.mjs at the controller revision; scanned at its own path (js)." },
  { by: ".github/workflows/devgov-v0-orchestrate.yml", runs: "controller/scripts/devgov/invariant-packs.mjs", category: "CONTROLLER_CHECKOUT", justification: "scripts/devgov/invariant-packs.mjs at the controller revision; scanned at its own path (js)." },
  { by: ".github/workflows/devgov-v0-orchestrate.yml", runs: "controller/scripts/devgov/devgov.mjs", category: "CONTROLLER_CHECKOUT", justification: "scripts/devgov/devgov.mjs at the controller revision; scanned at its own path (js)." },
  { by: ".github/workflows/devgov-v0-rebase-reverify.yml", runs: "controller/scripts/devgov/invariant-packs.mjs", category: "CONTROLLER_CHECKOUT", justification: "scripts/devgov/invariant-packs.mjs at the controller revision; scanned at its own path (js)." },
  { by: ".github/workflows/devgov-v0-rebase-reverify.yml", runs: "controller/scripts/devgov/devgov.mjs", category: "CONTROLLER_CHECKOUT", justification: "scripts/devgov/devgov.mjs at the controller revision; scanned at its own path (js)." },
  // U30F8 (mutation round 1: commands inside $(...) are read now) -- the attest workflow's two command substitutions
  { by: ".github/workflows/devgov-v0-attest.yml", runs: "controller/scripts/devgov/devgov.mjs", category: "CONTROLLER_CHECKOUT", justification: "result=\"$(node controller/scripts/devgov/devgov.mjs resolve-execution-sha ...)\": scripts/devgov/devgov.mjs at the controller revision (checkout path: controller); scanned at its own path (js)." },
  { by: ".github/workflows/devgov-v0-attest.yml", runs: "controller/scripts/devgov/verify-execution-root.mjs", category: "CONTROLLER_CHECKOUT", justification: "execution_root=\"$(node controller/scripts/devgov/verify-execution-root.mjs ...)\": scripts/devgov/verify-execution-root.mjs at the controller revision; scanned at its own path (js)." },
  // ---- INSTALLED_MODULE (9): installed test runners and a separate checkout's modules ----
  // W-NO-GOOGLE-01 (2026-10-06): withdrew
  //   .github/workflows/release-prompt-optimizer.yml -> python -m pytest
  //   .github/workflows/vertex_prompt_optimize.yml -> python -m pytest
  // Those launcher files were deleted. An active pin of a launch no file answers is stale.
  // The previous entries remain in git history through 1b0e3db5.
  { by: "scripts/ci_update_and_smoke_test.sh", runs: "python -m pytest", category: "INSTALLED_MODULE", justification: "pytest from the gitignored alphaevolve-on-googlecloud/.venv, on that separate checkout's tests (.gitignore: alphaevolve-on-googlecloud/)." },
  { by: "docs/alphaevolve/EXPERIMENTS.md", runs: "python -m examples.circle_packing.src.run_evolution", category: "INSTALLED_MODULE", justification: "a module of the separate, gitignored alphaevolve-on-googlecloud checkout (the runbook's working directory), not of this repository." },
  { by: "docs/alphaevolve/EXPERIMENTS.md", runs: "python -m examples.list_deduplication.src.run_evolution", category: "INSTALLED_MODULE", justification: "a module of the separate, gitignored alphaevolve-on-googlecloud checkout, not of this repository." },
  { by: "docs/alphaevolve/SETUP.md", runs: "python -m pytest", category: "INSTALLED_MODULE", justification: "pytest from the alphaevolve-on-googlecloud .venv on that checkout's tests." },
  { by: "docs/alphaevolve/SETUP.md", runs: "python -m examples.circle_packing.src.run_evolution", category: "INSTALLED_MODULE", justification: "a module of the separate, gitignored alphaevolve-on-googlecloud checkout." },
  { by: "docs/alphaevolve/SETUP.md", runs: "python -m examples.list_deduplication.src.run_evolution", category: "INSTALLED_MODULE", justification: "a module of the separate, gitignored alphaevolve-on-googlecloud checkout." },
  { by: "docs/architecture/QGIS-PLUGIN-FOUNDATION-01.md", runs: "python -m unittest", category: "INSTALLED_MODULE", justification: "the standard library's unittest discovering integrations/qgis/mimer_read_model/tests, Python files scanned at their own paths." },
  { by: "integrations/qgis/mimer_read_model/README.md", runs: "python -m unittest", category: "INSTALLED_MODULE", justification: "the standard library's unittest on integrations/qgis/mimer_read_model/tests (scanned at their own paths)." },
  { by: "prompt_optimizer/README.md", runs: "python -m unittest", category: "INSTALLED_MODULE", justification: "the standard library's unittest on prompt_optimizer/tests (scanned at their own paths)." },
  // ---- INSTALLED_MODULE, package preloads (8): node --import tsx ----
  { by: "package.json", runs: "preload tsx", category: "INSTALLED_MODULE", justification: "tsx, the TypeScript loader (package.json devDependencies tsx ^4.16.2, pinned in package-lock.json): it compiles the TypeScript it loads and runs nothing else; the scripts start/dev:server/worker:* load server/index.ts and server/workers/*.ts, repository files scanned themselves." },
  { by: "Dockerfile.fly", runs: "preload tsx", category: "INSTALLED_MODULE", justification: "tsx, the TypeScript loader (package.json devDependencies tsx ^4.16.2, pinned in package-lock.json): it compiles the TypeScript it loads and runs nothing else (npm install --no-save tsx@4 in the image); CMD loads server/index.ts, scanned itself." },
  { by: "deploy/onprem/image-smoke/smoke.mjs", runs: "preload tsx", category: "INSTALLED_MODULE", justification: "tsx, the TypeScript loader (package.json devDependencies tsx ^4.16.2, pinned in package-lock.json): it compiles the TypeScript it loads and runs nothing else; the image smoke loads its link-only-register.mjs (resolved, scanned) and the five entrypoints link-only (S3)." },
  { by: "packages/mps-data-governance/tests/P2Auth01SyntheticLegalCorpus.red.historical.ts", runs: "preload tsx", category: "INSTALLED_MODULE", justification: "tsx, the TypeScript loader (package.json devDependencies tsx ^4.16.2, pinned in package-lock.json): it compiles the TypeScript it loads and runs nothing else; the script it would load is the missing legal-corpus-harvest.ts (MISSING_FILE below)." },
  { by: "scripts/backfill/verify-outlook-integrity.ts", runs: "preload tsx", category: "INSTALLED_MODULE", justification: "tsx, the TypeScript loader (package.json devDependencies tsx ^4.16.2, pinned in package-lock.json): it compiles the TypeScript it loads and runs nothing else; it loads scripts/backfill/run-outlook-ingest-pipeline.ts (resolved by its static tail, scanned itself)." },
  { by: "server/modules/localization/luExecutionIdentityV3Provisioning.ts", runs: "preload tsx", category: "INSTALLED_MODULE", justification: "tsx, the TypeScript loader (package.json devDependencies tsx ^4.16.2, pinned in package-lock.json): it compiles the TypeScript it loads and runs nothing else; it loads ./luExecutionIdentityV3VerifyCli.ts (resolved beside the launcher, scanned itself)." },
  { by: "server/modules/localization/luProjectContextBootstrap.ts", runs: "preload tsx", category: "INSTALLED_MODULE", justification: "tsx, the TypeScript loader (package.json devDependencies tsx ^4.16.2, pinned in package-lock.json): it compiles the TypeScript it loads and runs nothing else; it loads ./luProjectContextBootstrapVerifyCli.ts (resolved beside the launcher, scanned itself)." },
  { by: "server/modules/localization/luViewerCapabilityProvisioning.ts", runs: "preload tsx", category: "INSTALLED_MODULE", justification: "tsx, the TypeScript loader (package.json devDependencies tsx ^4.16.2, pinned in package-lock.json): it compiles the TypeScript it loads and runs nothing else; it loads ./luViewerCapabilityVerifyCli.ts (resolved beside the launcher, scanned itself)." },
  // ---- MISSING_FILE: stale script lines and runbook lines -- no tracked file of that name anywhere ----
  // W-NO-GOOGLE-01B (2026-10-06): historical docs still name the deleted GCP provisioning/auth/secret scripts.
  // The executable files are gone. These entries record that the remaining lines do not launch a repository file.
  { by: "deploy/gcp/README.md", runs: "scripts/gcp/audit-secrets.ps1", category: "MISSING_FILE", justification: "W-NO-GOOGLE-01B deleted scripts/gcp/audit-secrets.ps1. deploy/gcp/README.md remains historical text and does not launch a repository file." },
  { by: "deploy/gcp/README.md", runs: "scripts/gcp/sync-secrets-from-env.ps1", category: "MISSING_FILE", justification: "W-NO-GOOGLE-01B deleted scripts/gcp/sync-secrets-from-env.ps1. deploy/gcp/README.md remains historical text and does not launch a repository file." },
  { by: "docs/alphaevolve/EXPERIMENTS.md", runs: "scripts/alphaevolve/verify-gcp.ps1", category: "MISSING_FILE", justification: "W-NO-GOOGLE-01B deleted scripts/alphaevolve/verify-gcp.ps1. The experiment note remains historical text and does not launch a repository file." },
  { by: "docs/alphaevolve/EXPERIMENTS.md", runs: "scripts/alphaevolve/provision-gcp.sh", category: "MISSING_FILE", justification: "W-NO-GOOGLE-01B deleted scripts/alphaevolve/provision-gcp.sh. The experiment note remains historical text and does not launch a repository file." },
  { by: "docs/alphaevolve/SETUP.md", runs: "scripts/alphaevolve/verify-gcp.ps1", category: "MISSING_FILE", justification: "W-NO-GOOGLE-01B deleted scripts/alphaevolve/verify-gcp.ps1. docs/alphaevolve/SETUP.md remains historical text and does not launch a repository file." },
  { by: "docs/alphaevolve/SETUP.md", runs: "scripts/alphaevolve/provision-gcp.sh", category: "MISSING_FILE", justification: "W-NO-GOOGLE-01B deleted scripts/alphaevolve/provision-gcp.sh. docs/alphaevolve/SETUP.md remains historical text and does not launch a repository file." },
  { by: "docs/alphaevolve/SETUP.md", runs: "scripts/alphaevolve/setup.ps1", category: "MISSING_FILE", justification: "W-NO-GOOGLE-01B deleted scripts/alphaevolve/setup.ps1. docs/alphaevolve/SETUP.md remains historical text and does not launch a repository file." },
  { by: "docs/alphaevolve/SETUP.md", runs: "scripts/google-ai/setup.ps1", category: "MISSING_FILE", justification: "W-NO-GOOGLE-01B deleted scripts/google-ai/setup.ps1. docs/alphaevolve/SETUP.md remains historical text and does not launch a repository file." },
  { by: "docs/alphaevolve/SETUP.md", runs: "../scripts/alphaevolve/verify-gcp.ps1", category: "MISSING_FILE", justification: "W-NO-GOOGLE-01B deleted scripts/alphaevolve/verify-gcp.ps1. This relative runbook line does not launch a repository file." },
  { by: "docs/google-ai/SETUP.md", runs: "scripts/google-ai/setup.ps1", category: "MISSING_FILE", justification: "W-NO-GOOGLE-01B deleted scripts/google-ai/setup.ps1. docs/google-ai/SETUP.md remains historical text and does not launch a repository file." },
  { by: "docs/ops/local-prod-fas2.md", runs: "scripts/ops/sync-prod-secrets-gcp.ps1", category: "MISSING_FILE", justification: "W-NO-GOOGLE-01B deleted scripts/ops/sync-prod-secrets-gcp.ps1. The local-prod note remains historical text and does not launch a repository file." },
  { by: "package.json", runs: "scripts/run-staging-smoke.mjs", category: "MISSING_FILE", justification: "npm script to a file that is not in the repository (git ls-files: 0 run-staging-smoke.mjs)." },
  { by: "package.json", runs: "scripts/export-figma.ts", category: "MISSING_FILE", justification: "npm script to a file that is not in the repository (0 export-figma.ts)." },
  { by: "package.json", runs: "scripts/import/idempotent-ingest.ts", category: "MISSING_FILE", justification: "npm script to a file that is not in the repository (0 idempotent-ingest.ts)." },
  { by: "package.json", runs: "scripts/import/extract-requirements-idempotent.ts", category: "MISSING_FILE", justification: "npm script to a file that is not in the repository (0 extract-requirements-idempotent.ts)." },
  { by: "package.json", runs: "scripts/import/import-lantmateriet-property-units.ts", category: "MISSING_FILE", justification: "npm script to a file that is not in the repository (0 import-lantmateriet-property-units.ts)." },
  { by: "package.json", runs: "scripts/graph/build-knowledge-graph.ts", category: "MISSING_FILE", justification: "npm script to a file that is not in the repository (0 build-knowledge-graph.ts)." },
  { by: "package.json", runs: "scripts/search-health.ts", category: "MISSING_FILE", justification: "npm script to a file that is not in the repository (0 search-health.ts)." },
  { by: "packages/mps-data-governance/tests/P2Auth01SyntheticLegalCorpus.red.historical.ts", runs: "<dynamic directory>/scripts/import/legal-corpus-harvest.ts", category: "MISSING_FILE", justification: "resolve(__dirname, '../../../scripts/import/legal-corpus-harvest.ts'): no tracked legal-corpus-harvest.ts anywhere (a historical RED file)." },
  { by: "DOCKER.md", runs: "run_migration.js", category: "MISSING_FILE", justification: "runbook line to a file that is not in the repository (0 run_migration.js)." },
  { by: "SETUP.md", runs: "scripts/setup-git-config.ps1", category: "MISSING_FILE", justification: "runbook line to a file that is not in the repository (0 setup-git-config.ps1)." },
  { by: "SETUP.md", runs: "scripts/setup-git-config.sh", category: "MISSING_FILE", justification: "runbook line to a file that is not in the repository (0 setup-git-config.sh)." },
  { by: "docs/ops/dataportal-harvester-v2.md", runs: "scripts/ingest/dataportal-harvester-v2.ts", category: "MISSING_FILE", justification: "runbook line to a file that is not in the repository (0 dataportal-harvester-v2.ts)." },
  { by: "docs/ops/postgis_fastighet_pipeline.md", runs: "scripts/import_lm_marktacke.py", category: "MISSING_FILE", justification: "runbook line to a file that is not in the repository (0 import_lm_marktacke.py)." },
  { by: "scripts/data-pipeline/IMPORT_GUIDE.md", runs: "root_ops/extract_deferred_data.py", category: "MISSING_FILE", justification: "runbook line to a file that is not in the repository (0 extract_deferred_data.py)." },
  // ---- HOST_PATH (9): host tools, downloads, other checkouts and gitignored local files ----
  { by: "scripts/import-komplettering.ps1", runs: "c:/Dev/miljobeslut-platform-recovery/scripts/import-raw-pdfs.ts", category: "HOST_PATH", justification: "U30F8 (G6-8, corrected): it runs ANOTHER checkout's file on the operator's host, whose content this repository does not hold -- unknown host code (B3/B6), not the repository's own scripts/import-raw-pdfs.ts (which is scanned and writes no protected relation). Reachable only from an operator running this script by hand; pointing the line at the repository's own file is an owner/ops change, not made here." },
  { by: "scripts/import/run-full-raster-pipeline.ps1", runs: "C:/Users/jimmy/AppData/Local/Microsoft/WinGet/Packages/aria2.aria2_Microsoft.Winget.Source_8wekyb3d8bbwe/aria2-1.37.0-win-64bit-build1/aria2c.exe", category: "HOST_PATH", justification: "the aria2 download tool installed by winget on the operator's host (a downloader, no database client)." },
  { by: "scripts/import/run-historical-download-batched.ps1", runs: "C:/Users/jimmy/AppData/Local/Microsoft/WinGet/Packages/aria2.aria2_Microsoft.Winget.Source_8wekyb3d8bbwe/aria2-1.37.0-win-64bit-build1/aria2c.exe", category: "HOST_PATH", justification: "the winget-installed aria2 downloader on the operator's host." },
  { by: "scripts/import/run-historical-download.ps1", runs: "C:/Users/jimmy/AppData/Local/Microsoft/WinGet/Packages/aria2.aria2_Microsoft.Winget.Source_8wekyb3d8bbwe/aria2-1.37.0-win-64bit-build1/aria2c.exe", category: "HOST_PATH", justification: "the winget-installed aria2 downloader on the operator's host." },
  // W-NO-GOOGLE-01B (2026-10-06): withdrew setup_adc.sh -> /tmp/gcloud_install.sh
  // and setup_adc.sh -> <dynamic directory>/bin/gcloud. The ADC installer was deleted.
  // Previous entries remain in git history through 177909ea.
  { by: "docs/google-ai/SETUP.md", runs: ".venv/Scripts/Activate.ps1", category: "HOST_PATH", justification: "after `cd alphaevolve-on-googlecloud`: that gitignored checkout's virtualenv activation script (generated by venv)." },
  { by: "docs/google-ai/SETUP.md", runs: ".venv-adk/Scripts/Activate.ps1", category: "HOST_PATH", justification: "the gitignored .venv-adk virtualenv's activation script (.gitignore: .venv-adk/), generated by venv." },
  { by: "docs/qa/STAGING_SETUP_CHECKLIST.md", runs: ".env.staging", category: "HOST_PATH", justification: "a gitignored local environment file (.env*): sourced on the operator's machine, never repository content." },
  { by: ".vscode/tasks.json", runs: "coverage/index.html", category: "HOST_PATH", justification: "U30F8 (G6-3): `start coverage/index.html` opens the vitest coverage report (coverage/ is generated and gitignored, .gitignore: coverage) in the browser -- an HTML report, not code an interpreter runs." },
  // ---- CONTAINER_PATH ----
  // W-NO-GOOGLE-01 (2026-10-06): withdrew Dockerfile.gcp -> /sbin/tini.
  // Dockerfile.gcp was deleted. The previous entry remains in git history through 1b0e3db5.
  // ---- NOT_A_LAUNCH (8): runbook text read as a launch ----
  { by: ".claude/skills/postgis-filtyper.md", runs: "/copy", category: "NOT_A_LAUNCH", justification: "the psql meta command \\copy (lines 42 and 69: psql input in the skill's SQL examples), not a program path." },
  { by: "docs/deploy/DEPLOY_GCP.md", runs: "roles/aiplatform.user", category: "NOT_A_LAUNCH", justification: "an IAM role name in `for role in roles/... ; do` (DEPLOY_GCP.md:121-127), a loop word list, not a program." },
  { by: "docs/deploy/DEPLOY_GCP.md", runs: "roles/cloudsql.client", category: "NOT_A_LAUNCH", justification: "an IAM role name on a continuation line, not a program." },
  { by: "docs/deploy/DEPLOY_GCP.md", runs: "roles/secretmanager.secretAccessor", category: "NOT_A_LAUNCH", justification: "an IAM role name on a continuation line, not a program." },
  { by: "docs/deploy/DEPLOY_GCP.md", runs: "roles/storage.objectUser", category: "NOT_A_LAUNCH", justification: "an IAM role name on a continuation line, not a program." },
  { by: "docs/deploy/DEPLOY_GCP.md", runs: "roles/logging.logWriter", category: "NOT_A_LAUNCH", justification: "an IAM role name on a continuation line, not a program." },
  { by: "docs/deploy/DEPLOY_GCP.md", runs: "roles/monitoring.metricWriter", category: "NOT_A_LAUNCH", justification: "an IAM role name on a continuation line (`...; do`), not a program." },
  { by: "docs/analysis/legal-rag/DIAGNOSTIK_RAG_JURIDIK_STATUS.md", runs: "H:/Delade", category: "NOT_A_LAUNCH", justification: "a directory listing (H:\\Delade enheter\\...\\Sources\\) in a code block, not a command." },
];
