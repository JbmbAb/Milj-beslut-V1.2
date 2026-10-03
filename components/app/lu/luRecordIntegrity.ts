/**
 * W-UI1 (B; U20CDF4 beslut 1, owner doctrine 2026-10-03) -- the stored findings of a record whose integrity
 * cannot be attested (424 ASSESSMENT_RECORD_INTEGRITY_ERROR `record_integrity`, or a fresh run's
 * executionMotor.record_integrity), shown ONLY as an unverified, non-authoritative diagnostic: collapsed,
 * marked "overifierad, auktoritativ: nej", never as an assessment (no state chip, no risk colour, no overall
 * level, no "Kontrollerat"). The envelope must say itself that it is unverified and not authoritative
 * (own data properties `authoritative: false` and `verified: false`); anything else is not shown at all.
 *
 * Pure: no I/O. Reads only own data properties; a rule id outside the governed checks is never echoed.
 */

import { governedCheckLabelSv } from './luControlChecks';

export interface LuRecordIntegrityView {
  /** The summary line of the collapsed section. */
  readonly headSv: string;
  readonly noteSv: string;
  /** Count, highest stored level, distribution -- every value marked unverified. */
  readonly rows: readonly { readonly label: string; readonly value: string }[];
  /** One line per listed stored finding: check, stored level, "(overifierad)". */
  readonly entries: readonly string[];
  /** When the server listed fewer entries than the record holds. */
  readonly truncatedSv: string | null;
  /** Machine values (basis codes, the record's id) -- "Teknisk information" only. */
  readonly technical: readonly { readonly label: string; readonly value: string }[];
}

const LEVEL_SV: Readonly<Record<string, string>> = { HIGH: 'hög', MEDIUM: 'måttlig', LOW: 'låg', NOT_CHECKED: 'ej kontrollerad', UNKNOWN: 'okänd' };

/** W-UI1 (inventory): the stored levels (StoredFindingLevelUnverified) with a word of their own here. */
export const LU_RECORD_INTEGRITY_LEVEL_TEXTS: readonly string[] = Object.freeze(Object.keys(LEVEL_SV));

/** The Swedish word of a stored level, for the inventory probe. */
export function recordIntegrityLevelSv(level: string): string {
  return Object.prototype.hasOwnProperty.call(LEVEL_SV, level) ? LEVEL_SV[level]! : 'okänd';
}
const KNOWN_CHECKS: ReadonlySet<string> = new Set(['water', 'ebh', 'protected_area', 'natura2000', 'water_protection_area', 'document']);

function own(value: unknown, key: string): unknown {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && 'value' in descriptor ? descriptor.value : undefined;
}

function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

function levelSv(value: unknown): string {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(LEVEL_SV, value) ? LEVEL_SV[value]! : 'okänd';
}

/** The diagnostic view, or null when the envelope does not say itself that it is unverified and non-authoritative. */
export function parseLuRecordIntegrityDiagnostic(raw: unknown): LuRecordIntegrityView | null {
  try {
    if (own(raw, 'authoritative') !== false || own(raw, 'verified') !== false) return null;
    const stored = own(raw, 'stored_findings_unverified');
    const total = count(own(stored, 'total'));
    const counts = own(stored, 'counts');
    const entriesRaw = own(stored, 'entries');
    const list = Array.isArray(entriesRaw) ? entriesRaw : [];
    const entries = list.map((entry) => {
      const check = own(entry, 'check');
      const label =
        typeof check === 'string' && KNOWN_CHECKS.has(check)
          ? check === 'document'
            ? 'Dokument och tidigare beslut'
            : governedCheckLabelSv(check)
          : 'Regel utanför de styrda kontrollerna';
      const malformed = own(entry, 'well_formed') === false;
      return `${label} – lagrad nivå: ${levelSv(own(entry, 'stored_level'))} (overifierad${malformed ? ', felformad' : ''})`;
    });
    const highest = own(stored, 'highest_level');
    const n = (key: string) => count(own(counts, key)) ?? 0;
    const basis = own(raw, 'basis_codes');
    const basisCodes = Array.isArray(basis) ? basis.filter((code): code is string => typeof code === 'string') : [];
    const id = own(raw, 'assessment_artifact_id');
    return {
      headSv: 'Lagrade fynd – overifierad diagnostik (auktoritativ: nej)',
      noteSv:
        'Uppgifterna kommer ur den lagrade posten. De är inte verifierade och inte auktoritativa, och de är ingen bedömning – ' +
        'de får inte läsas som bedömningens resultat.',
      rows: [
        { label: 'Antal lagrade fynd', value: total === null ? 'okänt' : `${total} (overifierat)` },
        { label: 'Högsta lagrade nivå', value: highest === null || highest === undefined ? 'ingen' : `${levelSv(highest)} (overifierad)` },
        {
          label: 'Fördelning (overifierad)',
          value: `hög ${n('high')}, måttlig ${n('medium')}, låg ${n('low')}, ej kontrollerad ${n('not_checked')}, okänd nivå ${n('unknown_level')}, felformade ${n('malformed')}`,
        },
      ],
      entries,
      truncatedSv:
        own(stored, 'truncated') === true && total !== null ? `Listan visar de första ${entries.length} av ${total} lagrade fynd.` : null,
      technical: [
        ...(basisCodes.length > 0 ? [{ label: 'Grund', value: basisCodes.join(', ') }] : []),
        ...(typeof id === 'string' && id ? [{ label: 'Postens id', value: id }] : []),
      ],
    };
  } catch {
    return null;
  }
}
