/**
 * Persistens för C-anmälan schaktmassor (/api/c-notification/mass/*)
 * Prioriterar Prisma för persistens, med in-memory fallback för tester.
 */

import { prisma } from '../../db.server';
import type { Prisma } from '@prisma/client';
import type { MassGisSnapshot } from '../../src/types/mass';

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
  gisSnapshot?: MassGisSnapshot;
  municipalityReference?: string;
  createdAt: string;
  updatedAt: string;
}

const memoryStore = new Map<string, CNotificationMassCaseRecord>();

function useMemoryOnly(): boolean {
  if (process.env.DATABASE_INTEGRATION === 'true') return false;
  return process.env.C_NOTIFICATION_MASS_REPO === 'memory' || process.env.NODE_ENV === 'test';
}

function rowToRecord(row: any): CNotificationMassCaseRecord {
  const payload = (row.payload ?? {}) as any;
  return {
    id: row.id,
    referenceNumber: row.referenceNumber,
    organisationId: row.organisationId,
    createdByUserId: row.createdByUserId,
    projectId: row.projectId,
    propertyDesignation: row.propertyDesignation,
    status: row.status as MassCaseStatus,
    operations: payload.operations ?? [],
    logisticsPlanId: payload.logisticsPlanId,
    massFlowSnapshot: payload.massFlowSnapshot,
    exportPayload: payload.exportPayload,
    gisSnapshot: payload.gisSnapshot,
    municipalityReference: row.municipalityReference ?? undefined,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function createMassCase(
  input: Omit<
    CNotificationMassCaseRecord,
    'id' | 'referenceNumber' | 'createdAt' | 'updatedAt' | 'status' | 'operations'
  > & {
    status?: MassCaseStatus;
    operations?: MassOperationRecord[];
  },
): Promise<CNotificationMassCaseRecord> {
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
    try {
      await prisma.cNotificationMassCase.create({
        data: {
          id: record.id,
          referenceNumber: record.referenceNumber,
          organisationId: record.organisationId,
          createdByUserId: record.createdByUserId,
          projectId: record.projectId,
          propertyDesignation: record.propertyDesignation,
          status: record.status,
          municipalityReference: record.municipalityReference ?? null,
          payload: ({
            operations: record.operations,
            logisticsPlanId: record.logisticsPlanId,
            massFlowSnapshot: record.massFlowSnapshot,
            exportPayload: record.exportPayload,
            gisSnapshot: record.gisSnapshot,
          } as unknown) as Prisma.InputJsonValue,
        },
      });
    } catch (error) {
      console.warn('[CNotificationMassRepository] DB create failed', error);
    }
  }

  return record;
}

export async function getMassCaseById(id: string): Promise<CNotificationMassCaseRecord | null> {
  const mem = memoryStore.get(id);
  if (mem) return mem;

  if (useMemoryOnly()) return null;

  try {
    const row = await prisma.cNotificationMassCase.findUnique({ where: { id } });
    if (!row) return null;
    const record = rowToRecord(row);
    memoryStore.set(id, record);
    return record;
  } catch (error) {
    console.warn('[CNotificationMassRepository] DB fetch failed', error);
    return null;
  }
}

export async function listMassCasesByOrg(organisationId: string): Promise<CNotificationMassCaseRecord[]> {
  if (useMemoryOnly()) {
    return [...memoryStore.values()].filter((r) => r.organisationId === organisationId);
  }

  try {
    const rows = await prisma.cNotificationMassCase.findMany({
      where: { organisationId },
      orderBy: { updatedAt: 'desc' },
    });
    return rows.map(rowToRecord);
  } catch (error) {
    console.warn('[CNotificationMassRepository] DB list failed', error);
    return [...memoryStore.values()].filter((r) => r.organisationId === organisationId);
  }
}

export async function updateMassCase(
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
      | 'gisSnapshot'
      | 'municipalityReference'
    >
  >,
): Promise<CNotificationMassCaseRecord | null> {
  const existing = await getMassCaseById(id);
  if (!existing) return null;

  const updated: CNotificationMassCaseRecord = {
    ...existing,
    ...patch,
    operations: patch.operations ?? existing.operations,
    updatedAt: new Date().toISOString(),
  };
  memoryStore.set(id, updated);

  if (!useMemoryOnly()) {
    try {
      await prisma.cNotificationMassCase.update({
        where: { id },
        data: {
          status: updated.status,
          propertyDesignation: updated.propertyDesignation,
          municipalityReference: updated.municipalityReference ?? null,
          payload: ({
            operations: updated.operations,
            logisticsPlanId: updated.logisticsPlanId,
            massFlowSnapshot: updated.massFlowSnapshot,
            exportPayload: updated.exportPayload,
            gisSnapshot: updated.gisSnapshot,
          } as unknown) as Prisma.InputJsonValue,
          updatedAt: new Date(updated.updatedAt),
        },
      });
    } catch (error) {
      console.warn('[CNotificationMassRepository] DB update failed', error);
    }
  }

  return updated;
}

export function assertMassCaseOrgAccess(
  record: CNotificationMassCaseRecord,
  organisationId: string,
  role: string,
): boolean {
  // I ett multi-tenant-system ska även admins vara låsta till sin egen organisation.
  // Om global admin behövs bör en separat roll (t.ex. SUPER_ADMIN) introduceras.
  if (role === 'ADMIN' && record.organisationId === organisationId) return true;
  return record.organisationId === organisationId;
}

export function __clearMassCaseStoreForTests(): void {
  memoryStore.clear();
}
