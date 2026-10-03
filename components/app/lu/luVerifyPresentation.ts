/**
 * W-UI1 (A) -- how the answer of a reproducibility check (POST .../verify-assessment) is presented.
 *
 * Owner decision 2026-10-02 (binding): verify proves CONSISTENCY (replay against the pinned artifacts),
 * never authenticity. A PASS over a V1 / legacy-unbound artifact form must NOT look like the same green
 * verification as a fully bound V4: it is shown with the owner's exact text, in a neutral/warning tone,
 * never green.
 *
 * Contract server -> UI (U30R6 consumer list K3/K8/K21; W-PLUMB-S writes the server side):
 *   outcome               'PASS' | 'DENY'
 *   verification_binding  'FULLY_BOUND' | 'LEGACY_UNBOUND_FORM' | null
 *   presentation          'FULLY_BOUND_GREEN' | 'LEGACY_UNBOUND_NOTICE' | 'NOT_VERIFIED' (computed by the
 *                         server with the package's classifier -- the UI may not import packages/mps-lu)
 *   notices               [{ code, basis, authenticity_verified: false, current_authority_verified: false, text_sv }]
 *   mismatches            [{ code, detail, text_sv? }]
 *   outcome_sv            the server's own sentence (technical section only)
 *
 * The UI rule, FAIL-CLOSED: green ONLY when presentation === 'FULLY_BOUND_GREEN' AND verification_binding
 * === 'FULLY_BOUND' AND outcome === 'PASS' AND the answer is otherwise well-formed (no mismatches, no legacy
 * notice, no notice this UI cannot show). The owner's notice ONLY for a well-formed LEGACY_UNBOUND_NOTICE.
 * Everything else -- a missing, null or unknown value, a contradiction, DENY, a field that is only inherited
 * (prototype) or a getter that throws -- is NOT green. A DENY that is only EXECUTION_SUBJECT_UNBOUND has its
 * own text, kept apart from a deviation/manipulation (owner Ä-R5-4).
 *
 * Pure: no I/O, no clock, no environment. Reads only OWN data properties (never a getter, never the
 * prototype chain; U30R6-VERIFICATION R6b-2 (a)(b)); any exception reading the answer means NOT_VERIFIED.
 */

import { LU_VERIFY_NOTICE_LEGACY_UNBOUND_FORM_SV, presentLuVerifyNotice, type LuVerifyNotice } from './luVerifyNotice';
// Types only (erased at build): W-PLUMB-S's contract file has no import and no runtime value, so nothing of the
// server or of @miljobeslut/mps-lu reaches the client bundle. It ties the values below to the server's contract.
import type {
  LuVerifyBinding,
  LuVerifyLegacyUnboundBasis,
  LuVerifyPresentation,
} from '../../../server/modules/localization/verifyPresentationContract';

/** The owner's exact text for a PASS over an older, unbound artifact form (U+2013 dash) -- one source. */
export const LU_VERIFY_LEGACY_UNBOUND_FORM_TEXT_SV = LU_VERIFY_NOTICE_LEGACY_UNBOUND_FORM_SV;

/** The head of a fully bound PASS -- consistency against the pinned artifacts, never authenticity. */
export const LU_VERIFY_FULLY_BOUND_HEAD_SV = 'Reproducerbarheten verifierad – resultatet matchar de pinnade artefakterna.';

/** Under every PASS form: what the check does and does not show. */
export const LU_VERIFY_PASS_SCOPE_SV =
  'Kontrollen visar att bedömningen kan återskapas ur sitt sparade underlag. Den intygar inte vem som har skapat underlaget.';

/**
 * EXECUTION_SUBJECT_UNBOUND (U30-R5 / Ä-R5-4): the run behind the assessment has no governed execution
 * subject. Not a finding that the basis was changed -- the same meaning as the package's own text.
 */
export const LU_VERIFY_UNBOUND_TEXT_SV =
  'Reproducerbarheten kan inte bekräftas: körningen bakom bedömningen saknar ett styrt exekveringssubjekt (äldre eller ' +
  'obunden körningsform) och kan inte bindas till bedömningen. Resultatet påstår inte att underlaget har ändrats.';

/** A PASS whose binding/presentation is missing, unknown or contradictory: never shown as verified. */
export const LU_VERIFY_NOT_VERIFIED_SV =
  'Reproducerbarheten kan inte visas som bekräftad: kontrollens svar saknar en giltig uppgift om hur resultatet är bundet ' +
  'till sitt underlag, eller uppgiften går inte att tolka här.';

export const LU_VERIFY_UNKNOWN_OUTCOME_SV = 'Kontrollen gav ett okänt utfall. Reproducerbarheten kunde inte bekräftas.';
export const LU_VERIFY_DENY_WITHOUT_MISMATCH_SV =
  'Reproducerbarheten kunde inte bekräftas – återexekveringen matchar inte de pinnade artefakterna.';
export const LU_VERIFY_OTHER_ASSESSMENT_SV =
  'Kontrollen gällde en annan bedömning än den som visas och räknas inte för den här. Läs in bedömningen på nytt.';

/** A notice this UI cannot show next to a green result is a reason not to show green (R6b-2 (c)). */
export const LU_VERIFY_UNKNOWN_NOTICE_NOT_GREEN_SV =
  'Kontrollen gav en notis som inte kan visas här, så resultatet visas inte som verifierat – se teknisk information.';

const LEGACY_NOTICE_CODE = 'LEGACY_UNBOUND_FORM_CONSISTENCY_ONLY';
const UNBOUND_MISMATCH_CODE = 'EXECUTION_SUBJECT_UNBOUND';

/** Notices that may stand next to a green result (each has a text of its own in luVerifyNotice.ts). */
const NOTICES_ALLOWED_WITH_GREEN: ReadonlySet<string> = new Set(['NOT_CHECKED_CAUSE_NOT_PINNED']);

/** Why an older form carries the notice (the package's LuReExecutionLegacyUnboundBasis). */
const LEGACY_BASIS_SV: Readonly<Record<LuVerifyLegacyUnboundBasis, string>> = {
  V1_FORM: 'Bedömningen bygger på en äldre artefaktform utan registrerad körningslinje.',
  LEGACY_UNBOUND: 'Körningen bakom bedömningen är inte bunden till ett styrt exekveringssubjekt (äldre eller obunden körningsform).',
};

export type LuVerifyViewKind = 'FULLY_BOUND_GREEN' | 'LEGACY_UNBOUND_NOTICE' | 'DENY' | 'UNBOUND' | 'NOT_VERIFIED' | 'OTHER_ASSESSMENT';

/** verified = the only green; notice = warning tone (older form); denied = red; neutral = not verified, no claim. */
export type LuVerifyTone = 'verified' | 'notice' | 'denied' | 'neutral';

export interface LuVerifyView {
  readonly kind: LuVerifyViewKind;
  readonly tone: LuVerifyTone;
  /** The Swedish head line. */
  readonly headSv: string;
  /** Swedish lines directly under the head (notices, basis, an UNBOUND next to other deviations). */
  readonly lines: readonly string[];
  /** The scope sentence under a PASS form; null otherwise. */
  readonly scopeSv: string | null;
  readonly verifiedId: string | null;
  readonly mismatchCount: number;
  /** Machine values and the server's own text -- for the collapsed "Teknisk information" only. */
  readonly technical: readonly { readonly label: string; readonly value: string }[];
}

/** W-UI1 (inventory): the server's presentation classes, bindings, bases and outcomes this module presents. */
export const LU_VERIFY_PRESENTATION_TEXTS: readonly string[] = Object.freeze([
  'FULLY_BOUND_GREEN',
  'LEGACY_UNBOUND_NOTICE',
  'NOT_VERIFIED',
] as const satisfies readonly LuVerifyPresentation[]);
export const LU_VERIFY_BINDING_TEXTS: readonly string[] = Object.freeze(['FULLY_BOUND', 'LEGACY_UNBOUND_FORM'] as const satisfies readonly LuVerifyBinding[]);
export const LU_VERIFY_BASIS_TEXTS: readonly string[] = Object.freeze(['V1_FORM', 'LEGACY_UNBOUND'] as const satisfies readonly LuVerifyLegacyUnboundBasis[]);
export const LU_VERIFY_OUTCOME_TEXTS: readonly string[] = Object.freeze(['PASS', 'DENY']);
/** W-UI1 (inventory): verify mismatch codes with a Swedish text of their own (others: the "N avvikelser" line). */
export const LU_VERIFY_MISMATCH_TEXTS: readonly string[] = Object.freeze([UNBOUND_MISMATCH_CODE]);

/**
 * An OWN data property, never a getter (not invoked) and never the prototype chain; undefined when absent.
 * A hostile object whose descriptor lookup throws makes the caller throw -- presentLuVerifyResult turns that
 * into NOT_VERIFIED.
 */
export function ownDataField(value: unknown, key: string): unknown {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && 'value' in descriptor ? descriptor.value : undefined;
}

function isRecord(value: unknown): boolean {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function ownString(value: unknown, key: string): string | null {
  const v = ownDataField(value, key);
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/** An own array, copied element by element through own index properties (a Proxy or sparse array is no list). */
function ownArray(value: unknown, key: string): unknown[] | null {
  const v = ownDataField(value, key);
  if (!Array.isArray(v)) return null;
  const out: unknown[] = [];
  for (let i = 0; i < v.length; i += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(v, String(i));
    if (!descriptor || !('value' in descriptor)) return null;
    out.push(descriptor.value);
  }
  return out;
}

/** W-UI1 (K9): one notice as the server sends it -- code, finding ids, and the legacy notice's own fields. */
export function parseLuVerifyNotice(entry: unknown): LuVerifyNotice | null {
  const code = ownString(entry, 'code');
  if (!code) return null;
  const ids = ownArray(entry, 'finding_ids') ?? [];
  const basis = ownString(entry, 'basis');
  const text = ownString(entry, 'text_sv');
  const authenticity = ownDataField(entry, 'authenticity_verified');
  const authority = ownDataField(entry, 'current_authority_verified');
  return {
    code,
    finding_ids: ids.filter((id): id is string => typeof id === 'string'),
    ...(basis ? { basis } : {}),
    ...(text ? { text_sv: text } : {}),
    ...(typeof authenticity === 'boolean' ? { authenticity_verified: authenticity } : {}),
    ...(typeof authority === 'boolean' ? { current_authority_verified: authority } : {}),
  };
}

export function parseLuVerifyNotices(raw: unknown): LuVerifyNotice[] {
  const list = Array.isArray(raw) ? raw : [];
  return list.flatMap((entry) => {
    const notice = parseLuVerifyNotice(entry);
    return notice ? [notice] : [];
  });
}

/** A well-formed legacy notice exactly as the owner decided it (text, flags, known basis). */
function isWellFormedLegacyNotice(notice: LuVerifyNotice): boolean {
  return (
    notice.code === LEGACY_NOTICE_CODE &&
    typeof notice.basis === 'string' &&
    Object.prototype.hasOwnProperty.call(LEGACY_BASIS_SV, notice.basis) &&
    notice.authenticity_verified === false &&
    notice.current_authority_verified === false &&
    notice.text_sv === LU_VERIFY_LEGACY_UNBOUND_FORM_TEXT_SV
  );
}

function technicalRows(
  raw: unknown,
  verifiedId: string | null,
  notices: readonly LuVerifyNotice[],
  mismatches: readonly { code: string; detail: string }[],
): { label: string; value: string }[] {
  const show = (v: unknown) => (v === null ? 'null' : v === undefined ? 'saknas' : typeof v === 'string' ? v : JSON.stringify(v) ?? String(v));
  return [
    { label: 'Kontrollerad bedömning', value: verifiedId ?? 'okänd' },
    { label: 'Utfall', value: show(ownDataField(raw, 'outcome')) },
    { label: 'Bindning', value: show(ownDataField(raw, 'verification_binding')) },
    { label: 'Presentation', value: show(ownDataField(raw, 'presentation')) },
    ...notices.map((n) => ({
      label: 'Notis',
      value: `${n.code}${n.basis ? ` (${n.basis})` : ''}${n.finding_ids.length > 0 ? ` (${n.finding_ids.join(', ')})` : ''}`,
    })),
    ...mismatches.map((m) => ({ label: 'Avvikelse', value: `${m.code}: ${m.detail}` })),
    ...(ownString(raw, 'outcome_sv') ? [{ label: 'Serverns text', value: ownString(raw, 'outcome_sv')! }] : []),
  ];
}

function view(
  kind: LuVerifyViewKind,
  tone: LuVerifyTone,
  headSv: string,
  rest: Partial<Omit<LuVerifyView, 'kind' | 'tone' | 'headSv'>> = {},
): LuVerifyView {
  return { kind, tone, headSv, lines: [], scopeSv: null, verifiedId: null, mismatchCount: 0, technical: [], ...rest };
}

/**
 * W-UI1 (D; owner decision R3-1, 2026-10-03): the displayed assessment's property root is a technical error or
 * tampered -- a PASS (green or the older form's notice) is then not shown as a confirmation next to it: nothing
 * about the root's authenticity or present provenance may be implied. Re-reading the assessment resolves it.
 */
export const LU_VERIFY_ROOT_UNRESOLVED_SV =
  'Reproducerbarheten visas inte som bekräftad: fastighetsrotens proveniens i den visade bedömningen kunde inte läsas eller ' +
  'klarade inte kontrollen, och ingen slutsats kan dras om dess äkthet. Läs in bedömningen på nytt och kontrollera igen.';

/**
 * The presentation of one verify answer for the DISPLAYED assessment `shownId`. Never throws: anything it
 * cannot read is NOT_VERIFIED. `rootUnresolved`: the displayed read-back's root is a technical error or
 * tampered (isLuRootUnresolved) -- then a PASS form is shown as NOT_VERIFIED (owner decision R3-1).
 */
export function presentLuVerifyResult(raw: unknown, shownId: string | null, opts: { readonly rootUnresolved?: boolean } = {}): LuVerifyView {
  try {
    const v = classify(raw, shownId);
    // Both PASS forms: no confirmation (green, or the older form's consistency line) stands next to a root error.
    if (opts.rootUnresolved === true && (v.kind === 'FULLY_BOUND_GREEN' || v.kind === 'LEGACY_UNBOUND_NOTICE')) {
      return view('NOT_VERIFIED', 'neutral', LU_VERIFY_ROOT_UNRESOLVED_SV, {
        verifiedId: v.verifiedId,
        mismatchCount: 0,
        technical: [...v.technical, { label: 'Fastighetsrot', value: 'tekniskt fel eller integritetsfel i den visade bedömningen' }],
      });
    }
    return v;
  } catch {
    return view('NOT_VERIFIED', 'neutral', LU_VERIFY_NOT_VERIFIED_SV, {
      technical: [{ label: 'Svar', value: 'kunde inte läsas' }],
    });
  }
}

function classify(raw: unknown, shownId: string | null): LuVerifyView {
  if (!isRecord(raw)) {
    return view('NOT_VERIFIED', 'neutral', LU_VERIFY_NOT_VERIFIED_SV, { technical: [{ label: 'Svar', value: 'inte ett objekt' }] });
  }
  const verifiedId = ownString(raw, 'assessmentArtifactId');
  const outcome = ownDataField(raw, 'outcome');
  const binding = ownDataField(raw, 'verification_binding');
  const presentation = ownDataField(raw, 'presentation');
  const rawNotices = ownArray(raw, 'notices');
  const rawMismatches = ownArray(raw, 'mismatches');
  const notices = rawNotices ? rawNotices.flatMap((n) => {
    const parsed = parseLuVerifyNotice(n);
    return parsed ? [parsed] : [];
  }) : [];
  const mismatches = (rawMismatches ?? []).flatMap((m) => {
    const code = ownString(m, 'code');
    return code ? [{ code, detail: ownString(m, 'detail') ?? '' }] : [];
  });
  const technical = technicalRows(raw, verifiedId, notices, mismatches);
  const base = { verifiedId, technical, mismatchCount: mismatches.length };

  // The result counts only for the assessment that is shown.
  if (!shownId || verifiedId !== shownId) {
    return view('OTHER_ASSESSMENT', 'neutral', LU_VERIFY_OTHER_ASSESSMENT_SV, { ...base, mismatchCount: 0 });
  }

  if (outcome === 'DENY') {
    const unbound = mismatches.filter((m) => m.code === UNBOUND_MISMATCH_CODE);
    const others = mismatches.filter((m) => m.code !== UNBOUND_MISMATCH_CODE);
    if (unbound.length > 0 && others.length === 0) {
      // Not a deviation and not a manipulation: the run cannot be bound to the assessment.
      return view('UNBOUND', 'neutral', LU_VERIFY_UNBOUND_TEXT_SV, base);
    }
    if (others.length === 0) return view('DENY', 'denied', LU_VERIFY_DENY_WITHOUT_MISMATCH_SV, base);
    const n = others.length;
    return view(
      'DENY',
      'denied',
      `Kontrollen hittade ${n} ${n === 1 ? 'avvikelse' : 'avvikelser'} mot de pinnade artefakterna. Reproducerbarheten kunde inte bekräftas.`,
      { ...base, mismatchCount: n, lines: unbound.length > 0 ? [LU_VERIFY_UNBOUND_TEXT_SV] : [] },
    );
  }

  if (outcome !== 'PASS') return view('NOT_VERIFIED', 'neutral', LU_VERIFY_UNKNOWN_OUTCOME_SV, base);

  // A PASS: green or the owner's notice only for a well-formed answer; everything else is not verified.
  const wellFormedLists = rawNotices !== null && rawMismatches !== null && rawMismatches.length === 0 && notices.length === rawNotices.length;
  const legacy = notices.filter((n) => n.code === LEGACY_NOTICE_CODE);
  const otherNotices = notices.filter((n) => n.code !== LEGACY_NOTICE_CODE);
  const unknownNotice = otherNotices.some((n) => !NOTICES_ALLOWED_WITH_GREEN.has(n.code));
  const noticeLines = otherNotices.map((n) => presentLuVerifyNotice(n));

  if (
    presentation === 'FULLY_BOUND_GREEN' &&
    binding === 'FULLY_BOUND' &&
    wellFormedLists &&
    legacy.length === 0 &&
    !unknownNotice
  ) {
    return view('FULLY_BOUND_GREEN', 'verified', LU_VERIFY_FULLY_BOUND_HEAD_SV, { ...base, lines: noticeLines, scopeSv: LU_VERIFY_PASS_SCOPE_SV });
  }

  if (
    presentation === 'LEGACY_UNBOUND_NOTICE' &&
    binding === 'LEGACY_UNBOUND_FORM' &&
    wellFormedLists &&
    legacy.length === 1 &&
    notices[0] === legacy[0] &&
    isWellFormedLegacyNotice(legacy[0]!) &&
    !unknownNotice
  ) {
    return view('LEGACY_UNBOUND_NOTICE', 'notice', LU_VERIFY_LEGACY_UNBOUND_FORM_TEXT_SV, {
      ...base,
      lines: [LEGACY_BASIS_SV[legacy[0]!.basis as LuVerifyLegacyUnboundBasis], ...noticeLines],
      scopeSv: LU_VERIFY_PASS_SCOPE_SV,
    });
  }

  return view('NOT_VERIFIED', 'neutral', LU_VERIFY_NOT_VERIFIED_SV, {
    ...base,
    lines: unknownNotice && presentation === 'FULLY_BOUND_GREEN' && binding === 'FULLY_BOUND' ? [LU_VERIFY_UNKNOWN_NOTICE_NOT_GREEN_SV] : [],
  });
}
