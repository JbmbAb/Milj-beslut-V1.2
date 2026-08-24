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
  readonly risk_level: "LOW" | "MEDIUM" | "HIGH";
}

const CATEGORY_BY_RULE_ID: Readonly<Record<string, { category: LuFindingCategory; categoryLabel: string }>> = {
  "LU-WATER-001": { category: "WATER", categoryLabel: "Vatten" },
  "LU-EBH-001": { category: "EBH", categoryLabel: "Förorenad mark" },
  "LU-PROTECTED-001": { category: "PROTECTED_AREA", categoryLabel: "Skydd" },
  "LU-NATURA2000-001": { category: "NATURA2000", categoryLabel: "Natura 2000" },
  "LU-WATERPROTECTION-001": { category: "WATER_PROTECTION_AREA", categoryLabel: "Vattenskyddsområde" },
  "LU-DOC-BESLUT-001": { category: "DOCUMENT_DECISION", categoryLabel: "Tidigare beslut" },
};

const ATTENTION_LABEL_BY_RISK_LEVEL: Readonly<Record<"LOW" | "MEDIUM" | "HIGH", string>> = {
  HIGH: "Kräver uppmärksamhet",
  MEDIUM: "Bör utredas vidare",
  LOW: "Låg risk",
};

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
    attentionLabel: ATTENTION_LABEL_BY_RISK_LEVEL[finding.risk_level],
  };
}
