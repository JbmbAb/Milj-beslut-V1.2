import type { ArtifactContract, ArtifactReference } from "@miljobeslut/mps-compliance/src/artifacts/ArtifactContract";
import { sha256ContentHash } from "@miljobeslut/mps-compliance/src/canonical/sha256Canonical";
import type { DocumentEvidenceArtifact } from "./DocumentEvidenceArtifact";

/**
 * DOCUMENT-EVIDENCE-PROPERTY-BINDING-CONTRACT-V2.
 *
 * OWNER DECISION 2026-08-24: V1's `DocumentEvidenceArtifact.payload.property_ref` (see
 * ./DocumentEvidenceArtifact.ts) conflates two different claims:
 *
 *   A. what the governed document actually proves
 *   B. which canonical cadastral property that proof is later determined to apply to
 *
 * A mandatory property_ref forces B before A can even exist -- a real, legitimate document
 * (e.g. a real MMOD court decision naming a property only as "fastigheten i Bollnäs kommun",
 * with no fastighetsbeteckning to look up) cannot become canonical evidence at all, not because
 * the evidence is weak, but because a DIFFERENT, LATER claim has no answer yet.
 *
 * V2 removes property_ref entirely. Canonical document evidence exists independently of any
 * cadastral binding. Binding is a separate, later, independently governed artifact --
 * see ./DocumentEvidencePropertyBindingArtifact.ts -- and only BOUND evidence may enter a
 * property-specific LU assessment (see ./DocumentEvidencePropertyAdmission.ts).
 *
 * V1 is NOT touched, NOT deprecated, and NOT reinterpreted: an existing V1 artifact (mandatory
 * property_ref) remains valid exactly under V1's rules forever. V2 is additive. Both share the
 * literal `artifact_type: "DOCUMENT_EVIDENCE"` -- the same discriminator pattern already
 * established for LocalizationGeometryArtifact V1/V2 (LocalizationGeometryArtifact.ts):
 * `payload.contract_version` distinguishes them, never the artifact_type string. A real V1
 * artifact has no `contract_version` field at all (implicit V1); `contract_version ===
 * "document-evidence-v2"` marks V2 explicitly.
 *
 * V1's `property_ref` has exactly one real consumer in production code today
 * (DocumentEvidenceMaterializer.materialize(), QuarantinePromoter.ts:85, which only threads it
 * into `references`) and zero downstream readers -- H15's resolveEvidence
 * (LuDeterministicReExecution.ts) only structurally confirms DOCUMENT_EVIDENCE has a
 * content_hash, and LURuleEngine (LURuleEngine.ts) reads `fact_refs`, never `property_ref`.
 * Removing it from V2 changes no live evidence-resolution or replay behavior.
 *
 * IMPORT-TIME-001 / SV-I06 (mps-core/src/types.ts Timestamp doc): `source_metadata.retrieved_at`
 * is real provenance but is excluded from identity/content hashing, same discipline as
 * `asserted_at`/`verified_at` in the DocumentFactArtifact chain this evidence is built from --
 * materializing the same real fact at a different wall-clock moment must mint the same identity.
 */
export const DOCUMENT_EVIDENCE_CONTRACT_VERSION_V2 = "document-evidence-v2" as const;

/** A reference strong enough to detect tampering in the referenced artifact, not just its id. */
export interface DocumentEvidenceHashedRef extends ArtifactReference {
  readonly content_hash: string;
}

export interface DocumentEvidencePayloadV2 {
  readonly contract_version: typeof DOCUMENT_EVIDENCE_CONTRACT_VERSION_V2;
  readonly document_ref: DocumentEvidenceHashedRef;
  readonly raw_source_ref?: DocumentEvidenceHashedRef;
  readonly text_projection_ref?: DocumentEvidenceHashedRef;
  /**
   * MANDATORY, non-empty. V1 allowed `fact_refs` to be absent (evidence could exist as raw
   * provider text before Tier 3 classification). V2 evidence is minted FROM an already-verified
   * fact chain -- there is no V2 use case yet for evidence without at least one verified fact,
   * and requiring it here is what makes "document truth" and "cadastral truth" the ONLY two
   * claims left to separate, rather than three.
   */
  readonly verified_fact_refs: readonly DocumentEvidenceHashedRef[];
  readonly source_metadata: {
    readonly provider: string;
    /** Provenance only -- excluded from identity/content hashing, per IMPORT-TIME-001. */
    readonly retrieved_at: string;
  };
  // Deliberately NO property_ref. See file header.
}

export interface DocumentEvidenceArtifactV2 extends ArtifactContract {
  readonly artifact_type: "DOCUMENT_EVIDENCE";
  readonly payload: DocumentEvidencePayloadV2;
}

export class DocumentEvidenceV2Error extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocumentEvidenceV2Error";
  }
}

function requiredRef(value: DocumentEvidenceHashedRef | undefined, field: string): DocumentEvidenceHashedRef {
  if (!value?.artifact_id || !value.artifact_type || !value.content_hash) {
    throw new DocumentEvidenceV2Error(`REJECT_DOCUMENT_EVIDENCE_V2: ${field} requires artifact_id, artifact_type, and content_hash`);
  }
  return { artifact_id: value.artifact_id, artifact_type: value.artifact_type, content_hash: value.content_hash };
}

/** True iff `artifact` is a V2 evidence artifact (V1 has no `contract_version` field at all). */
export function isDocumentEvidenceV2(
  artifact: DocumentEvidenceArtifact | DocumentEvidenceArtifactV2,
): artifact is DocumentEvidenceArtifactV2 {
  return (artifact.payload as Partial<DocumentEvidencePayloadV2>).contract_version === DOCUMENT_EVIDENCE_CONTRACT_VERSION_V2;
}

/** The exact fields that determine identity/content_hash. `retrieved_at` is deliberately absent. */
function hashDomain(payload: DocumentEvidencePayloadV2): Record<string, unknown> {
  if (payload.verified_fact_refs.length === 0) {
    throw new DocumentEvidenceV2Error("REJECT_DOCUMENT_EVIDENCE_V2: at least one verified_fact_ref is required");
  }
  return {
    artifact_type: "DOCUMENT_EVIDENCE",
    contract_version: DOCUMENT_EVIDENCE_CONTRACT_VERSION_V2,
    document_ref: payload.document_ref,
    ...(payload.raw_source_ref !== undefined ? { raw_source_ref: payload.raw_source_ref } : {}),
    ...(payload.text_projection_ref !== undefined ? { text_projection_ref: payload.text_projection_ref } : {}),
    verified_fact_refs: payload.verified_fact_refs,
    source_metadata: { provider: payload.source_metadata.provider },
  };
}

export interface DocumentEvidenceV2Input {
  readonly document_ref: DocumentEvidenceHashedRef;
  readonly raw_source_ref?: DocumentEvidenceHashedRef;
  readonly text_projection_ref?: DocumentEvidenceHashedRef;
  readonly verified_fact_refs: readonly DocumentEvidenceHashedRef[];
  readonly source_metadata: { readonly provider: string; readonly retrieved_at: string };
}

function buildPayload(input: DocumentEvidenceV2Input): DocumentEvidencePayloadV2 {
  return {
    contract_version: DOCUMENT_EVIDENCE_CONTRACT_VERSION_V2,
    document_ref: requiredRef(input.document_ref, "document_ref"),
    ...(input.raw_source_ref !== undefined ? { raw_source_ref: requiredRef(input.raw_source_ref, "raw_source_ref") } : {}),
    ...(input.text_projection_ref !== undefined ? { text_projection_ref: requiredRef(input.text_projection_ref, "text_projection_ref") } : {}),
    verified_fact_refs: input.verified_fact_refs.map((ref, i) => requiredRef(ref, `verified_fact_refs[${i}]`)),
    source_metadata: input.source_metadata,
  };
}

/** Deterministic identity a payload WOULD get -- lets a caller (or a RED proof) assert
 *  "same verified fact + same frozen semantic inputs -> same identity" without constructing
 *  the full signed artifact. */
export function computeDocumentEvidenceV2Identity(input: DocumentEvidenceV2Input): string {
  const payload = buildPayload(input);
  return `doc-evidence-v2-${sha256ContentHash(hashDomain(payload)).value.slice(0, 24)}`;
}

/**
 * Builds a real, deterministic `DocumentEvidenceArtifactV2` -- no property binding required or
 * accepted. Pure: no I/O, no CAS write. Persisting this through governance-owned CAS admission
 * is a separate step (Unit E, not built by this constructor).
 */
export function createDocumentEvidenceArtifactV2(input: DocumentEvidenceV2Input): DocumentEvidenceArtifactV2 {
  const payload = buildPayload(input);
  const artifactId = computeDocumentEvidenceV2Identity(input);
  const references: ArtifactReference[] = [
    { artifact_id: payload.document_ref.artifact_id, artifact_type: payload.document_ref.artifact_type },
    ...(payload.raw_source_ref ? [{ artifact_id: payload.raw_source_ref.artifact_id, artifact_type: payload.raw_source_ref.artifact_type }] : []),
    ...payload.verified_fact_refs.map((r) => ({ artifact_id: r.artifact_id, artifact_type: r.artifact_type })),
  ];
  const bare = { artifact_id: artifactId, artifact_type: "DOCUMENT_EVIDENCE" as const, references, payload };
  return { ...bare, content_hash: sha256ContentHash({ artifact_id: bare.artifact_id, ...hashDomain(payload) }) };
}

/** Recomputes the content_hash a real V2 artifact SHOULD have, from its own carried fields alone. */
export function recomputeDocumentEvidenceV2ContentHash(artifact: DocumentEvidenceArtifactV2): string {
  return sha256ContentHash({ artifact_id: artifact.artifact_id, ...hashDomain(artifact.payload) }).value;
}

/** True iff a V2 artifact's stored content_hash still matches its own carried fields. */
export function isDocumentEvidenceV2ContentHashValid(artifact: DocumentEvidenceArtifactV2): boolean {
  return recomputeDocumentEvidenceV2ContentHash(artifact) === artifact.content_hash.value;
}
