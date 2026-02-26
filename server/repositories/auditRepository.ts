import { prisma } from "../db/prisma";
import type { PropertyAccessAuditEvent } from "../security/types";

export async function writePropertyAccessLog(event: PropertyAccessAuditEvent): Promise<void> {
  await prisma.propertyAccessLog.create({
    data: {
      userId: event.userId,
      projectId: event.projectId,
      propertyDesignation: event.propertyDesignation,
      purpose: event.purpose,
      responseClass: event.responseClass,
    },
  });
}

export async function getAuditExportRows(limit: number = 5000) {
  return prisma.auditTrail.findMany({
    orderBy: { timestamp: "asc" },
    take: limit,
  });
}

export async function appendAuditTrailRow(input: {
  entityType: string;
  entityId: string;
  action: string;
  userId?: string;
  timestamp: Date;
  payloadHash: string;
  prevHash: string | null;
  chainHash: string;
}): Promise<void> {
  await prisma.auditTrail.create({
    data: {
      entityType: input.entityType,
      entityId: input.entityId,
      action: input.action,
      userId: input.userId,
      timestamp: input.timestamp,
      payloadHash: input.payloadHash,
      prevHash: input.prevHash,
      chainHash: input.chainHash,
    },
  });
}
