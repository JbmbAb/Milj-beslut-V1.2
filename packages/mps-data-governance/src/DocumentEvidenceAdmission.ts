import { verifyArtifactAttestation } from "@miljobeslut/mimers-brunn-core";
import type { ArtifactAttestation, CASRepository, SigningKeyProvider } from "@miljobeslut/mimers-brunn-core";

/**
 * DOCUMENT-EVIDENCE-CANONICAL-ADMISSION-V1 (resumed on the V2 contract).
 *
 * ADR-27: "LU är en applikation, inte en plattform" -- LU may BUILD a
 * `DocumentEvidenceArtifactV2` (packages/mps-lu/src/artifacts/DocumentEvidenceArtifactV2.ts,
 * pure, no I/O) but must never itself hold CAS-write capability for it. This is the governance-
 * owned admission path `DocumentEvidenceMaterializer`'s own doc comment anticipated: "Callers
 * that need canonical persistence must route the returned artifact through the governed
 * promotion path. That bridge is a separate, not-yet-built work unit."
 *
 * Lives in `mps-data-governance`, not `mps-lu` and not `mimers-brunn-core`: `mps-lu` already
 * depends on `mps-data-governance` (see mps-lu/tests/fixtures/verifiedDocumentFact.ts importing
 * DocumentFactArtifact from here) and never the reverse, so this module can enforce the ADR-27
 * boundary without inverting that dependency graph. It deliberately does NOT import
 * `DocumentEvidenceArtifactV2`'s real type from `mps-lu` -- `AdmittableDocumentEvidenceV2` below
 * is a minimal structural shape; TypeScript structural typing means the real artifact satisfies
 * it automatically at every real call site.
 *
 * Mirrors the exact real cryptographic discipline already proven for raw-source promotion
 * (`QuarantinePromoter.promote()`, ADR-042 Level 2, `mimers-brunn-core/src/governance/
 * DatasetApproval.ts`): gather every check, then a single gate, then side effects -- no CAS
 * write may follow a partial verification. `createArtifactAttestation` /
 * `verifyArtifactAttestation` are already generic (predicateType is any string), reused here
 * with a new, distinct predicate type so an admission attestation can never be replayed as a
 * quarantine-promotion attestation or vice versa.
 *
 * "Do not trust caller-supplied hashes": `recomputeContentHash` is an injected PURE function
 * rather than a caller-supplied boolean/string, so the admitter itself performs the comparison,
 * not the caller. The only correct real caller of `admit()` is governance-owned server code
 * that imports the real `recomputeDocumentEvidenceV2ContentHash` from `mps-lu` -- never a value
 * influenced by request input.
 */
export const DOCUMENT_EVIDENCE_ADMISSION_ACTION = "document_evidence.admit" as const;
export const DOCUMENT_EVIDENCE_ADMISSION_PREDICATE_TYPE = "mimers-brunn/document-evidence-admission/v1" as const;
export const DOCUMENT_EVIDENCE_ADMISSION_SCHEMA_VERSION = 1;

/** Only V2 evidence is admittable through this gate -- see file header. */
export const DOCUMENT_EVIDENCE_V2_CONTRACT_VERSION = "document-evidence-v2" as const;

export interface DocumentEvidenceAdmissionPredicate {
  readonly action: typeof DOCUMENT_EVIDENCE_ADMISSION_ACTION;
  readonly evidence_artifact_id: string;
  readonly evidence_content_hash: string;
  readonly approver_actor_id: string;
  readonly approver_role: string;
  readonly governance_release: string;
  readonly attestation_schema_version: number;
  readonly signer_key_id: string;
}

export class DocumentEvidenceAdmissionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocumentEvidenceAdmissionError";
  }
}

interface AdmittableRef {
  readonly artifact_id: string;
  readonly artifact_type: string;
  readonly content_hash: string;
}

/** Minimal structural shape this gate requires. See file header re: not importing mps-lu's type. */
export interface AdmittableDocumentEvidenceV2 {
  readonly artifact_id: string;
  readonly artifact_type: string;
  readonly content_hash: { readonly algorithm: string; readonly value: string };
  readonly payload: {
    readonly contract_version: string;
    readonly verified_fact_refs: readonly AdmittableRef[];
    readonly [key: string]: unknown;
  };
}

export interface DocumentEvidenceAdmissionResult {
  /** The CAS storage key for the canonicalized artifact blob -- NOT the same value as
   *  `evidence.content_hash.value` (a different, narrower hash domain the artifact's own
   *  factory computes; see DocumentEvidenceArtifactV2.ts). This is the retrieval key. */
  readonly cas_content_hash: string;
  readonly is_duplicate: boolean;
}

export class DocumentEvidenceAdmitter {
  constructor(
    private readonly cas: CASRepository,
    private readonly signing: SigningKeyProvider,
  ) {}

  async admit(
    evidence: AdmittableDocumentEvidenceV2,
    attestation: ArtifactAttestation,
    governanceRelease: string,
    recomputeContentHash: (artifact: AdmittableDocumentEvidenceV2) => string,
  ): Promise<DocumentEvidenceAdmissionResult> {
    // ---- Structural / contract preconditions (not security bindings) ----
    if (evidence.artifact_type !== "DOCUMENT_EVIDENCE") {
      throw new DocumentEvidenceAdmissionError(
        `Unsupported artifact_type '${evidence.artifact_type}' -- only DOCUMENT_EVIDENCE is admittable.`,
      );
    }
    if (evidence.payload.contract_version !== DOCUMENT_EVIDENCE_V2_CONTRACT_VERSION) {
      throw new DocumentEvidenceAdmissionError(
        `Unsupported contract_version '${evidence.payload.contract_version}' -- this gate admits ` +
          `only '${DOCUMENT_EVIDENCE_V2_CONTRACT_VERSION}'. A real V1 artifact (mandatory ` +
          `property_ref) is out of scope for this gate, by design -- V1 admission, if ever built, ` +
          `is a separate, historically-scoped path that must never reinterpret V1 under V2 rules.`,
      );
    }
    if ("property_ref" in evidence.payload) {
      throw new DocumentEvidenceAdmissionError(
        "V2 evidence must not carry property_ref -- property binding is a separate governed artifact " +
          "(DocumentEvidencePropertyBindingArtifact), never a field on the evidence itself.",
      );
    }
    if (!Array.isArray(evidence.payload.verified_fact_refs) || evidence.payload.verified_fact_refs.length === 0) {
      throw new DocumentEvidenceAdmissionError("V2 evidence requires at least one verified_fact_ref.");
    }

    // ---- Cryptographic attestation verification + independent content_hash recomputation ----
    // Gather every result first, then a single gate, then side effects (step below).
    const predicate = attestation.predicate as Partial<DocumentEvidenceAdmissionPredicate>;

    const recomputed = recomputeContentHash(evidence);
    const contentHashValid = recomputed === evidence.content_hash.value;

    const signatureValid = await verifyArtifactAttestation(attestation, this.signing);
    const signerKeyBound = predicate.signer_key_id === this.signing.keyId && attestation.signer === this.signing.keyId;
    const actionBound = predicate.action === DOCUMENT_EVIDENCE_ADMISSION_ACTION;
    const artifactBound = predicate.evidence_artifact_id === evidence.artifact_id;
    const contentHashBound = predicate.evidence_content_hash === evidence.content_hash.value;
    const releaseBound = predicate.governance_release === governanceRelease;
    const approverActorId = predicate.approver_actor_id;
    const approverRole = predicate.approver_role;
    const approverBound =
      typeof approverActorId === "string" && approverActorId.length > 0 &&
      typeof approverRole === "string" && approverRole.length > 0;

    const checks: ReadonlyArray<readonly [boolean, string]> = [
      [
        contentHashValid,
        `Independent content_hash recomputation does not match the evidence's own content_hash ` +
          `(recomputed '${recomputed}', evidence claims '${evidence.content_hash.value}') -- ` +
          `refusing to admit a self-inconsistent artifact (catches the legacy 'uncalculated' shape too).`,
      ],
      [signatureValid, "Attestation's cryptographic signature is invalid."],
      [signerKeyBound, "Attestation is not signed with the expected governance key."],
      [actionBound, `Attestation action is not '${DOCUMENT_EVIDENCE_ADMISSION_ACTION}'.`],
      [artifactBound, "Attestation is bound to a different evidence artifact than the one being admitted."],
      [contentHashBound, "Attestation's evidence_content_hash does not match the evidence's current content_hash."],
      [releaseBound, "Attestation's governance_release does not match the call's value."],
      [approverBound, "Attestation lacks a valid approver_actor_id/approver_role in the signed predicate."],
    ];
    const failed = checks.find(([ok]) => !ok);
    if (failed) {
      throw new DocumentEvidenceAdmissionError(failed[1]);
    }

    // ---- All checks passed. Only now may the CAS write occur. ----
    const casResult = await this.cas.putCanonical(evidence);

    return { cas_content_hash: casResult.hash, is_duplicate: casResult.existed };
  }
}
