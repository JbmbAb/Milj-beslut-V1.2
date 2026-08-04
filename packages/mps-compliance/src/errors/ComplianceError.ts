/**
 * Canonical compliance error.
 *
 * Used to signal violations of Package-24 implementation invariants.
 */
export class ComplianceError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "ComplianceError";
  }
}
