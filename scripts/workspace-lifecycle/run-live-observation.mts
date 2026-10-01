/**
 * WORKSPACE-LIFECYCLE-CONTROLLER-V1 — test layer 3: the live disk.
 *
 * Layers 1 and 2 prove the Observer parses a frozen transcript and the Classifier is deterministic
 * against known input. Neither says anything about the process and OS layer: whether the mandatory
 * Git flags actually hold on this machine, whether a real `git status` across a hundred Cesium-sized
 * trees completes inside its timeout, whether the filesystem answers at all. That is what this run
 * is for, and it is the only layer that can run here.
 *
 * IT OBSERVES AND NOTHING ELSE. NO CLEANUP AUTHORITY HAS BEEN GRANTED to V1: no workspace is
 * removed, pruned, unlocked or altered, and every request comes from the frozen command surface,
 * whose mutationBan forbids every writing verb. The run recomputes the BEFORE/AFTER metadata
 * comparison, so it carries its own evidence that it changed nothing rather than asking to be
 * believed.
 *
 *   npx tsx scripts/workspace-lifecycle/run-live-observation.mts [--repo-root <path>] [--out <file>]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { classify } from '@miljobeslut/mps-workspace-classifier';
import type { ClassifiableSnapshot } from '@miljobeslut/mps-workspace-classifier';
import { CommandSurface, LiveRequestPort, observe } from '@miljobeslut/mps-workspace-observer';
import { bindAuthority } from '@miljobeslut/mps-workspace-harness';

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : fallback;
}

const AUTHORITY_ROOT = arg(
  'authority-root',
  process.env.WLC_AUTHORITY_ROOT ??
    'C:\\Users\\jimmy\\phase0-authority-store\\mirrors\\sha256\\e2eb8fbd111ae0e6efdf2b40e2b746e97b1f708d0f34c6ee45576f852e9b22a6',
);
const REPO_ROOT = arg('repo-root', 'C:\\milj\u00f6beslut');
const OUT = arg('out', '');

const authority = bindAuthority({ authorityRoot: AUTHORITY_ROOT });
const surface = CommandSurface.fromFile(
  authority.requiredBindingPaths.commandSurfaceDigest,
  authority.requiredBindings.commandSurfaceDigest,
);

const port = new LiveRequestPort({
  repoRoot: REPO_ROOT,
  mandatoryEnvironment: surface.mandatoryEnvironment,
});

const started = new Date().toISOString();
const { snapshot, sequencer } = await observe({
  surface,
  port,
  repoRoot: REPO_ROOT,
  // Live, every discovered candidate is in scope: there is no fixture to be missing from.
  observationScope: 'ALL',
  globalObservationWindow: { start: started, end: new Date().toISOString() },
  transcriptRef: `live:${REPO_ROOT}`,
});

const classification = classify(snapshot as unknown as ClassifiableSnapshot, 'WORKTREE_REMOVAL');

const coverage = sequencer.ledger.summary();
const decisions = new Map<string, number>();
for (const d of classification.dispositions) {
  decisions.set(d.decision, (decisions.get(d.decision) ?? 0) + 1);
}
const blockerCounts = new Map<string, number>();
for (const d of classification.dispositions) {
  for (const b of d.blockers) blockerCounts.set(b.code, (blockerCounts.get(b.code) ?? 0) + 1);
}

const mutation = snapshot.repository.mutationEvidence;

const lines = [
  'LAYER                 LIVE (test layer 3)',
  `REPO ROOT             ${REPO_ROOT}`,
  `COMMAND SURFACE       ${surface.digest}`,
  `AUTHORITY MANIFEST    ${authority.authorityManifestDigest}`,
  `VERSIONS              snapshot ${snapshot.metadata.snapshotSchema} / observer ${snapshot.metadata.observerVersion} / classifier ${classification.classifierVersion} / policy ${classification.policyVersion}`,
  '',
  `CANDIDATES DISCOVERED ${sequencer.candidates.length}`,
  `WORKTREE METADATA IDS ${sequencer.worktreeIds.length}`,
  `SHA SET               ${sequencer.shaSet.length}`,
  `CANONICAL SHA         ${String(sequencer.canonicalSha)} (source ${sequencer.canonicalShaSource})`,
  `CANONICAL STABLE      ${String(sequencer.canonicalSha === sequencer.canonicalShaAfter)}`,
  `IDENTITY DIGEST       ${snapshot.identityDigest}`,
  '',
  `OBSERVATION COVERAGE  OBSERVED ${coverage.OBSERVED} / UNKNOWN ${coverage.UNKNOWN} / NOT_ATTEMPTED ${coverage.NOT_ATTEMPTED}`,
  `FILESYSTEM TIMEOUTS   ${port.filesystemTimeoutCount}`,
  '',
  'MUTATION EVIDENCE (this run’s own proof that it changed nothing)',
  `  state               ${mutation.state}`,
  `  compared pairs      ${String(mutation.value?.comparedPairs ?? 0)}`,
  `  differing pairs     ${mutation.value?.differingPairs.length === 0 ? 'none' : (mutation.value?.differingPairs ?? []).join(', ')}`,
  '',
  `DISPOSITIONS          ${[...decisions].map(([k, v]) => `${k}=${v}`).join(' ')}`,
  'BLOCKER CODES',
  ...[...blockerCounts]
    .sort((a, b) => b[1] - a[1])
    .map(([code, n]) => `  ${String(n).padStart(4)}  ${code}`),
  '',
  'NO CLEANUP WAS PERFORMED. V1 has no cleanup authority; this run only observed.',
];


console.log(lines.join('\n'));

if (OUT !== '') {
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(
    OUT,
    JSON.stringify({ snapshot, classification, report: lines.join('\n') }, null, 2),
    'utf8',
  );

  console.log(`\nwrote ${OUT}`);
}
