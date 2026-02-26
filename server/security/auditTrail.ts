import crypto from "node:crypto";
import { appendAuditTrailRow } from "../repositories/auditRepository";
import type { PropertyAccessAuditEvent } from "./types";

interface AuditRecord {
  id: string;
  entityType: string;
  entityId: string;
  action: string;
  userId: string;
  timestamp: string;
  payloadHash: string;
  prevHash: string | null;
  chainHash: string;
}

const trail: AuditRecord[] = [];

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export async function appendPropertyAudit(event: PropertyAccessAuditEvent): Promise<AuditRecord> {
  const payload = JSON.stringify(event);
  const payloadHash = sha256(payload);
  const prevHash = trail.length > 0 ? trail[trail.length - 1].chainHash : null;
  const timestamp = new Date().toISOString();
  const chainHash = sha256(`${prevHash ?? "GENESIS"}|${payloadHash}|${timestamp}`);

  const record: AuditRecord = {
    id: crypto.randomUUID(),
    entityType: "PropertyAccess",
    entityId: `${event.projectId}:${event.propertyDesignation}`,
    action: "READ",
    userId: event.userId,
    timestamp,
    payloadHash,
    prevHash,
    chainHash,
  };

  trail.push(record);
  await appendAuditTrailRow({
    entityType: record.entityType,
    entityId: record.entityId,
    action: record.action,
    userId: record.userId,
    timestamp: new Date(record.timestamp),
    payloadHash: record.payloadHash,
    prevHash: record.prevHash,
    chainHash: record.chainHash,
  });
  return record;
}

export function exportAuditTrail(): ReadonlyArray<AuditRecord> {
  return trail;
}

export function verifyAuditTrail(): { ok: boolean; invalidIndex?: number } {
  for (let index = 0; index < trail.length; index += 1) {
    const row = trail[index];
    const previous = index === 0 ? null : trail[index - 1].chainHash;
    const expected = sha256(`${previous ?? "GENESIS"}|${row.payloadHash}|${row.timestamp}`);
    if (expected !== row.chainHash) {
      return { ok: false, invalidIndex: index };
    }
  }
  return { ok: true };
}
