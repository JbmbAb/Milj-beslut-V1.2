import type { ExecutionReport } from "@miljobeslut/mps-runtime";
import type { AuditRecord, AuditArtifact, AuditReference } from "./AuditTypes";
import type { AuditStore } from "./AuditStore";
import type { CanonicalAuditSerializer } from "./CanonicalAuditSerializer";
import type { HashEngine } from "./HashEngine";
import { AuditPreValidator } from "./AuditPreValidator";

export class AuditEngine {
  constructor(
    private readonly store: AuditStore,
    private readonly serializer: CanonicalAuditSerializer,
    private readonly hashEngine: HashEngine,
    private readonly preValidator: AuditPreValidator,
  ) {}

  private buildRecord(
    report: ExecutionReport,
    audit_id: string,
    sequence: number,
    parent: AuditRecord["parent"] | undefined
  ): AuditRecord {
    return {
      schema_version: "audit.v1",

      audit_id,
      sequence,
      audit_hash: "",

      parent,

      runtime_id: report.runtime_id,
      registry_snapshot_id: report.registry_snapshot_id,
      registry_hash: report.registry_hash,

      started_at: report.started_at,
      finished_at: report.finished_at,

      stages: report.stages,
      replay: report.replay,
      completed: report.completed,
    };
  }

  async recordExecution(report: ExecutionReport): Promise<AuditReference> {
    this.preValidator.validate(report);

    // sequence + parent bestäms atomiskt i store.append
    const provisionalId = "audit-provisional";

    const baseRecord = this.buildRecord(report, provisionalId, 0, undefined);
    const canonicalBytes = this.serializer.serialize(baseRecord);
    const hash = this.hashEngine.hash(canonicalBytes);

    const artifact: AuditArtifact = {
      record: { ...baseRecord, audit_hash: hash },
      hash,
    };

    return this.store.append(artifact);
  }
}
