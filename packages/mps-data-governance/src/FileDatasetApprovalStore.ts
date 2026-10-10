import { closeSync, existsSync, linkSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import type { ArtifactReference } from "../../mps-core/src/types";
import type { DatasetApprovalArtifact } from "./DatasetApprovalArtifact";
import type { DatasetApprovalStore } from "./DatasetApprovalAuthority";

/** Durable, collision-safe writer for the exact directory FileCheckpointStore verifies. */
export class FileDatasetApprovalStore implements DatasetApprovalStore {
  private readonly approvalsDir: string;

  constructor(masterArchiveRoot: string) {
    this.approvalsDir = join(masterArchiveRoot, "National_Archive", "_quarantine", "approvals");
  }

  async put(artifact: DatasetApprovalArtifact): Promise<ArtifactReference> {
    if (!/^[A-Za-z0-9._-]+$/.test(artifact.artifact_id)) {
      throw new Error("REJECT_DATASET_APPROVAL_ARTIFACT_ID_PATH_UNSAFE");
    }
    mkdirSync(this.approvalsDir, { recursive: true });
    const target = join(this.approvalsDir, `${artifact.artifact_id}.json`);
    const bytes = JSON.stringify(artifact, null, 2) + "\n";
    if (existsSync(target)) {
      if (readFileSync(target, "utf8") !== bytes) throw new Error("REJECT_DATASET_APPROVAL_COLLISION");
      return referenceOf(artifact);
    }
    const temp = join(dirname(target), `.${artifact.artifact_id}.${randomUUID()}.tmp`);
    try {
      const fd = openSync(temp, "wx");
      try { writeFileSync(fd, bytes, "utf8"); } finally { closeSync(fd); }
      // link() publishes only when target does not exist. Unlike rename(), it never replaces
      // a concurrently-created target; an existing identical artifact is idempotent.
      try {
        linkSync(temp, target);
      } catch (error: any) {
        if (error?.code !== "EEXIST") throw error;
        if (readFileSync(target, "utf8") !== bytes) throw new Error("REJECT_DATASET_APPROVAL_COLLISION");
      }
    } finally {
      try { if (existsSync(temp)) unlinkSync(temp); } catch {}
    }
    return referenceOf(artifact);
  }
}

function referenceOf(artifact: DatasetApprovalArtifact): ArtifactReference {
  return { artifact_id: artifact.artifact_id, artifact_type: artifact.artifact_type, content_hash: artifact.content_hash };
}
