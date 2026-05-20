import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Module under test (pure functions, no module state) ─────────────────────

import { submitToConfiguredAuthority } from '../../server/services/permitAuthorityAdapter';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function baseInput() {
  return {
    referenceId: 'ref-1',
    caseNumber: 'CASE-001',
    submittedAt: '2024-07-01T10:00:00Z',
    projectId: 'proj-1',
    orgId: 'org-1',
    authority: 'Länsstyrelsen',
    permitType: 'MILJOTILLSTAND',
    applicantName: 'Bolaget AB',
    propertyDesignation: 'GÖTEBORG STAMPEN 1:1',
    documentIds: ['doc-1', 'doc-2'],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.AUTHORITY_SUBMIT_ENDPOINT;
  delete process.env.AUTHORITY_API_KEY;
  delete process.env.AUTHORITY_BEARER_TOKEN;
  delete process.env.AUTHORITY_SUBMIT_AUTH_MODE;
  delete process.env.AUTHORITY_SUBMIT_TIMEOUT_MS;
  delete process.env.AUTHORITY_SUBMIT_MAX_RETRIES;
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('permitAuthorityAdapter – submitToConfiguredAuthority', () => {
  // ── No endpoint configured ─────────────────────────────────────────────────

  describe('no endpoint configured', () => {
    it('returns unconfigured providerMode with missing_endpoint failureMode', async () => {
      const result = await submitToConfiguredAuthority(baseInput());

      expect(result.providerMode).toBe('unconfigured');
      expect(result.failureMode).toBe('missing_endpoint');
      expect(result.status).toBe('PENDING_REVIEW');
      expect(result.responseCode).toBeNull();
      expect(result.rawStatus).toBeNull();
    });
  });

  // ── 200 responses ─────────────────────────────────────────────────────────

  describe('successful 2xx responses', () => {
    it('returns external providerMode and null failureMode on 200 JSON', async () => {
      process.env.AUTHORITY_SUBMIT_ENDPOINT = 'https://auth.example.com/submit';

      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 201,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ ref: 'EXT-REF-001', status: 'RECEIVED' }),
        text: async () => '',
      } as unknown as Response);

      const result = await submitToConfiguredAuthority(baseInput());

      expect(result.providerMode).toBe('external');
      expect(result.failureMode).toBeNull();
      expect(result.status).toBe('RECEIVED');
      expect(result.externalRef).toBe('EXT-REF-001');
      expect(result.responseCode).toBe(201);

      fetchSpy.mockRestore();
    });

    it('maps ACCEPTED to RECEIVED status', async () => {
      process.env.AUTHORITY_SUBMIT_ENDPOINT = 'https://auth.example.com/submit';

      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ status: 'ACCEPTED' }),
        text: async () => '',
      } as unknown as Response);

      const result = await submitToConfiguredAuthority(baseInput());
      expect(result.status).toBe('RECEIVED');

      fetchSpy.mockRestore();
    });

    it('defaults to SUBMITTED when no status field in response', async () => {
      process.env.AUTHORITY_SUBMIT_ENDPOINT = 'https://auth.example.com/submit';

      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({}),
        text: async () => '',
      } as unknown as Response);

      const result = await submitToConfiguredAuthority(baseInput());
      expect(result.status).toBe('SUBMITTED');

      fetchSpy.mockRestore();
    });

    it('handles plain text response and extracts ref', async () => {
      process.env.AUTHORITY_SUBMIT_ENDPOINT = 'https://auth.example.com/submit';

      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'text/plain' }),
        json: async () => {
          throw new Error('not JSON');
        },
        text: async () => 'TEXTREF-999',
      } as unknown as Response);

      const result = await submitToConfiguredAuthority(baseInput());
      expect(result.externalRef).toBe('TEXTREF-999');

      fetchSpy.mockRestore();
    });
  });

  // ── 4xx responses ──────────────────────────────────────────────────────────

  describe('4xx responses', () => {
    it('returns REJECTED status and http_4xx failureMode', async () => {
      process.env.AUTHORITY_SUBMIT_ENDPOINT = 'https://auth.example.com/submit';

      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 422,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ status: 'INVALID' }),
        text: async () => '',
      } as unknown as Response);

      const result = await submitToConfiguredAuthority(baseInput());

      expect(result.status).toBe('REJECTED');
      expect(result.failureMode).toBe('http_4xx');
      expect(result.responseCode).toBe(422);

      fetchSpy.mockRestore();
    });
  });

  // ── 5xx responses ──────────────────────────────────────────────────────────

  describe('5xx responses', () => {
    it('returns PENDING_REVIEW and http_5xx failureMode (no retries)', async () => {
      process.env.AUTHORITY_SUBMIT_ENDPOINT = 'https://auth.example.com/submit';
      process.env.AUTHORITY_SUBMIT_MAX_RETRIES = '0';

      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 503,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({}),
        text: async () => '',
      } as unknown as Response);

      const result = await submitToConfiguredAuthority(baseInput());

      expect(result.failureMode).toBe('http_5xx');
      expect(result.status).toBe('PENDING_REVIEW');

      fetchSpy.mockRestore();
    });
  });

  // ── Network/timeout errors ─────────────────────────────────────────────────

  describe('network errors', () => {
    it('returns timeout failureMode when TimeoutError is thrown', async () => {
      process.env.AUTHORITY_SUBMIT_ENDPOINT = 'https://auth.example.com/submit';
      process.env.AUTHORITY_SUBMIT_MAX_RETRIES = '0';

      const abortErr = Object.assign(new Error('Request timed out'), { name: 'TimeoutError' });
      const fetchSpy = vi.spyOn(global, 'fetch').mockRejectedValueOnce(abortErr);

      const result = await submitToConfiguredAuthority(baseInput());

      expect(result.failureMode).toBe('timeout');
      expect(result.responseCode).toBeNull();

      fetchSpy.mockRestore();
    });

    it('returns network failureMode for generic network errors', async () => {
      process.env.AUTHORITY_SUBMIT_ENDPOINT = 'https://auth.example.com/submit';
      process.env.AUTHORITY_SUBMIT_MAX_RETRIES = '0';

      const fetchSpy = vi.spyOn(global, 'fetch').mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const result = await submitToConfiguredAuthority(baseInput());

      expect(result.failureMode).toBe('network');
      expect(result.status).toBe('PENDING_REVIEW');

      fetchSpy.mockRestore();
    });
  });

  // ── Status mapping ─────────────────────────────────────────────────────────

  describe('status mapping', () => {
    const cases: Array<[string, string]> = [
      ['SUBMITTED', 'SUBMITTED'],
      ['SENT', 'SUBMITTED'],
      ['QUEUED', 'SUBMITTED'],
      ['RECEIVED', 'RECEIVED'],
      ['PENDING', 'PENDING_REVIEW'],
      ['UNDER_REVIEW', 'PENDING_REVIEW'],
      ['DENIED', 'REJECTED'],
      ['INVALID', 'REJECTED'],
    ];

    for (const [raw, expected] of cases) {
      it(`maps raw status "${raw}" to "${expected}"`, async () => {
        process.env.AUTHORITY_SUBMIT_ENDPOINT = 'https://auth.example.com/submit';

        const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({ status: raw }),
          text: async () => '',
        } as unknown as Response);

        const result = await submitToConfiguredAuthority(baseInput());
        expect(result.status).toBe(expected);

        fetchSpy.mockRestore();
      });
    }
  });

  // ── Auth header modes ──────────────────────────────────────────────────────

  describe('auth header selection', () => {
    async function getHeaders(authMode?: string): Promise<Record<string, string>> {
      process.env.AUTHORITY_SUBMIT_ENDPOINT = 'https://auth.example.com/submit';
      if (authMode) process.env.AUTHORITY_SUBMIT_AUTH_MODE = authMode;

      let capturedHeaders: Record<string, string> = {};
      const fetchSpy = vi.spyOn(global, 'fetch').mockImplementationOnce(async (_url, opts) => {
        capturedHeaders = (opts?.headers ?? {}) as Record<string, string>;
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({}),
          text: async () => '',
        } as unknown as Response;
      });

      await submitToConfiguredAuthority(baseInput());
      fetchSpy.mockRestore();
      return capturedHeaders;
    }

    it('sends Bearer token when mode=bearer and AUTHORITY_BEARER_TOKEN is set', async () => {
      process.env.AUTHORITY_BEARER_TOKEN = 'my-bearer-token';
      const headers = await getHeaders('bearer');
      expect(headers['Authorization']).toBe('Bearer my-bearer-token');
    });

    it('sends X-Api-Key header when mode=x-api-key and AUTHORITY_API_KEY is set', async () => {
      process.env.AUTHORITY_API_KEY = 'my-api-key';
      const headers = await getHeaders('x-api-key');
      expect(headers['X-Api-Key']).toBe('my-api-key');
    });

    it('sends no auth headers when mode=none', async () => {
      process.env.AUTHORITY_API_KEY = 'ignored';
      process.env.AUTHORITY_BEARER_TOKEN = 'ignored';
      const headers = await getHeaders('none');
      expect(headers['Authorization']).toBeUndefined();
      expect(headers['X-Api-Key']).toBeUndefined();
    });
  });
});
