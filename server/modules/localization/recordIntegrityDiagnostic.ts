/**
 * U20CDF4 / W-U20CDF5 -- the NON-AUTHORITATIVE diagnostic of a stored record that failed its integrity check
 * (owner decisions 2026-10-03 (4) point 1 and (5): the stored findings stay in view only as diagnostic
 * information, never in the shape of a valid LocalizationAssessment).
 *
 * One builder and one wire whitelist, used by every answer that carries such a record: the 424
 * ASSESSMENT_RECORD_INTEGRITY_ERROR of the read-back, the PDF, verify and the map (localizationOrchestrator,
 * localization.routes), and -- W-U20CDF5 (U20CDF4 verification L1) -- the fresh generate-report /
 * generate-pdf-data site whose record is a RECORD_INTEGRITY_ERROR. Moved here from localizationOrchestrator.ts
 * so the use case can use it without an import cycle; the orchestrator re-exports it unchanged.
 *
 * W-U20CDF5 (U20CDF4 verification L5):
 *  - `entries` is capped at RECORD_INTEGRITY_MAX_ENTRIES (the first ones in stored order); `total` and the
 *    per-level `counts` stay complete, and `truncated` says whether entries were left out;
 *  - a stored rule id is echoed ONLY when it is in the governed rule registry (isGovernedRuleId); any other
 *    value -- a plain identifier included -- is `rule: null`.
 * Every value is a count, a fixed level, a governed check name, a registered rule id, a plain artifact id or
 * the fixed note; nothing of the record's free text travels.
 */
import {
  GOVERNED_DOCUMENT_CHECK_LAYER,
  GOVERNED_DOCUMENT_CHECK_RULE_ID,
  governedLayerOfRule,
  isFindingObject,
  isGovernedRuleId,
  isMalformedFinding,
} from './governedLayerChecks';
import { highestGovernedRiskLevel } from './governedCoverageStatement';

/** A stored finding's level as the diagnostic reports it -- the raw value of an unknown one is never echoed. */
export type StoredFindingLevelUnverified = 'HIGH' | 'MEDIUM' | 'LOW' | 'NOT_CHECKED' | 'UNKNOWN';

/** W-U20CDF5 (L5): at most this many stored findings are listed one by one (probe A2: 5 000 gave 386 kB). */
export const RECORD_INTEGRITY_MAX_ENTRIES = 100;

/**
 * U20CDF4: the stored findings of a record that failed its integrity check, as NON-AUTHORITATIVE
 * diagnostic data in an envelope of its own -- deliberately NOT the shape of a LocalizationAssessment
 * or of the read-back (no `findings`, `risk_level`, `overallStatement`, `governedLayerChecks`,
 * `evidenceDetails`, no explanation text, no evidence refs).
 */
export interface RecordIntegrityDiagnostic {
  readonly authoritative: false;
  readonly verified: false;
  readonly note_sv: string;
  readonly assessment_artifact_id: string;
  /** The machine codes (without their ids) of what breaks the record, in order. */
  readonly basis_codes: readonly string[];
  readonly stored_findings_unverified: {
    /** How many entries the record's findings list holds (all of them, also past the cap). */
    readonly total: number;
    /** The highest HIGH/MEDIUM/LOW level stored -- unverified; null when none is stored. */
    readonly highest_level: 'HIGH' | 'MEDIUM' | 'LOW' | null;
    /** Over ALL stored entries (also past the cap). */
    readonly counts: {
      readonly high: number;
      readonly medium: number;
      readonly low: number;
      readonly not_checked: number;
      readonly unknown_level: number;
      /** Entries that break the finding contract (MALFORMED_RECORD_ENTRY). */
      readonly malformed: number;
    };
    /** W-U20CDF5 (L5): true when `entries` lists fewer entries than `total` (the cap). */
    readonly truncated: boolean;
    /** The first RECORD_INTEGRITY_MAX_ENTRIES entries, in stored order. */
    readonly entries: readonly {
      /** The governed check the stored rule belongs to (a spatial layer or 'document'); null otherwise. */
      readonly check: string | null;
      /** W-U20CDF5 (L5): the stored rule id when it is a REGISTERED governed rule id; null otherwise. */
      readonly rule: string | null;
      readonly stored_level: StoredFindingLevelUnverified;
      readonly well_formed: boolean;
    }[];
  };
}

export const RECORD_INTEGRITY_NOTE_SV =
  'Diagnostisk uppgift ur den lagrade posten: inte verifierad, inte auktoritativ och ingen bedömning. ' +
  'Fynden får inte läsas som bedömningens resultat.';
const BASIS_CODE = /^[A-Z][A-Z0-9_]{0,63}$/;
/** A plain artifact id (the record's own id; never a free text). */
export const PLAIN_ARTIFACT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const STORED_LEVELS: readonly StoredFindingLevelUnverified[] = ['HIGH', 'MEDIUM', 'LOW', 'NOT_CHECKED'];
const GOVERNED_CHECKS: readonly string[] = [
  'water',
  'ebh',
  'protected_area',
  'natura2000',
  'water_protection_area',
  GOVERNED_DOCUMENT_CHECK_LAYER,
];

function checkOfRule(ruleId: string): string | null {
  return ruleId === GOVERNED_DOCUMENT_CHECK_RULE_ID ? GOVERNED_DOCUMENT_CHECK_LAYER : governedLayerOfRule(ruleId);
}

/** The diagnostic's view of the stored findings (any value; a list that is not one counts as empty). */
export function storedFindingsUnverified(rawFindings: unknown): RecordIntegrityDiagnostic['stored_findings_unverified'] {
  const list: readonly unknown[] = Array.isArray(rawFindings) ? rawFindings : [];
  const all = list.map((finding) => {
    const object = isFindingObject(finding) ? finding : null;
    const ruleId = object && isGovernedRuleId(object.rule_id) ? object.rule_id : null;
    const level = object?.risk_level;
    return {
      check: ruleId === null ? null : checkOfRule(ruleId),
      rule: ruleId,
      stored_level: (typeof level === 'string' && (STORED_LEVELS as readonly string[]).includes(level) ? level : 'UNKNOWN') as StoredFindingLevelUnverified,
      well_formed: !isMalformedFinding(finding),
    };
  });
  const count = (level: StoredFindingLevelUnverified) => all.filter((entry) => entry.stored_level === level).length;
  const highest = highestGovernedRiskLevel(all.map((entry) => ({ risk_level: entry.stored_level })));
  return {
    total: all.length,
    highest_level: highest === 'HIGH' || highest === 'MEDIUM' || highest === 'LOW' ? highest : null,
    counts: {
      high: count('HIGH'),
      medium: count('MEDIUM'),
      low: count('LOW'),
      not_checked: count('NOT_CHECKED'),
      unknown_level: count('UNKNOWN'),
      malformed: all.filter((entry) => !entry.well_formed).length,
    },
    truncated: all.length > RECORD_INTEGRITY_MAX_ENTRIES,
    entries: all.slice(0, RECORD_INTEGRITY_MAX_ENTRIES),
  };
}

/** The machine codes (without their ids) of a coverage basis, deduplicated, in order. */
export function recordIntegrityBasisCodes(coverageBasis: readonly string[]): string[] {
  return [...new Set(coverageBasis.map((entry) => entry.split(':')[0]!).filter((code) => BASIS_CODE.test(code)))];
}

/** The diagnostic of one record (its id, its coverage basis, its raw stored findings). */
export function recordIntegrityDiagnostic(
  assessmentArtifactId: string,
  coverageBasis: readonly string[],
  rawFindings: unknown,
): RecordIntegrityDiagnostic {
  return {
    authoritative: false,
    verified: false,
    note_sv: RECORD_INTEGRITY_NOTE_SV,
    assessment_artifact_id: assessmentArtifactId,
    basis_codes: recordIntegrityBasisCodes(coverageBasis),
    stored_findings_unverified: storedFindingsUnverified(rawFindings),
  };
}

/**
 * U20CDF4: the diagnostic as it may leave the server -- rebuilt field by field from a whitelist (counts,
 * fixed levels, governed check names, registered rule ids, a plain artifact id, the fixed note), so no other
 * field and no free text of the stored record can travel even if the object were extended. Returns null for
 * anything that is not such a diagnostic. W-U20CDF5 (L5): the cap holds here too, and `truncated` is true
 * when the source says so or the cap drops entries.
 */
export function recordIntegrityDiagnosticWire(raw: unknown): RecordIntegrityDiagnostic | null {
  if (!raw || typeof raw !== 'object') return null;
  const source = raw as Partial<RecordIntegrityDiagnostic> & { stored_findings_unverified?: Partial<RecordIntegrityDiagnostic['stored_findings_unverified']> };
  const id = typeof source.assessment_artifact_id === 'string' && PLAIN_ARTIFACT_ID.test(source.assessment_artifact_id) ? source.assessment_artifact_id : null;
  const stored = source.stored_findings_unverified;
  if (id === null || !stored || typeof stored !== 'object') return null;
  const n = (value: unknown) => (typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0);
  const counts = (stored.counts ?? {}) as Partial<RecordIntegrityDiagnostic['stored_findings_unverified']['counts']>;
  const highest = stored.highest_level === 'HIGH' || stored.highest_level === 'MEDIUM' || stored.highest_level === 'LOW' ? stored.highest_level : null;
  const entries = Array.isArray(stored.entries) ? stored.entries : [];
  return {
    authoritative: false,
    verified: false,
    note_sv: RECORD_INTEGRITY_NOTE_SV,
    assessment_artifact_id: id,
    basis_codes: (Array.isArray(source.basis_codes) ? source.basis_codes : []).filter(
      (code): code is string => typeof code === 'string' && BASIS_CODE.test(code),
    ),
    stored_findings_unverified: {
      total: n(stored.total),
      highest_level: highest,
      counts: {
        high: n(counts.high),
        medium: n(counts.medium),
        low: n(counts.low),
        not_checked: n(counts.not_checked),
        unknown_level: n(counts.unknown_level),
        malformed: n(counts.malformed),
      },
      truncated: stored.truncated === true || entries.length > RECORD_INTEGRITY_MAX_ENTRIES,
      entries: entries.slice(0, RECORD_INTEGRITY_MAX_ENTRIES).map((entry) => {
        const e = (entry && typeof entry === 'object' ? entry : {}) as Partial<RecordIntegrityDiagnostic['stored_findings_unverified']['entries'][number]>;
        return {
          check: typeof e.check === 'string' && GOVERNED_CHECKS.includes(e.check) ? e.check : null,
          rule: isGovernedRuleId(e.rule) ? e.rule : null,
          stored_level: (typeof e.stored_level === 'string' && (STORED_LEVELS as readonly string[]).includes(e.stored_level)
            ? e.stored_level
            : 'UNKNOWN') as StoredFindingLevelUnverified,
          well_formed: e.well_formed === true,
        };
      }),
    },
  };
}
