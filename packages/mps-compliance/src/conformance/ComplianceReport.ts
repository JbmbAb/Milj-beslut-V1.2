import { ArtifactId } from '../artifacts/ArtifactId';
import { ValidationResult } from './ValidationResult';

/**
 * The final output of the ConformanceEngine.
 */
export interface ComplianceReport {
  readonly target_id: ArtifactId;
  readonly isCompliant: boolean;
  readonly results: ReadonlyArray<ValidationResult>;
  readonly snapshotVersion: string;
}
