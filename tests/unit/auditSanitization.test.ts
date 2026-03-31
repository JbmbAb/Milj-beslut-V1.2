import { describe, expect, it } from 'vitest';
import { auditPayloadSafe, sanitizeAuditPayload } from '../../server/security/auditSanitization';

describe('sanitizeAuditPayload', () => {
  it('passes through non-sensitive fields unchanged', () => {
    const payload = { action: 'login', userId: 'u-1', timestamp: '2024-01-01T00:00:00Z' };
    const result = sanitizeAuditPayload(payload);
    expect(result).toEqual(payload);
  });

  it('redacts string values for known sensitive field names', () => {
    const result = sanitizeAuditPayload({ password: 'supersecret' });
    expect(result.password).toBe('[REDACTED_11_CHARS]');
  });

  it('redacts refreshToken and accessToken', () => {
    const result = sanitizeAuditPayload({ refreshToken: 'tok123', accessToken: 'acc456' });
    expect(result.refreshToken).toBe('[REDACTED_6_CHARS]');
    expect(result.accessToken).toBe('[REDACTED_6_CHARS]');
  });

  it('redacts apiKey and secret fields', () => {
    const result = sanitizeAuditPayload({ apiKey: 'key-abc', secret: 'shh' });
    expect(result.apiKey).toBe('[REDACTED_7_CHARS]');
    expect(result.secret).toBe('[REDACTED_3_CHARS]');
  });

  it('redacts bankidId', () => {
    const result = sanitizeAuditPayload({ bankidId: '199001011234' });
    expect(result.bankidId).toBe('[REDACTED_12_CHARS]');
  });

  it('redacts personnummer and socialSecurityNumber', () => {
    const result = sanitizeAuditPayload({ personnummer: '199001011234', socialSecurityNumber: '123456789' });
    expect(result.personnummer).toBe('[REDACTED_12_CHARS]');
    expect(result.socialSecurityNumber).toBe('[REDACTED_9_CHARS]');
  });

  it('redacts object-valued sensitive fields', () => {
    const result = sanitizeAuditPayload({ secret: { nested: 'value' } });
    expect(result.secret).toBe('[REDACTED_OBJECT]');
  });

  it('redacts non-string, non-object sensitive fields', () => {
    const result = sanitizeAuditPayload({ secret: 42 });
    expect(result.secret).toBe('[REDACTED]');
  });

  it('recursively sanitizes nested objects', () => {
    const result = sanitizeAuditPayload({
      user: {
        id: 'u-1',
        password: 'nested-secret',
      },
    });
    expect((result.user as Record<string, unknown>).password).toBe('[REDACTED_13_CHARS]');
    expect((result.user as Record<string, unknown>).id).toBe('u-1');
  });

  it('sanitizes sensitive objects inside arrays', () => {
    const result = sanitizeAuditPayload({
      items: [
        { id: 'i-1', password: 'abc' },
        { id: 'i-2', name: 'safe' },
      ],
    });
    const items = result.items as Array<Record<string, unknown>>;
    expect(items[0].password).toBe('[REDACTED_3_CHARS]');
    expect(items[0].id).toBe('i-1');
    expect(items[1].name).toBe('safe');
  });

  it('passes through primitive array values unchanged', () => {
    const result = sanitizeAuditPayload({ tags: ['a', 'b', 'c'] });
    expect(result.tags).toEqual(['a', 'b', 'c']);
  });

  it('matches sensitive field names by pattern (e.g. myApiKey)', () => {
    const result = sanitizeAuditPayload({ myApiKey: 'val', xToken: 'tok' });
    expect(result.myApiKey).toMatch(/REDACTED/);
    expect(result.xToken).toMatch(/REDACTED/);
  });
});

describe('auditPayloadSafe', () => {
  it('delegates to sanitizeAuditPayload', () => {
    const result = auditPayloadSafe({ action: 'view', password: 'pwd' });
    expect(result.action).toBe('view');
    expect(result.password).toMatch(/REDACTED/);
  });

  it('returns a plain object with all non-sensitive fields', () => {
    const result = auditPayloadSafe({ event: 'export', count: 5 });
    expect(result).toEqual({ event: 'export', count: 5 });
  });
});
