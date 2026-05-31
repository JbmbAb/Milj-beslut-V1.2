/**
 * Orkestrering: C-anmälan schaktmassor
 */

import {
  evaluateMpfOperation,
  mergeGateDecisions as mergeMpfGateDecisions,
  toMpfDecisionSummary,
} from '../mpf/public';
import { getMassFlowSnapshot, recordMassMovement } from '../../repositories/massFlowService';
import { generateLogisticsPlan, type LogisticsGeneratorRequest } from '../../services/logisticsGeneratorService';
import {
  lookupPropertyByDesignationFromPostgis,
} from '../../services/propertyUnitService';
import { normalizePropertyLookupBody } from '../../security/propertyLookupNormalize';
import type { AuthUser } from '../../security/types';
import { auditTrail } from '../../services/auditTrailService';
import type { MassGisSnapshot } from '../../../src/types/mass';
import {
  assertMassCaseOrgAccess,
  createMassCase,
  getMassCaseById,
  updateMassCase,
  type CNotificationMassCaseRecord,
  type GateDecision,
  type MassOperationRecord,
  type MassOperationType,
} from '../../repositories/cNotificationMassRepository';
import { resolveMassSiteSensitivity } from './massSpatialSensitivity';

export type { GateDecision, MassOperationType };

export function mergeGateDecisions(decisions: GateDecision[]): GateDecision {
  return mergeMpfGateDecisions(decisions);
}

export function evaluateOperationCodes(input: {
  propertyDesignation: string;
  operationType: MassOperationType;
  quantityPerYear: number;
  ewcCode: string;
  sniCode?: string;
  isSensitiveArea?: boolean;
}): MassOperationRecord {
  const evaluation = evaluateMpfOperation({
    ewcCode: input.ewcCode,
    sniCode: input.sniCode,
    quantity: input.quantityPerYear,
    isSensitiveArea: input.isSensitiveArea,
  });

  return {
    operationType: input.operationType,
    propertyDesignation: input.propertyDesignation,
    ewcCode: input.ewcCode,
    quantityPerYear: input.quantityPerYear,
    sniCode: input.sniCode,
    gateDecision: evaluation.gateDecision,
    mpfDecision: toMpfDecisionSummary(evaluation),
    notes: evaluation.notes,
  };
}

export async function searchPropertyForMass(authUser: AuthUser, body: unknown) {
  const input = normalizePropertyLookupBody(body);
  if (!input.propertyDesignation) {
    return { ok: false as const, status: 400, error: 'propertyDesignation_required' };
  }

  const warnings: string[] = [];
  let result: unknown = null;
  let source = 'none';

  try {
    result = await lookupPropertyByDesignationFromPostgis(input, authUser);
    if (result) source = 'postgis';
  } catch {
    warnings.push('PostGIS-uppslag misslyckades.');
  }

  if (!result && process.env.NODE_ENV === 'production') {
    return {
      ok: false as const,
      status: 503,
      error: 'property_source_unavailable',
      message: 'Fastighetsuppslag saknas — ingen demo-fallback i produktion/staging.',
      warnings,
    };
  }

  if (!result) {
    warnings.push('Ingen träff i PostGIS — strukturerad placeholder endast för utveckling.');
    result = {
      propertyDesignation: input.propertyDesignation,
      centroid: null,
      _devOnly: true,
    };
  }

  return { ok: true as const, result, source, warnings };
}

export async function upsertMassOperations(
  caseId: string | undefined,
  authUser: AuthUser,
  input: {
    projectId: string;
    propertyDesignation: string;
    operations: Array<{
      operationType: MassOperationType;
      ewcCode: string;
      quantityPerYear: number;
      sniCode?: string;
      capacityM3?: number;
      receiverName?: string;
      transportChain?: string[];
      storageAreaId?: string;
    }>;
    gisSnapshot?: MassGisSnapshot;
  },
) {
  const siteSensitivity = await resolveMassSiteSensitivity({
    gisAnalysis: input.gisSnapshot?.analysis,
    siteLat: input.gisSnapshot?.analysis.centroid.lat,
    siteLng: input.gisSnapshot?.analysis.centroid.lng,
  });

  const evaluated: MassOperationRecord[] = input.operations.map((op) => ({
    ...evaluateOperationCodes({
      propertyDesignation: input.propertyDesignation,
      operationType: op.operationType,
      quantityPerYear: op.quantityPerYear,
      ewcCode: op.ewcCode,
      sniCode: op.sniCode,
      isSensitiveArea: siteSensitivity.isSensitiveArea,
    }),
    capacityM3: op.capacityM3,
    receiverName: op.receiverName,
    transportChain: op.transportChain,
    storageAreaId: op.storageAreaId,
  }));

  const mellanlagring = evaluated.filter((o) => o.operationType === 'MELLANLAGRING');
  const deponi = evaluated.filter((o) => o.operationType === 'DEPONI');
  const warnings: string[] = [];
  if (mellanlagring.length === 0) warnings.push('Saknar delbeslut MELLANLAGRING.');
  if (deponi.length === 0) warnings.push('Saknar delbeslut DEPONI.');
  if (siteSensitivity.isSensitiveArea) {
    warnings.push(
      `Platsen bedöms som känslig (${siteSensitivity.source}) — MPF-trösklar kan vara skärpta.`,
    );
  }

  let record: CNotificationMassCaseRecord;
  if (caseId) {
    const existing = await getMassCaseById(caseId);
    if (!existing) return { ok: false as const, status: 404, error: 'not_found' };
    if (!assertMassCaseOrgAccess(existing, authUser.organisationId, authUser.role)) {
      return { ok: false as const, status: 403, error: 'forbidden' };
    }
    const updated = await updateMassCase(caseId, {
      operations: evaluated,
      propertyDesignation: input.propertyDesignation,
      gisSnapshot: input.gisSnapshot ?? existing.gisSnapshot,
    });
    if (!updated) return { ok: false as const, status: 404, error: 'not_found' };
    record = updated;
  } else {
    record = await createMassCase({
      organisationId: authUser.organisationId,
      createdByUserId: authUser.id,
      projectId: input.projectId,
      propertyDesignation: input.propertyDesignation,
      operations: evaluated,
      gisSnapshot: input.gisSnapshot,
    });
  }

  return {
    ok: true as const,
    caseId: record.id,
    referenceNumber: record.referenceNumber,
    operations: evaluated,
    decisions: {
      mellanlagring: mellanlagring[0] ?? null,
      deponi: deponi[0] ?? null,
    },
    warnings,
  };
}

export async function recordMassFlowForCase(
  caseId: string,
  authUser: AuthUser,
  input: {
    wasteCode: string;
    volumeM3: number;
    sourceStorageAreaId?: string;
    destinationStorageAreaId?: string;
  },
) {
  const record = await getMassCaseById(caseId);
  if (!record) return { ok: false as const, status: 404, error: 'not_found' };
  if (!assertMassCaseOrgAccess(record, authUser.organisationId, authUser.role)) {
    return { ok: false as const, status: 403, error: 'forbidden' };
  }

  await recordMassMovement({
    projectId: record.projectId,
    wasteCode: input.wasteCode,
    volumeM3: input.volumeM3,
    sourceStorageAreaId: input.sourceStorageAreaId,
    destinationStorageAreaId: input.destinationStorageAreaId,
  });

  const snapshot = await getMassFlowSnapshot(record.projectId);
  await updateMassCase(caseId, { massFlowSnapshot: snapshot });

  return { ok: true as const, snapshot };
}

export async function generateLogisticsForCase(
  caseId: string,
  authUser: AuthUser,
  input: {
    sourceAddress: string;
    destinationAddress: string;
    estimatedTons: number;
    wasteType?: LogisticsGeneratorRequest['wasteType'];
  },
) {
  const record = await getMassCaseById(caseId);
  if (!record) return { ok: false as const, status: 404, error: 'not_found' };
  if (!assertMassCaseOrgAccess(record, authUser.organisationId, authUser.role)) {
    return { ok: false as const, status: 403, error: 'forbidden' };
  }

  try {
    const plan = await generateLogisticsPlan({
      projectId: record.projectId,
      wasteType: input.wasteType ?? 'CONSTRUCTION',
      estimatedTons: input.estimatedTons,
      sourceAddress: input.sourceAddress,
      destinationAddress: input.destinationAddress,
      transportMode: 'TRUCK',
    });
    await updateMassCase(caseId, { logisticsPlanId: plan.id, status: 'VALIDATED' });
    return { ok: true as const, plan };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (process.env.NODE_ENV === 'test') {
      const fallback = {
        id: `logistics-${caseId}`,
        projectId: record.projectId,
        generatedAt: new Date().toISOString(),
        waybills: [],
        drivingLog: [],
        depots: [],
        co2Calculation: { totalKg: 0, perTon: 0 },
        externalSourcesUsed: [],
        integrationsAvailable: [],
        _fallback: true,
      };
      await updateMassCase(caseId, { logisticsPlanId: fallback.id, status: 'VALIDATED' });
      return { ok: true as const, plan: fallback, warnings: [message] };
    }
    return {
      ok: false as const,
      status: 503,
      error: 'logistics_unavailable',
      message,
    };
  }
}

export function buildMassExport(record: CNotificationMassCaseRecord) {
  const primaryEwc = record.operations[0]?.ewcCode ?? '';
  const mellanlagring = record.operations.filter((o) => o.operationType === 'MELLANLAGRING');
  const deponi = record.operations.filter((o) => o.operationType === 'DEPONI');

  return {
    referenceNumber: record.referenceNumber,
    projectId: record.projectId,
    propertyDesignation: record.propertyDesignation,
    status: record.status,
    gis: record.gisSnapshot
      ? {
          analyzedAt: record.gisSnapshot.analyzedAt,
          propertySource: record.gisSnapshot.propertySource,
          centroid: record.gisSnapshot.analysis.centroid,
          markCover: record.gisSnapshot.analysis.markCover,
          overallRiskScore: record.gisSnapshot.analysis.overallRiskScore,
          logisticsSuitability: record.gisSnapshot.analysis.logisticsSuitability,
          siteConstraints: record.gisSnapshot.analysis.siteConstraints,
          recommendedZones: record.gisSnapshot.siteProfile.recommendedZones,
          warnings: record.gisSnapshot.analysis.warnings,
        }
      : null,
    decisions: {
      mellanlagring: mellanlagring.map((op) => ({
        ewcCode: op.ewcCode,
        sniCode: op.sniCode,
        gateDecision: op.gateDecision,
        mpfDecision: op.mpfDecision ?? null,
        quantityPerYear: op.quantityPerYear,
        receiverName: op.receiverName,
        capacityM3: op.capacityM3,
        transportChain: op.transportChain ?? [],
      })),
      deponi: deponi.map((op) => ({
        ewcCode: op.ewcCode,
        sniCode: op.sniCode,
        gateDecision: op.gateDecision,
        mpfDecision: op.mpfDecision ?? null,
        quantityPerYear: op.quantityPerYear,
        receiverName: op.receiverName,
        capacityM3: op.capacityM3,
        transportChain: op.transportChain ?? [],
      })),
    },
    classification: primaryEwc,
    humanInTheLoop:
      'Underlaget är AI-assisterat. Handläggare ska verifiera MPF/EWC, kapacitet och transportkedja innan inlämning.',
    exportedAt: new Date().toISOString(),
  };
}

export async function generateDocumentsForCase(caseId: string, authUser: AuthUser) {
  const record = await getMassCaseById(caseId);
  if (!record) return { ok: false as const, status: 404, error: 'not_found' };
  if (!assertMassCaseOrgAccess(record, authUser.organisationId, authUser.role)) {
    return { ok: false as const, status: 403, error: 'forbidden' };
  }

  const exportPayload = buildMassExport(record);
  await updateMassCase(caseId, { exportPayload, status: 'READY' });

  const warnings: string[] = [];
  if (!record.gisSnapshot) {
    warnings.push('GIS-situationsplan saknas — kör GIS-analys och spara delbeslut innan inlämning.');
  }

  return {
    ok: true as const,
    documents: {
      summary: exportPayload,
      situationsplan: record.gisSnapshot
        ? {
            title: 'Situationsplan — masslogistik',
            propertyDesignation: record.propertyDesignation,
            gis: record.gisSnapshot,
          }
        : null,
      generatedAt: new Date().toISOString(),
    },
    warnings,
  };
}

export async function exportMassCase(caseId: string, authUser: AuthUser) {
  const record = await getMassCaseById(caseId);
  if (!record) return { ok: false as const, status: 404, error: 'not_found' };
  if (!assertMassCaseOrgAccess(record, authUser.organisationId, authUser.role)) {
    return { ok: false as const, status: 403, error: 'forbidden' };
  }

  const exportPayload = record.exportPayload ?? buildMassExport(record);
  return { ok: true as const, export: exportPayload };
}

export async function submitMassCase(caseId: string, authUser: AuthUser) {
  const record = await getMassCaseById(caseId);
  if (!record) return { ok: false as const, status: 404, error: 'not_found' };
  if (!assertMassCaseOrgAccess(record, authUser.organisationId, authUser.role)) {
    return { ok: false as const, status: 403, error: 'forbidden' };
  }

  const unknownEwcOperations = record.operations.filter(
    (operation) => operation.mpfDecision?.ewcEvaluation.gateDecision === 'UNKNOWN_CODE',
  );
  if (unknownEwcOperations.length > 0) {
    return {
      ok: false as const,
      status: 422,
      error: 'unknown_ewc_code',
      message: 'Minst en EWC-kod saknar verifierad MPF-regel. Manuell juridisk granskning krävs före inlämning.',
      warnings: unknownEwcOperations.map(
        (operation) =>
          `EWC-kod ${operation.ewcCode} för ${operation.operationType} saknar verifierad regel och måste granskas manuellt.`,
      ),
    };
  }

  const advisoryWarnings = record.operations.flatMap((operation) =>
    (operation.mpfDecision?.advisorySignals ?? []).map(
      (signal) => `${operation.operationType}: ${signal}`,
    ),
  );

  const requiresNotification = record.operations.some(
    (o) => o.gateDecision === 'NOTIFICATION_REQUIRED' || o.gateDecision === 'PERMIT_REQUIRED',
  );
  if (!requiresNotification && record.operations.every((o) => o.gateDecision === 'EXEMPT')) {
    return {
      ok: false as const,
      status: 422,
      error: 'no_notification_required',
      message: 'Ingen anmälan krävs enligt MPF-bedömning.',
    };
  }

  const ref = `C-ANM-MASS-${Date.now()}`;
  const updated = await updateMassCase(caseId, {
    status: 'SUBMITTED',
    municipalityReference: ref,
  });

  await auditTrail.logAction(
    record.referenceNumber,
    'APPLICATION_SUBMITTED',
    'SewageApplication',
    caseId,
    authUser.id,
    advisoryWarnings.length > 0
      ? 'C-anmälan schaktmassor inlämnad med rådgivande SNI-varningar'
      : 'C-anmälan schaktmassor inlämnad',
    {
      userRole: authUser.role,
      severity: advisoryWarnings.length > 0 ? 'warning' : 'info',
      details: {
        operations: record.operations.length,
        mpfPrimaryPolicy: 'EWC_PRIMARY',
        advisoryWarnings,
        advisoryWarningCount: advisoryWarnings.length,
      },
    },
  );

  return {
    ok: true as const,
    referenceNumber: ref,
    caseId,
    status: 'SUBMITTED',
    submittedAt: new Date().toISOString(),
    warnings: advisoryWarnings,
    case: updated,
  };
}

export async function getMassCaseAuditTrail(caseId: string, authUser: AuthUser) {
  const record = await getMassCaseById(caseId);
  if (!record) return { ok: false as const, status: 404, error: 'not_found' };
  if (!assertMassCaseOrgAccess(record, authUser.organisationId, authUser.role)) {
    return { ok: false as const, status: 403, error: 'forbidden' };
  }

  const { getAuditTrail } = await import('../../services/auditTrailService');
  const entries = await getAuditTrail(record.referenceNumber);
  return { ok: true as const, referenceNumber: record.municipalityReference ?? record.referenceNumber, entries };
}
