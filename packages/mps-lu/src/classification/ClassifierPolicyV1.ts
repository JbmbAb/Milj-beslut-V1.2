import type { ArtifactReference } from "@miljobeslut/mps-compliance/src/artifacts/ArtifactContract";
import { toRelevantDocumentType } from "../domain/RelevantDocument";
import type { ClassifiableEvidence, ClassifierContract } from "./DocumentClassifier";

/**
 * 🜃 P3-LU-DOCUMENT-CLASSIFICATION-01D — CLASSIFIER_POLICY_V1.
 *
 * The governed rule for which observations may authorise a document class.
 *
 *   A classification MAY be admitted only when the governing input contract contains an explicit,
 *   source-bound signal SUFFICIENT FOR THAT EXACT CLASS.
 *
 * Free text, titles, filenames, publication-form umbrella values, substring matching, defaults
 * and fallback classes MUST NOT authorize a class.
 *
 * ⚠️ CURRENT PRODUCTION COVERAGE IS ZERO ADMITTED CLASSES.
 *
 * The signal-authority recon examined every signal reaching governed material:
 *
 *   puh_typ               EJ_VAGLEDANDE, VAGLEDANDE_MEN_EJ_PREJUDICERANDE, FORHANDSAVGORANDE
 *                         → precedential weight, a different axis from document class
 *   puh_publiceringsform  DOM_ELLER_BESLUT
 *                         → source-bound, explicit, verified — and DISJUNCTIVE. It names two
 *                           classes at once. Insufficient resolution, not insufficient quality;
 *                           no implementation can repair it.
 *   puh_domstolskod       → sender identity
 *   puh_avgorandedatum    → a date
 *   puh_filnamn           → filename inference, forbidden outright
 *   decisionType          → LLM extraction shipped WITH a confidence score, i.e. an inference
 *
 * So every current observation resolves to UNCLASSIFIED. That is the correct result, not a gap:
 * the architecture can say "examined, could not be classified" instead of fabricating a legal
 * type. `ADMITTED_SOURCE_SIGNALS` is empty because nothing yet earns a place in it.
 *
 * @see ./ClassificationAuthority.ts
 * @see ./DocumentClassifier.ts
 */

/** The policy's own version. Recorded in canonical identity, separate from classifier_version. */
export const CLASSIFIER_POLICY_VERSION = "CLASSIFIER_POLICY_V1";

export const CLASSIFIER_ID = "lu-document-classifier";
export const CLASSIFIER_VERSION = "1";

/**
 * Fields that MUST NOT be consulted, so a correlation cannot become an authority by accident.
 *
 * Listed rather than merely unused: an unused field is one refactor away from being read, and
 * `..._Dom_....pdf` correlates well enough that reading it would look like it worked.
 */
export const FORBIDDEN_SIGNAL_FIELDS = Object.freeze([
  "puh_filnamn",
  "document_title",
  "title",
  "filename",
  "file_name",
  "original_path",
  "text_content",
  "decisionType",
  "decisionTypeConfidence",
  "decisionTypeSource",
]);

/**
 * Source signal → admitted class. EMPTY, deliberately.
 *
 * An entry here is a claim that one exact observed value is sufficient authority for one exact
 * class. The recon found no current source signal that precise, so the correct content today is
 * nothing at all. A fallback would be how "we could not tell" silently becomes "it is a
 * decision".
 *
 * Keyed by FIELD NAME, mapping to the single exact value that field may authorize. Admission is
 * therefore always bound to a named field — never to a value appearing loose anywhere in the
 * metadata — and the field must carry exactly that value, not merely contain it.
 */
export const ADMITTED_SOURCE_SIGNALS: Readonly<Record<string, string>> = Object.freeze({});

/**
 * ⚠️ TEST-ONLY. Represents no real source.
 *
 * Exists so a proof can show the positive branch is reachable. Without it, every negative proof
 * would also be satisfied by a policy that returns UNCLASSIFIED unconditionally — including one
 * whose positive branch is missing entirely. It is NOT evidence of coverage, and no production
 * caller may pass it.
 */
export const TEST_ONLY_SYNTHETIC_ADMITTED_SIGNALS: Readonly<Record<string, string>> = Object.freeze(
  { synthetic_test_only_document_class: "decision" },
);

export interface PolicySignalClassifierOptions {
  /**
   * Overrides the admitted signal table. Intended for proofs only; production uses the frozen
   * empty table above.
   */
  readonly admittedSignals?: Readonly<Record<string, string>>;
}

function sourceMetadataOf(evidence: ClassifiableEvidence): Readonly<Record<string, unknown>> {
  const payload = evidence.payload as { source_metadata?: Readonly<Record<string, unknown>> };
  return payload?.source_metadata ?? {};
}

/**
 * The policy classifier.
 *
 * Deterministic and pure. It reads only named fields it is explicitly allowed to read, matches
 * them against exact admitted signals, and returns UNCLASSIFIED for everything else — including
 * absent and unrecognised signals, which are findings rather than errors.
 *
 * There is no substring matching anywhere in this function, and no branch that produces a class
 * without an exact table hit.
 */
export function policySignalClassifier(
  options: PolicySignalClassifierOptions = {},
): ClassifierContract {
  const admitted = options.admittedSignals ?? ADMITTED_SOURCE_SIGNALS;

  return {
    classifier_id: CLASSIFIER_ID,
    classifier_version: CLASSIFIER_VERSION,
    classify(evidence: ClassifiableEvidence) {
      const metadata = sourceMetadataOf(evidence);
      const basis: ArtifactReference[] = [];

      for (const [field, value] of Object.entries(metadata)) {
        if (FORBIDDEN_SIGNAL_FIELDS.includes(field)) continue;
        if (typeof value !== "string") continue;

        const proposed = admitted[field];
        // Exact equality. Not `includes`, not a prefix, not a normalised comparison: the field
        // must carry precisely the value the policy admits for it.
        if (proposed === undefined || value !== proposed) continue;

        // Even an allowlisted signal must land inside the closed vocabulary. A table typo must
        // not be able to widen the domain.
        if (toRelevantDocumentType(proposed) !== proposed) continue;

        return {
          classification: proposed,
          classification_basis: [
            {
              artifact_id: evidence.artifact_id,
              artifact_type: evidence.artifact_type,
            } as ArtifactReference,
          ],
        };
      }

      return { classification: "UNCLASSIFIED", classification_basis: basis };
    },
  };
}
