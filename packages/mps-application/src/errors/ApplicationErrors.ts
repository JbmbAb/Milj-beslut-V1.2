export class ApplicationGovernanceBoundaryViolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "APPLICATION_GOVERNANCE_BOUNDARY_VIOLATION";
  }
}
