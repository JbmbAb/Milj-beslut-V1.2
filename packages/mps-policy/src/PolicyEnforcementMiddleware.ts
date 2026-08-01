import type { PolicyInput, PolicyDecisionArtifact, PolicyApprovalStore } from "./PolicyTypes";
import type { PolicyDecisionEngine } from "./PolicyEngine";
import { RuntimeViolation } from "@miljobeslut/mps-core";

export class PolicyEnforcementMiddleware {
  constructor(
    private readonly engine: PolicyDecisionEngine,
    private readonly approvalStore: PolicyApprovalStore,
  ) {}

  async enforce(input: PolicyInput): Promise<PolicyDecisionArtifact> {
    const decision = await this.engine.evaluate(input);

    switch (decision.decision) {
      case "ALLOW":
        return decision;

      case "BLOCK":
        throw new RuntimeViolation(
          "POLICY_BLOCKED",
          decision.reason,
          input.reference
        );

      case "REVIEW": {
        const approval =
          await this.approvalStore.getByDecisionId(decision.decision_id);

        if (!approval || approval.state === "PENDING") {
          throw new RuntimeViolation(
            "POLICY_REVIEW_REQUIRED",
            decision.reason,
            input.reference
          );
        }

        if (approval.state === "REJECTED") {
          throw new RuntimeViolation(
            "POLICY_REVIEW_REJECTED",
            decision.reason,
            input.reference
          );
        }

        // APPROVED → fortsätt
        return decision;
      }
    }
  }
}
