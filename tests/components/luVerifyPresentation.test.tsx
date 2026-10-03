/**
 * W-UI1 (A) -- the verify presentation, pure (components/app/lu/luVerifyPresentation.ts).
 *
 * Owner decision 2026-10-02 (binding): a PASS over a V1/legacy-unbound artifact form must not look like the
 * green verification of a fully bound V4; the owner's exact text, neutral/warning tone; verify = consistency,
 * never authenticity. Contract (U30R6 K3/K8/K21): verification_binding, presentation (computed by the
 * server), notices[{code, basis, authenticity_verified:false, current_authority_verified:false, text_sv}].
 * UI rule: green ONLY for presentation FULLY_BOUND_GREEN + binding FULLY_BOUND + outcome PASS; fail-closed on
 * anything missing, unknown, inherited or contradictory. No network, no database.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  LU_VERIFY_FULLY_BOUND_HEAD_SV,
  LU_VERIFY_LEGACY_UNBOUND_FORM_TEXT_SV,
  LU_VERIFY_NOT_VERIFIED_SV,
  LU_VERIFY_PASS_SCOPE_SV,
  LU_VERIFY_UNBOUND_TEXT_SV,
  presentLuVerifyResult,
} from '../../components/app/lu/luVerifyPresentation';
import { LuVerifyResultView } from '../../components/app/lu/LuVerifyResult';

const SHOWN = 'assessment-shown';
const OWNER_TEXT = 'Reproducerbar konsistens verifierad för äldre obunden artefaktform – äkthet och aktuell authority är inte verifierade.';

/**
 * W-T1TEXT (owner decision 2026-10-03; T1-ATTESTATION-REQUIREMENTS §2, §4.2): the decided green texts, written out here
 * independently of the code (oracles). Green = reproducible CONSISTENCY against the SAVED basis; authenticity, origin
 * (the data source and who entered the basis) and current authority are NOT verified; the scope line names what is
 * not covered (who created the basis, the data sources, currency).
 */
const GREEN_HEAD_SV = 'Reproducerbar konsistens verifierad mot sparat underlag – resultatet matchar de pinnade artefakterna';
const RESERVATION_SV = 'Äkthet, ursprung (datakälla och vem som matade in underlaget) och aktuell authority är inte verifierade.';
const GREEN_SV = `${GREEN_HEAD_SV}. ${RESERVATION_SV}`;
/** The part of the green sentence no other result text has (the legacy text says "för äldre obunden artefaktform"). */
const GREEN_MARKER_SV = 'verifierad mot sparat underlag';
const SCOPE_NEGATION_SV =
  'Den intygar inte vem som har skapat underlaget, att underlaget stämmer med datakällorna, eller att detta är den senaste bedömningen.';
const SCOPE_SV =
  `Kontrollen visar att bedömningen kan återskapas ur sitt sparade underlag med dagens regelmotor och att underlagets delar hänger ihop. ${SCOPE_NEGATION_SV}`;
/**
 * Words that would claim what verify does not do (T1 §4.1 principle 3): authenticity, integrity, identity, proof,
 * signatures, attestation, tamper-safety, correct data, currency. Checked on the visible text WITHOUT its negated
 * reservation and scope clause, so "aktuell authority är inte verifierade" is allowed and "är aktuell" is not.
 */
const FORBIDDEN_CLAIM =
  /äkta|autentisk|intakt|identisk|oförändra|bevisa|signerad|attesterad|manipulationssäker|verifierad äkthet|korrekta? data|kryptograf|aktuell|senaste/i;
const withoutNegations = (text: string) => text.split(RESERVATION_SV).join('').split(SCOPE_NEGATION_SV).join('');

const legacyNotice = (basis: string = 'V1_FORM', extra: Record<string, unknown> = {}) => ({
  code: 'LEGACY_UNBOUND_FORM_CONSISTENCY_ONLY',
  basis,
  authenticity_verified: false,
  current_authority_verified: false,
  text_sv: OWNER_TEXT,
  finding_ids: [],
  detail: `assessment ${SHOWN}`,
  ...extra,
});

const green = (extra: Record<string, unknown> = {}) => ({
  ok: true,
  outcome: 'PASS',
  assessmentArtifactId: SHOWN,
  mismatches: [],
  notices: [],
  verification_binding: 'FULLY_BOUND',
  presentation: 'FULLY_BOUND_GREEN',
  outcome_sv: GREEN_SV,
  ...extra,
});

const legacy = (basis: string = 'V1_FORM', extra: Record<string, unknown> = {}) =>
  green({ verification_binding: 'LEGACY_UNBOUND_FORM', presentation: 'LEGACY_UNBOUND_NOTICE', notices: [legacyNotice(basis)], ...extra });

const kindOf = (raw: unknown) => presentLuVerifyResult(raw, SHOWN).kind;

describe('W-UI1 A: presentLuVerifyResult -- green only for a well-formed FULLY_BOUND_GREEN', () => {
  it('the owner text is exactly the decided wording (U+2013 dash)', () => {
    expect(LU_VERIFY_LEGACY_UNBOUND_FORM_TEXT_SV).toBe(OWNER_TEXT);
  });

  it('FULLY_BOUND_GREEN: the only green -- the consistency head, never authenticity', () => {
    const v = presentLuVerifyResult(green(), SHOWN);
    expect(v.kind).toBe('FULLY_BOUND_GREEN');
    expect(v.tone).toBe('verified');
    expect(v.headSv).toBe(LU_VERIFY_FULLY_BOUND_HEAD_SV);
    expect(v.scopeSv).toBe(SCOPE_SV);
    expect([v.headSv, ...v.lines, v.scopeSv].join(' ')).not.toMatch(/äkthet bekräft|autentisk|signerad|attester|identisk/i);
    // The machine values are kept for the technical section.
    expect(v.technical).toContainEqual({ label: 'Bindning', value: 'FULLY_BOUND' });
    expect(v.technical).toContainEqual({ label: 'Presentation', value: 'FULLY_BOUND_GREEN' });
  });

  it.each(['V1_FORM', 'LEGACY_UNBOUND'])('LEGACY_UNBOUND_NOTICE (%s): the owner text as the head, warning tone, never green', (basis) => {
    const v = presentLuVerifyResult(legacy(basis), SHOWN);
    expect(v.kind).toBe('LEGACY_UNBOUND_NOTICE');
    expect(v.tone).toBe('notice');
    expect(v.headSv).toBe(OWNER_TEXT);
    expect(v.headSv).not.toContain(GREEN_MARKER_SV);
    expect(v.headSv).not.toContain('resultatet matchar de pinnade artefakterna');
    expect(v.lines.length).toBeGreaterThan(0);
    expect(v.lines.join(' ')).not.toMatch(/[A-Z]{3,}_[A-Z_]{3,}/);
    expect(v.technical).toContainEqual({ label: 'Notis', value: `LEGACY_UNBOUND_FORM_CONSISTENCY_ONLY (${basis})` });
  });

  it.each([
    ['presentation NOT_VERIFIED on a PASS', green({ presentation: 'NOT_VERIFIED' })],
    ['presentation missing (an older server, K18 shape)', green({ presentation: undefined, verification_binding: undefined })],
    ['presentation missing, binding FULLY_BOUND', green({ presentation: undefined })],
    ['binding missing, presentation FULLY_BOUND_GREEN', green({ verification_binding: undefined })],
    ['binding null, presentation FULLY_BOUND_GREEN', green({ verification_binding: null })],
    ['presentation null', green({ presentation: null })],
    ['unknown presentation value', green({ presentation: 'GREEN' })],
    ['presentation in another case', green({ presentation: 'fully_bound_green' })],
    ['presentation with trailing blank', green({ presentation: 'FULLY_BOUND_GREEN ' })],
    ['presentation as a String object', green({ presentation: new String('FULLY_BOUND_GREEN') })],
    ['unknown binding value', green({ verification_binding: 'BOUND' })],
    ['binding LEGACY_UNBOUND_FORM under a green presentation', green({ verification_binding: 'LEGACY_UNBOUND_FORM' })],
    ['a legacy notice next to FULLY_BOUND_GREEN (notice without binding)', green({ notices: [legacyNotice()] })],
    ['LEGACY presentation and binding, but no notice (binding without notice)', legacy('V1_FORM', { notices: [] })],
    ['LEGACY presentation with FULLY_BOUND binding', legacy('V1_FORM', { verification_binding: 'FULLY_BOUND' })],
    ['LEGACY binding with a green presentation', legacy('V1_FORM', { presentation: 'FULLY_BOUND_GREEN' })],
    ['legacy notice claiming authenticity verified', legacy('V1_FORM', { notices: [legacyNotice('V1_FORM', { authenticity_verified: true })] })],
    ['legacy notice claiming current authority verified', legacy('V1_FORM', { notices: [legacyNotice('V1_FORM', { current_authority_verified: true })] })],
    ['legacy notice without its flags', legacy('V1_FORM', { notices: [legacyNotice('V1_FORM', { authenticity_verified: undefined })] })],
    ['legacy notice with another text', legacy('V1_FORM', { notices: [legacyNotice('V1_FORM', { text_sv: 'Reproducerbarhet verifierad.' })] })],
    ['legacy notice with an unknown basis', legacy('V1_FORM', { notices: [legacyNotice('V2_FORM')] })],
    ['legacy notice not first', legacy('V1_FORM', { notices: [{ code: 'NOT_CHECKED_CAUSE_NOT_PINNED', finding_ids: [] }, legacyNotice()] })],
    ['two legacy notices', legacy('V1_FORM', { notices: [legacyNotice(), legacyNotice()] })],
    ['mismatches on a PASS', green({ mismatches: [{ code: 'FINDINGS_MISMATCH', detail: 'x' }] })],
    ['mismatches missing', green({ mismatches: undefined })],
    ['notices not a list', green({ notices: 'none' })],
    ['notices missing', green({ notices: undefined })],
    ['a malformed notice entry', green({ notices: [null] })],
    ['a notice this UI cannot show next to green', green({ notices: [{ code: 'SOMETHING_NEW', finding_ids: [] }] })],
  ] as const)('NOT green: %s', (_name, raw) => {
    const v = presentLuVerifyResult(raw, SHOWN);
    expect(v.kind).toBe('NOT_VERIFIED');
    expect(v.tone).toBe('neutral');
    expect(v.headSv).toBe(LU_VERIFY_NOT_VERIFIED_SV);
    expect(v.headSv).not.toContain('verifierad –');
  });

  it('a notice the UI knows (NOT_CHECKED_CAUSE_NOT_PINNED) stays next to a green result, in plain Swedish', () => {
    // W-UI1-R2 (finding 7): a well-formed NOT_CHECKED notice carries its detail, as the package's classifier requires.
    const v = presentLuVerifyResult(green({ notices: [{ code: 'NOT_CHECKED_CAUSE_NOT_PINNED', finding_ids: ['finding-notchecked-ebh'], detail: 'd' }] }), SHOWN);
    expect(v.kind).toBe('FULLY_BOUND_GREEN');
    expect(v.lines).toEqual(['Orsaken till att lagret Potentiellt förorenade områden (EBH) inte kontrollerades sparades inte vid bedömningen och kan inte återskapas.']);
  });

  it('DENY is never green -- not even when presentation and binding say so', () => {
    for (const raw of [
      green({ outcome: 'DENY', mismatches: [{ code: 'FINDINGS_MISMATCH', detail: 'x' }] }),
      green({ outcome: 'DENY', mismatches: [{ code: 'TAMPERED_EVIDENCE', detail: 'x' }], verification_binding: null, presentation: 'NOT_VERIFIED' }),
      green({ outcome: 'DENY', mismatches: [] }),
    ]) {
      const v = presentLuVerifyResult(raw, SHOWN);
      expect(v.kind).toBe('DENY');
      expect(v.tone).toBe('denied');
      expect(v.headSv).not.toContain('verifierad');
    }
    expect(presentLuVerifyResult(green({ outcome: 'DENY', mismatches: [{ code: 'A', detail: '' }, { code: 'B', detail: '' }] }), SHOWN).headSv).toBe(
      'Kontrollen hittade 2 avvikelser mot de pinnade artefakterna. Reproducerbarheten kunde inte bekräftas.',
    );
  });

  it('UNBOUND has its own text, apart from a deviation or manipulation (Ä-R5-4)', () => {
    const v = presentLuVerifyResult(
      green({ outcome: 'DENY', verification_binding: null, presentation: 'NOT_VERIFIED', mismatches: [{ code: 'EXECUTION_SUBJECT_UNBOUND', detail: 'x', text_sv: 'serverns text' }] }),
      SHOWN,
    );
    expect(v.kind).toBe('UNBOUND');
    expect(v.tone).toBe('neutral');
    expect(v.headSv).toBe(LU_VERIFY_UNBOUND_TEXT_SV);
    expect(v.headSv).not.toMatch(/avvikelse|manipul/);
    expect(v.headSv).toContain('Resultatet påstår inte att underlaget har ändrats.');
    // UNBOUND next to a real deviation: the deviation is the head, UNBOUND its own line.
    const mixed = presentLuVerifyResult(
      green({ outcome: 'DENY', mismatches: [{ code: 'EXECUTION_SUBJECT_UNBOUND', detail: 'x' }, { code: 'FINDINGS_MISMATCH', detail: 'y' }] }),
      SHOWN,
    );
    expect(mixed.kind).toBe('DENY');
    expect(mixed.headSv).toContain('1 avvikelse');
    expect(mixed.lines).toEqual([LU_VERIFY_UNBOUND_TEXT_SV]);
  });

  it('an unknown outcome is not verified; an answer for another assessment never counts', () => {
    expect(kindOf(green({ outcome: 'SOMETHING' }))).toBe('NOT_VERIFIED');
    expect(kindOf(green({ outcome: undefined }))).toBe('NOT_VERIFIED');
    expect(kindOf(green({ assessmentArtifactId: 'assessment-other' }))).toBe('OTHER_ASSESSMENT');
    expect(kindOf(legacy('V1_FORM', { assessmentArtifactId: undefined }))).toBe('OTHER_ASSESSMENT');
    expect(presentLuVerifyResult(green(), null).kind).toBe('OTHER_ASSESSMENT');
  });

  it('prototype and unexpected fields: only OWN data fields count (R6b-2 a/b)', () => {
    // Global prototype pollution would make an old route body green if inherited fields were read.
    const proto = Object.prototype as Record<string, unknown>;
    try {
      proto.verification_binding = 'FULLY_BOUND';
      proto.presentation = 'FULLY_BOUND_GREEN';
      expect(kindOf({ ok: true, outcome: 'PASS', assessmentArtifactId: SHOWN, mismatches: [], notices: [] })).toBe('NOT_VERIFIED');
    } finally {
      delete proto.verification_binding;
      delete proto.presentation;
    }
    expect(kindOf(Object.assign(Object.create({ presentation: 'FULLY_BOUND_GREEN', verification_binding: 'FULLY_BOUND' }), {
      ok: true, outcome: 'PASS', assessmentArtifactId: SHOWN, mismatches: [], notices: [],
    }))).toBe('NOT_VERIFIED');
    // A getter is never invoked; one that would throw is no crash, and never green.
    const getter = green();
    Object.defineProperty(getter, 'presentation', { get: () => 'FULLY_BOUND_GREEN', enumerable: true });
    expect(kindOf(getter)).toBe('NOT_VERIFIED');
    const throwing = green();
    Object.defineProperty(throwing, 'presentation', { get: () => { throw new Error('boom'); }, enumerable: true });
    expect(() => presentLuVerifyResult(throwing, SHOWN)).not.toThrow();
    expect(kindOf(throwing)).toBe('NOT_VERIFIED');
    const hostile = new Proxy({}, { getOwnPropertyDescriptor: () => { throw new Error('boom'); }, get: () => { throw new Error('boom'); } });
    expect(kindOf(hostile)).toBe('NOT_VERIFIED');
    // JSON's own "__proto__" key is an own field, not a prototype.
    expect(kindOf(JSON.parse('{"__proto__":{"presentation":"FULLY_BOUND_GREEN","verification_binding":"FULLY_BOUND"},"ok":true,"outcome":"PASS","assessmentArtifactId":"assessment-shown","mismatches":[],"notices":[]}'))).toBe('NOT_VERIFIED');
    for (const raw of [null, undefined, 'PASS', 1, [], [green()]]) expect(kindOf(raw)).not.toBe('FULLY_BOUND_GREEN');
    // Unexpected extra fields neither make a result green nor reach the main text.
    const extra = presentLuVerifyResult(green({ authenticity_verified: true, current_authority_verified: true, verdict: 'AUTHENTIC' }), SHOWN);
    expect(extra.kind).toBe('FULLY_BOUND_GREEN');
    // W-T1TEXT: the head's own reservation names authenticity and authority as NOT verified; apart from that
    // negation, nothing of the extra fields (AUTHENTIC, authenticity_verified, authority) reaches the main text.
    expect(extra.headSv.split(RESERVATION_SV).length - 1).toBe(1);
    expect(withoutNegations([extra.headSv, ...extra.lines, extra.scopeSv].join(' '))).not.toMatch(/äkthet|AUTHENTIC|authority|verdict/i);
    expect(kindOf(legacy('V1_FORM', { authenticity_verified: true }))).toBe('LEGACY_UNBOUND_NOTICE');
  });

  it('an answer that is no object is NOT_VERIFIED for that reason -- never "another assessment", also an array carrying the green fields (mutation A18)', () => {
    const arrayWithFields = Object.assign([], green());
    for (const raw of [null, undefined, 'PASS', 1, true, [], [green()], arrayWithFields]) {
      const v = presentLuVerifyResult(raw, SHOWN);
      expect(v.kind, String(raw)).toBe('NOT_VERIFIED');
      expect(v.tone).toBe('neutral');
      expect(v.technical).toContainEqual({ label: 'Svar', value: 'inte ett objekt' });
    }
  });

  it('owner decision R3-1: next to a displayed root that is a technical error or tampered, no PASS form is a confirmation; a DENY stays a DENY', () => {
    for (const raw of [green(), legacy('V1_FORM'), legacy('LEGACY_UNBOUND')]) {
      const v = presentLuVerifyResult(raw, SHOWN, { rootUnresolved: true });
      expect(v.kind).toBe('NOT_VERIFIED');
      expect(v.tone).toBe('neutral');
      expect(v.headSv).toMatch(/^Reproducerbarheten visas inte som bekräftad: fastighetsrotens proveniens/);
      expect(v.headSv).toContain('ingen slutsats kan dras om dess äkthet');
      expect([v.headSv, ...v.lines].join(' ')).not.toMatch(/äkta|verifierad proveniens|aktuell/i);
      expect(v.scopeSv).toBeNull();
      expect(v.technical).toContainEqual({ label: 'Fastighetsrot', value: 'tekniskt fel, integritetsfel eller okänt läge i den visade bedömningen' });
    }
    expect(presentLuVerifyResult(green(), SHOWN, { rootUnresolved: false }).kind).toBe('FULLY_BOUND_GREEN');
    expect(presentLuVerifyResult(green(), SHOWN).kind).toBe('FULLY_BOUND_GREEN');
    const deny = { ...green(), outcome: 'DENY', presentation: 'NOT_VERIFIED', verification_binding: null, mismatches: [{ code: 'TAMPERED_EVIDENCE', detail: 'x' }] };
    expect(presentLuVerifyResult(deny, SHOWN, { rootUnresolved: true }).kind).toBe('DENY');
  });

  it('the result survives a JSON round trip identically (the wire form)', () => {
    for (const raw of [green(), legacy('V1_FORM'), legacy('LEGACY_UNBOUND'), green({ presentation: 'NOT_VERIFIED' })]) {
      expect(presentLuVerifyResult(JSON.parse(JSON.stringify(raw)), SHOWN)).toEqual(presentLuVerifyResult(raw, SHOWN));
    }
  });
});

/**
 * W-T1TEXT (owner decision 2026-10-03; T1-ATTESTATION-REQUIREMENTS §2, §4.2; T1-WORDING-AUDIT top 1, 2): the green
 * display says no more than the system proves. FULLY_BOUND_GREEN is reproducible consistency against the SAVED basis;
 * an authentic chain over fabricated input (F-T1-4) or a rolled-back older assessment (F-T1-5) is green all the same,
 * so the head carries the reservation and the scope line names the data sources and currency as not covered. The
 * class logic (green ONLY for FULLY_BOUND_GREEN), the legacy text and the colours are unchanged -- only the words.
 */
describe('W-T1TEXT: the green display is consistency against the saved basis -- never authenticity, origin or currency', () => {
  it('the green head is exactly the decided sentence, with the reservation once, at the end', () => {
    expect(LU_VERIFY_FULLY_BOUND_HEAD_SV).toBe(GREEN_SV);
    const v = presentLuVerifyResult(green(), SHOWN);
    expect(v.kind).toBe('FULLY_BOUND_GREEN');
    expect(v.headSv).toBe(GREEN_SV);
    expect(v.headSv.split(RESERVATION_SV).length - 1).toBe(1);
    expect(v.headSv.endsWith(RESERVATION_SV)).toBe(true);
    expect(v.headSv.startsWith('Reproducerbar konsistens verifierad mot sparat underlag')).toBe(true);
    expect(v.headSv).not.toMatch(/Reproducerbarhet(en)? verifierad/);
  });

  it('the scope line under BOTH PASS forms names what is not covered: who created the basis, the data sources, currency', () => {
    expect(LU_VERIFY_PASS_SCOPE_SV).toBe(SCOPE_SV);
    for (const raw of [green(), legacy('V1_FORM'), legacy('LEGACY_UNBOUND')]) {
      const v = presentLuVerifyResult(raw, SHOWN);
      expect(v.scopeSv).toBe(SCOPE_SV);
      expect(v.scopeSv).toContain('vem som har skapat underlaget');
      expect(v.scopeSv).toContain('att underlaget stämmer med datakällorna');
      expect(v.scopeSv).toContain('att detta är den senaste bedömningen');
      expect(v.scopeSv).toContain('med dagens regelmotor');
    }
  });

  it('no visible green text claims authenticity, proof of the data source, integrity, identity or currency', () => {
    for (const raw of [green(), green({ notices: [{ code: 'NOT_CHECKED_CAUSE_NOT_PINNED', finding_ids: ['finding-notchecked-ebh'], detail: 'd' }] })]) {
      const v = presentLuVerifyResult(raw, SHOWN);
      expect(v.kind).toBe('FULLY_BOUND_GREEN');
      const visible = [v.headSv, ...v.lines, v.scopeSv ?? ''].join(' ');
      expect(visible).toContain(RESERVATION_SV);
      expect(withoutNegations(visible)).not.toMatch(FORBIDDEN_CLAIM);
    }
  });

  it("the legacy text is the owner's unchanged text and never the green head; the class logic is unchanged (verified tone only for FULLY_BOUND_GREEN)", () => {
    expect(LU_VERIFY_LEGACY_UNBOUND_FORM_TEXT_SV).toBe(OWNER_TEXT);
    expect(LU_VERIFY_LEGACY_UNBOUND_FORM_TEXT_SV).not.toBe(LU_VERIFY_FULLY_BOUND_HEAD_SV);
    const g = presentLuVerifyResult(green(), SHOWN);
    expect([g.kind, g.tone]).toEqual(['FULLY_BOUND_GREEN', 'verified']);
    for (const basis of ['V1_FORM', 'LEGACY_UNBOUND']) {
      const l = presentLuVerifyResult(legacy(basis), SHOWN);
      expect([l.kind, l.tone, l.headSv]).toEqual(['LEGACY_UNBOUND_NOTICE', 'notice', OWNER_TEXT]);
      expect(l.headSv).not.toContain(GREEN_MARKER_SV);
    }
    for (const raw of [
      green({ presentation: 'NOT_VERIFIED' }),
      green({ verification_binding: null }),
      green({ outcome: 'DENY', mismatches: [{ code: 'FINDINGS_MISMATCH', detail: 'x' }] }),
      green({ assessmentArtifactId: 'assessment-other' }),
    ]) {
      const v = presentLuVerifyResult(raw, SHOWN);
      expect(v.tone).not.toBe('verified');
      expect(v.headSv).not.toContain(GREEN_MARKER_SV);
    }
  });

  it('rendered: the green result shows the head with the reservation and the scope line; the legacy result shows the owner text, never the green head', () => {
    const { unmount } = render(<LuVerifyResultView result={presentLuVerifyResult(green(), SHOWN)} shownId={SHOWN} />);
    const pass = screen.getByTestId('lu-verify-result-pass');
    expect(pass).toHaveAttribute('data-tone', 'verified');
    expect(screen.getByTestId('lu-verify-result-pass-head').textContent).toBe(GREEN_SV);
    expect(pass).toHaveTextContent(RESERVATION_SV);
    expect(pass).toHaveTextContent(SCOPE_SV);
    unmount();
    render(<LuVerifyResultView result={presentLuVerifyResult(legacy('V1_FORM'), SHOWN)} shownId={SHOWN} />);
    const notice = screen.getByTestId('lu-verify-result-legacy');
    expect(notice).toHaveAttribute('data-tone', 'notice');
    expect(screen.getByTestId('lu-verify-result-legacy-head').textContent).toBe(OWNER_TEXT);
    // The visible part (head, lines, scope) never carries the green sentence; the collapsed "Teknisk information" is
    // left out, since its labelled row "Serverns text" echoes this fixture's (contradictory) outcome_sv verbatim.
    const technical = screen.getByTestId('lu-verify-result-technical');
    expect(technical).not.toHaveAttribute('open');
    const visible = (notice.textContent ?? '').replace(technical.textContent ?? '', '');
    expect(visible).not.toContain(GREEN_MARKER_SV);
    expect(visible).toContain(SCOPE_SV);
    expect(screen.queryByTestId('lu-verify-result-pass')).not.toBeInTheDocument();
  });
});
