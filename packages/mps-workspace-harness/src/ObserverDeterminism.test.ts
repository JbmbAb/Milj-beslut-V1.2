/**
 * Del D item 4: determinism verified AT identityDigest LEVEL.
 *
 * "The classifier is deterministic" is easy to satisfy and easy to satisfy vacuously. The property
 * that actually matters for A14's compare-and-swap is stronger: the same world must produce the same
 * identityDigest, run after run, and a different world must produce a different one. If the first
 * fails, V2's delete condition can never be met and the predictable response is to loosen it; if the
 * second fails, the condition passes over a world that has changed.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { classify } from '@miljobeslut/mps-workspace-classifier';
import type { ClassifiableSnapshot } from '@miljobeslut/mps-workspace-classifier';
import { computeIdentityDigest, observe } from '@miljobeslut/mps-workspace-observer';

import { ReplayTransport, loadCorpus } from './index.js';

const AUTHORITY_ROOT =
  process.env.WLC_AUTHORITY_ROOT ??
  'C:\\Users\\jimmy\\phase0-authority-store\\mirrors\\sha256\\e2eb8fbd111ae0e6efdf2b40e2b746e97b1f708d0f34c6ee45576f852e9b22a6';
const SURFACE_DIGEST = 'd1213675fcf2b945ea74a189eac7ede88ebf4474402b591e5730728698b6f642';
const authorityPresent = existsSync(join(AUTHORITY_ROOT, 'corpus', 'capture-manifest-v1.json'));

describe.skipIf(!authorityPresent)('identityDigest determinism', () => {
  const corpus = loadCorpus({
    corpusDir: join(AUTHORITY_ROOT, 'corpus'),
    commandSurfacePath: join(
      AUTHORITY_ROOT,
      'contracts',
      'workspace-observer-command-surface-v1.json',
    ),
    commandSurfaceDigest: SURFACE_DIGEST,
  });

  async function digestOf(caseId: string): Promise<string> {
    const port = new ReplayTransport(corpus, caseId);
    const { snapshot } = await observe({
      surface: corpus.surface,
      port,
      repoRoot: corpus.global.repoRoot,
      observationScope: { caseIds: [caseId] },
      globalObservationWindow: port.globalObservationWindow,
    });
    return snapshot.identityDigest;
  }

  it('reproduces the same digest for the same frozen case across repeated observations', async () => {
    const caseId = [...corpus.cases.keys()].sort()[0];
    const first = await digestOf(caseId);
    for (let i = 0; i < 5; i += 1) expect(await digestOf(caseId)).toBe(first);
  }, 120000);

  it('is unaffected by the metadata A9 keeps outside it', async () => {
    // Timestamps, durations, versions, coverage counts and the transcript reference are all in the
    // artifact and none of them may reach the digest: otherwise every re-observation of an untouched
    // machine produces a new digest, the CAS condition can never succeed, and someone eventually
    // removes it.
    const caseId = [...corpus.cases.keys()].sort()[0];
    const port = new ReplayTransport(corpus, caseId);
    const base = await observe({
      surface: corpus.surface,
      port,
      repoRoot: corpus.global.repoRoot,
      observationScope: { caseIds: [caseId] },
      globalObservationWindow: { start: '2020-01-01T00:00:00.000Z', end: '2020-01-01T00:00:01.000Z' },
      transcriptRef: 'something-entirely-different',
    });
    const port2 = new ReplayTransport(corpus, caseId);
    const other = await observe({
      surface: corpus.surface,
      port: port2,
      repoRoot: corpus.global.repoRoot,
      observationScope: { caseIds: [caseId] },
      globalObservationWindow: { start: '2099-12-31T23:59:59.000Z', end: '2099-12-31T23:59:59.999Z' },
      transcriptRef: 'and-another',
    });
    expect(other.snapshot.identityDigest).toBe(base.snapshot.identityDigest);
    expect(other.snapshot.metadata.observationWindow).not.toEqual(
      base.snapshot.metadata.observationWindow,
    );
  }, 120000);

  it('produces a different digest for every distinct frozen case', async () => {
    const seen = new Map<string, string>();
    for (const caseId of [...corpus.cases.keys()].sort()) {
      const port = new ReplayTransport(corpus, caseId);
      const { snapshot } = await observe({
        surface: corpus.surface,
        port,
        repoRoot: corpus.global.repoRoot,
        observationScope: { caseIds: [caseId] },
        globalObservationWindow: port.globalObservationWindow,
      });
      const previous = seen.get(snapshot.identityDigest);
      // A collision would mean two different worlds share a CAS identity, which is the one failure
      // mode a digest exists to prevent.
      expect(previous, `${caseId} collides with ${String(previous)}`).toBeUndefined();
      seen.set(snapshot.identityDigest, caseId);
    }
    expect(seen.size).toBe(corpus.cases.size);
  }, 600000);

  it('changes when any digest-covered field changes, and not when an excluded one does', async () => {
    const caseId = [...corpus.cases.keys()].sort()[0];
    const port = new ReplayTransport(corpus, caseId);
    const { snapshot } = await observe({
      surface: corpus.surface,
      port,
      repoRoot: corpus.global.repoRoot,
      observationScope: { caseIds: [caseId] },
      globalObservationWindow: port.globalObservationWindow,
    });
    const base = computeIdentityDigest(snapshot).digest;
    expect(base).toBe(snapshot.identityDigest);

    // A covered field: the working-tree untracked count.
    const w = snapshot.workspaces.find((x) => x.caseId === caseId);
    expect(w).toBeDefined();
    const mutatedCovered = {
      repository: snapshot.repository,
      workspaces: snapshot.workspaces.map((x) =>
        x.caseId === caseId && x.status.value !== undefined
          ? {
              ...x,
              status: {
                ...x.status,
                value: { ...x.status.value, untrackedEntryCount: x.status.value.untrackedEntryCount + 1 },
              },
            }
          : x,
      ),
    };
    expect(computeIdentityDigest(mutatedCovered).digest).not.toBe(base);

    // Excluded fields: graphRelation is our label, and preferredSpelling depends on which discovery
    // source fired rather than on the world.
    const mutatedExcluded = {
      repository: snapshot.repository,
      workspaces: snapshot.workspaces.map((x) =>
        x.caseId === caseId
          ? { ...x, graphRelation: 'UNKNOWN' as const, preferredSpelling: 'C:\\SOMETHING\\ELSE' }
          : x,
      ),
    };
    expect(computeIdentityDigest(mutatedExcluded).digest).toBe(base);
  }, 120000);

  it('classifies identically from an identical snapshot, every time', async () => {
    const caseId = [...corpus.cases.keys()].sort()[0];
    const port = new ReplayTransport(corpus, caseId);
    const { snapshot } = await observe({
      surface: corpus.surface,
      port,
      repoRoot: corpus.global.repoRoot,
      observationScope: { caseIds: [caseId] },
      globalObservationWindow: port.globalObservationWindow,
    });
    const first = JSON.stringify(classify(snapshot as unknown as ClassifiableSnapshot, 'WORKTREE_REMOVAL'));
    for (let i = 0; i < 20; i += 1) {
      expect(JSON.stringify(classify(snapshot as unknown as ClassifiableSnapshot, 'WORKTREE_REMOVAL'))).toBe(
        first,
      );
    }
  }, 120000);
});
