/**
 * DEMO M1a -- U12 (honesty of the live "Underlag" list).
 *
 * Per governed spatial layer: was it actually CHECKED by the governed query (with or without a
 * hit), or NOT checked? Derived only from what the governed run itself produced -- the spatial
 * evidence artifacts (`source_metadata.dataset` + `result_semantics.result.exists`), the provider's
 * `unavailable_layers`, and the existing NOT_CHECKED findings. It adds a signal for the UI; it
 * replaces nothing: NOT_CHECKED findings and `unresolvedChecks` stay exactly as they are.
 *
 * Silence is never "checked": a requested layer with neither evidence nor an unavailable entry is
 * NOT_CHECKED (reason NO_EVIDENCE), never CHECKED_NO_HIT.
 *
 * K0: the document check (`computeGovernedDocumentCheck` below) uses the same shape with
 * `layer: 'document'`, but is derived from the assessment's pinned evidence refs only.
 *
 * U20-D: the product calls this through governedEvidenceDetails.presentedGovernedLayerChecks for
 * the fresh run, the read-back and the PDF alike, over the PERSISTED inputs (stored evidence +
 * stored findings); a layer whose query failed is seen through its NOT_CHECKED finding there.
 */
import { declaresSpatialResultContract, readSpatialEvidenceForm } from './governedSpatialEvidenceForm';

export type GovernedLayerCheckStatus = 'CHECKED_NO_HIT' | 'CHECKED_HIT' | 'NOT_CHECKED';

export interface GovernedLayerCheck {
  readonly layer: string;
  readonly rule_id: string | null;
  readonly status: GovernedLayerCheckStatus;
  readonly evidence_artifact_id: string | null;
  /**
   * For NOT_CHECKED: the provider's reason, 'NOT_CHECKED_FINDING', 'NO_EVIDENCE',
   * 'UNRECOGNIZED_RESULT' or 'PINNED_EVIDENCE_UNREADABLE'; U20CDF3 (low 4):
   * 'NOT_CHECKED_FINDING_WITH_EVIDENCE' when the record also holds evidence for the layer (an invalid
   * combination; evidence_artifact_id then names that evidence); U20CDF3 (low 3):
   * 'FINDING_WITH_UNKNOWN_SEVERITY' for a stored finding of the layer's rule with an unknown severity;
   * 'DUPLICATE_LAYER_EVIDENCE' (also on a CHECKED_HIT) when the record holds more than one evidence for
   * the layer -- the gate admits one outcome per layer.
   * U20CDF4 (owner decision 2): 'EVIDENCE_VIOLATES_RESULT_CONTRACT' (also on a CHECKED_HIT) for stored
   * evidence that declares the result contract (has result_semantics) but is outside the normal form --
   * an integrity error; 'UNRECOGNIZED_RESULT' is kept for evidence from before the contract.
   * U20CDF2: on a CHECKED_HIT only 'FINDING_WITHOUT_CONSISTENT_EVIDENCE' (a stored risk finding whose
   * record lacks the consistent evidence a current run pins); null on every consistent check.
   */
  readonly reason: string | null;
}

/** Same mapping as packages/mps-lu LURuleEngine's LAYER_RULE_IDS (read-only mirror for labelling). */
const LAYER_RULE_IDS: Readonly<Record<string, string>> = {
  water: 'LU-WATER-001',
  ebh: 'LU-EBH-001',
  protected_area: 'LU-PROTECTED-001',
  natura2000: 'LU-NATURA2000-001',
  water_protection_area: 'LU-WATERPROTECTION-001',
};

interface LayerEvidenceLike {
  readonly artifact_id: string;
  readonly payload: {
    readonly source_metadata: { readonly dataset: string };
    readonly result_semantics: { readonly result?: unknown };
  };
}

/**
 * K0 (DOC-EVIDENCE-CENSUS 2026-10-02; owner recommendation OD-DOC-3: derived in the read model, not
 * a rule finding) -- the governed document check ("Dokument och tidigare beslut"), returned as the
 * element `layer: 'document'` next to the spatial layer checks.
 *
 * Derived ONLY from the assessment's PINNED `evidence_refs` -- the refs inside the persisted,
 * content-addressed LocalizationAssessmentArtifact -- never from a live read, never from the request
 * draft and never from stored findings. A fresh run, a read-back (re-open) and the PDF compute it
 * from the same pinned refs and therefore show the same thing.
 *
 * v1 states:
 *  - CHECKED_HIT  at least one DOCUMENT_EVIDENCE and at least one VERIFIED_DOCUMENT_FACT are pinned
 *                 (exactly the inputs LU-DOC-BESLUT-001 reads). Other documents for the property are
 *                 still unchecked, and message_sv says so.
 *  - NOT_CHECKED  otherwise, with a machine-readable reason.
 * Never CHECKED_NO_HIT: in v1 no governed document corpus establishes coverage for a property, so
 * the absence of pinned document evidence means "not checked", never "checked, nothing found". It
 * is not a risk level either: it never reads as LOW/green and does not touch overallRisk,
 * permitProbability, findings or unresolvedChecks (presentation on top, never a replacement).
 */
export const GOVERNED_DOCUMENT_CHECK_LAYER = 'document';
export const GOVERNED_DOCUMENT_CHECK_RULE_ID = 'LU-DOC-BESLUT-001';

export type GovernedDocumentCheckReason =
  | 'NO_VERIFIED_DOCUMENT_EVIDENCE_PINNED'
  | 'DOCUMENT_EVIDENCE_WITHOUT_VERIFIED_FACT_PINNED'
  | 'PINNED_EVIDENCE_REFS_UNREADABLE'
  /**
   * U20CDF (U20CD verification F3; OD-R2): a pinned DOCUMENT_EVIDENCE / VERIFIED_DOCUMENT_FACT could
   * not be read from CAS at read-back. The same reason (and coverage_state TECHNICAL_ERROR) as an
   * unreadable pinned spatial evidence; never CHECKED_HIT, never a plain "not checked".
   */
  | 'PINNED_EVIDENCE_UNREADABLE'
  /**
   * U20CDF (K0 verification finding 5, K0-FIX-1 c): the pinned refs contain an entry that may be a
   * document ref but cannot be interpreted (not an object, no type, a document type in the wrong
   * spelling, or a document type without a string id). Status stays NOT_CHECKED; the reason says
   * exactly why instead of the misleading "no verified document evidence pinned".
   */
  | 'MALFORMED_DOCUMENT_REFS';

export interface GovernedDocumentCheck extends GovernedLayerCheck {
  readonly layer: typeof GOVERNED_DOCUMENT_CHECK_LAYER;
  readonly rule_id: typeof GOVERNED_DOCUMENT_CHECK_RULE_ID;
  readonly status: Exclude<GovernedLayerCheckStatus, 'CHECKED_NO_HIT'>;
  readonly reason: GovernedDocumentCheckReason | null;
  /** Swedish presentation of status + reason. status/reason stay the machine-readable truth. */
  readonly message_sv: string;
}

const DOCUMENT_CHECK_MESSAGE_SV: Readonly<Record<GovernedDocumentCheckReason | 'CHECKED_HIT', string>> = {
  CHECKED_HIT:
    'Dokument och tidigare beslut: kontrollerat – träff. Bedömningen innehåller verifierat dokumentbevis ' +
    '(se fynd). Övriga dokument för fastigheten är inte kontrollerade.',
  NO_VERIFIED_DOCUMENT_EVIDENCE_PINNED:
    'Dokument och tidigare beslut: inte kontrollerat. Bedömningen innehåller inget verifierat dokumentbevis ' +
    'för fastigheten. Att inga dokumentfynd visas betyder inte att det saknas tidigare beslut.',
  DOCUMENT_EVIDENCE_WITHOUT_VERIFIED_FACT_PINNED:
    'Dokument och tidigare beslut: inte kontrollerat. Bedömningen innehåller dokumentunderlag men inget ' +
    'mänskligt verifierat dokumentfaktum, så underlaget har inte prövats mot regeln om tidigare beslut.',
  PINNED_EVIDENCE_REFS_UNREADABLE:
    'Dokument och tidigare beslut: inte kontrollerat. Bedömningens evidensreferenser kunde inte läsas.',
  PINNED_EVIDENCE_UNREADABLE:
    'Dokument och tidigare beslut: tekniskt fel. Dokumentunderlaget som bedömningen är bunden till kunde ' +
    'inte läsas ur CAS och kan därför inte verifieras. Kontrollen redovisas inte som genomförd, och ingen ' +
    'slutsats dras om dokument eller tidigare beslut.',
  MALFORMED_DOCUMENT_REFS:
    'Dokument och tidigare beslut: inte kontrollerat. Bedömningens evidensreferenser innehåller felformade ' +
    'poster som inte kan tolkas, så det går inte att avgöra vilket dokumentunderlag som ingår.',
};

const DOCUMENT_REF_TYPES = ['DOCUMENT_EVIDENCE', 'VERIFIED_DOCUMENT_FACT'] as const;

/**
 * U20CDF (K0-FIX-1 c): an entry that may be a document ref but cannot be read as one. A well-formed
 * ref of another family (e.g. SPATIAL_EVIDENCE) is not a document ref and does not count here.
 */
function isMalformedDocumentRef(ref: unknown): boolean {
  if (!ref || typeof ref !== 'object') return true;
  const { artifact_id: id, artifact_type: type } = ref as { artifact_id?: unknown; artifact_type?: unknown };
  if (typeof type !== 'string' || type.trim().length === 0) return true;
  const normalized = type.trim().toUpperCase();
  if (!(DOCUMENT_REF_TYPES as readonly string[]).includes(normalized)) return false;
  return type !== normalized || typeof id !== 'string' || id.length === 0;
}

function pinnedIdsOfType(refs: readonly unknown[], artifactType: string): string[] {
  const ids: string[] = [];
  for (const ref of refs) {
    if (!ref || typeof ref !== 'object') continue;
    const { artifact_id: id, artifact_type: type } = ref as { artifact_id?: unknown; artifact_type?: unknown };
    if (type === artifactType && typeof id === 'string' && id.length > 0) ids.push(id);
  }
  return ids.sort();
}

/**
 * @param pinnedEvidenceRefs the persisted assessment's own `payload.evidence_refs`.
 * @param options.unreadableArtifactIds U20CDF: ids of pinned refs the caller tried to read from CAS
 *        and could not (the read-back passes them; the fresh run has just resolved its documents and
 *        passes none). A pinned document artifact among them makes the check a technical error.
 */
export function computeGovernedDocumentCheck(
  pinnedEvidenceRefs: unknown,
  options: { readonly unreadableArtifactIds?: readonly string[] } = {},
): GovernedDocumentCheck {
  const make = (
    status: GovernedDocumentCheck['status'],
    reason: GovernedDocumentCheckReason | null,
    evidenceArtifactId: string | null,
  ): GovernedDocumentCheck => ({
    layer: GOVERNED_DOCUMENT_CHECK_LAYER,
    rule_id: GOVERNED_DOCUMENT_CHECK_RULE_ID,
    status,
    evidence_artifact_id: evidenceArtifactId,
    reason,
    message_sv: DOCUMENT_CHECK_MESSAGE_SV[reason ?? 'CHECKED_HIT'],
  });

  if (!Array.isArray(pinnedEvidenceRefs)) return make('NOT_CHECKED', 'PINNED_EVIDENCE_REFS_UNREADABLE', null);
  const hasMalformedDocumentRef = pinnedEvidenceRefs.some(isMalformedDocumentRef);
  const unreadable = new Set(options.unreadableArtifactIds ?? []);
  const unreadableDocumentIds = [
    ...pinnedIdsOfType(pinnedEvidenceRefs, 'DOCUMENT_EVIDENCE'),
    ...pinnedIdsOfType(pinnedEvidenceRefs, 'VERIFIED_DOCUMENT_FACT'),
  ]
    .filter((id) => unreadable.has(id))
    .sort();
  if (unreadableDocumentIds.length > 0) {
    // The assessment says it is bound to document evidence that cannot be read back: technical error.
    return make('NOT_CHECKED', 'PINNED_EVIDENCE_UNREADABLE', unreadableDocumentIds[0]!);
  }
  const documentEvidenceIds = pinnedIdsOfType(pinnedEvidenceRefs, 'DOCUMENT_EVIDENCE');
  // K0-FIX-1 c: where the result is NOT_CHECKED, a malformed entry is the exact reason -- never the
  // misleading "nothing pinned". (A CHECKED_HIT from well-formed refs is left as K0 defines it.)
  if (documentEvidenceIds.length === 0) {
    return make('NOT_CHECKED', hasMalformedDocumentRef ? 'MALFORMED_DOCUMENT_REFS' : 'NO_VERIFIED_DOCUMENT_EVIDENCE_PINNED', null);
  }
  if (pinnedIdsOfType(pinnedEvidenceRefs, 'VERIFIED_DOCUMENT_FACT').length === 0) {
    return make(
      'NOT_CHECKED',
      hasMalformedDocumentRef ? 'MALFORMED_DOCUMENT_REFS' : 'DOCUMENT_EVIDENCE_WITHOUT_VERIFIED_FACT_PINNED',
      documentEvidenceIds[0]!,
    );
  }
  // OD-K0-3 (open owner question, not changed here): CHECKED_HIT follows from the pinned ref TYPES
  // (DE + VF), not from LU-DOC-BESLUT-001 actually having produced a finding for them.
  return make('CHECKED_HIT', null, documentEvidenceIds[0]!);
}

/** The governed severities. NOT_CHECKED is a non-severity state (SEM-1) and is not among them. */
export const GOVERNED_RISK_LEVELS: readonly string[] = ['HIGH', 'MEDIUM', 'LOW'];

export function isGovernedRiskFinding(finding: { readonly risk_level?: unknown } | null | undefined): boolean {
  return typeof finding?.risk_level === 'string' && GOVERNED_RISK_LEVELS.includes(finding.risk_level);
}

/**
 * U20CDF3 (U20CDF2 verification H4 / low 3): every value a governed finding may carry -- the three
 * severities and the non-severity state NOT_CHECKED. Anything else ('high', ' HIGH', 'CRITICAL', '',
 * null, a number...) is an unknown severity: never silently ignored (an integrity error, named).
 */
export const GOVERNED_FINDING_LEVELS: readonly string[] = [...GOVERNED_RISK_LEVELS, 'NOT_CHECKED'];

export function isUnknownSeverityFinding(finding: { readonly risk_level?: unknown } | null | undefined): boolean {
  return !(typeof finding?.risk_level === 'string' && GOVERNED_FINDING_LEVELS.includes(finding.risk_level));
}

/**
 * U20CDF4 (U20CDF3 verification L6.3; owner decision 2): a stored `findings` entry that is not an object
 * at all (null, a number, a string, an array) -- it carries nothing the read model can name.
 */
export function isFindingObject(finding: unknown): finding is { readonly rule_id?: unknown; readonly risk_level?: unknown; readonly evidence_refs?: unknown } {
  return Boolean(finding) && typeof finding === 'object' && !Array.isArray(finding);
}

/**
 * U20CDF4 (L6.3): a stored finding that breaks the finding contract (AssessmentFinding): not an object,
 * a rule id that is not a non-empty string, or evidence refs that are present but not a list. No
 * producer writes one; it made the read-back throw (a generic 500). It is a typed integrity error
 * (MALFORMED_RECORD_ENTRY); a risk level it still carries is named, never dropped.
 */
export function isMalformedFinding(finding: unknown): boolean {
  if (!isFindingObject(finding)) return true;
  const { rule_id: ruleId, evidence_refs: refs } = finding;
  return typeof ruleId !== 'string' || ruleId.length === 0 || (refs !== undefined && !Array.isArray(refs));
}

/** The governed rule of an LU v1 spatial layer (null for a layer without one). */
export function governedLayerRuleId(layer: string): string | null {
  return LAYER_RULE_IDS[layer] ?? null;
}

/** The LU v1 spatial layer a governed rule belongs to (null for any other rule). */
export function governedLayerOfRule(ruleId: string): string | null {
  return Object.keys(LAYER_RULE_IDS).find((layer) => LAYER_RULE_IDS[layer] === ruleId) ?? null;
}

export interface LayerCheckFindingLike {
  readonly rule_id: string;
  readonly risk_level: string;
  readonly evidence_refs?: readonly { readonly artifact_id: string }[];
}

/**
 * U20CDF2 (U20CDF verification G1-G3; owner's locked specification 2026-10-02 night): the ONE
 * derivation of a spatial layer's check from the assessment's stored record -- its findings (the
 * rule engine's outcome) and its evidence, read through the common normal form
 * (governedSpatialEvidenceForm.ts) that also gates the fresh run before the rule engine.
 *
 * Order, per layer:
 *  1. a live provider `unavailable` entry (only callers that pass one) -> NOT_CHECKED (its reason);
 *  2. a stored HIGH/MEDIUM/LOW finding of the layer's rule: the layer WAS processed by the rule
 *     engine and counts as completed (owner invariant) -> CHECKED_HIT, unless the read-back could not
 *     read the evidence that finding cites (PINNED_EVIDENCE_UNREADABLE: an integrity/technical error,
 *     never a new coverage computation). When the record does not hold the consistent evidence the
 *     current producer pins with every such finding (one valid evidence with exists:true, all of the
 *     layer's evidence in the normal form, no NOT_CHECKED finding beside it) the row says so:
 *     reason FINDING_WITHOUT_CONSISTENT_EVIDENCE -- still completed, never hidden;
 *  3. a stored NOT_CHECKED finding -> NOT_CHECKED (NOT_CHECKED_FINDING); U20CDF3 (low 4): beside
 *     stored evidence for the layer (a combination the fresh-run gate rejects and no known producer
 *     writes) -> NOT_CHECKED with reason NOT_CHECKED_FINDING_WITH_EVIDENCE, which makes the record a
 *     RECORD_INTEGRITY_ERROR -- the finding still wins (never a no-hit), and never "0 av M";
 *  4. no evidence -> NOT_CHECKED (NO_EVIDENCE: silence is never "checked");
 *  5. evidence outside the normal form -> NOT_CHECKED: U20CDF4 (owner decision 2) EVIDENCE_VIOLATES_RESULT_CONTRACT
 *     when it declares the result contract (an integrity error), UNRECOGNIZED_RESULT when it predates
 *     the contract (historical);
 *  6. otherwise CHECKED_HIT / CHECKED_NO_HIT from `exists`, exactly as the rule engine reads it.
 *
 * @param unreadableArtifactIds ids of pinned refs the read-back could not read from CAS.
 */
export function computeGovernedLayerChecks(input: {
  readonly requestedLayers: readonly string[];
  readonly evidence: readonly LayerEvidenceLike[];
  readonly unavailableLayers: readonly { readonly dataset: string; readonly reason: string }[];
  readonly findings: readonly LayerCheckFindingLike[];
  readonly unreadableArtifactIds?: readonly string[];
}): GovernedLayerCheck[] {
  const unreadable = new Set(input.unreadableArtifactIds ?? []);
  return input.requestedLayers.map((layer): GovernedLayerCheck => {
    const ruleId = LAYER_RULE_IDS[layer] ?? null;
    const notChecked = (reason: string, evidenceId: string | null = null): GovernedLayerCheck => ({
      layer,
      rule_id: ruleId,
      status: 'NOT_CHECKED',
      evidence_artifact_id: evidenceId,
      reason,
    });

    const unavailable = input.unavailableLayers.find((u) => u.dataset === layer);
    if (unavailable) return notChecked(unavailable.reason);

    const layerEvidence = input.evidence.filter((e) => e.payload?.source_metadata?.dataset === layer);
    // U20CDF2 (G3): the same normal form the fresh-run gate applies before the rule engine.
    const forms = layerEvidence.map((e) => readSpatialEvidenceForm(e));
    // U20CDF4 (L6.3): a stored entry that is not an object is never read here (it used to throw).
    const ruleFindings = ruleId ? input.findings.filter((f) => isFindingObject(f) && f.rule_id === ruleId) : [];
    const riskFindings = ruleFindings.filter(isGovernedRiskFinding);
    const hasNotCheckedFinding = ruleFindings.some((f) => f.risk_level === 'NOT_CHECKED');

    if (riskFindings.length > 0) {
      const unreadableCited = riskFindings
        .flatMap((f) => (Array.isArray(f.evidence_refs) ? f.evidence_refs : []))
        .map((ref) => ref?.artifact_id)
        .filter((id): id is string => typeof id === 'string' && unreadable.has(id))
        .sort();
      if (unreadableCited.length > 0) return notChecked('PINNED_EVIDENCE_UNREADABLE', unreadableCited[0]!);
      const hitIndex = forms.findIndex((form) => form.valid && form.exists);
      const consistent = hitIndex >= 0 && forms.every((form) => form.valid) && !hasNotCheckedFinding;
      // U20CDF4 (owner decision 2): evidence that declares the result contract and breaks it.
      const violatesContract = forms.some((form, index) => !form.valid && declaresSpatialResultContract(layerEvidence[index]));
      return {
        layer,
        rule_id: ruleId,
        status: 'CHECKED_HIT',
        evidence_artifact_id: hitIndex >= 0 ? layerEvidence[hitIndex]!.artifact_id : (layerEvidence[0]?.artifact_id ?? null),
        // U20CDF3 (low 7b): still completed (a known risk), but more than one evidence for one layer is
        // an invalid combination (RECORD_INTEGRITY_ERROR), not merely an inconsistent one; U20CDF4: so is
        // evidence that breaks the result contract it declares.
        reason:
          layerEvidence.length > 1
            ? 'DUPLICATE_LAYER_EVIDENCE'
            : violatesContract
              ? 'EVIDENCE_VIOLATES_RESULT_CONTRACT'
              : consistent
                ? null
                : 'FINDING_WITHOUT_CONSISTENT_EVIDENCE',
      };
    }
    // U20CDF3 (low 3): a finding of the layer's rule with a severity outside the governed values cannot
    // be read as a risk or as "not checked" -- an integrity error for the row (never "ingen träff").
    if (ruleFindings.some(isUnknownSeverityFinding)) {
      return notChecked('FINDING_WITH_UNKNOWN_SEVERITY', layerEvidence[0]?.artifact_id ?? null);
    }
    if (hasNotCheckedFinding) {
      return layerEvidence.length > 0
        ? notChecked('NOT_CHECKED_FINDING_WITH_EVIDENCE', layerEvidence[0]!.artifact_id)
        : notChecked('NOT_CHECKED_FINDING');
    }
    if (layerEvidence.length === 0) return notChecked('NO_EVIDENCE');
    // U20CDF3 (low 7b; found by the specification oracle): two evidences for one layer -- e.g. a hit and
    // a no-hit -- are not one query's outcome; the gate rejects them (DUPLICATE_LAYER_OUTCOME), and a
    // stored record holding them is an integrity error, never "checked".
    if (layerEvidence.length > 1) return notChecked('DUPLICATE_LAYER_EVIDENCE', layerEvidence[0]!.artifact_id);

    // U20-D (M2b findings 8 and 9), now through the one normal form: an evidence that declares
    // another result kind, a non-boolean `exists`, or a match count contradicting it cannot be read
    // as checked -- with or without a hit.
    // U20CDF4 (owner decision 2): evidence that declares the result contract and breaks it is an
    // integrity error (EVIDENCE_VIOLATES_RESULT_CONTRACT); evidence from before the contract stays
    // historical (UNRECOGNIZED_RESULT). Neither is ever read as checked.
    const invalidIndex = forms.findIndex((form) => !form.valid);
    if (invalidIndex >= 0) {
      const invalid = layerEvidence[invalidIndex]!;
      return notChecked(declaresSpatialResultContract(invalid) ? 'EVIDENCE_VIOLATES_RESULT_CONTRACT' : 'UNRECOGNIZED_RESULT', invalid.artifact_id);
    }

    const hitIndex = forms.findIndex((form) => form.valid && form.exists);
    return {
      layer,
      rule_id: ruleId,
      status: hitIndex >= 0 ? 'CHECKED_HIT' : 'CHECKED_NO_HIT',
      evidence_artifact_id: layerEvidence[hitIndex >= 0 ? hitIndex : 0]!.artifact_id,
      reason: null,
    };
  });
}
