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
