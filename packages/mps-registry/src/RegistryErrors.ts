import { MpsError } from "@miljobeslut/mps-core";
import type { ContentReference } from "@miljobeslut/mps-core";

export class RegistryLoadViolation extends MpsError {
  constructor(
    code: string,
    message: string,
    artifact_ref?: ContentReference,
    cause?: unknown
  ) {
    super(code, message, artifact_ref, cause);
  }
}

export class RegistryVerificationViolation extends MpsError {
  constructor(
    code: string,
    message: string,
    artifact_ref?: ContentReference,
    cause?: unknown
  ) {
    super(code, message, artifact_ref, cause);
  }
}
