import crypto from 'node:crypto';
import { appendAuditTrailRow, getAuditExportRows, getLatestAuditRow } from '../repositories/auditRepository';
import type { PropertyAccessAuditEvent } from './types';

interface AuditRecord {
  id: string;
  entityType: string;
  entityId: string;
  action: string;
  userId?: string;
  timestamp: string;
  payloadHash: string;
  prevHash: string | null;
  chainHash: string;
}

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

async function getLastChainHash(): Promise<string | null> {
  const latest = await getLatestAuditRow();
  return latest ? latest.chainHash : null;
}

async function appendAuditEvent(input: {
  entityType: string;
  entityId: string;
  action: string;
  userId: string;
  payload: Record<string, unknown>;
}): Promise<AuditRecord> {
  const payload = JSON.stringify(input.payload);
  const payloadHash = sha256(payload);
  const prevHash = await getLastChainHash();
  const timestamp = new Date().toISOString();
  const chainHash = sha256(`${prevHash ?? 'GENESIS'}|${payloadHash}|${timestamp}`);

  const record: AuditRecord = {
    id: crypto.randomUUID(),
    entityType: input.entityType,
    entityId: input.entityId,
    action: input.action,
    userId: input.userId,
    timestamp,
    payloadHash,
    prevHash,
    chainHash,
  };

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

export async function appendPropertyAudit(event: PropertyAccessAuditEvent): Promise<AuditRecord> {
  return appendAuditEvent({
    entityType: 'PropertyAccess',
    entityId: `${event.projectId}:${event.propertyDesignation}`,
    action: 'READ',
    userId: event.userId,
    payload: event as unknown as Record<string, unknown>,
  });
}

export async function appendDomainAudit(input: {
  entityType: string;
  entityId: string;
  action: string;
  userId: string;
  payload: Record<string, unknown>;
}): Promise<AuditRecord> {
  return appendAuditEvent(input);
}

export async function exportAuditTrail(): Promise<ReadonlyArray<AuditRecord>> {
  const rows = await getAuditExportRows(1000);
  return rows.map((r) => ({
    id: r.id,
    entityType: r.entityType,
    entityId: r.entityId,
    action: r.action,
    userId: r.userId ?? undefined,
    timestamp: r.timestamp.toISOString(),
    payloadHash: r.payloadHash,
    prevHash: r.prevHash,
    chainHash: r.chainHash,
  }));
}

export async function verifyAuditTrail(): Promise<{ ok: boolean; invalidIndex?: number }> {
  const rows = await getAuditExportRows(5000);
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const previous = index === 0 ? null : rows[index - 1].chainHash;
    const tsStr = row.timestamp instanceof Date ? row.timestamp.toISOString() : String(row.timestamp);
    const input = `${previous ?? 'GENESIS'}|${row.payloadHash}|${tsStr}`;
    const expected = sha256(input);

    if (expected !== row.chainHash) {
      console.error(`Mismatch at index ${index}:`);
      console.error(`  Input: ${input}`);
      console.error(`  Expected: ${expected}`);
      console.error(`  Actual:   ${row.chainHash}`);
      return { ok: false, invalidIndex: index };
    }
  }
  return { ok: true };
}
