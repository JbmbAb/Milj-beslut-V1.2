/**
 * W-M2e item 2 -- EXHAUSTIVE INVENTORY of the server's error codes and states against the LU UI's texts.
 * W-UI1 (owner decision 3, 2026-10-03): this test is the PERMANENT drift guard -- every code the code can
 * emit has a reviewed UI text, or a reviewed reserve/ops entry with its justification.
 *
 * Why: "every error code has its own Swedish text" drifted twice (M2c, M2d): new server codes landed
 * and fell through to a status text that said the wrong thing. This test makes a NEW code fail CI.
 *
 * How (derived from the code, not by hand -- the scanner is luErrorCodeInventory.scan.mjs):
 *  1. SCAN every non-test .ts/.tsx under server/, src/application/ and packages/<pkg>/src, and every file of
 *     the LU reach wherever it lives (comments stripped), for code-shaped string literals:
 *       - a prefix (ASSESSMENT_, REJECT_, CURRENT*, PINNED_, LU_, VERIFIER_, PROPERTY_, EVIDENCE_,
 *         CHECKS_, LOCALIZATION_, GOVERNED_);
 *       - an error-shaped suffix (_ERROR, _FAULT, _FAILED, _REFUSED, _MISMATCH, _UNAVAILABLE,
 *         _NOT_FOUND, _INVALID, _UNVERIFIED, _AMBIGUOUS, _MISSING, _TAMPERED, ...);
 *       - the value of, or a comparison with, a wire field (code, failureClass, reasonCode,
 *         failure_class, reason_code, technical_error_class, coverage_state, errorCode, failureCode,
 *         reason, assessment_status) or a reason_codes[] entry -- also through a constant (`code: X`);
 *       - the code at the start of a message or basis entry ('REJECT_X: ...', `UNKNOWN_SEVERITY:${id}`);
 *       - a member of a type union named *FailureClass, *ErrorClass, *FaultReason, *Reason,
 *         *ReasonCode, *CoverageState, *Violation, *ErrorCode, *FailureCode, and of LuAssessmentStatus;
 *       - in the LU core (server/modules/localization, the localization/property routes, the LU use
 *         cases): every code-shaped literal, table key and single upper-case word used as a value;
 *       - W-UI1: in EVERY file of the LU reach: every code-shaped literal (A_B[_C...]);
 *       - W-UI1: code-shaped template literals in the reach -- each must be listed with its expansions.
 *  2. REACH: the static import closure (value imports; `import type` carries no runtime value) of the
 *     modules whose answers the LU UI reads (the LU routes and LU workers) and of the middleware mounted
 *     before the LU router (csrf, error handler, request logging, tracing), plus createApp.ts's own text.
 *  3. EVERY scanned token must either have its OWN Swedish text in the LU UI -- read from the very
 *     tables the presenters use, and probed through them -- or a REVIEWED fallback entry with a group
 *     and a note (luErrorCodeInventory.reviewed.ts). The groups whose justification can be checked
 *     mechanically are checked (outside the LU reach, a parent with its own text). A status-union member
 *     needs a STATUS label specifically.
 *  4. W-UI1: the reviewed list cannot grow (or change) silently: its size per group and a digest of its
 *     token/group/parent lines are pinned below. A change fails until the pin is updated in the same
 *     commit -- the reviewer sees both files change. W-UI1-R2 (UI1-VERIFICATION finding 3c): the digest
 *     covers every NOTE too (a rewritten justification is a change), and the reviewed middleware lists.
 *  5. W-UI1-R2 (UI1-VERIFICATION finding 3a): the middleware before the LU router is not only a hand-kept
 *     list -- every app.use(...) createApp.ts makes before app.use(localizationRouter), and every router-level
 *     .use(...) in the routers mounted there, is derived from the source and must be reviewed
 *     (LU_REVIEWED_MIDDLEWARE, LU_REVIEWED_ROUTER_LEVEL_USES).
 *
 * KNOWN LIMITS (static forms the scan does not see; UI1-VERIFICATION finding 3b and W-UI1's own list):
 *  - a code that exists only in data (a database row, a stored artifact, a JSON file read at run time);
 *  - a code built at run time beyond templates and simple concatenations: `${PREFIX}${x}` whose code-shaped
 *    part lives only in a constant, `a + '_' + b`, `.toUpperCase()`, `[...].join('_')` outside the LU core;
 *  - an enum member without an initializer that is looked up backwards (`Enum[value]`);
 *  - an object key on the same line as other keys, read through `Object.keys(...)`;
 *  - a single upper-case word in a field that carries no code, in the reach but outside the LU core;
 *  - a code with mixed case (`Reject_Foo`);
 *  - a dynamic import with a variable path;
 *  - middleware a router mounts on a PATH before the LU router (router.use('/api/x', ...)) is not derived,
 *    only the path-less router-level .use(...) is;
 *  - the notes justify per code family, not per call site.
 *
 * Pure: reads source files as text and calls pure presentation functions. No network, no database,
 * no process environment.
 */
import { createHash } from 'node:crypto';
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
import { LU_RISK_LEVEL_TEXTS, presentLuFinding } from '../../components/app/lu/luFindingPresentation';
import { LU_RECORD_INTEGRITY_LEVEL_TEXTS, parseLuRecordIntegrityDiagnostic, recordIntegrityLevelSv } from '../../components/app/lu/luRecordIntegrity';
import { LU_VERIFY_NOTICE_TEXTS, LU_VERIFY_NOTICE_UNKNOWN_SV, presentLuVerifyNotice } from '../../components/app/lu/luVerifyNotice';
import {
  LU_VERIFY_BASIS_TEXTS,
  LU_VERIFY_BINDING_TEXTS,
  LU_VERIFY_MISMATCH_TEXTS,
  LU_VERIFY_OUTCOME_TEXTS,
  LU_VERIFY_PRESENTATION_TEXTS,
  presentLuVerifyResult,
} from '../../components/app/lu/luVerifyPresentation';
import {
  LU_FALLBACK_GROUPS,
  LU_REVIEWED_FALLBACK,
  LU_REVIEWED_MIDDLEWARE,
  LU_REVIEWED_ROUTER_LEVEL_USES,
  LU_REVIEWED_TEMPLATES,
  type LuFallbackGroup,
} from './luErrorCodeInventory.reviewed';
import {
  LU_ENTRY_MODULES,
  LU_MIDDLEWARE_MODULES,
  LU_SHELL_MODULES,
  appUsesBeforeLuRouter,
  codeTemplatesIn,
  luReachClosure,
  routerLevelUsesBeforeLuRouter,
  scanServerTokens,
} from './luErrorCodeInventory.scan.mjs';

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
  // W-UI1 (A): the verify answer's presentation, binding, legacy basis, outcome and mismatch codes.
  for (const t of LU_VERIFY_PRESENTATION_TEXTS) put(t, 'verify presentation');
  for (const t of LU_VERIFY_BINDING_TEXTS) put(t, 'verify binding');
  for (const t of LU_VERIFY_BASIS_TEXTS) put(t, 'verify legacy basis');
  for (const t of LU_VERIFY_OUTCOME_TEXTS) put(t, 'verify outcome');
  for (const t of LU_VERIFY_MISMATCH_TEXTS) put(t, 'verify mismatch');
  // W-UI1: a finding's stored level (LuFindingPresentation's attention label).
  for (const t of LU_RISK_LEVEL_TEXTS) put(t, 'finding risk level');
  // W-UI1 (B): a stored level in the unverified record-integrity diagnostic.
  for (const t of LU_RECORD_INTEGRITY_LEVEL_TEXTS) put(t, 'record-integrity stored level');
  return own;
})();

/** One water check row from a minimal read-back: `check` overrides the server's check, `detail` its evidence detail. */
/** W-UI1-R2 (M2e verification finding 4): a "no hit" rests on its own sound evidence detail. */
const SOUND_DETAIL = { integrity: 'CONTENT_HASH_VERIFIED', result: { exists: false, match_count_observed: 0 } };

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
const RAW_CODE = /[A-Z]{3,}_[A-Z0-9_]{3,}/;
const UNKNOWN = '__W_M2E_NOT_A_CODE__';
const httpError = (status: number, message: string, extra: Record<string, unknown> = {}) =>
  Object.assign(new Error(message), { status, ...extra });

/** W-UI1 (C5): the expansions of every reviewed template are tokens too. */
const TEMPLATE_TOKENS: ReadonlyMap<string, readonly string[]> = new Map(
  LU_REVIEWED_TEMPLATES.flatMap((t) => t.expansions.map((token) => [token, [`${t.file}: \`${t.template}\``]] as const)),
);
const allTokens = (): string[] => [...new Set([...scan.tokens.keys(), ...TEMPLATE_TOKENS.keys()])];
const filesOf = (token: string): string[] => [
  ...(scan.tokens.get(token)?.files ?? []),
  ...LU_REVIEWED_TEMPLATES.filter((t) => t.expansions.includes(token)).map((t) => t.file),
];
const inReach = (token: string) => filesOf(token).some((f) => closure.has(f));

/** The members of a status union or values of `assessment_status` need a STATUS label (L6.1). */
const isStatusToken = (token: string) =>
  [...(scan.tokens.get(token)?.how ?? [])].some((how) => how === 'field:assessment_status' || how.startsWith('type:LuAssessmentStatus'));

/**
 * W-UI1: the pin of the reviewed list -- size per group and a digest of its sorted `token<TAB>group<TAB>parent`
 * lines. Update ONLY together with luErrorCodeInventory.reviewed.ts, after reviewing the change.
 */
const REVIEWED_LIST_PIN = {
  total: 1094,
  groups: {
    COVERED_BY_PARENT: 23,
    GENERIC_TEXT_EXACT: 25,
    NOT_A_WIRE_CODE: 171,
    NOT_PRESENTED: 6,
    OUTSIDE_LU_REACH: 420,
    RAW_MESSAGE_ONLY: 187,
    SERVER_INTERNAL: 234,
    SERVER_TEXT_VERBATIM: 28,
  } as Record<string, number>,
  // W-UI1 2026-10-03: 861 W-M2e/lane entries - 14 that now have their own UI text + 247 from the widened scan.
  // W-UI1-R2: the digest now covers every note and the reviewed middleware; REJECT_DOCUMENT_FACT_CANDIDATE's note corrected.
  sha256: '898251c2d1657e9bb70cb58b87c724291c86308ec318b93b8d7fef6eee986444',
};

function reviewedDigest(): { total: number; groups: Record<string, number>; sha256: string } {
  // W-UI1-R2 (UI1-VERIFICATION finding 3c): the note is part of every line -- a rewritten justification is a change.
  const lines = Object.entries(LU_REVIEWED_FALLBACK)
    .map(([token, entry]) => `${token}\t${entry.group}\t${entry.parent ?? ''}\t${entry.note}`)
    .sort();
  const groups: Record<string, number> = {};
  for (const entry of Object.values(LU_REVIEWED_FALLBACK)) groups[entry.group] = (groups[entry.group] ?? 0) + 1;
  const templates = LU_REVIEWED_TEMPLATES.map((t) => `T\t${t.file}\t${t.template}\t${[...t.expansions].sort().join(',')}\t${t.note}`).sort();
  const middleware = [
    ...LU_REVIEWED_MIDDLEWARE.map((m) => `M\t${m.key}\t${m.module ?? ''}\t${m.review}\t${m.scannedAs ?? ''}\t${m.note}`),
    ...Object.entries(LU_REVIEWED_ROUTER_LEVEL_USES).map(([use, note]) => `R\t${use}\t${note}`),
  ].sort();
  return {
    total: lines.length,
    groups: Object.fromEntries(Object.entries(groups).sort(([a], [b]) => (a < b ? -1 : 1))),
    sha256: createHash('sha256').update([...lines, ...templates, ...middleware].join('\n')).digest('hex'),
  };
}

describe('W-M2e item 2: exhaustive inventory of server error codes against the LU UI texts', () => {
  it('the scan and the reach are real: they find the codes this lane knows of, and the LU entry modules exist', () => {
    for (const entry of [...LU_ENTRY_MODULES, ...LU_MIDDLEWARE_MODULES, ...LU_SHELL_MODULES]) expect(fs.existsSync(path.join(ROOT, entry)), entry).toBe(true);
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
      'ASSESSMENT_RECORD_INTEGRITY_ERROR',
      'LEGACY_UNBOUND_FORM_CONSISTENCY_ONLY',
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
      // W-UI1: the nets that close M2e verification finding 1 (C3b, C6, C9, L6.1).
      ['BLOCKED_DESIGN', 'reach-literal'],
      ['UNVERIFIED', 'lu-core-word'],
      ['LEGACY_CURRENTNESS_MIGRATION_V1', 'field-const:reason_code'],
      ['RECORD_INTEGRITY_ERROR', 'type:LuAssessmentStatus'],
    ] as const) {
      expect([...(scan.tokens.get(token)?.how ?? [])], `${token} must be found by the ${how} pattern`).toContain(how);
    }
    for (const reached of [
      'server/modules/localization/localizationOrchestrator.ts',
      'server/modules/localization/governedCoverageStatement.ts',
      'server/modules/localization/luProjectContextBootstrap.ts',
      'src/application/generate-localization-report.usecase.ts',
      // W-UI1 (C8b): middleware before the LU router, and createApp.ts's own text.
      'server/security/csrf.ts',
      'server/security/secureErrors.ts',
      'server/createApp.ts',
    ]) {
      expect(closure.has(reached), `${reached} not reached`).toBe(true);
    }
    // W-UI1 (C7): a file of the reach outside the scanned roots is scanned too.
    expect(closure.has('src/infrastructure/PrismaExecutionTicketQueue.ts')).toBe(true);
    expect(scan.files).toContain('src/infrastructure/PrismaExecutionTicketQueue.ts');
    // W-UI1 (C5): the template the reach really builds is found.
    expect(scan.templates).toContainEqual({
      file: 'server/modules/localization/localizationGeometryCurrentness.ts',
      template: 'LOCALIZATION_GEOMETRY_${failureClass}',
    });
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
      expect(waterRow({ status: state, coverage_state: state }, SOUND_DETAIL).summary, state).toBe('serverns rad');
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
      // W-UI1 (D): a root technical-error CLASS is probed as the class of a TECHNICAL_ERROR root, and must say
      // more than the plain TECHNICAL_ERROR mark.
      const isClass = token.startsWith('ROOT_');
      const root =
        token === 'UNBOUND_METADATA'
          ? { status: 'RESOLVED', assurance: token }
          : isClass
            ? { status: 'TECHNICAL_ERROR', technical_error_class: token, assurance: 'UNKNOWN' }
            : { status: token, assurance: 'UNBOUND_METADATA' };
      expect(propertyChip(root), token).not.toBe(propertyChip({ status: UNKNOWN }));
      if (isClass) expect(propertyChip(root), token).not.toBe(propertyChip({ status: 'TECHNICAL_ERROR', technical_error_class: UNKNOWN }));
    }
    for (const assurance of LU_BINDING_ASSURANCE_TEXTS) {
      expect(waterRow({}, { ...SOUND_DETAIL, binding_assurance: assurance }).datasetVersionUnknown, assurance).toBe(true);
      expect(waterRow({}, { ...SOUND_DETAIL, binding_assurance: UNKNOWN }).datasetVersionUnknown).toBe(false);
    }
    for (const code of LU_VERIFY_NOTICE_TEXTS) {
      expect(presentLuVerifyNotice({ code, finding_ids: [] }), code).not.toBe(LU_VERIFY_NOTICE_UNKNOWN_SV);
    }
    // W-UI1 (A): each verify value changes what the classifier shows.
    const verifyKind = (raw: Record<string, unknown>) => presentLuVerifyResult({ assessmentArtifactId: 'a', mismatches: [], notices: [], ...raw }, 'a').kind;
    const legacyNotice = (basis: string) => ({
      code: 'LEGACY_UNBOUND_FORM_CONSISTENCY_ONLY',
      basis,
      authenticity_verified: false,
      current_authority_verified: false,
      text_sv: presentLuVerifyNotice({ code: 'LEGACY_UNBOUND_FORM_CONSISTENCY_ONLY', finding_ids: [] }),
      finding_ids: [],
      // W-UI1-R2 (finding 7): a well-formed notice carries its detail, as the package's classifier requires.
      detail: 'd',
    });
    expect(verifyKind({ outcome: 'PASS', presentation: 'FULLY_BOUND_GREEN', verification_binding: 'FULLY_BOUND' })).toBe('FULLY_BOUND_GREEN');
    for (const basis of LU_VERIFY_BASIS_TEXTS) {
      expect(
        verifyKind({ outcome: 'PASS', presentation: 'LEGACY_UNBOUND_NOTICE', verification_binding: 'LEGACY_UNBOUND_FORM', notices: [legacyNotice(basis)] }),
        basis,
      ).toBe('LEGACY_UNBOUND_NOTICE');
    }
    for (const presentation of LU_VERIFY_PRESENTATION_TEXTS) expect(verifyKind({ outcome: 'PASS', presentation }), presentation).toBe('NOT_VERIFIED');
    for (const binding of LU_VERIFY_BINDING_TEXTS) expect(verifyKind({ outcome: 'PASS', verification_binding: binding }), binding).toBe('NOT_VERIFIED');
    const asGreen = { presentation: 'FULLY_BOUND_GREEN', verification_binding: 'FULLY_BOUND' };
    for (const outcome of LU_VERIFY_OUTCOME_TEXTS) {
      expect(verifyKind({ outcome, ...asGreen }), outcome).not.toBe(verifyKind({ outcome: UNKNOWN, ...asGreen }));
    }
    for (const code of LU_VERIFY_MISMATCH_TEXTS) {
      expect(verifyKind({ outcome: 'DENY', mismatches: [{ code, detail: 'x' }] }), code).not.toBe(verifyKind({ outcome: 'DENY', mismatches: [{ code: UNKNOWN, detail: 'x' }] }));
    }
    for (const level of LU_RISK_LEVEL_TEXTS) {
      expect(presentLuFinding({ rule_id: 'x', risk_level: level }).attentionLabel, level).not.toBe(presentLuFinding({ rule_id: 'x', risk_level: UNKNOWN }).attentionLabel);
    }
    for (const level of LU_RECORD_INTEGRITY_LEVEL_TEXTS) {
      const view = parseLuRecordIntegrityDiagnostic({
        authoritative: false,
        verified: false,
        stored_findings_unverified: { total: 1, entries: [{ check: 'water', stored_level: level, well_formed: true }] },
      })!;
      expect(view.entries[0], level).toBe(`Brunnar – lagrad nivå: ${recordIntegrityLevelSv(level)} (overifierad)`);
      expect(view.entries[0], level).not.toContain(level);
    }
  });

  it('EVERY scanned code has its own Swedish text or a reviewed fallback entry -- a new code without either fails here', () => {
    const missing = allTokens()
      .filter((token) => !OWN_TEXT.has(token) && !Object.prototype.hasOwnProperty.call(LU_REVIEWED_FALLBACK, token))
      .sort()
      .map((token) => {
        const s = scan.tokens.get(token);
        return `${token} [${inReach(token) ? 'IN LU REACH' : 'outside LU reach'}; ${[...(s?.how ?? ['template'])].join(',')}] ${filesOf(token).join(' ')}`;
      });
    expect(missing, 'give each code its own text in the UI, or a reviewed entry in luErrorCodeInventory.reviewed.ts').toEqual([]);
  });

  it('W-UI1: a status the server sends as assessment_status has a STATUS label of its own -- a text elsewhere is not enough', () => {
    const statuses = allTokens().filter(isStatusToken).sort();
    expect(statuses).toContain('RECORD_INTEGRITY_ERROR');
    const unlabelled = statuses.filter((status) => !LU_ASSESSMENT_STATUS_TEXTS.includes(status));
    expect(unlabelled, 'give each assessment status a label in ASSESSMENT_STATUS_LABEL (luErrorPresentation.ts)').toEqual([]);
  });

  it('W-UI1 (C5): every code-shaped template in the LU reach is reviewed with its expansions; no reviewed template is stale', () => {
    const key = (t: { file: string; template: string }) => `${t.file} \`${t.template}\``;
    const reviewed = new Set(LU_REVIEWED_TEMPLATES.map(key));
    const found = new Set(scan.templates.map(key));
    expect([...found].filter((t) => !reviewed.has(t)).sort(), 'list the template and every value it can build in LU_REVIEWED_TEMPLATES').toEqual([]);
    expect([...reviewed].filter((t) => !found.has(t)).sort(), 'remove reviewed templates the code no longer builds').toEqual([]);
    for (const t of LU_REVIEWED_TEMPLATES) {
      expect(t.expansions.length, key(t)).toBeGreaterThan(0);
      expect(t.note.trim().length, key(t)).toBeGreaterThan(20);
      // A template's `${...}` parts, or a concatenation's variable side, stand for [A-Z0-9_]+.
      const concat = /^['"]([A-Z0-9_]+)['"] \+ .+$|^.+ \+ ['"]([A-Z0-9_]+)['"]$/.exec(t.template);
      const pattern = concat
        ? new RegExp(concat[1] !== undefined ? `^${concat[1]}[A-Z0-9_]+$` : `^[A-Z0-9_]+${concat[2]}$`)
        : new RegExp(`^${t.template.replace(/\$\{[^}]+\}/g, '[A-Z0-9_]+')}$`);
      for (const token of t.expansions) expect(token, key(t)).toMatch(pattern);
    }
  });

  it('W-UI1-R2 (finding 3a): every app.use before the LU router is derived from createApp.ts and reviewed; a scanned one is in the reach', () => {
    const found = appUsesBeforeLuRouter(ROOT).map((u) => `${u.key}@${u.module ?? '-'}`).sort();
    const reviewed = LU_REVIEWED_MIDDLEWARE.map((m) => `${m.key}@${m.module ?? '-'}`).sort();
    expect(found.filter((k) => !reviewed.includes(k)), 'a new middleware before the LU router: review it in LU_REVIEWED_MIDDLEWARE').toEqual([]);
    expect(reviewed.filter((k) => !found.includes(k)), 'remove reviewed middleware that createApp.ts no longer mounts').toEqual([]);
    // As many of each as reviewed: a second inline handler (or a second mount of one module) is a new middleware too.
    expect(found, 'the same middleware mounted once more before the LU router: review it').toEqual(reviewed);
    for (const m of LU_REVIEWED_MIDDLEWARE) {
      expect(m.note.trim().length, m.key).toBeGreaterThan(20);
      if (m.review === 'SCANNED') {
        const scanned =
          (m.key === 'inline' && m.module === null && LU_SHELL_MODULES.includes('server/createApp.ts')) ||
          (m.module !== null && (LU_MIDDLEWARE_MODULES.includes(m.module) || LU_ENTRY_MODULES.includes(m.module))) ||
          (m.scannedAs !== undefined && LU_ENTRY_MODULES.includes(m.scannedAs) && fs.readFileSync(path.join(ROOT, m.module!), 'utf8').includes(path.basename(m.scannedAs, '.ts')));
        expect(scanned, `${m.key} is reviewed as SCANNED but is not in the scan's reach`).toBe(true);
      }
      if (m.review === 'NO_LU_ROUTE') {
        expect(m.module, m.key).not.toBeNull();
        expect(fs.readFileSync(path.join(ROOT, m.module!), 'utf8'), `${m.key} names an LU path`).not.toContain('/api/localization');
      }
      if (m.review === 'THIRD_PARTY') expect(m.module, m.key).toBeNull();
    }
  });

  it('W-UI1-R2 (finding 3a): every router-level .use(...) in the routers mounted before the LU router is reviewed', () => {
    const found = routerLevelUsesBeforeLuRouter(ROOT);
    const reviewed = Object.keys(LU_REVIEWED_ROUTER_LEVEL_USES).sort();
    expect(found).toEqual(reviewed);
    for (const [use, note] of Object.entries(LU_REVIEWED_ROUTER_LEVEL_USES)) expect(note.trim().length, use).toBeGreaterThan(20);
  });

  it('W-UI1 (C5): the template net sees a code built after an interpolation or by concatenation, and no constant name inside ${...}', () => {
    const sources = [
      'const a = `LOCALIZATION_GEOMETRY_${failureClass}`;',
      'const b = `${kind}_READ_ERROR`;',
      "const c = 'ASSESSMENT_' + kind;",
      "const d = kind + '_UNRESOLVED';",
      'const e = `${CHECKS_UNAVAILABLE_SV}${storedClause}`;',
      'const f = `${ARTIFACT_NOT_FOUND}${artifactId}`;',
      'const g = `Felkod ${code}`;',
    ];
    expect(sources.flatMap((s) => codeTemplatesIn(s))).toEqual([
      'LOCALIZATION_GEOMETRY_${failureClass}',
      '${kind}_READ_ERROR',
      "'ASSESSMENT_' + kind",
      "kind + '_UNRESOLVED'",
    ]);
  });

  it('the reviewed list has no stale entry and no entry for a code that has its own text', () => {
    const tokens = new Set(allTokens());
    const stale = Object.keys(LU_REVIEWED_FALLBACK).filter((token) => !tokens.has(token)).sort();
    expect(stale, 'remove entries for codes the server no longer has').toEqual([]);
    const both = Object.keys(LU_REVIEWED_FALLBACK).filter((token) => OWN_TEXT.has(token)).sort();
    expect(both, 'a code with its own text needs no fallback entry').toEqual([]);
  });

  it('every reviewed entry is justified: a known group, a note, and the mechanically checkable groups hold', () => {
    const problems: string[] = [];
    for (const [token, entry] of Object.entries(LU_REVIEWED_FALLBACK)) {
      if (!Object.prototype.hasOwnProperty.call(LU_FALLBACK_GROUPS, entry.group)) problems.push(`${token}: unknown group ${entry.group}`);
      if (!entry.note || entry.note.trim().length < 8) problems.push(`${token}: no note`);
      if (filesOf(token).length === 0) continue;
      const reached = inReach(token);
      if (entry.group === 'OUTSIDE_LU_REACH' && reached) {
        problems.push(`${token}: marked OUTSIDE_LU_REACH but is in ${filesOf(token).filter((f) => closure.has(f)).join(' ')}`);
      }
      if (entry.group !== 'OUTSIDE_LU_REACH' && !reached) problems.push(`${token}: outside the LU reach -- use OUTSIDE_LU_REACH`);
      if (entry.group === 'COVERED_BY_PARENT') {
        const parent = entry.parent ?? '';
        const ok = parent.startsWith('message:') ? parent.slice('message:'.length).length > 0 : OWN_TEXT.has(parent);
        if (!ok) problems.push(`${token}: parent ${parent || '(none)'} has no text of its own`);
      }
      // W-UI1: an open request to the UI lane is a debt, not a review -- it must be closed with a text of its own.
      if (/OWN UI (TEXT|ENTRY)[^.]*REQUESTED/i.test(entry.note)) problems.push(`${token}: the note still requests a UI text`);
    }
    expect(problems).toEqual([]);
    // Every group is documented.
    for (const [group, justification] of Object.entries(LU_FALLBACK_GROUPS) as [LuFallbackGroup, string][]) {
      expect(justification.length, group).toBeGreaterThan(80);
    }
  });

  it('W-UI1: the reviewed list cannot grow or change silently -- its size per group and digest are pinned', () => {
    const now = reviewedDigest();
    expect(
      now,
      'the reviewed list changed: review the change, then update REVIEWED_LIST_PIN in this file IN THE SAME COMMIT as luErrorCodeInventory.reviewed.ts',
    ).toEqual(REVIEWED_LIST_PIN);
  });
});
