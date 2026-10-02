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
export type GovernedLayerCheckStatus = 'CHECKED_NO_HIT' | 'CHECKED_HIT' | 'NOT_CHECKED';

export interface GovernedLayerCheck {
  readonly layer: string;
  readonly rule_id: string | null;
  readonly status: GovernedLayerCheckStatus;
  readonly evidence_artifact_id: string | null;
  /** Only for NOT_CHECKED: the provider's reason, 'NOT_CHECKED_FINDING', 'NO_EVIDENCE' or 'UNRECOGNIZED_RESULT'. */
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
    readonly result_semantics: { readonly result: unknown };
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
  | 'PINNED_EVIDENCE_REFS_UNREADABLE';

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
};

function pinnedIdsOfType(refs: readonly unknown[], artifactType: string): string[] {
  const ids: string[] = [];
  for (const ref of refs) {
    if (!ref || typeof ref !== 'object') continue;
    const { artifact_id: id, artifact_type: type } = ref as { artifact_id?: unknown; artifact_type?: unknown };
    if (type === artifactType && typeof id === 'string' && id.length > 0) ids.push(id);
  }
  return ids.sort();
}

/** @param pinnedEvidenceRefs the persisted assessment's own `payload.evidence_refs`. */
export function computeGovernedDocumentCheck(pinnedEvidenceRefs: unknown): GovernedDocumentCheck {
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
  const documentEvidenceIds = pinnedIdsOfType(pinnedEvidenceRefs, 'DOCUMENT_EVIDENCE');
  if (documentEvidenceIds.length === 0) return make('NOT_CHECKED', 'NO_VERIFIED_DOCUMENT_EVIDENCE_PINNED', null);
  if (pinnedIdsOfType(pinnedEvidenceRefs, 'VERIFIED_DOCUMENT_FACT').length === 0) {
    return make('NOT_CHECKED', 'DOCUMENT_EVIDENCE_WITHOUT_VERIFIED_FACT_PINNED', documentEvidenceIds[0]!);
  }
  return make('CHECKED_HIT', null, documentEvidenceIds[0]!);
}

export function computeGovernedLayerChecks(input: {
  readonly requestedLayers: readonly string[];
  readonly evidence: readonly LayerEvidenceLike[];
  readonly unavailableLayers: readonly { readonly dataset: string; readonly reason: string }[];
  readonly findings: readonly { readonly rule_id: string; readonly risk_level: string }[];
}): GovernedLayerCheck[] {
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
    if (ruleId && input.findings.some((f) => f.rule_id === ruleId && f.risk_level === 'NOT_CHECKED')) {
      return notChecked('NOT_CHECKED_FINDING');
    }

    const layerEvidence = input.evidence.filter((e) => e.payload?.source_metadata?.dataset === layer);
    if (layerEvidence.length === 0) return notChecked('NO_EVIDENCE');

    const existsValues = layerEvidence.map((e) => (e.payload.result_semantics?.result as { exists?: unknown } | undefined)?.exists);
    if (existsValues.some((v) => typeof v !== 'boolean')) return notChecked('UNRECOGNIZED_RESULT', layerEvidence[0]!.artifact_id);
    // U20-D (M2b findings 8 and 9): the server decides these, so no client has to. An evidence that
    // declares a result semantics other than the one admitted kind, or whose observed match count
    // contradicts its own `exists`, cannot be read as checked -- with or without a hit.
    const unreadable = layerEvidence.find((e) => {
      const semantics = e.payload.result_semantics as { kind?: unknown; result?: { exists?: unknown; match_count_observed?: unknown } } | undefined;
      if (semantics?.kind !== undefined && semantics.kind !== 'EXISTENCE_WITHIN_DISTANCE') return true;
      const count = semantics?.result?.match_count_observed;
      return typeof count === 'number' && (count > 0) !== semantics?.result?.exists;
    });
    if (unreadable) return notChecked('UNRECOGNIZED_RESULT', unreadable.artifact_id);

    const hit = layerEvidence.find((_, i) => existsValues[i] === true);
    return {
      layer,
      rule_id: ruleId,
      status: hit ? 'CHECKED_HIT' : 'CHECKED_NO_HIT',
      evidence_artifact_id: (hit ?? layerEvidence[0]!).artifact_id,
      reason: null,
    };
  });
}
