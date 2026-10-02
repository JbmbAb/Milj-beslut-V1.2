/**
 * U30F F1 (PRES-05): legacy importers that write several targets go through the protected
 * relation gate per target: a protected LU target is refused before any statement or ogr2ogr
 * process touches it; other targets proceed unchanged.
 *
 * Hermetic: @prisma/client, dotenv and child_process are replaced by recorders (nothing is executed,
 * no database is reached). A refused target shows up as a REJECT_* message and as the ABSENCE of
 * its statement/command in the recorders.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  const state = { statements: [] as string[], commands: [] as string[] };
  const record = (...args: unknown[]) => {
    state.statements.push(String(args[0]).replace(/\s+/g, ' ').trim());
    return Promise.resolve([]);
  };
  class FakePrismaClient {
    $executeRawUnsafe = record;
    $queryRawUnsafe = record;
    async $disconnect() {}
  }
  const exec = (cmd: unknown, args?: unknown) => {
    state.commands.push(Array.isArray(args) ? [String(cmd), ...args.map(String)].join(' ') : String(cmd));
    const child = { on: (event: string, cb: (code: number) => void) => (event === 'close' ? setTimeout(() => cb(0), 0) : undefined), stdout: null, stderr: null };
    return Array.isArray(args) ? child : Buffer.from('');
  };
  return { state, FakePrismaClient, exec };
});

vi.mock('@prisma/client', () => ({ PrismaClient: h.FakePrismaClient }));
vi.mock('dotenv', () => ({ default: { config: () => ({}) }, config: () => ({}) }));
for (const specifier of ['child_process', 'node:child_process']) {
  vi.doMock(specifier, async () => {
    const actual = await vi.importActual<Record<string, unknown>>('node:child_process');
    const fake = { ...actual, execSync: h.exec, spawnSync: h.exec, spawn: h.exec };
    return { ...fake, default: fake };
  });
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const savedArgv = process.argv;
const savedExitCode = process.exitCode;
let output: string[];
let workDir: string;

beforeEach(() => {
  h.state.statements.length = 0;
  h.state.commands.length = 0;
  output = [];
  process.exitCode = undefined;
  for (const method of ['log', 'warn', 'error'] as const) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      output.push(args.map((a) => (a instanceof Error ? a.message : String(a))).join(' '));
    });
  }
  workDir = mkdtempSync(path.join(tmpdir(), 'wu30f-legacy-'));
});

afterEach(() => {
  vi.restoreAllMocks();
  process.argv = savedArgv;
  process.exitCode = savedExitCode;
  rmSync(workDir, { recursive: true, force: true });
});

async function settle(): Promise<void> {
  for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setTimeout(resolve, 5));
}

describe('legacy importers go through the protected relation gate per target (U30F F1)', () => {
  it('bulk-import-sgu: the landslide target (lu.landslide) is refused before any statement or ogr2ogr; exit code 1', async () => {
    const file = path.join(workDir, 'jordskred.gpkg');
    writeFileSync(file, 'x');
    process.argv = [process.argv[0]!, 'bulk-import-sgu.ts', file, 'landslide'];
    vi.resetModules();
    await import(/* @vite-ignore */ path.join(repoRoot, 'scripts/import/bulk-import-sgu.ts'));
    await settle();
    expect(h.state.statements).toEqual([]);
    expect(h.state.commands).toEqual([]);
    expect(output.join('\n')).toMatch(/REJECT_DESTRUCTIVE_WRITE_PROTECTED_RELATION: scripts\/import\/bulk-import-sgu\.ts may not OGR2OGR_WRITE env\.sgu_landslide_feature/);
    expect(process.exitCode).toBe(1);
  });

  it('bulk-import-sgu: a non-protected target (env.sgu_ground_layer) proceeds unchanged', async () => {
    const file = path.join(workDir, 'grundlager.gpkg');
    writeFileSync(file, 'x');
    process.argv = [process.argv[0]!, 'bulk-import-sgu.ts', file, 'ground_layer'];
    vi.resetModules();
    await import(/* @vite-ignore */ path.join(repoRoot, 'scripts/import/bulk-import-sgu.ts'));
    await settle();
    expect(h.state.commands.some((c) => c.includes('-nln env.sgu_ground_layer'))).toBe(true);
    expect(process.exitCode).toBeUndefined();
  });

  it('bulk-import-sgu-api-all: wells, landslide and soil 25k-100k are refused; the other collections still run', async () => {
    process.argv = [process.argv[0]!, 'bulk-import-sgu-api-all.ts'];
    vi.resetModules();
    await import(/* @vite-ignore */ path.join(repoRoot, 'scripts/import/bulk-import-sgu-api-all.ts'));
    await settle();
    for (const protectedTable of ['env.sgu_well', 'env.sgu_landslide_feature', 'env.sgu_soil_type_25k_100k']) {
      expect(h.state.commands.filter((c) => c.includes(`-nln ${protectedTable} `)), protectedTable).toEqual([]);
      expect(output.join('\n'), protectedTable).toContain(`may not OGR2OGR_WRITE ${protectedTable}`);
    }
    expect(h.state.commands.some((c) => c.includes('-nln env.sgu_ground_layer_1m '))).toBe(true);
  });

  it('sguBulkImportEngine: DROP of a protected layer and an ogr2ogr into it are refused before anything runs', async () => {
    vi.resetModules();
    const engine = await import(/* @vite-ignore */ path.join(repoRoot, 'scripts/import/sguBulkImportEngine.ts'));
    const prisma = new h.FakePrismaClient();
    await expect(engine.prepareTableForBulkLoad(prisma, 'env.sgu_soil_type_25k_100k')).rejects.toThrow(/REJECT_DESTRUCTIVE_WRITE_PROTECTED_RELATION/);
    expect(h.state.statements).toEqual([]); // not even its indexes were touched
    await expect(engine.runOgr2ogr(['-f', 'PostgreSQL', 'PG:dbname=x', 'a.gpkg', '-nln', 'env.sgu_landslide_feature', '-overwrite'])).rejects.toThrow(
      /REJECT_DESTRUCTIVE_WRITE_PROTECTED_RELATION/,
    );
    expect(h.state.commands).toEqual([]);
    await engine.prepareTableForBulkLoad(prisma, 'env.sgu_permeability');
    expect(h.state.statements).toContain('DROP TABLE IF EXISTS env.sgu_permeability CASCADE');
  });
});
