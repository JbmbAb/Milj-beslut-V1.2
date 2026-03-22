import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { appendDomainAudit } = vi.hoisted(() => ({
  appendDomainAudit: vi.fn(),
}));

vi.mock('../../server/security/auditTrail', () => ({
  appendDomainAudit,
}));

import { submitPermitToAuthority } from '../../server/services/permitAuthorityService';

describe('permitAuthorityService', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    process.env = { ...originalEnv };
    delete process.env.AUTHORITY_SUBMIT_ENDPOINT;
    delete process.env.AUTHORITY_API_KEY;
    delete process.env.AUTHORITY_BEARER_TOKEN;
    delete process.env.AUTHORITY_SUBMIT_AUTH_MODE;
    delete process.env.AUTHORITY_SUBMIT_MAX_RETRIES;
    delete process.env.AUTHORITY_SUBMIT_TIMEOUT_MS;
    appendDomainAudit.mockResolvedValue({ id: 'audit-1' });
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.unstubAllGlobals();
  });

  async function submit() {
    return submitPermitToAuthority({
      projectId: 'proj-1',
      orgId: 'org-1',
      actingUserId: 'user-1',
      permitType: 'Anmalan 9 kap',
      applicantName: 'Test Applicant',
      propertyDesignation: 'ORSA STACKMORA 3:12',
      documentIds: ['doc-1'],
      authorityName: 'Lansstyrelsen',
    });
  }

  it('returns blocked pending review when no endpoint is configured', async () => {
    const submission = await submit();

    expect(submission.status).toBe('PENDING_REVIEW');
    expect(submission.providerMode).toBe('unconfigured');
    expect(submission.failureMode).toBe('missing_endpoint');
    expect(submission.responseCode).toBeNull();
    expect(appendDomainAudit).toHaveBeenCalledTimes(1);
  });

  it('maps successful external submit responses', async () => {
    process.env.AUTHORITY_SUBMIT_ENDPOINT = 'https://authority.example.invalid/submit';
    process.env.AUTHORITY_SUBMIT_AUTH_MODE = 'x-api-key';
    process.env.AUTHORITY_API_KEY = 'test-key';

    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(_input)).toBe('https://authority.example.invalid/submit');
      expect(init?.method).toBe('POST');
      expect(init?.headers).toMatchObject({
        'Content-Type': 'application/json',
        'X-Api-Key': 'test-key',
      });
      return new Response(
        JSON.stringify({
          ref: 'ext-123',
          status: 'RECEIVED',
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const submission = await submit();

    expect(submission.status).toBe('RECEIVED');
    expect(submission.providerMode).toBe('external');
    expect(submission.externalRef).toBe('ext-123');
    expect(submission.responseCode).toBe(200);
    expect(submission.failureMode).toBeNull();
  });

  it('maps 4xx responses to REJECTED when endpoint is configured', async () => {
    process.env.AUTHORITY_SUBMIT_ENDPOINT = 'https://authority.example.invalid/submit';
    process.env.AUTHORITY_SUBMIT_MAX_RETRIES = '0';

    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ status: 'INVALID' }), {
            status: 422,
            headers: { 'Content-Type': 'application/json' },
          }),
      ),
    );

    const submission = await submit();

    expect(submission.status).toBe('REJECTED');
    expect(submission.providerMode).toBe('external');
    expect(submission.responseCode).toBe(422);
    expect(submission.failureMode).toBe('http_4xx');
  });

  it('maps 5xx responses to PENDING_REVIEW when endpoint is configured', async () => {
    process.env.AUTHORITY_SUBMIT_ENDPOINT = 'https://authority.example.invalid/submit';
    process.env.AUTHORITY_SUBMIT_MAX_RETRIES = '0';

    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ status: 'DOWN' }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' },
          }),
      ),
    );

    const submission = await submit();

    expect(submission.status).toBe('PENDING_REVIEW');
    expect(submission.providerMode).toBe('external');
    expect(submission.responseCode).toBe(503);
    expect(submission.failureMode).toBe('http_5xx');
  });

  it('maps timeout errors to PENDING_REVIEW when endpoint is configured', async () => {
    process.env.AUTHORITY_SUBMIT_ENDPOINT = 'https://authority.example.invalid/submit';
    process.env.AUTHORITY_SUBMIT_MAX_RETRIES = '0';

    const timeoutError = new Error('timed out');
    timeoutError.name = 'AbortError';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(timeoutError)),
    );

    const submission = await submit();

    expect(submission.status).toBe('PENDING_REVIEW');
    expect(submission.providerMode).toBe('external');
    expect(submission.responseCode).toBeNull();
    expect(submission.failureMode).toBe('timeout');
  });
});
