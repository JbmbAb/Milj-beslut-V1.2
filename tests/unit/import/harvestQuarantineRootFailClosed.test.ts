import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

vi.mock('../../../packages/mps-data-governance/src/SourceRegistry', () => ({
  getVerifiedSourceDefinition: vi.fn(async () => ({
    sourceId: 'src-test',
    adapter: 'mmd_v1',
    authority: { name: 'Test Authority' },
  })),
  isUrlAllowedForVerifiedSource: vi.fn(() => true),
}));

vi.mock('../../../scripts/import/harvest/adapters/mmdAdapter', () => ({
  MmdAdapter: class {
    constructor(public sourceId: string) {}
    validateContract() {
      return { valid: true, errors: [] as string[] };
    }
    async discover() {
      return [
        {
          fileName: 'doc.pdf',
          sourceUrl: 'https://example.test/doc.pdf',
          authority: 'Test',
          year: 2026,
          municipality: '0000',
          caseId: 'c1',
        },
      ];
    }
    async fetch() {
      return { name: 'doc.pdf', content: 'bytes' };
    }
  },
}));

describe('harvestRuntime QUARANTINE_ROOT fail-closed', () => {
  const saved = process.env.QUARANTINE_ROOT;
  let scratch: string | null = null;

  afterEach(() => {
    if (saved === undefined) delete process.env.QUARANTINE_ROOT;
    else process.env.QUARANTINE_ROOT = saved;
    if (scratch) rmSync(scratch, { recursive: true, force: true });
    scratch = null;
    vi.resetModules();
  });

  it('E/F: execute without QUARANTINE_ROOT fails closed (no MASTER_ARCHIVE sibling fallback)', async () => {
    delete process.env.QUARANTINE_ROOT;
    process.env.MASTER_ARCHIVE_ROOT = 'H:\\Delade enheter\\Miljöbeslut\\GEO_Master_Archive';
    const { executeHarvestForSource } = await import('../../../scripts/import/harvest/harvestRuntime');
    const result = await executeHarvestForSource('src-test', { execute: true });
    expect(result.status).toBe('failed');
    expect(result.error_message).toMatch(/QUARANTINE_ROOT is required/);
    expect(result.error_message).toMatch(/sibling \.quarantine fallback is removed/);
  });

  it('dry-run without QUARANTINE_ROOT remains non-writing', async () => {
    delete process.env.QUARANTINE_ROOT;
    const { executeHarvestForSource } = await import('../../../scripts/import/harvest/harvestRuntime');
    const result = await executeHarvestForSource('src-test', { execute: false });
    expect(result.status).toBe('completed');
    expect(result.documents_new).toBe(0);
  });

  it('A: explicit QUARANTINE_ROOT is used for execute writes', async () => {
    scratch = mkdtempSync(path.join(tmpdir(), 'harvest-q-'));
    process.env.QUARANTINE_ROOT = scratch;
    const { executeHarvestForSource } = await import('../../../scripts/import/harvest/harvestRuntime');
    const result = await executeHarvestForSource('src-test', { execute: true });
    expect(result.status).toBe('completed');
    expect(result.documents_new).toBeGreaterThanOrEqual(0);
  });
});
