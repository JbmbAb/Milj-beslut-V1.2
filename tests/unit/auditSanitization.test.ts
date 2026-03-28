import { describe, expect, it } from 'vitest';
import { sanitizeAuditPayload, auditPayloadSafe } from '../../server/security/auditSanitization';

describe('auditSanitization', () => {
  it('redacts sensitive fields by exact name', () => {
    const payload = {
      password: 'mypassword',
      username: 'jimmy',
      secret: 'mysecret',
    };
    const sanitized = sanitizeAuditPayload(payload) as any;
    expect(sanitized.username).toBe('jimmy');
    expect(sanitized.password).toBe('[REDACTED_10_CHARS]');
    expect(sanitized.secret).toBe('[REDACTED_8_CHARS]');
  });

  it('redacts sensitive fields by pattern matching', () => {
    const payload = {
      userToken: 'abc-123',
      apiKey: 'key-99',
      another_secret_key: 'topsecret',
    };
    const sanitized = sanitizeAuditPayload(payload) as any;
    expect(sanitized.userToken).toBe('[REDACTED_7_CHARS]');
    expect(sanitized.apiKey).toBe('[REDACTED_6_CHARS]');
    expect(sanitized.another_secret_key).toBe('[REDACTED_9_CHARS]');
  });

  it('redacts non-string sensitive values', () => {
    const payload = {
      password: { complex: true },
      secret: 12345,
    };
    const sanitized = sanitizeAuditPayload(payload) as any;
    expect(sanitized.password).toBe('[REDACTED_OBJECT]');
    expect(sanitized.secret).toBe('[REDACTED]');
  });

  it('recursively sanitizes nested objects', () => {
    const payload = {
      meta: {
        id: 1,
        password: 'nested-pass',
      },
      user: {
        profile: {
          token: 'inner-token',
        },
      },
    };
    const sanitized = sanitizeAuditPayload(payload) as any;
    expect(sanitized.meta).toEqual({
      id: 1,
      password: '[REDACTED_11_CHARS]',
    });
    expect(sanitized.user.profile.token).toBe('[REDACTED_11_CHARS]');
  });

  it('sanitizes objects inside arrays', () => {
    const payload = {
      items: [{ name: 'item1', secret: 's1' }, { name: 'item2', apiKey: 'k2' }, 'regular-string'],
    };
    const sanitized = sanitizeAuditPayload(payload) as any;
    expect(sanitized.items[0].secret).toBe('[REDACTED_2_CHARS]');
    expect(sanitized.items[1].apiKey).toBe('[REDACTED_2_CHARS]');
    expect(sanitized.items[2]).toBe('regular-string');
  });

  it('redacts Swedish GDPR-specific fields like personnummer and bankidId', () => {
    const payload = {
      användare: 'Björn Söderström',
      personnummer: '19900101-1234',
      bankidId: '199001011234',
      socialSecurityNumber: '19900101-1234',
    };
    const sanitized = sanitizeAuditPayload(payload) as any;
    expect(sanitized.användare).toBe('Björn Söderström');
    expect(sanitized.personnummer).toBe('[REDACTED_13_CHARS]');
    expect(sanitized.bankidId).toBe('[REDACTED_12_CHARS]');
    expect(sanitized.socialSecurityNumber).toBe('[REDACTED_13_CHARS]');
  });

  it('handles edge cases: null, undefined, empty arrays, and mixed data gracefully', () => {
    const payload = {
      validKey: 'Gävle Brynäs 1:1',
      nullValue: null,
      undefinedValue: undefined,
      emptyArray: [],
      mixedArray: [null, undefined, 'Åmål'],
      pii_data: null,
    };
    const sanitized = sanitizeAuditPayload(payload) as any;
    expect(sanitized.validKey).toBe('Gävle Brynäs 1:1');
    expect(sanitized.nullValue).toBeNull();
    expect(sanitized.undefinedValue).toBeUndefined();
    expect(sanitized.emptyArray).toEqual([]);
    expect(sanitized.mixedArray).toEqual([null, undefined, 'Åmål']);
    expect(sanitized.pii_data).toBe('[REDACTED]');
  });

  it('redacts personnummer found inside non-sensitive strings', () => {
    const payload = { note: 'Contact: 19900101-1234 for the case.' };
    const sanitized = sanitizeAuditPayload(payload) as any;
    expect(sanitized.note).toBe('Contact: [REDACTED] for the case.');
  });

  it('works via auditPayloadSafe wrapper', () => {
    const payload = { password: 'test' };
    const sanitized = auditPayloadSafe(payload) as any;
    expect(sanitized.password).toBe('[REDACTED_4_CHARS]');
  });
});
