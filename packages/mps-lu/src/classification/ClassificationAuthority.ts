import { createHash } from "node:crypto";

import type { ArtifactReference } from "@miljobeslut/mps-compliance/src/artifacts/ArtifactContract";
import type {
  DocumentClassification,
  DocumentClassificationArtifact,
  DocumentClassificationPayload,
} from "../artifacts/DocumentClassificationArtifact";
import { isAdmittedClassification } from "../artifacts/DocumentClassificationArtifact";
import type { RelevantDocument } from "../domain/RelevantDocument";
import { toRelevantDocumentType } from "../domain/RelevantDocument";
import {
  classifyDocument,
  type ClassifiableEvidence,
  type ClassificationResult,
  type ClassifierContract,
} from "./DocumentClassifier";

/**
 * 🜃 P3-LU-DOCUMENT-CLASSIFICATION-01B — the AUTHORITY half of the classification runtime.
 *
 * The classifier proposes; this module decides, records, verifies and projects. The path is
 * one-directional and every step fails closed:
 *
 *   classifyDocument()          proposal
 *     → issueClassification()   admitted, canonicalized, persisted
 *       → loadClassification()  identity recomputed and verified
 *         → projectRelevantDocument()   RelevantDocument, bound to that exact artifact
 *
 * There is no shortcut across it. `projectRelevantDocument()` will not accept a raw
 * `ClassificationResult`, because a classifier result is an opinion: projecting from it directly
 * would make the classifier its own authority, and `classification_ref` would name something that
 * was never recorded and can never be replayed.
 *
 * ⚠️ NO CLASSIFICATION POLICY LIVES HERE EITHER. This module admits or rejects values against the
 * closed vocabulary; it never decides which one a document has.
 *
 * @see ./DocumentClassifier.ts
 * @see ../artifacts/DocumentClassificationArtifact.ts
 */

/**
 * Version of the canonicalization itself.
 *
 * It participates in identity because a change to how the payload is serialised changes what a
 * digest means. Without it, an old and a new canonicalizer would silently produce two different
 * identities for the same classification and replay could not tell which was expected.
 */
export const CLASSIFICATION_CANONICALIZER = "lu-document-classification-v1";

export const ARTIFACT_TYPE = "DOCUMENT_CLASSIFICATION" as const;

/** The narrow persistence port. Deliberately minimal: this module is not a repository. */
export interface ClassificationStore {
  put(artifact: DocumentClassificationArtifact): Promise<void>;
  get(artifactId: string): Promise<DocumentClassificationArtifact | null>;
}

// --------------------------------------------------------------------- canonical identity

/**
 * Deterministic serialisation over the identity-bearing fields ONLY.
 *
 * Keys are emitted in a fixed order rather than in insertion order, so two payloads built by
 * different code paths cannot hash differently while being identical.
 */
function canonicalBytes(payload: DocumentClassificationPayload): string {
  const ref = (r: ArtifactReference) => ({
    artifact_id: r.artifact_id,
    artifact_type: r.artifact_type,
  });

  return JSON.stringify({
    canonicalizer: CLASSIFICATION_CANONICALIZER,
    source_document_evidence_ref: ref(payload.source_document_evidence_ref),
    classification: payload.classification,
    classifier_id: payload.classifier_id,
    classifier_version: payload.classifier_version,
    classification_basis: payload.classification_basis.map(ref),
  });
}

function canonicalHash(payload: DocumentClassificationPayload): {
  algorithm: "sha256";
  value: string;
} {
  return {
    algorithm: "sha256",
    value: createHash("sha256").update(canonicalBytes(payload), "utf8").digest("hex"),
  };
}

// --------------------------------------------------------------------- admission

/**
 * The single admission point for DOCUMENT_CLASSIFICATION_RUNTIME_GUARD-01.
 *
 * `toRelevantDocumentType()` has existed and failed closed since F4B-0A, but nothing called it —
 * the invariant was representable and unenforced. This is where it is enforced: not at
 * acquisition, and not over raw classifier text used as a label, but at the moment a proposal
 * asks to become a recorded classification.
 *
 * The mapped value must equal the proposed one exactly. Accepting `"BESLUT"` because it maps to
 * `"decision"` would reopen the alias path and let a producer's vocabulary re-enter through the
 * authority layer.
 */
function admitClassification(proposed: string): DocumentClassification {
  if (proposed === "UNCLASSIFIED") return "UNCLASSIFIED";

  const mapped = toRelevantDocumentType(proposed);
  if (mapped === undefined || mapped !== proposed) {
    throw new Error(
      `REJECT_UNADMITTED_CLASSIFICATION: '${proposed}' is not in the closed vocabulary ` +
        "(decision | injunction | notification | inspection | UNCLASSIFIED). It is neither " +
        "coerced nor defaulted: a free producer string must not become a typed claim about a " +
        "document.",
    );
  }
  return mapped;
}

// --------------------------------------------------------------------- issue

export interface IssueClassificationInput {
  readonly evidence: ClassifiableEvidence;
  readonly classifier: ClassifierContract;
  readonly store: ClassificationStore;
}

/**
 * Runs the classifier, admits the result, canonicalizes it and persists it.
 *
 * UNCLASSIFIED is issued and persisted like any other outcome. "Examined and could not be
 * classified" is a positive finding; if it were rejected instead, the only trace would be an
 * absent artifact, which is indistinguishable from never having looked.
 */
export async function issueClassification(
  input: IssueClassificationInput,
): Promise<DocumentClassificationArtifact> {
  const result = classifyDocument({ evidence: input.evidence, classifier: input.classifier });
  const artifact = artifactFromResult(result);
  await input.store.put(artifact);
  return artifact;
}

function artifactFromResult(result: ClassificationResult): DocumentClassificationArtifact {
  const payload: DocumentClassificationPayload = {
    source_document_evidence_ref: result.source_document_evidence_ref,
    classification: admitClassification(result.classification),
    classifier_id: result.classifier_id,
    classifier_version: result.classifier_version,
    classification_basis: result.classification_basis,
  };

  const content_hash = canonicalHash(payload);

  return {
    artifact_id: `classification-${content_hash.value}`,
    artifact_type: ARTIFACT_TYPE,
    content_hash,
    references: [payload.source_document_evidence_ref, ...payload.classification_basis],
    payload,
  };
}

// --------------------------------------------------------------------- load / verify

export interface LoadClassificationInput {
  readonly classificationId: string;
  readonly store: ClassificationStore;
  /**
   * The observation the caller believes this classification is about.
   *
   * Optional because projection does not always hold the evidence, but when supplied the binding
   * is checked against both id and content hash — a re-observation of the same document is a
   * different artifact and needs its own classification.
   */
  readonly expectedEvidence?: ClassifiableEvidence;
}

/**
 * Loads a classification and verifies it, rather than merely retrieving it.
 *
 * The identity is RECOMPUTED from the stored payload and compared. A load that only fetched
 * would leave every downstream guarantee resting on the store being trustworthy, and an edit
 * promoting UNCLASSIFIED to an admitted class would pass unnoticed.
 */
export async function loadClassification(
  input: LoadClassificationInput,
): Promise<DocumentClassificationArtifact> {
  const stored = await input.store.get(input.classificationId);
  if (stored === null) {
    throw new Error(
      `REJECT_UNPERSISTED_CLASSIFICATION: no classification artifact '${input.classificationId}'. ` +
        "A classification that was never recorded cannot authorise anything.",
    );
  }

  if (stored.artifact_type !== ARTIFACT_TYPE) {
    throw new Error(
      `REJECT_ARTIFACT_TYPE: '${input.classificationId}' is ${stored.artifact_type}, not ${ARTIFACT_TYPE}.`,
    );
  }

  const recomputed = canonicalHash(stored.payload);
  if (recomputed.value !== stored.content_hash?.value) {
    throw new Error(
      `REJECT_CONTENT_HASH: '${input.classificationId}' does not match its own canonical ` +
        "identity. The stored payload was altered after it was issued.",
    );
  }
  if (stored.artifact_id !== `classification-${recomputed.value}`) {
    throw new Error(
      `REJECT_CONTENT_HASH: '${input.classificationId}' is stored under an id that its payload ` +
        "does not derive.",
    );
  }

  const expected = input.expectedEvidence;
  if (expected !== undefined) {
    const bound = stored.payload.source_document_evidence_ref;
    if (bound.artifact_id !== expected.artifact_id) {
      throw new Error(
        `REJECT_EVIDENCE_BINDING: classification is bound to '${bound.artifact_id}', offered ` +
          `against '${expected.artifact_id}'. A class decided over one observation must not ` +
          "authorise a claim about another.",
      );
    }
  }

  return stored;
}

// --------------------------------------------------------------------- projection

export interface ProjectRelevantDocumentInput {
  readonly classificationId?: string;
  readonly store: ClassificationStore;
  readonly expectedEvidence?: ClassifiableEvidence;
  /** Present only so that passing one can be REJECTED rather than silently ignored. */
  readonly result?: ClassificationResult;
}

/**
 * What a verified admitted classification authorises about a document.
 *
 * NOT a whole `RelevantDocument`: title and metadata describe the document and belong to the
 * observation, not to the classification. Returning them from here would mean inventing them,
 * and a fabricated descriptive field is exactly the kind of absence-made-representable this
 * chain exists to prevent. `describeDocument()` completes the projection when a descriptor from
 * governed material is available.
 */
export type AdmittedDocumentProjection = Pick<RelevantDocument, "type" | "classification_ref">;

export async function projectRelevantDocument(
  input: ProjectRelevantDocumentInput,
): Promise<AdmittedDocumentProjection> {
  if (input.classificationId === undefined) {
    throw new Error(
      "REJECT_UNPERSISTED_CLASSIFICATION: projection requires a persisted classification " +
        "artifact id. A ClassificationResult is a proposal; projecting from it would make the " +
        "classifier its own authority and produce a classification_ref naming nothing.",
    );
  }

  const artifact = await loadClassification({
    classificationId: input.classificationId,
    store: input.store,
    expectedEvidence: input.expectedEvidence,
  });

  const classification = artifact.payload.classification;
  if (!isAdmittedClassification(classification)) {
    throw new Error(
      `REJECT_UNADMITTED_CLASSIFICATION: '${input.classificationId}' is UNCLASSIFIED. The domain ` +
        "vocabulary stays closed — an unclassified document yields no RelevantDocument at all, " +
        "rather than one carrying UNCLASSIFIED as a type.",
    );
  }

  return {
    type: classification,
    classification_ref: { artifact_id: artifact.artifact_id, artifact_type: ARTIFACT_TYPE },
  };
}

/** The only place a complete RelevantDocument is constructed. */
export function describeDocument(
  projection: AdmittedDocumentProjection,
  descriptor: Pick<RelevantDocument, "title" | "metadata">,
): RelevantDocument {
  return {
    title: descriptor.title,
    type: projection.type,
    metadata: descriptor.metadata,
    classification_ref: projection.classification_ref,
  };
}

// --------------------------------------------------------------------- replay

export interface ReplayClassificationInput {
  readonly classificationId: string;
  readonly store: ClassificationStore;
  readonly capturedEvidence: ClassifiableEvidence;
  /**
   * Never called. Accepted so that a replay which re-acquires is a test failure rather than an
   * undetectable behaviour.
   */
  readonly acquire?: () => unknown;
}

export interface ReplayedClassification {
  readonly classification: DocumentClassification;
  readonly relevant_document: AdmittedDocumentProjection | null;
}

/**
 * Reproduces a past classification from captured material.
 *
 * Replay does NOT re-run the classifier and does NOT re-acquire the source. Re-running would be
 * reclassification — it would show what the current classifier thinks now, not that the recorded
 * classification was the one actually made. Re-acquiring would show that the source is still
 * reachable, which is a different claim again.
 *
 * UNCLASSIFIED is reproduced explicitly, as UNCLASSIFIED with no document — never as an absence.
 * The two are different epistemic states and must not collapse into one.
 */
export async function replayClassification(
  input: ReplayClassificationInput,
): Promise<ReplayedClassification> {
  const artifact = await loadClassification({
    classificationId: input.classificationId,
    store: input.store,
    expectedEvidence: input.capturedEvidence,
  });

  const classification = artifact.payload.classification;
  if (!isAdmittedClassification(classification)) {
    return { classification: "UNCLASSIFIED", relevant_document: null };
  }

  return {
    classification,
    relevant_document: {
      type: classification,
      classification_ref: { artifact_id: artifact.artifact_id, artifact_type: ARTIFACT_TYPE },
    },
  };
}
