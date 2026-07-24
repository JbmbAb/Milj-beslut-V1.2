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

  it('redacts bankid-related snake_case fields by pattern', () => {
    const result = sanitizeAuditPayload({ bankid_reference: 'ref_123456', action: 'login' });
    expect(result.bankid_reference).toBe('[REDACTED_10_CHARS]');
    expect(result.action).toBe('login');
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

  it('redacts emails and personnummer inside free-text fields', () => {
    const result = sanitizeAuditPayload({
      description: 'Kontakt: john.doe@example.com, personnummer 199001011234 och 900101-1234.',
    });
    expect(result.description).toBe('Kontakt: [REDACTED], personnummer [REDACTED] och [REDACTED].');
  });

  it('matches sensitive field names by pattern (e.g. myApiKey)', () => {
    const result = sanitizeAuditPayload({ myApiKey: 'val', xToken: 'tok' });
    expect(result.myApiKey).toMatch(/REDACTED/);
    expect(result.xToken).toMatch(/REDACTED/);
  });

  it('matches sensitive field names case-insensitively', () => {
    const result = sanitizeAuditPayload({
      Password: 'secret',
      Api_Key: 'key1',
      PRIVATE_KEY: 'key2',
    });
    expect(result.Password).toBe('[REDACTED_6_CHARS]');
    expect(result.Api_Key).toBe('[REDACTED_4_CHARS]');
    expect(result.PRIVATE_KEY).toBe('[REDACTED_4_CHARS]');
  });

  it('collapses sensitive objects instead of recursively expanding them', () => {
    const result = sanitizeAuditPayload({
      credentials: {
        password: 'secret',
        apiKey: 'sk_live_123',
      },
      result: 'success',
    });
    expect(result.credentials).toBe('[REDACTED_OBJECT]');
    expect(result.result).toBe('success');
  });

  it('preserves null, undefined, and primitive values consistently', () => {
    const result = sanitizeAuditPayload({
      password: null,
      email: undefined,
      apiKey: '',
      count: 42,
      isActive: true,
    });
    expect(result.password).toBe('[REDACTED]');
    expect(result.email).toBeUndefined();
    expect(result.apiKey).toBe('[REDACTED_0_CHARS]');
    expect(result.count).toBe(42);
    expect(result.isActive).toBe(true);
  });

  it('handles deeply nested structures', () => {
    const result = sanitizeAuditPayload({
      level1: {
        level2: {
          level3: {
            password: 'deep_secret',
            email: 'nested@example.com',
            userId: 'user123',
          },
        },
      },
    });
    const nested = ((result.level1 as Record<string, unknown>).level2 as Record<string, unknown>)
      .level3 as Record<string, unknown>;
    expect(nested.password).toBe('[REDACTED_11_CHARS]');
    expect(nested.email).toBe('[REDACTED]');
    expect(nested.userId).toBe('user123');
  });

  it('marks circular object references instead of recursing forever', () => {
    const payload: Record<string, unknown> = { id: 'node-1' };
    payload.self = payload;

    const result = sanitizeAuditPayload(payload);

    expect(result.id).toBe('node-1');
    expect(result.self).toBe('[CIRCULAR]');
  });

  it('marks circular array references instead of recursing forever', () => {
    const entries: unknown[] = [];
    entries.push({ label: 'safe' }, entries);

    const result = sanitizeAuditPayload({ entries });

    expect(result.entries).toEqual([{ label: 'safe' }, '[CIRCULAR]']);
  });

  it('preserves Date values as cloned Date instances', () => {
    const createdAt = new Date('2024-06-01T12:00:00.000Z');

    const result = sanitizeAuditPayload({ createdAt });

    expect(result.createdAt).toBeInstanceOf(Date);
    expect((result.createdAt as Date).toISOString()).toBe('2024-06-01T12:00:00.000Z');
    expect(result.createdAt).not.toBe(createdAt);
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
