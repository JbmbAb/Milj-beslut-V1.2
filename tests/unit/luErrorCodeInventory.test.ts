/**
 * W-M2e item 2 -- EXHAUSTIVE INVENTORY of the server's error codes and states against the LU UI's texts.
 *
 * Why: "every error code has its own Swedish text" drifted twice (M2c, M2d): new server codes landed
 * and fell through to a status text that said the wrong thing. This test makes a NEW code fail CI.
 *
 * How (derived from the code, not by hand -- the scanner is luErrorCodeInventory.scan.mjs):
 *  1. SCAN every non-test .ts/.tsx under server/, src/application/ and packages/<pkg>/src (comments
 *     stripped) for code-shaped string literals:
 *       - a prefix (ASSESSMENT_, REJECT_, CURRENT*, PINNED_, LU_, VERIFIER_, PROPERTY_, EVIDENCE_,
 *         CHECKS_, LOCALIZATION_, GOVERNED_);
 *       - an error-shaped suffix (_ERROR, _FAULT, _FAILED, _REFUSED, _MISMATCH, _UNAVAILABLE,
 *         _NOT_FOUND, _INVALID, _UNVERIFIED, _AMBIGUOUS, _MISSING, _TAMPERED, ...);
 *       - the value of, or a comparison with, a wire field (code, failureClass, reasonCode,
 *         failure_class, reason_code, technical_error_class, coverage_state, errorCode, failureCode,
 *         reason) or a reason_codes[] entry;
 *       - the code at the start of a message or basis entry ('REJECT_X: ...', `UNKNOWN_SEVERITY:${id}`);
 *       - a member of a type union named *FailureClass, *ErrorClass, *FaultReason, *Reason,
 *         *ReasonCode, *CoverageState, *Violation, *ErrorCode, *FailureCode;
 *       - in the LU core (server/modules/localization, the localization/property routes, the LU use
 *         cases): every code-shaped literal and table key.
 *  2. REACH: the static import closure (value imports; `import type` carries no runtime value) of the
 *     modules whose answers the LU UI reads: the LU routes and the LU workers whose recorded status
 *     those routes return.
 *  3. EVERY scanned token must either have its OWN Swedish text in the LU UI -- read from the very
 *     tables the presenters use, and probed through them -- or a REVIEWED fallback entry with a group
 *     and a note (luErrorCodeInventory.reviewed.ts). The groups whose justification can be checked
 *     mechanically are checked (outside the LU reach, a parent with its own text).
 *
 * Pure: reads source files as text and calls pure presentation functions. No network, no database,
 * no process environment.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  LU_ASSESSMENT_STATUS_TEXTS,
  LU_BOOTSTRAP_FAILURE_TEXTS,
  LU_ERROR_CODE_TEXTS,
  LU_MESSAGE_PREFIX_TOKENS_WITH_TEXT,
  LU_RUN_REASON_TEXTS,
  LU_SPATIAL_FORM_VIOLATION_TEXTS,
  describeBootstrapFailure,
  presentLuAssessmentStatus,
  presentLuError,
  presentLuRunReason,
  type LuErrorContext,
} from '../../components/app/lu/luErrorPresentation';
import { LU_OVERALL_COVERAGE_STATES, presentLuOverallStatement } from '../../components/app/lu/luOverallStatement';
import {
  LU_BINDING_ASSURANCE_TEXTS,
  LU_CHECK_COVERAGE_STATES,
  LU_EVIDENCE_INTEGRITY_TEXTS,
  LU_KNOWN_GAP_KIND_TEXTS,
  LU_PROPERTY_ROOT_TEXTS,
  presentLuControlChecks,
} from '../../components/app/lu/luControlChecks';
import { LU_VERIFY_NOTICE_TEXTS, LU_VERIFY_NOTICE_UNKNOWN_SV, presentLuVerifyNotice } from '../../components/app/lu/luVerifyNotice';
import { LU_FALLBACK_GROUPS, LU_REVIEWED_FALLBACK, type LuFallbackGroup } from './luErrorCodeInventory.reviewed';
import { LU_ENTRY_MODULES, luReachClosure, scanServerTokens } from './luErrorCodeInventory.scan.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// ------------------------------------------------------------------------------------------------
// The UI's own texts -- read from the presenters' own tables
// ------------------------------------------------------------------------------------------------

const OWN_TEXT: ReadonlyMap<string, string> = (() => {
  const own = new Map<string, string>();
  const put = (token: string, where: string) => own.set(token, own.has(token) ? `${own.get(token)}, ${where}` : where);
  for (const [code, classes] of Object.entries(LU_ERROR_CODE_TEXTS)) {
    put(code, 'error code');
    for (const cls of classes) put(cls, `class of ${code}`);
  }
  for (const t of LU_MESSAGE_PREFIX_TOKENS_WITH_TEXT) put(t, 'message prefix');
  for (const t of LU_RUN_REASON_TEXTS) put(t, 'run reason');
  for (const t of LU_SPATIAL_FORM_VIOLATION_TEXTS) put(t, 'spatial-form violation');
  for (const t of LU_ASSESSMENT_STATUS_TEXTS) put(t, 'run/assessment status');
  for (const t of LU_BOOTSTRAP_FAILURE_TEXTS) put(t, 'bootstrap failure');
  for (const t of LU_OVERALL_COVERAGE_STATES) put(t, 'record coverage state');
  for (const t of LU_CHECK_COVERAGE_STATES) put(t, 'check coverage state');
  for (const t of LU_VERIFY_NOTICE_TEXTS) put(t, 'verify notice');
  for (const t of LU_EVIDENCE_INTEGRITY_TEXTS) put(t, 'evidence integrity value');
  for (const t of LU_KNOWN_GAP_KIND_TEXTS) put(t, 'known coverage gap kind');
  for (const t of LU_BINDING_ASSURANCE_TEXTS) put(t, 'evidence binding assurance');
  for (const t of LU_PROPERTY_ROOT_TEXTS) put(t, 'property root status/assurance');
  return own;
})();

/** One water check row from a minimal read-back: `check` overrides the server's check, `detail` its evidence detail. */
function waterRow(check: Record<string, unknown>, detail: Record<string, unknown> | null = null) {
  const rows = presentLuControlChecks({
    property: { lookedUp: false },
    assessment: { status: 'present' },
    server: {
      layerChecks: [{ layer: 'water', status: 'CHECKED_NO_HIT', coverage_state: 'CHECKED_NO_HIT', message_sv: 'serverns rad', evidence_artifact_id: 'e-1', ...check }],
      evidenceDetails: detail ? [{ evidence_artifact_id: 'e-1', artifact_type: 'SPATIAL_EVIDENCE', contract: { authority: 'x' }, ...detail }] : [],
      limitedCoverageLayers: [],
    },
  });
  return rows.find((row) => row.key === 'water')!;
}

const scan = scanServerTokens(ROOT);
const closure = luReachClosure(ROOT);
const inReach = (token: string) => [...scan.tokens.get(token)!.files].some((f) => closure.has(f));
const RAW_CODE = /[A-Z]{3,}_[A-Z0-9_]{3,}/;
const UNKNOWN = '__W_M2E_NOT_A_CODE__';
const httpError = (status: number, message: string, extra: Record<string, unknown> = {}) =>
  Object.assign(new Error(message), { status, ...extra });

describe('W-M2e item 2: exhaustive inventory of server error codes against the LU UI texts', () => {
  it('the scan and the reach are real: they find the codes this lane knows of, and the LU entry modules exist', () => {
    for (const entry of LU_ENTRY_MODULES) expect(fs.existsSync(path.join(ROOT, entry)), entry).toBe(true);
    expect(scan.files.length).toBeGreaterThan(1000);
    expect(scan.tokens.size).toBeGreaterThan(700);
    for (const known of [
      'ASSESSMENT_CURRENT_UNRESOLVED',
      'ASSESSMENT_CONTRACT_REFUSED',
      'CURRENT_BINDING_REFUSED',
      'REJECT_SPATIAL_EVIDENCE_FORM',
      'LAYER_NOT_ANSWERED',
      'RECORD_INTEGRITY_ERROR',
      'PINNED_EVIDENCE_UNREADABLE',
      'PROPERTY_LOOKUP_AMBIGUOUS',
      'BOOTSTRAP_EXECUTION_ERROR',
      'VERIFIER_CONFIGURATION',
      'LU_REEXECUTION_STORAGE_FAULT',
    ]) {
      expect(scan.tokens.has(known), `scan misses ${known}`).toBe(true);
      expect(inReach(known), `${known} is not in the LU reach`).toBe(true);
    }
    // Each scan pattern is pinned by a code only it (also) finds, so losing a pattern fails here
    // (W-M2e mutation I9: the LU-core net alone hid a lost suffix pattern).
    for (const [token, how] of [
      ['REJECT_SPATIAL_EVIDENCE_FORM', 'prefix'],
      ['ARTIFACT_VERIFICATION_FAILED', 'suffix'],
      ['FINDING_WITH_UNKNOWN_SEVERITY', 'compare'],
      ['UNKNOWN_SEVERITY', 'message-prefix'],
      ['GOVERNED_EVIDENCE_INTEGRITY_FAILED', 'field:code'],
      ['EXECUTION_KERNEL_ERROR', 'field:reason_codes'],
      ['AMBIGUOUS_CURRENT_GEOMETRY', 'type:LocalizationGeometryCurrentnessFailureClass'],
      ['HASH_BOUND_LEDGER_METADATA', 'lu-core'],
      ['NOT_CHECKED_FINDING', 'lu-core-key'],
    ] as const) {
      expect([...(scan.tokens.get(token)?.how ?? [])], `${token} must be found by the ${how} pattern`).toContain(how);
    }
    for (const reached of [
      'server/modules/localization/localizationOrchestrator.ts',
      'server/modules/localization/governedCoverageStatement.ts',
      'server/modules/localization/luProjectContextBootstrap.ts',
      'src/application/generate-localization-report.usecase.ts',
    ]) {
      expect(closure.has(reached), `${reached} not reached`).toBe(true);
    }
  });

  it('every own text is really used: each token is probed through the presenter that owns it', () => {
    const contexts: LuErrorContext[] = ['current-assessment', 'run', 'geometry-load', 'export', 'verify', 'property-lookup', 'viewer-evidence'];
    for (const [code, classes] of Object.entries(LU_ERROR_CODE_TEXTS)) {
      for (const context of contexts) {
        for (const status of [400, 404, 409, 424, 503]) {
          const generic = presentLuError(httpError(status, 'x'), context).messageSv;
          const own = presentLuError(httpError(status, 'x', { code }), context);
          expect(own.messageSv, `${code} @${status}/${context}`).not.toBe(generic);
          expect(own.messageSv, `${code} shows a raw code`).not.toMatch(RAW_CODE);
          for (const failureClass of classes) {
            const cls = presentLuError(httpError(status, 'x', { code, failureClass }), context);
            expect(cls.messageSv, `${code}/${failureClass}`).not.toBe(generic);
            expect(cls.messageSv, `${code}/${failureClass} shows a raw code`).not.toMatch(RAW_CODE);
          }
        }
      }
    }
    for (const token of LU_MESSAGE_PREFIX_TOKENS_WITH_TEXT) {
      expect(presentLuError(httpError(424, `${token}: x`), 'viewer-evidence').messageSv).not.toBe(
        presentLuError(httpError(424, 'x'), 'viewer-evidence').messageSv,
      );
    }
    for (const token of LU_RUN_REASON_TEXTS) expect(presentLuRunReason([token]), token).not.toBeNull();
    const bareForm = presentLuRunReason(['REJECT_SPATIAL_EVIDENCE_FORM'])!.messageSv;
    for (const violation of LU_SPATIAL_FORM_VIOLATION_TEXTS) {
      expect(presentLuRunReason(['REJECT_SPATIAL_EVIDENCE_FORM', violation])!.messageSv, violation).not.toBe(bareForm);
    }
    for (const status of LU_ASSESSMENT_STATUS_TEXTS) expect(presentLuAssessmentStatus(status)).not.toBe(presentLuAssessmentStatus(UNKNOWN));
    for (const code of LU_BOOTSTRAP_FAILURE_TEXTS) {
      expect(describeBootstrapFailure(code).reasonSv, code).not.toBe(describeBootstrapFailure(UNKNOWN).reasonSv);
      expect(describeBootstrapFailure(code).reasonSv, code).not.toMatch(RAW_CODE);
    }
    for (const state of LU_OVERALL_COVERAGE_STATES) {
      expect(presentLuOverallStatement({ statement_sv: 'x', coverage_state: state }).stateLabelSv, state).not.toBe('Okänt täckningstillstånd');
    }
    for (const state of LU_CHECK_COVERAGE_STATES) {
      expect(waterRow({ status: state, coverage_state: state }).summary, state).toBe('serverns rad');
    }
    const integrityOf = (integrity: string) => waterRow({}, { integrity }).details.find((row) => row.label === 'Integritet')!.value;
    for (const value of LU_EVIDENCE_INTEGRITY_TEXTS) expect(integrityOf(value), value).not.toBe(integrityOf(UNKNOWN));
    const gapText = (kind: string) => waterRow({ known_coverage_gaps: [{ gap_id: 'g', kind, text_sv: 't' }] }).knownGaps[0]!.text;
    for (const kind of LU_KNOWN_GAP_KIND_TEXTS) expect(gapText(kind), kind).not.toBe(gapText(UNKNOWN));
    const propertyChip = (propertyRoot: Record<string, unknown>) =>
      presentLuControlChecks({
        property: { lookedUp: true, geometry: { artifact_id: 'g', provenance: 'user_defined', wgs84LngLat: [17, 59] }, propertyRoot },
        assessment: { status: 'present' },
        server: { layerChecks: [], evidenceDetails: [], limitedCoverageLayers: [] },
      })[0]!.stateLabel;
    for (const token of LU_PROPERTY_ROOT_TEXTS) {
      const root = token === 'UNBOUND_METADATA' ? { status: 'RESOLVED', assurance: token } : { status: token, assurance: 'UNBOUND_METADATA' };
      expect(propertyChip(root), token).not.toBe(propertyChip({ status: UNKNOWN }));
    }
    for (const assurance of LU_BINDING_ASSURANCE_TEXTS) {
      expect(waterRow({}, { binding_assurance: assurance }).datasetVersionUnknown, assurance).toBe(true);
      expect(waterRow({}, { binding_assurance: UNKNOWN }).datasetVersionUnknown).toBe(false);
    }
    for (const code of LU_VERIFY_NOTICE_TEXTS) {
      expect(presentLuVerifyNotice({ code, finding_ids: [] }), code).not.toBe(LU_VERIFY_NOTICE_UNKNOWN_SV);
    }
  });

  it('EVERY scanned code has its own Swedish text or a reviewed fallback entry -- a new code without either fails here', () => {
    const missing = [...scan.tokens.keys()]
      .filter((token) => !OWN_TEXT.has(token) && !Object.prototype.hasOwnProperty.call(LU_REVIEWED_FALLBACK, token))
      .sort()
      .map((token) => {
        const s = scan.tokens.get(token)!;
        return `${token} [${inReach(token) ? 'IN LU REACH' : 'outside LU reach'}; ${[...s.how].join(',')}] ${[...s.files].join(' ')}`;
      });
    expect(missing, 'give each code its own text in the UI, or a reviewed entry in luErrorCodeInventory.reviewed.ts').toEqual([]);
  });

  it('the reviewed list has no stale entry and no entry for a code that has its own text', () => {
    const stale = Object.keys(LU_REVIEWED_FALLBACK).filter((token) => !scan.tokens.has(token)).sort();
    expect(stale, 'remove entries for codes the server no longer has').toEqual([]);
    const both = Object.keys(LU_REVIEWED_FALLBACK).filter((token) => OWN_TEXT.has(token)).sort();
    expect(both, 'a code with its own text needs no fallback entry').toEqual([]);
  });

  it('every reviewed entry is justified: a known group, a note, and the mechanically checkable groups hold', () => {
    const problems: string[] = [];
    for (const [token, entry] of Object.entries(LU_REVIEWED_FALLBACK)) {
      if (!Object.prototype.hasOwnProperty.call(LU_FALLBACK_GROUPS, entry.group)) problems.push(`${token}: unknown group ${entry.group}`);
      if (!entry.note || entry.note.trim().length < 8) problems.push(`${token}: no note`);
      if (!scan.tokens.has(token)) continue;
      const reached = inReach(token);
      if (entry.group === 'OUTSIDE_LU_REACH' && reached) {
        problems.push(`${token}: marked OUTSIDE_LU_REACH but is in ${[...scan.tokens.get(token)!.files].filter((f) => closure.has(f)).join(' ')}`);
      }
      if (entry.group !== 'OUTSIDE_LU_REACH' && !reached) problems.push(`${token}: outside the LU reach -- use OUTSIDE_LU_REACH`);
      if (entry.group === 'COVERED_BY_PARENT') {
        const parent = entry.parent ?? '';
        const ok = parent.startsWith('message:') ? parent.slice('message:'.length).length > 0 : OWN_TEXT.has(parent);
        if (!ok) problems.push(`${token}: parent ${parent || '(none)'} has no text of its own`);
      }
    }
    expect(problems).toEqual([]);
    // Every group is documented.
    for (const [group, justification] of Object.entries(LU_FALLBACK_GROUPS) as [LuFallbackGroup, string][]) {
      expect(justification.length, group).toBeGreaterThan(80);
    }
  });
});
