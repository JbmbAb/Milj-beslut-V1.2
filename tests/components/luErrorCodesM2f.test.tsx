/**
 * W-UI1 (B, M2f) -- Swedish texts for every new error code and status, retry governed by the SERVER's
 * `retryable` flag (owner decision 2, 2026-10-03), the record-integrity diagnostic, the not-ranked consumer,
 * historical coverage, the "0 av M" invariant, internal terms out of the visible text (C/D), and the
 * property root's transient read fault (D). Pure: no network, no database.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  describeBootstrapFailure,
  presentBootstrapFailure,
  presentCurrentnessFailureClass,
  presentLuAssessmentStatus,
  presentLuError,
  type LuErrorContext,
} from '../../components/app/lu/luErrorPresentation';
import { LuErrorNotice } from '../../components/app/lu/LuErrorNotice';
import { presentLuOverallStatement } from '../../components/app/lu/luOverallStatement';
import { presentLuControlChecks } from '../../components/app/lu/luControlChecks';
import { presentLuSiteRanking } from '../../components/app/lu/luSiteRanking';
import { parseLuRecordIntegrityDiagnostic } from '../../components/app/lu/luRecordIntegrity';
import { presentServerTextSv } from '../../components/app/lu/luServerText';

const httpError = (status: number, message: string, extra: Record<string, unknown> = {}) => Object.assign(new Error(message), { status, ...extra });
const RAW_CODE = /[A-Z]{3,}_[A-Z0-9_]{3,}/;
const INTERNAL = /\bCAS\b|\((?:[A-Z][A-Z0-9]*_[A-Z0-9_]+)(?::[^)]*)?\)|[0-9a-f]{16,}|[A-Za-z]:\\|\/[a-z]+\//;
const CONTEXTS: LuErrorContext[] = ['current-assessment', 'viewer-evidence', 'export', 'verify', 'geometry-load', 'geometry-save', 'bootstrap-retry', 'run'];

describe('W-UI1 B: own Swedish text for every new code -- headline, what happened, what the user can do; codes only technical', () => {
  // [code, failureClass, reasonCode, status, server retryable, required text, kind]
  it.each([
    ['ASSESSMENT_PINNED_EVIDENCE_UNREADABLE', 'READ_ERROR', 'EVIDENCE_READ_ERROR', 503, true, 'Den pinnade evidensen som bedömningen är bunden till kunde inte läsas just nu', 'TECHNICAL'],
    ['ASSESSMENT_PINNED_EVIDENCE_UNREADABLE', 'MISSING_FROM_CAS', 'EVIDENCE_NOT_FOUND', 503, false, 'Den pinnade evidensen som bedömningen är bunden till kunde inte hämtas ur arkivet', 'INTEGRITY'],
    ['ASSESSMENT_PINNED_EVIDENCE_UNREADABLE', 'READ_ERROR', 'ROOT_READ_ERROR', 503, true, 'Fastighetsrotens proveniens kunde inte läsas just nu', 'TECHNICAL'],
    ['ASSESSMENT_BINDING_UNRESOLVED', 'READ_ERROR', 'READ_ERROR', 503, true, 'Bedömningens koppling till projektet kunde inte läsas just nu', 'TECHNICAL'],
    ['ASSESSMENT_BINDING_UNRESOLVED', 'STORAGE_INTEGRITY_FAULT', 'STORAGE_INTEGRITY_FAULT', 503, false, 'Bedömningens koppling till projektet kunde inte läsas eller bekräftas ur arkivet', 'INTEGRITY'],
    ['ASSESSMENT_BINDING_UNRESOLVED', 'MISSING_FROM_CAS', 'MISSING_FROM_CAS', 503, false, 'Bedömningens koppling till projektet kunde inte hämtas ur arkivet', 'INTEGRITY'],
    ['ASSESSMENT_BINDING_UNRESOLVED', 'BINDING_INDEX_INCONSISTENT', 'BINDING_INDEX_INCONSISTENT', 503, false, 'registreringen av kopplingar motsäger sig själv', 'INTEGRITY'],
    ['VIEWER_PRESENTATION_UNRESOLVED', 'REFUSED', 'REJECT_LOCALIZATION_PRESENTATION', 424, false, 'Kartans styrda underlag (bedömning, evidens eller visningsbehörighet) underkändes vid kontrollen', 'REFUSED'],
    ['VIEWER_PRESENTATION_UNRESOLVED', 'READ_ERROR', 'READ_ERROR', 503, true, 'Kartans styrda underlag (bedömning, evidens eller visningsbehörighet) kunde inte läsas just nu', 'TECHNICAL'],
    ['ASSESSMENT_PDF_CONTEXT_UNRESOLVED', 'READ_ERROR', 'ROOT_READ_ERROR', 503, true, 'Bedömningens fastighetsrot kunde inte läsas just nu', 'TECHNICAL'],
    ['ASSESSMENT_PDF_CONTEXT_UNRESOLVED', 'STORAGE_INTEGRITY_FAULT', 'STORAGE_INTEGRITY_FAULT', 503, false, 'Bedömningens fastighets- eller projektkontext kunde inte läsas eller bekräftas ur arkivet', 'INTEGRITY'],
    ['ASSESSMENT_PDF_CONTEXT_UNRESOLVED', 'REFUSED', 'MALFORMED_RECORD_ENTRY', 409, false, 'bedömningen saknar en giltig referens till sin kontext', 'REFUSED'],
    ['PROJECT_ACCESS_UNRESOLVED', 'READ_ERROR', 'READ_ERROR', 503, true, 'Behörigheten till projektet kunde inte läsas just nu', 'TECHNICAL'],
    ['PROJECT_CONTEXT_UNRESOLVED', 'READ_ERROR', 'READ_ERROR', 503, true, 'Projektets koppling till fastigheten kunde inte läsas just nu', 'TECHNICAL'],
    ['PROJECT_CONTEXT_UNRESOLVED', 'REFUSED', 'REJECT_PROJECT_CONTEXT_BINDING_V2', 409, false, 'Projektets koppling till fastigheten underkändes vid kontrollen', 'REFUSED'],
    ['VIEWER_CAPABILITY_UNRESOLVED', 'STORAGE_INTEGRITY_FAULT', 'REJECT_VIEWER_CAPABILITY_PROJECT', 503, false, 'Kartvisningens behörighet kunde inte läsas eller bekräftas ur arkivet', 'INTEGRITY'],
    ['ASSESSMENT_RECORD_INTEGRITY_ERROR', 'RECORD_INTEGRITY_ERROR', 'UNKNOWN_SEVERITY', 424, false, 'Postens integritet kan inte intygas', 'INTEGRITY'],
    ['BOOTSTRAP_ADMIT_FLAG_OUTSIDE_TEST', '', '', 503, false, 'servern är felkonfigurerad', 'TECHNICAL'],
  ] as const)('%s / %s (%s) -> own text, retry exactly when the server says so', (code, failureClass, reasonCode, status, retryable, text, kind) => {
    for (const context of CONTEXTS) {
      const err = httpError(status, `Serverns råtext med ${code} och ${reasonCode}`, { code, failureClass: failureClass || undefined, reasonCode: reasonCode || undefined, retryable });
      const p = presentLuError(err, context);
      expect(p.kind, `${code}@${context}`).toBe(kind);
      expect(p.messageSv, `${code}@${context}`).toContain(text);
      expect(p.messageSv).not.toMatch(RAW_CODE);
      expect(p.messageSv).not.toMatch(INTERNAL);
      expect(p.messageSv).not.toContain('Serverns råtext');
      expect(p.retryable, `${code}@${context}`).toBe(retryable);
      // What the user can do: a lasting fault says so; a transient one says a new attempt can help.
      expect(p.messageSv).toMatch(retryable ? /nytt försök kan lyckas|försök igen/i : /försvinner inte vid ett nytt försök|kontakta systemets administratör|Ett nytt försök ändrar inte detta/);
      // The codes stay under Teknisk information.
      expect(p.technical).toContainEqual({ label: 'Felkod', value: code });
    }
  });

  it('what each path does not do is said per context -- verify did not run, the map shows nothing, the export made no report', () => {
    const pinned = (context: LuErrorContext) =>
      presentLuError(httpError(503, 'x', { code: 'ASSESSMENT_PINNED_EVIDENCE_UNREADABLE', failureClass: 'READ_ERROR', reasonCode: 'EVIDENCE_READ_ERROR', retryable: true }), context).messageSv;
    expect(pinned('verify')).toContain('reproducerbarhetskontrollen genomfördes inte och inget utfall anges');
    expect(pinned('viewer-evidence')).toContain('kartan visar inte bedömningen');
    expect(pinned('verify')).toContain('Läsfelet säger inget om underlagets riktighet.');
    const record = (context: LuErrorContext) =>
      presentLuError(httpError(424, 'x', { code: 'ASSESSMENT_RECORD_INTEGRITY_ERROR', failureClass: 'RECORD_INTEGRITY_ERROR', retryable: false }), context).messageSv;
    expect(record('verify')).toContain('Reproducerbarhetskontrollen genomfördes inte.');
    expect(record('export')).toContain('Ingen rapport skapades.');
    expect(record('viewer-evidence')).toContain('Kartan visar inte bedömningen.');
    expect(record('current-assessment')).toContain('redovisas inte som en giltig bedömning');
    const pdf = presentLuError(httpError(503, 'x', { code: 'ASSESSMENT_PDF_CONTEXT_UNRESOLVED', failureClass: 'READ_ERROR', retryable: true }), 'export').messageSv;
    expect(pdf).toContain('Ingen rapport skapades.');
  });

  it('a class this UI does not know gets the code\'s own neutral text -- no cause claimed, retry only by the server\'s flag', () => {
    for (const code of ['ASSESSMENT_BINDING_UNRESOLVED', 'PROJECT_ACCESS_UNRESOLVED', 'VIEWER_CAPABILITY_UNRESOLVED', 'PROJECT_CONTEXT_UNRESOLVED', 'VIEWER_PRESENTATION_UNRESOLVED', 'ASSESSMENT_PDF_CONTEXT_UNRESOLVED', 'ASSESSMENT_PINNED_EVIDENCE_UNREADABLE']) {
      for (const failureClass of ['SOMETHING_NEW', 'constructor', '__proto__']) {
        const p = presentLuError(httpError(503, 'x', { code, failureClass, retryable: false }), 'current-assessment');
        expect(p.messageSv, `${code}/${failureClass}`).toMatch(/kunde inte fastställas/);
        expect(p.messageSv).not.toMatch(/tekniskt fel|bestående|underkändes|undefined/);
        expect(p.retryable).toBe(false);
        expect(presentLuError(httpError(503, 'x', { code, failureClass, retryable: true }), 'current-assessment').retryable).toBe(true);
      }
    }
  });
});

describe('W-UI1 B: "Försök igen" is the SERVER\'s retryable -- no client code list (owner decision 2)', () => {
  it('a server answer offers retry only when the server sends retryable:true; a flag-less answer offers none', () => {
    expect(presentLuError(httpError(503, 'x', { retryable: true }), 'current-assessment').retryable).toBe(true);
    expect(presentLuError(httpError(503, 'x', { retryable: false }), 'current-assessment').retryable).toBe(false);
    expect(presentLuError(httpError(500, 'x'), 'current-assessment').retryable).toBe(false);
    expect(presentLuError(httpError(429, 'x'), 'run').retryable).toBe(false);
    expect(presentLuError(httpError(503, 'x', { code: 'LOCALIZATION_DATA_UNAVAILABLE' }), 'run').retryable).toBe(false);
    expect(presentLuError(httpError(503, 'x', { code: 'LOCALIZATION_DATA_UNAVAILABLE', retryable: true }), 'run').retryable).toBe(true);
  });

  it('the shown text and the button agree: a refusal, an integrity fault or a text that calls the fault lasting is never retried, whatever a flag says', () => {
    for (const [code, failureClass, status] of [
      ['ASSESSMENT_CURRENT_UNRESOLVED', 'ASSESSMENT_CURRENT_AMBIGUOUS', 409],
      ['ASSESSMENT_CONTRACT_REFUSED', 'ASSESSMENT_CONTRACT_INVALID', 424],
      ['GOVERNED_EVIDENCE_INTEGRITY_FAILED', 'EVIDENCE_TAMPERED', 424],
      ['ASSESSMENT_RECORD_INTEGRITY_ERROR', 'RECORD_INTEGRITY_ERROR', 424],
      ['LOCALIZATION_GEOMETRY_CURRENTNESS_FAILED', 'VERIFIER_CONFIGURATION', 503],
      ['BOOTSTRAP_ADMIT_FLAG_OUTSIDE_TEST', 'x', 503],
    ] as const) {
      expect(presentLuError(httpError(status, 'x', { code, failureClass, retryable: true }), 'current-assessment').retryable, `${code}/${failureClass}`).toBe(false);
    }
  });

  it('no answer at all (network, a UI-side message) may be tried again -- the server never decided anything', () => {
    expect(presentLuError(new TypeError('Failed to fetch'), 'current-assessment').retryable).toBe(true);
  });

  it('an error without an HTTP status that still names a code keeps its text\'s verdict: an integrity fault, a refusal or a lasting fault is never retried (mutation B27)', () => {
    const noStatus = (extra: Record<string, unknown>) => Object.assign(new Error('raw'), extra);
    // INTEGRITY: the record's integrity cannot be attested -- no flag and no missing status makes that retryable.
    const integrity = presentLuError(noStatus({ code: 'ASSESSMENT_RECORD_INTEGRITY_ERROR', failureClass: 'RECORD_INTEGRITY_ERROR', retryable: true }), 'current-assessment');
    expect(integrity.kind).toBe('INTEGRITY');
    expect(integrity.retryable).toBe(false);
    // REFUSED: a presentation the server refused.
    const refused = presentLuError(noStatus({ code: 'VIEWER_PRESENTATION_UNRESOLVED', failureClass: 'REFUSED', retryable: true }), 'viewer-evidence');
    expect(refused.kind).toBe('REFUSED');
    expect(refused.retryable).toBe(false);
    // A text that calls the fault lasting.
    const lasting = presentLuError(noStatus({ code: 'ASSESSMENT_BINDING_UNRESOLVED', failureClass: 'STORAGE_INTEGRITY_FAULT', retryable: true }), 'current-assessment');
    expect(lasting.messageSv).toContain('Felet försvinner inte vid ett nytt försök');
    expect(lasting.retryable).toBe(false);
    // The same code with a transient class may be tried again (nothing was decided by a server).
    expect(presentLuError(noStatus({ code: 'ASSESSMENT_BINDING_UNRESOLVED', failureClass: 'READ_ERROR' }), 'current-assessment').retryable).toBe(true);
  });

  it('a run\'s FAILED_CLOSED record: the server\'s flag, or nothing claimed when it sends none', () => {
    expect(presentCurrentnessFailureClass('CURRENTNESS_RESOLUTION_ERROR', true)?.retryable).toBe(true);
    expect(presentCurrentnessFailureClass('CURRENTNESS_RESOLUTION_ERROR', false)?.retryable).toBe(false);
    expect(presentCurrentnessFailureClass('CURRENTNESS_RESOLUTION_ERROR', undefined)?.retryable).toBeNull();
    expect(presentCurrentnessFailureClass('VERIFIER_CONFIGURATION', true)?.retryable).toBe(false);
    expect(presentCurrentnessFailureClass('AMBIGUOUS_CURRENT_GEOMETRY', undefined)?.retryable).toBeNull();
  });

  it('the overall line is re-read only when the server marks the unreadable pinned evidence retryable', () => {
    const overall = (retryable: unknown, technical_error_class: unknown = 'EVIDENCE_READ_ERROR') =>
      presentLuOverallStatement({ statement_sv: 'x', coverage_state: 'PINNED_EVIDENCE_UNREADABLE', pinned_evidence: { retryable, technical_error_class, unreadable_artifact_ids: ['e'] } }).retryable;
    expect(overall(true)).toBe(true);
    expect(overall(false)).toBe(false);
    expect(overall(undefined)).toBe(false);
    expect(overall('true')).toBe(false);
  });
});

describe('W-UI1 B: bootstrap -- retry from the server\'s flag on bootstrap-status; own text for the W-CATCH2 codes', () => {
  it.each([
    ['BOOTSTRAP_STORAGE_INTEGRITY_FAULT', false, 'bestående lagrings- eller integritetsfel'],
    ['BOOTSTRAP_REFUSED', false, 'underkändes vid kontrollen'],
    ['BOOTSTRAP_EXECUTION_ERROR', true, 'tekniskt fel'],
    ['LOCAL_PROPERTY_NOT_FOUND', false, 'hittades inte i fastighetsunderlaget'],
    ['CURRENT_BINDING_READ_ERROR', true, 'kunde inte läsas på grund av ett tekniskt fel'],
    ['FRESH_VERIFICATION_FAILED', true, 'klarade inte kontrollen'],
  ] as const)('%s (server retryable %s): own reason, "Försök igen" exactly as the server says', (failureCode, retryable, text) => {
    const view = presentBootstrapFailure({ status: 'FAILED', failureCode, failureDetail: 'Projektkontexten kunde inte etableras: ...', retryable });
    expect(view.reasonSv).toContain(text);
    expect(view.reasonSv).not.toMatch(RAW_CODE);
    expect(view.retryable).toBe(retryable);
    // The same code with the opposite flag follows the flag, not a client list -- W-UI1-R2 (UI1-VERIFICATION finding 4):
    // except where the reason itself says lasting or refused: no button beside that text, whatever the flag says.
    const lastingText = /bestående|underkändes/.test(view.reasonSv);
    expect(presentBootstrapFailure({ status: 'FAILED', failureCode, failureDetail: null, retryable: !retryable }).retryable).toBe(!retryable && !lastingText);
  });

  it('a flag-less (older) status offers no retry; an unknown code claims no cause -- not even for a code that says NOT_FOUND', () => {
    expect(presentBootstrapFailure({ status: 'FAILED', failureCode: 'BOOTSTRAP_EXECUTION_ERROR', failureDetail: null }).retryable).toBe(false);
    for (const code of ['CURRENT_BINDING_NOT_FOUND', 'SOMETHING_NEW', null, 'constructor']) {
      expect(describeBootstrapFailure(code).reasonSv).toBe('Fastigheten kunde inte knytas till lokaliseringen.');
    }
    expect(presentBootstrapFailure(null).retryable).toBe(false);
    expect(presentBootstrapFailure({ status: 'FAILED', failureCode: 'BOOTSTRAP_REFUSED', retryable: 'true' }).retryable).toBe(false);
  });
});

describe('W-UI1 B: statuses, not-ranked sites, historical coverage, the "0 av M" invariant', () => {
  it('RECORD_INTEGRITY_ERROR has its own status label -- never "Okänd status", never a valid assessment', () => {
    expect(presentLuAssessmentStatus('RECORD_INTEGRITY_ERROR')).toBe('Ingen giltig bedömning – postens integritet kan inte intygas');
    expect(presentLuAssessmentStatus('SOMETHING_NEW')).toBe('Okänd status');
  });

  it('not_ranked_site_ids is the truthful field: a site there is never best and says why; unassessed_site_ids only as compatibility', () => {
    const summary = (extra: Record<string, unknown>) => ({ assessed_site_ids: [], not_ranked_site_ids: [], unassessed_site_ids: [], ...extra });
    const integrity = presentLuSiteRanking(summary({ not_ranked_site_ids: ['s1'], bestAlternativeId: 's1' }), 's1', 'RECORD_INTEGRITY_ERROR');
    expect(integrity.state).toBe('NOT_RANKED');
    expect(integrity.mayBeBest).toBe(false);
    expect(integrity.textSv).toBe('Platsen rangordnas inte och kan inte vara bästa alternativ: postens integritet kan inte intygas.');
    const withheld = presentLuSiteRanking(summary({ not_ranked_site_ids: ['s1'] }), 's1', 'ASSESSED');
    expect(withheld.state).toBe('NOT_RANKED');
    expect(withheld.textSv).toContain('kan inte jämföras med andra platser');
    const ranked = presentLuSiteRanking(summary({ assessed_site_ids: ['s1'], bestAlternativeId: 's1' }), 's1', 'ASSESSED');
    expect(ranked).toEqual({ state: 'RANKED', textSv: null, mayBeBest: true });
    // Contradictory answers fail safe: never ranked, never best.
    const both = presentLuSiteRanking(summary({ assessed_site_ids: ['s1'], not_ranked_site_ids: ['s1'], bestAlternativeId: 's1' }), 's1', 'ASSESSED');
    expect(both.state).toBe('NOT_RANKED');
    expect(both.mayBeBest).toBe(false);
    // Compatibility: an older server without not_ranked_site_ids -- only "no governed assessment" is read from unassessed.
    const older = presentLuSiteRanking({ assessed_site_ids: [], unassessed_site_ids: ['s1'] }, 's1', 'GOVERNANCE_DENIED');
    expect(older.state).toBe('UNASSESSED');
    expect(older.textSv).toBe('Platsen har ingen styrd bedömning och ingår inte i jämförelsen.');
    const olderAssessed = presentLuSiteRanking({ assessed_site_ids: [], unassessed_site_ids: ['s1'] }, 's1', 'ASSESSED');
    expect(olderAssessed.state).toBe('UNKNOWN');
    expect(olderAssessed.mayBeBest).toBe(false);
    expect(presentLuSiteRanking(null, 's1', 'ASSESSED')).toEqual({ state: 'UNKNOWN', textSv: null, mayBeBest: false });
  });

  it('a historical record without coverage metadata says the owner\'s sentence', () => {
    const view = presentLuOverallStatement({ statement_sv: 'Täckningsgrad kan inte fastställas för denna historiska bedömning.', coverage_state: 'HISTORICAL_COVERAGE_UNKNOWN' });
    expect(view.stateLabelSv).toBe('Täckningsgrad kan inte fastställas för denna historiska bedömning');
    expect(view.tone).not.toBe('complete');
  });

  it('"0 av M" never stands beside a stored finding: the line is shown as contradictory, never as the statement', () => {
    const zero = { statement_sv: 'Ingen samlad risknivå kan presenteras – 0 av 6 kontroller genomförda.', coverage_state: 'DETERMINED', coverage: { checks_total: 6, checks_completed: 0, checks_not_completed: 6, checks_completed_with_limited_coverage: 0 } };
    const contradicted = presentLuOverallStatement(zero, { storedRiskFindings: 1 });
    expect(contradicted.statementSv).not.toMatch(/0 av 6/);
    expect(contradicted.statementSv).toContain('motsägelsefullt');
    expect(contradicted.tone).toBe('technical');
    expect(contradicted.technical).toContainEqual({ label: 'Serverns text', value: zero.statement_sv });
    expect(presentLuOverallStatement(zero, { storedRiskFindings: 0 }).statementSv).toBe(zero.statement_sv);
    expect(presentLuOverallStatement(zero).statementSv).toBe(zero.statement_sv);
  });
});

describe('W-UI1 B: the 424 record_integrity body -- unverified, non-authoritative diagnostic, collapsed, never an assessment', () => {
  const diag = {
    authoritative: false,
    verified: false,
    note_sv: 'Diagnostisk uppgift ur den lagrade posten: inte verifierad, inte auktoritativ och ingen bedömning.',
    assessment_artifact_id: 'assess-1',
    basis_codes: ['UNKNOWN_SEVERITY', 'MALFORMED_RECORD_ENTRY'],
    stored_findings_unverified: {
      total: 3,
      highest_level: 'HIGH',
      counts: { high: 1, medium: 0, low: 0, not_checked: 0, unknown_level: 1, malformed: 1 },
      truncated: true,
      entries: [
        { check: 'water', rule: 'LU-WATER-001', stored_level: 'HIGH', well_formed: true },
        { check: null, rule: null, stored_level: 'UNKNOWN', well_formed: false },
      ],
    },
  };

  it('parses only an envelope that says itself it is unverified and not authoritative', () => {
    const view = parseLuRecordIntegrityDiagnostic(diag)!;
    expect(view.headSv).toBe('Lagrade fynd – overifierad diagnostik (auktoritativ: nej)');
    expect(view.entries).toEqual(['Brunnar – lagrad nivå: hög (overifierad)', 'Regel utanför de styrda kontrollerna – lagrad nivå: okänd (overifierad, felformad)']);
    expect(view.truncatedSv).toBe('Listan visar de första 2 av 3 lagrade fynd.');
    expect([view.headSv, view.noteSv, ...view.rows.map((r) => r.value), ...view.entries].join(' ')).not.toMatch(RAW_CODE);
    expect(view.technical).toContainEqual({ label: 'Grund', value: 'UNKNOWN_SEVERITY, MALFORMED_RECORD_ENTRY' });
    for (const bad of [{ ...diag, authoritative: true }, { ...diag, verified: true }, { ...diag, authoritative: undefined }, null, 'x', []]) {
      expect(parseLuRecordIntegrityDiagnostic(bad)).toBeNull();
    }
    expect(parseLuRecordIntegrityDiagnostic(Object.assign(Object.create({ authoritative: false, verified: false }), { stored_findings_unverified: diag.stored_findings_unverified }))).toBeNull();
  });

  it('the error notice: "Postens integritet kan inte intygas", the diagnostic collapsed and marked, no retry, no green, no risk chip', () => {
    const err = httpError(424, 'Bedömningen kan inte visas ... (RECORD_INTEGRITY_ERROR: UNKNOWN_SEVERITY) ...', {
      code: 'ASSESSMENT_RECORD_INTEGRITY_ERROR',
      failureClass: 'RECORD_INTEGRITY_ERROR',
      reasonCode: 'UNKNOWN_SEVERITY',
      retryable: false,
      record_integrity: diag,
    });
    const p = presentLuError(err, 'current-assessment');
    expect(p.diagnostic).not.toBeUndefined();
    render(<LuErrorNotice testId="x" error={p} onRetry={() => undefined} />);
    expect(screen.getByTestId('x-message')).toHaveTextContent('Postens integritet kan inte intygas');
    const diagnostic = screen.getByTestId('x-diagnostic');
    expect(diagnostic.tagName).toBe('DETAILS');
    expect(diagnostic).not.toHaveAttribute('open');
    expect(diagnostic).toHaveTextContent('overifierad diagnostik (auktoritativ: nej)');
    expect(diagnostic).toHaveTextContent('Brunnar – lagrad nivå: hög (overifierad)');
    expect(screen.queryByTestId('x-retry')).not.toBeInTheDocument();
    expect(screen.getByTestId('x')).not.toHaveTextContent(/Kontrollerat – träff|Låg risk|Hög risk|Bedömd\b/);
    // Without the code the body is never read as a diagnostic.
    expect(presentLuError(httpError(424, 'x', { record_integrity: diag }), 'current-assessment').diagnostic).toBeUndefined();
  });
});

describe('W-UI1 C/D: no internal terms in visible server text; the property root\'s transient read fault', () => {
  it('presentServerTextSv takes CAS, parenthesised codes, hashes and paths out of the visible line', () => {
    expect(presentServerTextSv('Den pinnade evidensen kan inte verifieras: 5 av 5 bundna evidensobjekt kunde inte läsas ur CAS (EVIDENCE_NOT_FOUND). Felet är bestående.')).toBe(
      'Den pinnade evidensen kan inte verifieras: 5 av 5 bundna evidensobjekt kunde inte läsas ur arkivet. Felet är bestående.',
    );
    expect(presentServerTextSv('Rotens datasetbindning saknas (lägre säkerhet). Fastighetsrotens proveniens kunde inte läsas (ROOT_READ_ERROR).')).toBe(
      'Rotens datasetbindning saknas (lägre säkerhet). Fastighetsrotens proveniens kunde inte läsas.',
    );
    expect(presentServerTextSv('Integritetsfel (RECORD_INTEGRITY_ERROR: UNKNOWN_SEVERITY, LAYER_NOT_RECORDED) i posten.')).toBe('Integritetsfel i posten.');
    // Plain parentheses and short names stay.
    for (const keep of ['Potentiellt förorenade områden (EBH)', 'Ingen registrerad träff (registerkontroll, inte markundersökning).', 'ADMIT v1']) {
      expect(presentServerTextSv(keep)).toBe(keep);
    }
    expect(presentServerTextSv('hash 0123456789abcdef0123456789abcdef i C:\\data\\x och /var/lib/mimers/x')).not.toMatch(INTERNAL);
  });

  it('ROOT_READ_ERROR: "proveniens kunde inte läsas just nu; försök igen" -- nothing claimed about the root, a re-read offered', () => {
    const rows = presentLuControlChecks({
      property: {
        lookedUp: true,
        geometry: { artifact_id: 'g', provenance: 'user_defined', wgs84LngLat: [17, 59] },
        propertyRoot: {
          status: 'TECHNICAL_ERROR',
          technical_error_class: 'ROOT_READ_ERROR',
          assurance: 'UNKNOWN',
          message_sv: 'Rotens datasetbindning saknas (lägre säkerhet). Fastighetsrotens proveniens kunde inte läsas (ROOT_READ_ERROR).',
        },
      },
      assessment: { status: 'present' },
      server: { layerChecks: [], evidenceDetails: [], limitedCoverageLayers: [] },
    });
    const property = rows[0]!;
    expect(property.stateLabel).toBe('Hittad · fastighetsunderlagets proveniens kunde inte läsas just nu');
    // W-UI1-R3 (owner decision 2026-10-03): a re-read -- the help text says "läs in på nytt".
    expect(property.summary).toContain('Fastighetsrotens proveniens kunde inte läsas just nu (tekniskt fel); läs in på nytt.');
    // Owner decision R3-1 (2026-10-03): it says that NO conclusion about authenticity can be drawn -- never a claim of one.
    expect(property.summary).toContain('Ingen slutsats kan dras om fastighetsrotens äkthet eller om dess proveniens gäller nu.');
    expect(property.summary).not.toMatch(/äkta|verifierad|aktuell|ROOT_READ_ERROR/i);
    expect(property.rootReadRetryable).toBe(true);
    const visible = property.details.map((d) => d.value).join(' ');
    expect(visible).not.toMatch(INTERNAL);
    expect(property.technical).toContainEqual({ label: 'Rotens felklass', value: 'ROOT_READ_ERROR' });
    // A proven absence of a root link is no transient fault and offers no re-read.
    const absent = presentLuControlChecks({
      property: {
        lookedUp: true,
        geometry: { artifact_id: 'g', provenance: 'user_defined', wgs84LngLat: [17, 59] },
        propertyRoot: { status: 'TECHNICAL_ERROR', technical_error_class: 'ROOT_ARTIFACT_NOT_FOUND', assurance: 'UNKNOWN', message_sv: 'x' },
      },
      assessment: { status: 'present' },
      server: { layerChecks: [], evidenceDetails: [], limitedCoverageLayers: [] },
    })[0]!;
    expect(absent.stateLabel).toBe('Hittad · fastighetsunderlagets ursprung finns inte i arkivet');
    expect(absent.rootReadRetryable).toBe(false);
  });

  it('a CSRF refusal (403 without a code) is not "Du saknar behörighet till det här projektet"', () => {
    const p = presentLuError(httpError(403, 'Möjlig Cross-Site Request Forgery attack blockerad. Ogiltig eller saknad CSRF-token.'), 'verify');
    expect(p.messageSv).toContain('Sidans säkerhetstoken saknas eller har gått ut');
    expect(p.messageSv).not.toContain('Du saknar behörighet');
  });

  it('a 404 that is not the exact "no current assessment" answer claims no absence', () => {
    for (const context of ['current-assessment', 'verify', 'export'] as const) {
      const p = presentLuError(httpError(404, 'Resource not found'), context);
      expect(p.messageSv, context).not.toMatch(/Det finns ingen sparad bedömning|finns inte\./);
      expect(p.messageSv).toContain('Servern hittade inte det som efterfrågades.');
    }
  });
});
