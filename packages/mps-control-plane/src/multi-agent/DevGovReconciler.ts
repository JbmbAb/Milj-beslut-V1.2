import { AppendOnlyEventLog } from './EventLog';
import { applyControllerActivation } from './StateMachine';
import {
  verifyAuthoritativeProof,
  type DevGovAuthoritativeProofPort,
  type ProofRejectionReason,
} from './DevGovAuthoritativeProof';
import type { FileDurableControlPlaneStore } from './FileDurableControlPlaneStore';
import type { WorkflowDispatchCorrelator } from './GitHubRunCorrelation';
import type { DevGovWorkflowAvailabilityPort } from './GitHubDevGovDispatchAdapter';
import type {
  DevGovTelemetryStatusPort,
  RemoteExecutionObservation,
  TelemetryStatusObservation,
} from './DevGovTelemetryObservation';
import type { MultiAgentState, MultiAgentUnitState } from './types';

const DEV_GOV_PROGRESSION_STATES: readonly MultiAgentState[] = [
  'PROVING_RED',
  'PROVING_GREEN',
  'GATING',
  'GATE_PASSED',
  'PROMOTING',
];

/**
 * DEV-GOV-V0's shared commit-status context.
 *
 * TELEMETRY ONLY. This constant exists so the reconciler can *read* the status
 * for diagnostics and record it in the audit trail. It is not, and must not
 * become, an input to any advancement decision.
 *
 * An earlier revision of this file treated `state: success` on this context as
 * sufficient evidence of a passed gate. That was wrong: a commit status is a
 * repository-scoped mutable label that any actor with write access can post on
 * any SHA, with any context, at any time. It names no unit, no revision, no
 * workflow run and no proof, so it cannot distinguish a real DEV-GOV gate from
 * a forged label — and treating it as evidence let observation manufacture
 * authority, which is the one thing the control plane may never do.
 */
const DEV_GOV_TELEMETRY_STATUS_CONTEXT = 'DEV-GOV-V0 / trusted-execution';

export type ReconciliationOutcome =
  | { readonly kind: 'NOT_APPLICABLE'; readonly state: MultiAgentState }
  | { readonly kind: 'BLOCKED_DEPENDENCY_APPLIED'; readonly reason: string }
  | { readonly kind: 'ALREADY_BLOCKED_DEPENDENCY' }
  | { readonly kind: 'RUN_NOT_DISPATCHED' }
  | { readonly kind: 'AWAITING_RUN' }
  | { readonly kind: 'UNCERTAIN_DISPATCH' }
  | { readonly kind: 'AMBIGUOUS_CORRELATION'; readonly candidateRunIds: readonly string[] }
  | { readonly kind: 'CORRELATION_TIMEOUT' }
  | { readonly kind: 'CORRELATED'; readonly runId: string }
  /** No workflow run is bound to this unit's dispatch, so no proof can be attributed to it. */
  | {
      readonly kind: 'PROOF_RUN_NOT_BOUND';
      readonly telemetry?: TelemetryStatusObservation;
    }
  /** More than one authoritative proof matched. Never resolved by choosing one. */
  | {
      readonly kind: 'AMBIGUOUS_PROOF';
      readonly proofIds: readonly string[];
      readonly telemetry?: TelemetryStatusObservation;
    }
  /** A proof was returned but failed at least one binding dimension. */
  | {
      readonly kind: 'PROOF_REJECTED';
      readonly reason: ProofRejectionReason;
      readonly detail: string;
      readonly telemetry?: TelemetryStatusObservation;
    }
  /**
   * The ONLY authority-bearing outcome. Produced exclusively from an
   * authoritative DEV-GOV proof whose every binding dimension matched the
   * canonical unit. Still a proposal: advancing state remains the job of the
   * unmodified handoff-ingestion pipeline, which this class never calls.
   */
  | {
      readonly kind: 'AUTHORITATIVE_GATE_PROVEN';
      readonly candidateSha: string;
      readonly proofId: string;
      readonly workflowRunId: string;
      readonly proposedHandoff: {
        readonly role: 'GATE';
        readonly result: 'PASS';
        readonly observedCandidateSha: string;
        readonly unitRevision: number;
        readonly proofId: string;
        readonly workflowRunId: string;
      };
    }
  | { readonly kind: 'STALE_SUPERSEDED'; readonly reason: string }
  | { readonly kind: 'NO_SIGNAL'; readonly telemetry?: TelemetryStatusObservation };

export interface ReconcileInput {
  readonly expectedUnitId: string;
  readonly expectedRevision: number;
  readonly expectedCandidateSha?: string;
  readonly workflow: string;
  readonly protectedRef: string;
  readonly dispatchKey?: string;
}

export interface DevGovReconcilerDependencies {
  readonly store: FileDurableControlPlaneStore;
  readonly availability: DevGovWorkflowAvailabilityPort;
  readonly correlator: WorkflowDispatchCorrelator;
  /** AUTHORITY. The only source that may justify a gate-complete proposal. */
  readonly authoritativeProof: DevGovAuthoritativeProofPort;
  /**
   * Full ref path of the trusted DEV-GOV workflow whose proofs this controller
   * accepts, e.g. `owner/repo/.github/workflows/devgov-v0-gate.yml@refs/heads/main`.
   * Required with no default: a controller that cannot say which workflow it
   * trusts has no business accepting proofs.
   */
  readonly trustedWorkflowIdentity: string;
  /** DIAGNOSTICS ONLY. Optional; nothing decides anything on it. */
  readonly telemetry?: DevGovTelemetryStatusPort;
  readonly now?: () => Date;
}

/**
 * Authority boundary, enforced structurally.
 *
 *   AUTHORITY TRUTH   authoritative DEV-GOV proof with exact provenance
 *   REMOTE TRUTH      GitHub workflow/run/status observations
 *   CONTROLLER STATE  this controller's persisted observation/state
 *
 * Controller state may lag authority; it must never lead it. Concretely:
 *
 * - The only state this class ever writes itself is BLOCKED_DEPENDENCY, an
 *   administrative "cannot proceed" fact that claims no proof, gate, or
 *   promotion occurred.
 * - Commit statuses are read as telemetry, recorded for audit, and are
 *   incapable of producing an authority-bearing outcome. There is no code path
 *   from a status value to AUTHORITATIVE_GATE_PROVEN.
 * - Remote run facts may only subtract: a run GitHub reports as unsuccessful
 *   vetoes a proof, while a successful run authorizes nothing by itself.
 * - AUTHORITATIVE_GATE_PROVEN requires an authoritative proof binding unit id,
 *   unit revision, candidate SHA, unit-definition hash, trusted workflow
 *   identity, the exact run this unit's own dispatch was correlated to, a
 *   canonical proof reference, and a successful authoritative result.
 * - When the authoritative proof surface is unavailable (the DEV-GOV proof
 *   artifact does not exist on this base/runtime yet), the answer is
 *   BLOCKED_DEPENDENCY. There is no fallback path.
 * - Even AUTHORITATIVE_GATE_PROVEN only *proposes*. Advancing GATING ->
 *   GATE_PASSED -> PROMOTING still goes through the existing, unmodified
 *   HandoffIngestor / applyVerifiedHandoff pipeline. This class routes; it does
 *   not sign, gate, or promote.
 */
export class DevGovReconciler {
  private readonly store: FileDurableControlPlaneStore;
  private readonly availability: DevGovWorkflowAvailabilityPort;
  private readonly correlator: WorkflowDispatchCorrelator;
  private readonly authoritativeProof: DevGovAuthoritativeProofPort;
  private readonly trustedWorkflowIdentity: string;
  private readonly telemetry?: DevGovTelemetryStatusPort;
  private readonly now: () => Date;

  constructor(deps: DevGovReconcilerDependencies) {
    this.store = deps.store;
    this.availability = deps.availability;
    this.correlator = deps.correlator;
    this.authoritativeProof = deps.authoritativeProof;
    this.trustedWorkflowIdentity = deps.trustedWorkflowIdentity;
    this.telemetry = deps.telemetry;
    this.now = deps.now ?? (() => new Date());
  }

  async reconcile(input: ReconcileInput): Promise<ReconciliationOutcome> {
    const snapshot = this.store.read();
    const unit = snapshot.units[input.expectedUnitId];
    if (!unit) throw new Error(`canonical unit ${input.expectedUnitId} does not exist`);

    // Bind to the exact prior canonical state/revision/candidate the caller
    // expected. A stale caller (superseded candidate, already-advanced
    // revision) is recorded for audit but never allowed to move state.
    if (unit.revision !== input.expectedRevision) {
      this.appendAudit(unit, {
        outcome: 'STALE_SUPERSEDED',
        reason: 'expected revision does not match canonical revision',
        expectedRevision: input.expectedRevision,
        canonicalRevision: unit.revision,
      });
      return {
        kind: 'STALE_SUPERSEDED',
        reason: `expected revision ${input.expectedRevision}, canonical is ${unit.revision}`,
      };
    }
    if (input.expectedCandidateSha && unit.candidateSha !== input.expectedCandidateSha) {
      this.appendAudit(unit, {
        outcome: 'STALE_SUPERSEDED',
        reason: 'expected candidate SHA does not match canonical candidate',
        expectedCandidateSha: input.expectedCandidateSha,
        canonicalCandidateSha: unit.candidateSha,
      });
      return {
        kind: 'STALE_SUPERSEDED',
        reason: 'candidate SHA was superseded since this reconciliation was scheduled',
      };
    }

    if (unit.state === 'BLOCKED_DEPENDENCY') {
      return { kind: 'ALREADY_BLOCKED_DEPENDENCY' };
    }

    if (!DEV_GOV_PROGRESSION_STATES.includes(unit.state)) {
      return { kind: 'NOT_APPLICABLE', state: unit.state };
    }

    const available = await this.availability.workflowExists(input.workflow, input.protectedRef);
    if (!available) {
      const reason = `DEV-GOV workflow ${input.workflow} does not exist on ${input.protectedRef}`;
      this.applyDependencyBlock(unit, reason);
      return { kind: 'BLOCKED_DEPENDENCY_APPLIED', reason };
    }

    if (unit.state === 'PROVING_RED' && input.dispatchKey) {
      const correlation = await this.correlator.poll(input.dispatchKey);
      if (correlation.status === 'AWAITING_RUN') return { kind: 'AWAITING_RUN' };
      if (correlation.status === 'UNCERTAIN_DISPATCH') return { kind: 'UNCERTAIN_DISPATCH' };
      if (correlation.status === 'AMBIGUOUS_CORRELATION') {
        this.appendAudit(unit, {
          outcome: 'AMBIGUOUS_CORRELATION',
          candidateRunIds: correlation.candidateRunIds,
        });
        return { kind: 'AMBIGUOUS_CORRELATION', candidateRunIds: correlation.candidateRunIds ?? [] };
      }
      if (correlation.status === 'CORRELATION_TIMEOUT') {
        this.appendAudit(unit, { outcome: 'CORRELATION_TIMEOUT' });
        return { kind: 'CORRELATION_TIMEOUT' };
      }
      if (correlation.status === 'CORRELATED' && correlation.runId) {
        return { kind: 'CORRELATED', runId: correlation.runId };
      }
    }

    if (!unit.candidateSha) return { kind: 'NO_SIGNAL' };

    // Telemetry is read here purely so the audit trail can explain what the
    // controller could see while it waited. It is deliberately not wrapped in a
    // try/catch: a diagnostic port that throws must stay visible rather than be
    // silently swallowed, and aborting is fail-closed, so it can still never
    // manufacture an advance.
    const telemetry = await this.telemetry?.observeStatus(
      unit.candidateSha,
      DEV_GOV_TELEMETRY_STATUS_CONTEXT,
    );

    // Authority requires a run bound to THIS unit's own dispatch by the durable
    // correlation ledger. Without that binding, any proof would be attributable
    // only by its own say-so.
    const boundRun = input.dispatchKey ? await this.correlator.findRun(input.dispatchKey) : undefined;
    if (!boundRun) {
      this.appendAudit(unit, {
        outcome: 'PROOF_RUN_NOT_BOUND',
        telemetry: telemetry ? { ...telemetry, authority: false } : undefined,
      });
      return { kind: 'PROOF_RUN_NOT_BOUND', telemetry };
    }

    const lookup = await this.authoritativeProof.fetchProof({
      unitId: unit.unitId,
      unitRevision: unit.revision,
      candidateSha: unit.candidateSha,
      workflowRunId: boundRun.runId,
    });

    if (lookup.status === 'UNAVAILABLE') {
      // The authoritative proof surface itself is missing. This is exactly the
      // case a fallback would be tempting for, and exactly where one would be
      // fatal: a telemetry success sitting next to an unavailable proof still
      // proves nothing.
      const reason = `authoritative DEV-GOV proof is unavailable: ${lookup.reason}`;
      this.applyDependencyBlock(unit, reason);
      return { kind: 'BLOCKED_DEPENDENCY_APPLIED', reason };
    }
    if (lookup.status === 'NOT_FOUND') {
      this.appendAudit(unit, {
        outcome: 'NO_SIGNAL',
        reason: 'no authoritative DEV-GOV proof published for this unit/revision/candidate/run yet',
        telemetry: telemetry ? { ...telemetry, authority: false } : undefined,
      });
      return { kind: 'NO_SIGNAL', telemetry };
    }
    if (lookup.status === 'AMBIGUOUS') {
      this.appendAudit(unit, { outcome: 'AMBIGUOUS_PROOF', proofIds: lookup.proofIds });
      return { kind: 'AMBIGUOUS_PROOF', proofIds: lookup.proofIds, telemetry };
    }

    const remoteRun: RemoteExecutionObservation = {
      workflow: boundRun.workflow,
      runId: boundRun.runId,
      status: boundRun.status,
      conclusion: boundRun.conclusion,
    };
    const rejection = verifyAuthoritativeProof(lookup.proof, {
      unitId: unit.unitId,
      unitRevision: unit.revision,
      candidateSha: unit.candidateSha,
      unitDefinitionHash: unit.unitDefinitionHash,
      proofContractHash: unit.proofContractHash,
      trustedWorkflowIdentity: this.trustedWorkflowIdentity,
      boundRun: remoteRun,
    });
    if (rejection) {
      this.appendAudit(unit, {
        outcome: 'PROOF_REJECTED',
        reason: rejection.reason,
        detail: rejection.detail,
        proofId: lookup.proof.proofId,
      });
      return {
        kind: 'PROOF_REJECTED',
        reason: rejection.reason,
        detail: rejection.detail,
        telemetry,
      };
    }

    this.appendAudit(unit, {
      outcome: 'AUTHORITATIVE_GATE_PROVEN',
      proofId: lookup.proof.proofId,
      workflowIdentity: lookup.proof.workflowIdentity,
      workflowRunId: lookup.proof.workflowRunId,
      candidateSha: unit.candidateSha,
      unitRevision: unit.revision,
    });
    return {
      kind: 'AUTHORITATIVE_GATE_PROVEN',
      candidateSha: unit.candidateSha,
      proofId: lookup.proof.proofId,
      workflowRunId: lookup.proof.workflowRunId,
      proposedHandoff: {
        role: 'GATE',
        result: 'PASS',
        observedCandidateSha: unit.candidateSha,
        unitRevision: unit.revision,
        proofId: lookup.proof.proofId,
        workflowRunId: lookup.proof.workflowRunId,
      },
    };
  }

  private applyDependencyBlock(unit: MultiAgentUnitState, reason: string): void {
    const occurredAt = this.now().toISOString();
    const activated = applyControllerActivation(unit, 'BLOCKED_DEPENDENCY', occurredAt);
    const current = this.store.read();
    const log = new AppendOnlyEventLog(current.events);
    const dependencyEvent = log.append(
      unit.unitId,
      'DEPENDENCY_BLOCKED',
      { actor: 'CONTROLLER', reason, from: unit.state, to: activated.state, state: { ...activated } },
      occurredAt,
    );
    const transitionEvent = log.append(
      unit.unitId,
      'UNIT_STATE_TRANSITIONED',
      { actor: 'CONTROLLER', reason, from: unit.state, to: activated.state, state: { ...activated } },
      occurredAt,
    );
    this.store.commitControllerTransition({
      state: activated,
      events: [dependencyEvent, transitionEvent],
    });
  }

  private appendAudit(unit: MultiAgentUnitState, payload: Readonly<Record<string, unknown>>): void {
    const current = this.store.read();
    const occurredAt = this.now().toISOString();
    const log = new AppendOnlyEventLog(current.events);
    const event = log.append(unit.unitId, 'RECONCILIATION_OBSERVED', payload, occurredAt);
    this.store.appendAuditEvents([event]);
  }
}
