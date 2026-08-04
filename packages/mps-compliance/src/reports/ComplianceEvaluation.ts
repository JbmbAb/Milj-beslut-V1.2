import { ComplianceReport } from "../conformance/ComplianceReport";

/**
 * Final MCS evaluation output.
 *
 * Deterministic compliance statement.
 */
export interface ComplianceEvaluation {
  readonly matrix_version: string;
  readonly reports: readonly ComplianceReport[];
  readonly compliant: boolean;
}
