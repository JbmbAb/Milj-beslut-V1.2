// packages/mps-data-governance/src/HarvestExecutionStateMachine.ts

import type { HarvestExecutionState } from "./HarvestOrchestratorTypes";

/**
 * HarvestExecutionStateMachine
 *
 * Denna komponent äger och styr:
 *  - godkända tillståndsövergångar (allowed transitions)
 *  - terminala tillstånd (terminal states)
 *  - ogiltiga tillståndshopp (illegal transitions)
 *  - invariant efterlevnad (invariant enforcement)
 *
 * Innehåller INGEN runtime-logik, INGEN artefakt-logik, INGEN I/O.
 * Enbart ren tillståndsvalidering (Replay-säker).
 */
export class HarvestExecutionStateMachine {
  /**
   * Terminala tillstånd — när de har nåtts kan exekveringen INTE fortsätta.
   */
  private static readonly terminalStates: ReadonlySet<HarvestExecutionState> = new Set([
    "QUARANTINED",
    "ARCHIVED",
    "BLOCKED",
    "READY_FOR_LU",
  ]);

  /**
   * Godkända övergångar — plattformens auktoritativa tillstånds-graf.
   */
  private static readonly allowedTransitions: Record<HarvestExecutionState, readonly HarvestExecutionState[]> = {
    CREATED: ["HARVESTING", "QUARANTINED"],
    HARVESTING: ["HARVESTED", "QUARANTINED"],
    HARVESTED: ["VERIFYING", "QUARANTINED"],
    VERIFYING: ["VERIFIED", "QUARANTINED"],
    QUARANTINED: [],

    VERIFIED: ["AWAITING_APPROVAL", "APPROVED", "ARCHIVED"],
    AWAITING_APPROVAL: ["APPROVED", "ARCHIVED"],
    APPROVED: ["COMPLIANCE_CHECK", "BLOCKED"],
    ARCHIVED: [],

    COMPLIANCE_CHECK: ["BLOCKED", "IMPORT_GATE"],
    BLOCKED: [],

    IMPORT_GATE: ["ALLOW_IMPORT", "BLOCKED"],
    ALLOW_IMPORT: ["POSTGIS_PROJECTION", "BLOCKED"],
    POSTGIS_PROJECTION: ["READY_FOR_LU", "BLOCKED"],
    READY_FOR_LU: [],
  };

  /**
   * Returnerar sant om en övergång är tillåten.
   */
  static canTransition(from: HarvestExecutionState, to: HarvestExecutionState): boolean {
    const allowed = this.allowedTransitions[from] ?? [];
    return allowed.includes(to);
  }

  /**
   * Kastar ett deterministiskt fel om tillståndsövergången är ogiltig.
   */
  static assertTransition(from: HarvestExecutionState, to: HarvestExecutionState): void {
    // Terminala tillstånd tillåter inga vidare övergångar
    if (this.terminalStates.has(from)) {
      throw new Error(
        `[ORCH Violation] Illegal transition: state '${from}' is terminal and cannot transition to '${to}'.`
      );
    }

    // Kontrollera om övergången finns i tillstånds-grafen
    if (!this.canTransition(from, to)) {
      throw new Error(
        `[ORCH Violation] Illegal transition: '${from}' → '${to}' is not permitted by the HarvestExecutionStateMachine.`
      );
    }
  }

  /**
   * Returnerar sant om tillståndet är terminalt.
   */
  static isTerminal(state: HarvestExecutionState): boolean {
    return this.terminalStates.has(state);
  }
}
