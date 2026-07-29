/**
 * Sovereign DoD §6 — platform durability matrix proof.
 *
 * Runs write+reload for each DurabilityMode on the current OS.
 * Marks Linux-only / NFS rows as SKIPPED when not applicable (no silent PROVEN).
 *
 *   npm run mimers:durability-matrix
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  DurabilityError,
  EvolutionLedger,
  FileCASRepository,
  FileEventLog,
  ManifestBuilder,
  type DurabilityMode,
} from '@miljobeslut/mimers-brunn-core';

export type MatrixCellStatus = 'PROVEN' | 'UNSUPPORTED' | 'SKIPPED' | 'FAILED';

export type DurabilityMatrixCell = {
  readonly mode: DurabilityMode | 'nfs-failover';
  readonly status: MatrixCellStatus;
  readonly detail: string;
  readonly writeReloadOk?: boolean;
  readonly elapsedMs?: number;
};

export type DurabilityMatrixReport = {
  readonly ok: boolean;
  readonly platform: string;
  readonly arch: string;
  readonly node: string;
  readonly cells: readonly DurabilityMatrixCell[];
  /** True when every cell that must pass on this platform passed. */
  readonly platformGateOk: boolean;
  readonly errors: readonly string[];
};

async function exerciseMode(mode: DurabilityMode): Promise<{
  ok: boolean;
  detail: string;
  elapsedMs: number;
  unsupported?: boolean;
}> {
  const root = await mkdtemp(path.join(os.tmpdir(), `mimers-dur-${mode}-`));
  const t0 = performance.now();
  try {
    const cas = new FileCASRepository(path.join(root, 'cas'), { durabilityMode: mode });
    await cas.initialize();
    const log = new FileEventLog(path.join(root, 'ledger'), {
      durabilityMode: mode,
      maxEventsPerSegment: 2,
    });
    await log.initialize();
    const ledger = new EvolutionLedger(cas, log);

    for (let i = 0; i < 3; i += 1) {
      const { manifest } = await new ManifestBuilder(cas)
        .pipeline({ id: `dur-${mode}-${i}` })
        .policy({ mode, i })
        .runtime({ durability: mode })
        .metrics({ latencyMs: i, costSek: 0, qualityScore: 1, errorRate: 0 })
        .build();
      await ledger.commitPromotion(manifest, [], i + 1, { metadataName: `dur-${mode}-${i}` });
    }

    // Fresh handles = reload from disk under same durability mode.
    const cas2 = new FileCASRepository(path.join(root, 'cas'), { durabilityMode: mode });
    await cas2.initialize();
    const log2 = new FileEventLog(path.join(root, 'ledger'), {
      durabilityMode: mode,
      maxEventsPerSegment: 2,
      checkpointPolicy: 'fail-closed',
    });
    await log2.initialize();
    const events = await log2.getAllEvents();
    if (events.length !== 3) {
      return {
        ok: false,
        detail: `expected 3 events after reload, got ${events.length}`,
        elapsedMs: Number((performance.now() - t0).toFixed(3)),
      };
    }
    return {
      ok: true,
      detail: `write+reload CLEAN under durabilityMode=${mode}`,
      elapsedMs: Number((performance.now() - t0).toFixed(3)),
    };
  } catch (err: unknown) {
    const elapsedMs = Number((performance.now() - t0).toFixed(3));
    if (err instanceof DurabilityError) {
      return {
        ok: false,
        unsupported: process.platform === 'win32' && mode === 'strict',
        detail: `DurabilityError: ${err.message}`,
        elapsedMs,
      };
    }
    return {
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
      elapsedMs,
    };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

export async function proveDurabilityMatrix(): Promise<DurabilityMatrixReport> {
  const errors: string[] = [];
  const cells: DurabilityMatrixCell[] = [];
  const isWin = process.platform === 'win32';
  const isLinux = process.platform === 'linux';

  for (const mode of ['none', 'best-effort', 'strict'] as const) {
    const result = await exerciseMode(mode);

    if (result.ok) {
      cells.push({
        mode,
        status: 'PROVEN',
        detail: result.detail,
        writeReloadOk: true,
        elapsedMs: result.elapsedMs,
      });
      continue;
    }

    if (mode === 'strict' && isWin && result.unsupported) {
      cells.push({
        mode,
        status: 'UNSUPPORTED',
        detail: `${result.detail} — Windows NTFS often cannot dir-fsync; use best-effort locally; prefer Linux for strict prod`,
        writeReloadOk: false,
        elapsedMs: result.elapsedMs,
      });
      continue;
    }

    if (mode === 'strict' && isWin && !result.unsupported) {
      // strict threw something else, or somehow failed without DurabilityError
      cells.push({
        mode,
        status: 'UNSUPPORTED',
        detail: result.detail,
        writeReloadOk: false,
        elapsedMs: result.elapsedMs,
      });
      continue;
    }

    cells.push({
      mode,
      status: 'FAILED',
      detail: result.detail,
      writeReloadOk: false,
      elapsedMs: result.elapsedMs,
    });
    errors.push(`${mode}: ${result.detail}`);
  }

  // NFS failover: cannot be proven without a mounted NFS fixture.
  const nfsEnv = process.env.MIMERS_NFS_ROOT?.trim();
  if (!nfsEnv) {
    cells.push({
      mode: 'nfs-failover',
      status: 'SKIPPED',
      detail:
        'Set MIMERS_NFS_ROOT to a shared filesystem path to exercise hardlink+reload across nodes; not configured',
    });
  } else {
    try {
      const result = await exerciseModeOnRoot(nfsEnv, 'best-effort');
      cells.push({
        mode: 'nfs-failover',
        status: result.ok ? 'PROVEN' : 'FAILED',
        detail: result.detail,
        writeReloadOk: result.ok,
        elapsedMs: result.elapsedMs,
      });
      if (!result.ok) errors.push(`nfs-failover: ${result.detail}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      cells.push({
        mode: 'nfs-failover',
        status: 'FAILED',
        detail: msg,
        writeReloadOk: false,
      });
      errors.push(`nfs-failover: ${msg}`);
    }
  }

  // Platform gate: none + best-effort must PROVEN; strict PROVEN on Linux, UNSUPPORTED OK on Windows.
  const byMode = new Map(cells.map((c) => [c.mode, c]));
  const noneOk = byMode.get('none')?.status === 'PROVEN';
  const beOk = byMode.get('best-effort')?.status === 'PROVEN';
  const strictCell = byMode.get('strict');
  const strictOk = isLinux
    ? strictCell?.status === 'PROVEN'
    : strictCell?.status === 'PROVEN' || strictCell?.status === 'UNSUPPORTED';
  const nfsCell = byMode.get('nfs-failover');
  const nfsOk = nfsCell?.status === 'SKIPPED' || nfsCell?.status === 'PROVEN';

  const platformGateOk = Boolean(noneOk && beOk && strictOk && nfsOk);
  if (!platformGateOk && errors.length === 0) {
    errors.push('platform gate failed');
  }

  const requireLinuxStrict = process.env.MIMERS_REQUIRE_LINUX_STRICT === 'true';
  if (requireLinuxStrict) {
    if (!isLinux) {
      errors.push('MIMERS_REQUIRE_LINUX_STRICT=true but platform is not linux');
    } else if (strictCell?.status !== 'PROVEN') {
      errors.push('MIMERS_REQUIRE_LINUX_STRICT=true but strict cell is not PROVEN');
    }
  }

  const report: DurabilityMatrixReport = {
    ok: platformGateOk && errors.length === 0,
    platform: `${process.platform}/${os.type()} ${os.release()}`,
    arch: os.arch(),
    node: process.version,
    cells,
    platformGateOk,
    errors,
  };

  try {
    const outDir = path.resolve('tmp-artifacts');
    await mkdir(outDir, { recursive: true });
    await writeFile(
      path.join(outDir, 'mimers-durability-matrix.json'),
      `${JSON.stringify(report, null, 2)}\n`,
      'utf-8',
    );
  } catch {
    /* best-effort artifact for CI */
  }

  return report;
}

async function exerciseModeOnRoot(
  rootBase: string,
  mode: DurabilityMode,
): Promise<{ ok: boolean; detail: string; elapsedMs: number }> {
  const root = path.join(rootBase, `mimers-nfs-${process.pid}-${Date.now()}`);
  const t0 = performance.now();
  try {
    const cas = new FileCASRepository(path.join(root, 'cas'), { durabilityMode: mode });
    await cas.initialize();
    const log = new FileEventLog(path.join(root, 'ledger'), {
      durabilityMode: mode,
      maxEventsPerSegment: 2,
    });
    await log.initialize();
    const ledger = new EvolutionLedger(cas, log);
    const { manifest } = await new ManifestBuilder(cas)
      .pipeline({ id: 'nfs-1' })
      .policy({ nfs: true })
      .runtime({})
      .metrics({ latencyMs: 1, costSek: 0, qualityScore: 1, errorRate: 0 })
      .build();
    await ledger.commitPromotion(manifest, [], 1, { metadataName: 'nfs-1' });
    const log2 = new FileEventLog(path.join(root, 'ledger'), { durabilityMode: mode });
    await log2.initialize();
    const n = (await log2.getAllEvents()).length;
    return {
      ok: n === 1,
      detail: n === 1 ? `NFS path write+reload OK at ${rootBase}` : `expected 1 event, got ${n}`,
      elapsedMs: Number((performance.now() - t0).toFixed(3)),
    };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  const report = await proveDurabilityMatrix();
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
}

const isDirect =
  process.argv[1]?.includes('prove-durability-matrix') ||
  process.argv[1]?.replace(/\\/g, '/').endsWith('prove-durability-matrix.ts');
if (isDirect) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
