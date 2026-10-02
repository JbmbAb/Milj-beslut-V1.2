/**
 * U20CDF (U20CD verification F1; DIRECTIVE-72H section 11; SI-3) -- the known coverage gaps of the
 * governed LU datasets live in ONE register (server/modules/localization/knownCoverageGaps.ts), each
 * entry with its kind, dataset version, date, basis and source; every coverage text the product
 * shows is composed from it, and none of them claims full coverage.
 *
 * Pure: the register has no imports. governedEvidenceDetails is imported for the single-source check;
 * its import of the mps-lu barrel is kept hermetic with the throwing prisma guard.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../server/db/prisma', async () => (await import('../helpers/hermeticPrismaGuard')).hermeticPrismaModule());

import {
  KNOWN_COVERAGE_GAPS,
  knownCoverageGapsFor,
  knownCoverageLimitationSv,
} from '../../server/modules/localization/knownCoverageGaps';
import { admitV1ContractFacts } from '../../server/modules/localization/governedEvidenceDetails';
import { hermeticPrismaTouches } from '../helpers/hermeticPrismaGuard';

const HASH = {
  water: '2b4b514f8b18a1a614d9aeac75c32eff8c52a3864c54770be112fd88fa263ddc',
  ebh: '02fccffc07abaaf1775c8333d660fa60fdecea0c3bb664335892764c8486d186',
  protected_area: '983772bf129d14326c43aa5d08f152e65604778d392c28ea4fee0c4e838af9ae',
  water_protection_area: 'ba6fdd88fa478d9b930a41153d03b84a34b086de8d6c5aa0f6b63c0b4dd6ff18',
  natura2000: 'a5d665ae7bfde9ebeaa4883d5db7bbf70aea9cb7ad5a3f621c4cdbc003ad7f02',
} as const;

afterEach(() => {
  expect(hermeticPrismaTouches).toEqual([]);
});

describe('U20CDF: known coverage gaps -- one register, traceable, never a full-coverage claim', () => {
  it('Natura 2000: checked against the loaded SPA basis only, not full Natura coverage, and that basis is known incomplete (103 of 558)', () => {
    expect(knownCoverageLimitationSv(HASH.natura2000)).toBe(
      'Natura 2000: kontrollen avser endast inläst SPA-underlag (fågelskyddsområden), inte fullständig Natura 2000-täckning; ' +
        'särskilda bevarandeområden (SCI/SAC) ingår inte; underlaget är känt ofullständigt (103 av 558 SPA-områden saknas ' +
        'enligt avstämning 2026-09-25, ej omkontrollerad mot nuvarande tabell).',
    );
    const gap = KNOWN_COVERAGE_GAPS.find((g) => g.gap_id === 'NATURA2000_SPA_103_OF_558_ABSENT')!;
    expect(gap).toMatchObject({
      kind: 'KNOWN_INCOMPLETE_DATA',
      layer_id: 'lu.natura2000',
      source_sha256: HASH.natura2000,
      as_of: '2026-09-25',
      basis_sv: 'enligt avstämning 2026-09-25, ej omkontrollerad mot nuvarande tabell',
      rechecked_against_current_table: false,
    });
    expect(gap.sources.join(' ')).toMatch(/DB-LANE-RECONCILIATION-CRITIC\.md:103/);
    expect(knownCoverageGapsFor(HASH.natura2000).map((g) => g.kind)).toEqual(['CONTRACT_SCOPE', 'KNOWN_INCOMPLETE_DATA']);
  });

  it('protected nature and water protection: what the check was made against, as opposed to full coverage', () => {
    expect(knownCoverageLimitationSv(HASH.protected_area)).toBe(
      'Skyddad natur: kontrollen avser endast inlästa naturreservat, inte fullständig täckning av skyddad natur; ' +
        'övriga skyddsformer ingår inte i underlaget.',
    );
    expect(knownCoverageLimitationSv(HASH.water_protection_area)).toBe(
      'Vattenskyddsområde: kontrollen avser endast Naturvårdsverkets inlästa vattenskyddsområden, inte fullständig ' +
        'täckning av vattenskyddsområden; Länsstyrelsens vattenskydd (VISS lst_vattenskydd) ingår inte i underlaget.',
    );
    for (const hash of [HASH.protected_area, HASH.water_protection_area]) {
      expect(knownCoverageGapsFor(hash).map((g) => g.kind)).toEqual(['CONTRACT_SCOPE']);
    }
  });

  it('nothing is stated where the contracts say nothing, or for another dataset version', () => {
    expect(knownCoverageLimitationSv(HASH.water)).toBeNull();
    expect(knownCoverageLimitationSv(HASH.ebh)).toBeNull();
    expect(knownCoverageLimitationSv('f'.repeat(64))).toBeNull();
    expect(knownCoverageLimitationSv(null)).toBeNull();
    expect(knownCoverageGapsFor(undefined)).toEqual([]);
  });

  it('every entry is traceable: kind, ADMIT layer, dataset hash, date, basis and at least one source', () => {
    const ids = new Set<string>();
    for (const gap of KNOWN_COVERAGE_GAPS) {
      expect(ids.has(gap.gap_id)).toBe(false);
      ids.add(gap.gap_id);
      expect(['CONTRACT_SCOPE', 'KNOWN_INCOMPLETE_DATA']).toContain(gap.kind);
      expect(gap.layer_id).toMatch(/^lu\./);
      expect(gap.source_sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(gap.as_of).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(gap.basis_sv.length).toBeGreaterThan(0);
      expect(gap.sources.length).toBeGreaterThan(0);
      expect(gap.rechecked_against_current_table).toBe(false);
      expect(gap.text_sv).not.toMatch(/\.$/);
    }
  });

  it('no composed text claims full coverage: "fullständig" only ever appears negated', () => {
    for (const hash of Object.values(HASH)) {
      const text = knownCoverageLimitationSv(hash) ?? '';
      expect(text).not.toMatch(/rikstäckande|hela landet|samtliga|alla (SPA|områden)/i);
      // ("ofullständigt" is the opposite claim and allowed.)
      expect(text.replace(/inte fullständig/g, '')).not.toMatch(/(^|[^a-zåäö])fullständig/i);
    }
    for (const hash of [HASH.natura2000, HASH.protected_area, HASH.water_protection_area]) {
      expect(knownCoverageLimitationSv(hash)).toMatch(/kontrollen avser endast .*inläst.*, inte fullständig/);
    }
  });

  it('single source: the ADMIT v1 contract facts carry exactly the register text for every dataset', () => {
    for (const hash of Object.values(HASH)) {
      expect(admitV1ContractFacts(hash)?.coverage_limitation_sv).toBe(knownCoverageLimitationSv(hash));
    }
  });
});
