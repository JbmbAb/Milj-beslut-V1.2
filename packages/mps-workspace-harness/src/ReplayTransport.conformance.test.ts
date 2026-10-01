/**
 * Replay-transport conformance vectors RT01-RT07 of replay-transport-contract-v1.json 1.1.0.
 *
 * The contract derives each vector from the frozen bytes rather than from prose placeholders, so
 * these tests read the authority mirror and construct the requests from what is actually recorded.
 * They are the reason the transport can be trusted to fail in the right way: five of the seven
 * assert that something is REFUSED, and a transport that quietly answers a refused request is the
 * failure mode the whole three-layer design exists to prevent.
 *
 * Where the authority mirror is not present on this machine the suite is skipped and says so. That
 * is deliberate: an acceptance report must be able to state AUTHORITY_PRESENT: NO rather than
 * silently show green.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  NotCapturedByPrecondition,
  NotInCorpus,
  ReplayTransport,
  loadCorpus,
} from './index.js';
import type { LoadedCorpus } from './index.js';
import { RequestOutsideCommandSurface } from '@miljobeslut/mps-workspace-observer';
import type { ProcessRequest } from '@miljobeslut/mps-workspace-observer';

const AUTHORITY_ROOT =
  process.env.WLC_AUTHORITY_ROOT ??
  'C:\\Users\\jimmy\\phase0-authority-store\\mirrors\\sha256\\e2eb8fbd111ae0e6efdf2b40e2b746e97b1f708d0f34c6ee45576f852e9b22a6';

const COMMAND_SURFACE_DIGEST = 'd1213675fcf2b945ea74a189eac7ede88ebf4474402b591e5730728698b6f642';

const authorityPresent = existsSync(join(AUTHORITY_ROOT, 'corpus', 'capture-manifest-v1.json'));

function load(): LoadedCorpus {
  return loadCorpus({
    corpusDir: join(AUTHORITY_ROOT, 'corpus'),
    commandSurfacePath: join(AUTHORITY_ROOT, 'contracts', 'workspace-observer-command-surface-v1.json'),
    commandSurfaceDigest: COMMAND_SURFACE_DIGEST,
  });
}

interface RecordedProcess {
  requestId: string;
  instanceKey: string;
  kind: string;
  argv: string[];
  cwd: string;
  env: Record<string, string>;
}

describe.skipIf(!authorityPresent)('replay transport conformance vectors', () => {
  const corpus = authorityPresent ? load() : (undefined as unknown as LoadedCorpus);

  /** The lexicographically first caseId in the capture manifest, as RT01 specifies. */
  function firstCaseId(): string {
    const manifest = JSON.parse(
      readFileSync(join(AUTHORITY_ROOT, 'corpus', 'capture-manifest-v1.json'), 'utf8'),
    ) as { cases: { caseId: string }[] };
    return [...manifest.cases.map((c) => c.caseId)].sort()[0];
  }

  function recordedProcessRequest(caseId: string, requestId: string): ProcessRequest {
    const bundle = corpus.cases.get(caseId);
    if (bundle === undefined) throw new Error(`no bundle for ${caseId}`);
    const rec = (bundle.records as unknown as RecordedProcess[]).find(
      (r) => r.kind === 'PROCESS' && r.requestId === requestId,
    );
    if (rec === undefined) throw new Error(`no ${requestId} record in ${caseId}`);
    return {
      kind: 'PROCESS',
      requestId,
      scope: 'WORKSPACE_LOCAL',
      instanceKey: rec.instanceKey,
      executable: 'git',
      argv: rec.argv,
      cwd: rec.cwd,
      env: rec.env,
      timeoutMs: corpus.surface.family(requestId).timeoutMs,
    };
  }

  it('RT01 replays the recorded R-W-01 record of the first case', async () => {
    const caseId = firstCaseId();
    const t = new ReplayTransport(corpus, caseId);
    const res = await t.executeProcess(recordedProcessRequest(caseId, 'R-W-01'));
    expect(res.outcome).toBeTypeOf('string');
    expect(['COMPLETED', 'TIMEOUT', 'SPAWN_ERROR']).toContain(res.outcome);
    expect(res.stdout).toHaveProperty('encoding');
  });

  it('RT02 refuses an upper-cased candidate path as NOT_IN_CORPUS', async () => {
    const caseId = firstCaseId();
    const t = new ReplayTransport(corpus, caseId);
    const base = recordedProcessRequest(caseId, 'R-W-01');
    const prefixLen = corpus.surface.mandatoryArgvPrefix.length;
    // argv[prefixLen] is '-C' and argv[prefixLen + 1] is the candidate path.
    const argv = [...base.argv];
    argv[prefixLen + 1] = argv[prefixLen + 1].toUpperCase();
    // The comparison key is case-insensitive but the REPLAY key is byte-exact, which is the point:
    // the recorder never resolves two spellings for the Observer.
    await expect(t.executeProcess({ ...base, argv })).rejects.toBeInstanceOf(NotInCorpus);
  });

  it('RT03 refuses a git subcommand outside the surface', async () => {
    const caseId = firstCaseId();
    const t = new ReplayTransport(corpus, caseId);
    const base = recordedProcessRequest(caseId, 'R-W-01');
    const prefixLen = corpus.surface.mandatoryArgvPrefix.length;
    const argv = [...base.argv.slice(0, prefixLen + 2), 'diff', '--stat'];
    await expect(t.executeProcess({ ...base, argv })).rejects.toBeInstanceOf(
      RequestOutsideCommandSurface,
    );
  });

  it('RT04 refuses a request whose mandatory environment is incomplete', async () => {
    const caseId = firstCaseId();
    const t = new ReplayTransport(corpus, caseId);
    const base = recordedProcessRequest(caseId, 'R-W-01');
    const env: Record<string, string> = { ...base.env };
    delete env.GIT_OPTIONAL_LOCKS;
    await expect(t.executeProcess({ ...base, env })).rejects.toBeInstanceOf(
      RequestOutsideCommandSurface,
    );
  });

  it('RT05 refuses an R-F-06 LSTAT for a path that appears in no record', async () => {
    const caseId = firstCaseId();
    const t = new ReplayTransport(corpus, caseId);
    await expect(
      t.executeFilesystem({
        kind: 'FS',
        requestId: 'R-F-06',
        scope: 'WORKSPACE_LOCAL',
        instanceKey: caseId,
        operation: 'LSTAT',
        opKey: 'lstat',
        path: 'C:\\this-path-appears-in-no-record-9f3a',
        timeoutMs: 15000,
      }),
    ).rejects.toBeInstanceOf(NotInCorpus);
  });

  it('RT06 replays repeated identical requests as an ordered sequence, then refuses', async () => {
    const caseId = firstCaseId();
    const t = new ReplayTransport(corpus, caseId);
    const global = corpus.global as unknown as { records: RecordedProcess[]; repoRoot: string };
    const rec = global.records.find((r) => r.kind === 'PROCESS' && r.requestId === 'R-G-01');
    if (rec === undefined) throw new Error('no R-G-01 record');
    const req: ProcessRequest = {
      kind: 'PROCESS',
      requestId: 'R-G-01',
      scope: 'REPOSITORY_GLOBAL',
      instanceKey: 'BEFORE',
      executable: 'git',
      argv: rec.argv,
      cwd: rec.cwd,
      env: rec.env,
      timeoutMs: corpus.surface.family('R-G-01').timeoutMs,
    };

    const before = await t.executeProcess(req);
    const after = await t.executeProcess({ ...req, instanceKey: 'AFTER' });
    // Both reads exist and are answered in capture order. A map keyed only by request identity
    // would answer the first read with the AFTER record and destroy the observation-window
    // evidence, which is exactly the defect the 1.1.0 amendment fixed.
    expect(before).toBeDefined();
    expect(after).toBeDefined();
    await expect(t.executeProcess({ ...req, instanceKey: 'AFTER' })).rejects.toBeInstanceOf(
      NotInCorpus,
    );
  });

  it('RT07 reports a deliberate capture-time non-attempt as NOT_CAPTURED_BY_PRECONDITION', async () => {
    // A case whose R-W-06 coverage row is NOT_CAPTURED with reason EXPANSION_EMPTY: the workspace
    // has no governance/devgov/units/*.json to read.
    const manifest = JSON.parse(
      readFileSync(join(AUTHORITY_ROOT, 'corpus', 'capture-manifest-v1.json'), 'utf8'),
    ) as {
      cases: {
        caseId: string;
        preferredSpelling: string;
        coverage: { requestId: string; status: string; reason?: string }[];
      }[];
    };
    const target = manifest.cases.find((c) =>
      c.coverage.some(
        (r) => r.requestId === 'R-W-06' && r.status === 'NOT_CAPTURED' && r.reason === 'EXPANSION_EMPTY',
      ),
    );
    expect(target).toBeDefined();
    if (target === undefined) return;

    const t = new ReplayTransport(corpus, target.caseId);
    let raised: unknown;
    try {
      await t.executeFilesystem({
        kind: 'FS',
        requestId: 'R-W-06',
        scope: 'WORKSPACE_LOCAL',
        instanceKey: `${target.caseId}:unit.json`,
        operation: 'READ_FILE',
        opKey: '',
        path: `${target.preferredSpelling}\\governance\\devgov\\units\\unit.json`,
        timeoutMs: 15000,
        maxBytes: 262144,
      });
    } catch (e) {
      raised = e;
    }
    expect(raised).toBeInstanceOf(NotCapturedByPrecondition);
    expect((raised as NotCapturedByPrecondition).reason).toBe('EXPANSION_EMPTY');
  });

  it('refuses a corpus whose bytes do not match the capture manifest', () => {
    // The eighth property the contract asks the verifier to demonstrate: load-time verification is
    // not optional decoration. Pointing the loader at the right corpus with the wrong surface
    // digest must abort before anything is answered.
    expect(() =>
      loadCorpus({
        corpusDir: join(AUTHORITY_ROOT, 'corpus'),
        commandSurfacePath: join(
          AUTHORITY_ROOT,
          'contracts',
          'workspace-observer-command-surface-v1.json',
        ),
        commandSurfaceDigest: '0'.repeat(64),
      }),
    ).toThrow();
  });
});

describe('replay transport authority presence', () => {
  it('states whether the frozen authority was available to this run', () => {
    // Never silently green: a run without the authority proves nothing about replay conformance,
    // and the acceptance report has to be able to say so.
    if (!authorityPresent) {

      console.warn(
        `AUTHORITY_PRESENT: NO — replay conformance vectors were not executed. Looked in ${AUTHORITY_ROOT}`,
      );
    }
    expect(typeof authorityPresent).toBe('boolean');
  });
});
