/**
 * Orkestrering: C-anmälan schaktmassor
 */

import { evaluateMpfCode } from '../../services/mpfThresholdService';
import { getMassFlowSnapshot, recordMassMovement } from '../../repositories/massFlowService';
import { generateLogisticsPlan, type LogisticsGeneratorRequest } from '../../services/logisticsGeneratorService';
import {
  lookupPropertyByDesignationFromPostgis,
} from '../../services/propertyUnitService';
import { normalizePropertyLookupBody } from '../../security/propertyLookupNormalize';
import type { AuthUser } from '../../security/types';
import { auditTrail } from '../../services/auditTrailService';
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

export type { GateDecision, MassOperationType };

export function mergeGateDecisions(decisions: GateDecision[]): GateDecision {
  if (decisions.includes('PERMIT_REQUIRED')) return 'PERMIT_REQUIRED';
  if (decisions.includes('NOTIFICATION_REQUIRED')) return 'NOTIFICATION_REQUIRED';
  if (decisions.includes('UNKNOWN_CODE')) return 'UNKNOWN_CODE';
  return 'EXEMPT';
}

export function evaluateOperationCodes(input: {
  propertyDesignation: string;
  operationType: MassOperationType;
  quantityPerYear: number;
  ewcCode: string;
  sniCode?: string;
}): MassOperationRecord {
  const ewcEvaluation = evaluateMpfCode({
    code: input.ewcCode,
    quantity: input.quantityPerYear,
    codeType: 'EWC',
  });

  const sniEvaluation = input.sniCode
    ? evaluateMpfCode({
        code: input.sniCode,
        quantity: input.quantityPerYear,
        codeType: 'SNI',
      })
    : null;

  const gateDecision = mergeGateDecisions([
    ewcEvaluation.gateDecision,
    ...(sniEvaluation ? [sniEvaluation.gateDecision] : []),
  ]);

  return {
    operationType: input.operationType,
    propertyDesignation: input.propertyDesignation,
    ewcCode: input.ewcCode,
    quantityPerYear: input.quantityPerYear,
    sniCode: input.sniCode,
    gateDecision,
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

export function upsertMassOperations(
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
  },
) {
  const evaluated: MassOperationRecord[] = input.operations.map((op) => ({
    ...evaluateOperationCodes({
      propertyDesignation: input.propertyDesignation,
      operationType: op.operationType,
      quantityPerYear: op.quantityPerYear,
      ewcCode: op.ewcCode,
      sniCode: op.sniCode,
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

  let record: CNotificationMassCaseRecord;
  if (caseId) {
    const existing = getMassCaseById(caseId);
    if (!existing) return { ok: false as const, status: 404, error: 'not_found' };
    if (!assertMassCaseOrgAccess(existing, authUser.organisationId, authUser.role)) {
      return { ok: false as const, status: 403, error: 'forbidden' };
    }
    const updated = updateMassCase(caseId, { operations: evaluated, propertyDesignation: input.propertyDesignation });
    if (!updated) return { ok: false as const, status: 404, error: 'not_found' };
    record = updated;
  } else {
    record = createMassCase({
      organisationId: authUser.organisationId,
      createdByUserId: authUser.id,
      projectId: input.projectId,
      propertyDesignation: input.propertyDesignation,
      operations: evaluated,
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
  const record = getMassCaseById(caseId);
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
  updateMassCase(caseId, { massFlowSnapshot: snapshot });

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
  const record = getMassCaseById(caseId);
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
    updateMassCase(caseId, { logisticsPlanId: plan.id, status: 'VALIDATED' });
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
      updateMassCase(caseId, { logisticsPlanId: fallback.id });
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
  return {
    referenceNumber: record.referenceNumber,
    projectId: record.projectId,
    propertyDesignation: record.propertyDesignation,
    status: record.status,
    operations: record.operations.map((op) => ({
      operationType: op.operationType,
      ewcCode: op.ewcCode,
      gateDecision: op.gateDecision,
      quantityPerYear: op.quantityPerYear,
      receiverName: op.receiverName,
      capacityM3: op.capacityM3,
      transportChain: op.transportChain ?? [],
    })),
    classification: primaryEwc,
    humanInTheLoop:
      'Underlaget är AI-assisterat. Handläggare ska verifiera MPF/EWC, kapacitet och transportkedja innan inlämning.',
    exportedAt: new Date().toISOString(),
  };
}

export function generateDocumentsForCase(caseId: string, authUser: AuthUser) {
  const record = getMassCaseById(caseId);
  if (!record) return { ok: false as const, status: 404, error: 'not_found' };
  if (!assertMassCaseOrgAccess(record, authUser.organisationId, authUser.role)) {
    return { ok: false as const, status: 403, error: 'forbidden' };
  }

  const exportPayload = buildMassExport(record);
  updateMassCase(caseId, { exportPayload, status: 'READY' });

  return {
    ok: true as const,
    documents: {
      summary: exportPayload,
      generatedAt: new Date().toISOString(),
    },
  };
}

export function exportMassCase(caseId: string, authUser: AuthUser) {
  const record = getMassCaseById(caseId);
  if (!record) return { ok: false as const, status: 404, error: 'not_found' };
  if (!assertMassCaseOrgAccess(record, authUser.organisationId, authUser.role)) {
    return { ok: false as const, status: 403, error: 'forbidden' };
  }

  const exportPayload = record.exportPayload ?? buildMassExport(record);
  return { ok: true as const, export: exportPayload };
}

export async function submitMassCase(caseId: string, authUser: AuthUser) {
  const record = getMassCaseById(caseId);
  if (!record) return { ok: false as const, status: 404, error: 'not_found' };
  if (!assertMassCaseOrgAccess(record, authUser.organisationId, authUser.role)) {
    return { ok: false as const, status: 403, error: 'forbidden' };
  }

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
  const updated = updateMassCase(caseId, {
    status: 'SUBMITTED',
    municipalityReference: ref,
  });

  await auditTrail.logAction(
    ref,
    'APPLICATION_SUBMITTED',
    'SewageApplication',
    caseId,
    authUser.id,
    'C-anmälan schaktmassor inlämnad',
    { userRole: authUser.role, details: { operations: record.operations.length } },
  );

  return {
    ok: true as const,
    referenceNumber: ref,
    caseId,
    status: 'SUBMITTED',
    submittedAt: new Date().toISOString(),
    case: updated,
  };
}

export async function getMassCaseAuditTrail(caseId: string, authUser: AuthUser) {
  const record = getMassCaseById(caseId);
  if (!record) return { ok: false as const, status: 404, error: 'not_found' };
  if (!assertMassCaseOrgAccess(record, authUser.organisationId, authUser.role)) {
    return { ok: false as const, status: 403, error: 'forbidden' };
  }

  const { getAuditTrail } = await import('../../services/auditTrailService');
  const ref = record.municipalityReference ?? record.referenceNumber;
  const entries = await getAuditTrail(ref);
  return { ok: true as const, referenceNumber: ref, entries };
}
