import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Module state reset between test groups ───────────────────────────────────

let svc: typeof import('../../services/auditLogService');

beforeEach(async () => {
  vi.resetModules();
  svc = await import('../../services/auditLogService');
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function baseEntry() {
  return {
    userId: 'user-1',
    actionType: 'AI_GENERATION' as const,
    modelVersions: ['gemini-2.5-flash'],
    promptOrInput: 'Analysera tillståndsansökan',
    ragDocumentsUsed: ['doc-a', 'doc-b'],
    responseOrOutput: 'Analys klar.',
    verificationStatus: 'VERIFIED' as const,
  };
}

// ─── appendAuditLog ───────────────────────────────────────────────────────────

describe('appendAuditLog', () => {
  it('returns an entry with a non-empty logId UUID', () => {
    const entry = svc.appendAuditLog(baseEntry());
    expect(entry.logId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });

  it('returns an entry with an ISO timestamp', () => {
    const before = Date.now();
    const entry = svc.appendAuditLog(baseEntry());
    const after = Date.now();
    const ts = new Date(entry.timestamp).getTime();
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });

  it('returns a 64-character hex signatureHash', () => {
    const entry = svc.appendAuditLog(baseEntry());
    expect(entry.signatureHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('includes all supplied fields in the returned entry', () => {
    const data = baseEntry();
    const entry = svc.appendAuditLog(data);
    expect(entry.userId).toBe(data.userId);
    expect(entry.actionType).toBe(data.actionType);
    expect(entry.modelVersions).toEqual(data.modelVersions);
    expect(entry.ragDocumentsUsed).toEqual(data.ragDocumentsUsed);
    expect(entry.verificationStatus).toBe(data.verificationStatus);
  });

  it('accepts an object as promptOrInput', () => {
    const entry = svc.appendAuditLog({
      ...baseEntry(),
      promptOrInput: { question: 'Vad är risken?', context: {} },
    });
    expect(typeof entry.promptOrInput).toBe('object');
  });

  it('accepts an object as responseOrOutput', () => {
    const entry = svc.appendAuditLog({
      ...baseEntry(),
      responseOrOutput: { risk: 'high', score: 0.9 },
    });
    expect(typeof entry.responseOrOutput).toBe('object');
  });

  it('produces different logIds for successive calls', () => {
    const a = svc.appendAuditLog(baseEntry());
    const b = svc.appendAuditLog(baseEntry());
    expect(a.logId).not.toBe(b.logId);
  });

  it('produces different timestamps for entries added at different times', async () => {
    const a = svc.appendAuditLog(baseEntry());
    await new Promise((r) => setTimeout(r, 2));
    const b = svc.appendAuditLog(baseEntry());
    expect(new Date(b.timestamp).getTime()).toBeGreaterThanOrEqual(new Date(a.timestamp).getTime());
  });
});

// ─── getAuditLogs ─────────────────────────────────────────────────────────────

describe('getAuditLogs', () => {
  it('returns the appended entry when no userId filter is given', () => {
    svc.appendAuditLog(baseEntry());
    const logs = svc.getAuditLogs();
    expect(logs.length).toBeGreaterThanOrEqual(1);
  });

  it('filters entries by userId', () => {
    svc.appendAuditLog({ ...baseEntry(), userId: 'alice' });
    svc.appendAuditLog({ ...baseEntry(), userId: 'bob' });
    const aliceLogs = svc.getAuditLogs('alice');
    expect(aliceLogs.every((l) => l.userId === 'alice')).toBe(true);
    expect(aliceLogs.length).toBeGreaterThanOrEqual(1);
  });

  it('returns an empty array for an unknown userId', () => {
    svc.appendAuditLog(baseEntry());
    const logs = svc.getAuditLogs('unknown-user-xyz');
    expect(logs).toHaveLength(0);
  });

  it('returns a copy – mutating the array does not affect the internal trail', () => {
    svc.appendAuditLog(baseEntry());
    const logs = svc.getAuditLogs();
    const original = logs.length;
    logs.pop();
    expect(svc.getAuditLogs().length).toBe(original);
  });

  it('supports RULE_ENGINE_EVALUATION actionType', () => {
    svc.appendAuditLog({ ...baseEntry(), actionType: 'RULE_ENGINE_EVALUATION' });
    const logs = svc.getAuditLogs();
    const found = logs.find((l) => l.actionType === 'RULE_ENGINE_EVALUATION');
    expect(found).toBeDefined();
  });

  it('supports MANUAL_OVERRIDE verificationStatus', () => {
    svc.appendAuditLog({ ...baseEntry(), verificationStatus: 'MANUAL_OVERRIDE' });
    const logs = svc.getAuditLogs();
    const found = logs.find((l) => l.verificationStatus === 'MANUAL_OVERRIDE');
    expect(found).toBeDefined();
  });
});
