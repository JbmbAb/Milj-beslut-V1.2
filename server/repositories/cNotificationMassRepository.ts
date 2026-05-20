/**
 * Persistens för C-anmälan schaktmassor (/api/c-notification/mass/*)
 */

import { prisma } from '../../db.server';

export type MassOperationType = 'MELLANLAGRING' | 'DEPONI';
export type MassCaseStatus = 'DRAFT' | 'VALIDATED' | 'READY' | 'SUBMITTED';
export type GateDecision = 'PERMIT_REQUIRED' | 'NOTIFICATION_REQUIRED' | 'EXEMPT' | 'UNKNOWN_CODE';

export interface MassOperationRecord {
  operationType: MassOperationType;
  propertyDesignation: string;
  ewcCode: string;
  quantityPerYear: number;
  sniCode?: string;
  gateDecision: GateDecision;
  capacityM3?: number;
  receiverName?: string;
  transportChain?: string[];
  storageAreaId?: string;
  notes?: string;
}

export interface CNotificationMassCaseRecord {
  id: string;
  referenceNumber: string;
  organisationId: string;
  createdByUserId: string;
  projectId: string;
  propertyDesignation: string;
  status: MassCaseStatus;
  operations: MassOperationRecord[];
  logisticsPlanId?: string;
  massFlowSnapshot?: unknown;
  exportPayload?: unknown;
  municipalityReference?: string;
  createdAt: string;
  updatedAt: string;
}

const memoryStore = new Map<string, CNotificationMassCaseRecord>();

function useMemoryOnly(): boolean {
  return process.env.C_NOTIFICATION_MASS_REPO === 'memory' || process.env.NODE_ENV === 'test';
}

export function createMassCase(
  input: Omit<CNotificationMassCaseRecord, 'id' | 'referenceNumber' | 'createdAt' | 'updatedAt' | 'status' | 'operations'> & {
    status?: MassCaseStatus;
    operations?: MassOperationRecord[];
  },
): CNotificationMassCaseRecord {
  const now = new Date();
  const id = `cmass-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const record: CNotificationMassCaseRecord = {
    id,
    referenceNumber: `CMASS-${id}`,
    status: input.status ?? 'DRAFT',
    operations: input.operations ?? [],
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    ...input,
  };
  memoryStore.set(id, record);

  if (!useMemoryOnly()) {
    void prisma.cNotificationMassCase
      .create({
        data: {
          id: record.id,
          referenceNumber: record.referenceNumber,
          organisationId: record.organisationId,
          createdByUserId: record.createdByUserId,
          projectId: record.projectId,
          propertyDesignation: record.propertyDesignation,
          status: record.status,
          municipalityReference: record.municipalityReference ?? null,
          payload: {
            operations: record.operations,
            logisticsPlanId: record.logisticsPlanId,
            massFlowSnapshot: record.massFlowSnapshot,
            exportPayload: record.exportPayload,
          },
        },
      })
      .catch(() => undefined);
  }

  return record;
}

export function getMassCaseById(id: string): CNotificationMassCaseRecord | null {
  return memoryStore.get(id) ?? null;
}

export function updateMassCase(
  id: string,
  patch: Partial<
    Pick<
      CNotificationMassCaseRecord,
      | 'status'
      | 'operations'
      | 'propertyDesignation'
      | 'logisticsPlanId'
      | 'massFlowSnapshot'
      | 'exportPayload'
      | 'municipalityReference'
    >
  >,
): CNotificationMassCaseRecord | null {
  const existing = memoryStore.get(id);
  if (!existing) return null;
  const updated: CNotificationMassCaseRecord = {
    ...existing,
    ...patch,
    operations: patch.operations ?? existing.operations,
    updatedAt: new Date().toISOString(),
  };
  memoryStore.set(id, updated);

  if (!useMemoryOnly()) {
    void prisma.cNotificationMassCase
      .update({
        where: { id },
        data: {
          status: updated.status,
          propertyDesignation: updated.propertyDesignation,
          municipalityReference: updated.municipalityReference ?? null,
          payload: {
            operations: updated.operations,
            logisticsPlanId: updated.logisticsPlanId,
            massFlowSnapshot: updated.massFlowSnapshot,
            exportPayload: updated.exportPayload,
          },
          updatedAt: new Date(updated.updatedAt),
        },
      })
      .catch(() => undefined);
  }

  return updated;
}

export function assertMassCaseOrgAccess(
  record: CNotificationMassCaseRecord,
  organisationId: string,
  role: string,
): boolean {
  if (role === 'ADMIN') return true;
  return record.organisationId === organisationId;
}

export function __clearMassCaseStoreForTests(): void {
  memoryStore.clear();
}
