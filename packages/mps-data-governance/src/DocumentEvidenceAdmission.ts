import { verifyArtifactAttestation } from "@miljobeslut/mimers-brunn-core";
import type { ArtifactAttestation, CASRepository, VerificationKeyProvider } from "@miljobeslut/mimers-brunn-core";
import type { ActorReference } from "../../mps-core/src/types";

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
  /** Derived from a verified GovernanceReviewerGrant; never request-supplied authority. */
  readonly approver_actor_ref: ActorReference;
  readonly approver_role: "GOVERNANCE_REVIEWER";
  /** Repeats the V2 evidence semantic set in the signed admission predicate. */
  readonly verified_fact_refs: readonly AdmittableRef[];
  /** The independently reviewed property applicability claim. */
  readonly property_binding_ref: AdmittableRef;
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
    private readonly verification: VerificationKeyProvider,
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

    const signatureValid = await verifyArtifactAttestation(attestation, this.verification);
    const signerKeyBound = predicate.signer_key_id === this.verification.keyId && attestation.signer === this.verification.keyId;
    const actionBound = predicate.action === DOCUMENT_EVIDENCE_ADMISSION_ACTION;
    const artifactBound = predicate.evidence_artifact_id === evidence.artifact_id;
    const contentHashBound = predicate.evidence_content_hash === evidence.content_hash.value;
    const releaseBound = predicate.governance_release === governanceRelease;
    const approverActor = predicate.approver_actor_ref;
    const approverRole = predicate.approver_role;
    const approverBound =
      typeof approverActor?.identity_ref?.id === "string" && approverActor.identity_ref.id.length > 0 &&
      typeof approverActor.identity_ref.content_hash?.digest === "string" && approverActor.identity_ref.content_hash.digest.length > 0 &&
      approverActor.role === "GOVERNANCE_REVIEWER" && approverRole === "GOVERNANCE_REVIEWER";
    const predicateFacts = predicate.verified_fact_refs;
    const factRefsBound = sameSemanticRefSet(predicateFacts, evidence.payload.verified_fact_refs);
    const propertyBindingBound = isAdmittableRef(predicate.property_binding_ref);
    const subjectBound = attestation.subjectDigest === `sha256:${evidence.content_hash.value}`;

    const checks: ReadonlyArray<readonly [boolean, string]> = [
      [
        contentHashValid,
        `Independent content_hash recomputation does not match the evidence's own content_hash ` +
          `(recomputed '${recomputed}', evidence claims '${evidence.content_hash.value}') -- ` +
          `refusing to admit a self-inconsistent artifact (catches the legacy 'uncalculated' shape too).`,
      ],
      [signatureValid, "Attestation's cryptographic signature is invalid."],
      [signerKeyBound, "Attestation is not signed with the expected governance key."],
      [subjectBound, "Attestation subject digest does not match the evidence content hash."],
      [actionBound, `Attestation action is not '${DOCUMENT_EVIDENCE_ADMISSION_ACTION}'.`],
      [artifactBound, "Attestation is bound to a different evidence artifact than the one being admitted."],
      [contentHashBound, "Attestation's evidence_content_hash does not match the evidence's current content_hash."],
      [releaseBound, "Attestation's governance_release does not match the call's value."],
      [approverBound, "Attestation lacks a verified GOVERNANCE_REVIEWER approver actor/reference."],
      [factRefsBound, "Attestation's verified fact set does not exactly bind the evidence's verified fact set."],
      [propertyBindingBound, "Attestation lacks a complete property binding reference."],
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

function isAdmittableRef(value: unknown): value is AdmittableRef {
  if (!value || typeof value !== "object") return false;
  const ref = value as Partial<AdmittableRef>;
  return typeof ref.artifact_id === "string" && ref.artifact_id.length > 0 &&
    typeof ref.artifact_type === "string" && ref.artifact_type.length > 0 &&
    typeof ref.content_hash === "string" && ref.content_hash.length > 0;
}

function sameSemanticRefSet(candidate: unknown, expected: readonly AdmittableRef[]): boolean {
  if (!Array.isArray(candidate) || candidate.some((ref) => !isAdmittableRef(ref))) return false;
  const key = (ref: AdmittableRef) => `${ref.artifact_id}\u0000${ref.artifact_type}\u0000${ref.content_hash}`;
  const candidateKeys = candidate.map(key).sort();
  const expectedKeys = expected.map(key).sort();
  if (candidateKeys.length !== expectedKeys.length) return false;
  return candidateKeys.every((value, index) => value === expectedKeys[index]);
}
