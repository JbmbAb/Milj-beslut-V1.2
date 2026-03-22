/**
 * auditLogService.test.ts
 *
 * Tests for the in-memory audit trail service.
 * No external dependencies — uses in-memory array.
 */

import { describe, expect, it } from 'vitest';
import { appendAuditLog, getAuditLogs } from '../../services/auditLogService';
import type { AuditLogEntry } from '../../services/auditLogService';

function makeEntry(userId: string, actionType: AuditLogEntry['actionType'] = 'AI_GENERATION') {
  return appendAuditLog({
    userId,
    actionType,
    modelVersions: ['gemini-2.0'],
    promptOrInput: 'test prompt',
    ragDocumentsUsed: ['doc-1'],
    responseOrOutput: 'test response',
    verificationStatus: 'UNVERIFIED',
  });
}

describe('appendAuditLog()', () => {
  it('returns an entry with a logId (UUID)', () => {
    const entry = makeEntry('user-1');
    expect(typeof entry.logId).toBe('string');
    expect(entry.logId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('returns an entry with a valid ISO timestamp', () => {
    const entry = makeEntry('user-2');
    const ts = new Date(entry.timestamp);
    expect(ts.getTime()).not.toBeNaN();
  });

  it('returns an entry with a SHA-256 signatureHash (64 hex chars)', () => {
    const entry = makeEntry('user-3');
    expect(typeof entry.signatureHash).toBe('string');
    expect(entry.signatureHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('preserves all input fields', () => {
    const entry = appendAuditLog({
      userId: 'user-preserve',
      actionType: 'RULE_ENGINE_EVALUATION',
      modelVersions: ['model-a', 'model-b'],
      promptOrInput: { key: 'value' },
      ragDocumentsUsed: ['doc-a', 'doc-b'],
      responseOrOutput: { result: 42 },
      verificationStatus: 'VERIFIED',
    });

    expect(entry.userId).toBe('user-preserve');
    expect(entry.actionType).toBe('RULE_ENGINE_EVALUATION');
    expect(entry.modelVersions).toEqual(['model-a', 'model-b']);
    expect(entry.ragDocumentsUsed).toEqual(['doc-a', 'doc-b']);
    expect(entry.verificationStatus).toBe('VERIFIED');
  });

  it('each call produces a unique logId', () => {
    const e1 = makeEntry('user-x');
    const e2 = makeEntry('user-x');
    expect(e1.logId).not.toBe(e2.logId);
  });

  it('each call produces a unique signatureHash', () => {
    const e1 = makeEntry('user-hash');
    const e2 = makeEntry('user-hash');
    // Timestamps differ, so hashes should differ
    expect(e1.signatureHash).not.toBe(e2.signatureHash);
  });
});

describe('getAuditLogs()', () => {
  it('returns an array', () => {
    const result = getAuditLogs();
    expect(Array.isArray(result)).toBe(true);
  });

  it('includes entries just appended', () => {
    const entry = makeEntry('user-getall');
    const logs = getAuditLogs();
    const found = logs.find((l) => l.logId === entry.logId);
    expect(found).toBeDefined();
  });

  it('returns all logs when no userId is provided', () => {
    makeEntry('user-all-1');
    makeEntry('user-all-2');
    const all = getAuditLogs();
    expect(all.length).toBeGreaterThanOrEqual(2);
  });

  it('filters by userId when provided', () => {
    const specificUser = `user-filter-${Date.now()}`;
    makeEntry(specificUser);
    makeEntry('other-user-xyz');

    const filtered = getAuditLogs(specificUser);
    expect(filtered.length).toBeGreaterThanOrEqual(1);
    for (const log of filtered) {
      expect(log.userId).toBe(specificUser);
    }
  });

  it('returns empty array when userId has no entries', () => {
    const result = getAuditLogs('non-existent-user-' + Date.now());
    expect(result).toHaveLength(0);
  });

  it('returns a copy of the array (not the original reference) when no filter', () => {
    const a = getAuditLogs();
    const b = getAuditLogs();
    expect(a).not.toBe(b); // Different array instances
  });
});
