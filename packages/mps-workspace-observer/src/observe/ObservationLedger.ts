/**
 * WORKSPACE-LIFECYCLE-CONTROLLER-V1 — the observation ledger.
 *
 * A3 is the rule this type exists to make unbreakable: the Observer may never omit an observation.
 * The earliest symptom of the observer/policy boundary eroding is not a policy field appearing in
 * the snapshot — it is the Observer quietly SKIPPING observations it judges uninteresting. That is
 * policy application disguised as optimisation, and it is invisible in the output because the field
 * simply does not appear.
 *
 * So every request the Observer decides about lands here, including the ones it decided not to
 * make, and the decision is one of exactly three states:
 *
 *   OBSERVED       a conclusive answer was obtained
 *   UNKNOWN        the observation was attempted and gave no conclusive answer
 *   NOT_ATTEMPTED  the observation was never made
 *
 * UNKNOWN and NOT_ATTEMPTED both fall closed, and conflating them is an implementation error, not
 * a simplification: they are different facts about the world and about the run.
 *
 * None of the transport's failure codes (NOT_IN_CORPUS, NOT_CAPTURED_BY_PRECONDITION,
 * REQUEST_OUTSIDE_COMMAND_SURFACE) can ever appear here. They are raised out of band and abort the
 * run before a snapshot exists, precisely so that a data-starved Observer cannot emit UNKNOWN for a
 * workspace it never observed and look correctly fail-closed.
 */
import type { FilesystemResponse, ProcessResponse, RequestTiming } from '../port/RequestPort.js';

export type ObservationState = 'OBSERVED' | 'UNKNOWN' | 'NOT_ATTEMPTED';

/**
 * Why an observation was not attempted. This is the Observer's OWN vocabulary and is deliberately
 * distinct from the capture-time coverage reason codes: a capture-time non-attempt is a fact about
 * the corpus, this is a fact about the run.
 */
export type NotAttemptedReason =
  /** The candidate is outside the observation scope this run was given (replay is per case). */
  | 'OUT_OF_OBSERVATION_SCOPE'
  /** A stated instantiation predicate of the frozen command surface was not satisfied. */
  | 'INSTANTIATION_PREDICATE_UNSATISFIED'
  /** The family expands per member and the expansion had no members. */
  | 'EXPANSION_EMPTY'
  /** No canonical SHA was selected, and the family requires one. */
  | 'CANONICAL_SHA_UNAVAILABLE'
  /** The filesystem timeout pool was exhausted; further results would be starvation artefacts. */
  | 'FILESYSTEM_POOL_EXHAUSTED';

/** Why an attempted observation was inconclusive. Every one of these propagates to BLOCKED. */
export type UnknownReason =
  | 'TIMEOUT'
  | 'SPAWN_ERROR'
  | 'NON_ZERO_EXIT'
  | 'FILESYSTEM_ERROR_INCONCLUSIVE'
  | 'OUTPUT_NOT_UTF8'
  | 'OUTPUT_UNPARSEABLE'
  | 'OUTPUT_TRUNCATED';

export interface LedgerEntry {
  readonly requestId: string;
  readonly instanceKey: string;
  readonly opKey: string;
  readonly state: ObservationState;
  readonly notAttemptedReason?: NotAttemptedReason;
  readonly unknownReason?: UnknownReason;
  /** The raw response, present exactly when the request was issued. */
  readonly process?: ProcessResponse;
  readonly filesystem?: FilesystemResponse;
  readonly timing?: RequestTiming;
  /** Present for process requests: the argv actually issued, including the mandatory prefix. */
  readonly argv?: readonly string[];
  readonly path?: string;
}

export class ObservationLedger {
  private readonly entries: LedgerEntry[] = [];
  private readonly index = new Map<string, LedgerEntry[]>();

  private static key(requestId: string, instanceKey: string, opKey: string): string {
    return `${requestId}\u0000${instanceKey}\u0000${opKey}`;
  }

  add(entry: LedgerEntry): void {
    this.entries.push(entry);
    const k = ObservationLedger.key(entry.requestId, entry.instanceKey, entry.opKey);
    const list = this.index.get(k);
    if (list === undefined) this.index.set(k, [entry]);
    else list.push(entry);
  }

  /**
   * The entries for one instance triple, in the order they were issued.
   *
   * A list rather than a single entry, because the frozen surface issues R-G-01, R-G-02, R-F-01,
   * R-F-02 and R-F-08 twice, BEFORE and AFTER the workspace pass, and the pair IS the evidence
   * that nothing was mutated.
   */
  get(requestId: string, instanceKey: string, opKey = ''): readonly LedgerEntry[] {
    return this.index.get(ObservationLedger.key(requestId, instanceKey, opKey)) ?? [];
  }

  /** The single entry for a triple, or undefined. Throws when the triple was issued more than once. */
  one(requestId: string, instanceKey: string, opKey = ''): LedgerEntry | undefined {
    const list = this.get(requestId, instanceKey, opKey);
    if (list.length > 1) {
      throw new Error(
        `${requestId} ${instanceKey} ${opKey} has ${list.length} entries; use get() and choose the pass explicitly`,
      );
    }
    return list[0];
  }

  all(): readonly LedgerEntry[] {
    return this.entries;
  }

  byRequestId(requestId: string): readonly LedgerEntry[] {
    return this.entries.filter((e) => e.requestId === requestId);
  }

  /** Coverage counts, so a run can state what it observed rather than implying it. */
  summary(): Readonly<Record<ObservationState, number>> {
    const out: Record<ObservationState, number> = {
      OBSERVED: 0,
      UNKNOWN: 0,
      NOT_ATTEMPTED: 0,
    };
    for (const e of this.entries) out[e.state] += 1;
    return out;
  }
}

/**
 * Decode a recorded stdout/stderr field to text, or report why it cannot be trusted as text.
 *
 * A base64 stream is not a parse failure to be retried as text: it means the bytes were not valid
 * UTF-8, and any parse of them would be a guess. The Observer records UNKNOWN and falls closed.
 */
export function decodeUtf8(
  field: { readonly encoding: 'utf8' | 'base64'; readonly data: string } | undefined,
): { readonly text: string } | { readonly unknownReason: UnknownReason } {
  if (field === undefined) return { unknownReason: 'OUTPUT_UNPARSEABLE' };
  if (field.encoding !== 'utf8') return { unknownReason: 'OUTPUT_NOT_UTF8' };
  return { text: field.data };
}
