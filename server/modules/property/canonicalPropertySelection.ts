import { prisma } from '../../db/prisma';
import { assertPermission } from '../../security/projectAccess';
import type { AuthUser } from '../../security/types';

export type CanonicalPropertySelection = {
  readonly sourceKey: string;
  readonly sourceDataset: string;
  readonly designation: string;
  readonly municipality: string | null;
  readonly municipalityCode: string | null;
  readonly countyCode: string | null;
  readonly matchKind: 'exact' | 'fuzzy';
};

type CandidateRow = {
  readonly source_key: string;
  readonly source_dataset: string;
  readonly designation: string;
  readonly municipality_name: string | null;
  readonly municipality_code: string | null;
  readonly county_code: string | null;
  readonly match_kind?: 'exact' | 'fuzzy';
};

function toSelection(row: CandidateRow, matchKind: 'exact' | 'fuzzy' = 'exact'): CanonicalPropertySelection {
  return {
    sourceKey: row.source_key,
    sourceDataset: row.source_dataset,
    designation: row.designation,
    municipality: row.municipality_name,
    municipalityCode: row.municipality_code,
    countyCode: row.county_code,
    matchKind: row.match_kind ?? matchKind,
  };
}

function requireDiscoveryQuery(query: string): string {
  const value = String(query || '').trim();
  if (value.length < 3 || value.length > 160 || /[,;*%]/.test(value)) {
    throw new Error('A valid property search query is required');
  }
  return value;
}

/**
 * Pre-project discovery is deliberately non-authoritative: it returns a bounded set of
 * canonical candidates but never selects one. The caller must send one selected identity back
 * to the create route, which re-resolves it below before Project.create.
 */
export async function searchCanonicalPropertyCandidates(
  input: { readonly query: string },
  user: AuthUser,
): Promise<CanonicalPropertySelection[]> {
  assertPermission(user, 'PROPERTY_LOOKUP');
  const query = requireDiscoveryQuery(input.query);
  const rows = await prisma.$queryRaw<CandidateRow[]>`
    WITH q AS (
      SELECT core.normalize_designation(${query}) AS designation_norm
    )
    SELECT
      pu.source_key,
      pu.source_dataset,
      pu.designation,
      pu.municipality_name,
      pu.municipality_code,
      pu.county_code,
      CASE WHEN pu.designation_norm = q.designation_norm THEN 'exact' ELSE 'fuzzy' END AS match_kind
    FROM core.property_unit pu, q
    WHERE pu.designation_norm = q.designation_norm OR pu.designation_norm % q.designation_norm
    ORDER BY
      CASE WHEN pu.designation_norm = q.designation_norm THEN 0 ELSE 1 END,
      similarity(pu.designation_norm, q.designation_norm) DESC,
      pu.designation ASC,
      pu.source_dataset ASC,
      pu.source_key ASC
    LIMIT 20;
  `;
  return rows.map((row) => toSelection(row, row.match_kind ?? 'fuzzy'));
}

/** Re-resolves a browser-selected candidate from the canonical property source. */
export async function resolveCanonicalPropertySelection(input: {
  readonly sourceKey: string;
  readonly sourceDataset: string;
  readonly designation: string;
}): Promise<CanonicalPropertySelection> {
  const sourceKey = String(input.sourceKey || '').trim();
  const sourceDataset = String(input.sourceDataset || '').trim();
  const designation = String(input.designation || '').trim().toUpperCase();
  if (!sourceKey || !sourceDataset || !designation) {
    throw new Error('Canonical property selection is incomplete');
  }

  const rows = await prisma.$queryRaw<CandidateRow[]>`
    SELECT source_key, source_dataset, designation, municipality_name, municipality_code, county_code
    FROM core.property_unit
    WHERE source_key = ${sourceKey} AND source_dataset = ${sourceDataset}
    ORDER BY designation ASC
    LIMIT 2;
  `;
  if (rows.length !== 1) {
    throw new Error('Selected canonical property is unavailable or ambiguous');
  }
  const selection = toSelection(rows[0]);
  if (selection.designation.trim().toUpperCase() !== designation) {
    throw new Error('Selected designation does not match the selected canonical property');
  }
  return selection;
}
