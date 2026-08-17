import type { ArtifactContract } from "@miljobeslut/mps-compliance/src/artifacts/ArtifactContract";
import type { ArtifactReference } from "@miljobeslut/mps-compliance/src/artifacts/ArtifactContract";
import type { RelevantDocument } from "../domain/RelevantDocument";

/**
 * 🜃 P3-LU-DOCUMENT-CLASSIFICATION-01 — DOCUMENT_EVIDENCE_CLASSIFICATION_SEPARATION_V1.
 *
 * What a document IS, recorded as its own artifact rather than as a field on the observation.
 *
 * `DocumentEvidencePayload.relevant_document` used to be REQUIRED, so an evidence artifact could
 * not exist until its document had been classified — observation was structurally forced to
 * know its own interpretation, and `materialize()` had to be handed a `documentType` before any
 * evidence existed. Gate A then proved the producer does not supply a document class per
 * publication at all, so that parameter could not be satisfied from governed material.
 *
 * The reference points BACKWARDS:
 *
 *   RawSourceArtifact → DocumentEvidenceArtifact → DocumentClassificationArtifact
 *                     → RelevantDocument → classified-document rules
 *
 * Evidence deliberately gains no `classification_ref`. Artifacts are immutable and evidence is
 * created first, so a forward reference could only be satisfied by rewriting the observation
 * once its interpretation existed. Interpretation names the observation it interprets, never
 * the reverse.
 *
 * ⚠️ This module defines the CONTRACT only. It contains no classifier: deciding between
 * decision / injunction / notification / inspection is a separate unit, and mixing the two
 * would settle policy inside a data-model change.
 *
 * @see ./DocumentEvidenceArtifact.ts
 * @see ../domain/RelevantDocument.ts
 */

/**
 * The admitted classes, plus the honest fourth outcome.
 *
 * `UNCLASSIFIED` lives HERE and never in `RelevantDocument.type`. The domain vocabulary stays
 * closed; a document that could not be classified simply yields no RelevantDocument. Without
 * this value the only signal would be an absent artifact, which is indistinguishable from never
 * having looked — the same defect as an empty harvest with no no-change evidence.
 */
export type DocumentClassification = RelevantDocument["type"] | "UNCLASSIFIED";

export interface DocumentClassificationPayload {
  /**
   * The exact evidence artifact this classifies. REQUIRED.
   *
   * Binding to the artifact rather than to a document id means the classification is attached
   * to one specific observation, with its own content hash — a later re-observation of the same
   * document is a different artifact and needs its own classification.
   */
  readonly source_document_evidence_ref: ArtifactReference;

  /** The admitted class, or UNCLASSIFIED. REQUIRED — absence is not a classification. */
  readonly classification: DocumentClassification;

  /**
   * Who decided, and which version decided it. REQUIRED.
   *
   * A classification with no attributable classifier cannot be replayed, and two classifier
   * versions disagreeing about the same evidence is a finding rather than a contradiction —
   * but only if the version is on the record.
   */
  readonly classifier_id: string;
  readonly classifier_version: string;

  /**
   * DOCUMENT_CLASSIFICATION_POLICY_BINDING_V1 — the governed rule that authorised this class.
   * REQUIRED, and part of canonical identity.
   *
   * Two independent axes. `classifier_version` versions the IMPLEMENTATION; `policy_version`
   * versions the RULE about which signals may authorise a class at all. They change
   * independently:
   *
   *   same classifier code + CLASSIFIER_POLICY_V1  -> UNCLASSIFIED
   *   same classifier code + CLASSIFIER_POLICY_V2  -> decision
   *
   * Folding the policy into `classifier_version` would force that to be recorded as an
   * implementation change that never happened — and two different authority policies would
   * otherwise share one identity space.
   */
  readonly policy_version: string;

  /**
   * What the decision was made from. Governed material only.
   *
   * Never a file name, a title, or a heuristic over either: the harvested judgments are named
   * `MMOD_..._Dom_....pdf`, and reading "Dom" out of that is precisely the inference this unit
   * exists to forbid.
   */
  readonly classification_basis: readonly ArtifactReference[];
}

export interface DocumentClassificationArtifact extends ArtifactContract {
  readonly artifact_type: "DOCUMENT_CLASSIFICATION";
  /**
   * Canonical identity over the payload.
   *
   * Identical evidence classified by an identical classifier version must reproduce an identical
   * hash, or replay cannot verify that a past classification was the one actually made.
   */
  readonly content_hash: ArtifactContract["content_hash"];
  readonly payload: DocumentClassificationPayload;
}

/** True when the classification admits a RelevantDocument. UNCLASSIFIED never does. */
export function isAdmittedClassification(
  classification: DocumentClassification,
): classification is RelevantDocument["type"] {
  return classification !== "UNCLASSIFIED";
}
