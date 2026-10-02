/**
 * TEST-DB-GUARD (OD-K0-5): the MARKED list of test files known to reach a database -- data only. Nothing
 * here mocks, skips or changes a test; it records what the guard reports and where it was found, so a
 * failure against the dead target 127.0.0.1:1 (or a TEST-DB-GUARD refusal) is recognised as a database
 * dependency, never as a product regression, and so the hygiene units that remove the dependencies know
 * their scope. The integration project (tests/integration/**, tests/smoke/**) needs a database by design
 * (globalSetup tests/setup/database.ts) and is not listed file by file.
 *
 * TDG-4 (2026-10-03, owner decision (4) point 8) added the four `hidden` files the 2026-10-02 sweeps found:
 * they passed only because the guard let them reach the DEAD target, not because they are hermetic. They
 * are fixed in their own hygiene unit after the regression analysis -- not here.
 */

export type DatabaseDependency =
  /** Needs MIMER_TEST_DB_ALLOW=<db>_test and a disposable database (TDG §6.1-6.3). */
  | 'opt-in-required'
  /** Real Prisma/pg without opt-in; fails on the dead target (TDG §6.4, "the nine"; U20CD/M1a). */
  | 'real-database-unmarked'
  /** Reached the dead target and still PASSED (or crashed late); found by the sweeps (SWEEP-REPORT §c). */
  | 'hidden';

export type KnownDatabaseDependentTest = {
  readonly file: string;
  readonly kind: DatabaseDependency;
  /** What reaches the database (read or write) and through which chain. */
  readonly how: string;
  /** Where it was found. */
  readonly source: string;
};

export const KNOWN_DATABASE_DEPENDENT_TESTS: readonly KnownDatabaseDependentTest[] = Object.freeze([
  {
    file: 'packages/spatial-provider-postgis/tests/SpatialProviderPostGIS.test.ts',
    kind: 'opt-in-required',
    how: 'real pg, DELETE/INSERT in env.*; TEST_DATABASE_URL falling back to 127.0.0.1:5432 (refused)',
    source: 'TDG-REPORT §6.2',
  },
  {
    file: 'packages/spatial-provider-postgis/tests/LUMagicMomentPostGIS.test.ts',
    kind: 'opt-in-required',
    how: 'as SpatialProviderPostGIS',
    source: 'TDG-REPORT §6.2',
  },
  {
    file: 'packages/spatial-provider-postgis/tests/LUEnforcement.test.ts',
    kind: 'opt-in-required',
    how: 'as SpatialProviderPostGIS',
    source: 'TDG-REPORT §6.2',
  },
  {
    file: 'packages/spatial-provider-postgis/tests/LUMagicMomentE2E.chain.test.ts',
    kind: 'opt-in-required',
    how: 'as SpatialProviderPostGIS',
    source: 'TDG-REPORT §6.2',
  },
  {
    file: 'tests/components/luWorkspace.magicMoment.e2e.test.tsx',
    kind: 'opt-in-required',
    how: 'same 127.0.0.1:5432 fallback; loads .env.test via dotenv (DB keys dropped)',
    source: 'TDG-REPORT §6.3',
  },
  {
    file: 'tests/unit/localizationGeometryProductProofs.test.ts',
    kind: 'real-database-unmarked',
    how: 'real prisma.$queryRaw',
    source: 'TDG-REPORT §6.4 (the nine)',
  },
  {
    file: 'tests/unit/luExecutionIdentityScopeV2ProductWiring.test.ts',
    kind: 'real-database-unmarked',
    how: 'real prisma raw query',
    source: 'TDG-REPORT §6.4 (the nine)',
  },
  {
    file: 'packages/mps-lu/tests/HM1BRealGovernedDocumentChain.test.ts',
    kind: 'real-database-unmarked',
    how: 'real Prisma governed document chain',
    source: 'TDG-REPORT §6.4 (the nine)',
  },
  {
    file: 'packages/mps-lu/tests/HM1CGovernedAssessmentPersistence.test.ts',
    kind: 'real-database-unmarked',
    how: 'prisma.organisation.upsert in tests/fixtures/ensureLocalizationProjectionProject.ts',
    source: 'TDG-REPORT §6.4 (the nine)',
  },
  {
    file: 'packages/mps-lu/tests/P4ALU05RealRuntimeEntrypoint.test.ts',
    kind: 'real-database-unmarked',
    how: 'the same fixture as HM1C',
    source: 'TDG-REPORT §6.4 (the nine)',
  },
  {
    file: 'tests/unit/resolveLuViewerPresentation.test.ts',
    kind: 'real-database-unmarked',
    how: 'every case reaches the database (503 instead of 404/424 on the dead target)',
    source: 'U20CD-VERIFICATION; SWEEP-REPORT §b',
  },
  {
    file: 'tests/unit/localizationGeometryContractProofs.test.ts',
    kind: 'real-database-unmarked',
    how: 'prisma.$queryRaw',
    source: 'M1a ("pre-existing real-Prisma dependency"); SWEEP-REPORT §b',
  },
  {
    file: 'tests/unit/services/municipalitySubmissionService.test.ts',
    kind: 'hidden',
    how: 'WRITE attempt: documentGenerator imports server/db/prisma directly (the test mocks db.server) -> prisma.documentRecord.create; 4 of 8 cases log it and pass. Its draft write to <cwd>/storage/drafts is refused by the TDG-4 write guard and caught by the service.',
    source: 'SWEEP-REPORT §c.1 (2026-10-02)',
  },
  {
    file: 'tests/unit/eidasSignatureService.test.ts',
    kind: 'hidden',
    how: 'read: getDocumentById -> searchRepository -> prisma.documentRecord.findUnique in all 10 cases, which pass',
    source: 'SWEEP-REPORT §c.2 (2026-10-02)',
  },
  {
    file: 'tests/unit/massOrchestrator.e2e.test.ts',
    kind: 'hidden',
    how: 'read: logisticsGeneratorService -> db.server -> prisma.project.findUnique in 7 cases, which pass on the "test-fallback"',
    source: 'SWEEP-REPORT §c.3 (2026-10-02)',
  },
  {
    file: 'tests/unit/backfillLocalizationGeometrySupersession.test.ts',
    kind: 'hidden',
    how: "importing classifyProject runs the backfill script's main() (loadEnvFirst, MimersIntegration.create({ forceMimers: true }), prisma.$queryRawUnsafe); stopped by MIMERS_ROOT_REQUIRED before any DB call, then process.exit(1)",
    source: 'SWEEP-REPORT §c.4 (2026-10-02)',
  },
]);
