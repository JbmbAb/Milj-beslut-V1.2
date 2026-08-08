/**
 * Identity of the immutable source document (bytes / archive object).
 * TextProjection never replaces this as truth.
 */
export interface SourceArtifactRef {
  readonly artifact_id: string;
  readonly artifact_type?: string;
}

export interface SourceArtifact {
  readonly ref: SourceArtifactRef;
  /** Optional content hash of original bytes (when known). */
  readonly bytes_content_hash?: {
    readonly algorithm: "sha256";
    readonly value: string;
  };
  readonly mime_type?: string;
  readonly doc_name: string;
  readonly source_system?: string;
  /** Hint for evidence section detectors (decision, mkb, …). */
  readonly evidence_doc_type?: string;
}
