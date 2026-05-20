import { describe, it, expect, beforeEach, vi } from 'vitest';
import { sanitizeAuditPayload, auditPayloadSafe } from '../../server/security/auditSanitization';

describe('server/security/auditSanitization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('sanitizeAuditPayload', () => {
    it('redacts password fields', () => {
      const payload = {
        username: 'john_doe',
        password: 'supersecret123',
        email: 'john@example.com',
      };
      const result = sanitizeAuditPayload(payload) as any;

      expect(result.password).toBe('[REDACTED_14_CHARS]');
      expect(result.username).toBe('john_doe');
      expect(result.email).toContain('[REDACTED]');
    });

    it('redacts token fields', () => {
      const payload = {
        accessToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
        refreshToken: 'refresh_token_value',
        userId: 'user123',
      };
      const result = sanitizeAuditPayload(payload) as any;

      expect(result.accessToken).toMatch(/^\[REDACTED_\d+_CHARS\]$/);
      expect(result.refreshToken).toMatch(/^\[REDACTED_\d+_CHARS\]$/);
      expect(result.userId).toBe('user123');
    });

    it('redacts credential fields', () => {
      const payload = {
        apiKey: 'sk-1234567890',
        privateKey: 'pk_live_123456',
        secret: 'my_secret_value',
      };
      const result = sanitizeAuditPayload(payload) as any;

      expect(result.apiKey).toMatch(/^\[REDACTED_\d+_CHARS\]$/);
      expect(result.privateKey).toMatch(/^\[REDACTED_\d+_CHARS\]$/);
      expect(result.secret).toMatch(/^\[REDACTED_\d+_CHARS\]$/);
    });

    it('redacts Swedish personal identity numbers', () => {
      const payload = {
        text: 'User with personnummer 199001011234 or 900101-1234 applied',
        projectId: 'proj123',
      };
      const result = sanitizeAuditPayload(payload) as any;

      expect(result.text).toContain('[REDACTED]');
      expect(result.text).not.toContain('199001011234');
      expect(result.text).not.toContain('900101-1234');
    });

    it('redacts email addresses', () => {
      const payload = {
        description: 'Email: john.doe@example.com contacted us',
        userId: 'user123',
      };
      const result = sanitizeAuditPayload(payload) as any;

      expect(result.description).toContain('[REDACTED]');
      expect(result.description).not.toContain('john.doe@example.com');
    });

    it('redacts bankID fields', () => {
      const payload = {
        bankidId: '198901011234',
        bankid_reference: 'ref_123456',
        action: 'login',
      };
      const result = sanitizeAuditPayload(payload) as any;

      expect(result.bankidId).toMatch(/^\[REDACTED_\d+_CHARS\]$/);
      expect(result.bankid_reference).toMatch(/^\[REDACTED_\d+_CHARS\]$/);
      expect(result.action).toBe('login');
    });

    it('handles nested objects', () => {
      const payload = {
        user: {
          id: 'user123',
          password: 'secret123',
          profile: {
            email: 'test@example.com',
          },
        },
        action: 'update_profile',
      };
      const result = sanitizeAuditPayload(payload) as any;

      expect(result.user?.id).toBe('user123');
      expect(result.user?.password).toMatch(/^\[REDACTED_\d+_CHARS\]$/);
      expect(result.user?.profile?.email).toContain('[REDACTED]');
      expect(result.action).toBe('update_profile');
    });

    it('handles arrays with objects', () => {
      const payload = {
        users: [
          { id: 'user1', password: 'pass1', apiKey: 'key1' },
          { id: 'user2', password: 'pass2', apiKey: 'key2' },
        ],
      };
      const result = sanitizeAuditPayload(payload) as any;

      expect(Array.isArray(result.users)).toBe(true);
      expect(result.users?.[0]?.id).toBe('user1');
      expect(result.users?.[0]?.password).toMatch(/^\[REDACTED_\d+_CHARS\]$/);
      expect(result.users?.[1]?.apiKey).toMatch(/^\[REDACTED_\d+_CHARS\]$/);
    });

    it('handles arrays of strings with PII', () => {
      const payload = {
        emails: ['john@example.com', 'jane@example.com', 'personal-email'],
      };
      const result = sanitizeAuditPayload(payload) as any;

      expect(Array.isArray(result.emails)).toBe(true);
      expect(result.emails?.[0]).toContain('[REDACTED]');
      expect(result.emails?.[1]).toContain('[REDACTED]');
      expect(result.emails?.[2]).toBe('personal-email');
    });

    it('preserves object types', () => {
      const payload = {
        count: 42,
        isActive: true,
        amount: 123.45,
        name: 'Test Project',
      };
      const result = sanitizeAuditPayload(payload) as any;

      expect(result.count).toBe(42);
      expect(result.isActive).toBe(true);
      expect(result.amount).toBe(123.45);
      expect(result.name).toBe('Test Project');
    });

    it('handles null and undefined values', () => {
      const payload = {
        password: null,
        email: undefined,
        apiKey: '',
        name: 'Test',
      };
      const result = sanitizeAuditPayload(payload) as any;

      expect(result.password).toBe('[REDACTED]');
      expect(result.email).toBeUndefined();
      expect(result.apiKey).toBe('[REDACTED_0_CHARS]');
      expect(result.name).toBe('Test');
    });

    it('case-insensitive matching for field names', () => {
      const payload = {
        Password: 'secret',
        PASSWORD: 'secret2',
        Api_Key: 'key1',
        PRIVATE_KEY: 'key2',
      };
      const result = sanitizeAuditPayload(payload) as any;

      expect(result.Password).toMatch(/^\[REDACTED_\d+_CHARS\]$/);
      expect(result.PASSWORD).toMatch(/^\[REDACTED_\d+_CHARS\]$/);
      expect(result.Api_Key).toMatch(/^\[REDACTED_\d+_CHARS\]$/);
      expect(result.PRIVATE_KEY).toMatch(/^\[REDACTED_\d+_CHARS\]$/);
    });

    it('prevents bulk lookup/injection attempts', () => {
      const payload = {
        description: 'Searched for pattern OR 1=1; DROP TABLE users;',
        projectId: 'proj123',
      };
      const result = sanitizeAuditPayload(payload) as any;

      expect(result.description).toBeDefined();
      expect(result.projectId).toBe('proj123');
    });

    it('handles empty payload', () => {
      const payload = {};
      const result = sanitizeAuditPayload(payload) as any;

      expect(result).toEqual({});
    });

    it('handles deeply nested structures', () => {
      const payload = {
        level1: {
          level2: {
            level3: {
              password: 'deep_secret',
              userId: 'user123',
            },
          },
        },
      };
      const result = sanitizeAuditPayload(payload) as any;

      expect(result.level1?.level2?.level3?.password).toMatch(/^\[REDACTED_\d+_CHARS\]$/);
      expect(result.level1?.level2?.level3?.userId).toBe('user123');
    });
  });

  describe('auditPayloadSafe', () => {
    it('wraps sanitizeAuditPayload correctly', () => {
      const payload = {
        username: 'john',
        password: 'secret',
      };
      const result = auditPayloadSafe(payload) as any;

      expect(result.username).toBe('john');
      expect(result.password).toMatch(/^\[REDACTED_\d+_CHARS\]$/);
    });

    it('handles complex scenarios from real audit logs', () => {
      const payload = {
        action: 'USER_CREATED',
        timestamp: new Date().toISOString(),
        actor: 'admin@example.com',
        subject: {
          id: 'user456',
          email: 'newuser@example.com',
          personnummer: '200001011234',
          bankidId: 'bid123456',
        },
        credentials: {
          password: 'InitialPassword123',
          apiKey: 'sk_prod_abc123def456',
        },
        result: 'success',
      };
      const result = auditPayloadSafe(payload) as any;

      expect(result.action).toBe('USER_CREATED');
      expect(result.actor).toContain('[REDACTED]');
      expect(result.subject?.id).toBe('user456');
      expect(result.subject?.email).toContain('[REDACTED]');
      expect(result.subject?.personnummer).toMatch(/^\[REDACTED_\d+_CHARS\]$/);
      expect(result.subject?.bankidId).toMatch(/^\[REDACTED_\d+_CHARS\]$/);
      // `credentials` key matches /credential/i → treated as a sensitive field and
      // becomes '[REDACTED_OBJECT]' rather than being recursively sanitized.
      expect(String(result.credentials)).toContain('[REDACTED');
      expect(result.result).toBe('success');
    });
  });
});
