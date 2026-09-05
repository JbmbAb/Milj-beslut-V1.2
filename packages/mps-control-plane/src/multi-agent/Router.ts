import type { AgentHandoff, MultiAgentRole, MultiAgentState } from "./types";
import { classifyVerifierFailure } from "./StateMachine";

export interface RouteDecision {
  readonly targetRole: MultiAgentRole | "DEV_GOV" | "NONE";
  readonly acceptedState: MultiAgentState;
  readonly activationState?: MultiAgentState;
  readonly verificationMode?: "FULL_REVERIFY" | "DELTA_REVERIFY";
  readonly reason: string;
}

export function routeAfterHandoff(handoff: AgentHandoff): RouteDecision {
  if (handoff.result === "BLOCKED_ENVIRONMENT") {
    return {
      targetRole: "NONE",
      acceptedState: "BLOCKED_ENVIRONMENT",
      reason: "environment failure requires recovery without semantic edits",
    };
  }
  if (handoff.result === "BLOCKED_DESIGN") {
    return {
      targetRole: "CONTROLLER",
      acceptedState: "BLOCKED_DESIGN",
      reason: "design blocker requires controller/owner decision",
    };
  }
  if (handoff.result === "BLOCKED_DEPENDENCY") {
    return {
      targetRole: "NONE",
      acceptedState: "BLOCKED_DEPENDENCY",
      reason: "dependency blocker must clear before routing continues",
    };
  }
  if (handoff.result === "DENIED_GOVERNANCE") {
    return {
      targetRole: "CONTROLLER",
      acceptedState: "BLOCKED_DESIGN",
      reason: "governance denial cannot be repaired as a mechanical edit",
    };
  }
  if (handoff.result === "CANCELLED") {
    return { targetRole: "NONE", acceptedState: "CANCELLED", reason: "unit cancelled" };
  }

  if (handoff.role === "IMPLEMENTER" && handoff.result === "PASS") {
    return {
      targetRole: "VERIFIER",
      acceptedState: "IMPLEMENTATION_READY",
      activationState: "VERIFYING",
      reason: "candidate ready for independent verification",
    };
  }

  if (handoff.role === "VERIFIER" && handoff.result === "PASS") {
    return {
      targetRole: "DEV_GOV",
      acceptedState: "READY_FOR_DEV_GOV",
      activationState: "PROVING_RED",
      reason: "independent verifier accepted exact candidate",
    };
  }

  if (handoff.role === "VERIFIER" && handoff.result === "FAIL") {
    const mode = classifyVerifierFailure(handoff);
    return {
      targetRole: "IMPLEMENTER",
      acceptedState: "VERIFY_FAILED",
      activationState: "IMPLEMENTING",
      verificationMode: mode,
      reason:
        mode === "DELTA_REVERIFY"
          ? "mechanical-only verifier failure returns for focused correction"
          : "semantic or mixed verifier failure reopens full implementation verification",
    };
  }

  return {
    targetRole: "CONTROLLER",
    acceptedState: handoff.inputState,
    reason: `no automatic route for ${handoff.role}/${handoff.result}`,
  };
}
