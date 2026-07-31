import { RegistryReference } from "../types";

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export interface ArtifactValidator {
  validateSchema(artifact: unknown, schemaRef: RegistryReference): Promise<ValidationResult>;
  validateReferences(artifact: unknown): Promise<ValidationResult>;
}

export class DefaultArtifactValidator implements ArtifactValidator {
  async validateSchema(): Promise<ValidationResult> {
    return { valid: true, errors: [] };
  }

  async validateReferences(): Promise<ValidationResult> {
    return { valid: true, errors: [] };
  }
}
