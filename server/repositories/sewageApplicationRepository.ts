/**
 * Persistens för canonical enskilt-avlopp-ansökningar (/api/sewage/applications).
 * Prioriterar Prisma för persistens, med in-memory fallback för tester.
 */

import type { SewageGISAnalysis, SewageProtectionProfile, Gate } from '../../types';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../db.server';

export type SewageApplicationStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'IN_REVIEW'
  | 'DECISION'
  | 'APPROVED'
  | 'REJECTED';

export interface SewageDomainSnapshot {
  protectionProfile?: SewageProtectionProfile;
  gisAnalysis?: SewageGISAnalysis;
  gates?: Gate[];
  generatedDocuments?: {
    situationPlanSVG?: string;
    crossSectionSVG?: string;
    generatedAt?: string;
  };
  usedDefaultGis?: boolean;
  soilTest?: { ltar: number; testDate: string };
  neighborConsent?: { address: string; distance: number; obtained: boolean };
}

export interface SewageApplicationRecord {
  id: string;
  referenceNumber: string;
  organisationId: string;
  createdByUserId: string;
  projectId?: string;
  municipalityCode?: string;
  pe: number;
  propertyDesignation: string;
  latitude: number;
  longitude: number;
  applicantName: string;
  applicantEmail: string;
  systemType: string;
  purpose?: string;
  status: SewageApplicationStatus;
  decisionNote?: string;
  municipalityReference?: string;
  domainSnapshot?: SewageDomainSnapshot;
  createdAt: string;
  updatedAt: string;
}

const memoryStore = new Map<string, SewageApplicationRecord>();

function shouldUseMemoryOnly(): boolean {
  if (process.env.DATABASE_INTEGRATION === 'true') return false;
  return process.env.SEWAGE_APPLICATION_REPO === 'memory' || process.env.NODE_ENV === 'test';
}

function rowToRecord(row: {
  id: string;
  referenceNumber: string;
  organisationId: string;
  createdByUserId: string;
  projectId: string | null;
  municipalityCode: string | null;
  pe: number;
  propertyDesignation: string;
  latitude: number;
  longitude: number;
  applicantName: string;
  applicantEmail: string;
  systemType: string;
  purpose: string | null;
  status: string;
  decisionNote: string | null;
  municipalityReference: string | null;
  payload: unknown;
  createdAt: Date;
  updatedAt: Date;
}): SewageApplicationRecord {
  const payload = (row.payload ?? {}) as { domainSnapshot?: SewageDomainSnapshot };
  return {
    id: row.id,
    referenceNumber: row.referenceNumber,
    organisationId: row.organisationId,
    createdByUserId: row.createdByUserId,
    projectId: row.projectId ?? undefined,
    municipalityCode: row.municipalityCode ?? undefined,
    pe: row.pe,
    propertyDesignation: row.propertyDesignation,
    latitude: row.latitude,
    longitude: row.longitude,
    applicantName: row.applicantName,
    applicantEmail: row.applicantEmail,
    systemType: row.systemType,
    purpose: row.purpose ?? undefined,
    status: row.status as SewageApplicationStatus,
    decisionNote: row.decisionNote ?? undefined,
    municipalityReference: row.municipalityReference ?? undefined,
    domainSnapshot: payload.domainSnapshot,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function createSewageApplicationRecord(
  input: Omit<
    SewageApplicationRecord,
    'id' | 'referenceNumber' | 'createdAt' | 'updatedAt' | 'status' | 'pe'
  > & {
    status?: SewageApplicationStatus;
    pe?: number;
  },
): Promise<SewageApplicationRecord> {
  const now = new Date();
  const id = `avlopp-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  // Stable internal reference: AVLOPP-{random}
  // Municipality submission reference (municipalityReference) is generated separately at submission
  const referenceNumber = `AVLOPP-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
  const record: SewageApplicationRecord = {
    id,
    referenceNumber,
    pe: input.pe ?? 5,
    status: input.status ?? 'DRAFT',
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    ...input,
  };

  memoryStore.set(id, record);

  if (!shouldUseMemoryOnly()) {
    try {
      await prisma.sewageApplicationCase.create({
        data: {
          id: record.id,
          referenceNumber: record.referenceNumber,
          organisationId: record.organisationId,
          createdByUserId: record.createdByUserId,
          projectId: record.projectId ?? null,
          municipalityCode: record.municipalityCode ?? null,
          pe: record.pe,
          propertyDesignation: record.propertyDesignation,
          latitude: record.latitude,
          longitude: record.longitude,
          applicantName: record.applicantName,
          applicantEmail: record.applicantEmail,
          systemType: record.systemType,
          purpose: record.purpose ?? null,
          status: record.status,
          decisionNote: record.decisionNote ?? null,
          municipalityReference: record.municipalityReference ?? null,
          payload: { domainSnapshot: record.domainSnapshot ?? {} } as unknown as Prisma.InputJsonValue,
        },
      });
    } catch (error) {
      console.warn('[SewageRepository] DB create failed', error);
    }
  }

  return record;
}

export async function getSewageApplicationById(id: string): Promise<SewageApplicationRecord | null> {
  const mem = memoryStore.get(id);
  if (mem) return mem;

  if (shouldUseMemoryOnly()) return null;

  try {
    const row = await prisma.sewageApplicationCase.findUnique({ where: { id } });
    if (!row) return null;
    const record = rowToRecord(row);
    memoryStore.set(id, record);
    return record;
  } catch (error) {
    console.warn('[SewageRepository] DB fetch failed', error);
    return null;
  }
}

export async function listSewageApplicationsByOrg(
  organisationId: string,
): Promise<SewageApplicationRecord[]> {
  if (shouldUseMemoryOnly()) {
    return [...memoryStore.values()].filter((r) => r.organisationId === organisationId);
  }

  try {
    const rows = await prisma.sewageApplicationCase.findMany({
      where: { organisationId },
      orderBy: { updatedAt: 'desc' },
    });
    return rows.map(rowToRecord);
  } catch (error) {
    console.warn('[SewageRepository] DB list failed', error);
    return [...memoryStore.values()].filter((r) => r.organisationId === organisationId);
  }
}

export async function updateSewageApplicationRecord(
  id: string,
  patch: Partial<
    Pick<
      SewageApplicationRecord,
      | 'status'
      | 'decisionNote'
      | 'projectId'
      | 'municipalityCode'
      | 'pe'
      | 'propertyDesignation'
      | 'latitude'
      | 'longitude'
      | 'applicantName'
      | 'applicantEmail'
      | 'systemType'
      | 'purpose'
      | 'municipalityReference'
      | 'domainSnapshot'
    >
  >,
): Promise<SewageApplicationRecord | null> {
  const existing = await getSewageApplicationById(id);
  if (!existing) return null;

  const updated: SewageApplicationRecord = {
    ...existing,
    ...patch,
    domainSnapshot: patch.domainSnapshot
      ? { ...existing.domainSnapshot, ...patch.domainSnapshot }
      : existing.domainSnapshot,
    updatedAt: new Date().toISOString(),
  };
  memoryStore.set(id, updated);

  if (!shouldUseMemoryOnly()) {
    try {
      await prisma.sewageApplicationCase.update({
        where: { id },
        data: {
          status: updated.status,
          decisionNote: updated.decisionNote ?? null,
          projectId: updated.projectId ?? null,
          municipalityCode: updated.municipalityCode ?? null,
          pe: updated.pe,
          propertyDesignation: updated.propertyDesignation,
          latitude: updated.latitude,
          longitude: updated.longitude,
          applicantName: updated.applicantName,
          applicantEmail: updated.applicantEmail,
          systemType: updated.systemType,
          purpose: updated.purpose ?? null,
          municipalityReference: updated.municipalityReference ?? null,
          payload: { domainSnapshot: updated.domainSnapshot ?? {} } as unknown as Prisma.InputJsonValue,
          updatedAt: new Date(updated.updatedAt),
        },
      });
    } catch (error) {
      console.warn('[SewageRepository] DB update failed', error);
    }
  }

  return updated;
}

export function assertSewageApplicationOrgAccess(
  record: SewageApplicationRecord,
  organisationId: string,
  role: string,
): boolean {
  // I ett multi-tenant-system ska även admins vara låsta till sin egen organisation.
  if (role === 'ADMIN' && record.organisationId === organisationId) return true;
  return record.organisationId === organisationId;
}

/** Endast för tester */
export function __clearSewageApplicationStoreForTests(): void {
  memoryStore.clear();
}
