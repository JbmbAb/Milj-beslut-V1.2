// packages/mps-data-governance/src/FileCheckpointStore.ts

import * as fs from 'fs';
import * as path from 'path';
import type { HarvestCheckpointStore } from "./HarvestCheckpointStore";
import type { HarvestExecutionCheckpoint } from "./HarvestOrchestratorTypes";
import type { DatasetApprovalArtifact } from "./DatasetApprovalArtifact";
import type { ArtifactReference } from "../../mps-core/src/types";

/**
 * En fysisk, fil-baserad lagring av checkpoints under master-arkivets karantänslager.
 * 
 * Tillgodoser:
 *   - L1-11 Quarantine Storage Semantics: Sparar råobservationer och checkpoints
 *     i ett separat karantänlager (utanför CAS) vid misslyckad verifiering eller transition.
 *   - ORCH-007 Quarantine Persistence: Garanterar att felaktiga eller avbrutna 
 *     pipeline-tillstånd sparas fysiskt på disk så att exekveringsvägen stannar och kan granskas.
 */
export class FileCheckpointStore implements HarvestCheckpointStore {
  private readonly quarantineDir: string;
  private readonly checkpointsDir: string;

  constructor(masterArchiveRoot: string) {
    this.quarantineDir = path.join(masterArchiveRoot, 'National_Archive', '_quarantine');
    this.checkpointsDir = path.join(this.quarantineDir, 'checkpoints');
    
    // Skapa fysiska kataloger för karantänslagret på disk (L1-11)
    fs.mkdirSync(this.quarantineDir, { recursive: true });
    fs.mkdirSync(this.checkpointsDir, { recursive: true });
  }

  async load(execution_id: string): Promise<HarvestExecutionCheckpoint | null> {
    const filePath = path.join(this.checkpointsDir, `${execution_id}.json`);
    if (!fs.existsSync(filePath)) {
      return null;
    }
    const data = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(data);
  }

  async save(execution_id: string, checkpoint: HarvestExecutionCheckpoint): Promise<void> {
    const filePath = path.join(this.checkpointsDir, `${execution_id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(checkpoint, null, 2), 'utf8');

    // L1-11: Vid tillståndet QUARANTINED sparas en formell karantänspost
    // för manuell granskning och auditering. Originaldata bevaras utan radering.
    if (checkpoint.state === "QUARANTINED") {
      const recordPath = path.join(this.quarantineDir, `quarantine_record_${execution_id}.json`);
      const record = {
        // Tas från checkpointens egen updated_at, som kommer från orkestratorns
        // injicerade Clock. En egen new Date() här hade lagt en icke-deterministisk
        // tidsstämpel bredvid en deterministisk i samma post (IMPORT-TIME-001).
        quarantined_at: checkpoint.updated_at,
        execution_id,
        checkpoint,
        retention_policy: "KEEP_30_DAYS_FOR_AUDIT",
        governance_role: "GOVERNANCE_REVIEWER"
      };
      fs.writeFileSync(recordPath, JSON.stringify(record, null, 2), 'utf8');
    }
  }

  async remove(execution_id: string): Promise<void> {
    const filePath = path.join(this.checkpointsDir, `${execution_id}.json`);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }

  async loadApproval(approval_ref: ArtifactReference): Promise<DatasetApprovalArtifact> {
    // För en riktig butik läser vi in godkännandet från arkivets godkända mappar.
    // Vi tillåter laddning från godkända mappar om filen finns, annars kastar vi fel.
    const approvalPath = path.join(this.quarantineDir, 'approvals', `${approval_ref.artifact_id}.json`);
    if (fs.existsSync(approvalPath)) {
      const data = fs.readFileSync(approvalPath, 'utf8');
      return JSON.parse(data);
    }
    throw new Error(`[L1-11] DatasetApprovalArtifact '${approval_ref.artifact_id}' hittades inte i Quarantine/Approvals.`);
  }
}
