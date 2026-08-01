import type { ExecutionReport } from "@miljobeslut/mps-runtime";
import { RuntimeViolation } from "@miljobeslut/mps-core";

export class AuditPreValidator {
  validate(report: ExecutionReport): void {
    if (!report.runtime_id) {
      throw new RuntimeViolation("AUDIT_INVALID_REPORT", "Missing runtime_id in ExecutionReport");
    }

    if (!report.registry_snapshot_id) {
      throw new RuntimeViolation("AUDIT_INVALID_REPORT", "Missing registry_snapshot_id in ExecutionReport");
    }

    if (!report.registry_hash) {
      throw new RuntimeViolation("AUDIT_INVALID_REPORT", "Missing registry_hash in ExecutionReport");
    }

    if (!report.completed) {
      throw new RuntimeViolation("AUDIT_REPLAY_INCOMPLETE", "Replay did not complete successfully");
    }

    for (const stage of report.stages) {
      if (!stage.artifact_id) {
        throw new RuntimeViolation(
          "AUDIT_MISSING_ARTIFACT_ID",
          "StageOutput missing artifact_id",
          stage.reference
        );
      }

      if (!stage.verified ||
          !stage.verified.signature_valid ||
          !stage.verified.trusted) {
        throw new RuntimeViolation(
          "AUDIT_UNVERIFIED_ARTIFACT",
          "StageOutput contains unverified artifact",
          stage.reference
        );
      }
    }
  }
}
