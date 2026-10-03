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
    file: "benchmarks/alpha_evolve_bibbi_harvest/evaluator.py",
    policy: "DYNAMIC_REVIEWED",
    justification:
      "U30F3 M-2 (exec now fails closed): the AlphaEvolve benchmark evaluator exec()s a candidate program (generated code) into a namespace and calls its evaluate(); a developer experiment harness, on no product, CI or release path. What a candidate could do against a database is not constrained here -- the database-level protection is the layer for that.",
    sites: [
      "DYNAMIC PROCESS exec | exec(code, namespace)",
    ],
  },
  {
    file: "deploy/onprem/image-smoke/smoke.mjs",
    policy: "DYNAMIC_REVIEWED",
    justification:
      "On-prem image smoke: runs node --import tsx on a server entry point of the image under test (entryAbs = path.join(APP, entry), entry from the smoke matrix); a smoke check of the built image, not a database tool.",
    sites: [
      "DYNAMIC PROCESS spawnSync | spawnSync(process.execPath, ['--import', 'tsx', '--import', REGISTER, entryAbs], { cwd: APP, env: { ...process.env, ...extraEnv, LINK_ONLY_ENTRY: entryAbs }, encoding: 'utf8', timeout: 600000, maxBuf…",
    ],
  },
  {
    file: "deploy/onprem/smoke-image.sh",
    policy: "DYNAMIC_REVIEWED",
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
    justification:
      "Multi-agent control plane: spawns the agent process of a worker profile (profile.command / profile.args, operator configuration); a generic launcher with no database tool of its own.",
    sites: [
      "DYNAMIC PROCESS spawn | spawn(profile.command, [...(profile.args ?? [])], { cwd: profile.cwd, env, shell: false, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, })",
    ],
  },
  {
    file: "packages/mps-pattern-proof/src/docker/executors.ts",
    policy: "DYNAMIC_REVIEWED",
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
    justification:
      "U30F3 M-2 (__import__ now fails closed): _optional_pkg_version(module_name) imports httpx, tenacity and diskcache (the only in-file callers) to read their __version__ for a run manifest; no database or process client.",
    sites: [
      "DYNAMIC PROCESS __import__ | __import__(module_name)",
    ],
  },
  {
    file: "scripts/alphaevolve/experiments/legal_search_params/src/evaluate.py",
    policy: "DYNAMIC_REVIEWED",
    justification:
      "U30F3 M-2 (exec now fails closed): the AlphaEvolve legal-search experiment exec()s a candidate program (generated code) with an injected evaluation set and calls its evaluate(); a developer experiment harness, on no product, CI or release path. What a candidate could do against a database is not constrained here -- the database-level protection is the layer for that.",
    sites: [
      "DYNAMIC PROCESS exec | exec(code, exec_namespace)",
    ],
  },
  {
    file: "scripts/alphaevolve/setup.ps1",
    policy: "DYNAMIC_REVIEWED",
    justification:
      "AlphaEvolve CLI setup: runs the resolved alphaevolve executable ($aeCmd) with fixed subcommands (version, skills install); no database tool.",
    sites: [
      "DYNAMIC PROCESS powershell | & $aeCmd version",
      "DYNAMIC PROCESS powershell | & $aeCmd skills install --source $SkillsSource --dest $SkillsDest --force",
    ],
  },
  {
    file: "scripts/build-requirements-verification-priority-workbook.ps1",
    policy: "DYNAMIC_REVIEWED",
    justification:
      "Opens the generated Excel workbook with its default application (Start-Process on the output document path); no database tool.",
    sites: [
      "DYNAMIC PROCESS powershell | Start-Process $outputPath",
    ],
  },
  {
    file: "scripts/build-requirements-verification-workbook-fast.ps1",
    policy: "DYNAMIC_REVIEWED",
    justification:
      "Opens the generated Excel workbook with its default application (Start-Process on the output document path); no database tool.",
    sites: [
      "DYNAMIC PROCESS powershell | Start-Process $outFull",
    ],
  },
  {
    file: "scripts/build-requirements-verification-workbook-lite.ps1",
    policy: "DYNAMIC_REVIEWED",
    justification:
      "Opens the generated Excel workbook with its default application (Start-Process on the output document path); no database tool.",
    sites: [
      "DYNAMIC PROCESS powershell | Start-Process $outFull",
    ],
  },
  {
    file: "scripts/build-requirements-verification-workbook.ps1",
    policy: "DYNAMIC_REVIEWED",
    justification:
      "Opens the generated Excel workbook with its default application (Start-Process on the output document path); no database tool.",
    sites: [
      "DYNAMIC PROCESS powershell | Start-Process $resolvedOutput",
    ],
  },
  {
    file: "scripts/data-pipeline/import_all_datasets.py",
    policy: "DYNAMIC_REVIEWED",
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
    file: "scripts/data-pipeline/import_nv_vardetrakter.py",
    policy: "DYNAMIC_REVIEWED",
    justification:
      "run_psql(query) is a psql -c forwarder; its callers pass in-file literals, which the literal surface classifies where they are written.",
    sites: [
      "UNRESOLVABLE PROCESS subprocess.run | subprocess.run(cmd, capture_output=True)",
    ],
  },
  {
    file: "scripts/data-pipeline/nmd_optimized_import.ps1",
    policy: "DYNAMIC_REVIEWED",
    justification:
      "Invoke-Psql is a psql -c forwarder (& $psqlPath @dbArgs -c $Sql); its callers pass in-file literals, which the literal surface classifies where they are written.",
    sites: [
      "UNRESOLVABLE PROCESS powershell | & $psqlPath @dbArgs '-c' $Sql",
    ],
  },
  {
    file: "scripts/db/apply-raster-migration.ts",
    policy: "DYNAMIC_REVIEWED",
    justification:
      "Applies prisma/migrations/20260628_raster_outdb_infrastructure.sql statement by statement (split on \";\"); that file is scanned itself as SQL and holds no protected write.",
    sites: [
      "DYNAMIC SQL_CALL p.$executeRawUnsafe | p.$executeRawUnsafe(query)",
    ],
  },
  {
    file: "scripts/db/archive-manifest-audit.mjs",
    policy: "DYNAMIC_REVIEWED",
    justification:
      "Archive audit: docker run rclone/rclone with the rclone subcommand and paths passed in by its callers (...args); a file-sync tool against the archive drive, no database.",
    sites: [
      "DYNAMIC PROCESS execFileSync | execFileSync( 'docker', [ 'run', '--rm', '--dns', '8.8.8.8', '-v', `${RCLONE_CONFIG}:/config/rclone:ro`, 'rclone/rclone', ...args, '--config', '/config/rclone/rclone.conf', ], { encoding: 'utf8', max…",
    ],
  },
  {
    file: "scripts/db/import-nmd-outofdb.sh",
    policy: "DYNAMIC_REVIEWED",
    justification:
      "raster2pgsql | psql into $TARGET_TABLE (default env.nmd_2023, not protected; overridable by NMD_TARGET_TABLE). A shell script cannot call the gate: an override to a protected name is not refused (owner decision: retire or move into a gated script).",
    sites: [
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
    justification:
      "Local ogrinfo wrapper: resolves an installed ogrinfo.exe and forwards the arguments the operator gives (@ArgsList). ogrinfo -sql can write and the wrapper cannot see what it runs (owner decision: gate with Assert-CommandWriteAllowed).",
    sites: [
      "DYNAMIC PROCESS powershell | & $ogrinfo @ArgsList",
    ],
  },
  {
    file: "scripts/db/partition-realtime-tables.sql",
    policy: "DYNAMIC_REVIEWED",
    justification:
      "Time-series partitioning of the public application tables GpsPosition, AuditTrail, SearchQueryLog and PropertyAccessLog; its DO blocks EXECUTE format(...) for monthly partitions of those public tables only.",
    sites: [
      "UNRESOLVABLE SQL_FILE sql file | (whole file)",
    ],
  },
  {
    file: "scripts/db/promote-raster-cog.mjs",
    policy: "DYNAMIC_REVIEWED",
    justification:
      "gdal_translate (GDAL_TRANSLATE, resolved at run time) converts a raster file to COG on disk; file in, file out, no database datasource.",
    sites: [
      "DYNAMIC PROCESS execSync | execSync(gdalCmd, { stdio: 'inherit' })",
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
    justification:
      "Dev-Gov runner: executes the proof commands a unit definition declares (commandSpec.command / args) under the Dev-Gov controller.",
    sites: [
      "DYNAMIC PROCESS spawnSync | spawnSync(commandSpec.command, commandSpec.args || [], { cwd, encoding: 'utf8', env: { ...process.env, ...(commandSpec.env || {}), ...(options.env || {}) }, timeout: commandSpec.timeout_ms || 120_000…",
    ],
  },
  {
    file: "scripts/hm1/run-proof-lane.mjs",
    policy: "DYNAMIC_REVIEWED",
    justification:
      "Runs vitest (node <vitest entrypoint> run --config vitest.config.ts --project <lane>) for a registered proof lane; the tests run under the TEST-DB-GUARD.",
    sites: [
      "DYNAMIC PROCESS spawnSync | spawnSync( process.execPath, [ vitestEntrypoint, \"run\", \"--config\", \"vitest.config.ts\", \"--project\", registry.lane.vitest_project, ...registry.required_proofs.map((proof) => proof.file), ], { cwd: ro…",
    ],
  },
  {
    file: "scripts/import-office-docs.ts",
    policy: "DYNAMIC_REVIEWED",
    justification:
      "Runs a PowerShell COM command (cleanCommand, built in-file) to read Office documents; no database tool.",
    sites: [
      "DYNAMIC PROCESS execSync | execSync(`powershell -NoProfile -Command \"${cleanCommand}\"`, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 })",
    ],
  },
  {
    file: "scripts/import/diagnose-system.ts",
    policy: "DYNAMIC_REVIEWED",
    justification:
      "runCmd(cmd) helper for diagnostic probes (tool versions, disk, docker ps); its callers pass in-file literals, which the literal surface classifies where they are written.",
    sites: [
      "DYNAMIC PROCESS execSync | execSync(cmd, { encoding: 'utf8', timeout: 10000 })",
    ],
  },
  {
    file: "scripts/import/geo.spec.ts",
    policy: "DYNAMIC_REVIEWED",
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
    file: "scripts/import/import-raster-outdb.ts",
    policy: "DYNAMIC_REVIEWED",
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
    justification:
      "runPowerShell(command) helper for Expand-Archive and file operations; its callers pass in-file literals, which the literal surface classifies where they are written.",
    sites: [
      "DYNAMIC PROCESS spawnSync | spawnSync('powershell', ['-NoProfile', '-Command', command], { encoding: 'utf8', stdio: 'pipe', })",
    ],
  },
  {
    file: "scripts/import/prepare-mcf-stability-national.ts",
    policy: "DYNAMIC_REVIEWED",
    justification:
      "runPowerShell(command) helper for Expand-Archive and file operations; its callers pass in-file literals, which the literal surface classifies where they are written.",
    sites: [
      "DYNAMIC PROCESS spawnSync | spawnSync('powershell', ['-NoProfile', '-Command', command], { encoding: 'utf8', stdio: 'pipe', timeout: ZIP_EXTRACT_TIMEOUT_MS, })",
    ],
  },
  {
    file: "scripts/import/prepare-mcf-stability-pilot.ts",
    policy: "DYNAMIC_REVIEWED",
    justification:
      "runPowerShell(command) helper for Expand-Archive and file operations; its callers pass in-file literals, which the literal surface classifies where they are written.",
    sites: [
      "DYNAMIC PROCESS spawnSync | spawnSync('powershell', ['-NoProfile', '-Command', command], { encoding: 'utf8', stdio: 'pipe', })",
    ],
  },
  {
    file: "scripts/import/run-geodata-gap-pipeline.ts",
    policy: "DYNAMIC_REVIEWED",
    justification:
      "Orchestrator: runs python -u <script> for the steps listed in-file (script is the step of that list); every step is a repository script that is scanned itself.",
    sites: [
      "DYNAMIC PROCESS spawnSync | spawnSync('python', ['-u', script, arg], { stdio: 'inherit', cwd: process.cwd(), env: process.env, })",
    ],
  },
  {
    file: "scripts/import/run-import-focus.ps1",
    policy: "DYNAMIC_REVIEWED",
    justification:
      "Operator import pipeline: Run-Step runs the in-file step command strings with Invoke-Expression; every step is a repository script that is scanned itself (its import-n2k-gml step is retired and now fails by design).",
    sites: [
      "DYNAMIC PROCESS powershell | Invoke-Expression $Command *>&1",
    ],
  },
  {
    file: "scripts/import/run-import-session.ps1",
    policy: "DYNAMIC_REVIEWED",
    justification:
      "Operator import session: Run-Step runs the in-file step command strings with Invoke-Expression; every step is a repository script that is scanned itself (its import-n2k-gml step is retired and now fails by design).",
    sites: [
      "DYNAMIC PROCESS powershell | Invoke-Expression $command *>&1",
    ],
  },
  {
    file: "scripts/import/run-national-reharvest.ts",
    policy: "DYNAMIC_REVIEWED",
    justification:
      "Orchestrator: runs python -u <script> for the steps listed in-file (script is the step of that list); every step is a repository script that is scanned itself.",
    sites: [
      "DYNAMIC PROCESS spawnSync | spawnSync('python', ['-u', script, arg], { stdio: 'inherit', cwd: process.cwd(), env: process.env, })",
    ],
  },
  {
    file: "scripts/import/run-sgu-librarian-pipeline.ts",
    policy: "DYNAMIC_REVIEWED",
    justification:
      "Orchestrator: run(label, args) = npx tsx <args> for the steps listed in-file; every step is a repository script that is scanned itself.",
    sites: [
      "DYNAMIC PROCESS spawnSync | spawnSync('npx', ['tsx', ...args], { stdio: 'inherit', cwd: process.cwd(), env: process.env, shell: process.platform === 'win32', })",
    ],
  },
  {
    file: "scripts/import/run-sgu-quad-import.ts",
    policy: "DYNAMIC_REVIEWED",
    justification:
      "Orchestrator: run(label, args) = npx tsx <args> for the steps listed in-file; every step is a repository script that is scanned itself.",
    sites: [
      "DYNAMIC PROCESS spawnSync | spawnSync('npx', ['tsx', ...args], { stdio: 'inherit', cwd: process.cwd(), env: process.env, shell: process.platform === 'win32', })",
    ],
  },
  {
    file: "scripts/import/run-sks-import.ts",
    policy: "DYNAMIC_REVIEWED",
    justification:
      "Orchestrator: run(label, args) = npx tsx <args> for the steps listed in-file; every step is a repository script that is scanned itself.",
    sites: [
      "DYNAMIC PROCESS spawnSync | spawnSync('npx', ['tsx', ...args], { stdio: 'inherit', cwd: process.cwd(), env: process.env, shell: process.platform === 'win32', })",
    ],
  },
  {
    file: "scripts/import/sanitize-postgis-failed-imports.ps1",
    policy: "DYNAMIC_REVIEWED",
    justification:
      "Invoke-DbSql is a psql -c forwarder (docker exec ... -c $sql); every call passes an in-file literal right after Assert-UngovernedWriteAllowed for its target (U30F F1).",
    sites: [
      "UNRESOLVABLE PROCESS powershell | docker exec miljobeslut-postgres psql -U miljobeslut -d miljobeslut -v ON_ERROR_STOP=1 -c $sql",
    ],
  },
  {
    file: "scripts/import/sync-sgu-tier1-to-drive.ps1",
    policy: "DYNAMIC_REVIEWED",
    justification:
      "Archive sync: docker run rclone/rclone with rclone arguments built in-file and passed as a splat (@args); a file-sync tool against the archive drive, no database.",
    sites: [
      "DYNAMIC PROCESS powershell | docker run --rm --dns 8.8.8.8 ` -v \"${rcloneConfig}:/config/rclone:ro\" ` @args ` rclone/rclone @args ` --config /config/rclone/rclone.conf",
    ],
  },
  {
    file: "scripts/ops/check-postgis-prerequisites.cjs",
    policy: "DYNAMIC_REVIEWED",
    justification:
      "sh(cmd) helper for read-only prerequisite probes (docker exec ... psql -Atc \"SELECT ...\"); its callers pass in-file literals, which the literal surface classifies where they are written.",
    sites: [
      "DYNAMIC PROCESS execSync | execSync(cmd, { encoding: \"utf8\", stdio: [\"ignore\", \"pipe\", \"pipe\"], windowsHide: true, maxBuffer: 16 * 1024 * 1024, })",
    ],
  },
  {
    file: "scripts/ops/restore-prod-db.ps1",
    policy: "DYNAMIC_REVIEWED",
    justification:
      "Disaster-recovery restore of the local prod container from a pg_dump backup (owner-run, requires -Confirm): it replaces the whole database by design and is on no release path. Owner decision: keep as the DR tool or retire.",
    sites: [
      "UNRESOLVABLE PROCESS powershell | docker compose -f $ComposeFile exec -T db psql -U miljobeslut -d miljobeslut_prod -v ON_ERROR_STOP=1 -f -",
    ],
  },
  {
    file: "scripts/ops/retain-spatial-dataset-versions.ts",
    policy: "DYNAMIC_REVIEWED",
    justification:
      "createReadOnlySqlPort: the retention CLI's query-only port (execute is refused); the statements it forwards are SpatialDatasetRetention's (gate implementation).",
    sites: [
      "DYNAMIC SQL_CALL pool.query | pool.query(sql, params as unknown[])",
    ],
  },
  {
    file: "scripts/ops/verify-prod.ps1",
    policy: "DYNAMIC_REVIEWED",
    justification:
      "Test-Step runs the in-file script blocks of the prod verification (& $Block).",
    sites: [
      "DYNAMIC PROCESS powershell | & $Block",
    ],
  },
  {
    file: "scripts/staging-setup.sh",
    policy: "DYNAMIC_REVIEWED",
    justification:
      "export $(cat .env.staging | xargs): loads the staging environment variables; the expansion is assignments, not a program.",
    sites: [
      "DYNAMIC PROCESS sh | export $(cat .env.staging | xargs)",
    ],
  },
  {
    file: "server/services/nmdService.ts",
    policy: "DYNAMIC_REVIEWED",
    justification:
      "Runs gdallocationinfo (tool path resolved at run time) to read one NMD raster value at a point; read-only, no database.",
    sites: [
      "DYNAMIC PROCESS spawn | spawn(tool, ['-valonly', '-l_srs', 'EPSG:4326', NMD_RASTER_PATH, String(lng), String(lat)])",
    ],
  },
  {
    file: "server/services/sguJordartRasterService.ts",
    policy: "DYNAMIC_REVIEWED",
    justification:
      "Runs gdallocationinfo (tool path resolved at run time) to read one SGU soil raster value at a point; read-only, no database.",
    sites: [
      "DYNAMIC PROCESS spawn | spawn(tool, ['-valonly', '-l_srs', 'EPSG:4326', rasterPath, String(lng), String(lat)])",
    ],
  },
  {
    file: "src/infrastructure/geo/static-map-generator.ts",
    policy: "DYNAMIC_REVIEWED",
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
