// packages/mps-data-governance/src/HarvestExecutionStateMachine.ts

import type { HarvestExecutionState } from "./HarvestOrchestratorTypes";

/**
 * Pure state validation.
 * No IO, no artifact logic, no runtime logic.
 */
export class HarvestExecutionStateMachine {
  private static readonly terminalStates: ReadonlySet<HarvestExecutionState> = new Set([
    "QUARANTINED",
    "ARCHIVED",
    "BLOCKED",
    "READY_FOR_LU",
  ]);

  private static readonly allowedTransitions: Record<HarvestExecutionState, HarvestExecutionState[]> = {
    CREATED: ["HARVESTING"],
    HARVESTING: ["HARVESTED"],
    HARVESTED: ["VERIFYING"],
    VERIFYING: ["VERIFIED", "QUARANTINED"],
    QUARANTINED: [],

    VERIFIED: ["AWAITING_APPROVAL"],
    AWAITING_APPROVAL: ["APPROVED", "ARCHIVED"],
    APPROVED: ["COMPLIANCE_CHECK"],
    ARCHIVED: [],

    COMPLIANCE_CHECK: ["BLOCKED", "IMPORT_GATE"],
    BLOCKED: [],

    IMPORT_GATE: ["ALLOW_IMPORT", "BLOCKED"],
    ALLOW_IMPORT: ["POSTGIS_PROJECTION"],
    POSTGIS_PROJECTION: ["READY_FOR_LU"],
    READY_FOR_LU: [],
  };

  static canTransition(from: HarvestExecutionState, to: HarvestExecutionState): boolean {
    return this.allowedTransitions[from]?.includes(to) ?? false;
  }

  static assertTransition(from: HarvestExecutionState, to: HarvestExecutionState): void {
    if (this.terminalStates.has(from)) {
      throw new Error(`Illegal transition: '${from}' is terminal and cannot transition to '${to}'.`);
    }
    if (!this.canTransition(from, to)) {
      throw new Error(`Illegal transition: '${from}' → '${to}' is not permitted.`);
    }
  }

  static isTerminal(state: HarvestExecutionState): boolean {
    return this.terminalStates.has(state);
  }
}
