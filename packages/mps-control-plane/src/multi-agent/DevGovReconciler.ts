import { AppendOnlyEventLog } from "./EventLog";
import { applyControllerActivation } from "./StateMachine";
import type { FileDurableControlPlaneStore } from "./FileDurableControlPlaneStore";
import type { WorkflowDispatchCorrelator } from "./GitHubRunCorrelation";
import type { DevGovWorkflowAvailabilityPort } from "./GitHubDevGovDispatchAdapter";
import type { MultiAgentState, MultiAgentUnitState } from "./types";

const DEV_GOV_PROGRESSION_STATES: readonly MultiAgentState[] = [
  "PROVING_RED",
  "PROVING_GREEN",
  "GATING",
  "GATE_PASSED",
  "PROMOTING",
];

/**
 * DEV-GOV-V0's own protected commit-status context. This is the one signal
 * in the whole system that is already produced under full DEV-GOV authority
 * (exact-SHA RED/GREEN proof -> signed attestation -> OIDC evidence-gate),
 * so observing it is not "manufacturing" a gate result — the gate already
 * happened externally. This reconciler only binds that pre-existing fact to
 * the exact candidate it claims to describe.
 */
const TRUSTED_EXECUTION_CONTEXT = "DEV-GOV-V0 / trusted-execution";

export interface DevGovCommitStatusObserverPort {
  /** Most recent reported state of `context` on `sha`, or undefined if never reported. */
  getStatus(
    sha: string,
    context: string,
  ): Promise<"success" | "failure" | "error" | "pending" | undefined>;
}

export type ReconciliationOutcome =
  | { readonly kind: "NOT_APPLICABLE"; readonly state: MultiAgentState }
  | { readonly kind: "BLOCKED_DEPENDENCY_APPLIED"; readonly reason: string }
  | { readonly kind: "ALREADY_BLOCKED_DEPENDENCY" }
  | { readonly kind: "RUN_NOT_DISPATCHED" }
  | { readonly kind: "AWAITING_RUN" }
  | { readonly kind: "AMBIGUOUS_CORRELATION"; readonly candidateRunIds: readonly string[] }
  | { readonly kind: "CORRELATION_TIMEOUT" }
  | { readonly kind: "CORRELATED"; readonly runId: string }
  | {
      readonly kind: "EXTERNAL_GATE_OBSERVED";
      readonly candidateSha: string;
      readonly proposedHandoff: {
        readonly role: "GATE";
        readonly result: "PASS";
        readonly observedCandidateSha: string;
      };
    }
  | { readonly kind: "STALE_SUPERSEDED"; readonly reason: string }
  | { readonly kind: "NO_SIGNAL" };

export interface ReconcileInput {
  readonly expectedUnitId: string;
  readonly expectedRevision: number;
  readonly expectedCandidateSha?: string;
  readonly workflow: string;
  readonly protectedRef: string;
  readonly dispatchKey?: string;
}

/**
 * Part F authority boundary, enforced structurally:
 *
 * - The ONLY state this class ever writes itself is BLOCKED_DEPENDENCY,
 *   which is an administrative "cannot proceed" fact, not a claim that any
 *   proof, gate, or promotion occurred.
 * - Every other observation (workflow-run correlation, DEV-GOV-V0 commit
 *   status) is returned as data. Advancing PROVING_RED -> ... -> PROMOTED
 *   on the strength of an EXTERNAL_GATE_OBSERVED signal still has to pass
 *   through the existing, unmodified HandoffIngestor / applyVerifiedHandoff
 *   pipeline — this class never calls those itself. It routes; it does not
 *   sign, gate, or promote.
 */
export class DevGovReconciler {
  constructor(
    private readonly store: FileDurableControlPlaneStore,
    private readonly availability: DevGovWorkflowAvailabilityPort,
    private readonly correlator: WorkflowDispatchCorrelator,
    private readonly commitStatus: DevGovCommitStatusObserverPort,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async reconcile(input: ReconcileInput): Promise<ReconciliationOutcome> {
    const snapshot = this.store.read();
    const unit = snapshot.units[input.expectedUnitId];
    if (!unit) throw new Error(`canonical unit ${input.expectedUnitId} does not exist`);

    // Part D: bind to the exact prior canonical state/revision/candidate the
    // caller expected. A stale caller (superseded candidate, already-advanced
    // revision) is recorded for audit but never allowed to move state.
    if (unit.revision !== input.expectedRevision) {
      this.appendAudit(unit, "RECONCILIATION_OBSERVED", {
        outcome: "STALE_SUPERSEDED",
        reason: "expected revision does not match canonical revision",
        expectedRevision: input.expectedRevision,
        canonicalRevision: unit.revision,
      });
      return {
        kind: "STALE_SUPERSEDED",
        reason: `expected revision ${input.expectedRevision}, canonical is ${unit.revision}`,
      };
    }
    if (input.expectedCandidateSha && unit.candidateSha !== input.expectedCandidateSha) {
      this.appendAudit(unit, "RECONCILIATION_OBSERVED", {
        outcome: "STALE_SUPERSEDED",
        reason: "expected candidate SHA does not match canonical candidate",
        expectedCandidateSha: input.expectedCandidateSha,
        canonicalCandidateSha: unit.candidateSha,
      });
      return {
        kind: "STALE_SUPERSEDED",
        reason: "candidate SHA was superseded since this reconciliation was scheduled",
      };
    }

    if (unit.state === "BLOCKED_DEPENDENCY") {
      return { kind: "ALREADY_BLOCKED_DEPENDENCY" };
    }

    if (!DEV_GOV_PROGRESSION_STATES.includes(unit.state)) {
      return { kind: "NOT_APPLICABLE", state: unit.state };
    }

    const available = await this.availability.workflowExists(input.workflow, input.protectedRef);
    if (!available) {
      const reason = `DEV-GOV workflow ${input.workflow} does not exist on ${input.protectedRef}`;
      this.applyDependencyBlock(unit, reason);
      return { kind: "BLOCKED_DEPENDENCY_APPLIED", reason };
    }

    if (unit.state === "PROVING_RED" && input.dispatchKey) {
      const correlation = await this.correlator.poll(input.dispatchKey);
      if (correlation.status === "AWAITING_RUN") return { kind: "AWAITING_RUN" };
      if (correlation.status === "AMBIGUOUS_CORRELATION") {
        this.appendAudit(unit, "RECONCILIATION_OBSERVED", {
          outcome: "AMBIGUOUS_CORRELATION",
          candidateRunIds: correlation.candidateRunIds,
        });
        return { kind: "AMBIGUOUS_CORRELATION", candidateRunIds: correlation.candidateRunIds ?? [] };
      }
      if (correlation.status === "CORRELATION_TIMEOUT") {
        this.appendAudit(unit, "RECONCILIATION_OBSERVED", { outcome: "CORRELATION_TIMEOUT" });
        return { kind: "CORRELATION_TIMEOUT" };
      }
      if (correlation.status === "CORRELATED" && correlation.runId) {
        return { kind: "CORRELATED", runId: correlation.runId };
      }
    }

    if (!unit.candidateSha) return { kind: "NO_SIGNAL" };
    const status = await this.commitStatus.getStatus(unit.candidateSha, TRUSTED_EXECUTION_CONTEXT);
    if (status === "success") {
      this.appendAudit(unit, "RECONCILIATION_OBSERVED", {
        outcome: "EXTERNAL_GATE_OBSERVED",
        context: TRUSTED_EXECUTION_CONTEXT,
        candidateSha: unit.candidateSha,
      });
      return {
        kind: "EXTERNAL_GATE_OBSERVED",
        candidateSha: unit.candidateSha,
        proposedHandoff: { role: "GATE", result: "PASS", observedCandidateSha: unit.candidateSha },
      };
    }

    return { kind: "NO_SIGNAL" };
  }

  private applyDependencyBlock(unit: MultiAgentUnitState, reason: string): void {
    const occurredAt = this.now().toISOString();
    const activated = applyControllerActivation(unit, "BLOCKED_DEPENDENCY", occurredAt);
    const current = this.store.read();
    const log = new AppendOnlyEventLog(current.events);
    const dependencyEvent = log.append(
      unit.unitId,
      "DEPENDENCY_BLOCKED",
      { actor: "CONTROLLER", reason, from: unit.state, to: activated.state, state: { ...activated } },
      occurredAt,
    );
    const transitionEvent = log.append(
      unit.unitId,
      "UNIT_STATE_TRANSITIONED",
      { actor: "CONTROLLER", reason, from: unit.state, to: activated.state, state: { ...activated } },
      occurredAt,
    );
    this.store.commitControllerTransition({
      state: activated,
      events: [dependencyEvent, transitionEvent],
    });
  }

  private appendAudit(
    unit: MultiAgentUnitState,
    kind: "RECONCILIATION_OBSERVED",
    payload: Readonly<Record<string, unknown>>,
  ): void {
    const current = this.store.read();
    const occurredAt = this.now().toISOString();
    const log = new AppendOnlyEventLog(current.events);
    const event = log.append(unit.unitId, kind, payload, occurredAt);
    this.store.appendAuditEvents([event]);
  }
}
