import { ArtifactContract } from "@miljobeslut/mps-compliance/src/artifacts/ArtifactContract";

export interface RawSourcePayload {
  readonly filename: string;
  readonly original_path: string;
  readonly content_bytes_base64: string;
  readonly observed_at: string;
  readonly authority: string;
  readonly policy: string;
}

export interface RawSourceArtifact extends ArtifactContract {
  readonly artifact_type: "RAW_SOURCE_ARTIFACT";
  readonly payload: RawSourcePayload;
}
