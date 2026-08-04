import { RuleRegistrySnapshot, ValidatorFunction } from './RuleRegistrySnapshot';
import { ArtifactType } from '../artifacts/ArtifactType';

/**
 * The only component that can mutate rules.
 * Yields an immutable snapshot when freeze() is called.
 */
export interface RuleRegistryBuilder {
  registerValidator(type: ArtifactType, validator: ValidatorFunction): void;
  
  /**
   * Freezes the registry into an immutable snapshot, preventing further mutation.
   */
  freeze(version: string): RuleRegistrySnapshot;
}
