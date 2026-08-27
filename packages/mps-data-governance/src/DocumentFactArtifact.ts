import type {
  CanonicalArtifact,
  ContentReference,
  ActorReference,
  Timestamp,
} from "../../mps-core/src/types";

/**
 * 🜃 Document Fact Model (Tier 3 — Inventory/classification)
 *
 * OWNER FREEZE 2026-08-12 — DOCUMENT FACT MODEL.
 *
 * A legal fact about a document arises in Tier 3 Inventory/classification, NOT in LU evidence
 * materialization. `DocumentEvidenceArtifact` does not own legal classification authority; it
 * references verified facts.
 *
 * Responsibility chain:
 *
 *   Tier 2       "This is the document's content."
 *   Tier 3       "This content has been classified as fact X."
 *   Governance   "Fact X is verified according to method Y."
 *   LU Evidence  "This verified fact is relevant evidence for this LU."
 *   LU Rule      "If verified fact X exists → create finding."
 *
 * Forbidden:  text → keyword → finding
 * Permitted:  text → classified fact → verification → canonical fact artifact → rule → finding
 *
 * The source span is evidence of the fact's ORIGIN. It is never the rule predicate.
 *
 * @see docs/architecture/F4B-DOCUMENT-FACT-MODEL-CHECK-2026-08-12.md
 * @see docs/architecture/mimers-brunn-v3.0.0.md §3.3 (Tier 3 Inventory)
 */

/** Versioned fact vocabulary. A fact type is a claim about legal content, never a document class. */
export type DocumentFactType = "PRIOR_LOCATION_RESTRICTING_DECISION";

/**
 * Two states, deliberately distinct types rather than one type with a status flag: a candidate
 * cannot be passed where a verified fact is required, and the compiler enforces it.
 */
export type DocumentFactVerificationStatus = "CANDIDATE" | "VERIFIED";

/** How the fact was first asserted. A machine may assert; asserting is not verifying. */
export type DocumentFactAssertionMethod =
  | "MODEL_EXTRACTION"
  | "DETERMINISTIC_EXTRACTION"
  | "AUTHORITY_STRUCTURED_SOURCE"
  | "HUMAN_ASSERTION";

/**
 * How the fact was verified. Explicit and versioned so the governance contract can evolve —
 * "human forever" is deliberately NOT baked into the artifact model.
 */
export type DocumentFactVerificationMethod =
  | "HUMAN_REVIEW"
  | "AUTHORITY_STRUCTURED_SOURCE"
  | "DETERMINISTIC_CLASSIFIER"
  | "MODEL_PLUS_HUMAN_REVIEW";

/**
 * MANDATORY, not optional. For a legal fact the system must be able to point at the passage the
 * fact was derived from.
 *
 * Binds offsets to a canonical text projection rather than carrying quoted text: copying the
 * passage into the fact would re-introduce loose text into the artifact and invite exactly the
 * `text → predicate` shortcut the model forbids. Auditing resolves the projection.
 */
export interface DocumentFactSourceSpan {
  readonly text_projection_ref: ContentReference;
  readonly start_offset: number;
  readonly end_offset: number;
}

export interface DocumentFactAssertion {
  readonly asserted_by: ActorReference;
  readonly assertion_method: DocumentFactAssertionMethod;
  /** Identifies the exact classifier/extractor build that produced the assertion. */
  readonly asserter_version: string;
  readonly asserted_at: Timestamp;
}

export interface DocumentFactVerification {
  readonly verified_by: ActorReference;
  readonly verification_method: DocumentFactVerificationMethod;
  /** Which frozen verification policy admitted this method for this fact type. */
  readonly verification_policy_version: string;
  readonly verified_at: Timestamp;
}

/** Fields shared by both states — the fact's substance, independent of its verification state. */
export interface DocumentFactCore {
  readonly fact_type: DocumentFactType;
  readonly fact_version: string;
  /** The document the fact is about. */
  readonly source_document_ref: ContentReference;
  /** Tier 3 binding — the inventory entry this classification belongs to. */
  readonly inventory_ref: ContentReference;
  /** MANDATORY. */
  readonly source_span: DocumentFactSourceSpan;
  /** Optional subject the fact concerns (e.g. a property), when the fact is subject-bound. */
  readonly subject_ref?: ContentReference;
}

/**
 * A machine/extractor may produce this. It is NOT a legal fact yet and MUST NOT be consumed by
 * rules.
 */
export interface DocumentFactCandidateArtifact extends CanonicalArtifact, DocumentFactCore {
  readonly artifact_type: "DOCUMENT_FACT_CANDIDATE";
  readonly verification_status: "CANDIDATE";
  readonly assertion: DocumentFactAssertion;
}

/**
 * The only form a rule may consume. Carries both its assertion origin and its verification —
 * dropping either would make the fact unauditable.
 */
export interface VerifiedDocumentFactArtifact extends CanonicalArtifact, DocumentFactCore {
  readonly artifact_type: "VERIFIED_DOCUMENT_FACT";
  readonly verification_status: "VERIFIED";
  /** The candidate this was verified from — assertion origin is never discarded. */
  readonly candidate_ref: ContentReference;
  readonly assertion: DocumentFactAssertion;
  readonly verification: DocumentFactVerification;
}

/**
 * Runtime marker for the current production fact contract. The structural V2 type lives in
 * VerifiedDocumentFactV2.ts to preserve this historical V1 file's verification contract.
 */
export const VerifiedDocumentFactArtifactV2 = "verified-document-fact-v2" as const;

/**
 * Which verification methods may establish which fact types. Versioned so a fact type can be
 * opened to automatic verification later, once there is proof for that classification, without
 * changing the artifact model.
 */
export interface DocumentFactVerificationPolicy {
  readonly policy_version: string;
  readonly allowed_verification_methods: Readonly<
    Record<DocumentFactType, readonly DocumentFactVerificationMethod[]>
  >;
}

/**
 * v1 — PRIOR_LOCATION_RESTRICTING_DECISION requires human/governance verification.
 * A machine may assert the candidate; it may not verify it alone.
 */
export const DOCUMENT_FACT_VERIFICATION_POLICY_V1: DocumentFactVerificationPolicy = {
  policy_version: "document-fact-verification/v1",
  allowed_verification_methods: {
    PRIOR_LOCATION_RESTRICTING_DECISION: ["HUMAN_REVIEW", "MODEL_PLUS_HUMAN_REVIEW"],
  },
};

export class DocumentFactVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocumentFactVerificationError";
  }
}

/** Verification methods that a machine can perform without a human in the loop. */
const MACHINE_ONLY_VERIFICATION_METHODS: readonly DocumentFactVerificationMethod[] = [
  "DETERMINISTIC_CLASSIFIER",
];

/** Roles that count as governance/human participation in a verification. */
const GOVERNANCE_ROLES = ["HUMAN_OPERATOR", "GOVERNANCE_REVIEWER"] as const;

/**
 * Fail-closed promotion CANDIDATE → VERIFIED.
 *
 * Gathers every check before producing the verified artifact — same discipline as
 * `QuarantinePromoter.promote()` and `CorpusImportGate.importBatch()`: no partial result is
 * constructed and then discarded on a later failure.
 */
export function verifyDocumentFactCandidate(args: {
  readonly candidate: DocumentFactCandidateArtifact;
  readonly candidate_ref: ContentReference;
  readonly verification: DocumentFactVerification;
  readonly policy: DocumentFactVerificationPolicy;
  readonly artifact_id: string;
  readonly content_hash: VerifiedDocumentFactArtifact["content_hash"];
  readonly signature: VerifiedDocumentFactArtifact["signature"];
}): VerifiedDocumentFactArtifact {
  const { candidate, verification, policy } = args;

  const allowed = policy.allowed_verification_methods[candidate.fact_type];

  const checks: ReadonlyArray<readonly [boolean, string]> = [
    [
      candidate.verification_status === "CANDIDATE",
      `only a CANDIDATE may be verified; got '${candidate.verification_status}'.`,
    ],
    [
      verification.verification_policy_version === policy.policy_version,
      `verification cites policy '${verification.verification_policy_version}' but was checked ` +
        `against '${policy.policy_version}'.`,
    ],
    [
      Array.isArray(allowed) && allowed.length > 0,
      `fact type '${candidate.fact_type}' has no allowed verification methods under policy ` +
        `'${policy.policy_version}'.`,
    ],
    [
      Array.isArray(allowed) && allowed.includes(verification.verification_method),
      `verification method '${verification.verification_method}' is not permitted for fact type ` +
        `'${candidate.fact_type}' under policy '${policy.policy_version}'.`,
    ],
    [
      !MACHINE_ONLY_VERIFICATION_METHODS.includes(verification.verification_method) ||
        (allowed ?? []).includes(verification.verification_method),
      `machine-only verification is not admitted for '${candidate.fact_type}'.`,
    ],
    [
      MACHINE_ONLY_VERIFICATION_METHODS.includes(verification.verification_method) ||
        (GOVERNANCE_ROLES as readonly string[]).includes(verification.verified_by.role),
      `verification method '${verification.verification_method}' requires a governance/human ` +
        `verifier; got role '${verification.verified_by.role}'.`,
    ],
    [
      verification.verified_by.identity_ref.id !== candidate.assertion.asserted_by.identity_ref.id,
      "the asserter may not verify its own fact — assertion and verification must be separate " +
        "identities.",
    ],
    [
      isValidSpan(candidate.source_span),
      "source_span is mandatory and must reference a text projection with a non-empty, ordered " +
        "offset range.",
    ],
  ];

  const failed = checks.find(([ok]) => !ok);
  if (failed) {
    throw new DocumentFactVerificationError(
      `Document fact verification rejected for '${candidate.fact_type}': ${failed[1]}`,
    );
  }

  return {
    artifact_id: args.artifact_id,
    artifact_type: "VERIFIED_DOCUMENT_FACT",
    content_hash: args.content_hash,
    signature: args.signature,
    verification_status: "VERIFIED",
    fact_type: candidate.fact_type,
    fact_version: candidate.fact_version,
    source_document_ref: candidate.source_document_ref,
    inventory_ref: candidate.inventory_ref,
    source_span: candidate.source_span,
    subject_ref: candidate.subject_ref,
    candidate_ref: args.candidate_ref,
    assertion: candidate.assertion,
    verification,
  };
}

export function isValidSpan(span: DocumentFactSourceSpan | undefined): boolean {
  if (!span) return false;
  if (!span.text_projection_ref?.id) return false;
  if (!Number.isInteger(span.start_offset) || !Number.isInteger(span.end_offset)) return false;
  if (span.start_offset < 0) return false;
  return span.end_offset > span.start_offset;
}

/** Type guard so rule code cannot accidentally consume a candidate. */
export function isVerifiedDocumentFact(
  fact: DocumentFactCandidateArtifact | VerifiedDocumentFactArtifact,
): fact is VerifiedDocumentFactArtifact {
  return fact.artifact_type === "VERIFIED_DOCUMENT_FACT" && fact.verification_status === "VERIFIED";
}
