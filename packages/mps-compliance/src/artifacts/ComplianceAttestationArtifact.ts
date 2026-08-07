import { ArtifactContract, ArtifactReference } from "./ArtifactContract";

/**
 * 🜃 ComplianceAttestationArtifact (C-01)
 * 
 * En sammanställd och signerad attesterings-artefakt som bevisar att
 * en hel arkitekturgräns (t.ex. MPS-CORE eller LU) är fullständigt verifierad
 * genom att referera till dess ingående bevisartefakter.
 */
export interface ComplianceAttestationArtifact extends ArtifactContract {
  readonly artifact_type: "COMPLIANCE_ATTESTATION_ARTIFACT";
  readonly payload: {
    readonly attestation_id: string;          // t.ex. "mps-core-1.0-attestation"
    readonly started_at: string;
    readonly completed_at: string;
    readonly baseline_version: string;         // t.ex. "MPS-CORE-1.0"
    readonly status: "COMPLIANT" | "NON_COMPLIANT";
    readonly evidence_refs: readonly ArtifactReference[]; // Referenser till de ingående EvidenceArtifacts (bevisen)
  };
}
