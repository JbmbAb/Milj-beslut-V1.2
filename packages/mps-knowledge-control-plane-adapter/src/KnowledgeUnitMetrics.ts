import type { ControlPlaneEvent, MultiAgentState } from '@miljobeslut/mps-control-plane';

const TERMINAL_STATES: ReadonlySet<MultiAgentState> = new Set([
  'PROMOTED',
  'CLOSED',
  'CANCELLED',
  'SUPERSEDED',
]);

/**
 * Deterministic, event-derived measurement snapshot for one Knowledge unit.
 * Every field is reconstructed purely from the unit's own slice of the
 * Control Plane's append-only event log -- nothing here is stored
 * separately, so there is nothing that can drift out of sync with the
 * canonical event history, and re-deriving it twice from the same events
 * always produces the same result (see KnowledgeUnitMetrics.test.ts).
 */
export interface KnowledgeUnitMetricsSnapshot {
  readonly unitId: string;
  readonly implementationStartedAt?: string;
  readonly implementationEndedAt?: string;
  readonly verificationStartedAt?: string;
  readonly verificationEndedAt?: string;
  /** Wall-clock from the first recorded event to the last, in milliseconds. */
  readonly wallClockMs?: number;
  /** Count of VERIFY_FAILED transitions -- how many times verification sent work back. */
  readonly retries: number;
  /** True only if the unit reached READY_FOR_DEV_GOV with zero prior VERIFY_FAILED transitions. */
  readonly firstPassVerification: boolean;
  /** A currently-terminal MultiAgentState (PROMOTED/CLOSED/CANCELLED/SUPERSEDED), else undefined. */
  readonly terminalResult?: MultiAgentState;
  /**
   * Count of UNIT_STATE_TRANSITIONED events landing on BLOCKED_DESIGN --
   * Router.routeAfterHandoff sends exactly these to targetRole "CONTROLLER"
   * (a human/owner decision), never auto-dispatching a next agent, so this
   * is a deterministic proxy for how many times this unit needed a human.
   */
  readonly humanInterventionCount: number;
  readonly implementerAgentRunIds: readonly string[];
  readonly verifierAgentRunIds: readonly string[];
  readonly candidateSha?: string;
  readonly unitDefinitionHash?: string;
  readonly proofContractHash?: string;
  readonly devGovResult?: MultiAgentState;
}

interface HandoffPayloadShape {
  readonly handoff?: {
    readonly role?: string;
    readonly agentRunId?: string;
    readonly observedCandidateSha?: string;
    readonly unitDefinitionHash?: string;
    readonly proofContractHash?: string;
  };
}

export function deriveKnowledgeUnitMetrics(
  events: readonly ControlPlaneEvent[],
  unitId: string,
): KnowledgeUnitMetricsSnapshot {
  const own = events.filter((event) => event.unitId === unitId).sort((a, b) => a.sequence - b.sequence);

  let implementationStartedAt: string | undefined;
  let implementationEndedAt: string | undefined;
  let verificationStartedAt: string | undefined;
  let verificationEndedAt: string | undefined;
  let retries = 0;
  let humanInterventionCount = 0;
  let terminalResult: MultiAgentState | undefined;
  let candidateSha: string | undefined;
  let unitDefinitionHash: string | undefined;
  let proofContractHash: string | undefined;
  let devGovResult: MultiAgentState | undefined;
  const implementerAgentRunIds: string[] = [];
  const verifierAgentRunIds: string[] = [];

  for (const event of own) {
    if (event.kind === 'HANDOFF_ACCEPTED') {
      const payload = event.payload as HandoffPayloadShape;
      const handoff = payload.handoff;
      if (handoff?.role === 'IMPLEMENTER' && typeof handoff.agentRunId === 'string') {
        implementerAgentRunIds.push(handoff.agentRunId);
        if (!implementationStartedAt) implementationStartedAt = event.occurredAt;
        implementationEndedAt = event.occurredAt;
        if (typeof handoff.observedCandidateSha === 'string') candidateSha = handoff.observedCandidateSha;
      }
      if (handoff?.role === 'VERIFIER' && typeof handoff.agentRunId === 'string') {
        verifierAgentRunIds.push(handoff.agentRunId);
        if (!verificationStartedAt) verificationStartedAt = event.occurredAt;
        verificationEndedAt = event.occurredAt;
      }
      if (typeof handoff?.unitDefinitionHash === 'string') unitDefinitionHash = handoff.unitDefinitionHash;
      if (typeof handoff?.proofContractHash === 'string') proofContractHash = handoff.proofContractHash;
    }

    if (event.kind === 'UNIT_STATE_TRANSITIONED') {
      const to = (event.payload as { to?: MultiAgentState }).to;
      if (to === 'VERIFY_FAILED') retries += 1;
      if (to === 'BLOCKED_DESIGN') humanInterventionCount += 1;
      if (to && TERMINAL_STATES.has(to)) terminalResult = to;
      else if (to && !TERMINAL_STATES.has(to)) terminalResult = undefined;
      if (to === 'GATE_PASSED' || to === 'PROMOTING' || to === 'PROMOTED' || to === 'PROMOTION_FAILED') {
        devGovResult = to;
      }
    }
  }

  const firstOccurredAt = own[0]?.occurredAt;
  const lastOccurredAt = own.at(-1)?.occurredAt;
  const wallClockMs =
    firstOccurredAt && lastOccurredAt
      ? new Date(lastOccurredAt).getTime() - new Date(firstOccurredAt).getTime()
      : undefined;

  return {
    unitId,
    implementationStartedAt,
    implementationEndedAt,
    verificationStartedAt,
    verificationEndedAt,
    wallClockMs,
    retries,
    firstPassVerification: retries === 0 && verificationStartedAt !== undefined,
    terminalResult,
    humanInterventionCount,
    implementerAgentRunIds,
    verifierAgentRunIds,
    candidateSha,
    unitDefinitionHash,
    proofContractHash,
    devGovResult,
  };
}

export interface KnowledgeThroughputSummary {
  readonly unitCount: number;
  readonly verifiedUnitCount: number;
  readonly firstPassVerificationRate: number;
  readonly retryRate: number;
  readonly failedUnitRate: number;
  readonly humanInterventionsPerVerifiedUnit: number;
  readonly averageWallClockMs?: number;
}

const FAILED_STATES: ReadonlySet<MultiAgentState> = new Set([
  'CANCELLED',
  'SUPERSEDED',
  'PROMOTION_FAILED',
]);

/**
 * Pure roll-up over already-derived per-unit snapshots -- no I/O, no
 * presentation, just the arithmetic VERIFIED_CHANGE_THROUGHPUT and its
 * supporting rates depend on. Deliberately not a dashboard.
 */
export function summarizeKnowledgeThroughput(
  snapshots: readonly KnowledgeUnitMetricsSnapshot[],
): KnowledgeThroughputSummary {
  const unitCount = snapshots.length;
  const verified = snapshots.filter((s) => s.verificationEndedAt !== undefined && s.retries === 0);
  const failed = snapshots.filter((s) => s.terminalResult && FAILED_STATES.has(s.terminalResult));
  const withRetries = snapshots.filter((s) => s.retries > 0);
  const wallClocks = snapshots.map((s) => s.wallClockMs).filter((v): v is number => typeof v === 'number');
  const humanInterventions = snapshots.reduce((sum, s) => sum + s.humanInterventionCount, 0);

  return {
    unitCount,
    verifiedUnitCount: verified.length,
    firstPassVerificationRate: unitCount === 0 ? 0 : verified.length / unitCount,
    retryRate: unitCount === 0 ? 0 : withRetries.length / unitCount,
    failedUnitRate: unitCount === 0 ? 0 : failed.length / unitCount,
    humanInterventionsPerVerifiedUnit: verified.length === 0 ? 0 : humanInterventions / verified.length,
    averageWallClockMs:
      wallClocks.length === 0 ? undefined : wallClocks.reduce((a, b) => a + b, 0) / wallClocks.length,
  };
}
