// packages/mps-data-governance/src/FileCheckpointStore.ts

import * as fs from 'fs';
import * as path from 'path';
import type { HarvestCheckpointStore } from "./HarvestCheckpointStore";
import type { HarvestExecutionCheckpoint } from "./HarvestOrchestratorTypes";
import type { DatasetApprovalArtifact } from "./DatasetApprovalArtifact";
import type {
  ArtifactReference,
  CanonicalArtifactSerializer,
  CanonicalHashEngine,
  SignatureVerifier,
} from "../../mps-core/src/types";
import { HashVerificationViolation, SignatureVerificationViolation } from "../../mps-core/src/errors";

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

  constructor(
    masterArchiveRoot: string,
    private readonly serializer: CanonicalArtifactSerializer,
    private readonly hashEngine: CanonicalHashEngine,
    private readonly signatureVerifier: SignatureVerifier,
  ) {
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
    if (!fs.existsSync(approvalPath)) {
      throw new Error(`[L1-11] DatasetApprovalArtifact '${approval_ref.artifact_id}' hittades inte i Quarantine/Approvals.`);
    }

    const data = fs.readFileSync(approvalPath, 'utf8');
    const artifact = JSON.parse(data) as DatasetApprovalArtifact & Record<string, unknown>;

    /**
     * A file that merely parses as JSON is not an authenticated artifact.
     * Mirrors ContentAddressedArtifactStore.get() in mps-core: recompute the
     * content hash from the envelope (excluding content_hash/signature/
     * artifact_id), require it to match the reference the caller resolved
     * this by, then require a valid signature over that hash.
     *
     * Without this, anything with filesystem write access to
     * _quarantine/approvals/ could hand-author a "DatasetApprovalArtifact"
     * with any decision and any actor_ref.role (including a self-declared
     * "GOVERNANCE_REVIEWER") and ImportGate's role check (see ImportGate.ts)
     * would trust it, because that check only inspects the field's value —
     * it does not establish where the artifact came from. This is that check.
     *
     * This proves the artifact was not altered after signing and that some
     * key accepted by the injected SignatureVerifier produced the signature.
     * It does NOT by itself prove that key belongs to an authorized reviewer
     * — that trust-anchor/key-registry question is the SignatureVerifier
     * implementation's responsibility, injected at construction, not this
     * method's.
     */
    // MpsError's optional artifact_ref is typed as ContentReference (`id` +
    // `content_hash`), not ArtifactReference (`artifact_id` + `artifact_type`
    // + `content_hash`) — they are different shapes in mps-core/src/types.ts.
    // Build the narrower reference so the error carries a resolvable pointer
    // without misrepresenting its type.
    const errorRef = { id: approval_ref.artifact_id, content_hash: approval_ref.content_hash };

    const { content_hash: _declaredHash, signature, artifact_id: _artifactId, ...envelope } = artifact;
    const envelopeBytes = this.serializer.serialize(envelope);
    const computedHash = this.hashEngine.hash(envelopeBytes);

    if (
      computedHash.algorithm !== approval_ref.content_hash.algorithm ||
      computedHash.digest !== approval_ref.content_hash.digest
    ) {
      throw new HashVerificationViolation(
        "APPROVAL_HASH_MISMATCH",
        `DatasetApprovalArtifact '${approval_ref.artifact_id}' content does not match the expected content_hash — file may be corrupted or manually edited.`,
        errorRef,
      );
    }

    if (!signature) {
      throw new SignatureVerificationViolation(
        "APPROVAL_SIGNATURE_MISSING",
        `DatasetApprovalArtifact '${approval_ref.artifact_id}' has no signature — cannot establish authenticity.`,
        errorRef,
      );
    }

    const signatureOk = await this.signatureVerifier.verify(computedHash, signature);
    if (!signatureOk) {
      throw new SignatureVerificationViolation(
        "APPROVAL_SIGNATURE_INVALID",
        `DatasetApprovalArtifact '${approval_ref.artifact_id}' signature does not verify — approval may be forged or tampered with.`,
        errorRef,
      );
    }

    return artifact;
  }
}
