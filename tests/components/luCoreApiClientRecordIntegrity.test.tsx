/**
 * W-UI1 (B; U20CDF4 424 body) and W-UI1-R2 (owner condition 2026-10-03; UI1-VERIFICATION finding 2): the API client
 * carries exactly ONE typed structure beyond the codes -- the 424 ASSESSMENT_RECORD_INTEGRITY_ERROR's
 * `record_integrity` -- rebuilt from an explicit whitelist (the same keys as the server's recordIntegrityDiagnosticWire):
 * known keys and types only, the record id and the basis codes checked by form, arrays capped, counts non-negative
 * integers, every unknown or nested unknown key dropped, the server's note and every free text never carried, only
 * for that code, and only when the source says itself that it is unverified and not authoritative. No other field of
 * the body reaches the thrown error. No network: csrfFetch is mocked.
 */
import React from 'react';
import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const csrfFetch = vi.hoisted(() => vi.fn());
vi.mock('../../services/csrfClient', () => ({ csrfFetch: (...args: unknown[]) => csrfFetch(...args) }));

import { callApi, luRecordIntegrityWire, LU_RECORD_INTEGRITY_MAX_BASIS_CODES, LU_RECORD_INTEGRITY_MAX_ENTRIES } from '../../services/coreApiClient';
import { presentLuError } from '../../components/app/lu/luErrorPresentation';
import { LuErrorNotice } from '../../components/app/lu/LuErrorNotice';
import { parseLuRecordIntegrityDiagnostic } from '../../components/app/lu/luRecordIntegrity';

const json = (body: unknown, status: number) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const CODE = 'ASSESSMENT_RECORD_INTEGRITY_ERROR';

/** The server's wire form (recordIntegrityDiagnosticWire) of one record. */
const wire = () => ({
  authoritative: false,
  verified: false,
  note_sv: 'Diagnostisk uppgift ur den lagrade posten: inte verifierad, inte auktoritativ och ingen bedömning. Fynden får inte läsas som bedömningens resultat.',
  assessment_artifact_id: 'assess-broken-1',
  basis_codes: ['UNKNOWN_SEVERITY'],
  stored_findings_unverified: {
    total: 2,
    highest_level: 'HIGH',
    counts: { high: 1, medium: 0, low: 0, not_checked: 0, unknown_level: 1, malformed: 0 },
    truncated: false,
    entries: [
      { check: 'ebh', rule: 'LU-EBH-001', stored_level: 'HIGH', well_formed: true },
      { check: 'water', rule: 'LU-WATER-001', stored_level: 'UNKNOWN', well_formed: true },
    ],
  },
});

/** What the client carries for wire(): the same keys, the note left out (the UI has its own). */
const carried = () => {
  const { note_sv: _note, ...rest } = wire();
  return rest;
};

async function thrown(body: Record<string, unknown>, status = 424): Promise<Record<string, unknown>> {
  csrfFetch.mockResolvedValue(json(body, status));
  return (await callApi('/api/localization/p/current-assessment', { method: 'GET', auth: false }).catch((e) => e)) as Record<string, unknown>;
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('W-UI1-R2: callApi carries the 424 record_integrity only through the whitelist', () => {
  it('the server\'s wire form is carried key for key -- without the server\'s note', async () => {
    const err = await thrown({ ok: false, error: 'Bedömningen kan inte visas', code: CODE, failureClass: 'RECORD_INTEGRITY_ERROR', retryable: false, record_integrity: wire() });
    expect(err).toBeInstanceOf(Error);
    expect(err.status).toBe(424);
    expect(err.code).toBe(CODE);
    expect(err.retryable).toBe(false);
    expect(err.record_integrity).toEqual(carried());
  });

  it('no other field of the body reaches the thrown error (mutation H1b): only status, the codes, retryable and the whitelisted record_integrity', async () => {
    const err = await thrown({
      ok: false,
      error: 'x',
      code: CODE,
      failureClass: 'RECORD_INTEGRITY_ERROR',
      reasonCode: 'UNKNOWN_SEVERITY',
      retryable: false,
      record_integrity: wire(),
      stack: 'SERVER STACK at /srv/app.js:1',
      details: { sql: 'SELECT * FROM users' },
      diagnostic: { secret: 'ZZSECRET' },
      ZZTOP: 'ZZVALUE',
      note_sv: 'ZZNOTE',
      findings: [{ risk_level: 'LOW' }],
    });
    expect(Object.keys(err).sort()).toEqual(['code', 'failureClass', 'reasonCode', 'record_integrity', 'retryable', 'status']);
    expect(String(err.stack)).not.toContain('SERVER STACK');
    expect(JSON.stringify(err)).not.toMatch(/ZZ|SELECT|users|"findings"/);
  });

  it('only for ASSESSMENT_RECORD_INTEGRITY_ERROR: another code or no code carries none', async () => {
    for (const [code, status] of [['GOVERNED_EVIDENCE_INTEGRITY_FAILED', 424], ['ASSESSMENT_PINNED_EVIDENCE_UNREADABLE', 503], [undefined, 424], [undefined, 500]] as const) {
      const err = await thrown({ ok: false, error: 'x', ...(code ? { code } : {}), record_integrity: wire() }, status);
      expect(Object.prototype.hasOwnProperty.call(err, 'record_integrity'), String(code)).toBe(false);
    }
  });

  it('never a record_integrity that is not a plain object, or that does not say itself it is unverified and not authoritative', async () => {
    for (const value of [null, 'x', 1, ['a'], true]) {
      const err = await thrown({ ok: false, error: 'x', code: CODE, record_integrity: value });
      expect(Object.prototype.hasOwnProperty.call(err, 'record_integrity'), JSON.stringify(value)).toBe(false);
    }
    for (const flags of [{ authoritative: true }, { verified: true }, { authoritative: undefined }, { verified: 'false' }, { authoritative: 0 }]) {
      expect(luRecordIntegrityWire(CODE, { ...wire(), ...flags }), JSON.stringify(flags)).toBeNull();
    }
    // Inherited flags are no flags.
    const inherited = Object.assign(Object.create({ authoritative: false, verified: false }), { assessment_artifact_id: 'a-1' });
    expect(luRecordIntegrityWire(CODE, inherited)).toBeNull();
  });

  it('every unknown key is dropped, also nested ones; the result always says authoritative:false, verified:false', () => {
    const source = {
      ...wire(),
      ZZTOP_UNKNOWN: 'ZZVALUE',
      findings: [{ risk_level: 'LOW' }],
      assessment_status: 'ASSESSED',
      overall_risk_level: 'LOW',
      bestAlternativeId: 'site-1',
      stack: 'STACK',
      message: 'MESSAGE',
      stored_findings_unverified: {
        ...wire().stored_findings_unverified,
        ZZNESTED: 'x',
        counts: { ...wire().stored_findings_unverified.counts, ZZEXTRA: 9 },
        entries: [{ check: 'ebh', rule: 'LU-EBH-001', stored_level: 'HIGH', well_formed: true, explanation: 'ZZEXPLAIN', extra: { a: 1 } }],
      },
    };
    const out = luRecordIntegrityWire(CODE, source)!;
    expect(Object.keys(out).sort()).toEqual(['assessment_artifact_id', 'authoritative', 'basis_codes', 'stored_findings_unverified', 'verified']);
    expect(Object.keys(out.stored_findings_unverified!).sort()).toEqual(['counts', 'entries', 'highest_level', 'total', 'truncated']);
    expect(Object.keys(out.stored_findings_unverified!.counts).sort()).toEqual(['high', 'low', 'malformed', 'medium', 'not_checked', 'unknown_level']);
    expect(Object.keys(out.stored_findings_unverified!.entries[0]!).sort()).toEqual(['check', 'rule', 'stored_level', 'well_formed']);
    expect(JSON.stringify(out)).not.toMatch(/ZZ|STACK|MESSAGE|ASSESSED|site-1|note_sv|Diagnostisk/);
    expect(out.authoritative).toBe(false);
    expect(out.verified).toBe(false);
  });

  it('the record id is a plain artifact id or it is dropped; basis codes are code-shaped, deduplicated and capped', () => {
    for (const bad of ['../../etc/passwd', 'a b', 'x'.repeat(129), '', 42, null, 'id;DROP TABLE x', '-leading']) {
      const out = luRecordIntegrityWire(CODE, { ...wire(), assessment_artifact_id: bad })!;
      expect(out, String(bad)).not.toBeNull();
      expect(Object.prototype.hasOwnProperty.call(out, 'assessment_artifact_id'), String(bad)).toBe(false);
    }
    expect(luRecordIntegrityWire(CODE, { ...wire(), assessment_artifact_id: 'assess-1.v2:x_y' })!.assessment_artifact_id).toBe('assess-1.v2:x_y');
    const basis = ['UNKNOWN_SEVERITY', 'UNKNOWN_SEVERITY', 'SELECT * FROM users', 'lower_case', 'A'.repeat(65), 7, null, 'LAYER_NOT_RECORDED'];
    expect(luRecordIntegrityWire(CODE, { ...wire(), basis_codes: basis })!.basis_codes).toEqual(['UNKNOWN_SEVERITY', 'LAYER_NOT_RECORDED']);
    const many = Array.from({ length: 100 }, (_, i) => `CODE_${i}`);
    expect(luRecordIntegrityWire(CODE, { ...wire(), basis_codes: many })!.basis_codes).toHaveLength(LU_RECORD_INTEGRITY_MAX_BASIS_CODES);
    expect(luRecordIntegrityWire(CODE, { ...wire(), basis_codes: 'UNKNOWN_SEVERITY' })!.basis_codes).toEqual([]);
  });

  it('counts are non-negative safe integers (else 0); levels, checks and rule ids are the known values (else UNKNOWN/null); entries are capped and say so', () => {
    const counts = { high: -1, medium: 1.5, low: '3', not_checked: Number.MAX_SAFE_INTEGER + 2, unknown_level: 4, malformed: null };
    const entries = [
      { check: 'ebh', rule: 'LU-EBH-001', stored_level: 'HIGH', well_formed: true },
      { check: 'somewhere', rule: 'not a rule', stored_level: 'CATASTROPHIC', well_formed: 'yes' },
      { check: 'document', rule: 'LU-DOC-BESLUT-001', stored_level: 'NOT_CHECKED', well_formed: false },
      'not an entry',
    ];
    const out = luRecordIntegrityWire(CODE, {
      ...wire(),
      stored_findings_unverified: { total: -5, highest_level: 'CATASTROPHIC', counts, truncated: 'yes', entries },
    })!.stored_findings_unverified!;
    expect(out.total).toBe(0);
    expect(out.highest_level).toBeNull();
    expect(out.counts).toEqual({ high: 0, medium: 0, low: 0, not_checked: 0, unknown_level: 4, malformed: 0 });
    expect(out.truncated).toBe(false);
    expect(out.entries).toEqual([
      { check: 'ebh', rule: 'LU-EBH-001', stored_level: 'HIGH', well_formed: true },
      { check: null, rule: null, stored_level: 'UNKNOWN', well_formed: false },
      { check: 'document', rule: 'LU-DOC-BESLUT-001', stored_level: 'NOT_CHECKED', well_formed: false },
      { check: null, rule: null, stored_level: 'UNKNOWN', well_formed: false },
    ]);
    const long = Array.from({ length: 250 }, () => ({ check: 'ebh', rule: 'LU-EBH-001', stored_level: 'LOW', well_formed: true }));
    const capped = luRecordIntegrityWire(CODE, { ...wire(), stored_findings_unverified: { ...wire().stored_findings_unverified, entries: long } })!.stored_findings_unverified!;
    expect(capped.entries).toHaveLength(LU_RECORD_INTEGRITY_MAX_ENTRIES);
    expect(capped.truncated).toBe(true);
  });

  it('a getter is never invoked and an inherited key is never read', () => {
    let called = false;
    const source = wire() as Record<string, unknown>;
    Object.defineProperty(source, 'assessment_artifact_id', { get: () => { called = true; return 'assess-x'; }, enumerable: true });
    const out = luRecordIntegrityWire(CODE, source)!;
    expect(called).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(out, 'assessment_artifact_id')).toBe(false);
    const proto = Object.prototype as Record<string, unknown>;
    try {
      proto.basis_codes = ['POLLUTED_CODE'];
      const { basis_codes: _b, ...noBasis } = wire();
      expect(luRecordIntegrityWire(CODE, noBasis)!.basis_codes).toEqual([]);
    } finally {
      delete proto.basis_codes;
    }
  });
});

describe('W-UI1-R2: the diagnostic parser shows only its own words and validated values (mutations H3, H5)', () => {
  const hostile = () => ({
    ...wire(),
    note_sv: 'ZZHOSTILE_NOTE',
    ZZTOP_UNKNOWN: 'ZZVALUE',
    assessment_artifact_id: '../../etc/passwd',
    basis_codes: ['SELECT * FROM users', 'UNKNOWN_SEVERITY'],
  });

  it('the server\'s note is never shown; the note is the UI\'s own sentence (H3)', () => {
    const view = parseLuRecordIntegrityDiagnostic(hostile())!;
    expect(view.noteSv).toBe(
      'Uppgifterna kommer ur den lagrade posten. De är inte verifierade och inte auktoritativa, och de är ingen bedömning – de får inte läsas som bedömningens resultat.',
    );
    expect(JSON.stringify(view)).not.toContain('ZZHOSTILE_NOTE');
  });

  it('no raw JSON and no unknown key or free text in any row (H5); an id or basis code of the wrong form is not shown', () => {
    const view = parseLuRecordIntegrityDiagnostic(hostile())!;
    expect(view.technical).toEqual([{ label: 'Grund', value: 'UNKNOWN_SEVERITY' }]);
    const shown = [view.headSv, view.noteSv, view.truncatedSv ?? '', ...view.entries, ...view.rows.map((r) => `${r.label} ${r.value}`), ...view.technical.map((r) => `${r.label} ${r.value}`)].join(' ');
    expect(shown).not.toMatch(/ZZ|passwd|SELECT|[{}"]/);
    const fine = parseLuRecordIntegrityDiagnostic(wire())!;
    expect(fine.technical).toEqual([
      { label: 'Grund', value: 'UNKNOWN_SEVERITY' },
      { label: 'Postens id', value: 'assess-broken-1' },
    ]);
  });

  it('end to end: a hostile 424 body through callApi, presentLuError and the notice -- nothing hostile in the DOM, collapsed or not', async () => {
    const err = await thrown({ ok: false, error: 'x', code: CODE, failureClass: 'RECORD_INTEGRITY_ERROR', retryable: false, record_integrity: hostile(), ZZTOP: 'ZZVALUE' });
    const { container } = render(<LuErrorNotice error={presentLuError(err, 'current-assessment')} testId="ri" />);
    expect(container.querySelector('[data-testid="ri-diagnostic"]')).not.toBeNull();
    expect(container.textContent ?? '').not.toMatch(/ZZ|passwd|SELECT|Diagnostisk uppgift/);
    expect(container.innerHTML).not.toMatch(/ZZ|passwd|SELECT/);
  });
});
