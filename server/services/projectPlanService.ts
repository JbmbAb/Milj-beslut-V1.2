import type {
  CarbonInput,
  DriverJournalStatus,
  LimsSourceType,
  MapLayerKey,
  ProjectPlan,
  ProjectType,
} from "../../types";
import {
  PROJECT_STRUCTURE_SCHEMA_VERSION,
  applyCarbonToPlan,
  applyTemplate,
  calculateCarbon,
  evaluateStageGate,
  normalizeProjectPlan,
  recommendMapLayers,
} from "../../services/projectStructure";
import { calculatePredictiveScores } from "../../services/predictiveScoringService";
import { getStoredProjectPlan } from "../repositories/projectPlanRepository";
import {
  createDispatchQuote,
  createTransportBooking,
  signDriverJournal,
  upsertDriverJournal,
} from "./transportDispatchService";
import { createLimsReport, verifyLimsReport } from "./limsService";
import { prisma } from "../db/prisma";
import { logger } from "../logger";

// Runtime cache + persistent database storage.
// Cache reduces repetitive reads while DB remains source of truth for server-side state.
const projectPlanStore = new Map<string, ProjectPlan>();
const gateEvaluationDedup = new Set<string>();
let dbPlanStorageAvailable: boolean | null = null;

function markDbStorageError(error: unknown) {
  if (dbPlanStorageAvailable === false) return;
  dbPlanStorageAvailable = false;
  const message = error instanceof Error ? error.message : "unknown error";
  logger.warn('project-plan: persistent storage unavailable, using memory fallback', { message });
}

async function loadPlanFromDb(projectId: string, organisationId: string): Promise<ProjectPlan | null> {
  if (dbPlanStorageAvailable === false) return null;
  try {
    const stored = await getStoredProjectPlan(projectId, organisationId);
    dbPlanStorageAvailable = true;
    return stored ? normalizeProjectPlan(stored) : null;
  } catch (error: unknown) {
    markDbStorageError(error);
    return null;
  }
}

async function persistPlan(projectId: string, organisationId: string, plan: ProjectPlan): Promise<ProjectPlan> {
  const planWithScores: ProjectPlan = {
    ...plan,
    predictiveScores: calculatePredictiveScores(plan, plan.carbonSummary.lastResult),
  };

  projectPlanStore.set(projectId, planWithScores);
  if (dbPlanStorageAvailable === false) {
    return planWithScores;
  }
  try {
    // Replace upsertStoredProjectPlan with prisma.projectPlanState.upsert
    // Use direct prisma calls but enforce organisationId for safety
    await prisma.projectPlanState.upsert({
      where: { projectId: projectId },
      create: {
        projectId: projectId,
        plan: planWithScores as any,
        schemaVersion: PROJECT_STRUCTURE_SCHEMA_VERSION,
      },
      update: {
        plan: planWithScores as any,
        schemaVersion: PROJECT_STRUCTURE_SCHEMA_VERSION,
      },
    });

    // Verify project belongs to org during update
    await prisma.project.update({
      where: { 
        id: projectId,
        organisationId: organisationId
      },
      data: {
        complianceScore: planWithScores.complianceScore,
        fundingRating: planWithScores.predictiveScores?.fundingRisk.rating,
        regulatoryRiskScore: planWithScores.predictiveScores?.regulatoryRisk.score,
        environmentalScore: planWithScores.predictiveScores?.environmentalRisk.score,
      },
    });

    dbPlanStorageAvailable = true;
  } catch (error: unknown) {
    markDbStorageError(error);
  }
  return planWithScores;
}

async function getOrCreatePlan(projectId: string, organisationId: string, incomingPlan?: Partial<ProjectPlan>): Promise<ProjectPlan> {
  if (incomingPlan) {
    const normalized = normalizeProjectPlan(incomingPlan);
    await persistPlan(projectId, organisationId, normalized);
    return normalized;
  }

  const existing = projectPlanStore.get(projectId);
  if (existing) {
    return existing;
  }

  const fromDb = await loadPlanFromDb(projectId, organisationId);
  if (fromDb) {
    projectPlanStore.set(projectId, fromDb);
    return fromDb;
  }

  const created = normalizeProjectPlan(null);
  await persistPlan(projectId, organisationId, created);
  return created;
}

export async function getProjectPlanSnapshot(projectId: string, organisationId: string): Promise<ProjectPlan | null> {
  if (projectPlanStore.has(projectId)) {
    return projectPlanStore.get(projectId) || null;
  }
  return loadPlanFromDb(projectId, organisationId);
}

export async function saveProjectPlanSnapshot(input: {
  projectId: string;
  organisationId: string;
  plan?: Partial<ProjectPlan>;
}): Promise<ProjectPlan> {
  return getOrCreatePlan(input.projectId, input.organisationId, input.plan);
}

export async function applyTemplateForProject(input: {
  projectId: string;
  organisationId: string;
  templateId: string;
  plan?: Partial<ProjectPlan>;
}) {
  const current = await getOrCreatePlan(input.projectId, input.organisationId, input.plan);
  const next = applyTemplate(current, input.templateId);
  await persistPlan(input.projectId, input.organisationId, next);
  return next;
}

export async function evaluateGateForProject(input: {
  projectId: string;
  organisationId: string;
  gateId: string;
  plan?: Partial<ProjectPlan>;
  context?: {
    permitType?: string;
    codeType?: "SNI" | "EWC";
    permitSubmitted?: boolean;
    mapLayerAvailable?: MapLayerKey[];
    note?: string;
  };
}) {
  const current = await getOrCreatePlan(input.projectId, input.organisationId, input.plan);
  const evaluated = evaluateStageGate(current, input.gateId, input.context);
  const evalHash = evaluated.gate.lastEvaluationHash || "no-hash";
  const dedupKey = `${input.projectId}:${evaluated.gate.id}:${evalHash}`;
  const idempotent = !evaluated.changed || gateEvaluationDedup.has(dedupKey);

  if (!idempotent) {
    gateEvaluationDedup.add(dedupKey);
  }

  if (evaluated.changed) {
    await persistPlan(input.projectId, input.organisationId, evaluated.plan);
  }

  return {
    ...evaluated,
    idempotent,
  };
}

export async function calculateCarbonForProject(input: {
  projectId: string;
  organisationId: string;
  carbonInput: CarbonInput;
  plan?: Partial<ProjectPlan>;
}) {
  const current = await getOrCreatePlan(input.projectId, input.organisationId, input.plan);
  const result = calculateCarbon(input.carbonInput);
  const next = applyCarbonToPlan(current, input.carbonInput, result);
  await persistPlan(input.projectId, input.organisationId, next);
  return {
    plan: next,
    result,
  };
}

export async function recommendMapLayersForProject(input: {
  projectId: string;
  organisationId: string;
  projectType?: ProjectType;
  plan?: Partial<ProjectPlan>;
}) {
  const current = await getOrCreatePlan(input.projectId, input.organisationId, input.plan);
  const projectType = input.projectType || current.projectType || "ENV_PERMIT";
  const recommendation = recommendMapLayers(projectType);
  const next = {
    ...current,
    projectType,
    mapLayerSelection: recommendation,
  };
  await persistPlan(input.projectId, input.organisationId, next);
  return {
    plan: next,
    recommendation,
  };
}

export async function createDispatchQuoteForProject(input: {
  projectId: string;
  organisationId: string;
  receiverId: string;
  receiverName: string;
  wasteCode: string;
  tons: number;
  distanceKm?: number;
  plan?: Partial<ProjectPlan>;
}) {
  const current = await getOrCreatePlan(input.projectId, input.organisationId, input.plan);
  const quote = createDispatchQuote({
    receiverId: input.receiverId,
    receiverName: input.receiverName,
    wasteCode: input.wasteCode,
    tons: input.tons,
    distanceKm: input.distanceKm,
  });
  const next = {
    ...current,
    dispatchQuotes: [quote, ...current.dispatchQuotes.filter((item) => item.id !== quote.id)],
  };
  await persistPlan(input.projectId, input.organisationId, next);
  return {
    plan: next,
    quote,
  };
}

export async function bookTransportForProject(input: {
  projectId: string;
  organisationId: string;
  quoteId: string;
  plannedPickupAt?: string;
  plan?: Partial<ProjectPlan>;
}) {
  const current = await getOrCreatePlan(input.projectId, input.organisationId, input.plan);
  const quote = current.dispatchQuotes.find((item) => item.id === input.quoteId);
  if (!quote) {
    throw new Error("Dispatch quote not found");
  }

  const booking = await createTransportBooking(quote, {
    plannedPickupAt: input.plannedPickupAt,
  });
  const next = {
    ...current,
    transportBookings: [booking, ...current.transportBookings.filter((item) => item.id !== booking.id)],
  };
  await persistPlan(input.projectId, input.organisationId, next);
  return {
    plan: next,
    booking,
  };
}

export async function upsertDriverJournalForProject(input: {
  projectId: string;
  organisationId: string;
  journal: {
    id?: string;
    bookingId: string;
    driverName: string;
    vehicleId: string;
    origin: string;
    destination: string;
    wasteCode: string;
    tons: number;
    startedAt?: string;
    endedAt?: string | null;
    odometerStartKm: number;
    odometerEndKm?: number | null;
    gpsTrackHash?: string;
    status?: DriverJournalStatus;
  };
  plan?: Partial<ProjectPlan>;
}) {
  const current = await getOrCreatePlan(input.projectId, input.organisationId, input.plan);
  const booking = current.transportBookings.find((item) => item.id === input.journal.bookingId);
  if (!booking) {
    throw new Error("Transport booking not found");
  }

  const updated = await upsertDriverJournal({
    journal: {
      ...input.journal,
      wasteCode: input.journal.wasteCode || booking.wasteCode,
      tons: input.journal.tons || booking.tons,
    },
  });
  const next = {
    ...current,
    driverJournals: [updated, ...current.driverJournals.filter((item) => item.id !== updated.id)],
  };
  await persistPlan(input.projectId, input.organisationId, next);
  return {
    plan: next,
    journal: updated,
  };
}

export async function signDriverJournalForProject(input: {
  projectId: string;
  organisationId: string;
  journalId: string;
  signerRole: "DRIVER" | "REVIEWER";
  signatureId: string;
  plan?: Partial<ProjectPlan>;
}) {
  const current = await getOrCreatePlan(input.projectId, input.organisationId, input.plan);
  const existing = current.driverJournals.find((item) => item.id === input.journalId);
  if (!existing) {
    throw new Error("Driver journal not found");
  }

  const signed = await signDriverJournal({
    journalId: existing.id,
    signerRole: input.signerRole,
    signatureId: input.signatureId,
  });

  const signatureAuditEntry = {
    id: `PLAN-SIGN-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    timestamp: new Date().toISOString(),
    user: input.signerRole === "DRIVER" ? "Driver" : "Reviewer",
    action: "DRIVER_JOURNAL_SIGN",
    details: `Journal ${signed.id} signed by ${input.signerRole.toLowerCase()}.`,
    immutable: true,
    signatureId: input.signatureId,
  };

  const next = {
    ...current,
    driverJournals: current.driverJournals.map((item) => (item.id === signed.id ? signed : item)),
    auditTrail: [...current.auditTrail, signatureAuditEntry],
  };
  await persistPlan(input.projectId, input.organisationId, next);
  return {
    plan: next,
    journal: signed,
  };
}

export async function ingestLimsReportForProject(input: {
  projectId: string;
  organisationId: string;
  report: {
    bookingId?: string | null;
    sampleId: string;
    labName: string;
    source?: LimsSourceType;
    analyzedAt?: string;
    rawReference: string;
    metrics: Array<{
      key: string;
      value: number;
      unit: string;
      maxAllowed?: number | null;
    }>;
    passed?: boolean;
  };
  plan?: Partial<ProjectPlan>;
}) {
  const current = await getOrCreatePlan(input.projectId, input.organisationId, input.plan);
  if (input.report.bookingId) {
    const bookingExists = current.transportBookings.some((item) => item.id === input.report.bookingId);
    if (!bookingExists) {
      throw new Error("Transport booking not found for LIMS report");
    }
  }

  const report = await createLimsReport(input.report);
  const next = {
    ...current,
    limsReports: [report, ...current.limsReports.filter((item) => item.id !== report.id)],
  };
  await persistPlan(input.projectId, input.organisationId, next);
  return {
    plan: next,
    report,
  };
}

export async function verifyLimsReportForProject(input: {
  projectId: string;
  organisationId: string;
  reportId: string;
  reviewer: string;
  signatureId: string;
  approved?: boolean;
  plan?: Partial<ProjectPlan>;
}) {
  const current = await getOrCreatePlan(input.projectId, input.organisationId, input.plan);
  const existing = current.limsReports.find((item) => item.id === input.reportId);
  if (!existing) {
    throw new Error("LIMS report not found");
  }

  const verified = await verifyLimsReport({
    reportId: existing.id,
    reviewer: input.reviewer,
    signatureId: input.signatureId,
    approved: input.approved,
  });

  const signatureAuditEntry = {
    id: `PLAN-LIMS-SIGN-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    timestamp: new Date().toISOString(),
    user: input.reviewer,
    action: "LIMS_REPORT_VERIFY",
    details: `LIMS report ${verified.id} reviewed.`,
    immutable: true,
    signatureId: input.signatureId,
  };

  const next = {
    ...current,
    limsReports: current.limsReports.map((item) => (item.id === verified.id ? verified : item)),
    auditTrail: [...current.auditTrail, signatureAuditEntry],
  };
  await persistPlan(input.projectId, input.organisationId, next);
  return {
    plan: next,
    report: verified,
  };
}

export async function recalculatePredictiveScoresForProject(projectId: string, organisationId: string, plan?: Partial<ProjectPlan>) {
  const current = await getOrCreatePlan(projectId, organisationId, plan);
  await persistPlan(projectId, organisationId, current);
  return current;
}

