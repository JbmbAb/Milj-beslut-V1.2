import { RuleRegistrySnapshot } from './RuleRegistrySnapshot';
import { ArtifactType } from '../artifacts/ArtifactType';
import { ValidationRule } from './ValidationRule';

/**
 * The only component that can mutate rules.
 * Yields an immutable snapshot when freeze() is called.
 */
export interface RuleRegistryBuilder {
  registerValidator(type: ArtifactType, rule: ValidationRule): void;
  
  /**
   * Freezes the registry into an immutable snapshot, preventing further mutation.
   */
  freeze(version: string): RuleRegistrySnapshot;
}
