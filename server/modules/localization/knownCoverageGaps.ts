/**
 * U20CDF (U20CD verification F1; DIRECTIVE-72H section 11; SI-3) -- the ONE place that states what
 * the governed LU spatial datasets are known NOT to cover. Every coverage text the product shows
 * (layer checks and evidence details in the fresh run, the read-back, both PDF paths and the derived
 * overall summary) is composed here, keyed by the dataset's content hash (= ADMIT v1 source_sha256 =
 * the registry `version_hash` every spatial evidence carries in `layer_ref.version_hash`). Evidence
 * of any other dataset version gets no text from here, never the text of a version it was not
 * produced from.
 *
 * Two kinds, kept apart:
 *  - CONTRACT_SCOPE: what the frozen ADMIT v1 contract itself scopes out, by design.
 *  - KNOWN_INCOMPLETE_DATA: admitted data that a reconciliation found missing from the governed
 *    table. Stated with its date and basis; this code does NOT re-check it against the table.
 *
 * Nothing here claims full coverage: a dataset with no entry is shown as "Saknas i underlaget" (the
 * contracts say nothing), never as complete. Presentation only: no finding, status, risk level,
 * permit probability or score is derived from these entries.
 */

export type KnownCoverageGapKind = 'CONTRACT_SCOPE' | 'KNOWN_INCOMPLETE_DATA';

export interface KnownCoverageGap {
  /** Stable machine-readable id of the entry. */
  readonly gap_id: string;
  readonly kind: KnownCoverageGapKind;
  /** ADMIT v1 layer id (LAYER-ID-CONTRACTS-V1.md). */
  readonly layer_id: string;
  /** The dataset version the statement is about (ADMIT v1 source_sha256). */
  readonly source_sha256: string;
  /** Swedish display name of the layer, the prefix of the composed text. */
  readonly layer_label_sv: string;
  /** The statement itself (one clause of the composed text, no trailing period). */
  readonly text_sv: string;
  /** Date of the source that states it. */
  readonly as_of: string;
  /** How the statement is known, and what it has NOT been checked against. */
  readonly basis_sv: string;
  /** Where it is stated (repository path:line unless marked otherwise). */
  readonly sources: readonly string[];
}

const NATURA2000_SPA_SHA256 = 'a5d665ae7bfde9ebeaa4883d5db7bbf70aea9cb7ad5a3f621c4cdbc003ad7f02';
const PROTECTED_AREA_SHA256 = '983772bf129d14326c43aa5d08f152e65604778d392c28ea4fee0c4e838af9ae';
const WATER_PROTECTION_SHA256 = 'ba6fdd88fa478d9b930a41153d03b84a34b086de8d6c5aa0f6b63c0b4dd6ff18';

const ADMIT_V1_FREEZE_BASIS_SV = 'enligt det frysta ADMIT v1-kontraktet (2026-08-08)';

/** In text order per dataset: contract scope first, then known incompleteness. */
export const KNOWN_COVERAGE_GAPS: readonly KnownCoverageGap[] = [
  {
    gap_id: 'NATURA2000_SPA_ONLY',
    kind: 'CONTRACT_SCOPE',
    layer_id: 'lu.natura2000',
    source_sha256: NATURA2000_SPA_SHA256,
    layer_label_sv: 'Natura 2000',
    text_sv: 'endast fågelskyddsområden (SPA)',
    as_of: '2026-08-08',
    basis_sv: ADMIT_V1_FREEZE_BASIS_SV,
    sources: [
      'docs/architecture/admit-v1/LAYER-ID-CONTRACTS-V1.md:22 ("SPA rikstäckande only v1; SCI = later wave")',
      'docs/architecture/admit-v1/ADMIT-V1-SET.md:60',
    ],
  },
  {
    gap_id: 'NATURA2000_SPA_103_OF_558_ABSENT',
    kind: 'KNOWN_INCOMPLETE_DATA',
    layer_id: 'lu.natura2000',
    source_sha256: NATURA2000_SPA_SHA256,
    layer_label_sv: 'Natura 2000',
    text_sv: 'underlaget är känt ofullständigt (103 av 558 SPA-områden saknas enligt avstämning 2026-09-25)',
    as_of: '2026-09-25',
    basis_sv: 'enligt avstämning 2026-09-25, ej omkontrollerad mot nuvarande tabell',
    sources: [
      // Lane report outside the repository (main checkout, "Claude outputs/").
      'Claude outputs/db-provenance-lane-2026-09-25/DB-LANE-RECONCILIATION-CRITIC.md:103 ' +
        '(P-9: env.natura2000_area = FID 0..454; 103 kodade områden, FID 455-557, saknas)',
      'Claude outputs/db-provenance-lane-2026-09-25/DB-LANE-RECONCILIATION-CRITIC.md:41,44 ' +
        '(källans .dbf: 558 poster)',
      'Claude outputs/db-provenance-lane-2026-09-25/DB-LANE-RECONCILIATION-CRITIC.md:173 ' +
        '(D-5: ägarbeslut om lagret öppet)',
    ],
  },
  {
    gap_id: 'PROTECTED_AREA_NATURRESERVAT_ONLY',
    kind: 'CONTRACT_SCOPE',
    layer_id: 'lu.protected_area',
    source_sha256: PROTECTED_AREA_SHA256,
    layer_label_sv: 'Skyddad natur',
    text_sv: 'endast naturreservat; övriga skyddsformer ingår inte i underlaget',
    as_of: '2026-08-08',
    basis_sv: `${ADMIT_V1_FREEZE_BASIS_SV}; följer av kontraktets source_id (…/SkyddadeOmraden/Naturreservat/…)`,
    sources: [
      'docs/architecture/admit-v1/LAYER-ID-CONTRACTS-V1.md:20',
      'docs/architecture/admit-v1/ADMIT-V1-SET.md:58',
    ],
  },
  {
    gap_id: 'WATER_PROTECTION_NV_ONLY',
    kind: 'CONTRACT_SCOPE',
    layer_id: 'lu.water_protection',
    source_sha256: WATER_PROTECTION_SHA256,
    layer_label_sv: 'Vattenskyddsområde',
    text_sv:
      'endast Naturvårdsverkets vattenskyddsområden; Länsstyrelsens vattenskydd (VISS lst_vattenskydd) ' +
      'ingår inte i underlaget',
    as_of: '2026-08-08',
    basis_sv: ADMIT_V1_FREEZE_BASIS_SV,
    sources: [
      'docs/architecture/admit-v1/LAYER-ID-CONTRACTS-V1.md:21 ("NV sole"; "forbid VISS/lst_vattenskydd")',
      'docs/architecture/admit-v1/ADMIT-V1-SET.md:16-29,68 (LST vattenskydd OUT_OF_SCOPE v1)',
    ],
  },
];

/** The entries stated for exactly this dataset version, in text order; [] when none. */
export function knownCoverageGapsFor(sourceSha256: string | null | undefined): readonly KnownCoverageGap[] {
  if (!sourceSha256) return [];
  return KNOWN_COVERAGE_GAPS.filter((gap) => gap.source_sha256 === sourceSha256);
}

/**
 * The composed coverage limitation of one dataset version ("<lager>: <påstående>; <påstående>."),
 * or null when nothing is stated for it.
 */
export function knownCoverageLimitationSv(sourceSha256: string | null | undefined): string | null {
  const gaps = knownCoverageGapsFor(sourceSha256);
  if (gaps.length === 0) return null;
  return `${gaps[0]!.layer_label_sv}: ${gaps.map((gap) => gap.text_sv).join('; ')}.`;
}
