import type { ActorReference, ContentReference, Timestamp } from "../../mps-core/src/types";
import type { DatasetApprovalAuthority } from "./DatasetApprovalAuthority";

export interface AuthenticatedGovernanceReviewer {
  readonly actor_ref: ActorReference;
}

export interface DatasetApprovalCommand {
  readonly manifest_ref: ContentReference;
  readonly decision: "APPROVED" | "REJECTED";
  readonly reason: string;
  readonly decision_at: Timestamp;
  /** Required only for an approval: issuing one is never an accidental read action. */
  readonly confirm_approval?: true;
}

/**
 * Narrow operational controller. The caller supplies a decision about a manifest; the reviewer
 * identity is derived from authenticated governance context and signing/identity are never inputs.
 */
export class DatasetApprovalController {
  constructor(
    private readonly authority: DatasetApprovalAuthority,
    private readonly reviewer: AuthenticatedGovernanceReviewer,
  ) {}

  async decide(command: DatasetApprovalCommand) {
    if (command.decision === "APPROVED" && command.confirm_approval !== true) {
      throw new Error("REJECT_DATASET_APPROVAL_EXPLICIT_CONFIRMATION_REQUIRED");
    }
    return this.authority.decide({
      manifest_ref: command.manifest_ref,
      decision: command.decision,
      actor_ref: this.reviewer.actor_ref,
      decision_at: command.decision_at,
      reason: command.reason,
    });
  }
}
