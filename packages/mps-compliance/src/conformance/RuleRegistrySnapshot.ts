import { ValidationRule } from "./ValidationRule";

/**
 * Immutable rule registry snapshot.
 *
 * Runtime SHALL only use snapshots, never builders.
 */
export class RuleRegistrySnapshot {
  readonly rules: readonly ValidationRule[];

  constructor(rules: readonly ValidationRule[]) {
    // Defensive copy + deep immutability at array level.
    this.rules = Object.freeze([...rules]);
  }
}
