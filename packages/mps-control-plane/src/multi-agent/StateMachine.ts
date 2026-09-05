import type { AgentHandoff, MultiAgentState, MultiAgentUnitState } from "./types";

const ALLOWED_TRANSITIONS: Readonly<Record<MultiAgentState, readonly MultiAgentState[]>> = {
  PLANNED: ["IMPLEMENTING", "BLOCKED_DESIGN", "BLOCKED_DEPENDENCY", "CANCELLED"],
  IMPLEMENTING: [
    "IMPLEMENTATION_READY",
    "BLOCKED_ENVIRONMENT",
    "BLOCKED_DESIGN",
    "BLOCKED_DEPENDENCY",
    "CANCELLED",
    "SUPERSEDED",
  ],
  IMPLEMENTATION_READY: ["VERIFYING", "IMPLEMENTING", "CANCELLED", "SUPERSEDED"],
  VERIFYING: [
    "READY_FOR_DEV_GOV",
    "VERIFY_FAILED",
    "BLOCKED_ENVIRONMENT",
    "BLOCKED_DESIGN",
    "BLOCKED_DEPENDENCY",
    "CANCELLED",
    "SUPERSEDED",
  ],
  VERIFY_FAILED: ["IMPLEMENTING", "CANCELLED", "SUPERSEDED"],
  READY_FOR_DEV_GOV: ["PROVING_RED", "BLOCKED_ENVIRONMENT", "BLOCKED_DEPENDENCY", "CANCELLED", "SUPERSEDED"],
  PROVING_RED: ["PROVING_GREEN", "BLOCKED_ENVIRONMENT", "BLOCKED_DEPENDENCY", "CANCELLED", "SUPERSEDED"],
  PROVING_GREEN: ["GATING", "BLOCKED_ENVIRONMENT", "BLOCKED_DEPENDENCY", "CANCELLED", "SUPERSEDED"],
  GATING: ["GATE_PASSED", "GATE_FAILED", "BLOCKED_ENVIRONMENT", "BLOCKED_DEPENDENCY", "CANCELLED", "SUPERSEDED"],
  GATE_FAILED: ["READY_FOR_DEV_GOV", "IMPLEMENTING", "BLOCKED_DESIGN", "BLOCKED_DEPENDENCY", "CANCELLED", "SUPERSEDED"],
  GATE_PASSED: ["PROMOTING", "BLOCKED_DEPENDENCY", "CANCELLED", "SUPERSEDED"],
  PROMOTING: ["PROMOTED", "PROMOTION_FAILED", "BLOCKED_ENVIRONMENT", "BLOCKED_DEPENDENCY", "CANCELLED", "SUPERSEDED"],
  PROMOTION_FAILED: ["GATE_PASSED", "BLOCKED_ENVIRONMENT", "BLOCKED_DEPENDENCY", "CANCELLED", "SUPERSEDED"],
  PROMOTED: ["CLOSED"],
  CLOSED: [],
  BLOCKED_ENVIRONMENT: [
    "IMPLEMENTING",
    "VERIFYING",
    "READY_FOR_DEV_GOV",
    "PROVING_RED",
    "PROVING_GREEN",
    "GATING",
    "GATE_PASSED",
    "PROMOTING",
    "CANCELLED",
    "SUPERSEDED",
  ],
  BLOCKED_DESIGN: ["PLANNED", "IMPLEMENTING", "VERIFY_FAILED", "CANCELLED", "SUPERSEDED"],
  BLOCKED_DEPENDENCY: [
    "PLANNED",
    "IMPLEMENTING",
    "VERIFYING",
    "READY_FOR_DEV_GOV",
    "GATE_PASSED",
    "PROMOTING",
    "CANCELLED",
    "SUPERSEDED",
  ],
  CANCELLED: [],
  SUPERSEDED: [],
};

export class ControlPlaneTransitionError extends Error {}

export function canTransition(from: MultiAgentState, to: MultiAgentState): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function assertTransition(from: MultiAgentState, to: MultiAgentState): void {
  if (!canTransition(from, to)) {
    throw new ControlPlaneTransitionError(`transition denied: ${from} -> ${to}`);
  }
}

export function classifyVerifierFailure(handoff: AgentHandoff): "FULL_REVERIFY" | "DELTA_REVERIFY" {
  const classes = handoff.findings.map((finding) => finding.classification);
  return classes.length > 0 && classes.every((value) => value === "MECHANICAL")
    ? "DELTA_REVERIFY"
    : "FULL_REVERIFY";
}

export function applyVerifiedHandoff(
  current: MultiAgentUnitState,
  handoff: AgentHandoff,
  nextState: MultiAgentState,
): MultiAgentUnitState {
  if (handoff.unitId !== current.unitId) {
    throw new ControlPlaneTransitionError("handoff unit_id does not match canonical unit");
  }
  if (handoff.inputState !== current.state) {
    throw new ControlPlaneTransitionError("stale handoff input_state");
  }
  if (handoff.observedBaseSha !== current.baseSha) {
    throw new ControlPlaneTransitionError("handoff base SHA does not match canonical base");
  }
  if (current.candidateSha && handoff.observedCandidateSha !== current.candidateSha) {
    throw new ControlPlaneTransitionError("handoff candidate SHA does not match canonical candidate");
  }
  if (handoff.unitDefinitionHash && handoff.unitDefinitionHash !== current.unitDefinitionHash) {
    throw new ControlPlaneTransitionError(
      "handoff unit definition hash does not match canonical unit definition",
    );
  }
  if (
    current.proofContractHash &&
    handoff.proofContractHash &&
    handoff.proofContractHash !== current.proofContractHash
  ) {
    throw new ControlPlaneTransitionError(
      "handoff proof contract hash does not match canonical proof contract",
    );
  }
  if (handoff.role === "VERIFIER" && handoff.result === "PASS" && handoff.verifierIndependent !== true) {
    throw new ControlPlaneTransitionError("verifier PASS requires independent verifier identity");
  }

  assertTransition(current.state, nextState);
  return {
    ...current,
    state: nextState,
    revision: current.revision + 1,
    updatedAt: handoff.finishedAt,
  };
}
