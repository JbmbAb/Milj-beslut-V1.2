import type { ArtifactContract, ArtifactReference } from "@miljobeslut/mps-compliance/src/artifacts/ArtifactContract";
import type { ActorReference } from "@miljobeslut/mps-core/src/types";
import { sha256ContentHash } from "@miljobeslut/mps-compliance/src/canonical/sha256Canonical";
import type { DocumentEvidenceHashedRef } from "./DocumentEvidenceArtifactV2";

/**
 * DOCUMENT-EVIDENCE-PROPERTY-BINDING-CONTRACT-V2.
 *
 * The separate, later, independently governed claim: "this canonical DocumentEvidence applies
 * to this canonical cadastral property." Mirrors the established binding-artifact pattern
 * already used for PROJECT <-> PROPERTY (ProjectPropertyBindingArtifact.ts): a lightweight,
 * deterministic, reference-based artifact rather than a mutable field on either side. Reused
 * here as a pattern, not as a type -- the pair being bound (DocumentEvidence <-> canonical
 * property) is different from PROJECT <-> PROPERTY, so it is a new artifact, not an extension
 * of that one.
 *
 * Binding changes identity when EITHER side changes: rebinding the same evidence to a different
 * property, or the same property to different evidence, must never collide with an existing
 * binding's identity.
 */
export const DOCUMENT_EVIDENCE_PROPERTY_BINDING_ARTIFACT_TYPE = "document_evidence_property_binding" as const;
export const DOCUMENT_EVIDENCE_PROPERTY_BINDING_CONTRACT_VERSION = "document-evidence-property-binding-v1" as const;
export const DOCUMENT_EVIDENCE_PROPERTY_BINDING_V2_CONTRACT_VERSION = "document-evidence-property-binding-v2" as const;

export type DocumentEvidencePropertyBindingMethod =
  /** A human governance reviewer confirmed the match against real cadastral data. */
  | "GOVERNANCE_REVIEWER_CONFIRMED"
  /** The property was resolved from a structured, authoritative field the source itself carries
   *  (e.g. a real fastighetsbeteckning printed in the document) -- not inferred. */
  | "AUTHORITY_STRUCTURED_SOURCE";

export interface DocumentEvidencePropertyBindingPayload {
  readonly contract_version: typeof DOCUMENT_EVIDENCE_PROPERTY_BINDING_CONTRACT_VERSION;
  readonly document_evidence_ref: DocumentEvidenceHashedRef;
  readonly property_ref: DocumentEvidenceHashedRef;
  readonly binding_method: DocumentEvidencePropertyBindingMethod;
  readonly binding_authority: { readonly identity_ref: ArtifactReference; readonly role: string };
  /** What justifies the match -- e.g. the real cadastral lookup artifact, or the reviewer's
   *  own recorded decision. MANDATORY: a binding with nothing justifying it is not a binding,
   *  it is an assertion. */
  readonly justification_refs: readonly ArtifactReference[];
}

/**
 * The current producer contract binds a reviewer to the immutable, public-key-verifiable grant
 * identity. V1 stays historical: its free ArtifactReference lacks the content hash required to
 * establish reviewer authority at a later admission boundary.
 */
export interface DocumentEvidencePropertyBindingPayloadV2 {
  readonly contract_version: typeof DOCUMENT_EVIDENCE_PROPERTY_BINDING_V2_CONTRACT_VERSION;
  readonly document_evidence_ref: DocumentEvidenceHashedRef;
  readonly property_ref: DocumentEvidenceHashedRef;
  readonly binding_method: DocumentEvidencePropertyBindingMethod;
  readonly binding_authority: ActorReference;
  readonly justification_refs: readonly ArtifactReference[];
}

export interface DocumentEvidencePropertyBindingArtifact extends ArtifactContract {
  readonly artifact_type: typeof DOCUMENT_EVIDENCE_PROPERTY_BINDING_ARTIFACT_TYPE;
  readonly payload: DocumentEvidencePropertyBindingPayload;
}

export interface DocumentEvidencePropertyBindingArtifactV2 extends ArtifactContract {
  readonly artifact_type: typeof DOCUMENT_EVIDENCE_PROPERTY_BINDING_ARTIFACT_TYPE;
  readonly payload: DocumentEvidencePropertyBindingPayloadV2;
}

export class DocumentEvidencePropertyBindingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocumentEvidencePropertyBindingError";
  }
}

function requiredHashedRef(value: DocumentEvidenceHashedRef | undefined, field: string): DocumentEvidenceHashedRef {
  if (!value?.artifact_id || !value.artifact_type || !value.content_hash) {
    throw new DocumentEvidencePropertyBindingError(`REJECT_DOCUMENT_EVIDENCE_PROPERTY_BINDING: ${field} requires artifact_id, artifact_type, and content_hash`);
  }
  return { artifact_id: value.artifact_id, artifact_type: value.artifact_type, content_hash: value.content_hash };
}

export interface DocumentEvidencePropertyBindingInput {
  readonly document_evidence_ref: DocumentEvidenceHashedRef;
  readonly property_ref: DocumentEvidenceHashedRef;
  readonly binding_method: DocumentEvidencePropertyBindingMethod;
  readonly binding_authority: { readonly identity_ref: ArtifactReference; readonly role: string };
  readonly justification_refs: readonly ArtifactReference[];
}

export interface DocumentEvidencePropertyBindingV2Input {
  readonly document_evidence_ref: DocumentEvidenceHashedRef;
  readonly property_ref: DocumentEvidenceHashedRef;
  readonly binding_method: DocumentEvidencePropertyBindingMethod;
  readonly binding_authority: ActorReference;
  readonly justification_refs: readonly ArtifactReference[];
}

function buildPayload(input: DocumentEvidencePropertyBindingInput): DocumentEvidencePropertyBindingPayload {
  if (!input.justification_refs || input.justification_refs.length === 0) {
    throw new DocumentEvidencePropertyBindingError("REJECT_DOCUMENT_EVIDENCE_PROPERTY_BINDING: at least one justification_ref is required");
  }
  if (!input.binding_authority?.identity_ref?.artifact_id || !input.binding_authority.role) {
    throw new DocumentEvidencePropertyBindingError("REJECT_DOCUMENT_EVIDENCE_PROPERTY_BINDING: binding_authority is required");
  }
  return {
    contract_version: DOCUMENT_EVIDENCE_PROPERTY_BINDING_CONTRACT_VERSION,
    document_evidence_ref: requiredHashedRef(input.document_evidence_ref, "document_evidence_ref"),
    property_ref: requiredHashedRef(input.property_ref, "property_ref"),
    binding_method: input.binding_method,
    binding_authority: input.binding_authority,
    justification_refs: input.justification_refs,
  };
}

function buildPayloadV2(input: DocumentEvidencePropertyBindingV2Input): DocumentEvidencePropertyBindingPayloadV2 {
  if (!input.justification_refs || input.justification_refs.length === 0) {
    throw new DocumentEvidencePropertyBindingError("REJECT_DOCUMENT_EVIDENCE_PROPERTY_BINDING: at least one justification_ref is required");
  }
  if (input.binding_authority?.role !== "GOVERNANCE_REVIEWER" ||
      !input.binding_authority.identity_ref?.id ||
      !input.binding_authority.identity_ref.content_hash?.digest) {
    throw new DocumentEvidencePropertyBindingError("REJECT_DOCUMENT_EVIDENCE_PROPERTY_BINDING: V2 requires a hash-bound GOVERNANCE_REVIEWER authority");
  }
  return {
    contract_version: DOCUMENT_EVIDENCE_PROPERTY_BINDING_V2_CONTRACT_VERSION,
    document_evidence_ref: requiredHashedRef(input.document_evidence_ref, "document_evidence_ref"),
    property_ref: requiredHashedRef(input.property_ref, "property_ref"),
    binding_method: input.binding_method,
    binding_authority: input.binding_authority,
    justification_refs: input.justification_refs,
  };
}

export function computeDocumentEvidencePropertyBindingIdentity(input: DocumentEvidencePropertyBindingInput): string {
  const payload = buildPayload(input);
  const identityHash = sha256ContentHash({
    artifact_type: DOCUMENT_EVIDENCE_PROPERTY_BINDING_ARTIFACT_TYPE,
    canonicalizer_id: "rfc8785-sha256-v1",
    payload,
  });
  return `document-evidence-property-binding-${identityHash.value.slice(0, 24)}`;
}

export function createDocumentEvidencePropertyBindingArtifact(
  input: DocumentEvidencePropertyBindingInput,
): DocumentEvidencePropertyBindingArtifact {
  const payload = buildPayload(input);
  const artifactId = computeDocumentEvidencePropertyBindingIdentity(input);
  const references: ArtifactReference[] = [
    { artifact_id: payload.document_evidence_ref.artifact_id, artifact_type: payload.document_evidence_ref.artifact_type },
    { artifact_id: payload.property_ref.artifact_id, artifact_type: payload.property_ref.artifact_type },
    ...payload.justification_refs,
  ];
  const bare = {
    artifact_id: artifactId,
    artifact_type: DOCUMENT_EVIDENCE_PROPERTY_BINDING_ARTIFACT_TYPE,
    references,
    payload,
  };
  return { ...bare, content_hash: sha256ContentHash(bare) };
}

export function createDocumentEvidencePropertyBindingArtifactV2(
  input: DocumentEvidencePropertyBindingV2Input,
): DocumentEvidencePropertyBindingArtifactV2 {
  const payload = buildPayloadV2(input);
  const identityHash = sha256ContentHash({
    artifact_type: DOCUMENT_EVIDENCE_PROPERTY_BINDING_ARTIFACT_TYPE,
    canonicalizer_id: "rfc8785-sha256-v1",
    payload,
  });
  const artifactId = `document-evidence-property-binding-${identityHash.value.slice(0, 24)}`;
  const references: ArtifactReference[] = [
    { artifact_id: payload.document_evidence_ref.artifact_id, artifact_type: payload.document_evidence_ref.artifact_type },
    { artifact_id: payload.property_ref.artifact_id, artifact_type: payload.property_ref.artifact_type },
    ...payload.justification_refs,
  ];
  const bare = {
    artifact_id: artifactId,
    artifact_type: DOCUMENT_EVIDENCE_PROPERTY_BINDING_ARTIFACT_TYPE,
    references,
    payload,
  };
  return { ...bare, content_hash: sha256ContentHash(bare) };
}

export function recomputeDocumentEvidencePropertyBindingContentHash(
  artifact: DocumentEvidencePropertyBindingArtifact | DocumentEvidencePropertyBindingArtifactV2,
): string {
  return sha256ContentHash({
    artifact_id: artifact.artifact_id,
    artifact_type: artifact.artifact_type,
    references: artifact.references,
    payload: artifact.payload,
  }).value;
}

export function isDocumentEvidencePropertyBindingContentHashValid(
  artifact: DocumentEvidencePropertyBindingArtifact | DocumentEvidencePropertyBindingArtifactV2,
): boolean {
  return recomputeDocumentEvidencePropertyBindingContentHash(artifact) === artifact.content_hash.value;
}
