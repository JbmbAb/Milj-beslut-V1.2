import type { AgentHandoff, MultiAgentRole, MultiAgentState } from "./types";
import { classifyVerifierFailure } from "./StateMachine";

export interface RouteDecision {
  readonly targetRole: MultiAgentRole | "DEV_GOV" | "NONE";
  readonly nextState: MultiAgentState;
  readonly verificationMode?: "FULL_REVERIFY" | "DELTA_REVERIFY";
  readonly reason: string;
}

export function routeAfterHandoff(handoff: AgentHandoff): RouteDecision {
  if (handoff.result === "BLOCKED_ENVIRONMENT") {
    return {
      targetRole: "NONE",
      nextState: "BLOCKED_ENVIRONMENT",
      reason: "environment failure requires recovery without semantic edits",
    };
  }
  if (handoff.result === "BLOCKED_DESIGN") {
    return {
      targetRole: "CONTROLLER",
      nextState: "BLOCKED_DESIGN",
      reason: "design blocker requires controller/owner decision",
    };
  }
  if (handoff.result === "BLOCKED_DEPENDENCY") {
    return {
      targetRole: "NONE",
      nextState: "BLOCKED_DEPENDENCY",
      reason: "dependency blocker must clear before routing continues",
    };
  }
  if (handoff.result === "DENIED_GOVERNANCE") {
    return {
      targetRole: "CONTROLLER",
      nextState: "BLOCKED_DESIGN",
      reason: "governance denial cannot be repaired as a mechanical edit",
    };
  }
  if (handoff.result === "CANCELLED") {
    return { targetRole: "NONE", nextState: "CANCELLED", reason: "unit cancelled" };
  }

  if (handoff.role === "IMPLEMENTER" && handoff.result === "PASS") {
    return {
      targetRole: "VERIFIER",
      nextState: "IMPLEMENTATION_READY",
      reason: "candidate ready for independent verification",
    };
  }

  if (handoff.role === "VERIFIER" && handoff.result === "PASS") {
    return {
      targetRole: "DEV_GOV",
      nextState: "READY_FOR_DEV_GOV",
      reason: "independent verifier accepted exact candidate",
    };
  }

  if (handoff.role === "VERIFIER" && handoff.result === "FAIL") {
    const mode = classifyVerifierFailure(handoff);
    return {
      targetRole: "IMPLEMENTER",
      nextState: "VERIFY_FAILED",
      verificationMode: mode,
      reason:
        mode === "DELTA_REVERIFY"
          ? "mechanical-only verifier failure returns for focused correction"
          : "semantic or mixed verifier failure reopens full implementation verification",
    };
  }

  return {
    targetRole: "CONTROLLER",
    nextState: handoff.inputState,
    reason: `no automatic route for ${handoff.role}/${handoff.result}`,
  };
}
