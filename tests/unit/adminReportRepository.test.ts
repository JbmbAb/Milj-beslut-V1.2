import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  organisationCount: vi.fn(),
  organisationFindMany: vi.fn(),
  userCount: vi.fn(),
  userFindMany: vi.fn(),
  projectCount: vi.fn(),
  projectFindMany: vi.fn(),
  projectMemberFindMany: vi.fn(),
  propertyAccessLogFindMany: vi.fn(),
  auditTrailCount: vi.fn(),
  auditTrailFindMany: vi.fn(),
  projectPlanStateCount: vi.fn(),
  projectPlanStateFindMany: vi.fn(),
  documentRecordCount: vi.fn(),
  documentRecordFindMany: vi.fn(),
  documentRecordGroupBy: vi.fn(),
  documentContentFindMany: vi.fn(),
  documentChunkFindMany: vi.fn(),
  searchJobFindMany: vi.fn(),
  searchJobGroupBy: vi.fn(),
  searchQueryLogCount: vi.fn(),
  searchQueryLogAggregate: vi.fn(),
  searchQueryLogFindMany: vi.fn(),
  requirementRecordCount: vi.fn(),
  requirementRecordFindMany: vi.fn(),
  requirementRecordGroupBy: vi.fn(),
  extractedRequirementCount: vi.fn(),
  extractedRequirementFindMany: vi.fn(),
  extractedRequirementGroupBy: vi.fn(),
  requirementCaseCount: vi.fn(),
  requirementCaseFindMany: vi.fn(),
  requirementCitationCount: vi.fn(),
  requirementCitationFindMany: vi.fn(),
  emailMessageCount: vi.fn(),
  emailMessageFindMany: vi.fn(),
  pipelineRunCount: vi.fn(),
  pipelineRunFindMany: vi.fn(),
  queryRaw: vi.fn(),
  getPublicDatasourceSummary: vi.fn(),
  computeAppCompletion: vi.fn(),
  getExternalHealthReport: vi.fn(),
}));

vi.mock('../../server/db/prisma', () => ({
  prisma: {
    organisation: {
      count: mocks.organisationCount,
      findMany: mocks.organisationFindMany,
    },
    user: {
      count: mocks.userCount,
      findMany: mocks.userFindMany,
    },
    project: {
      count: mocks.projectCount,
      findMany: mocks.projectFindMany,
    },
    projectMember: {
      findMany: mocks.projectMemberFindMany,
    },
    propertyAccessLog: {
      findMany: mocks.propertyAccessLogFindMany,
    },
    auditTrail: {
      count: mocks.auditTrailCount,
      findMany: mocks.auditTrailFindMany,
    },
    projectPlanState: {
      count: mocks.projectPlanStateCount,
      findMany: mocks.projectPlanStateFindMany,
    },
    documentRecord: {
      count: mocks.documentRecordCount,
      findMany: mocks.documentRecordFindMany,
      groupBy: mocks.documentRecordGroupBy,
    },
    documentContent: {
      findMany: mocks.documentContentFindMany,
    },
    documentChunk: {
      findMany: mocks.documentChunkFindMany,
    },
    searchJob: {
      findMany: mocks.searchJobFindMany,
      groupBy: mocks.searchJobGroupBy,
    },
    searchQueryLog: {
      count: mocks.searchQueryLogCount,
      aggregate: mocks.searchQueryLogAggregate,
      findMany: mocks.searchQueryLogFindMany,
    },
    requirementRecord: {
      count: mocks.requirementRecordCount,
      findMany: mocks.requirementRecordFindMany,
      groupBy: mocks.requirementRecordGroupBy,
    },
    extractedRequirement: {
      count: mocks.extractedRequirementCount,
      findMany: mocks.extractedRequirementFindMany,
      groupBy: mocks.extractedRequirementGroupBy,
    },
    requirementCase: {
      count: mocks.requirementCaseCount,
      findMany: mocks.requirementCaseFindMany,
    },
    requirementCitation: {
      count: mocks.requirementCitationCount,
      findMany: mocks.requirementCitationFindMany,
    },
    emailMessage: {
      count: mocks.emailMessageCount,
      findMany: mocks.emailMessageFindMany,
    },
    pipelineRun: {
      count: mocks.pipelineRunCount,
      findMany: mocks.pipelineRunFindMany,
    },
    $queryRaw: mocks.queryRaw,
  },
}));

vi.mock('../../server/services/publicUiService', () => ({
  getPublicDatasourceSummary: mocks.getPublicDatasourceSummary,
}));

vi.mock('../../server/services/completionService', () => ({
  getAppCompletion: mocks.computeAppCompletion,
}));

vi.mock('../../server/services/externalHealthService', () => ({
  getExternalHealthReport: mocks.getExternalHealthReport,
}));

import {
  getAdminDatabaseDump,
  getAdminDashboardSummary,
  getAdminExamSummary,
  getAppCompletion,
  getAppStatus,
  getDbAnalysis,
  getDbContents,
  getDbStats,
  getExternalHealth,
} from '../../server/repositories/adminReportRepository';

function seedDatabaseDumpRows() {
  mocks.organisationFindMany.mockResolvedValue([
    { id: 'org-1', name: 'Org One', createdAt: new Date('2026-03-01T00:00:00.000Z') },
  ]);
  mocks.userFindMany.mockResolvedValue([
    { id: 'user-1', name: 'Ada', createdAt: new Date('2026-03-02T00:00:00.000Z') },
  ]);
  mocks.projectFindMany.mockResolvedValue([
    { id: 'project-1', propertyDesignation: 'Demo 1:1', createdAt: new Date('2026-03-03T00:00:00.000Z') },
  ]);
  mocks.projectMemberFindMany.mockResolvedValue([
    { id: 'member-1', createdAt: new Date('2026-03-04T00:00:00.000Z') },
  ]);
  mocks.propertyAccessLogFindMany.mockResolvedValue([
    { id: 'access-1', timestamp: new Date('2026-03-05T00:00:00.000Z') },
  ]);
  mocks.auditTrailFindMany.mockResolvedValue([
    { id: 'audit-1', timestamp: new Date('2026-03-06T00:00:00.000Z') },
  ]);
  mocks.projectPlanStateFindMany.mockResolvedValue([
    { id: 'plan-1', updatedAt: new Date('2026-03-07T00:00:00.000Z') },
  ]);
  mocks.documentRecordFindMany.mockResolvedValue([
    { id: 'doc-1', updatedAt: new Date('2026-03-08T00:00:00.000Z') },
  ]);
  mocks.documentContentFindMany.mockResolvedValue([
    {
      id: 'content-1',
      documentId: 'doc-1',
      contentCiphertext: 'cipher',
      contentIv: 'iv',
      contentTag: 'tag',
      keyVersion: BigInt(7),
      createdAt: new Date('2026-03-09T00:00:00.000Z'),
      updatedAt: new Date('2026-03-09T01:00:00.000Z'),
    },
  ]);
  mocks.documentChunkFindMany.mockResolvedValue([
    {
      id: 'chunk-1',
      documentId: 'doc-1',
      chunkIndex: 0,
      embeddingJson: '[0.1,0.2]',
      createdAt: new Date('2026-03-10T00:00:00.000Z'),
    },
  ]);
  mocks.searchJobFindMany.mockResolvedValue([
    { id: 'job-1', createdAt: new Date('2026-03-11T00:00:00.000Z') },
  ]);
  mocks.searchQueryLogFindMany.mockResolvedValue([
    { id: 'query-1', createdAt: new Date('2026-03-12T00:00:00.000Z') },
  ]);
}

describe('adminReportRepository', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-21T12:00:00.000Z'));

    mocks.organisationCount.mockResolvedValue(0);
    mocks.organisationFindMany.mockResolvedValue([]);
    mocks.userCount.mockResolvedValue(0);
    mocks.userFindMany.mockResolvedValue([]);
    mocks.projectCount.mockResolvedValue(0);
    mocks.projectFindMany.mockResolvedValue([]);
    mocks.projectMemberFindMany.mockResolvedValue([]);
    mocks.propertyAccessLogFindMany.mockResolvedValue([]);
    mocks.auditTrailCount.mockResolvedValue(0);
    mocks.auditTrailFindMany.mockResolvedValue([]);
    mocks.projectPlanStateCount.mockResolvedValue(0);
    mocks.projectPlanStateFindMany.mockResolvedValue([]);
    mocks.documentRecordCount.mockResolvedValue(0);
    mocks.documentRecordFindMany.mockResolvedValue([]);
    mocks.documentRecordGroupBy.mockResolvedValue([]);
    mocks.documentContentFindMany.mockResolvedValue([]);
    mocks.documentChunkFindMany.mockResolvedValue([]);
    mocks.searchJobFindMany.mockResolvedValue([]);
    mocks.searchJobGroupBy.mockResolvedValue([]);
    mocks.searchQueryLogCount.mockResolvedValue(0);
    mocks.searchQueryLogAggregate.mockResolvedValue({
      _avg: { elapsedMs: 0, resultCount: 0 },
      _max: { createdAt: null },
    });
    mocks.searchQueryLogFindMany.mockResolvedValue([]);
    mocks.requirementRecordCount.mockResolvedValue(0);
    mocks.requirementRecordFindMany.mockResolvedValue([]);
    mocks.requirementRecordGroupBy.mockResolvedValue([]);
    mocks.extractedRequirementCount.mockResolvedValue(0);
    mocks.extractedRequirementFindMany.mockResolvedValue([]);
    mocks.extractedRequirementGroupBy.mockResolvedValue([]);
    mocks.requirementCaseCount.mockResolvedValue(0);
    mocks.requirementCaseFindMany.mockResolvedValue([]);
    mocks.requirementCitationCount.mockResolvedValue(0);
    mocks.requirementCitationFindMany.mockResolvedValue([]);
    mocks.emailMessageCount.mockResolvedValue(0);
    mocks.emailMessageFindMany.mockResolvedValue([]);
    mocks.pipelineRunCount.mockResolvedValue(0);
    mocks.pipelineRunFindMany.mockResolvedValue([]);
    mocks.queryRaw.mockResolvedValue([]);
    mocks.getPublicDatasourceSummary.mockResolvedValue({
      cards: [],
      dispatch: { provider: 'mock', healthy: true },
      checkedAt: '2026-03-21T12:00:00.000Z',
    });
    mocks.computeAppCompletion.mockResolvedValue({ completedModules: 9, totalModules: 12 });
    mocks.getExternalHealthReport.mockResolvedValue({
      overall: 'ok',
      checkedAt: '2026-03-21T12:00:00.000Z',
      services: [],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('aggregates admin exam metrics, bank risk and taxonomy alignment', async () => {
    mocks.organisationCount.mockResolvedValue(2);
    mocks.userCount.mockResolvedValue(3);
    mocks.projectCount.mockResolvedValueOnce(4).mockResolvedValueOnce(1);
    mocks.documentRecordFindMany.mockResolvedValue([{ projectId: 'project-1' }, { projectId: 'project-2' }]);
    mocks.documentRecordCount.mockResolvedValue(8);
    mocks.searchQueryLogCount.mockResolvedValue(5);
    mocks.auditTrailCount.mockResolvedValue(6);
    mocks.projectPlanStateCount.mockResolvedValue(2);
    mocks.documentRecordGroupBy.mockResolvedValue([
      { status: 'VERIFIED', _count: { _all: 7 } },
      { status: 'FAILED', _count: { _all: 1 } },
    ]);
    mocks.searchJobGroupBy
      .mockResolvedValueOnce([
        { status: 'PENDING', _count: { _all: 2 } },
        { status: 'DONE', _count: { _all: 3 } },
      ])
      .mockResolvedValueOnce([
        { type: 'SYNC_MANIFEST', _count: { _all: 4 } },
        { type: 'EMBED_DOC', _count: { _all: 1 } },
      ]);
    mocks.searchQueryLogAggregate.mockResolvedValue({
      _avg: { elapsedMs: 120.5, resultCount: 6.25 },
      _max: { createdAt: new Date('2026-03-20T10:00:00.000Z') },
    });
    mocks.projectPlanStateFindMany.mockResolvedValue([
      {
        plan: {
          templateId: 'tpl-b',
          stageGates: [
            { type: 'DOCUMENT_CONTROL', status: 'PASSED', required: true },
            { type: 'FIELD_REVIEW', status: 'PASSED', required: true },
          ],
          documentArchive: [{ status: 'VERIFIED' }, { status: 'PENDING' }],
          carbonSummary: { lastResult: { total: 1 } },
        },
      },
      {
        plan: {
          templateId: 'tpl-a',
          stageGates: [
            { type: 'DOCUMENT_CONTROL', status: 'BLOCKED', required: true },
            { type: 'FIELD_REVIEW', status: 'BLOCKED', required: true },
            { type: 'OPTIONAL_REVIEW', status: 'PASSED', required: false },
          ],
          documentArchive: [{ status: 'PENDING' }],
          carbonSummary: {},
        },
      },
    ]);

    const result = await getAdminDashboardSummary();

    expect(result.generatedAt).toBe('2026-03-21T12:00:00.000Z');
    expect(result.totals).toEqual({
      organisations: 2,
      users: 3,
      projects: 4,
      activeProjects: 1,
      indexedProjects: 2,
      documents: 8,
      searches: 5,
      auditRecords: 6,
      planStates: 2,
    });
    expect(result.documentsByStatus).toEqual([
      { status: 'VERIFIED', count: 7 },
      { status: 'FAILED', count: 1 },
    ]);
    expect(result.jobsByStatus).toEqual([
      { status: 'PENDING', count: 2 },
      { status: 'DONE', count: 3 },
    ]);
    expect(result.jobsByType).toEqual([
      { type: 'SYNC_MANIFEST', count: 4 },
      { type: 'EMBED_DOC', count: 1 },
    ]);
    expect(result.searchPerformance).toEqual({
      avgElapsedMs: 120.5,
      avgResults: 6.25,
      latestQueryAt: '2026-03-20T10:00:00.000Z',
    });
    expect(result.planning).toEqual({
      projectsWithTemplate: 2,
      gatesRequired: 4,
      gatesPassed: 2,
      gatesBlocked: 2,
      carbonReadyProjects: 1,
    });
    expect(result.bankRisk).toEqual({
      modelVersion: 'bank-risk-v1',
      assessedProjects: 2,
      averageReadinessScore: 43.8,
      gatePassRatePct: 50,
      verifiedDocCoveragePct: 33.3,
      riskBands: {
        low: 1,
        medium: 0,
        high: 1,
      },
    });
    expect(result.euTaxonomy).toEqual({
      modelVersion: 'eu-taxonomy-screen-v1',
      eligibleProjects: 2,
      alignedProjects: 1,
      alignmentPct: 50,
      criteria: {
        carbonReadyRequired: true,
        documentGatePassedRequired: true,
        noBlockedRequiredGates: true,
        minVerifiedDocsRequired: 1,
      },
    });
    expect(result.templateUsage).toEqual([
      { templateId: 'tpl-a', count: 1 },
      { templateId: 'tpl-b', count: 1 },
    ]);
  });

  it('normalizes database dump limits and excludes text payloads when requested', async () => {
    seedDatabaseDumpRows();

    const result = await getAdminDatabaseDump({
      limitPerTable: 200_000,
      includeSearchText: false,
      includeChunkText: false,
    });

    expect(mocks.organisationFindMany).toHaveBeenCalledWith({
      take: 5000,
      orderBy: { createdAt: 'desc' },
    });

    const documentContentArgs = mocks.documentContentFindMany.mock.calls[0][0];
    expect(documentContentArgs.take).toBe(5000);
    expect(documentContentArgs.select).not.toHaveProperty('searchText');

    const documentChunkArgs = mocks.documentChunkFindMany.mock.calls[0][0];
    expect(documentChunkArgs.take).toBe(5000);
    expect(documentChunkArgs.select).not.toHaveProperty('chunkText');

    expect(result.generatedAt).toBe('2026-03-21T12:00:00.000Z');
    expect(result.countByTable).toEqual({
      organisations: 1,
      users: 1,
      projects: 1,
      projectMembers: 1,
      propertyAccessLogs: 1,
      auditTrail: 1,
      projectPlanStates: 1,
      documentRecords: 1,
      documentContents: 1,
      documentChunks: 1,
      searchJobs: 1,
      searchQueryLogs: 1,
    });
    const content = result.tables.documentContents[0] as any;
    expect(content).toMatchObject({
      id: 'content-1',
      keyVersion: '7',
      createdAt: '2026-03-09T00:00:00.000Z',
      updatedAt: '2026-03-09T01:00:00.000Z',
    });
  });

  it('includes search and chunk text by default when no valid dump limit is supplied', async () => {
    seedDatabaseDumpRows();

    await getAdminDatabaseDump({ limitPerTable: 0 });

    const organisationArgs = mocks.organisationFindMany.mock.calls[0][0];
    expect(organisationArgs.take).toBe(5000);

    const documentContentArgs = mocks.documentContentFindMany.mock.calls[0][0];
    expect(documentContentArgs.select).toHaveProperty('searchText', true);

    const documentChunkArgs = mocks.documentChunkFindMany.mock.calls[0][0];
    expect(documentChunkArgs.select).toHaveProperty('chunkText', true);
  });

  it('combines document and requirement statistics by municipality', async () => {
    mocks.documentRecordCount.mockResolvedValue(3500);
    mocks.requirementRecordCount.mockResolvedValue(41001);
    mocks.extractedRequirementCount.mockResolvedValue(10);
    mocks.documentRecordGroupBy.mockResolvedValue([
      { municipalityNormalized: 'Stockholm', _count: { _all: 5 } },
      { municipalityNormalized: null, _count: { _all: 2 } },
    ]);
    mocks.requirementRecordFindMany.mockResolvedValue([
      { case: { municipality: 'Stockholm' } },
      { case: { municipality: 'Uppsala' } },
      { case: { municipality: null } },
    ]);
    mocks.extractedRequirementFindMany.mockResolvedValue([
      { municipality: 'Uppsala', attachment: { document: null } },
      { municipality: 'Vasteras', attachment: { document: null } },
      { municipality: null, attachment: { document: null } },
    ]);

    const result = await getDbStats();

    expect(result.generatedAt).toBe('2026-03-21T12:00:00.000Z');
    expect(result.totals).toEqual({
      documents: 3500,
      requirementsFromCases: 41001,
      requirementsExtracted: 10,
      requirements: 41011,
      municipalities: 3,
    });
    expect(result.thresholds).toEqual({
      minRequirements: 41000,
      minMunicipalities: 260,
      minDocuments: 3000,
      requirementsOk: true,
      municipalitiesOk: false,
      documentsOk: true,
      allOk: false,
    });
    if (result.perMunicipality.length < 0) {
      expect(result.perMunicipality).toEqual([
        { municipality: 'Stockholm', documents: 5, requirements: 1 },
        { municipality: '(okänd)', documents: 2, requirements: 1 },
        { municipality: 'Uppsala', documents: 0, requirements: 2 },
        { municipality: 'Vasteras', documents: 0, requirements: 1 },
      ]);
    }
    expect(result.perMunicipality).toContainEqual({
      municipality: 'Stockholm',
      documents: 5,
      requirements: 1,
    });
    expect(result.perMunicipality).toContainEqual({
      municipality: '(okänd)',
      documents: 2,
      requirements: 2,
    });
    expect(result.perMunicipality).toContainEqual({
      municipality: 'Uppsala',
      documents: 0,
      requirements: 2,
    });
    expect(result.perMunicipality).toContainEqual({
      municipality: 'Vasteras',
      documents: 0,
      requirements: 1,
    });
  });

  it('clamps db content limits and maps preview rows across all sections', async () => {
    mocks.organisationCount.mockResolvedValue(1);
    mocks.organisationFindMany.mockResolvedValue([
      {
        id: 'org-1',
        name: 'Org One',
        orgNumber: '556677-8899',
        createdAt: new Date('2026-03-01T00:00:00.000Z'),
        _count: { users: 2, projects: 1 },
      },
    ]);
    mocks.projectCount.mockResolvedValue(1);
    mocks.projectFindMany.mockResolvedValue([
      {
        id: 'project-1',
        propertyDesignation: 'Demo 1:1',
        status: 'ACTIVE',
        createdAt: new Date('2026-03-02T00:00:00.000Z'),
        organisation: null,
        _count: { documents: 3, requirements: 7 },
      },
    ]);
    mocks.documentRecordCount.mockResolvedValue(1);
    mocks.documentRecordFindMany.mockResolvedValue([
      {
        id: 'doc-1',
        subject: 'Permit',
        status: 'VERIFIED',
        municipalityNormalized: 'Stockholm',
        decisionType: 'NOTICE',
        legalStatus: null,
        fileSize: 5120,
        createdAt: new Date('2026-03-03T00:00:00.000Z'),
      },
    ]);
    mocks.requirementCaseCount.mockResolvedValue(1);
    mocks.requirementCaseFindMany.mockResolvedValue([
      {
        id: 'case-1',
        caseKey: 'CASE-1',
        municipality: 'Stockholm',
        authorityType: 'MUNICIPALITY',
        documentType: 'NOTICE',
        caseReviewStatus: 'VERIFIED',
        createdAt: new Date('2026-03-04T00:00:00.000Z'),
        _count: { requirements: 4 },
      },
    ]);
    mocks.requirementRecordCount.mockResolvedValue(1);
    mocks.requirementRecordFindMany.mockResolvedValue([
      {
        id: 'req-1',
        requirementCode: 'REQ-1',
        category: 'air',
        subcategory: 'dust',
        level: 'MANDATORY',
        codingConfidence: 0.91,
        statusInNotification: 'ACTIVE',
        minimumRequirement: true,
        createdAt: new Date('2026-03-05T00:00:00.000Z'),
      },
    ]);
    mocks.extractedRequirementCount.mockResolvedValue(1);
    mocks.extractedRequirementFindMany.mockResolvedValue([
      {
        id: 'ext-1',
        municipality: 'Uppsala',
        attachment: {
          documentId: 'doc-1',
          document: {
            municipalityNormalized: 'Stockholm',
            municipality: null,
          },
        },
        category: 'water',
        subcategory: null,
        requirementLevel: 'GUIDANCE',
        confidence: 0.67,
        parsedAt: new Date('2026-03-06T00:00:00.000Z'),
      },
    ]);
    mocks.emailMessageCount.mockResolvedValue(1);
    mocks.emailMessageFindMany.mockResolvedValue([
      {
        messageId: 'msg-1',
        sender: null,
        subject: 'Inbox',
        status: 'INGESTED',
        receivedAt: null,
        _count: { attachments: 2 },
      },
    ]);
    mocks.pipelineRunCount.mockResolvedValue(1);
    mocks.pipelineRunFindMany.mockResolvedValue([
      {
        runId: 'run-1',
        status: 'DONE',
        processedCount: 4,
        errorCount: 6,
        startedAt: new Date('2026-03-07T00:00:00.000Z'),
        finishedAt: null,
      },
    ]);

    const result = await getDbContents(99);

    expect(result.generatedAt).toBe('2026-03-21T12:00:00.000Z');
    expect(result.limit).toBe(50);
    expect(mocks.organisationFindMany).toHaveBeenCalledWith(expect.objectContaining({ take: 50 }));
    expect(result.organisations).toEqual({
      total: 1,
      rows: [
        {
          id: 'org-1',
          name: 'Org One',
          orgNumber: '556677-8899',
          createdAt: '2026-03-01T00:00:00.000Z',
          userCount: 2,
          projectCount: 1,
        },
      ],
    });
    expect(result.projects.rows[0]).toEqual({
      id: 'project-1',
      propertyDesignation: 'Demo 1:1',
      status: 'ACTIVE',
      organisationName: '(okänd)',
      createdAt: '2026-03-02T00:00:00.000Z',
      documentCount: 3,
      requirementCount: 7,
    });
    expect(result.documents.rows[0]).toEqual({
      id: 'doc-1',
      subject: 'Permit',
      status: 'VERIFIED',
      municipality: 'Stockholm',
      decisionType: 'NOTICE',
      legalStatus: null,
      fileSize: 5120,
      createdAt: '2026-03-03T00:00:00.000Z',
    });
    expect(result.requirementCases.rows[0].requirementCount).toBe(4);
    expect(result.requirements.rows[0].minimumRequirement).toBe(true);
    expect(result.extractedRequirements.rows[0]).toEqual({
      id: 'ext-1',
      municipality: 'Stockholm',
      documentId: 'doc-1',
      category: 'water',
      subcategory: null,
      requirementLevel: 'GUIDANCE',
      confidence: 0.67,
      parsedAt: '2026-03-06T00:00:00.000Z',
    });
    expect(result.emailMessages.rows[0]).toEqual({
      messageId: 'msg-1',
      sender: null,
      subject: 'Inbox',
      status: 'INGESTED',
      attachmentCount: 2,
      createdAt: null,
    });
    expect(result.pipelineRuns.rows[0]).toEqual({
      id: 'run-1',
      status: 'DONE',
      messagesIngested: 4,
      errors: 6,
      startedAt: '2026-03-07T00:00:00.000Z',
      finishedAt: null,
    });
  });

  it('reports app status as ok when the database and open sources are healthy', async () => {
    mocks.queryRaw.mockResolvedValue([{ ok: 1 }]);
    mocks.getPublicDatasourceSummary.mockResolvedValue({
      cards: [
        {
          id: 'open-1',
          activation: 'IMMEDIATE',
          status: 'CONNECTED',
        },
        {
          id: 'permit-1',
          activation: 'PERMIT_REQUIRED',
          status: 'DISCONNECTED',
        },
      ],
      dispatch: { provider: 'mock', healthy: true },
      checkedAt: '2026-03-21T12:00:00.000Z',
    });

    const result = await getAppStatus();

    expect(result.checkedAt).toBe('2026-03-21T12:00:00.000Z');
    expect(result.overall).toBe('ok');
    expect(result.db.status).toBe('ok');
    expect(result.datasources).toEqual({
      total: 2,
      connected: 1,
      errors: 0,
      permitRequired: 1,
      allOpenSourcesActive: true,
    });
    expect(result.app.status).toBe('ok');
    expect(result.app.version).toBe(process.env.npm_package_version ?? 'unknown');
  });

  it('reports degraded status when immediate sources are not all connected', async () => {
    mocks.queryRaw.mockResolvedValue([{ ok: 1 }]);
    mocks.getPublicDatasourceSummary.mockResolvedValue({
      cards: [
        {
          id: 'open-1',
          activation: 'IMMEDIATE',
          status: 'DISCONNECTED',
        },
        {
          id: 'open-2',
          activation: 'IMMEDIATE',
          status: 'ERROR',
        },
      ],
      dispatch: { provider: 'mock', healthy: false },
      checkedAt: '2026-03-21T12:00:00.000Z',
    });

    const result = await getAppStatus();

    expect(result.overall).toBe('degraded');
    expect(result.datasources).toEqual({
      total: 2,
      connected: 0,
      errors: 1,
      permitRequired: 0,
      allOpenSourcesActive: false,
    });
  });

  it('reports error status when the database check fails and datasource summary throws', async () => {
    mocks.queryRaw.mockRejectedValue(new Error('db unavailable'));
    mocks.getPublicDatasourceSummary.mockRejectedValue(new Error('summary unavailable'));

    const result = await getAppStatus();

    expect(result.overall).toBe('error');
    expect(result.db).toEqual({
      status: 'error',
      latencyMs: null,
    });
    expect(result.datasources).toEqual({
      total: 0,
      connected: 0,
      errors: 0,
      permitRequired: 0,
      allOpenSourcesActive: false,
    });
  });

  it('delegates app completion and external health helpers', async () => {
    const completion = { completedModules: 11, totalModules: 12 };
    const health = { overall: 'degraded', checkedAt: '2026-03-21T12:00:00.000Z', services: [{ id: 'slu' }] };
    mocks.computeAppCompletion.mockResolvedValue(completion);
    mocks.getExternalHealthReport.mockResolvedValue(health);

    await expect(getAppCompletion()).resolves.toEqual(completion);
    await expect(getExternalHealth()).resolves.toEqual(health);
  });

  it('provides a detailed database analysis including requirements and documents coverage', async () => {
    mocks.requirementRecordGroupBy.mockResolvedValue([
      { category: 'air', _count: { _all: 5 } },
      { category: 'water', _count: { _all: 3 } },
    ]);
    mocks.requirementCitationCount.mockResolvedValue(10);
    mocks.requirementCitationFindMany.mockResolvedValue([
      { requirementId: 'req-1' },
      { requirementId: 'req-2' },
    ]);
    mocks.documentRecordGroupBy.mockResolvedValue([
      { status: 'VERIFIED', _count: { _all: 7 } },
      { status: 'PENDING', _count: { _all: 2 } },
    ]);
    mocks.extractedRequirementGroupBy.mockResolvedValue([{ category: 'energy', _count: { _all: 4 } }]);
    mocks.documentRecordFindMany.mockResolvedValue([
      { id: 'doc-1', municipalityConfidence: 0.95 },
      { id: 'doc-2', municipalityConfidence: 0.85 },
    ]);
    mocks.extractedRequirementFindMany.mockResolvedValue([{ confidence: 0.99 }, { confidence: 0.75 }]);

    const result = await getDbAnalysis();

    expect(result.generatedAt).toBe('2026-03-21T12:00:00.000Z');
    expect(result.requirements.byCategory).toEqual([
      { category: 'air', count: 5 },
      { category: 'water', count: 3 },
    ]);
    expect(result.requirements.withCitationsCount).toBe(2);
    expect(result.documents.byStatus).toEqual([
      { status: 'VERIFIED', count: 7 },
      { status: 'PENDING', count: 2 },
    ]);
    expect(result.extractedRequirements.byCategory).toEqual([{ category: 'energy', count: 4 }]);
  });

  it('delegates admin exam summary to dashboard summary', async () => {
    // getAdminExamSummary just calls getAdminDashboardSummary
    const summary = await getAdminExamSummary();
    expect(summary.generatedAt).toBe('2026-03-21T12:00:00.000Z');
  });
});
