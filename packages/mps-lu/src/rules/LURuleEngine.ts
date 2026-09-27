import { SpatialEvidenceArtifact } from "../artifacts/SpatialEvidenceArtifact";
import { DocumentEvidenceArtifact } from "../artifacts/DocumentEvidenceArtifact";
import { isDocumentEvidenceV2, type DocumentEvidenceArtifactV2 } from "../artifacts/DocumentEvidenceArtifactV2";
import { AssessmentFinding } from "../domain/AssessmentFinding";
import { ArtifactReference } from "@miljobeslut/mps-compliance/src/artifacts/ArtifactContract";
import type { SpatialLayerUnavailable } from "../services/SpatialQueryContract";
import {
  isVerifiedDocumentFact,
  type DocumentFactType,
  type VerifiedDocumentFactArtifact,
} from "../../../mps-data-governance/src/DocumentFactArtifact";

/** Either evidence contract version -- see DocumentEvidenceArtifactV2.ts for the V1/V2 split. */
export type AnyDocumentEvidenceArtifact = DocumentEvidenceArtifact | DocumentEvidenceArtifactV2;

/**
 * F4A — explicit evidence domain for rule evaluation.
 *
 * ADR-28 §3 defines the chain `Evidence → Rules → Findings → Assessment`, and
 * `DocumentEvidenceArtifact` is one of ADR-28's five artifacts. Document evidence is therefore
 * a first-class rule input, not an afterthought.
 *
 * Deliberately an explicit input object rather than a second array parameter: a positional
 * `evaluate(spatial, documents)` works today but degrades the API as soon as a third evidence
 * class appears. The evidence domain is made explicit without binding the rule engine to any
 * provider or storage.
 *
 * @see docs/architecture/F4A-IMPACT-MAP-2026-08-12.md
 * @see docs/architecture/F0C-LU-DEFECT-TRACE-2026-08-12.md (F4, cause A)
 */
export interface LURuleEvaluationInput {
  readonly spatial_evidence: readonly SpatialEvidenceArtifact[];
  readonly document_evidence: readonly AnyDocumentEvidenceArtifact[];
  /**
   * F4B — the resolved Tier 3 facts the document evidence points at.
   *
   * `fact_refs` on the evidence carries identity only (`artifact_id` + `artifact_type`) — by
   * design, proven in F4B-0B. A reference therefore cannot answer "which fact type is this",
   * so the rule engine cannot evaluate the predicate from references alone and the resolved
   * facts must be supplied.
   *
   * Typed as VERIFIED so a candidate cannot be passed at compile time. The runtime guard below
   * is not redundant: at deserialization boundaries (DB reads, JSON transport) the type is
   * erased and only the guard remains.
   *
   * Defaults to empty — absent facts must mean "no finding", never "unchecked".
   */
  readonly verified_document_facts?: readonly VerifiedDocumentFactArtifact[];
  /**
   * SEM-1/OD-03 (W2) -- layers the caller could not technically query for this evaluation
   * (`SpatialProviderPostGIS.query()`'s `SpatialQueryOutcomeV2.unavailable_layers`, or an
   * equivalent upstream source). Distinct from `spatial_evidence`'s absence of a layer, which
   * still means nothing by itself here -- only an entry in THIS field causes a `NOT_CHECKED`
   * finding. Defaults to empty: a caller that has not been updated to supply this field gets the
   * unchanged v1 behavior (silence, never a fabricated finding), not a new NOT_CHECKED finding it
   * never asked for.
   */
  readonly unavailable_layers?: readonly SpatialLayerUnavailable[];
}

/**
 * SEM-1 (W2) -- the layer-based governed rules, keyed by the `source_metadata.dataset` /
 * `unavailable_layers[].dataset` name they fire on. `LU-DOC-BESLUT-001` is deliberately absent:
 * it is predicated on document evidence and verified document facts, never on
 * `spatial_evidence`/layer availability, so a spatial layer's technical failure has no bearing on
 * it -- its own contract is unaffected by this unit and it stays at `rule_version: "1.0"`.
 */
const LAYER_RULE_IDS: Readonly<Record<string, string>> = {
  water: "LU-WATER-001",
  ebh: "LU-EBH-001",
  protected_area: "LU-PROTECTED-001",
  natura2000: "LU-NATURA2000-001",
  water_protection_area: "LU-WATERPROTECTION-001",
};

/**
 * F4B — the fact type `LU-DOC-BESLUT-001` is predicated on.
 *
 * The rule asks whether a *verified legal fact* of this type exists. It does not read document
 * text, `RelevantDocument.type`, titles or metadata, and does not keyword-match. The forbidden
 * path `text → keyword → finding` is what this constant exists to replace.
 */
const BESLUT_FACT_TYPE: DocumentFactType = "PRIOR_LOCATION_RESTRICTING_DECISION";

export class LURuleEngine {
  evaluate(input: LURuleEvaluationInput): AssessmentFinding[] {
    const findings: AssessmentFinding[] = [];

    for (const ev of input.spatial_evidence) {
      // P4A-LU-S6/P4A-LU-05: EXISTENCE_WITHIN_DISTANCE intentionally carries no geometry.
      // The executed result, not geometry presence, determines whether a finding exists.
      if (!ev.payload.result_semantics.result.exists) {
        continue;
      }
      
      const layer = ev.payload.source_metadata.dataset;
      
      if (layer === "water") {
        // Mock distance extraction or rule evaluation
        const finding: AssessmentFinding = {
          finding_id: `finding-water-${ev.artifact_id}`,
          rule_id: "LU-WATER-001",
          rule_version: "2.0",
          explanation: "Närhet till vatten kräver analys",
          risk_level: "MEDIUM",
          evidence_refs: [this.toRef(ev)],
        };
        findings.push(finding);
      }

      if (layer === "ebh") {
        const finding: AssessmentFinding = {
          finding_id: `finding-ebh-${ev.artifact_id}`,
          rule_id: "LU-EBH-001",
          rule_version: "2.0",
          explanation: "Potentiellt förorenat område inom sökradie",
          risk_level: "HIGH",
          evidence_refs: [this.toRef(ev)],
        };
        findings.push(finding);
      }

      if (layer === "protected_area") {
        const finding: AssessmentFinding = {
          finding_id: `finding-protected-${ev.artifact_id}`,
          rule_id: "LU-PROTECTED-001",
          rule_version: "2.0",
          explanation: "Skyddat naturområde påverkas av lokaliseringen",
          risk_level: "MEDIUM",
          evidence_refs: [this.toRef(ev)],
        };
        findings.push(finding);
      }

      // LU-BREADTH-01 Track A: same pattern as the three existing layer rules above --
      // EXISTENCE_WITHIN_DISTANCE + dataset match, nothing new invented.
      if (layer === "natura2000") {
        const finding: AssessmentFinding = {
          finding_id: `finding-natura2000-${ev.artifact_id}`,
          rule_id: "LU-NATURA2000-001",
          rule_version: "2.0",
          explanation: "Natura 2000-område (SPA/SCI) inom sökradie kräver särskild prövning",
          risk_level: "HIGH",
          evidence_refs: [this.toRef(ev)],
        };
        findings.push(finding);
      }

      if (layer === "water_protection_area") {
        const finding: AssessmentFinding = {
          finding_id: `finding-waterprotection-${ev.artifact_id}`,
          rule_id: "LU-WATERPROTECTION-001",
          rule_version: "2.0",
          explanation: "Vattenskyddsområde inom sökradie kräver analys av tillståndsvillkor",
          risk_level: "HIGH",
          evidence_refs: [this.toRef(ev)],
        };
        findings.push(finding);
      }
    }

    findings.push(...this.evaluateUnavailableLayers(input));
    findings.push(...this.evaluateDocumentRules(input));

    return findings;
  }

  /**
   * SEM-1/OD-03 (W2) -- one `NOT_CHECKED` finding per declared unavailable layer that has a
   * known governed rule. A layer that failed but has no entry in `LAYER_RULE_IDS` (not
   * currently a governed layer at all) produces no finding here -- there is no rule whose
   * outcome it could qualify.
   *
   * `rule_version: "2.0"` on a `NOT_CHECKED` finding is the same version as that rule's normal
   * LOW/MEDIUM/HIGH findings (bumped above): the rule's contract, not any single outcome, is
   * what changed by admitting this new non-severity state.
   */
  private evaluateUnavailableLayers(input: LURuleEvaluationInput): AssessmentFinding[] {
    const findings: AssessmentFinding[] = [];
    for (const unavailable of input.unavailable_layers ?? []) {
      const ruleId = LAYER_RULE_IDS[unavailable.dataset];
      if (!ruleId) {
        continue;
      }
      findings.push({
        finding_id: `finding-notchecked-${unavailable.dataset}`,
        rule_id: ruleId,
        rule_version: "2.0",
        risk_level: "NOT_CHECKED",
        explanation:
          `Lagret "${unavailable.dataset}" kunde inte kontrolleras (${unavailable.reason}). ` +
          "Ej kontrollerbart - underlag saknas.",
        evidence_refs: [],
      });
    }
    return findings;
  }

  /**
   * `LU-DOC-BESLUT-001` — a prior location-restricting decision exists for the subject.
   *
   * Predicate: the document evidence references a `VERIFIED_DOCUMENT_FACT` whose `fact_type` is
   * `PRIOR_LOCATION_RESTRICTING_DECISION`.
   *
   * The rule trusts the evidence's `fact_refs` to establish subject relevance and does not
   * re-check `subject_ref` against the property. That is the frozen responsibility split:
   * "LU Evidence — this verified fact is relevant evidence for this LU". Re-deciding relevance
   * here would move Tier 3 authority into the rule engine.
   *
   * One finding per evidence artifact, not per fact: the legal conclusion is singular, and every
   * fact establishing it belongs in `evidence_refs`, which is an array for that reason.
   *
   * OWNER FREEZE 2026-08-13 — RISK CALIBRATION v1:
   *
   *   PRIOR_LOCATION_RESTRICTING_DECISION
   *     → signals material relevance
   *     → does NOT by itself establish HIGH risk
   *
   * v1 says only that a prior location-restricting decision exists and must be taken into
   * account. That is materially relevant, not automatically severe. `HIGH` is reserved for a
   * later contract in which additional circumstances actually justify the grade — grading a
   * bare existence claim as HIGH would inflate every such finding and erode the distinction.
   *
   * `MEDIUM` is chosen because `risk_level` currently admits only LOW/MEDIUM/HIGH. A dedicated
   * non-severity signal (ATTENTION_REQUIRED / REVIEW_REQUIRED) would express this better, and
   * would be the right modelling change if the vocabulary is ever opened.
   *
   * @see packages/mps-data-governance/src/DocumentFactArtifact.ts (OWNER FREEZE 2026-08-12)
   */
  private evaluateDocumentRules(input: LURuleEvaluationInput): AssessmentFinding[] {
    const findings: AssessmentFinding[] = [];

    // Runtime gate — see `verified_document_facts`. A candidate reaching here is a contract
    // violation upstream, and the rule refuses it rather than trusting the declared type.
    const verifiedById = new Map<string, VerifiedDocumentFactArtifact>();
    for (const fact of input.verified_document_facts ?? []) {
      if (isVerifiedDocumentFact(fact)) {
        verifiedById.set(fact.artifact_id, fact);
      }
    }

    for (const ev of input.document_evidence) {
      // Version dispatch (LU-DOCUMENT-EVIDENCE-WIRING-V1): V1's fact_refs and V2's
      // verified_fact_refs are different fields, not renamed aliases of each other -- reading
      // V1's field name against a real V2 artifact silently finds nothing (V2 has no fact_refs
      // key at all), which would make LU-DOC-BESLUT-001 never fire for any V2 evidence
      // regardless of content. Never conflate the two field names.
      const refs = isDocumentEvidenceV2(ev) ? ev.payload.verified_fact_refs : (ev.payload.fact_refs ?? []);
      const matching = refs
        .map((ref) => verifiedById.get(ref.artifact_id))
        .filter(
          (fact): fact is VerifiedDocumentFactArtifact =>
            fact !== undefined && fact.fact_type === BESLUT_FACT_TYPE,
        );

      if (matching.length === 0) {
        continue;
      }

      findings.push({
        finding_id: `finding-doc-beslut-${ev.artifact_id}`,
        rule_id: "LU-DOC-BESLUT-001",
        rule_version: "1.0",
        risk_level: "MEDIUM",
        // Cites the fact type, never document text — the explanation must not become a back
        // door for the text the predicate is forbidden to read.
        explanation:
          "Verifierat dokumentfaktum av typen PRIOR_LOCATION_RESTRICTING_DECISION föreligger. " +
          "Tidigare lokaliseringsbegränsande beslut ska beaktas i lokaliseringsutredningen.",
        evidence_refs: [
          this.toRef(ev),
          ...matching.map((fact) => ({
            artifact_id: fact.artifact_id,
            artifact_type: fact.artifact_type,
          })),
        ],
      });
    }

    return findings;
  }

  private toRef(artifact: SpatialEvidenceArtifact | AnyDocumentEvidenceArtifact): ArtifactReference {
    return {
      artifact_id: artifact.artifact_id,
      artifact_type: artifact.artifact_type,
    };
  }
}
