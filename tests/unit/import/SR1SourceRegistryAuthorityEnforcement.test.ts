import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  installSourceRegistryFixtureEnv,
  writeVerifiedSourceRegistryFixture,
} from './sourceRegistryFixture';

describe('SR1 — SourceRegistry authority enforcement (green contract)', () => {
  const originalEnv = { ...process.env };
  const originalFetch = globalThis.fetch;
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sr1-green-proof-'));
    process.env = { ...originalEnv };
    process.env.QUARANTINE_ROOT = path.join(tempRoot, '.quarantine');
    process.env.MASTER_ARCHIVE_ROOT = path.join(tempRoot, 'geo_master_archive');
    process.env.SKIP_DISK_SPACE_CHECK = 'true';
    process.env.SKIP_DISK_CHECK = 'true';
    process.env.NODE_ENV = 'test';
    vi.resetModules();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.env = originalEnv;
    fs.rmSync(tempRoot, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('denies harvest before adapter dispatch and network I/O when no verified SourceRegistryArtifact is available', async () => {
    const emptyRegistry = path.join(tempRoot, 'empty-source-registry.json');
    fs.writeFileSync(emptyRegistry, '[]', 'utf8');
    installSourceRegistryFixtureEnv({
      ...(await writeVerifiedSourceRegistryFixture(tempRoot)),
      registryPath: emptyRegistry,
    });

    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof globalThis.fetch;

    const { executeLokeHarvestForSource } = await import('../../../scripts/import/loke/lokeRuntime');
    const run = await executeLokeHarvestForSource('mmd_nacka', { execute: true });

    expect(run.status).toBe('failed');
    expect(run.documents_found).toBe(0);
    expect(run.error_message).toMatch(/saknar verifierad SourceRegistryArtifact/i);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(fs.existsSync(process.env.QUARANTINE_ROOT!)).toBe(false);
  });

  it('denies a tampered SourceRegistryArtifact before adapter dispatch and network I/O', async () => {
    const fixture = await writeVerifiedSourceRegistryFixture(tempRoot);
    const entries = JSON.parse(fs.readFileSync(fixture.registryPath, 'utf8'));
    entries[0].adapter = 'mod_v1';
    fs.writeFileSync(fixture.registryPath, JSON.stringify(entries, null, 2), 'utf8');
    installSourceRegistryFixtureEnv(fixture);

    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof globalThis.fetch;

    const { executeLokeHarvestForSource } = await import('../../../scripts/import/loke/lokeRuntime');
    const run = await executeLokeHarvestForSource('mmd_nacka', { execute: true });

    expect(run.status).toBe('failed');
    expect(run.error_message).toMatch(/SourceRegistry-materialisering nekades/i);
    expect(run.error_message).toMatch(/source_content_hash|subject_digest/i);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(fs.existsSync(process.env.QUARANTINE_ROOT!)).toBe(false);
  });

  it('allows harvest and quarantine persistence through a governance-approved SourceRegistryArtifact', async () => {
    installSourceRegistryFixtureEnv(await writeVerifiedSourceRegistryFixture(tempRoot));
    const fetchCalls: string[] = [];
    globalThis.fetch = (async (input: unknown) => {
      const url = typeof input === 'string' ? input : String((input as { url?: string })?.url ?? input);
      fetchCalls.push(url);
      return {
        ok: true,
        status: 200,
        text: async () => `SR1 green proof — canonical SourceRegistry allowed ${url}.`,
        arrayBuffer: async () => new TextEncoder().encode('SR1 green proof').buffer,
      } as unknown as Response;
    }) as typeof globalThis.fetch;

    const { executeLokeHarvestForSource } = await import('../../../scripts/import/loke/lokeRuntime');
    const run = await executeLokeHarvestForSource('mmd_nacka', { execute: true, onlyFilters: ['nacka'] });

    expect(run.status).toBe('completed');
    expect(run.documents_found).toBe(4);
    expect(run.documents_new).toBe(4);
    expect(fetchCalls.length).toBe(4);
    expect(fetchCalls.every((url) => url.includes('domstol.se'))).toBe(true);

    const runsDir = path.join(process.env.QUARANTINE_ROOT!, 'runs');
    expect(fs.existsSync(path.join(runsDir, `harvest_run_${run.harvest_run_id}.json`))).toBe(true);
  });

  it('has no Loke runtime import path back to the legacy hard-coded source registry', () => {
    const repoRoot = path.resolve(__dirname, '../../..');
    const lokeFiles = [
      'scripts/import/loke/lokeRuntime.ts',
      'scripts/import/loke/lokeScheduler.ts',
      'scripts/import/loke/harvestPlan.ts',
      'scripts/import/loke/contract.ts',
    ];

    const legacyImportHits = lokeFiles
      .map((rel) => ({
        rel,
        source: fs.readFileSync(path.join(repoRoot, rel), 'utf8'),
      }))
      .filter(({ source }) => source.includes("server/modules/harvest/source-registry/registry"));

    expect(legacyImportHits, 'Loke must not reach the legacy registry as an alternate authority').toEqual([]);
  });
});
