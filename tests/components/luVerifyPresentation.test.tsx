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
import { describe, expect, it } from 'vitest';
import {
  LU_VERIFY_FULLY_BOUND_HEAD_SV,
  LU_VERIFY_LEGACY_UNBOUND_FORM_TEXT_SV,
  LU_VERIFY_NOT_VERIFIED_SV,
  LU_VERIFY_UNBOUND_TEXT_SV,
  presentLuVerifyResult,
} from '../../components/app/lu/luVerifyPresentation';

const SHOWN = 'assessment-shown';
const OWNER_TEXT = 'Reproducerbar konsistens verifierad för äldre obunden artefaktform – äkthet och aktuell authority är inte verifierade.';

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
  outcome_sv: 'Reproducerbarhet verifierad – resultatet matchar de pinnade artefakterna.',
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
    expect(v.scopeSv).toContain('Den intygar inte vem som har skapat underlaget.');
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
    expect(v.headSv).not.toContain('Reproducerbarheten verifierad');
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
    const v = presentLuVerifyResult(green({ notices: [{ code: 'NOT_CHECKED_CAUSE_NOT_PINNED', finding_ids: ['finding-notchecked-ebh'] }] }), SHOWN);
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
    expect([extra.headSv, ...extra.lines, extra.scopeSv].join(' ')).not.toMatch(/äkthet|AUTHENTIC|authority/i);
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

  it('the result survives a JSON round trip identically (the wire form)', () => {
    for (const raw of [green(), legacy('V1_FORM'), legacy('LEGACY_UNBOUND'), green({ presentation: 'NOT_VERIFIED' })]) {
      expect(presentLuVerifyResult(JSON.parse(JSON.stringify(raw)), SHOWN)).toEqual(presentLuVerifyResult(raw, SHOWN));
    }
  });
});
