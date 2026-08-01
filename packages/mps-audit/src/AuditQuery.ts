import type { AuditArtifact, AuditChainIndex } from "./AuditTypes";
import type { AuditStore } from "./AuditStore";

export class AuditQuery {
  constructor(private readonly store: AuditStore) {}

  async getAuditArtifact(audit_id: string): Promise<AuditArtifact | null> {
    return this.store.get(audit_id);
  }

  async getChainIndex(): Promise<AuditChainIndex> {
    return this.store.getChainIndex();
  }

  async getExecutionHistoryByRuntimeId(runtime_id: string): Promise<AuditArtifact[]> {
    const index = await this.store.getChainIndex();
    const artifacts: AuditArtifact[] = [];

    for (let i = 1; i <= index.length; i++) {
      const audit_id = `audit-${i.toString().padStart(8, "0")}`;
      const artifact = await this.store.get(audit_id);

      if (artifact && artifact.record.runtime_id === runtime_id) {
        artifacts.push(artifact);
      }
    }

    return artifacts;
  }
}
