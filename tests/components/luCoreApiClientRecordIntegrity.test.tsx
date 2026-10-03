/**
 * W-UI1 (B; U20CDF4 424 body): the API client keeps the 424's `record_integrity` envelope on the thrown error,
 * as it keeps code/failureClass/reasonCode/retryable, so the UI can show the stored findings as an unverified,
 * non-authoritative diagnostic. Anything that is not a plain object is not attached. No network: csrfFetch is
 * mocked.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const csrfFetch = vi.hoisted(() => vi.fn());
vi.mock('../../services/csrfClient', () => ({ csrfFetch: (...args: unknown[]) => csrfFetch(...args) }));

import { callApi } from '../../services/coreApiClient';

const json = (body: unknown, status: number) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

afterEach(() => {
  vi.clearAllMocks();
});

describe('W-UI1: callApi keeps the record_integrity envelope of a failed answer', () => {
  it('attaches a plain-object record_integrity next to the codes', async () => {
    const diagnostic = { authoritative: false, verified: false, basis_codes: ['UNKNOWN_SEVERITY'], stored_findings_unverified: { total: 1 } };
    csrfFetch.mockResolvedValue(
      json({ ok: false, error: 'Bedömningen kan inte visas', code: 'ASSESSMENT_RECORD_INTEGRITY_ERROR', failureClass: 'RECORD_INTEGRITY_ERROR', retryable: false, record_integrity: diagnostic }, 424),
    );
    const err = (await callApi('/api/localization/p/current-assessment', { method: 'GET', auth: false }).catch((e) => e)) as Record<string, unknown>;
    expect(err).toBeInstanceOf(Error);
    expect(err.status).toBe(424);
    expect(err.code).toBe('ASSESSMENT_RECORD_INTEGRITY_ERROR');
    expect(err.retryable).toBe(false);
    expect(err.record_integrity).toEqual(diagnostic);
  });

  it('never attaches a record_integrity that is not a plain object', async () => {
    for (const value of [null, 'x', 1, ['a'], true]) {
      csrfFetch.mockResolvedValue(json({ ok: false, error: 'x', code: 'ASSESSMENT_RECORD_INTEGRITY_ERROR', record_integrity: value }, 424));
      const err = (await callApi('/x', { method: 'GET', auth: false }).catch((e) => e)) as Record<string, unknown>;
      expect(Object.prototype.hasOwnProperty.call(err, 'record_integrity'), JSON.stringify(value)).toBe(false);
    }
  });
});
