/**
 * LU-RESULT-PRESENTATION-MODEL-V1.
 *
 * Pure, isolated presentation mapping from a governed finding's `rule_id`/`risk_level` to
 * human-facing Swedish category/attention labels. Deliberately does not import from
 * `@miljobeslut/mps-lu` or touch `LURuleEngine.ts` -- the rule_id vocabulary is treated as an
 * opaque string contract between the engine and this presentation layer, so this module can be
 * built and shipped independently of concurrent engine-side work on the rule set.
 *
 * This module invents no new severity semantics: `risk_level` stays exactly LOW/MEDIUM/HIGH as
 * produced by the engine (see the OWNER FREEZE 2026-08-13 comment on LU-DOC-BESLUT-001 in
 * LURuleEngine.ts for why MEDIUM there means "materially relevant", not "automatically severe") --
 * this only gives each value a human label, it does not re-grade anything.
 */

import { checkDefinitionForRule } from "./luControlChecks";

export type LuFindingCategory =
  | "WATER"
  | "EBH"
  | "PROTECTED_AREA"
  | "NATURA2000"
  | "WATER_PROTECTION_AREA"
  | "DOCUMENT_DECISION"
  | "UNKNOWN";

export interface LuFindingPresentation {
  readonly category: LuFindingCategory;
  readonly categoryLabel: string;
  readonly attentionLabel: string;
}

interface LuFindingPresentationInput {
  readonly rule_id: string;
  /** DEMO M2a: NOT_CHECKED is a real governed risk_level (LURuleEngine evaluateUnavailableLayers). */
  readonly risk_level: "LOW" | "MEDIUM" | "HIGH" | "NOT_CHECKED" | string;
}

const CATEGORY_BY_RULE_ID: Readonly<Record<string, { category: LuFindingCategory; categoryLabel: string }>> = {
  // DEMO M2a: the governed `water` layer is the WELLS layer (lu.water_wells), so the label is "Brunnar".
  "LU-WATER-001": { category: "WATER", categoryLabel: "Brunnar" },
  "LU-EBH-001": { category: "EBH", categoryLabel: "Potentiellt förorenat område (EBH)" },
  "LU-PROTECTED-001": { category: "PROTECTED_AREA", categoryLabel: "Skyddad natur" },
  "LU-NATURA2000-001": { category: "NATURA2000", categoryLabel: "Natura 2000" },
  "LU-WATERPROTECTION-001": { category: "WATER_PROTECTION_AREA", categoryLabel: "Vattenskyddsområde" },
  "LU-DOC-BESLUT-001": { category: "DOCUMENT_DECISION", categoryLabel: "Tidigare beslut" },
};

const ATTENTION_LABEL_BY_RISK_LEVEL: Readonly<Record<string, string>> = {
  HIGH: "Kräver uppmärksamhet",
  MEDIUM: "Bör utredas vidare",
  LOW: "Låg risk",
  NOT_CHECKED: "Ej kontrollerad",
};

/** W-M2e item 2: the label of a level the engine produces; never an Object.prototype member ("constructor"). */
function attentionLabelOf(riskLevel: unknown): string | undefined {
  return typeof riskLevel === "string" && Object.prototype.hasOwnProperty.call(ATTENTION_LABEL_BY_RISK_LEVEL, riskLevel)
    ? ATTENTION_LABEL_BY_RISK_LEVEL[riskLevel]
    : undefined;
}

/**
 * Never throws and never silently drops a finding: an unrecognized `rule_id` maps to the explicit
 * UNKNOWN category rather than being mis-categorized or hidden, so a new engine rule that ships
 * ahead of its presentation label is still visible to the user, just not yet grouped.
 */
export function presentLuFinding(finding: LuFindingPresentationInput): LuFindingPresentation {
  const known = CATEGORY_BY_RULE_ID[finding.rule_id];
  return {
    category: known?.category ?? "UNKNOWN",
    categoryLabel: known?.categoryLabel ?? "Övrigt",
    attentionLabel: attentionLabelOf(finding.risk_level) ?? "Okänd nivå",
  };
}

/**
 * DEMO M2a: the plain-Swedish statement of what a layer finding means, taken from the RULE
 * DEFINITION (each layer rule fires on existence within the search radius), not from the engine
 * explanation string (e.g. "Närhet till vatten kräver analys" for the wells layer, which misnames
 * it). The engine text stays available in the collapsed technical section. Unknown or document
 * rules fall back to the governed explanation verbatim -- nothing is invented.
 */
export function presentLuFindingSummary(finding: {
  readonly rule_id: string;
  readonly risk_level: string;
  readonly explanation?: string;
}): string {
  const definition = checkDefinitionForRule(finding.rule_id);
  if (definition && finding.risk_level === "NOT_CHECKED") {
    return `${definition.label}: kontrollen kunde inte göras – källan var otillgänglig.`;
  }
  if (definition?.hitMeaning) {
    // DEMO M2b: the rule's hit meaning is only stated for a level the engine actually produces;
    // an unknown level is never presented as a hit.
    if (attentionLabelOf(finding.risk_level)) return definition.hitMeaning;
    return "Fyndets nivå kunde inte tolkas – se teknisk information.";
  }
  // DEMO M2c item 3 (M2b verifier finding 6): an unchecked finding of a rule this UI does not know
  // carries the engine's own text with reason codes (e.g. "(TIMEOUT)"); that text stays in the
  // technical section.
  if (finding.risk_level === "NOT_CHECKED") return "Kontrollen kunde inte göras – se teknisk information.";
  return finding.explanation ?? "Fyndet saknar beskrivning i underlaget.";
}
