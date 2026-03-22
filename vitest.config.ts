import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      reportsDirectory: 'coverage',
      // Only measure coverage for code that unit tests can exercise.
      // Files requiring a live database, external APIs or OAuth are
      // excluded here and instead covered by integration/E2E tests.
      exclude: [
        // ── Repositories (require a real Prisma/PostgreSQL connection) ──
        'server/repositories/**',
        // ── External-API services (BankID, LIMS, NVR, OCR, RAA, SGU) ──
        'server/services/bankIdService.ts',
        'server/services/limsService.ts',
        'server/services/limsAutoFetchService.ts',
        'server/services/nvrService.ts',
        'server/services/ocrService.ts',
        'server/services/raaService.ts',
        'server/services/sguService.ts',
        'server/services/eidasSignatureService.ts',
        // ── DB-heavy services (covered by integration tests) ──
        'server/services/searchService.ts',
        'server/services/searchWorker.ts',
        'server/services/publicUiService.ts',
        'server/services/fullStatusService.ts',
        'server/services/projectPlanService.ts',
        'server/services/requirementsReportService.ts',
        'server/services/requirementExtractionService.ts',
        'server/services/knowledgeGraphService.ts',
        'server/services/outlookIngestionService.ts',
        'server/services/outlookSchedulerService.ts',
        'server/services/openDataSourceService.ts',
        'server/services/documentGenerator.ts',
        'server/services/execSummaryQueueService.ts',
        'server/services/backupService.ts',
        'server/services/markCoverService.ts',
        'server/services/municipalityService.ts',
        'server/services/permitAuthorityService.ts',
        'server/services/permitDocxExportService.ts',
        'server/services/projectMemberService.ts',
        'server/services/propertyUnitService.ts',
        'server/services/ragSearchService.ts',
        'server/services/spatialAuditService.ts',
        'server/services/terrainService.ts',
        'server/services/checkListRagService.ts',
        'server/services/complianceRuleEngine.ts',
        'server/services/demoSearchService.ts',
        'server/services/gpsTrackingService.ts',
        'server/services/marketIntelService.ts',
        'server/services/notificationService.ts',
        'server/services/orgInvitationService.ts',
        'server/services/sluService.ts',
        // ── Large generated/Express API files (integration-tested) ──
        'server/secureApi.express.ts',
        'server/geminiApi.express.ts',
        // ── Lantmäteriet service: real OAuth2 API calls (demo mode is tested) ──
        'server/services/lantmaterietService.ts',
        // ── AI gateway services: require live Gemini/OpenAI API keys ──
        'server/services/mvpAiGatewayService.ts',
        // ── Remix/App router API route: Gemini AI integration (requires live key) ──
        'app/routes/api/gemini.ts',
        // ── Datasources (external data catalogs) ──
        'server/datasources/**',
        // ── Top-level client services (covered separately) ──
        'services/geminiService.ts',
        'services/orchestrationService.ts',
        'services/trafikverketService.ts',
        'services/predictiveScoringService.ts',
        'services/complianceRulesEngine.ts',
        'services/documentTemplateEngine.ts',
        'services/mvpApiClient.ts',
        // ── Build tooling & config ──
        '**/*.config.ts',
        '**/*.config.js',
        'scripts/**',
      ],
      thresholds: {
        lines: 70,
        branches: 60,
        functions: 70,
        statements: 70,
      },
    },
    projects: [
      {
        test: {
          name: 'unit',
          include: ['tests/unit/**/*.test.ts'],
          environment: 'node',
          setupFiles: ['tests/setup/env.ts'],
        },
      },
      {
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
          environment: 'node',
          setupFiles: ['tests/setup/env.ts'],
          testTimeout: 30000,
          hookTimeout: 30000,
        },
      },
    ],
  },
});
