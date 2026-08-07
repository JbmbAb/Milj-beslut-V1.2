import { ArtifactContract, ArtifactReference } from "./ArtifactContract";

/**
 * 🜃 EvidenceArtifact (C-01)
 * 
 * En formell, omutlig bevis-post som knyter en specifik CI-kontroll (Control)
 * till dess faktiska verifieringsunderlag (Artifact), körningskoordinater
 * och källkodsversion.
 */
export interface EvidenceArtifact extends ArtifactContract {
  readonly artifact_type: "EVIDENCE_ARTIFACT";
  readonly payload: {
    readonly control_id: string;              // t.ex. "ART-001" (Canonical Serialization)
    readonly result: "PASS" | "FAIL";
    readonly commit_hash: string;             // <commit>
    readonly build_id: string;                // <build>
    readonly execution_id: string;            // <run>
    readonly timestamp: string;               // <timestamp>
    readonly artifact_ref: ArtifactReference; // Referens till den faktiska testrapporten (t.ex. 'ci://reports/art-001.json')
  };
}
