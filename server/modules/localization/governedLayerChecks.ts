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
 * v1 states (W-U20CDF6, OWNER DECISION OD-K0-3, 2026-10-03: CHECKED_HIT means that LU-DOC-BESLUT-001
 * ACTUALLY fired; that both reference types are pinned means only that the control basis exists):
 *  - CHECKED_HIT     the rule's inputs are pinned (at least one DOCUMENT_EVIDENCE and one
 *                    VERIFIED_DOCUMENT_FACT) AND the record holds a HIGH/MEDIUM/LOW finding of
 *                    LU-DOC-BESLUT-001 whose evidence_refs cite a pinned DOCUMENT_EVIDENCE and a pinned
 *                    VERIFIED_DOCUMENT_FACT (the rule cites exactly the evidence and the facts it fired on),
 *                    and no NOT_CHECKED finding of the rule beside it. evidence_artifact_id is the cited
 *                    document evidence. Other documents for the property are not checked; message_sv says so.
 *  - CHECKED_NO_HIT  the rule's inputs are pinned (no malformed document ref) and the record holds NO
 *                    finding of the rule: the rule was evaluated over the pinned documents and did not fire.
 *                    Only the pinned documents were checked -- never "inga tidigare beslut" (SI-2); the row
 *                    counts as completed with limited coverage (governedCoverageStatement hasLimitedCoverage).
 *  - NOT_CHECKED     otherwise, with a machine-readable reason. Without pinned inputs the absence of document
 *                    evidence still means "not checked", never "checked, nothing found" (no governed document
 *                    corpus establishes coverage for a property in v1). With pinned inputs: a risk finding
 *                    without that consistent evidence (FINDING_WITHOUT_CONSISTENT_EVIDENCE), a finding of an
 *                    unknown severity (FINDING_WITH_UNKNOWN_SEVERITY), a NOT_CHECKED finding of the rule
 *                    (NOT_CHECKED_FINDING_WITH_EVIDENCE), malformed document refs (MALFORMED_DOCUMENT_REFS) or a
 *                    findings field that is not a list (MALFORMED_RECORD_ENTRY) -- never a hit, never a no-hit.
 * A pinned document that could not be read stays PINNED_EVIDENCE_UNREADABLE (a technical error) first, never
 * "no hit". It is not a risk level: it never reads as LOW/green and does not touch overallRisk,
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
  | 'MALFORMED_DOCUMENT_REFS'
  /**
   * W-U20CDF6 (OD-K0-3): the rule's inputs are pinned and the record holds a HIGH/MEDIUM/LOW finding of the rule,
   * but not one that cites a pinned document evidence and a pinned verified fact (or a NOT_CHECKED finding of the
   * rule stands beside it) -- the same reason as a spatial row's. Not a hit, not a no-hit; the finding is named.
   */
  | 'FINDING_WITHOUT_CONSISTENT_EVIDENCE'
  /** W-U20CDF6 (OD-K0-3): a finding of the rule with a severity outside the governed values (as a spatial row). */
  | 'FINDING_WITH_UNKNOWN_SEVERITY'
  /** W-U20CDF6 (OD-K0-3): a NOT_CHECKED finding of the rule next to its pinned inputs (as a spatial row). */
  | 'NOT_CHECKED_FINDING_WITH_EVIDENCE'
  /** W-U20CDF6 (OD-K0-3): the record's findings field is not a list -- whether the rule fired cannot be read. */
  | 'MALFORMED_RECORD_ENTRY';

export interface GovernedDocumentCheck extends GovernedLayerCheck {
  readonly layer: typeof GOVERNED_DOCUMENT_CHECK_LAYER;
  readonly rule_id: typeof GOVERNED_DOCUMENT_CHECK_RULE_ID;
  /** W-U20CDF6 (OD-K0-3): CHECKED_NO_HIT only when the rule's inputs are pinned and it did not fire (see above). */
  readonly status: GovernedLayerCheckStatus;
  readonly reason: GovernedDocumentCheckReason | null;
  /** Swedish presentation of status + reason. status/reason stay the machine-readable truth. */
  readonly message_sv: string;
}

const DOCUMENT_CHECK_MESSAGE_SV: Readonly<Record<GovernedDocumentCheckReason | 'CHECKED_HIT' | 'CHECKED_NO_HIT', string>> = {
  // W-U20CDF6 (OD-K0-3): a hit is the rule's own finding, never the mere presence of its inputs.
  CHECKED_HIT:
    'Dokument och tidigare beslut: kontrollerat – träff. Regeln om tidigare lokaliseringsbegränsande beslut slog till ' +
    'för verifierat dokumentbevis som är knutet till bedömningen (se fynd). Övriga dokument för fastigheten är inte kontrollerade.',
  // W-U20CDF6 (OD-K0-3; SI-2): only the pinned documents were checked -- never "inga tidigare beslut".
  CHECKED_NO_HIT:
    'Dokument och tidigare beslut: kontrollerat – ingen träff i det dokumentunderlag som är knutet till bedömningen. ' +
    'Regeln om tidigare lokaliseringsbegränsande beslut slog inte till för det. Övriga dokument för fastigheten är inte ' +
    'kontrollerade, och att ingen träff visas betyder inte att det saknas tidigare beslut.',
  FINDING_WITHOUT_CONSISTENT_EVIDENCE:
    'Dokument och tidigare beslut: ofullständigt underlag. Bedömningen innehåller ett lagrat fynd för regeln om tidigare ' +
    'beslut, men inte det pinnade dokumentunderlag som fyndet bygger på. Kontrollen redovisas inte som genomförd; ' +
    'fyndet redovisas var för sig.',
  FINDING_WITH_UNKNOWN_SEVERITY:
    'Dokument och tidigare beslut: integritetsfel. Bedömningen innehåller ett fynd för regeln om tidigare beslut med en ' +
    'allvarlighetsgrad utanför det styrda formatet. Ingen slutsats om dokument eller tidigare beslut.',
  NOT_CHECKED_FINDING_WITH_EVIDENCE:
    'Dokument och tidigare beslut: integritetsfel. Bedömningen innehåller både det dokumentunderlag som regeln om ' +
    'tidigare beslut läser och ett fynd om att regeln inte kunde kontrolleras. Ingen slutsats om dokument eller tidigare beslut.',
  MALFORMED_RECORD_ENTRY:
    'Dokument och tidigare beslut: inte kontrollerat. Bedömningens fynd kan inte läsas, så det går inte att avgöra om ' +
    'regeln om tidigare beslut slog till. Ingen slutsats om dokument eller tidigare beslut.',
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
    'inte läsas ur arkivet och kan därför inte verifieras. Kontrollen redovisas inte som genomförd, och ingen ' +
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
 * W-U20CDF6 (OD-K0-3): the refs ALONE pin what LU-DOC-BESLUT-001 reads -- at least one DOCUMENT_EVIDENCE and one
 * VERIFIED_DOCUMENT_FACT with a non-empty string id -- known without reading any artifact and without the findings.
 * It says that the control basis exists, never that the rule fired (formerly the CHECKED_HIT condition).
 */
export function documentRuleInputsPinned(pinnedEvidenceRefs: unknown): boolean {
  return (
    Array.isArray(pinnedEvidenceRefs) &&
    pinnedIdsOfType(pinnedEvidenceRefs, 'DOCUMENT_EVIDENCE').length > 0 &&
    pinnedIdsOfType(pinnedEvidenceRefs, 'VERIFIED_DOCUMENT_FACT').length > 0
  );
}

/**
 * @param pinnedEvidenceRefs the persisted assessment's own `payload.evidence_refs`.
 * @param options.findings W-U20CDF6 (OD-K0-3): the SAME record's stored findings (`payload.findings`, as stored) --
 *        whether LU-DOC-BESLUT-001 fired is read from them; required, so no caller can forget them and turn a hit
 *        into "no hit". A value that is not a list cannot say whether the rule fired (MALFORMED_RECORD_ENTRY).
 * @param options.unreadableArtifactIds U20CDF: ids of pinned refs the caller tried to read from CAS
 *        and could not (the read-back passes them; the fresh run has just resolved its documents and
 *        passes none). A pinned document artifact among them makes the check a technical error.
 */
export function computeGovernedDocumentCheck(
  pinnedEvidenceRefs: unknown,
  options: { readonly findings: unknown; readonly unreadableArtifactIds?: readonly string[] },
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
    message_sv: DOCUMENT_CHECK_MESSAGE_SV[reason ?? (status === 'CHECKED_NO_HIT' ? 'CHECKED_NO_HIT' : 'CHECKED_HIT')],
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
  const verifiedFactIds = pinnedIdsOfType(pinnedEvidenceRefs, 'VERIFIED_DOCUMENT_FACT');
  if (verifiedFactIds.length === 0) {
    return make(
      'NOT_CHECKED',
      hasMalformedDocumentRef ? 'MALFORMED_DOCUMENT_REFS' : 'DOCUMENT_EVIDENCE_WITHOUT_VERIFIED_FACT_PINNED',
      documentEvidenceIds[0]!,
    );
  }
  // W-U20CDF6 (OWNER DECISION OD-K0-3, 2026-10-03): the rule's inputs are pinned -- the control basis exists. What
  // the row says now rests on what the rule DID, read from the same record's findings.
  if (!Array.isArray(options.findings)) return make('NOT_CHECKED', 'MALFORMED_RECORD_ENTRY', documentEvidenceIds[0]!);
  const ruleFindings = options.findings.filter(
    (finding): finding is { readonly rule_id?: unknown; readonly risk_level?: unknown; readonly evidence_refs?: unknown } =>
      isFindingObject(finding) && finding.rule_id === GOVERNED_DOCUMENT_CHECK_RULE_ID,
  );
  const hasNotCheckedFinding = ruleFindings.some((finding) => finding.risk_level === 'NOT_CHECKED');
  const riskFindings = ruleFindings.filter(isGovernedRiskFinding);
  if (riskFindings.length > 0) {
    // The rule fired: a hit only with the evidence it fires on -- the finding cites a pinned DOCUMENT_EVIDENCE and a
    // pinned VERIFIED_DOCUMENT_FACT (LURuleEngine: evidence_refs = [the evidence, ...its matching facts]).
    const pinnedEvidence = new Set(documentEvidenceIds);
    const pinnedFacts = new Set(verifiedFactIds);
    const citedEvidenceIds = riskFindings
      .flatMap((finding) => {
        const cited = Array.isArray(finding.evidence_refs) ? (finding.evidence_refs as readonly unknown[]) : [];
        const ids = (type: string, pinned: ReadonlySet<string>) =>
          cited
            .map((ref) => (ref && typeof ref === 'object' ? (ref as { artifact_id?: unknown; artifact_type?: unknown }) : null))
            .filter((ref) => ref?.artifact_type === type && typeof ref.artifact_id === 'string' && pinned.has(ref.artifact_id))
            .map((ref) => ref!.artifact_id as string);
        const evidence = ids('DOCUMENT_EVIDENCE', pinnedEvidence);
        return evidence.length > 0 && ids('VERIFIED_DOCUMENT_FACT', pinnedFacts).length > 0 ? evidence : [];
      })
      .sort();
    return citedEvidenceIds.length > 0 && !hasNotCheckedFinding
      ? make('CHECKED_HIT', null, citedEvidenceIds[0]!)
      : make('NOT_CHECKED', 'FINDING_WITHOUT_CONSISTENT_EVIDENCE', documentEvidenceIds[0]!);
  }
  if (ruleFindings.some(isUnknownSeverityFinding)) return make('NOT_CHECKED', 'FINDING_WITH_UNKNOWN_SEVERITY', documentEvidenceIds[0]!);
  if (hasNotCheckedFinding) return make('NOT_CHECKED', 'NOT_CHECKED_FINDING_WITH_EVIDENCE', documentEvidenceIds[0]!);
  // No finding of the rule: it did not fire over the pinned documents -- unless a malformed document ref leaves open
  // which documents the basis holds (then nothing is claimed).
  if (hasMalformedDocumentRef) return make('NOT_CHECKED', 'MALFORMED_DOCUMENT_REFS', documentEvidenceIds[0]!);
  return make('CHECKED_NO_HIT', null, documentEvidenceIds[0]!);
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

/**
 * W-U20CDF5 (U20CDF4 verification L5): the governed rule REGISTRY -- the five layer rules and
 * LU-DOC-BESLUT-001, the only rule ids any LU producer has ever written (LURuleEngine's whole history). A
 * stored rule id is echoed to a client only when it is one of these; anything else, a plain identifier
 * included, is named by a neutral label.
 */
export function isGovernedRuleId(ruleId: unknown): ruleId is string {
  return typeof ruleId === 'string' && (ruleId === GOVERNED_DOCUMENT_CHECK_RULE_ID || governedLayerOfRule(ruleId) !== null);
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
