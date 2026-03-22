import { describe, expect, it } from 'vitest';
import { summarizeExternalHealthReport } from '../../server/services/externalHealthService';
import type { ExternalHealthCheck } from '../../types';

describe('summarizeExternalHealthReport', () => {
  it('builds totals, categories and overall status from checks', () => {
    const checks: ExternalHealthCheck[] = [
      {
        key: 'gemini',
        label: 'Gemini',
        category: 'AI',
        status: 'healthy',
        mode: 'live',
        configured: true,
        detail: 'OK',
      },
      {
        key: 'openai',
        label: 'OpenAI',
        category: 'AI',
        status: 'error',
        mode: 'live',
        configured: true,
        detail: '403',
      },
      {
        key: 'bankid',
        label: 'BankID',
        category: 'Identitet',
        status: 'not_configured',
        mode: 'config',
        configured: false,
        detail: 'missing',
      },
      {
        key: 'permit_authority',
        label: 'Permit authority',
        category: 'Workflow',
        status: 'degraded',
        mode: 'config',
        configured: true,
        detail: 'mock',
      },
    ];

    const report = summarizeExternalHealthReport(checks, '2026-03-18T10:00:00.000Z');

    expect(report.checkedAt).toBe('2026-03-18T10:00:00.000Z');
    expect(report.overall).toBe('error');
    expect(report.totals.total).toBe(4);
    expect(report.totals.healthy).toBe(1);
    expect(report.totals.error).toBe(1);
    expect(report.totals.degraded).toBe(1);
    expect(report.totals.notConfigured).toBe(1);
    expect(report.totals.configured).toBe(3);
    expect(report.totals.liveChecked).toBe(2);
    expect(report.categories.find((category) => category.name === 'AI')?.total).toBe(2);
  });
});
