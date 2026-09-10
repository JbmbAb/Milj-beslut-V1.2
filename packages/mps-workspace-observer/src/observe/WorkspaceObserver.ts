/**
 * WORKSPACE-LIFECYCLE-CONTROLLER-V1 — the Observer.
 *
 * Two steps and nothing else: issue the frozen request sequence through a port, then correlate the
 * resulting ledger into an immutable snapshot. The same Observer runs against all three test layers;
 * only the port changes. That is what makes a green replay run mean anything about the live one.
 *
 * The Observer does not decide anything. It has no access to policy or disposition types, it never
 * receives the expectations, and it cannot reach either: the package manifest, an eslint rule and a
 * transitive import-graph test each independently forbid it.
 */
import { correlate } from './correlate.js';
import { RequestSequencer } from './RequestSequencer.js';
import type { SequencerOptions, SequencerResult } from './RequestSequencer.js';
import type { WorkspaceSnapshotArtifact } from '../snapshot/types.js';

export interface ObserveOptions extends SequencerOptions {
  /**
   * The observation window, supplied by the port's timing source rather than read from a clock.
   *
   * A9 keeps timestamps out of the identity digest so that re-observing an untouched machine
   * reproduces it; A16 still requires the snapshot to describe an INTERVAL. Both hold only when the
   * window comes from the same source as the observations — the corpus metadata in replay, the
   * port's own measurements live.
   */
  readonly globalObservationWindow?: { readonly start: string; readonly end: string };
  readonly transcriptRef?: string;
}

export interface ObservationResult {
  readonly snapshot: WorkspaceSnapshotArtifact;
  /** The raw ledger, kept beside the snapshot so every derived field has its input available (A2). */
  readonly sequencer: SequencerResult;
}

export async function observe(options: ObserveOptions): Promise<ObservationResult> {
  const sequencer = await new RequestSequencer(options).run();
  const snapshot = correlate({
    sequencer,
    commandSurfaceDigest: options.surface.digest,
    globalObservationWindow: options.globalObservationWindow,
    transcriptRef: options.transcriptRef,
  });
  return { snapshot, sequencer };
}
