/**
 * W-T1TEXT (owner decision 2026-10-03; T1-ATTESTATION-REQUIREMENTS §2 and §4.2; T1-WORDING-AUDIT top 1, 2 and 6): the
 * green verify answer says no more than the system proves. FULLY_BOUND_GREEN is reproducible CONSISTENCY against the
 * SAVED basis -- not authenticity, not origin (the data source, who entered the basis), not currency: an authentic
 * chain over fabricated input (F-T1-4) or a rolled-back older assessment (F-T1-5) verifies green all the same, and no
 * signature is checked at verify.
 *
 * Locked here, on the SERVER's texts: (1) every green main text (with and without the NOT_CHECKED clause) ends in the
 * reservation and carries no word that claims authenticity, proof of the data source, integrity, identity or currency;
 * (2) the owner's legacy text is untouched and is never the green sentence; (3) the README names the security boundary
 * ("konsistens mot sparat underlag, inte mot datakällan och inte vem som matade in det") and quotes the green sentence
 * exactly as the server produces it. The machine fields, the classes (PASS/DENY, FULLY_BOUND_GREEN, retryable) and
 * the error codes are not touched by this unit; `authenticity_verified` on every PASS is a later, separate unit.
 *
 * Hermetic: the mps-lu barrel is reached through verifyPresentation.ts; prisma is the throwing guard; the only I/O is
 * reading this checkout's README.md.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../server/db/prisma', async () => (await import('../helpers/hermeticPrismaGuard')).hermeticPrismaModule());

import { LU_REEXECUTION_LEGACY_UNBOUND_FORM_TEXT_SV } from '@miljobeslut/mps-lu';
import { presentVerifyResult, VERIFY_NOT_VERIFIED_SV, verifyOutcomeSv } from '../../server/modules/localization/verifyPresentation';
import { hermeticPrismaTouches } from '../helpers/hermeticPrismaGuard';

/** The owner's decided texts (2026-10-03), written out here independently of the code (oracles). */
const GREEN_HEAD_SV = 'Reproducerbar konsistens verifierad mot sparat underlag – resultatet matchar de pinnade artefakterna';
const RESERVATION_SV = 'Äkthet, ursprung (datakälla och vem som matade in underlaget) och aktuell authority är inte verifierade.';
const GREEN_SV = `${GREEN_HEAD_SV}. ${RESERVATION_SV}`;
/** The part of the green sentence no other result text has (the legacy text says "för äldre obunden artefaktform"). */
const GREEN_MARKER_SV = 'verifierad mot sparat underlag';
const OWNER_LEGACY_SV = 'Reproducerbar konsistens verifierad för äldre obunden artefaktform – äkthet och aktuell authority är inte verifierade.';
const BOUNDARY_SV = 'konsistens mot sparat underlag, inte mot datakällan och inte vem som matade in det';

/**
 * Words that would claim what verify does not do (T1 §4.1 principle 3): authenticity, integrity, identity, proof,
 * signatures, attestation, tamper-safety, correct data, currency. Checked on the text WITHOUT its negated
 * reservation, so "aktuell authority är inte verifierade" is allowed and "är aktuell" is not.
 */
const FORBIDDEN_CLAIM =
  /äkta|autentisk|intakt|identisk|oförändra|bevisa|signerad|attesterad|manipulationssäker|verifierad äkthet|korrekta? data|kryptograf|aktuell|senaste/i;
const withoutReservation = (text: string) => text.split(RESERVATION_SV).join('');

const notChecked = (...ids: string[]) => ({ code: 'NOT_CHECKED_CAUSE_NOT_PINNED' as const, finding_ids: ids, detail: 'x' });
const pass = (overrides: Record<string, unknown> = {}) => ({ outcome: 'PASS', verification_binding: 'FULLY_BOUND', mismatches: [], notices: [], ...overrides });
const readme = () => readFileSync(path.resolve(__dirname, '../../README.md'), 'utf8');

afterEach(() => {
  expect(hermeticPrismaTouches).toEqual([]);
});

describe('W-T1TEXT: the green verify text is reproducible consistency against the saved basis -- never authenticity, origin or currency', () => {
  it('verifyOutcomeSv(PASS) without notices is exactly the decided sentence, ending in the reservation (once)', () => {
    const text = verifyOutcomeSv('PASS', []);
    expect(text).toBe(GREEN_SV);
    expect(text.endsWith(RESERVATION_SV)).toBe(true);
    expect(text.split(RESERVATION_SV).length - 1).toBe(1);
  });

  it('with the NOT_CHECKED clause the reservation is still the last sentence (one layer, two layers, an unnamed layer)', () => {
    expect(verifyOutcomeSv('PASS', [notChecked('finding-notchecked-ebh')])).toBe(
      `${GREEN_HEAD_SV}, men orsaken till att lagret inte kontrollerades sparades inte (Potentiellt förorenade områden (EBH)). ${RESERVATION_SV}`,
    );
    expect(verifyOutcomeSv('PASS', [notChecked('finding-notchecked-natura2000', 'finding-notchecked-water')])).toBe(
      `${GREEN_HEAD_SV}, men orsaken till att lagren inte kontrollerades sparades inte (Natura 2000, Brunnar). ${RESERVATION_SV}`,
    );
    expect(verifyOutcomeSv('PASS', [notChecked('finding-other')])).toBe(
      `${GREEN_HEAD_SV}, men orsaken till att lagret inte kontrollerades sparades inte. ${RESERVATION_SV}`,
    );
  });

  it('no green text claims authenticity, proof of the data source, integrity, identity or currency; "verifierad" never stands alone', () => {
    for (const notices of [[], [notChecked('finding-notchecked-ebh')], [notChecked('finding-notchecked-natura2000', 'finding-notchecked-water')]]) {
      const text = verifyOutcomeSv('PASS', notices);
      expect(text).toContain(RESERVATION_SV);
      expect(withoutReservation(text)).not.toMatch(FORBIDDEN_CLAIM);
      expect(text.startsWith('Reproducerbar konsistens verifierad mot sparat underlag')).toBe(true);
      expect(text).not.toMatch(/Reproducerbarhet(en)? verifierad|bedömningen (är|har) verifierad|verifierad bedömning/i);
    }
  });

  it("presentVerifyResult: the green sentence ONLY for FULLY_BOUND_GREEN; the owner's legacy text unchanged and never the green sentence; NOT_VERIFIED neutral", () => {
    const green = presentVerifyResult(pass());
    expect(green.presentation).toBe('FULLY_BOUND_GREEN');
    expect(green.outcome_sv).toBe(GREEN_SV);

    const legacyNotice = {
      code: 'LEGACY_UNBOUND_FORM_CONSISTENCY_ONLY', basis: 'V1_FORM', authenticity_verified: false, current_authority_verified: false,
      text_sv: OWNER_LEGACY_SV, finding_ids: [], detail: 'x',
    };
    const legacy = presentVerifyResult(pass({ verification_binding: 'LEGACY_UNBOUND_FORM', notices: [legacyNotice] }));
    expect(legacy.presentation).toBe('LEGACY_UNBOUND_NOTICE');
    expect(LU_REEXECUTION_LEGACY_UNBOUND_FORM_TEXT_SV).toBe(OWNER_LEGACY_SV);
    expect(legacy.outcome_sv).toBe(OWNER_LEGACY_SV);
    expect(legacy.outcome_sv).not.toContain(GREEN_MARKER_SV);
    expect(legacy.outcome_sv).not.toContain('resultatet matchar de pinnade artefakterna');

    const notVerified = presentVerifyResult(pass({ verification_binding: null }));
    expect(notVerified.presentation).toBe('NOT_VERIFIED');
    expect(notVerified.outcome_sv).toBe(VERIFY_NOT_VERIFIED_SV);
    expect(notVerified.outcome_sv).not.toContain(GREEN_MARKER_SV);

    const deny = presentVerifyResult({ outcome: 'DENY', verification_binding: null, mismatches: [{ code: 'FINDINGS_MISMATCH', detail: 'x' }], notices: [] });
    expect(deny.presentation).toBe('NOT_VERIFIED');
    expect(deny.outcome_sv).not.toContain(GREEN_MARKER_SV);

    // The non-green texts claim nothing about authenticity either (the legacy text names it only as NOT verified).
    for (const t of [legacy.outcome_sv, notVerified.outcome_sv, deny.outcome_sv]) {
      expect(t.replace('äkthet och aktuell authority är inte verifierade', '')).not.toMatch(FORBIDDEN_CLAIM);
    }
  });
});

describe('W-T1TEXT: the README names the security boundary of the reproducibility check', () => {
  it('states the boundary: consistency against the saved basis, not the data source, not who entered it; no signatures, no currency', () => {
    const text = readme();
    expect(text).toContain(BOUNDARY_SV);
    expect(text).toContain('kontrollerar **inte** digitala signaturer');
    expect(text).toContain('**inte** att underlaget stämmer med datakällorna i dag');
    expect(text).toContain('**inte** att det är den senaste bedömningen');
    expect(text).toContain('Den som har skrivrätt till lagret eller kontroll över en producerande process kan skapa underlag som klarar kontrollen.');
  });

  it('quotes the green sentence exactly as the server produces it, and never calls the check tamper-safe or an authenticity check', () => {
    const text = readme();
    expect(text).toContain(verifyOutcomeSv('PASS', []));
    const start = text.indexOf('reproducerbarhetskontrollen är konsistens, inte äkthet');
    expect(start).toBeGreaterThan(-1);
    const section = text.slice(start).split('\n### ')[0]!;
    expect(section).not.toMatch(/manipulationssäker|verifierar äkthet|bevisar att|kryptografiskt säkrad/i);
  });
});
