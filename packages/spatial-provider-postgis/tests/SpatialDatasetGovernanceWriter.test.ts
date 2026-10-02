/**
 * master-boundary-audit (U30F2): SpatialDatasetRetention no longer writes CAS itself; its retention record and
 * claims go through SpatialProviderPostGIS.putSpatialDatasetGovernanceArtifact, the package's authorized CAS
 * writer. The writer is narrow: only the three dataset-governance artifact types, and only a body whose
 * content_hash is the canonical hash of its own payload, written under its own artifact_id.
 */
import { describe, expect, it } from "vitest";
import { sha256ContentHash } from "../../mps-compliance/src/canonical/sha256Canonical";
import {
  REJECT_SPATIAL_GOVERNANCE_ARTIFACT_INVALID,
  SPATIAL_DATASET_GOVERNANCE_ARTIFACT_TYPES,
  putSpatialDatasetGovernanceArtifact,
} from "../src/SpatialProviderPostGIS";
import {
  SPATIAL_DATASET_RETAINED_RELATION_CLAIM,
  SPATIAL_DATASET_RETENTION_RECORD,
  SPATIAL_DATASET_TARGET_RETENTION_CLAIM,
} from "../src/SpatialDatasetRetention";

function recordingRepo() {
  const written: { artifact_id: string; content_hash: unknown; body: unknown }[] = [];
  return {
    written,
    repo: {
      put: async (artifact: { artifact_id: string; content_hash: unknown; body: unknown }) => {
        written.push(artifact);
      },
      resolve: async () => {
        throw new Error("not used");
      },
    },
  };
}

const payload = { contract_version: "x", target: { schema: "env", table: "sgu_well" } };

describe("putSpatialDatasetGovernanceArtifact (the package's one dataset-governance CAS writer)", () => {
  it("names exactly the three artifact types SpatialDatasetRetention persists", () => {
    expect([...SPATIAL_DATASET_GOVERNANCE_ARTIFACT_TYPES].sort()).toEqual(
      [SPATIAL_DATASET_RETENTION_RECORD, SPATIAL_DATASET_RETAINED_RELATION_CLAIM, SPATIAL_DATASET_TARGET_RETENTION_CLAIM].sort(),
    );
  });

  it.each(SPATIAL_DATASET_GOVERNANCE_ARTIFACT_TYPES)("writes a %s under its own id with its own hash", async (type) => {
    const { repo, written } = recordingRepo();
    const body = { artifact_id: `spatial-${type.toLowerCase()}-1`, artifact_type: type, content_hash: sha256ContentHash(payload), payload };
    await putSpatialDatasetGovernanceArtifact(repo, body);
    expect(written).toEqual([{ artifact_id: body.artifact_id, content_hash: body.content_hash, body }]);
  });

  it("refuses any other artifact type, before anything is written", async () => {
    const { repo, written } = recordingRepo();
    const body = { artifact_id: "spatial-evidence-1", artifact_type: "SPATIAL_EVIDENCE", content_hash: sha256ContentHash(payload), payload };
    await expect(putSpatialDatasetGovernanceArtifact(repo, body)).rejects.toThrow(REJECT_SPATIAL_GOVERNANCE_ARTIFACT_INVALID);
    expect(written).toEqual([]);
  });

  it("refuses a body whose content_hash is not the hash of its payload (no relabelling), before anything is written", async () => {
    const { repo, written } = recordingRepo();
    const body = {
      artifact_id: "spatial-dataset-retention-1",
      artifact_type: SPATIAL_DATASET_RETENTION_RECORD,
      content_hash: sha256ContentHash({ other: true }),
      payload,
    };
    await expect(putSpatialDatasetGovernanceArtifact(repo, body)).rejects.toThrow(/content_hash is not the hash of its payload/);
    expect(written).toEqual([]);
  });
});
