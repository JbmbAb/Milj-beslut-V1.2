import { prisma } from '../db/prisma';
import type {
  AdminDatabaseDumpResponse,
  AdminDashboardSummary,
  AppCompletionResponse,
  AppStatusResponse,
  DbAnalysisResponse,
  DbContentsResponse,
  DbStatsResponse,
  ExternalHealthReport,
  ProjectStageGate,
} from '../../types';
import { getPublicDatasourceSummary } from '../services/publicUiService';
import { getAppCompletion as computeAppCompletion } from '../services/completionService';
import { getExternalHealthReport } from '../services/externalHealthService';

const db = prisma;

function isGate(value: unknown): value is ProjectStageGate {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<ProjectStageGate>;
  return Boolean(candidate.type) && Boolean(candidate.status);
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function asRounded(value: number): number {
  return Number(value.toFixed(1));
}

function resolveExtractedRequirementMunicipality(row: {
  municipality?: string | null;
  attachment?: {
    document?: {
      municipalityNormalized?: string | null;
      municipality?: string | null;
    } | null;
  } | null;
}): string {
  return (
    row.attachment?.document?.municipalityNormalized ??
    row.attachment?.document?.municipality ??
    row.municipality ??
    '(okänd)'
  );
}

export async function getAdminDashboardSummary(): Promise<AdminDashboardSummary> {
  const [
    organisationCount,
    userCount,
    projectCount,
    activeProjectCount,
    indexedProjects,
    documentCount,
    searchCount,
    auditCount,
    planStateCount,
    docsByStatus,
    jobsByStatus,
    jobsByType,
    searchAggregate,
    planStates,
  ] = await Promise.all([
    db.organisation.count(),
    db.user.count(),
    db.project.count(),
    db.project.count({ where: { status: 'ACTIVE' } }),
    db.documentRecord.findMany({
      select: { projectId: true },
      distinct: ['projectId'],
    }),
    db.documentRecord.count(),
    db.searchQueryLog.count(),
    db.auditTrail.count(),
    db.projectPlanState.count(),
    db.documentRecord.groupBy({
      by: ['status'],
      _count: { _all: true },
    }),
    db.searchJob.groupBy({
      by: ['status'],
      _count: { _all: true },
    }),
    db.searchJob.groupBy({
      by: ['type'],
      _count: { _all: true },
    }),
    db.searchQueryLog.aggregate({
      _avg: {
        elapsedMs: true,
        resultCount: true,
      },
      _max: {
        createdAt: true,
      },
    }),
    db.projectPlanState.findMany({
      select: {
        plan: true,
      },
    }),
  ]);

  const templateUsage = new Map<string, number>();
  let projectsWithTemplate = 0;
  let gatesRequired = 0;
  let gatesPassed = 0;
  let gatesBlocked = 0;
  let carbonReadyProjects = 0;
  let totalDocs = 0;
  let verifiedDocs = 0;

  let bankAssessedProjects = 0;
  let bankReadinessSum = 0;
  let bankRiskLow = 0;
  let bankRiskMedium = 0;
  let bankRiskHigh = 0;

  let taxonomyEligibleProjects = 0;
  let taxonomyAlignedProjects = 0;

  // Constants for readiness score calculation
  const GATE_PASS_RATE_WEIGHT = 45;
  const VERIFIED_DOC_RATIO_WEIGHT = 25;
  const CARBON_READY_PENALTY = 10;
  const DOCUMENT_GATE_PENALTY = 10;
  const BLOCKED_GATES_PENALTY = 10;

  for (const row of planStates) {
    const plan = row.plan as Record<string, unknown> | null;
    if (!plan || typeof plan !== 'object') continue;
    bankAssessedProjects += 1;

    const templateId = typeof plan.templateId === 'string' ? plan.templateId : '';
    if (templateId) {
      projectsWithTemplate += 1;
      templateUsage.set(templateId, (templateUsage.get(templateId) || 0) + 1);
    }

    const stageGatesRaw = Array.isArray(plan.stageGates) ? plan.stageGates : [];
    const requiredStageGates: ProjectStageGate[] = [];
    for (const gateCandidate of stageGatesRaw) {
      if (!isGate(gateCandidate)) continue;
      if (!gateCandidate.required) continue;
      requiredStageGates.push(gateCandidate);
      gatesRequired += 1;
      if (gateCandidate.status === 'PASSED') gatesPassed += 1;
      if (gateCandidate.status === 'BLOCKED') gatesBlocked += 1;
    }
    const requiredCount = requiredStageGates.length;
    const passedCount = requiredStageGates.filter((gate) => gate.status === 'PASSED').length;
    const blockedCount = requiredStageGates.filter((gate) => gate.status === 'BLOCKED').length;
    const gatePassRate = requiredCount > 0 ? passedCount / requiredCount : 0;

    const archive = Array.isArray(plan.documentArchive) ? plan.documentArchive : [];
    const verifiedArchive = archive.filter((doc) => {
      if (!doc || typeof doc !== 'object') return false;
      return String((doc as Record<string, unknown>).status || '').toUpperCase() === 'VERIFIED';
    });
    const archiveCount = archive.length;
    const verifiedArchiveCount = verifiedArchive.length;
    totalDocs += archiveCount;
    verifiedDocs += verifiedArchiveCount;
    const verifiedDocRatio = archiveCount > 0 ? verifiedArchiveCount / archiveCount : 0;

    const carbonSummary = plan.carbonSummary as Record<string, unknown> | undefined;
    const carbonReady = Boolean(carbonSummary && carbonSummary.lastResult);
    if (carbonReady) {
      carbonReadyProjects += 1;
    }

    const documentControlGate = requiredStageGates.find((gate) => gate.type === 'DOCUMENT_CONTROL');
    const documentGatePassed = Boolean(documentControlGate && documentControlGate.status === 'PASSED');
    const noBlockedRequiredGates = blockedCount === 0;

    let readinessScore = 100;
    readinessScore -= (1 - gatePassRate) * GATE_PASS_RATE_WEIGHT;
    readinessScore -= (1 - verifiedDocRatio) * VERIFIED_DOC_RATIO_WEIGHT;
    if (!carbonReady) readinessScore -= CARBON_READY_PENALTY;
    if (!documentGatePassed) readinessScore -= DOCUMENT_GATE_PENALTY;
    if (!noBlockedRequiredGates) readinessScore -= BLOCKED_GATES_PENALTY;
    const boundedReadiness = clampScore(readinessScore);
    bankReadinessSum += boundedReadiness;

    if (boundedReadiness >= 75) bankRiskLow += 1;
    else if (boundedReadiness >= 50) bankRiskMedium += 1;
    else bankRiskHigh += 1;

    const taxonomyEligible = requiredCount > 0 || archiveCount > 0;
    if (taxonomyEligible) {
      taxonomyEligibleProjects += 1;
      if (carbonReady && documentGatePassed && noBlockedRequiredGates && verifiedArchiveCount >= 1) {
        taxonomyAlignedProjects += 1;
      }
    }
  }

  const gatePassRatePct = gatesRequired > 0 ? (gatesPassed / gatesRequired) * 100 : 0;
  const verifiedDocCoveragePct = totalDocs > 0 ? (verifiedDocs / totalDocs) * 100 : 0;
  const averageReadinessScore = bankAssessedProjects > 0 ? bankReadinessSum / bankAssessedProjects : 0;
  const taxonomyAlignmentPct =
    taxonomyEligibleProjects > 0 ? (taxonomyAlignedProjects / taxonomyEligibleProjects) * 100 : 0;

  return {
    generatedAt: new Date().toISOString(),
    totals: {
      organisations: organisationCount,
      users: userCount,
      projects: projectCount,
      activeProjects: activeProjectCount,
      indexedProjects: indexedProjects.length,
      documents: documentCount,
      searches: searchCount,
      auditRecords: auditCount,
      planStates: planStateCount,
    },
    documentsByStatus: docsByStatus.map((row: any) => ({
      status: String(row.status),
      count: Number(row._count?._all || 0),
    })),
    jobsByStatus: jobsByStatus.map((row: any) => ({
      status: String(row.status),
      count: Number(row._count?._all || 0),
    })),
    jobsByType: jobsByType.map((row: any) => ({
      type: String(row.type),
      count: Number(row._count?._all || 0),
    })),
    searchPerformance: {
      avgElapsedMs: Number(searchAggregate?._avg?.elapsedMs || 0),
      avgResults: Number(searchAggregate?._avg?.resultCount || 0),
      latestQueryAt: searchAggregate?._max?.createdAt
        ? new Date(searchAggregate._max.createdAt).toISOString()
        : null,
    },
    planning: {
      projectsWithTemplate,
      gatesRequired,
      gatesPassed,
      gatesBlocked,
      carbonReadyProjects,
    },
    bankRisk: {
      modelVersion: 'bank-risk-v1',
      assessedProjects: bankAssessedProjects,
      averageReadinessScore: asRounded(averageReadinessScore),
      gatePassRatePct: asRounded(gatePassRatePct),
      verifiedDocCoveragePct: asRounded(verifiedDocCoveragePct),
      riskBands: {
        low: bankRiskLow,
        medium: bankRiskMedium,
        high: bankRiskHigh,
      },
    },
    euTaxonomy: {
      modelVersion: 'eu-taxonomy-screen-v1',
      eligibleProjects: taxonomyEligibleProjects,
      alignedProjects: taxonomyAlignedProjects,
      alignmentPct: asRounded(taxonomyAlignmentPct),
      criteria: {
        carbonReadyRequired: true,
        documentGatePassedRequired: true,
        noBlockedRequiredGates: true,
        minVerifiedDocsRequired: 1,
      },
    },
    templateUsage: Array.from(templateUsage.entries())
      .map(([templateId, count]) => ({ templateId, count }))
      .sort((a, b) => b.count - a.count || a.templateId.localeCompare(b.templateId)),
  };
}

export async function getAdminExamSummary(): Promise<AdminDashboardSummary> {
  return getAdminDashboardSummary();
}

function toJsonSafe<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_key, currentValue) =>
      typeof currentValue === 'bigint' ? String(currentValue) : currentValue,
    ),
  ) as T;
}

function normalizeLimit(limitPerTable?: number): number {
  const SAFE_MAX_LIMIT = 5000; // Förhindrar OOM-krascher genom att aldrig tillåta obegränsade in-memory dumps
  if (!Number.isFinite(Number(limitPerTable))) {
    return SAFE_MAX_LIMIT;
  }
  const normalized = Number(limitPerTable);
  if (normalized <= 0) {
    return SAFE_MAX_LIMIT;
  }
  return Math.min(Math.floor(normalized), SAFE_MAX_LIMIT);
}

export async function getAdminDatabaseDump(input?: {
  limitPerTable?: number;
  includeSearchText?: boolean;
  includeChunkText?: boolean;
}): Promise<AdminDatabaseDumpResponse> {
  const take = normalizeLimit(input?.limitPerTable);
  const includeSearchText = input?.includeSearchText !== false;
  const includeChunkText = input?.includeChunkText !== false;

  const [
    organisations,
    users,
    projects,
    projectMembers,
    propertyAccessLogs,
    auditTrail,
    projectPlanStates,
    documentRecords,
    documentContents,
    documentChunks,
    searchJobs,
    searchQueryLogs,
  ] = await Promise.all([
    db.organisation.findMany({
      ...(take ? { take } : {}),
      orderBy: { createdAt: 'desc' },
    }),
    db.user.findMany({
      ...(take ? { take } : {}),
      orderBy: { createdAt: 'desc' },
    }),
    db.project.findMany({
      ...(take ? { take } : {}),
      orderBy: { createdAt: 'desc' },
    }),
    db.projectMember.findMany({
      ...(take ? { take } : {}),
      orderBy: { createdAt: 'desc' },
    }),
    db.propertyAccessLog.findMany({
      ...(take ? { take } : {}),
      orderBy: { timestamp: 'desc' },
    }),
    db.auditTrail.findMany({
      ...(take ? { take } : {}),
      orderBy: { timestamp: 'desc' },
    }),
    db.projectPlanState.findMany({
      ...(take ? { take } : {}),
      orderBy: { updatedAt: 'desc' },
    }),
    db.documentRecord.findMany({
      ...(take ? { take } : {}),
      orderBy: { updatedAt: 'desc' },
    }),
    db.documentContent.findMany({
      ...(take ? { take } : {}),
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        documentId: true,
        contentCiphertext: true,
        contentIv: true,
        contentTag: true,
        keyVersion: true,
        ...(includeSearchText ? { searchText: true } : {}),
        createdAt: true,
        updatedAt: true,
      },
    }),
    db.documentChunk.findMany({
      ...(take ? { take } : {}),
      orderBy: [{ documentId: 'asc' }, { chunkIndex: 'asc' }],
      select: {
        id: true,
        documentId: true,
        chunkIndex: true,
        ...(includeChunkText ? { chunkText: true } : {}),
        embeddingJson: true,
        createdAt: true,
      },
    }),
    db.searchJob.findMany({
      ...(take ? { take } : {}),
      orderBy: { createdAt: 'desc' },
    }),
    db.searchQueryLog.findMany({
      ...(take ? { take } : {}),
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  const tables: Record<string, unknown[]> = toJsonSafe({
    organisations,
    users,
    projects,
    projectMembers,
    propertyAccessLogs,
    auditTrail,
    projectPlanStates,
    documentRecords,
    documentContents,
    documentChunks,
    searchJobs,
    searchQueryLogs,
  });

  const countByTable = Object.fromEntries(Object.entries(tables).map(([key, rows]) => [key, rows.length]));

  return {
    generatedAt: new Date().toISOString(),
    countByTable,
    tables,
  };
}

// ─── Threshold constants ─────────────────────────────────────────────────────
// Can be overridden via environment variables at deploy time.
const MIN_REQUIREMENTS = Number(process.env.DB_STATS_MIN_REQUIREMENTS ?? 41_000);
const MIN_MUNICIPALITIES = Number(process.env.DB_STATS_MIN_MUNICIPALITIES ?? 260);
const MIN_DOCUMENTS = Number(process.env.DB_STATS_MIN_DOCUMENTS ?? 3_000);

export async function getDbStats(): Promise<DbStatsResponse> {
  const [
    totalDocuments,
    totalRequirementsFromCases,
    totalRequirementsExtracted,
    documentsByMunicipality,
    requirementCaseRows,
    extractedRequirementRows,
    lmMarkRows,
    lmByggnadRows,
    sguSoilTypeRows,
    sguBlockighetRows,
    sguPunktobjektRows,
  ] = await Promise.all([
    // Documents
    db.documentRecord.count(),

    // Kravrader – structured pipeline (RequirementRecord via RequirementCase)
    db.requirementRecord.count(),

    // Kravrader – Outlook / email-ingestion pipeline (ExtractedRequirement)
    db.extractedRequirement.count(),

    // Documents grouped by normalised municipality
    db.documentRecord.groupBy({
      by: ['municipalityNormalized'],
      _count: { _all: true },
    }),

    // Requirements → municipality via their case
    db.requirementRecord.findMany({
      select: {
        case: {
          select: { municipality: true },
        },
      },
    }),

    // Resolve municipalities from either the extracted row itself or the linked document.
    db.extractedRequirement.findMany({
      select: {
        municipality: true,
        attachment: {
          select: {
            document: {
              select: {
                municipalityNormalized: true,
                municipality: true,
              },
            },
          },
        },
      },
    }),

    // Raw Geodata Counts (LM & SGU)
    db.$queryRaw<any[]>`SELECT count(*)::int as count FROM core.lm_mark`.catch(() => [{ count: 0 }]),
    db.$queryRaw<any[]>`SELECT count(*)::int as count FROM core.lm_byggnad`.catch(() => [{ count: 0 }]),
    db.$queryRaw<any[]>`SELECT count(*)::int as count FROM env.sgu_soil_type`.catch(() => [{ count: 0 }]),
    db.$queryRaw<any[]>`SELECT count(*)::int as count FROM env.sgu_blockighet`.catch(() => [{ count: 0 }]),
    db.$queryRaw<any[]>`SELECT count(*)::int as count FROM env.sgu_punktobjekt`.catch(() => [{ count: 0 }]),
  ]);

  const lmMarkCount = Number(lmMarkRows?.[0]?.count ?? 0);
  const lmByggnadCount = Number(lmByggnadRows?.[0]?.count ?? 0);
  const sguJordarterCount = Number(sguSoilTypeRows?.[0]?.count ?? 0);
  const sguBlockighetCount = Number(sguBlockighetRows?.[0]?.count ?? 0);
  const sguPunktobjektCount = Number(sguPunktobjektRows?.[0]?.count ?? 0);

  // ── Build per-municipality document counts ───────────────────────────────
  const docMap = new Map<string, number>();
  for (const row of documentsByMunicipality) {
    const key: string = (row.municipalityNormalized as string | null) ?? '(okänd)';
    docMap.set(key, Number(row._count._all));
  }

  // ── Build per-municipality requirement counts ────────────────────────────
  const reqMap = new Map<string, number>();
  // From RequirementRecord (via case)
  for (const row of requirementCaseRows) {
    const mun: string = (row.case?.municipality as string | null) ?? '(okänd)';
    reqMap.set(mun, (reqMap.get(mun) ?? 0) + 1);
  }
  // From ExtractedRequirement – count against the same municipality view as documents
  // by preferring the linked document's normalized municipality when available.
  const extractedMunicipalities = new Set<string>();
  for (const row of extractedRequirementRows) {
    const municipality = resolveExtractedRequirementMunicipality(row);
    extractedMunicipalities.add(municipality);
    reqMap.set(municipality, (reqMap.get(municipality) ?? 0) + 1);
  }

  // ── Combine municipality sets ────────────────────────────────────────────
  const allMunicipalities = new Set<string>([...docMap.keys(), ...reqMap.keys(), ...extractedMunicipalities]);

  const perMunicipality: DbStatsResponse['perMunicipality'] = Array.from(allMunicipalities)
    .map((mun) => ({
      municipality: mun,
      documents: docMap.get(mun) ?? 0,
      requirements: reqMap.get(mun) ?? 0,
    }))
    .sort((a, b) => b.documents + b.requirements - (a.documents + a.requirements));

  const totalMunicipalities = perMunicipality.filter((r) => r.municipality !== '(okänd)').length;
  const totalRequirements = totalRequirementsFromCases + totalRequirementsExtracted;

  // ── Threshold validation ─────────────────────────────────────────────────
  const requirementsOk = totalRequirements >= MIN_REQUIREMENTS;
  const municipalitiesOk = totalMunicipalities >= MIN_MUNICIPALITIES;
  const documentsOk = totalDocuments >= MIN_DOCUMENTS;

  return {
    generatedAt: new Date().toISOString(),
    totals: {
      documents: totalDocuments,
      requirementsFromCases: totalRequirementsFromCases,
      requirementsExtracted: totalRequirementsExtracted,
      requirements: totalRequirements,
      municipalities: totalMunicipalities,
    },
    thresholds: {
      minRequirements: MIN_REQUIREMENTS,
      minMunicipalities: MIN_MUNICIPALITIES,
      minDocuments: MIN_DOCUMENTS,
      requirementsOk,
      municipalitiesOk,
      documentsOk,
      allOk: requirementsOk && municipalitiesOk && documentsOk,
    },
    perMunicipality,
    geodata: {
      lmMarkCount,
      lmByggnadCount,
      sguJordarterCount,
      sguBlockighetCount,
      sguPunktobjektCount,
    },
  };
}

export async function getDbAnalysis(): Promise<DbAnalysisResponse> {
  const [
    reqByCategory,
    reqByCodingConfidence,
    reqByLevel,
    reqByStatus,
    municipalitySpecificCount,
    minimumRequirementCount,
    citationsTotal,
    // For requirements-with-citations we need distinct requirementIds in citations
    citationDistinctReqIds,

    docByStatus,
    docByDecisionType,
    docByLegalStatus,
    // For confidence buckets we fetch all confidence values
    docConfidenceRows,

    // Coverage: how many documents have at least one RequirementRecord
    docsWithReqs,
    docsWithExtractedReqs,

    // Per-municipality sets for gap analysis
    docMunicipalityRows,
    reqMunicipalityRows,
    extractedRequirementRowsForCoverage,

    // ExtractedRequirement analytics
    extByCategory,
    extByLevel,
    extConfidenceRows,
  ] = await Promise.all([
    // ── RequirementRecord analytics ────────────────────────────────────────
    db.requirementRecord.groupBy({ by: ['category'], _count: { _all: true } }),
    db.requirementRecord.groupBy({ by: ['codingConfidence'], _count: { _all: true } }),
    db.requirementRecord.groupBy({ by: ['level'], _count: { _all: true } }),
    db.requirementRecord.groupBy({ by: ['statusInNotification'], _count: { _all: true } }),
    db.requirementRecord.count({ where: { municipalitySpecific: true } }),
    db.requirementRecord.count({ where: { minimumRequirement: true } }),
    db.requirementCitation.count(),
    db.requirementCitation.findMany({ select: { requirementId: true }, distinct: ['requirementId'] }),

    // ── DocumentRecord analytics ───────────────────────────────────────────
    db.documentRecord.groupBy({ by: ['status'], _count: { _all: true } }),
    db.documentRecord.groupBy({ by: ['decisionType'], _count: { _all: true } }),
    db.documentRecord.groupBy({ by: ['legalStatus'], _count: { _all: true } }),
    db.documentRecord.findMany({ select: { municipalityConfidence: true } }),

    // ── Coverage analysis ─────────────────────────────────────────────────
    db.documentRecord.findMany({
      select: { id: true },
      where: { requirements: { some: {} } },
    }),
    db.extractedRequirement.findMany({
      where: {
        attachment: {
          document: {
            isNot: null,
          },
        },
      },
      select: {
        attachment: {
          select: {
            documentId: true,
            document: {
              select: {
                municipalityNormalized: true,
                municipality: true,
              },
            },
          },
        },
      },
    }),

    // Per-municipality for gap analysis
    db.documentRecord.findMany({
      where: { municipalityNormalized: { not: null } },
      select: { municipalityNormalized: true },
      distinct: ['municipalityNormalized'],
    }),
    db.requirementRecord.findMany({
      select: { case: { select: { municipality: true } } },
    }),
    db.extractedRequirement.findMany({
      select: {
        municipality: true,
        attachment: {
          select: {
            document: {
              select: {
                municipalityNormalized: true,
                municipality: true,
              },
            },
          },
        },
      },
    }),
    // ── ExtractedRequirement analytics ────────────────────────────────────
    db.extractedRequirement.groupBy({ by: ['category'], _count: { _all: true } }),
    db.extractedRequirement.groupBy({ by: ['requirementLevel'], _count: { _all: true } }),
    db.extractedRequirement.findMany({ select: { confidence: true } }),
  ]);

  // ── Requirements ────────────────────────────────────────────────────────
  const withCitationsCount = citationDistinctReqIds.length;

  // ── Documents – confidence buckets ──────────────────────────────────────
  let confHigh = 0,
    confMedium = 0,
    confLow = 0,
    confMissing = 0;
  for (const row of docConfidenceRows) {
    const v = row.municipalityConfidence as number | null;
    if (v === null || v === undefined) {
      confMissing++;
    } else if (v >= 0.8) {
      confHigh++;
    } else if (v >= 0.5) {
      confMedium++;
    } else {
      confLow++;
    }
  }

  // ── Coverage ─────────────────────────────────────────────────────────────
  // Affärsrelevans: Dessa KPI:er mäter plattformens kärnvärde – förmågan att
  // omvandla ostrukturerad data till strukturerad "Regulatorisk Intelligence".
  const totalDocuments = docConfidenceRows.length;
  const documentsWithRequirements = new Set<string>([
    ...docsWithReqs.map((row: { id: string }) => row.id),
    ...docsWithExtractedReqs
      .map((row: { attachment?: { documentId?: string | null } | null }) => row.attachment?.documentId)
      .filter((id): id is string => Boolean(id)),
  ]).size;
  const documentsWithoutRequirements = totalDocuments - documentsWithRequirements;
  const coverageRatioPct =
    totalDocuments > 0 ? Number(((documentsWithRequirements / totalDocuments) * 100).toFixed(1)) : 0;
  const avgRequirementsPerCoveredDocument =
    documentsWithRequirements > 0
      ? Number(
          (
            reqByCategory.reduce(
              (s: number, r: { category: string; _count: { _all: number } }) => s + r._count._all,
              0,
            ) / documentsWithRequirements
          ).toFixed(1),
        )
      : 0;

  // ── Gap analysis ─────────────────────────────────────────────────────────
  // Identifierar "vita fläckar" i marknadspenetrationen per kommun.
  const docMuns = new Set<string>(
    docMunicipalityRows
      .filter((r): r is { municipalityNormalized: string } => Boolean(r.municipalityNormalized))
      .map((r) => r.municipalityNormalized),
  );
  const reqMuns = new Set<string>(
    reqMunicipalityRows
      .filter((r): r is { case: { municipality: string } } => Boolean(r.case?.municipality))
      .map((r) => r.case!.municipality),
  );
  for (const row of extractedRequirementRowsForCoverage) {
    reqMuns.add(resolveExtractedRequirementMunicipality(row));
  }
  // Union av alla kommuner som nämns i antingen dokument eller krav för att hitta diskrepanser.
  const allNamedMuns = new Set<string>([...docMuns, ...reqMuns]);
  const municipalitiesWithBoth = [...allNamedMuns].filter((m) => docMuns.has(m) && reqMuns.has(m)).length;
  const municipalitiesDocumentsOnly = [...allNamedMuns]
    .filter((m) => docMuns.has(m) && !reqMuns.has(m))
    .sort();
  const municipalitiesRequirementsOnly = [...allNamedMuns]
    .filter((m) => reqMuns.has(m) && !docMuns.has(m))
    .sort();

  // ── ExtractedRequirement – confidence buckets ────────────────────────────
  let extHigh = 0,
    extMedium = 0,
    extLow = 0;
  for (const row of extConfidenceRows) {
    const v = row.confidence as number;
    if (v >= 0.8) {
      extHigh++;
    } else if (v >= 0.5) {
      extMedium++;
    } else {
      extLow++;
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    requirements: {
      byCategory: reqByCategory
        .map((r: any) => ({ category: String(r.category), count: Number(r._count._all) }))
        .sort((a, b) => b.count - a.count),
      byCodingConfidence: reqByCodingConfidence
        .map((r: any) => ({ confidence: String(r.codingConfidence), count: Number(r._count._all) }))
        .sort((a, b) => b.count - a.count),
      byLevel: reqByLevel
        .map((r: any) => ({ level: String(r.level), count: Number(r._count._all) }))
        .sort((a, b) => b.count - a.count),
      byStatus: reqByStatus
        .map((r: any) => ({ status: String(r.statusInNotification), count: Number(r._count._all) }))
        .sort((a, b) => b.count - a.count),
      municipalitySpecificCount,
      minimumRequirementCount,
      withCitationsCount,
      citationsTotal,
    },
    documents: {
      byStatus: docByStatus
        .map((r: any) => ({ status: String(r.status), count: Number(r._count._all) }))
        .sort((a, b) => b.count - a.count),
      byDecisionType: docByDecisionType
        .map((r: any) => ({
          decisionType: String(r.decisionType ?? '(okänd)'),
          count: Number(r._count._all),
        }))
        .sort((a, b) => b.count - a.count),
      byLegalStatus: docByLegalStatus
        .map((r: any) => ({ legalStatus: String(r.legalStatus ?? '(okänd)'), count: Number(r._count._all) }))
        .sort((a, b) => b.count - a.count),
      municipalityConfidenceBuckets: {
        high: confHigh,
        medium: confMedium,
        low: confLow,
        missing: confMissing,
      },
    },
    coverage: {
      documentsWithRequirements,
      documentsWithoutRequirements,
      coverageRatioPct,
      avgRequirementsPerCoveredDocument,
      municipalitiesWithBoth,
      municipalitiesDocumentsOnly,
      municipalitiesRequirementsOnly,
    },
    extractedRequirements: {
      byCategory: extByCategory
        .map((r: any) => ({ category: String(r.category), count: Number(r._count._all) }))
        .sort((a, b) => b.count - a.count),
      byLevel: extByLevel
        .map((r: any) => ({ level: String(r.requirementLevel), count: Number(r._count._all) }))
        .sort((a, b) => b.count - a.count),
      confidenceBuckets: { high: extHigh, medium: extMedium, low: extLow },
    },
  };
}

export async function getDbContents(limit = 10): Promise<DbContentsResponse> {
  const safeLimit = Math.min(Math.max(1, limit), 50);

  const [
    orgTotal,
    orgRows,
    projTotal,
    projRows,
    docTotal,
    docRows,
    caseTotal,
    caseRows,
    reqTotal,
    reqRows,
    extTotal,
    extRows,
    emailTotal,
    emailRows,
    pipeTotal,
    pipeRows,
  ] = await Promise.all([
    // Organisations
    db.organisation.count(),
    db.organisation.findMany({
      take: safeLimit,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        orgNumber: true,
        createdAt: true,
        _count: { select: { users: true, projects: true } },
      },
    }),

    // Projects
    db.project.count(),
    db.project.findMany({
      take: safeLimit,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        propertyDesignation: true,
        status: true,
        createdAt: true,
        organisation: { select: { name: true } },
        _count: { select: { documents: true, requirements: true } },
      },
    }),

    // Documents
    db.documentRecord.count(),
    db.documentRecord.findMany({
      take: safeLimit,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        subject: true,
        status: true,
        municipalityNormalized: true,
        decisionType: true,
        legalStatus: true,
        fileSize: true,
        createdAt: true,
      },
    }),

    // RequirementCases
    db.requirementCase.count(),
    db.requirementCase.findMany({
      take: safeLimit,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        caseKey: true,
        municipality: true,
        authorityType: true,
        documentType: true,
        caseReviewStatus: true,
        createdAt: true,
        _count: { select: { requirements: true } },
      },
    }),

    // RequirementRecords
    db.requirementRecord.count(),
    db.requirementRecord.findMany({
      take: safeLimit,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        requirementCode: true,
        category: true,
        subcategory: true,
        level: true,
        codingConfidence: true,
        statusInNotification: true,
        minimumRequirement: true,
        createdAt: true,
      },
    }),

    // ExtractedRequirements
    db.extractedRequirement.count(),
    db.extractedRequirement.findMany({
      take: safeLimit,
      orderBy: { parsedAt: 'desc' },
      select: {
        id: true,
        municipality: true,
        attachment: {
          select: {
            documentId: true,
            document: {
              select: {
                municipalityNormalized: true,
                municipality: true,
              },
            },
          },
        },
        category: true,
        subcategory: true,
        requirementLevel: true,
        confidence: true,
        parsedAt: true,
      },
    }),

    // EmailMessages
    db.emailMessage.count(),
    db.emailMessage.findMany({
      take: safeLimit,
      orderBy: { receivedAt: 'desc' },
      select: {
        messageId: true,
        sender: true,
        subject: true,
        status: true,
        receivedAt: true,
        _count: { select: { attachments: true } },
      },
    }),

    // PipelineRuns
    db.pipelineRun.count(),
    db.pipelineRun.findMany({
      take: safeLimit,
      orderBy: { startedAt: 'desc' },
      select: {
        runId: true,
        status: true,
        processedCount: true,
        errorCount: true,
        startedAt: true,
        finishedAt: true,
      },
    }),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    limit: safeLimit,

    organisations: {
      total: orgTotal,
      rows: orgRows.map((r: any) => ({
        id: r.id,
        name: r.name,
        orgNumber: r.orgNumber,
        createdAt: r.createdAt.toISOString(),
        userCount: r._count.users,
        projectCount: r._count.projects,
      })),
    },

    projects: {
      total: projTotal,
      rows: projRows.map((r: any) => ({
        id: r.id,
        propertyDesignation: r.propertyDesignation,
        status: String(r.status),
        organisationName: r.organisation?.name ?? '(okänd)',
        createdAt: r.createdAt.toISOString(),
        documentCount: r._count.documents,
        requirementCount: r._count.requirements,
      })),
    },

    documents: {
      total: docTotal,
      rows: docRows.map((r: any) => ({
        id: r.id,
        subject: r.subject,
        status: String(r.status),
        municipality: r.municipalityNormalized ?? null,
        decisionType: r.decisionType ?? null,
        legalStatus: r.legalStatus ?? null,
        fileSize: r.fileSize !== null && r.fileSize !== undefined ? Number(r.fileSize) : null,
        createdAt: r.createdAt.toISOString(),
      })),
    },

    requirementCases: {
      total: caseTotal,
      rows: caseRows.map((r: any) => ({
        id: r.id,
        caseKey: r.caseKey,
        municipality: r.municipality ?? null,
        authorityType: r.authorityType ?? null,
        documentType: r.documentType ?? null,
        reviewStatus: r.caseReviewStatus,
        requirementCount: r._count.requirements,
        createdAt: r.createdAt.toISOString(),
      })),
    },

    requirements: {
      total: reqTotal,
      rows: reqRows.map((r: any) => ({
        id: r.id,
        requirementCode: r.requirementCode,
        category: r.category,
        subcategory: r.subcategory,
        level: r.level,
        codingConfidence: r.codingConfidence,
        statusInNotification: r.statusInNotification,
        minimumRequirement: r.minimumRequirement,
        createdAt: r.createdAt.toISOString(),
      })),
    },

    extractedRequirements: {
      total: extTotal,
      rows: extRows.map((r: any) => ({
        id: r.id,
        municipality: resolveExtractedRequirementMunicipality(r),
        documentId: r.attachment?.documentId ?? null,
        category: r.category,
        subcategory: r.subcategory ?? null,
        requirementLevel: r.requirementLevel,
        confidence: Number(r.confidence),
        parsedAt: r.parsedAt.toISOString(),
      })),
    },

    emailMessages: {
      total: emailTotal,
      rows: emailRows.map((r: any) => ({
        messageId: r.messageId,
        sender: r.sender ?? null,
        subject: r.subject ?? null,
        status: r.status,
        attachmentCount: r._count?.attachments ?? 0,
        createdAt: r.receivedAt ? r.receivedAt.toISOString() : null,
      })),
    },

    pipelineRuns: {
      total: pipeTotal,
      rows: pipeRows.map((r: any) => ({
        id: r.runId,
        status: r.status,
        messagesIngested: r.processedCount ?? null,
        // Note: 'requirementsExtracted' is not directly available in PipelineRun model.
        // The previous mapping of 'errorCount' to 'requirementsExtracted' was semantically incorrect.
        errors: r.errorCount ?? null, // Represents the number of errors during the pipeline run
        startedAt: r.startedAt.toISOString(),
        finishedAt: r.finishedAt ? r.finishedAt.toISOString() : null,
      })),
    },
  };
}

export async function getAppStatus(): Promise<AppStatusResponse> {
  const checkedAt = new Date().toISOString();

  // ── 1. Database ping with latency ────────────────────────────────────────
  let dbStatus: 'ok' | 'error' = 'error';
  let dbLatencyMs: number | null = null;
  try {
    const t0 = Date.now();
    await db.$queryRaw`SELECT 1`;
    dbLatencyMs = Date.now() - t0;
    dbStatus = 'ok';
  } catch (e) {
    console.error('Database health check failed:', e);
    // dbStatus stays 'error'
  }

  // ── 2. Datasource summary (cached — no forceRefresh) ────────────────────
  let dsTotal = 0;
  let dsConnected = 0;
  let dsErrors = 0;
  let dsPermitRequired = 0;
  let allOpenSourcesActive = false;
  try {
    const summary = await getPublicDatasourceSummary(false);
    const cards = summary.cards;
    dsTotal = cards.length;
    dsConnected = cards.filter((c: any) => c.status === 'CONNECTED').length;
    dsErrors = cards.filter((c: any) => c.status === 'ERROR').length;
    dsPermitRequired = cards.filter((c: any) => c.activation === 'PERMIT_REQUIRED').length;
    const immediateCards = cards.filter((c: any) => c.activation === 'IMMEDIATE');
    allOpenSourcesActive =
      immediateCards.length === 0 || immediateCards.every((c: any) => c.status === 'CONNECTED');
  } catch (e) {
    console.error('Hämtning av datakällans sammanfattning misslyckades:', e);
    // datasource summary is best-effort
  }

  // ── 3. Overall health ───────────────────────────────────────────────────
  const overall: 'ok' | 'degraded' | 'error' =
    dbStatus === 'error' ? 'error' : !allOpenSourcesActive || dsErrors > 0 ? 'degraded' : 'ok';

  return {
    checkedAt,
    overall,
    app: {
      status: 'ok',
      version: process.env.npm_package_version ?? 'unknown',
      uptimeSeconds: Math.floor(process.uptime()),
      environment: process.env.NODE_ENV ?? 'unknown',
    },
    db: {
      status: dbStatus,
      latencyMs: dbLatencyMs,
    },
    datasources: {
      total: dsTotal,
      connected: dsConnected,
      errors: dsErrors,
      permitRequired: dsPermitRequired,
      allOpenSourcesActive,
    },
  };
}

export async function getAppCompletion(): Promise<AppCompletionResponse> {
  return computeAppCompletion();
}

export async function getExternalHealth(): Promise<ExternalHealthReport> {
  return getExternalHealthReport();
}
