import { ArtifactReference } from "@miljobeslut/mps-compliance/src/artifacts/ArtifactContract";
import { sha256CanonicalJson } from "@miljobeslut/mps-compliance/src/canonical/sha256Canonical";
import { LUProjectContextArtifact, LUProjectContextPayload } from "../artifacts/LUProjectContextArtifact";

/**
 * UI Input Contract for creating a LU Project Context.
 * Note: The UI sends this request to the LU Application.
 * It is NOT an artifact, it is a request object.
 */
export interface LUProjectContextCreateRequest {
  readonly project_name: string;
  readonly description: string;
  readonly planned_activity?: string;
  readonly activity_category?: string;
  
  /** 
   * The UI must have verified the property geometry and obtained a reference 
   * to the canonical PropertyRef artifact. 
   */
  readonly property_refs: readonly ArtifactReference[];
  
  readonly created_by: string;
}

/**
 * Submitter interface for sending artifacts to the Frozen Core.
 * Allows decoupling from concrete storage implementations.
 */
export interface FrozenCoreSubmitter {
  put<T>(artifact: T): Promise<any>;
}

/**
 * Service to handle the creation and submission of LU Project Contexts.
 */
export class LUProjectContextService {
  constructor(private readonly submitter: FrozenCoreSubmitter) {}

  /**
   * Takes a LUProjectContextCreateRequest, binds it to a release hash,
   * creates the LUProjectContextArtifact with a SHA-256 hash, and submits it to the Frozen Core.
   */
  public async createProjectContext(
    request: LUProjectContextCreateRequest,
    releaseHash: string
  ): Promise<LUProjectContextArtifact> {
    const payload: LUProjectContextPayload = {
      project_name: request.project_name,
      description: request.description,
      planned_activity: request.planned_activity,
      activity_category: request.activity_category,
      property_refs: request.property_refs,
      created_by: request.created_by,
    };

    const releaseRef: ArtifactReference = {
      artifact_id: releaseHash,
      artifact_type: "RELEASE_HASH",
    };

    const artifactId = `art_ctx_${crypto.randomUUID()}`;
    const contentHashValue = this.computeSha256(payload);

    const artifact: LUProjectContextArtifact = {
      artifact_id: artifactId,
      artifact_type: "LU_PROJECT_CONTEXT",
      content_hash: {
        algorithm: "sha256",
        value: contentHashValue,
      },
      references: [releaseRef, ...request.property_refs],
      payload,
    };

    // Submit the artifact to the Frozen Core
    await this.submitter.put(artifact);

    return artifact;
  }

  /**
   * Canonical artifact identity: RFC 8785 → SHA-256 (Frozen Core enforcement boundary).
   */
  private computeSha256(payload: LUProjectContextPayload): string {
    return sha256CanonicalJson(payload);
  }
}
