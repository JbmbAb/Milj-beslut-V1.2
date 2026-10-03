/**
 * W-PLUMB-S -- the verify answer's presentation, decided IN THE SERVER (owner decision 2026-10-02, BINDING: a PASS over a
 * V1/legacy-unbound artifact form is accepted until U51 as a product limitation with a mandatory notice, and must never
 * look like the same green verification as a fully bound V4; verify is consistency, not authenticity). The contract
 * the UI codes against is ./verifyPresentationContract.ts.
 *
 * ONE source: the class is classifyVerifyPresentation from the @miljobeslut/mps-lu package root (fail-closed, own data
 * only). Two more rules make it the class of what the UI actually receives:
 *  - the class of the result AND the class of its machine fields as JSON carries them (outcome, mismatches, notices,
 *    verification_binding) must agree, else NOT_VERIFIED: a field that reads differently than it serializes (a toJSON, an
 *    inherited or computed value) can never make the answer green; the answer then carries the JSON's own values;
 *  - the strength is sent only when the presentation is not NOT_VERIFIED (null otherwise), so the answer's JSON always
 *    classifies to the presentation it states.
 * The route re-derives the same from the orchestrator's answer and requires the orchestrator's claimed presentation to
 * agree (verifyAnswerFields): a missing, unknown or contradicting claim is NOT_VERIFIED -- never upgraded.
 *
 * outcome_sv (the Swedish main text): FULLY_BOUND_GREEN -> the earlier PASS text (with the NOT_CHECKED clause);
 * LEGACY_UNBOUND_NOTICE -> EXACTLY the owner's text (the package's constant, the same as the notice's text_sv), never the
 * green sentence; NOT_VERIFIED -> a DENY keeps the DENY text (EXECUTION_SUBJECT_UNBOUND: its own text, the package's
 * constant), anything else that is not verified the neutral VERIFY_NOT_VERIFIED_SV. Never a tampering claim.
 */
import {
  assertBootstrapAdmitFlagOnlyInExplicitTestProcess,
  classifyVerifyPresentation,
  LU_REEXECUTION_LEGACY_UNBOUND_FORM_TEXT_SV,
  LU_REEXECUTION_UNBOUND_TEXT_SV,
  type LuReExecutionResult,
} from '@miljobeslut/mps-lu';
import { governedLayerLabelSv } from './governedCoverageStatement';
import type { LuVerifyBinding, LuVerifyMismatch, LuVerifyNotice, LuVerifyPresentation } from './verifyPresentationContract';

/** W-PLUMB-S: the main text of an answer that is not verified and is not a DENY (a PASS whose strength or notice is not established). */
export const VERIFY_NOT_VERIFIED_SV =
  'Reproducerbarheten kan inte visas som verifierad: kontrollens svar är ofullständigt eller motsägelsefullt (utfall, ' +
  'bindningsstyrka eller obligatorisk notis saknas eller stämmer inte överens). Det är inget fynd om att underlaget har ändrats.';

/** U20CDF: the DENY text (unchanged). */
const VERIFY_DENY_SV = 'Reproducerbarheten kunde inte bekräftas: återexekveringen gav inte samma resultat som den sparade bedömningen.';

const NOT_CHECKED_FINDING_ID_PREFIX = 'finding-notchecked-';

/**
 * U20CDF (U30-R2 follow-up; U30R2-REPORT section 3, owner question 6): the Swedish result text of a
 * verification, on top of the machine outcome and notices (both returned unchanged). A PASS that
 * carries NOT_CHECKED_CAUSE_NOT_PINNED is identical in layer, rule, version, risk level and evidence,
 * but the cause text of the listed NOT_CHECKED layers was never saved -- the text says so instead of
 * an unqualified "identiskt". Neutral wording; nothing here suggests tampering.
 *
 * U20CDF2 (coordinator add-on 3; owner 2026-10-02, U30R3 decision 2): verify is REPLAY/CONSISTENCY
 * verification -- the re-execution matches the pinned artifacts -- not proof of authenticity (no
 * attestation check yet). The text says exactly that ("Reproducerbarhet verifierad – resultatet
 * matchar de pinnade artefakterna"), never "verifierad/identisk/intakt" about the assessment itself;
 * the notices are shown under it as before.
 *
 * W-PLUMB-S: moved here unchanged from localizationOrchestrator.ts (which re-exports it). Its PASS text is used ONLY for a
 * FULLY_BOUND_GREEN answer -- presentVerifyResult decides that, never `outcome === 'PASS'`.
 */
export function verifyOutcomeSv(
  outcome: 'PASS' | 'DENY',
  notices: LuReExecutionResult['notices'],
): string {
  if (outcome !== 'PASS') {
    return VERIFY_DENY_SV;
  }
  const unpinned = notices
    .filter((notice) => notice.code === 'NOT_CHECKED_CAUSE_NOT_PINNED')
    .flatMap((notice) => notice.finding_ids);
  const passed = 'Reproducerbarhet verifierad – resultatet matchar de pinnade artefakterna';
  if (unpinned.length === 0) return `${passed}.`;
  const layers = unpinned
    .filter((id) => id.startsWith(NOT_CHECKED_FINDING_ID_PREFIX))
    .map((id) => governedLayerLabelSv(id.slice(NOT_CHECKED_FINDING_ID_PREFIX.length)));
  const named = layers.length > 0 ? ` (${layers.join(', ')})` : '';
  return `${passed}, men orsaken till att ${unpinned.length > 1 ? 'lagren' : 'lagret'} inte kontrollerades sparades inte${named}.`;
}

/** The machine fields and texts of a verify answer (see verifyPresentationContract.ts). */
export interface LuVerifyAnswerFields {
  readonly outcome: 'PASS' | 'DENY';
  readonly mismatches: readonly LuVerifyMismatch[];
  readonly notices: readonly LuVerifyNotice[];
  readonly verification_binding: LuVerifyBinding | null;
  readonly presentation: LuVerifyPresentation;
  readonly outcome_sv: string;
}

/**
 * U30R5-VERIFICATION finding 4 (W-PLUMB-S): the bootstrap-flag gate of verify -- MPS_LU_BOOTSTRAP_ADMIT present outside an
 * explicit test process is a configuration error (LuBootstrapAdmitFlagOutsideTestError, code
 * BOOTSTRAP_ADMIT_FLAG_OUTSIDE_TEST, gate "reexecution"). The package's own rule, called BEFORE verify reads anything (the
 * route calls it before authentication, the orchestrator before its first database or CAS read). Not the server's start-up
 * gate (U40-2).
 */
export function assertVerifyBootstrapFlagGate(env: Readonly<Record<string, string | undefined>> = process.env): void {
  assertBootstrapAdmitFlagOnlyInExplicitTestProcess(env, 'reexecution');
}

/**
 * The machine fields exactly as JSON carries them (what the route sends and the UI receives); `{}` for a result that is
 * not an object. A result whose fields cannot be serialized never becomes an answer: the failure propagates (the route
 * answers it as a technical error), never green.
 */
function machineFieldsAsJson(result: unknown): Readonly<Record<string, unknown>> {
  if (typeof result !== 'object' || result === null) return {};
  const source = result as Record<string, unknown>;
  let json: string;
  try {
    json = JSON.stringify({
      outcome: source.outcome,
      mismatches: source.mismatches,
      notices: source.notices,
      verification_binding: source.verification_binding,
    });
  } catch (error) {
    throw new Error('LU verify: the re-execution result cannot be serialized', { cause: error });
  }
  return JSON.parse(json) as Record<string, unknown>;
}

/** The Swedish main text of an answer with this presentation and these machine fields. */
function answerOutcomeSv(presentation: LuVerifyPresentation, fields: { outcome: unknown; mismatches: readonly unknown[]; notices: readonly unknown[] }): string {
  if (presentation === 'FULLY_BOUND_GREEN') return verifyOutcomeSv('PASS', fields.notices as LuReExecutionResult['notices']);
  if (presentation === 'LEGACY_UNBOUND_NOTICE') return LU_REEXECUTION_LEGACY_UNBOUND_FORM_TEXT_SV;
  if (fields.outcome !== 'DENY') return VERIFY_NOT_VERIFIED_SV;
  // U30-R6 (owner: UNBOUND gets its own text): a DENY that is exactly EXECUTION_SUBJECT_UNBOUND with the package's text.
  const [only, ...rest] = fields.mismatches as Array<{ code?: unknown; text_sv?: unknown } | null>;
  const unbound = rest.length === 0 && only?.code === 'EXECUTION_SUBJECT_UNBOUND' && only.text_sv === LU_REEXECUTION_UNBOUND_TEXT_SV;
  return unbound ? LU_REEXECUTION_UNBOUND_TEXT_SV : VERIFY_DENY_SV;
}

/** The answer's fields for `presentation` over the JSON form `wire` of the machine fields. */
function answerFields(presentation: LuVerifyPresentation, wire: Readonly<Record<string, unknown>>): LuVerifyAnswerFields {
  const fields = {
    outcome: wire.outcome as 'PASS' | 'DENY',
    mismatches: (Array.isArray(wire.mismatches) ? wire.mismatches : []) as LuVerifyMismatch[],
    notices: (Array.isArray(wire.notices) ? wire.notices : []) as LuVerifyNotice[],
  };
  return {
    ...fields,
    verification_binding: presentation === 'NOT_VERIFIED' ? null : (wire.verification_binding as LuVerifyBinding),
    presentation,
    outcome_sv: answerOutcomeSv(presentation, fields),
  };
}

/**
 * The orchestrator's one presentation step over the re-execution's result (U30R6-REPORT K2, K3, K21). Its presentation
 * is classifyVerifyPresentation of the result, provided the JSON of the result's machine fields classifies the same;
 * otherwise NOT_VERIFIED.
 */
export function presentVerifyResult(result: unknown): LuVerifyAnswerFields {
  const wire = machineFieldsAsJson(result);
  const ofResult = classifyVerifyPresentation(result);
  return answerFields(ofResult === classifyVerifyPresentation(wire) ? ofResult : 'NOT_VERIFIED', wire);
}

/**
 * The route's re-derivation of the orchestrator's answer (U30R6-REPORT K4, K21): the presentation is the one the answer's
 * own machine fields give, and only when the answer CLAIMS that same presentation; a missing, unknown or contradicting
 * claim is NOT_VERIFIED (never upgraded). The texts are re-derived with it.
 */
export function verifyAnswerFields(answer: unknown): LuVerifyAnswerFields {
  const wire = machineFieldsAsJson(answer);
  const ofAnswer = classifyVerifyPresentation(answer);
  const claimed = typeof answer === 'object' && answer !== null ? (answer as { presentation?: unknown }).presentation : undefined;
  const agreed = ofAnswer === classifyVerifyPresentation(wire) && claimed === ofAnswer;
  return answerFields(agreed ? ofAnswer : 'NOT_VERIFIED', wire);
}
