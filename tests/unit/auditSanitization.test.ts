import { describe, expect, it } from 'vitest';
import {
  sanitizeAuditPayload,
  auditPayloadSafe,
} from '../../server/security/auditSanitization';

describe('sanitizeAuditPayload', () => {
  it('redacts password field', () => {
    const result = sanitizeAuditPayload({ password: 'superSecret123' });
    expect(result.password).toMatch(/\[REDACTED/);
    expect(String(result.password)).not.toContain('superSecret123');
  });

  it('redacts known sensitive field names', () => {
    const sensitive = {
      refreshToken: 'tok',
      accessToken: 'tok2',
      apiKey: 'key1',
      secret: 'sec',
      bankidId: 'bid-1',
      personnummer: '199001011234',
      socialSecurityNumber: '123456789',
    };
    const result = sanitizeAuditPayload(sensitive);
    for (const key of Object.keys(sensitive)) {
      expect(String(result[key])).toMatch(/\[REDACTED/);
    }
  });

  it('preserves non-sensitive fields unchanged', () => {
    const result = sanitizeAuditPayload({
      action: 'READ',
      projectId: 'proj-1',
      propertyDesignation: 'Stockholm Centrum 1:1',
      count: 5,
      active: true,
    });
    expect(result.action).toBe('READ');
    expect(result.projectId).toBe('proj-1');
    expect(result.count).toBe(5);
    expect(result.active).toBe(true);
  });

  it('redacts fields matching sensitive patterns (case-insensitive)', () => {
    const result = sanitizeAuditPayload({
      userPassword: 'abc',
      SecretValue: 'xyz',
      apiKeyName: 'val',
      BANKID_ID: 'bid',
    });
    expect(String(result.userPassword)).toMatch(/\[REDACTED/);
    expect(String(result.SecretValue)).toMatch(/\[REDACTED/);
    expect(String(result.apiKeyName)).toMatch(/\[REDACTED/);
    expect(String(result.BANKID_ID)).toMatch(/\[REDACTED/);
  });

  it('redacts object values for sensitive keys', () => {
    const result = sanitizeAuditPayload({ secret: { nested: 'value' } });
    expect(result.secret).toBe('[REDACTED_OBJECT]');
  });

  it('recursively sanitizes nested objects', () => {
    const result = sanitizeAuditPayload({
      user: {
        name: 'Alice',
        password: 'hunter2',
      },
    });
    const nested = result.user as Record<string, unknown>;
    expect(nested.name).toBe('Alice');
    expect(String(nested.password)).toMatch(/\[REDACTED/);
  });

  it('sanitizes items inside arrays', () => {
    const result = sanitizeAuditPayload({
      entries: [
        { action: 'READ', token: 'abc' },
        { action: 'WRITE', token: 'xyz' },
      ],
    });
    const entries = result.entries as Array<Record<string, unknown>>;
    expect(entries[0].action).toBe('READ');
    expect(String(entries[0].token)).toMatch(/\[REDACTED/);
    expect(String(entries[1].token)).toMatch(/\[REDACTED/);
  });

  it('encodes redacted string length hint', () => {
    const value = 'abcdefgh'; // 8 chars
    const result = sanitizeAuditPayload({ password: value });
    expect(result.password).toBe('[REDACTED_8_CHARS]');
  });

  it('handles empty payload without throwing', () => {
    expect(sanitizeAuditPayload({})).toEqual({});
  });
});

describe('auditPayloadSafe', () => {
  it('is an alias for sanitizeAuditPayload and redacts sensitive fields', () => {
    const result = auditPayloadSafe({ action: 'LOGIN', bankidId: 'bid-99' });
    expect(result.action).toBe('LOGIN');
    expect(String(result.bankidId)).toMatch(/\[REDACTED/);
  });
});
