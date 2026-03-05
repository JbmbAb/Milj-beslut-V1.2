import { prisma } from "../db/prisma";
import type { AdminDatabaseDumpResponse, AdminExamSummary, ProjectStageGate } from "../../types";

const db = prisma as any;

function isGate(value: unknown): value is ProjectStageGate {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ProjectStageGate>;
  return Boolean(candidate.type) && Boolean(candidate.status);
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function asRounded(value: number): number {
  return Number(value.toFixed(1));
}

export async function getAdminExamSummary(): Promise<AdminExamSummary> {
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
    db.project.count({ where: { status: "ACTIVE" } }),
    db.documentRecord.findMany({
      select: { projectId: true },
      distinct: ["projectId"],
    }),
    db.documentRecord.count(),
    db.searchQueryLog.count(),
    db.auditTrail.count(),
    db.projectPlanState.count(),
    db.documentRecord.groupBy({
      by: ["status"],
      _count: { _all: true },
    }),
    db.searchJob.groupBy({
      by: ["status"],
      _count: { _all: true },
    }),
    db.searchJob.groupBy({
      by: ["type"],
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

  for (const row of planStates) {
    const plan = row.plan as Record<string, unknown> | null;
    if (!plan || typeof plan !== "object") continue;
    bankAssessedProjects += 1;

    const templateId = typeof plan.templateId === "string" ? plan.templateId : "";
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
      if (gateCandidate.status === "PASSED") gatesPassed += 1;
      if (gateCandidate.status === "BLOCKED") gatesBlocked += 1;
    }
    const requiredCount = requiredStageGates.length;
    const passedCount = requiredStageGates.filter((gate) => gate.status === "PASSED").length;
    const blockedCount = requiredStageGates.filter((gate) => gate.status === "BLOCKED").length;
    const gatePassRate = requiredCount > 0 ? passedCount / requiredCount : 0;

    const archive = Array.isArray(plan.documentArchive) ? plan.documentArchive : [];
    const verifiedArchive = archive.filter((doc) => {
      if (!doc || typeof doc !== "object") return false;
      return String((doc as Record<string, unknown>).status || "").toUpperCase() === "VERIFIED";
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

    const documentControlGate = requiredStageGates.find((gate) => gate.type === "DOCUMENT_CONTROL");
    const documentGatePassed = Boolean(documentControlGate && documentControlGate.status === "PASSED");
    const noBlockedRequiredGates = blockedCount === 0;

    let readinessScore = 100;
    readinessScore -= (1 - gatePassRate) * 45;
    readinessScore -= (1 - verifiedDocRatio) * 25;
    if (!carbonReady) readinessScore -= 10;
    if (!documentGatePassed) readinessScore -= 10;
    if (!noBlockedRequiredGates) readinessScore -= 10;
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
      latestQueryAt: searchAggregate?._max?.createdAt ? new Date(searchAggregate._max.createdAt).toISOString() : null,
    },
    planning: {
      projectsWithTemplate,
      gatesRequired,
      gatesPassed,
      gatesBlocked,
      carbonReadyProjects,
    },
    bankRisk: {
      modelVersion: "bank-risk-v1",
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
      modelVersion: "eu-taxonomy-screen-v1",
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

function toJsonSafe<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_key, currentValue) => (typeof currentValue === "bigint" ? String(currentValue) : currentValue))
  ) as T;
}

function normalizeLimit(limitPerTable?: number): number | undefined {
  if (!Number.isFinite(Number(limitPerTable))) {
    return undefined;
  }
  const normalized = Number(limitPerTable);
  if (normalized <= 0) {
    return undefined;
  }
  return Math.min(Math.floor(normalized), 100_000);
}

export async function getAdminDatabaseDump(input?: {
  limitPerTable?: number;
  includeSearchText?: boolean;
  includeChunkText?: boolean;
}): Promise<AdminDatabaseDumpResponse> {
  const take = normalizeLimit(input?.limitPerTable);
  const includeSearchText = input?.includeSearchText !== false;
  const includeChunkText = input?.includeChunkText !== false;

  const [organisations, users, projects, projectMembers, propertyAccessLogs, auditTrail, projectPlanStates, documentRecords, documentContents, documentChunks, searchJobs, searchQueryLogs] =
    await Promise.all([
      db.organisation.findMany({
        ...(take ? { take } : {}),
        orderBy: { createdAt: "desc" },
      }),
      db.user.findMany({
        ...(take ? { take } : {}),
        orderBy: { createdAt: "desc" },
      }),
      db.project.findMany({
        ...(take ? { take } : {}),
        orderBy: { createdAt: "desc" },
      }),
      db.projectMember.findMany({
        ...(take ? { take } : {}),
        orderBy: { createdAt: "desc" },
      }),
      db.propertyAccessLog.findMany({
        ...(take ? { take } : {}),
        orderBy: { timestamp: "desc" },
      }),
      db.auditTrail.findMany({
        ...(take ? { take } : {}),
        orderBy: { timestamp: "desc" },
      }),
      db.projectPlanState.findMany({
        ...(take ? { take } : {}),
        orderBy: { updatedAt: "desc" },
      }),
      db.documentRecord.findMany({
        ...(take ? { take } : {}),
        orderBy: { updatedAt: "desc" },
      }),
      db.documentContent.findMany({
        ...(take ? { take } : {}),
        orderBy: { updatedAt: "desc" },
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
        orderBy: [{ documentId: "asc" }, { chunkIndex: "asc" }],
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
        orderBy: { createdAt: "desc" },
      }),
      db.searchQueryLog.findMany({
        ...(take ? { take } : {}),
        orderBy: { createdAt: "desc" },
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
